/**
 * A blocked wave task the caller's filters reject does not make the wave wait
 * (TL-741).
 *
 * WHAT WAS WRONG. `waveWaiting` (TL-683) counted an open task of the active
 * wave as `behind` when every unresolved `blocked_by` was itself waiting work,
 * without asking whether the caller's role, executor or size filters admit it.
 * A wave [A claimed elsewhere, B blocked by A, role: review] asked by
 * `next --plan --role dev` was therefore `wave-claimed-elsewhere`, and
 * `run --plan --wait --role dev` polled a wave that could never hand that
 * caller anything.
 *
 * WHAT EACH CASE PROVES:
 *
 *   the filter rejects  — asked with `--role dev`, the wave is
 *                         `nothing-to-take` and names nobody as waiting.
 *   the filter admits   — the same tree asked with `--role review` is
 *                         `wave-claimed-elsewhere`, B under `waitingBehind`:
 *                         the positive control that the tree IS the waiting
 *                         case, so the first answer comes from the filter.
 *   a declared block    — b in the protected `blocked` status, which only the
 *                         unblocked pool hands out, is judged by the same
 *                         filter: rejected by `dev`, waiting for `review`.
 *   the pure cases      — `waveWaiting` with an `admitted` set leaves a task
 *                         outside it, and the chain behind it, in the rest;
 *                         without one it judges blockers alone, as before.
 *
 * A is in progress in THIS tree under another actor: no other branch reports
 * anything, so only the blocker and the role decide what B is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";
import { waveWaiting } from "../next-task.mjs";

isolateHome("plan-waiting-behind-role");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const RUN_ACTOR = "agent:worker";
const OTHER_ACTOR = "agent:other";
let counter = 0;

function cli(args, env) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 120_000, env });
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

/**
 * A repository on `main` with one wave [a, b]: a in progress under another
 * actor, b pending, blocked by a, with role `review`.
 */
function tree({ status = null } = {}) {
  const dir = fixtureDir(join(tmpdir(), "branchling-plan-waiting-behind-role-" + counter++ + "-"));
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
  for (const key of ["a", "b"]) {
    const r = cli(["new", "--dir", backlog, "--title", "Fixture task " + key, "--priority", "P1"], env);
    assert.equal(r.code, 0, r.err);
    const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture task got no id: " + r.out);
    ids[key] = id;
  }
  setField(backlog, ids.a, "status", "in_progress");
  setField(backlog, ids.a, "owner", OTHER_ACTOR);
  setField(backlog, ids.b, "blocked_by", "[" + ids.a + "]");
  setField(backlog, ids.b, "role", "review");
  if (status) setField(backlog, ids.b, "status", status);
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-14", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + ids.a + ", " + ids.b + "]",
    "",
  ].join("\n"), "utf8");
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);
  return { dir, repoRoot, backlog, env, ids };
}

function next(f, extra) {
  const r = cli(["next", "--dir", f.backlog, "--actor", RUN_ACTOR, "--plan", "--dry-run", "--json"].concat(extra), f.env);
  let json = null;
  try { json = JSON.parse(r.out); } catch { /* asserted by the caller */ }
  return { ...r, json };
}

// ── Through the CLI ────────────────────────────────────────────────────────

test("a blocked wave task the caller's role rejects does not make the wave waiting", () => {
  const f = tree();
  const r = next(f, ["--role", "dev"]);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.json.refusalKind, "nothing-to-take");
  assert.equal(r.json.refusal, "nothing to take");
  assert.deepEqual(r.json.plan.waitingBehind, []);
  assert.deepEqual(r.json.plan.claimedElsewhere, []);
});

test("control: the same tree asked by the role the blocked task needs is waiting behind its blocker", () => {
  const f = tree();
  const r = next(f, ["--role", "review"]);
  assert.equal(r.code, 3, r.out + r.err);
  assert.equal(r.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(r.json.plan.claimedElsewhere, [f.ids.a]);
  assert.deepEqual(r.json.plan.waitingBehind, [f.ids.b]);
});

test("a blocked wave task in the protected `blocked` status is judged by the same filters", () => {
  const f = tree({ status: "blocked" });
  const rejected = next(f, ["--role", "dev"]);
  assert.equal(rejected.code, 3, rejected.out + rejected.err);
  assert.equal(rejected.json.refusalKind, "nothing-to-take");
  assert.deepEqual(rejected.json.plan.waitingBehind, []);
  const admitted = next(f, ["--role", "review"]);
  assert.equal(admitted.code, 3, admitted.out + admitted.err);
  assert.equal(admitted.json.refusalKind, "wave-claimed-elsewhere");
  assert.deepEqual(admitted.json.plan.waitingBehind, [f.ids.b]);
});

// ── waveWaiting, pure ──────────────────────────────────────────────────────

const CONFIG = { archivedStatuses: ["done", "cancelled"], inProgressStatus: "in_progress" };

function rec(id, status, extra = {}) {
  return { id, status, blocked_by: [], elsewhere: [], ...extra };
}

test("waveWaiting: a blocked task outside `admitted` and the chain behind it stay in the rest", () => {
  const records = [
    rec("X-1", "in_progress"),
    rec("X-2", "pending", { blocked_by: ["X-1"] }),
    rec("X-3", "pending", { blocked_by: ["X-2"] }),
  ];
  const ids = ["X-1", "X-2", "X-3"];
  const empty = { kind: null, claimed: [], awaitingMerge: [], behind: [], conflict: [] };

  // X-2 is not admitted: neither it nor X-3, which waits on it, is behind.
  assert.deepEqual(waveWaiting(ids, records, CONFIG, [], [], new Set(["X-3"])), empty);

  // Both admitted: the whole chain waits.
  const both = waveWaiting(ids, records, CONFIG, [], [], new Set(["X-2", "X-3"]));
  assert.equal(both.kind, "wave-claimed-elsewhere");
  assert.deepEqual(both.behind, ["X-2", "X-3"]);

  // No set at all: the blockers alone decide, as before TL-741.
  assert.deepEqual(waveWaiting(ids, records, CONFIG, []).behind, ["X-2", "X-3"]);
});
