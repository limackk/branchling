/**
 * `plan` withholds a task another tree of this clone has already moved on
 * (TL-664).
 *
 * WHAT WAS MEASURED. On 2026-11-08, with four loops running, `plan` in one
 * loop worktree listed six tasks of the active wave as next up, while `run
 * --dry-run --plan` in the same tree said none of them were its to take: they
 * were claimed in sibling worktrees. The dispatcher reads the rest of the clone
 * (`readDispatchRecords`, TL-133); `plan` read only the task files of its own
 * tree, so the two answered about two different backlogs.
 *
 * THE FIXTURE IS THE SHAPE THAT HAPPENED: one clone, two worktrees, and a
 * claim that exists only as an uncommitted edit in the second — which is what
 * `take` leaves behind in a loop's tree. The claim is written to the file, not
 * made with `take`, so no reservation can do the excluding in the scan's place.
 *
 * EVERY CLAIM HAS A CONTROL: the same tree before the claim lists the task as
 * next up and lets the projection walk past the wave, so an answer that
 * withholds everything cannot pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";
import { describeHold, unattendedHold } from "../plan.mjs";

isolateHome("plan-claimed-elsewhere");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env, cwd });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function vcs(cwd, args) {
  return execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" });
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
 * A clone whose wave 1 holds `claimed` and `free`, and whose wave 2 holds
 * `behind`; a second worktree on its own branch is checked out beside it.
 */
