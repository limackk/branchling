/**
 * `next --plan` and `run --plan` — the dispatcher follows the written order
 * (TL-183).
 *
 * WHAT HAS TO BE PROVED, and why each part carries a positive control:
 *
 *   1. The plan CHANGES the answer. A test that only asserted "`--plan` handed
 *      out TL-x" would stay green against a flag that does nothing, because the
 *      priority queue reaches every task eventually. So every ordering case is
 *      asserted TWICE against the same tree — once without the flag, where the
 *      highest priority wins, and once with it, where the earliest wave does.
 *   2. A later wave is NOT reached while an earlier one is still open, even when
 *      the earlier wave's only task is already claimed. The control is that the
 *      same tree, asked without the flag, still hands something out — otherwise
 *      "nothing to take" would prove an empty queue rather than a respected plan.
 *   3. Inside a wave nothing is re-ranked. A wave is a batch; the existing
 *      policy (priority, then id) still decides between its members.
 *   4. `--plan` with no plan.yaml is a USAGE ERROR, and it happens before
 *      anything is claimed. A filter that silently matched everything reads
 *      exactly like a plan that schedules everything.
 *
 * EVERY CASE RUNS ON A FIXTURE TREE. This repository has a plan of its own and
 * it changes with the work; a test that read it would assert somebody else's
 * values and would go red the day a wave is finished.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("plan-order");

import { dispatchWave, parsePlanYaml } from "../plan.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;

/**
 * A backlog with one task per entry of `specs`, and no plan yet.
 *
 * The state directory is redirected per fixture: a suite writing to the real one
 * would leak reservations between runs and could refuse a task in a live session.
 */
