/**
 * `run --plan` acts on the waiting refusal kinds `next --plan` returns, and
 * passes `--spill` through to it (TL-707).
 *
 * WHAT WAS WRONG. TL-683 gave `next --plan` two refusal kinds besides
 * `nothing-to-take` — `wave-claimed-elsewhere` and `wave-awaits-merge` — but
 * `run` went on inferring the same state by itself: `--wait` treated a wave as
 * in flight whenever `plan.open > 0`, and the stop sentence was built from the
 * counts alone. A wave `next` called `nothing-to-take` (an open task held back
 * by a protected status, which no claim released elsewhere will ever hand out)
 * was polled until `--wait-max`, and `run --plan --spill` could not reach
 * `next` at all.
 *
 * WHAT EACH CASE PROVES:
 *
 *   awaits a merge        — a wave waiting on a merge is polled, and the run
 *                           resumes once the merge lands (made by the
 *                           `--before-next` gate on a chosen call, so it happens
 *                           at a known poll). Nothing in this fixture is held
 *                           in another tree, so only the wave can keep it waiting.
 *   claimed               — the stop sentence names the kind and the ids.
 *   nothing-to-take       — the same `--wait` ends at once, and `next` is asked
 *                           first, to prove the fixture is the case it claims:
 *                           a wave whose `plan.open` is non-zero.
 *   --spill               — the run draws from the next wave; the same tree
 *                           without the flag takes nothing (the control).
 *   the sentence          — pure cases for every clause, including the spill
 *                           whose counts describe a different wave.
 *   the field (TL-729)    — `planWaiting` in the envelope carries the kind, the
 *                           waiting wave and its ids for a claimed and a
 *                           merge-awaiting wave, and is null for a
 *                           nothing-to-take wave, for a run without --plan,
 *                           and for a run that waited on a wave, took a task
 *                           and then stopped on --max-tasks with no later
 *                           `next` answer to overwrite the field.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, posixPath, SCRIPTS_DIR } from "./_repo.mjs";
import { planStop, planWaiting, planWaitingWave } from "../run-loop.mjs";

isolateHome("run-plan-waiting");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const RUN_ACTOR = "agent:worker";
const OTHER_ACTOR = "agent:other";
let counter = 0;

function cli(args, env, opts = {}) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 120_000, env, ...opts });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function vcs(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" }
  );
}

function commit(cwd, message) {
  vcs(cwd, ["add", "-A"]);
  vcs(cwd, ["commit", "-qm", message]);
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function setField(backlog, id, field, value) {
  const path = taskPath(backlog, id);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + field + ":.*$", "m"), field + ": " + value);
  assert.notEqual(next, text, "the fixture has no `" + field + ":` line to set");
  writeFileSync(path, next, "utf8");
}

function statusOf(backlog, id) {
  return (readFileSync(taskPath(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function script(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return posixPath(p);
}

/**
 * A repository on `main` with tasks a and c, wave 1 "First" [a] and wave 2
 * "Second" [c]. Each task's contract is `test -f <id>.done`, which the worker
 * agent satisfies. `setup(f)` edits the tree before the seed commit;
 * `feature(f)` edits it on the `feature` branch, committed and left.
 */
function tree({ setup, feature } = {}) {
  const dir = fixtureDir(join(tmpdir(), "branchling-run-plan-waiting-" + counter++ + "-"));
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, " + RUN_ACTOR + ", " + OTHER_ACTOR + "]"), "utf8");
  const ids = {};
  for (const key of ["a", "c"]) {
    const r = cli(["new", "--dir", backlog, "--title", "Fixture task " + key, "--priority", "P1"], env);
    assert.equal(r.code, 0, r.err);
    const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture task got no id: " + r.out);
    ids[key] = id;
    const file = taskPath(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/,
        'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  }
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-13", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + ids.a + "]",
    '  - name: "Second"', "    tasks: [" + ids.c + "]",
    "",
  ].join("\n"), "utf8");
  const f = { dir, repoRoot, backlog, env, ids };
  if (setup) setup(f);
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  commit(repoRoot, "seed");
  if (feature) {
    vcs(repoRoot, ["checkout", "-q", "-b", "feature"]);
    feature(f);
    commit(repoRoot, "feature work");
    vcs(repoRoot, ["checkout", "-q", "main"]);
  }
  return f;
}