function clone() {
  const dir = fixtureDir(join(tmpdir(), "branchling-plan-elsewhere-" + counter++ + "-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = {};
  for (const [key, title] of [
    ["claimed", "Work a sibling loop has already claimed"],
    ["free", "Work nobody has touched"],
    ["behind", "The work of the next wave"],
  ]) {
    const r = cli(["new", "--dir", backlog, "--title", title], env);
    assert.equal(r.code, 0, r.err);
    ids[key] = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(ids[key], "the fixture task got no id: " + r.out);
  }
  writeFileSync(join(backlog, "plan.yaml"), [
    "updated: 2026-11-08", 'rationale: "fixture"', "waves:",
    '  - name: "First"', "    tasks: [" + ids.claimed + ", " + ids.free + "]",
    '  - name: "Second"', "    tasks: [" + ids.behind + "]", "",
  ].join("\n"), "utf8");
  vcs(repo, ["init", "-q", "-b", "main"]);
  vcs(repo, ["add", "-A"]);
  vcs(repo, ["commit", "-qm", "seed"]);
  const sibling = join(dir, "sibling");
  vcs(repo, ["worktree", "add", "-q", "-b", "sibling", sibling]);
  return { repo, backlog, sibling, siblingBacklog: join(sibling, "backlog"), env, ids };
}

/** The claim a loop's `take` leaves in its own tree: an uncommitted edit. */
function claimInSibling(f) {
  setField(f.siblingBacklog, f.ids.claimed, "status", "in_progress");
  setField(f.siblingBacklog, f.ids.claimed, "owner", "agent:sibling");
}

function planJson(f) {
  const r = cli(["plan", "--dir", f.backlog, "--json"], f.env, f.repo);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}

function planText(f) {
  const r = cli(["plan", "--dir", f.backlog], f.env, f.repo);
  assert.equal(r.code, 0, r.out + r.err);
  return r.out;
}

function dryRun(f) {
  const r = cli(["run", "--dir", f.backlog, "--dry-run", "--plan", "--actor", "agent:mine", "--json"], f.env, f.repo);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}

test("POSITIVE CONTROL: with no claim elsewhere the task is next up and the projection walks past its wave", () => {
  const f = clone();
  const state = planJson(f);
  assert.deepEqual(state.nextUp.map((e) => e.ids[0]), [f.ids.claimed, f.ids.free]);
  assert.equal(state.waves[0].tasks.find((e) => e.id === f.ids.claimed).hold, null);
  assert.doesNotMatch(planText(f), /withheld/);

  const dry = dryRun(f);
  assert.deepEqual(dry.order.map((o) => o.id), [f.ids.claimed, f.ids.free, f.ids.behind]);
  assert.equal(dry.stoppedAt, null);
});

test("plan withholds a task another worktree has claimed, and names the tree and the status", () => {
  const f = clone();
  claimInSibling(f);
  const state = planJson(f);
  assert.deepEqual(state.nextUp.map((e) => e.ids[0]), [f.ids.free],
    "next up still lists a task `next` skips because a sibling tree claimed it");
  const hold = state.waves[0].tasks.find((e) => e.id === f.ids.claimed).hold;
  assert.ok(hold, "the claimed task carries no hold");
  assert.equal(hold.kind, "claimed-elsewhere");
  assert.equal(hold.startable, false);
  assert.ok(hold.elsewhere.some((o) => o.status === "in_progress" && o.kind === "worktree"), JSON.stringify(hold));
  assert.equal(state.waves[0].held, false, "one free task is left, so the wave is not held");

  const text = planText(f);
  const section = text.slice(text.indexOf("next up"), text.indexOf("in progress:"));
  assert.match(section, /withheld — `next` hands these out to nobody now:/, section);
  assert.match(section, new RegExp(f.ids.claimed + "  already moved on in another tree — .*sibling: in_progress"), section);
});

test("plan and run --dry-run --plan agree about where the projection stops, in one wording", () => {
  const f = clone();
  claimInSibling(f);
  const dry = dryRun(f);
  assert.deepEqual(dry.order.map((o) => o.id), [f.ids.free], "the projection walked past a wave it cannot finish");
  assert.equal(dry.stoppedAt.wave, 1);
  assert.deepEqual(dry.stoppedAt.holds.map((h) => h.id), [f.ids.claimed]);

  const text = planText(f);
  assert.match(text, /next up \(wave 1 — First\)/, "plan names a different active wave than the projection stops at");
  for (const h of dry.stoppedAt.holds) {
    assert.equal(h.kind, "claimed-elsewhere");
    assert.ok(text.includes(h.id + "  " + h.reason), "plan does not say what the run says about " +
      h.id + ": " + h.reason + "\n" + text);
  }
});

test("a wave whose every open task is claimed elsewhere is held, and lists no next up", () => {
  const f = clone();
  claimInSibling(f);
  setField(f.siblingBacklog, f.ids.free, "status", "done");
  const state = planJson(f);
  assert.deepEqual(state.nextUp, []);
  assert.equal(state.waves[0].held, true, JSON.stringify(state.waves[0]));
  const kinds = state.waves[0].tasks.map((e) => e.hold && e.hold.kind);
  assert.deepEqual(kinds, ["claimed-elsewhere", "claimed-elsewhere"]);

  const dry = dryRun(f);
  assert.deepEqual(dry.order, []);
  assert.equal(dry.stoppedAt.held, true);
});

// ── The predicate against the dispatcher's own rule ───────────────────────

const CONFIG = {
  archivedStatuses: ["done", "cancelled"],
  activeStatuses: ["pending", "in_progress", "awaiting_vouch", "blocked"],
  inProgressStatus: "in_progress",
  awaitingVouchStatus: "awaiting_vouch",
  reasonRequiredStatuses: ["blocked", "cancelled"],
  abandonedAfterDays: 3,
  now: Date.parse("2026-11-08T12:00:00Z"),
};
const task = (fields) => ({ id: "TL-1", status: "pending", blocked_by: [], history: [], ...fields });
const seen = (status, source = "feature") => ({ status, source, kind: "branch" });

test("only a status `next` would not hand out holds the task; a queue status elsewhere does not", () => {
  const byId = new Map();
  assert.equal(unattendedHold(task({ elsewhere: [] }), byId, CONFIG), null);
  // A record nobody attached a scan to — `plan-write`'s own `--json` — is no hold.
  assert.equal(unattendedHold(task({}), byId, CONFIG), null);
  // `pending` and a second queue status are both work `next` hands out.
  const queue = { ...CONFIG, activeStatuses: ["pending", "ready", "in_progress"] };
  assert.equal(unattendedHold(task({ elsewhere: [seen("ready")] }), byId, queue), null);
  // Every status `queueStatuses` leaves out — the claim, the vouch, a protected
  // one — and a closed one.
  for (const status of ["in_progress", "awaiting_vouch", "blocked", "done"]) {
    const hold = unattendedHold(task({ elsewhere: [seen(status)] }), byId, CONFIG);
    assert.equal(hold && hold.kind, "claimed-elsewhere", status);
    assert.deepEqual(hold.elsewhere, [{ source: "feature", kind: "branch", status }]);
    assert.equal(describeHold(hold), "already moved on in another tree — feature: " + status);
  }
  // Only the observations that hold are named; a queue status beside them is not.
  const two = unattendedHold(task({ elsewhere: [seen("ready", "a"), seen("done", "b")] }), byId, queue);
  assert.equal(describeHold(two), "already moved on in another tree — b: done");
  const both = unattendedHold(task({ elsewhere: [seen("done", "a"), seen("in_progress", "b")] }), byId, CONFIG);
  assert.equal(describeHold(both), "already moved on in another tree — a: done, b: in_progress");
});

test("a claim old enough to reclaim is held by any disagreement, as the reclaim path holds it", () => {
  const stale = task({ status: "in_progress", updated: "2026-10-01", elsewhere: [seen("pending")] });
  assert.equal(unattendedHold(stale, new Map(), CONFIG).kind, "claimed-elsewhere");
  // CONTROL: with nothing reported elsewhere the same claim is reclaimable.
  assert.equal(unattendedHold({ ...stale, elsewhere: [] }, new Map(), CONFIG), null);
});

test("a caller that cannot name the statuses `next` hands out gets no hold from the scan", () => {
  const { activeStatuses, ...thin } = CONFIG;
  assert.ok(activeStatuses.length);
  assert.equal(unattendedHold(task({ elsewhere: [seen("in_progress")] }), new Map(), thin), null);
});