function fixture(specs) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-plan-order-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = {
    ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1",
  };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = {};
  for (const spec of specs) {
    const r = cli(["new", "--dir", backlog, "--title", spec.title, "--priority", spec.priority], env);
    assert.equal(r.code, 0, r.err);
    ids[spec.key] = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(ids[spec.key], "the fixture task got no id: " + r.out);
  }
  return { backlog, env, ids };
}

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env: env || { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** Write a plan of `[["name", [id, …]], …]` into the fixture. */
function writePlan(backlog, waves) {
  const lines = ["updated: 2026-09-03", 'rationale: "fixture"', "waves:"];
  for (const [name, ids] of waves) {
    lines.push('  - name: "' + name + '"');
    lines.push("    tasks: [" + ids.join(", ") + "]");
  }
  writeFileSync(join(backlog, "plan.yaml"), lines.join("\n") + "\n", "utf8");
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function statusOf(backlog, id) {
  const m = readFileSync(taskPath(backlog, id), "utf8").match(/^status: (\S+)/m);
  return m ? m[1] : null;
}

/** Close a task WITHOUT running `done`: this file is about the order tasks are
 *  handed out in, and a verification contract is a different mechanism. */
function close(backlog, id) {
  const path = taskPath(backlog, id);
  const text = readFileSync(path, "utf8").replace(/^status: .*$/m, "status: done");
  writeFileSync(path, text, "utf8");
}

/** The id `next` claimed, or null when it took nothing. */
function taken(result) {
  if (result.code !== 0) return null;
  const answer = JSON.parse(result.out);
  return answer.taken ? answer.task.id : null;
}

// ── The wave a dispatcher may hand out of — pure ──────────────────────────

const CONFIG = { archivedStatuses: ["done", "cancelled"], inProgressStatus: "in_progress" };

function planOf(text) {
  const { plan, problems } = parsePlanYaml(text);
  assert.deepEqual(problems, [], "the fixture plan does not parse");
  return plan;
}

const TWO_WAVES = planOf(
  [
    "updated: 2026-09-03",
    'rationale: "fixture"',
    "waves:",
    '  - name: "First"',
    "    tasks: [TL-1]",
    '  - name: "Second"',
    "    tasks: [TL-2]",
    "",
  ].join("\n"),
);

test("the wave to dispatch from is the earliest one still holding an open task", () => {
  const wave = dispatchWave(
    TWO_WAVES,
    [{ id: "TL-1", status: "pending", blocked_by: [] }, { id: "TL-2", status: "pending", blocked_by: [] }],
    CONFIG,
  );
  assert.equal(wave.index, 0);
  assert.equal(wave.name, "First");
  assert.deepEqual(wave.ids, ["TL-1"]);

  // POSITIVE CONTROL: it is not always the first wave. Close its task and the
  // answer has to move on, or the assertion above would hold for a function
  // that returns `waves[0]` unconditionally.
  const next = dispatchWave(
    TWO_WAVES,
    [{ id: "TL-1", status: "done", blocked_by: [] }, { id: "TL-2", status: "pending", blocked_by: [] }],
    CONFIG,
  );
  assert.equal(next.index, 1);
  assert.deepEqual(next.ids, ["TL-2"]);
});

test("a claimed task keeps its wave active — in progress is still open work", () => {
  const wave = dispatchWave(
    TWO_WAVES,
    [{ id: "TL-1", status: "in_progress", blocked_by: [] }, { id: "TL-2", status: "pending", blocked_by: [] }],
    CONFIG,
  );
  assert.equal(wave.index, 0, "a wave whose only task is being worked was skipped");
});

test("a plan whose every task is closed dispatches nothing at all", () => {
  const wave = dispatchWave(
    TWO_WAVES,
    [{ id: "TL-1", status: "done", blocked_by: [] }, { id: "TL-2", status: "done", blocked_by: [] }],
    CONFIG,
  );
  assert.equal(wave, null, "an exhausted plan must not fall back to a wave");
});

// ── `next --plan` ─────────────────────────────────────────────────────────

/** Two tasks: `early` is the LOWER priority and stands in wave 1, `late` is the
 *  higher priority and stands in wave 2. Any difference in the answer is the
 *  plan and nothing else. */
function twoWaveTree() {
  const f = fixture([
    { key: "early", title: "The first wave task", priority: "P3" },
    { key: "late", title: "The second wave task", priority: "P1" },
  ]);
  writePlan(f.backlog, [["Foundations", [f.ids.early]], ["On top", [f.ids.late]]]);
  return f;
}

test("without `--plan` the highest priority wins, with it the earliest wave does", () => {
  const control = twoWaveTree();
  assert.equal(
    taken(cli(["next", "--dir", control.backlog, "--json"], control.env)),
    control.ids.late,
    "the control failed: the priority queue did not prefer the P1",
  );

  const f = twoWaveTree();
  assert.equal(
    taken(cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env)),
    f.ids.early,
    "`--plan` handed out a task from wave 2 while wave 1 was open",
  );
});

test("the wave that was followed is named on the way out", () => {
  const f = twoWaveTree();
  const r = cli(["next", "--dir", f.backlog, "--plan"], f.env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plan wave 1: Foundations/);
});

test("a later wave is not reached while an earlier one is still open", () => {
  const f = twoWaveTree();
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env)), f.ids.early);

  // Wave 1's only task is now claimed — open, not closed — so the plan still
  // points at it and there is nothing left to hand out.
  const second = cli(["next", "--dir", f.backlog, "--plan"], f.env);
  assert.equal(second.code, 3, second.out + second.err);
  assert.match(second.out, /nothing to take/);
  assert.match(second.out, /plan wave 1 \(Foundations\)/);
  assert.equal(statusOf(f.backlog, f.ids.late), "pending", "wave 2 was started early");

  // POSITIVE CONTROL: the queue is not empty. The same tree, asked without the
  // plan, hands out the wave 2 task at once — so the refusal above is the order
  // being respected, not an exhausted backlog.
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--json"], f.env)), f.ids.late);
});

test("the wave moves on by itself once its tasks are closed", () => {
  const f = twoWaveTree();
  close(f.backlog, f.ids.early);
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env)), f.ids.late);
});

test("inside one wave the existing policy still decides", () => {
  const f = fixture([
    { key: "low", title: "Low priority member of the wave", priority: "P3" },
    { key: "high", title: "High priority member of the wave", priority: "P1" },
    { key: "outside", title: "A task in a later wave", priority: "P0" },
  ]);
  writePlan(f.backlog, [["Batch", [f.ids.low, f.ids.high]], ["Later", [f.ids.outside]]]);
  assert.equal(
    taken(cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env)),
    f.ids.high,
    "the plan re-ranked the members of one wave instead of leaving the policy alone",
  );
});