function worker(dir) {
  return script(dir, "agent.sh", [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    'echo "worked $id"',
  ].join("\n"));
}

/** `a` is in progress in THIS tree under another actor: a claim, and nothing
 *  any other tree reports, so `heldInOtherTrees` stays empty. */
function claimedHere(f) {
  setField(f.backlog, f.ids.a, "status", "in_progress");
  setField(f.backlog, f.ids.a, "owner", OTHER_ACTOR);
}

function run(f, extra) {
  const r = cli(["run", "--dir", f.backlog, "--actor", RUN_ACTOR, "--agent", worker(f.dir), "--plan", "--json"]
    .concat(extra || []), f.env, { cwd: f.repoRoot });
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}

// ── `--wait` follows the refusal kind ──────────────────────────────────────

test("a wave waiting on a merge is polled under --wait, and the run resumes once the merge lands", () => {
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "done") });
  const calls = posixPath(join(f.dir, "calls"));
  // Call 1 finds wave 1 waiting on the merge and the run waits; call 2 merges
  // first, so wave 1 is finished and wave 2's task is handed out.
  const gate = script(f.dir, "gate.sh", [
    "echo x >> " + JSON.stringify(calls),
    "n=$(wc -l < " + JSON.stringify(calls) + " | tr -d ' ')",
    'if [ "$n" -eq 2 ]; then git merge -q --ff-only feature >/dev/null 2>&1 || exit 9; fi',
  ].join("\n"));
  const report = run(f, ["--before-next", gate, "--wait", "1", "--wait-max", "60"]);
  assert.equal(report.beforeNextRefused, null, JSON.stringify(report.beforeNextRefused));
  assert.deepEqual(report.heldInOtherTrees, { count: 0, ids: [] }, "the fixture holds a task in another tree");
  assert.equal(report.waited.polls, 1, "the run did not wait exactly once for the merge: " + report.stopped);
  assert.equal(report.waited.gaveUp, false);
  assert.deepEqual(report.tasks.map((t) => t.id), [f.ids.c]);
  assert.equal(report.tally.closed, 1, report.stopped);
  assert.equal(statusOf(f.backlog, f.ids.c), "done");
  assert.equal(report.stopped, "every wave of the plan is finished");
  // The run did not STOP on the waiting wave, so the field it waited on is gone.
  assert.equal(report.planWaiting, null);
});

test("a run that waited on a merge, then took a task and stopped on --max-tasks, reports planWaiting null", () => {
  // The previous case ends on another `next` answer, which overwrites the
  // field by itself. Here the run stops at the top of the loop after the take,
  // so no later answer can clear what the wait left behind: only the take can.
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "done") });
  const calls = posixPath(join(f.dir, "calls"));
  const gate = script(f.dir, "gate.sh", [
    "echo x >> " + JSON.stringify(calls),
    "n=$(wc -l < " + JSON.stringify(calls) + " | tr -d ' ')",
    'if [ "$n" -eq 2 ]; then git merge -q --ff-only feature >/dev/null 2>&1 || exit 9; fi',
  ].join("\n"));
  const report = run(f, ["--before-next", gate, "--wait", "1", "--wait-max", "60", "--max-tasks", "1"]);
  assert.equal(report.waited.polls, 1, "the run did not wait on the merge first: " + report.stopped);
  assert.deepEqual(report.tasks.map((t) => t.id), [f.ids.c]);
  assert.match(report.stopped, /--max-tasks 1/);
  assert.equal(report.planWaiting, null, "the wave the run waited on before its take survived the take");
});

