/**
 * ONE WAVE, ONE ORDER: `plan` and the dispatcher read it the same way (TL-257).
 *
 * WHAT WAS MEASURED, in this repository on 2026-09-04 and again on 2026-09-21.
 * `plan` echoed a wave as its author wrote it and `run --plan --dry-run`
 * re-sorted the same wave by priority, so the first task of the wave was one id
 * to the reader and another to the dispatcher. Wave 4 of this project's own
 * plan, on 2026-09-21: authored `TL-277, TL-282, TL-283, TL-284, TL-349,
 * TL-272`, dispatched `TL-277, TL-282, TL-283, TL-349, TL-272, TL-284`. Neither
 * output said the other existed.
 *
 * THE DECISION, RECORDED AND NOT ARGUED HERE. The authored order BINDS the
 * dispatcher (`backlog/history/TL-257.jsonl`). A wave is an order — that is what
 * TL-206 settled between waves — and inside one it is the only place an author
 * can say that B reads A's correction, `priority:` being a property of a task
 * rather than of its position in a sequence. The rejected reading was that the
 * list is a set, which would have made `plan`'s "next up" a sequence printed
 * from something that is not one.
 *
 * WHAT THE PLAN STILL DOES NOT DO is rank the queue it does not schedule:
 * without `--plan` the priority order is untouched, which the control below
 * holds. The plan orders its OWN members, and only while it is being followed.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the three agree — `plan`, the projection and the live run name one sequence
 *                     in one tree, asserted as ids rather than as prose.
 *   the control     — the same tasks, the same priorities, a wave authored the
 *                     other way round, and all three follow the author. Without
 *                     it "they agree" would be green against any fixed rule the
 *                     fixture happened to match.
 *   the queue       — with no plan, priority still ranks. This is the half of
 *                     the old behaviour the decision did not overturn.
 *
 * The fixture is its own tree: this project's plan changes with the work, and a
 * test reading it would assert somebody else's values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("plan-order-within-wave");
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
 * Three open tasks in ONE wave, whose priorities rank them differently from the
 * sequence the wave is authored in. That gap is the whole subject: a fixture
 * where the two rules agree would be green whichever rule the code applies.
 *
 * @param {number[]} order which of the three tasks the wave lists, in which order
 */
function oneWaveTree(order) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-order-within-wave-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = [];
  for (const spec of [
    { title: "The correction everything after it reads", priority: "P3" },
    { title: "The task that would rank first on priority", priority: "P0" },
    { title: "The task that reads the correction", priority: "P3" },
  ]) {
    const r = cli(["new", "--dir", backlog, "--title", spec.title, "--priority", spec.priority], env);
    assert.equal(r.code, 0, r.err);
    const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture task got no id: " + r.out);
    ids.push(id);
  }
  const wave = order.map((i) => ids[i]);
  writeFileSync(
    join(backlog, "plan.yaml"),
    [
      "updated: 2026-09-21", 'rationale: "fixture"', "waves:",
      '  - name: "The one wave"', "    tasks: [" + wave.join(", ") + "]", "",
    ].join("\n"),
    "utf8",
  );
  return { backlog, env, ids, wave };
}

/** What `plan` says is next up, flattened to ids in the order it prints them. */
function planned(f) {
  const r = cli(["plan", "--dir", f.backlog, "--json"], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out).nextUp.flatMap((e) => e.ids);
}

/** The ids `run --plan --dry-run` says would run, in the order it says. */
function projected(f, extra = []) {
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--json", "--actor", "agent:mine"]
    .concat(extra), f.env);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out).order.map((o) => o.id);
}

/** The ids `run --plan` actually takes, in the order it takes them. */
function actuallyRun(f) {
  const r = cli(["run", "--dir", f.backlog, "--plan", "--agent", "true", "--json",
    "--actor", "agent:mine", "--max-tasks", "3"], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out).tasks.map((t) => t.id);
}

test("the three answers name ONE sequence: the wave as its author wrote it", () => {
  const f = oneWaveTree([0, 1, 2]);

  assert.deepEqual(planned(f), f.wave, "`plan` stopped echoing the authored order");
  assert.deepEqual(projected(f, ["--plan"]), f.wave,
    "the projection re-ranked the wave its author had already ordered");
  assert.deepEqual(actuallyRun(f), f.wave,
    "the run took the wave in an order neither `plan` nor the projection showed");
});

test("POSITIVE CONTROL: the order followed is the AUTHOR's, not the ids' or the priorities'", () => {
  // The same three tasks and the same priorities, listed the other way round.
  // Without this case a dispatcher that happened to rank by anything the first
  // fixture agreed with would pass, and the guard would hold nothing.
  const f = oneWaveTree([2, 0, 1]);

  assert.deepEqual(f.wave, [f.ids[2], f.ids[0], f.ids[1]]);
  assert.deepEqual(planned(f), f.wave);
  assert.deepEqual(projected(f, ["--plan"]), f.wave,
    "the projection did not follow the wave it was given");
  assert.deepEqual(actuallyRun(f), f.wave, "the run did not follow the wave it was given");
});

test("the queue the plan does NOT schedule is still ranked by priority", () => {
  // The decision binds a dispatcher that is FOLLOWING the plan. Asked without
  // `--plan`, the same tree answers in priority order — the P0 first — because
  // nothing has claimed a sequence for it.
  const f = oneWaveTree([0, 1, 2]);

  assert.deepEqual(projected(f), [f.ids[1], f.ids[0], f.ids[2]],
    "the unplanned queue lost its priority ranking");
});