test("an open task the plan does not schedule is never handed out, and is counted", () => {
  const f = fixture([
    { key: "planned", title: "The only planned task", priority: "P3" },
    { key: "unplanned", title: "A task nobody put in the plan", priority: "P0" },
  ]);
  writePlan(f.backlog, [["Only this", [f.ids.planned]]]);
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env)), f.ids.planned);

  const second = cli(["next", "--dir", f.backlog, "--plan", "--json"], f.env);
  assert.equal(second.code, 3, second.err);
  const answer = JSON.parse(second.out);
  assert.equal(answer.plan.wave, 1);
  assert.equal(answer.plan.skippedUnplanned, 1, "the unplanned task disappeared without a word");
  assert.equal(statusOf(f.backlog, f.ids.unplanned), "pending");
});

test("a plan with nothing open left says so, and does not fall back to the rest", () => {
  const f = fixture([
    { key: "planned", title: "The only planned task", priority: "P3" },
    { key: "unplanned", title: "A task nobody put in the plan", priority: "P0" },
  ]);
  writePlan(f.backlog, [["Only this", [f.ids.planned]]]);
  close(f.backlog, f.ids.planned);

  const r = cli(["next", "--dir", f.backlog, "--plan"], f.env);
  assert.equal(r.code, 3, r.out + r.err);
  assert.match(r.out, /every wave of it is finished/);
  assert.equal(statusOf(f.backlog, f.ids.unplanned), "pending");

  // POSITIVE CONTROL: that task is takeable — the refusal is about the plan.
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--json"], f.env)), f.ids.unplanned);
});

test("`--plan` with no plan.yaml is a usage error that names the file", () => {
  const f = fixture([{ key: "only", title: "The only task here", priority: "P1" }]);
  const r = cli(["next", "--dir", f.backlog, "--plan"], f.env);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /plan\.yaml/);
  assert.equal(statusOf(f.backlog, f.ids.only), "pending", "a task was claimed by a call that failed");

  // POSITIVE CONTROL: the tree is fine; only the missing plan was refused.
  assert.equal(taken(cli(["next", "--dir", f.backlog, "--json"], f.env)), f.ids.only);
});

test("a plan that does not parse refuses rather than dispatching half of it", () => {
  const f = twoWaveTree();
  writeFileSync(join(f.backlog, "plan.yaml"), "updated: 2026-09-03\nsprint: 4\n", "utf8");
  const r = cli(["next", "--dir", f.backlog, "--plan"], f.env);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /unknown key `sprint`/);
});

// ── `run --plan` ──────────────────────────────────────────────────────────

test("`run --dry-run --plan` prints the waves in wave order, not in priority order", () => {
  const f = twoWaveTree();
  const control = cli(["run", "--dir", f.backlog, "--dry-run", "--json"], f.env);
  assert.equal(control.code, 0, control.err);
  assert.equal(
    JSON.parse(control.out).order[0].id, f.ids.late,
    "the control failed: without the plan the P1 did not come first",
  );

  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan", "--json"], f.env);
  assert.equal(r.code, 0, r.err);
  const order = JSON.parse(r.out).order;
  assert.deepEqual(order.map((o) => o.id), [f.ids.early, f.ids.late]);
  assert.deepEqual(order.map((o) => o.wave), [1, 2]);
  assert.deepEqual(order.map((o) => o.waveName), ["Foundations", "On top"]);
});

test("the dry run's wave headings are readable in the terminal too", () => {
  const f = twoWaveTree();
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan"], f.env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /wave 1 — Foundations/);
  assert.match(r.out, /wave 2 — On top/);
  assert.ok(
    r.out.indexOf("wave 1") < r.out.indexOf("wave 2"),
    "the waves were printed out of order",
  );
});

test("a dry run with a plan lists nothing the plan does not schedule", () => {
  const f = fixture([
    { key: "planned", title: "The only planned task", priority: "P3" },
    { key: "unplanned", title: "A task nobody put in the plan", priority: "P0" },
  ]);
  writePlan(f.backlog, [["Only this", [f.ids.planned]]]);
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan", "--json"], f.env);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).order.map((o) => o.id), [f.ids.planned]);
});

test("`run --plan` with no plan.yaml fails before a single task is claimed", () => {
  const f = fixture([{ key: "only", title: "The only task here", priority: "P1" }]);
  const r = cli(["run", "--dir", f.backlog, "--plan", "--agent", "true"], f.env);
  assert.equal(r.code, 2, r.out + r.err);
  assert.match(r.err, /plan\.yaml/);
  assert.equal(statusOf(f.backlog, f.ids.only), "pending");
});