test("planWaiting names a wave waiting on a merge as a field", () => {
  const f = tree({ feature: (t) => setField(t.backlog, t.ids.a, "status", "done") });
  const report = run(f);
  assert.equal(report.tally.taken, 0);
  assert.match(report.stopped, /\(wave-awaits-merge\)/);
  assert.deepEqual(report.planWaiting, {
    kind: "wave-awaits-merge", wave: 1, name: "First",
    claimedElsewhere: [], awaitingMerge: [f.ids.a], waitingBehind: [], waitingConflict: [],
  });
});

test("a wave waiting on a claim is named with its kind and ids, and --wait-max ends the wait", () => {
  const f = tree({ setup: claimedHere });
  const report = run(f, ["--wait", "1", "--wait-max", "2"]);
  assert.equal(report.tally.taken, 0);
  assert.deepEqual(report.heldInOtherTrees, { count: 0, ids: [] });
  assert.ok(report.waited.polls >= 1, "the run did not wait for a wave `next` called waiting");
  assert.equal(report.waited.gaveUp, true);
  assert.equal(report.stopped,
    "plan wave 1 (First) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
      " — claimed in another tree or session: " + f.ids.a +
      "; 1 open task in later waves is not reached yet" +
      "; waited 2s (--wait-max) and nothing was freed");
  assert.equal(statusOf(f.backlog, f.ids.c), "pending", "the run reached past the waiting wave without --spill");
  assert.deepEqual(report.planWaiting, {
    kind: "wave-claimed-elsewhere", wave: 1, name: "First",
    claimedElsewhere: [f.ids.a], awaitingMerge: [], waitingBehind: [], waitingConflict: [],
  });

  const text = cli(["run", "--dir", f.backlog, "--actor", RUN_ACTOR, "--agent", worker(f.dir), "--plan"],
    f.env, { cwd: f.repoRoot });
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, new RegExp("stopped: plan wave 1 \\(First\\) is waiting on claims held in another tree " +
    "or session \\(wave-claimed-elsewhere\\) — claimed in another tree or session: " + f.ids.a));
});

test("a wave `next` calls nothing-to-take ends the run at once under --wait", () => {
  // `a` is protected — `blocked` with no `blocked_by` — so no claim released
  // and no merge will ever hand it out. It is still open.
  const f = tree({ setup: (t) => setField(t.backlog, t.ids.a, "status", "blocked") });
  // THE CASE IT CLAIMS TO BE: `next` calls it nothing-to-take while the wave
  // still counts an open task — exactly what `plan.open > 0` read as in flight.
  const asked = cli(["next", "--dir", f.backlog, "--actor", RUN_ACTOR, "--plan", "--dry-run", "--json"], f.env);
  assert.equal(asked.code, 3, asked.out + asked.err);
  const answer = JSON.parse(asked.out);
  assert.equal(answer.refusalKind, "nothing-to-take");
  assert.equal(answer.plan.wave, 1);
  assert.equal(answer.plan.open, 1);

  const report = run(f, ["--wait", "1", "--wait-max", "5"]);
  assert.equal(report.waited.polls, 0, "the run polled a wave `next` called nothing-to-take: " + report.stopped);
  assert.equal(report.waited.gaveUp, false);
  assert.equal(report.stopped,
    "plan wave 1 (First) is not finished — 1 of 1 task in it is still open and none was free to take" +
      ", 1 open task in later waves is not reached yet");
  assert.equal(statusOf(f.backlog, f.ids.a), "blocked");
  assert.equal(report.planWaiting, null, "a nothing-to-take wave was reported as waiting");
});

