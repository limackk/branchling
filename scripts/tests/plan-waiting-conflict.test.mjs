/**
 * A wave task held back only by a waiting task's conflict group waits with it
 * (TL-734).
 *
 * WHAT WAS WRONG. `waveWaiting` (TL-683) accounted for each open task of the
 * active wave as awaiting a merge, claimed, or behind a blocker that is itself
 * waiting, and called anything else `nothing-to-take`. It did not consider the
 * conflict-group hold `selectCandidates` applies (TL-492). A wave [A, B] with A
 * in progress under another actor and B pending in A's conflict group was
 * therefore answered `nothing-to-take`, although B is handed out the moment A
 * is closed and merged — and since TL-707 `run --plan --wait` reads that kind
 * alone, so the run ended at once instead of polling.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the hold waits        — the wave is `wave-claimed-elsewhere`, B is named
 *                           under `waitingConflict` and in the details.
 *   run polls it          — `run --plan --wait` polls that wave and reports
 *                           B in `planWaiting.waitingConflict`.
 *   a role control        — the same tree, with B also held back by a role the
 *                           caller does not serve, stays `nothing-to-take`:
 *                           the hold is not "only" the conflict group.
 *   an outside holder     — a group held by a task of a LATER wave keeps the
 *                           answer at `nothing-to-take`; nothing in the plan
 *                           says when that holder closes.
 *   the pure cases        — a chain behind a conflict-held task waits too, and
 *                           a holder that is not waiting work does not.
 *
 * The holder is in progress in THIS tree under another actor, the state
 * run-plan-waiting.test.mjs uses: no other branch reports anything, so only
 * the conflict hold can keep B from being handed out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, posixPath, SCRIPTS_DIR } from "./_repo.mjs";
import { waveWaiting } from "../next-task.mjs";

isolateHome("plan-waiting-conflict");

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

/**
 * A repository on `main` with tasks a, b and c, all in conflict group `core`.
 * Wave 1 "First" holds `first` (default [a, b]), wave 2 "Second" the rest.
 * Each task's contract is `test -f <id>.done`, which the worker satisfies.
 * `setup(f)` edits the tree before the seed commit.
 */
function tree({ setup, first = ["a", "b"] } = {}) {
  const dir = fixtureDir(join(tmpdir(), "branchling-plan-waiting-conflict-" + counter++ + "-"));
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, " + RUN_ACTOR + ", " + OTHER_ACTOR + "]") +
    "\nroles: [dev, review]\n", "utf8");
  const ids = {};
  for (const key of ["a", "b", "c"]) {
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
    setField(backlog, id, "conflict_group", "[core]");
  }
  const second = ["a", "b", "c"].filter((k) => !first.includes(k));
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-14", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + first.map((k) => ids[k]).join(", ") + "]",
    '  - name: "Second"', "    tasks: [" + second.map((k) => ids[k]).join(", ") + "]",
    "",
  ].join("\n"), "utf8");
  const f = { dir, repoRoot, backlog, env, ids };
  if (setup) setup(f);
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);
  return f;
}

/** `key` is in progress in THIS tree under another actor. */
function claimedHere(f, key) {
  setField(f.backlog, f.ids[key], "status", "in_progress");
  setField(f.backlog, f.ids[key], "owner", OTHER_ACTOR);
}

function next(f, extra = []) {
  const r = cli(["next", "--dir", f.backlog, "--actor", RUN_ACTOR, "--plan", "--dry-run", "--json"].concat(extra), f.env);
  let json = null;
  try { json = JSON.parse(r.out); } catch { /* asserted by the caller */ }
  return { ...r, json };
}

function worker(dir) {
  const p = join(dir, "agent.sh");
  writeFileSync(p, "#!/bin/sh\n" + [
    'id=$(grep -m1 "^id: " | sed "s/^id: //")',
    'touch "$id.done"',
    'echo "worked $id"',
  ].join("\n") + "\n", "utf8");
  chmodSync(p, 0o755);
  return posixPath(p);
}

// ── The hold waits ─────────────────────────────────────────────────────────

test("a wave task held back only by a waiting task's conflict group makes the wave waiting", () => {
  const f = tree({ setup: (t) => claimedHere(t, "a") });
  const r = next(f);
  assert.equal(r.code, 3, r.out + r.err);
  // THE CASE IT CLAIMS TO BE: b was held back by the group, and by nothing else.
  assert.deepEqual(r.json.skippedConflict.map((s) => s.id), [f.ids.b]);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.claimedElsewhere, [f.ids.a]);
  assert.deepEqual(r.json.plan.waitingConflict, [f.ids.b]);
  assert.deepEqual(r.json.plan.waitingBehind, []);
  assert.deepEqual(r.json.details.slice(0, 3), [
    "claimed in another tree or session: " + f.ids.a,
    "held back only by a conflict group those hold: " + f.ids.b,
    "ask again when those claims are closed and merged — `--spill` draws from the next wave meanwhile",
  ]);
});

