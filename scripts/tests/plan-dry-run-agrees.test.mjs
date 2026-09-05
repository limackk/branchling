/**
 * `run --plan --dry-run` and `run --plan` describe the SAME queue (TL-206).
 *
 * WHAT WAS MEASURED. In one tree, one second apart: the dry run listed the
 * tasks of a later wave and the live run took none of them, calling the queue
 * empty. Neither output said the other existed. `--dry-run` is the command an
 * operator runs BEFORE starting an unattended run, so a projection that
 * contradicts the run is worse than either behaviour on its own — it is trusted
 * exactly where it is wrong.
 *
 * THE CAUSE IS TWO READINGS OF ONE PLAN. The live path asks `dispatchWave` for
 * the first wave with open work and stops there; the dry-run path walks
 * `planState().waves` from the active one ON, so a wave this run can never
 * finish — its remaining open work is a person's, or somebody else is already
 * holding it — is stepped over in the projection and hit in the run.
 *
 * WHICH OF THE TWO IS RIGHT WAS DECIDED, NOT PATCHED. The question was asked on
 * 2026-09-03 and answered on the same day (`backlog/history/TL-206.jsonl`,
 * decision 01M1M8CN8WSWKYG2T7J01YVKSR): the fleet does NOT run ahead.
 * `dispatchWave` stays the single definition of what may be handed out, and the
 * projection stops at the first wave it cannot finish, NAMING it rather than
 * silently skipping to a later one. A wave is an order; a projection that
 * predicts waves this run will never reach is predicting somebody else's run.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the control     — a wave this run CAN finish is still projected, and the
 *                     live run starts exactly where the projection said it
 *                     would. Without it, "the dry run listed nothing" would be
 *                     green against a projection that lists nothing ever, and
 *                     the guard would have no evidentiary force at all.
 *   the human wall  — the earlier wave's only open task asks for a person: the
 *                     dry run must not project the later wave the run refuses
 *                     to reach.
 *   the wall in flight — the same rule for a wave somebody else is holding,
 *                     because the decision names both and neither is the
 *                     projection's to skip.
 *   the two agree   — asserted by comparing the two paths' OWN answers in one
 *                     tree, not by asserting a sentence: the ids the projection
 *                     lists against the ids the run actually takes.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT OWN. TL-186 owns the words of the live
 * run's `stopped` line and TL-199 owns the `plan` view's marking; both must stay
 * separately closable. So the only wording asserted here is the ONE fact this
 * task adds: the projection names the wave it stopped at. Everything else is
 * asserted as ids.
 *
 * EVERY CASE RUNS ON A FIXTURE TREE, never on this repository's own plan — that
 * plan changes with the work, and a test reading it would assert somebody else's
 * values (AGENTS.md: do not assert another project's values).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each file
// in its own process, so one call covers every case in it: without it a test
// reads the DEVELOPER's configuration and the suite answers differently on
// different machines.
isolateHome("plan-dry-run-agrees");
// Asserted against PLAIN text whatever terminal the suite is run from (TL-238).
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env,
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/**
 * Two waves, one task each: an earlier `Foundations` and a later `On top`.
 *
 * The later task is the HIGHER priority on purpose. Without the plan the
 * priority queue reaches it first, which is what makes "the projection listed
 * the later wave" a fact about the plan being walked wrongly rather than a fact
 * about ranking.
 *
 * The state directory is redirected per fixture: a suite writing to the real one
 * would leak reservations between runs and could refuse a task in a live session.
 */
function twoWaveTree() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-dry-run-agrees-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = {};
  for (const spec of [
    { key: "early", title: "The wave everything waits behind", priority: "P3" },
    { key: "late", title: "The wave a fleet would rather be doing", priority: "P1" },
  ]) {
    const r = cli(["new", "--dir", backlog, "--title", spec.title, "--priority", spec.priority], env);
    assert.equal(r.code, 0, r.err);
    ids[spec.key] = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(ids[spec.key], "the fixture task got no id: " + r.out);
  }
  writeFileSync(
    join(backlog, "plan.yaml"),
    [
      "updated: 2026-09-03", 'rationale: "fixture"', "waves:",
      '  - name: "Foundations"', "    tasks: [" + ids.early + "]",
      '  - name: "On top"', "    tasks: [" + ids.late + "]", "",
    ].join("\n"),
    "utf8",
  );
  return { backlog, env, ids };
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

/** Set a field in a fixture task's frontmatter. The vocabulary is the fixture's. */
function setField(backlog, id, field, value) {
  const path = taskPath(backlog, id);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + field + ":.*$", "m"), field + ': "' + value + '"');
  assert.notEqual(next, text, "the fixture has no `" + field + ":` line to set");
  writeFileSync(path, next, "utf8");
}

/** The ids `run --dry-run --plan` says would run, in the order it says. */
function projected(f, actor) {
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan", "--json", "--actor", actor], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  const answer = JSON.parse(r.out);
  return { ids: answer.order.map((o) => o.id), waves: answer.order.map((o) => o.wave), answer };
}

/**
 * The ids `run --plan` actually takes in the same tree.
 *
 * `--agent true` is a command that succeeds and closes nothing, so the run takes
 * what it may take and stops — which is precisely the queue this file compares
 * against. What the agent DID is another file's subject.
 */
