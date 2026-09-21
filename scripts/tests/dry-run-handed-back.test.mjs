/**
 * `run --dry-run` projects the queue THIS actor will be handed (TL-239).
 *
 * WHAT WAS MEASURED. A session hands a task back with `handoff` — "a week of
 * work does not fit a session of mine" — and `next` never offers it to that
 * same actor again (TL-141). The projection did: `run --dry-run` listed the
 * task at the head of the order and the live run, one second later, stepped
 * straight past it. The operator reads the dry run BEFORE starting an
 * unattended run, so a projection one task longer than the run is trusted
 * exactly where it is wrong — the same defect TL-206 removed on the wave axis.
 *
 * THE CAUSE WAS TWO WAYS OF BUILDING THE SAME RECORDS. `next` attaches what the
 * REST of the tree says about each task — `t.elsewhere` from the branch scan,
 * `t.history` and `t.handedBack` from the log — and passes `actor` in its
 * filters; the dry-run path read the task files alone and passed no actor. Both
 * then called the same `selectCandidates`, which can only apply the facts it is
 * given. The fix is one loader both paths call (`readDispatchRecords`), not a
 * second copy of the attachment in `run`: a divergence closed by duplication
 * comes back at the next field added.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the two agree      — asserted by comparing the two paths' OWN answers in
 *                        one tree, as ids, never as prose.
 *   the control        — another actor is still projected the same task. An
 *                        empty list agrees with an empty list trivially, and
 *                        without this a projection that hid every handed-back
 *                        task from everybody would be green here.
 *   the reason is said — the projection names the pass-over, on stdout and on
 *                        the wire. A candidate that disappears without a word
 *                        is indistinguishable from an empty queue.
 *
 * Every case runs on a fixture tree with its own state directory: this
 * repository's own tasks are somebody else's values and change with the work.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("dry-run-handed-back");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

let counter = 0;

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env,
  });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** Two open tasks, the handed-back one ranking FIRST so its absence is visible. */
function tree() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-dry-run-handed-back-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = [];
  for (const spec of [
    { title: "The task a session judged too large", priority: "P0" },
    { title: "The task that is next after it", priority: "P2" },
  ]) {
    const r = cli(["new", "--dir", backlog, "--title", spec.title, "--priority", spec.priority], env);
    assert.equal(r.code, 0, r.err);
    const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture task got no id: " + r.out);
    ids.push(id);
  }
  return { backlog, env, ids };
}

/** The ids `run --dry-run` says would run, in the order it says. */
function projected(f, actor) {
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--json", "--actor", actor], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  const answer = JSON.parse(r.out);
  return { ids: answer.order.map((o) => o.id), answer };
}

/**
 * The ids `run` actually takes in the same tree.
 *
 * `--agent true` is a command that succeeds and closes nothing, so the run takes
 * what it may take and stops — which is the queue this file compares against.
 */
function actuallyRun(f, actor) {
  const r = cli(["run", "--dir", f.backlog, "--agent", "true", "--json",
    "--actor", actor, "--max-tasks", "2"], f.env);
  assert.equal(r.code, 0, r.out + r.err);
  const answer = JSON.parse(r.out);
  return { ids: answer.tasks.map((t) => t.id), answer };
}

/** Hand the first task back as `actor`, the way a session that judged it does. */
function handBack(f, actor, reason) {
  assert.equal(cli(["next", "--dir", f.backlog, "--actor", actor, "--json"], f.env).code, 0);
  const h = cli(["handoff", f.ids[0], "--dir", f.backlog, "--actor", actor,
    "--to-owner", "unassigned", "--reason", reason], f.env);
  assert.equal(h.code, 0, h.err);
}

test("the two paths agree: what the projection lists is what the run takes", () => {
  const f = tree();
  handBack(f, "agent:mine", "a week of work does not fit a session");

  const dry = projected(f, "agent:mine");
  const live = actuallyRun(f, "agent:mine");
  assert.ok(
    dry.ids.indexOf(f.ids[0]) < 0,
    "the projection listed " + f.ids[0] + ", which this actor handed back and the run " +
      "will not be offered again: " + JSON.stringify(dry.ids),
  );
  assert.deepEqual(dry.ids, live.ids,
    "`--dry-run` and the run disagree about the same queue in the same tree: " +
      "projected " + JSON.stringify(dry.ids) + ", ran " + JSON.stringify(live.ids));
  // POSITIVE CONTROL for the agreement itself: the queue is not empty, so the
  // two lists agree about work rather than about nothing.
  assert.deepEqual(live.ids, [f.ids[1]]);
});

test("POSITIVE CONTROL: another actor is still projected the same task", () => {
  const f = tree();
  handBack(f, "agent:mine", "too large for me");

  const dry = projected(f, "agent:other");
  assert.deepEqual(dry.ids, [f.ids[0], f.ids[1]],
    "a handoff hid the task from everybody, not from its author: " + JSON.stringify(dry.ids));
  assert.deepEqual(actuallyRun(f, "agent:other").ids, [f.ids[0], f.ids[1]]);
});

test("the projection NAMES the pass-over rather than dropping it silently", () => {
  const f = tree();
  handBack(f, "agent:mine", "a week of work does not fit a session");

  const plain = cli(["run", "--dir", f.backlog, "--dry-run", "--actor", "agent:mine"], f.env);
  assert.equal(plain.code, 0, plain.out + plain.err);
  assert.match(plain.out, new RegExp(f.ids[0] + " skipped — you handed it back yourself"),
    "the projection dropped a candidate without a word:\n" + plain.out);
  assert.match(plain.out, /does not fit a session/,
    "the reason the session gave is not carried into the projection:\n" + plain.out);

  // AND ON THE WIRE, because an operator's dispatcher reads `--json`.
  const dry = projected(f, "agent:mine");
  assert.deepEqual((dry.answer.skippedHandedBack || []).map((s) => s.id), [f.ids[0]],
    "`--json` projects the shorter order and never says what left it: " +
      JSON.stringify(dry.answer));
});