test("run --plan --wait polls a wave held back only by a waiting task's conflict group", () => {
  const f = tree({ setup: (t) => claimedHere(t, "a") });
  const r = cli(["run", "--dir", f.backlog, "--actor", RUN_ACTOR, "--agent", worker(f.dir), "--plan", "--json",
    "--wait", "1", "--wait-max", "2"], f.env, { cwd: f.repoRoot });
  assert.equal(r.code, 0, r.out + r.err);
  const report = JSON.parse(r.out);
  assert.equal(report.tally.taken, 0);
  assert.ok(report.waited.polls >= 1, "the run did not poll the waiting wave: " + report.stopped);
  assert.equal(report.waited.gaveUp, true);
  assert.deepEqual(report.planWaiting, {
    kind: "wave-claimed-elsewhere", wave: 1, name: "First",
    claimedElsewhere: [f.ids.a], awaitingMerge: [], waitingBehind: [], waitingConflict: [f.ids.b],
  });
  assert.match(report.stopped, new RegExp("held back only by a conflict group those hold: " + f.ids.b));
  assert.equal(statusOf(f.backlog, f.ids.b), "pending");
});

// ── The controls ───────────────────────────────────────────────────────────

test("control: a wave task held back by a role as well as the group stays nothing to take", () => {
  const f = tree({
    setup: (t) => {
      claimedHere(t, "a");
      setField(t.backlog, t.ids.b, "role", "review");
    },
  });
  const r = next(f, ["--role", "dev"]);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.json.refusalKind, "nothing-to-take");
  assert.deepEqual(r.json.skippedConflict, []);
  // The same tree, asked by a caller the role admits, is the waiting case.
  const admitted = next(f, ["--role", "review"]);
  assert.equal(admitted.code, 3, admitted.out + admitted.err);
  assert.equal(admitted.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(admitted.json.plan.waitingConflict, [f.ids.b]);
});

test("control: a conflict group held by a task outside the active wave stays nothing to take", () => {
  // Wave 1 is [b] alone; c, in wave 2, holds the group.
  const f = tree({ first: ["b"], setup: (t) => claimedHere(t, "c") });
  const r = next(f);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.json.plan.wave, 1);
  assert.deepEqual(r.json.skippedConflict.map((s) => [s.id, s.heldBy.map((h) => h.id)]), [[f.ids.b, [f.ids.c]]]);
  assert.equal(r.json.refusalKind, "nothing-to-take");
});

// ── waveWaiting, pure ──────────────────────────────────────────────────────

const CONFIG = { archivedStatuses: ["done", "cancelled"], inProgressStatus: "in_progress" };

function rec(id, status, extra = {}) {
  return { id, status, blocked_by: [], elsewhere: [], ...extra };
}

test("waveWaiting: a chain behind a conflict-held task waits; a holder that is not waiting work does not", () => {
  const records = [
    rec("X-1", "in_progress"),
    rec("X-2", "pending"),
    rec("X-3", "pending", { blocked_by: ["X-2"] }),
    rec("X-9", "pending"),
  ];
  const held = [{ id: "X-2", heldBy: [{ id: "X-1" }] }];
  const waiting = waveWaiting(["X-3", "X-2", "X-1"], records, CONFIG, [], held);
  assert.equal(waiting.kind, "wave-claimed-elsewhere");
  assert.deepEqual(waiting.claimed, ["X-1"]);
  assert.deepEqual(waiting.conflict, ["X-2"]);
  assert.deepEqual(waiting.behind, ["X-3"]);

  // Without the conflict entry the same wave is not waiting: the pass is what
  // accounts for X-2.
  assert.equal(waveWaiting(["X-3", "X-2", "X-1"], records, CONFIG, []).kind, null);

  // A holder outside the wave: X-9 is not waiting work of this wave.
  const outside = waveWaiting(["X-2", "X-1"], records, CONFIG, [], [{ id: "X-2", heldBy: [{ id: "X-1" }, { id: "X-9" }] }]);
  assert.deepEqual(outside, { kind: null, claimed: [], awaitingMerge: [], behind: [], conflict: [] });
});