test("planWaiting is null for a run without --plan, even where the plan has a waiting wave", () => {
  // The same claimed wave that fills the field under --plan: without the flag
  // the run takes wave 2's task and stops on an empty queue.
  const f = tree({ setup: claimedHere });
  const r = cli(["run", "--dir", f.backlog, "--actor", RUN_ACTOR, "--agent", worker(f.dir), "--json"],
    f.env, { cwd: f.repoRoot });
  assert.equal(r.code, 0, r.out + r.err);
  const report = JSON.parse(r.out);
  assert.ok(Object.hasOwn(report, "planWaiting"), "the envelope does not declare planWaiting");
  assert.equal(report.planWaiting, null);
  assert.deepEqual(report.tasks.map((t) => t.id), [f.ids.c]);
});

// ── `--spill` reaches `next` ───────────────────────────────────────────────

test("--spill draws from the next wave while the active one waits; without it nothing is taken", () => {
  const control = tree({ setup: claimedHere });
  const held = run(control);
  assert.equal(held.tally.taken, 0, "the control took work past a waiting wave without --spill");
  assert.equal(statusOf(control.backlog, control.ids.c), "pending");

  const f = tree({ setup: claimedHere });
  const report = run(f, ["--spill"]);
  assert.deepEqual(report.tasks.map((t) => t.id), [f.ids.c]);
  assert.equal(report.tally.closed, 1, report.stopped);
  assert.equal(statusOf(f.backlog, f.ids.c), "done");
  assert.equal(statusOf(f.backlog, f.ids.a), "in_progress", "the claimed task was touched");
  // With wave 2 closed there is no later wave to spill into, and wave 1 is
  // still the one being waited for.
  assert.equal(report.stopped,
    "plan wave 1 (First) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
      " — claimed in another tree or session: " + f.ids.a);
});

test("--spill into a wave with nothing free says so", () => {
  const f = tree({
    setup: (t) => {
      claimedHere(t);
      setField(t.backlog, t.ids.c, "blocked_by", "[" + t.ids.a + "]");
    },
  });
  const report = run(f, ["--spill"]);
  assert.equal(report.tally.taken, 0);
  assert.equal(report.stopped,
    "plan wave 1 (First) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
      " — claimed in another tree or session: " + f.ids.a +
      "; `--spill` drew from wave 2 (Second) and none of its tasks was free to take");
  // The field names the WAITING wave, not wave 2 the run drew from.
  assert.deepEqual(report.planWaiting, {
    kind: "wave-claimed-elsewhere", wave: 1, name: "First",
    claimedElsewhere: [f.ids.a], awaitingMerge: [], waitingBehind: [], waitingConflict: [],
  });
});

test("--spill is refused without --plan and with --dry-run, and run --help declares it", () => {
  const env = { ...process.env, NO_COLOR: "1" };
  const alone = cli(["run", "--spill", "--agent", "true"], env);
  assert.equal(alone.code, 2, alone.out + alone.err);
  assert.match(alone.err, /`--spill` with no `--plan`/);
  assert.match(alone.err, /It lets `--plan` draw from the next wave while the active one waits on other/);
  assert.match(alone.err, /trees; on its own there is no wave to spill out of\./);
  const dry = cli(["run", "--plan", "--spill", "--dry-run"], env);
  assert.equal(dry.code, 2, dry.out + dry.err);
  assert.match(dry.err, /`--dry-run` claims nothing, so --spill has nothing to act on/);
  // The line that refuses it refuses every flag that acts on the live loop,
  // and names each one it was given.
  for (const [flags, named] of [
    [["--before-next", "true"], "--before-next"],
    [["--commit-state"], "--commit-state"],
    [["--wait", "1", "--wait-max", "5"], "--wait and --wait-max"],
  ]) {
    const live = cli(["run", "--dry-run"].concat(flags), env);
    assert.equal(live.code, 2, live.out + live.err);
    assert.match(live.err, new RegExp("`--dry-run` claims nothing, so " + named + " has nothing to act on"));
  }
  const stop = cli(["run", "--stop", "--spill"], env);
  assert.equal(stop.code, 2, stop.out + stop.err);
  const unknown = cli(["run", "--spil"], env);
  assert.equal(unknown.code, 2, unknown.out + unknown.err);
  assert.match(unknown.err, /available: .*--wait-max --spill\b/);
  const help = cli(["run", "--help"], env);
  assert.equal(help.code, 0, help.err);
  assert.match(help.out, /\[--plan \[--spill\]\]/);
  assert.match(help.out, /--spill is passed on to `next`/);
});