function actuallyRun(f, actor, maxTasks) {
  const args = ["run", "--dir", f.backlog, "--plan", "--agent", "true", "--json", "--actor", actor];
  if (maxTasks) args.push("--max-tasks", String(maxTasks));
  const r = cli(args, f.env);
  assert.equal(r.code, 0, r.out + r.err);
  const answer = JSON.parse(r.out);
  return { ids: answer.tasks.map((t) => t.id), stopped: answer.stopped, answer };
}

// ── The control ───────────────────────────────────────────────────────────

test("POSITIVE CONTROL: a wave this run can finish is projected, and the run starts there", () => {
  // Everything here is a fleet's to take, so nothing walls the projection. This
  // is what gives the three cases below their force: they assert that a list
  // went EMPTY, and an empty list proves nothing unless the same fixture, one
  // field different, produces a full one.
  const f = twoWaveTree();

  const dry = projected(f, "agent:mine");
  assert.deepEqual(dry.ids, [f.ids.early, f.ids.late],
    "the projection did not list both waves of a plan a fleet can finish on its own");
  assert.deepEqual(dry.waves, [1, 2]);

  const live = actuallyRun(f, "agent:mine", 1);
  assert.deepEqual(live.ids, [f.ids.early],
    "the run did not start where the projection said it would");
});

// ── A wave only a person can finish ───────────────────────────────────────

test("a wave held by a person is a wall — the projection does not step over it", () => {
  const f = twoWaveTree();
  setField(f.backlog, f.ids.early, "executor", "human");

  const dry = projected(f, "agent:mine");
  assert.ok(
    dry.ids.indexOf(f.ids.late) < 0,
    "the projection listed " + f.ids.late + " from wave 2 while wave 1 waits on a person — " +
      "the run refuses to reach it, so a report promising it is a report the operator " +
      "will be contradicted by: " + JSON.stringify(dry.ids),
  );
  assert.deepEqual(dry.ids, [],
    "wave 1's only open task is a person's and wave 2 is out of this run's reach, " +
      "so there is no task this run would run");
});

test("the projection NAMES the wave it stopped at rather than listing an order without it", () => {
  // The one sentence this task owns. A projection that stops and says nothing is
  // the same defect one layer along: the operator reads an empty order and has
  // no second place to look for the reason. TL-186 owns the live run's wording
  // and TL-199 the plan view's; only the naming is asserted here.
  const f = twoWaveTree();
  setField(f.backlog, f.ids.early, "executor", "human");

  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan", "--actor", "agent:mine"], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /wave 1/, "the projection stopped at wave 1 without naming it:\n" + r.out);
  assert.match(r.out, /Foundations/, "the wave it stopped at is not named:\n" + r.out);

  // AND ON THE WIRE, because a dispatcher deciding whether to keep polling reads
  // `--json` and not a terminal. The FACT is required; which field carries it is
  // the implementer's to choose, so the whole answer is searched rather than one
  // key of it.
  const dry = projected(f, "agent:mine");
  assert.match(JSON.stringify(dry.answer), /Foundations/,
    "`--json` projects an empty order and never says which wave ended it: " +
      JSON.stringify(dry.answer));
});

test("the two paths agree: what the projection lists is what the run takes", () => {
  // The whole thesis, in one tree, asserted as ids rather than as prose — this
  // is the comparison nothing in either output made on 2026-09-03.
  const f = twoWaveTree();
  setField(f.backlog, f.ids.early, "executor", "human");

  const dry = projected(f, "agent:mine");
  const live = actuallyRun(f, "agent:mine", 2);
  assert.deepEqual(dry.ids, live.ids,
    "`--dry-run` and the run disagree about the same queue in the same tree: " +
      "projected " + JSON.stringify(dry.ids) + ", ran " + JSON.stringify(live.ids));
  // POSITIVE CONTROL for the agreement itself: two empty lists agree trivially,
  // so the run has to have stopped for the plan's reason and not because the
  // tree was empty. `late` is open, and it is the plan that left it alone.
  assert.deepEqual(live.ids, []);
  assert.match(live.stopped, /wave 1/, live.stopped);
});

// ── A wave somebody else is holding ───────────────────────────────────────

test("a wave in flight elsewhere is the same wall, and the two paths agree there too", () => {
  const f = twoWaveTree();
  // Wave 1's only task is claimed by another session — open work this run may
  // not be handed, which is what a fleet meets on every wave with fewer tasks
  // than workers.
  const claim = cli(["next", "--dir", f.backlog, "--plan", "--json", "--actor", "agent:other"], f.env);
  assert.equal(claim.code, 0, claim.err);
  assert.equal(JSON.parse(claim.out).task.id, f.ids.early, "the fixture did not claim wave 1");

  const dry = projected(f, "agent:mine");
  assert.ok(
    dry.ids.indexOf(f.ids.late) < 0,
    "the projection listed wave 2 while wave 1 is in flight elsewhere: " + JSON.stringify(dry.ids),
  );

  const live = actuallyRun(f, "agent:mine", 2);
  assert.deepEqual(dry.ids, live.ids,
    "projected " + JSON.stringify(dry.ids) + ", ran " + JSON.stringify(live.ids));
  assert.deepEqual(live.ids, []);
});