// ── The sentence, from `next`'s answer alone ───────────────────────────────

function answer(refusalKind, plan) {
  return {
    refusalKind,
    plan: {
      wave: 1, name: "First", scheduled: 3, open: 3, skippedOutsideWave: 0, skippedUnplanned: 0, spill: null,
      claimedElsewhere: [], awaitingMerge: [], waitingBehind: [], ...plan,
    },
  };
}

test("planWaiting: only the two waiting kinds", () => {
  assert.equal(planWaiting(answer("wave-claimed-elsewhere")), "wave-claimed-elsewhere");
  assert.equal(planWaiting(answer("wave-awaits-merge")), "wave-awaits-merge");
  assert.equal(planWaiting(answer("nothing-to-take")), null);
  assert.equal(planWaiting({ refusalKind: "stop-requested" }), null);
  assert.equal(planWaiting(null), null);
  assert.equal(planWaiting({}), null);
});

test("planStop names every id a waiting wave waits on, then what it stepped over", () => {
  assert.equal(planStop(answer("wave-claimed-elsewhere", {
    claimedElsewhere: ["X-1", "X-4"], awaitingMerge: ["X-2"], waitingBehind: ["X-3"], waitingConflict: ["X-5"],
    skippedOutsideWave: 3, skippedUnplanned: 1,
  })), "plan wave 1 (First) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
    " — claimed in another tree or session: X-1, X-4; closed on a branch not merged here: X-2" +
    "; blocked only by those: X-3; held back only by a conflict group those hold: X-5; 2 open tasks in later waves are not reached yet" +
    "; 1 open task the plan does not schedule was left alone");

  assert.equal(planStop(answer("wave-awaits-merge", {
    name: "", awaitingMerge: ["X-2"], skippedOutsideWave: 1, skippedUnplanned: 0,
  })), "plan wave 1 (unnamed) is waiting on a merge (wave-awaits-merge) — closed on a branch not merged here: X-2" +
    "; 1 open task in later waves is not reached yet");

  assert.equal(planStop(answer("wave-awaits-merge", { awaitingMerge: ["X-2"], skippedUnplanned: 2, skippedOutsideWave: 2 })),
    "plan wave 1 (First) is waiting on a merge (wave-awaits-merge) — closed on a branch not merged here: X-2" +
      "; 2 open tasks the plan does not schedule were left alone");
});

test("planStop under --spill names the waiting wave, not the one drawn from", () => {
  // `plan.wave` and the counts describe wave 2, the one drawn from; its
  // `skippedOutsideWave` includes wave 1, so no "later waves" clause is built.
  const spilled = answer("wave-claimed-elsewhere", {
    wave: 2, name: "Second", skippedOutsideWave: 4, skippedUnplanned: 0, claimedElsewhere: ["X-1"],
    spill: { from: 1, fromName: "First", refusalKind: "wave-claimed-elsewhere", claimedElsewhere: ["X-1"],
      awaitingMerge: [], wave: 2, name: "Second" },
  });
  assert.equal(planStop(spilled),
    "plan wave 1 (First) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
      " — claimed in another tree or session: X-1; `--spill` drew from wave 2 (Second) and none of its tasks" +
      " was free to take");

  // No later wave held open work: nothing was drawn, and `plan` still
  // describes the waiting wave.
  const nowhere = answer("wave-awaits-merge", {
    wave: 1, name: "First", awaitingMerge: ["X-1"],
    spill: { from: 1, fromName: "First", refusalKind: "wave-awaits-merge", claimedElsewhere: [],
      awaitingMerge: ["X-1"], wave: null, name: "" },
  });
  assert.equal(planStop(nowhere),
    "plan wave 1 (First) is waiting on a merge (wave-awaits-merge) — closed on a branch not merged here: X-1");
});

test("planStop with no id lists or wave names still says what it knows", () => {
  // An answer that carries a waiting kind and no id lists: the sentence names
  // the wave and the kind, and nothing after them.
  assert.equal(planStop({ refusalKind: "wave-awaits-merge", plan: { wave: 1, name: "First" } }),
    "plan wave 1 (First) is waiting on a merge (wave-awaits-merge)");
  assert.equal(planStop(answer("wave-claimed-elsewhere", {
    wave: 2, name: "", claimedElsewhere: ["X-1"],
    spill: { from: 1, fromName: "", refusalKind: "wave-claimed-elsewhere", claimedElsewhere: ["X-1"],
      awaitingMerge: [], wave: 2, name: "" },
  })), "plan wave 1 (unnamed) is waiting on claims held in another tree or session (wave-claimed-elsewhere)" +
    " — claimed in another tree or session: X-1; `--spill` drew from wave 2 (unnamed) and none of its tasks" +
    " was free to take");
});

test("planWaitingWave: the waiting wave's kind and ids, and null for every other answer", () => {
  assert.deepEqual(planWaitingWave(answer("wave-claimed-elsewhere", {
    claimedElsewhere: ["X-1"], awaitingMerge: ["X-2"], waitingBehind: ["X-3"], waitingConflict: ["X-5"],
  })), {
    kind: "wave-claimed-elsewhere", wave: 1, name: "First",
    claimedElsewhere: ["X-1"], awaitingMerge: ["X-2"], waitingBehind: ["X-3"], waitingConflict: ["X-5"],
  });
  // Under --spill `plan.wave` is the wave drawn from; the field names the one waited on.
  assert.deepEqual(planWaitingWave(answer("wave-awaits-merge", {
    wave: 2, name: "Second", awaitingMerge: ["X-2"],
    spill: { from: 1, fromName: "First", refusalKind: "wave-awaits-merge", claimedElsewhere: [],
      awaitingMerge: ["X-2"], wave: 2, name: "Second" },
  })), {
    kind: "wave-awaits-merge", wave: 1, name: "First",
    claimedElsewhere: [], awaitingMerge: ["X-2"], waitingBehind: [], waitingConflict: [],
  });
  // An answer with the kind and no id lists still gives lists, never undefined.
  assert.deepEqual(planWaitingWave({ refusalKind: "wave-awaits-merge", plan: { wave: 3 } }), {
    kind: "wave-awaits-merge", wave: 3, name: "", claimedElsewhere: [], awaitingMerge: [], waitingBehind: [],
    waitingConflict: [],
  });
  assert.equal(planWaitingWave(answer("nothing-to-take")), null);
  assert.equal(planWaitingWave({ refusalKind: "wave-claimed-elsewhere", plan: null }), null);
  assert.equal(planWaitingWave(null), null);
});

test("planStop keeps the old sentence for nothing-to-take, and for a finished plan", () => {
  assert.equal(planStop(answer("nothing-to-take", { open: 1, scheduled: 2, skippedOutsideWave: 1 })),
    "plan wave 1 (First) is not finished — 1 of 2 tasks in it is still open and none was free to take" +
      ", 1 open task in later waves is not reached yet");
  assert.equal(planStop(answer("nothing-to-take", { open: 2, scheduled: 2 })),
    "plan wave 1 (First) is not finished — 2 of 2 tasks in it are still open and none was free to take");
  assert.equal(planStop(answer("nothing-to-take", { wave: null, skippedUnplanned: 1 })),
    "every wave of the plan is finished, and 1 open task the plan does not schedule was left alone");
  assert.equal(planStop({ refusalKind: "nothing-to-take", plan: null }), null);
});
