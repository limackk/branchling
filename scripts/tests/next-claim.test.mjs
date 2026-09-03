/**
 * Reclaiming an abandoned claim, and the loop contract around it (TL-104).
 *
 * `next.test.mjs` proves the reservation excludes; this file proves the OTHER
 * half of an unattended queue — that work whose session never came back is not
 * lost forever, and that nothing else is mistaken for it.
 *
 * WHAT EACH PART NEEDS A POSITIVE CONTROL FOR. Every assertion here is of the
 * form "the task was NOT handed out", which is the easiest kind of test to pass
 * for the wrong reason: an empty fixture, a filter that excludes everything, a
 * command that refuses unconditionally would all be green. So each refusal is
 * paired with the one change that must make it succeed — usually the window, or
 * the date — and the pair is what carries the proof.
 *
 * The state directory is redirected into a temporary tree in EVERY test: a
 * suite writing to the user's real one would leak locks between runs and could
 * refuse a task in a real session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireLock } from "../lock.mjs";
import { loadConfig } from "../config.mjs";
import { isAbandoned, selectCandidates } from "../next-task.mjs";
import { reclaimReason } from "../take-task.mjs";
import { readTaskRecords } from "../task-select.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("next-claim");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with one task per priority given, all pending. */
function fixture(priorities = ["P2"]) {
  const dir = tmp("reclaim");
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = priorities.map((p, i) => {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1), "--priority", p], env);
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  });
  return { dir, backlog, state, env, ids };
}

function taskFile(backlog, id) {
  const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  return join(backlog, "tasks", name);
}

function taskText(backlog, id) {
  return readFileSync(taskFile(backlog, id), "utf8");
}

function field(text, key) {
  const m = text.match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].trim() : null;
}

/** Rewrite one frontmatter field in place — the only way to fabricate a claim
 *  that stopped moving days ago without waiting days for it. */
function setField(backlog, id, key, value) {
  const file = taskFile(backlog, id);
  const text = readFileSync(file, "utf8");
  const at = new RegExp("^" + key + ": .*$", "m");
  assert.match(text, at, "the field `" + key + "` is not in " + id);
  writeFileSync(file, text.replace(at, key + ": " + value), "utf8");
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Configure the window. `0` is the default and means never. */
function setWindow(backlog, days) {
  const path = join(backlog, "config.yaml");
  const text = readFileSync(path, "utf8");
  const next = text.replace(/^abandoned_after_days: .*$/m, "abandoned_after_days: " + days);
  assert.notEqual(next, text, "the template no longer carries `abandoned_after_days`");
  writeFileSync(path, next, "utf8");
}

function historyEntries(backlog, id) {
  const file = join(backlog, "history", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** A task already claimed by somebody else, `n` days ago. */
function claimedDaysAgo(backlog, id, owner, n) {
  setField(backlog, id, "status", "in_progress");
  setField(backlog, id, "owner", owner);
  setField(backlog, id, "updated", daysAgo(n));
}

// ── the window is the project's, and off by default ───────────────────────

test("the default is never: a claim left for a year is still not handed out", () => {
  const { backlog, env, ids } = fixture();
  claimedDaysAgo(backlog, ids[0], "agent:gone", 365);

  const r = run(["next", "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(r.status, 3, "an old claim was reclaimed with no window configured");
  assert.match(r.stdout, /abandoned_after_days/,
    "the empty queue does not say that reclaiming is switched off");
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:gone");

  // POSITIVE CONTROL: the refusal is the WINDOW's doing, not something about
  // this task. State a window it outlives and the very same call succeeds.
  setWindow(backlog, 3);
  const second = run(["next", "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:b");
});

test("a claim inside the window is left alone", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 7);
  claimedDaysAgo(backlog, ids[0], "agent:working", 2);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 3);
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:working");

  // POSITIVE CONTROL: one day past the window and it goes.
  claimedDaysAgo(backlog, ids[0], "agent:working", 8);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 0);
});

test("a claim with no readable date is never judged abandoned", () => {
  const config = { abandonedAfterDays: 1, inProgressStatus: "in_progress" };
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  for (const updated of ["", "yesterday", "2026-13-99", null]) {
    assert.equal(
      isAbandoned({ status: "in_progress", updated }, config, now), false,
      "a takeover on the strength of `" + updated + "` — no date is not an old date"
    );
  }
  // POSITIVE CONTROL: a readable old date IS abandoned, so the four above were
  // rejected for their dates and not by a predicate that always says no.
  assert.equal(isAbandoned({ status: "in_progress", updated: "2026-08-01" }, config, now), true);
  // And a status that was never a claim is not one either.
  assert.equal(isAbandoned({ status: "pending", updated: "2026-08-01" }, config, now), false);
});

test("the window is a whole number of days, and a negative one fails the config", () => {
  const { backlog } = fixture();
  setWindow(backlog, -1);
  assert.throws(() => loadConfig(backlog), /abandoned_after_days/,
    "a negative window would make every claim abandoned the moment it is made");
  setWindow(backlog, 3);
  assert.equal(loadConfig(backlog).abandonedAfterDays, 3);
});

// ── the order between the two groups IS the policy ─────────────────────────

test("untouched work is handed out before any reclaim, whatever the priority", () => {
  const { backlog, env, ids } = fixture(["P0", "P3"]);
  setWindow(backlog, 1);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 30); // the P0 is the abandoned one

  const config = loadConfig(backlog);
  const records = readTaskRecords(join(backlog, "tasks"), config.taskId.file);
  const { candidates, reclaimable } = selectCandidates(records, config, {
    status: null, priority: null, board: null, label: null, epic: null,
  }, Date.now());

  assert.deepEqual(candidates.map((t) => t.id), [ids[1], ids[0]],
    "an abandoned P0 outranked an untouched P3 — a certain duplicate traded for an uncertain rescue");
  assert.deepEqual([...reclaimable], [ids[0]]);
});

test("naming statuses excludes the reclaim group — the caller asked a question", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 1);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 30);

  const r = run(["next", "--dir", backlog, "--actor", "agent:b", "--status", "pending"], env);
  assert.equal(r.status, 3, "`--status pending` was answered with an in_progress task");

  // POSITIVE CONTROL: the same backlog, without the flag, hands it over.
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 0);
});

test("a blocked abandoned claim stays put until its blocker closes", () => {
  const { backlog, env, ids } = fixture(["P2", "P2"]);
  setWindow(backlog, 1);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 30);
  setField(backlog, ids[0], "blocked_by", "[" + ids[1] + "]");
  // The blocker itself is claimed by somebody live, so it is not a candidate.
  claimedDaysAgo(backlog, ids[1], "agent:live", 0);

  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 3,
    "a task whose blocker is open was dispatched because it happened to be stale");

  // POSITIVE CONTROL: close the blocker and the same task becomes takeable.
  setField(backlog, ids[1], "status", "done");
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 0);
});

// ── a live session outranks the guess ─────────────────────────────────────

test("a held lock beats the window: a running session is proof it is not abandoned", () => {
  const { backlog, state, env, ids } = fixture();
  setWindow(backlog, 1);
  claimedDaysAgo(backlog, ids[0], "agent:slow", 30);
  acquireLock({ root: backlog, taskId: ids[0], actor: "agent:slow", ttlMinutes: 600, env: { BACKLOG_STATE_DIR: state } });

  const r = run(["next", "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(r.status, 3, "a task a live session is holding was reclaimed under it");
  assert.match(r.stdout, /agent:slow/, "the empty queue does not say who is holding it");
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:slow");
});

// ── never quietly ──────────────────────────────────────────────────────────

test("the takeover names the previous owner in the history and on stdout", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 3);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 10);

  const r = run(["next", "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reclaimed from agent:gone/, "the takeover was silent on stdout");

  const owner = historyEntries(backlog, ids[0]).filter((e) => e.field === "owner").pop();
  assert.equal(owner.from, "agent:gone", "the history does not say whose claim this was");
  assert.equal(owner.to, "agent:b");
  assert.equal(owner.source, "reclaim", "a takeover is indistinguishable from an ordinary take");
  assert.match(owner.reason, /agent:gone/);
  assert.match(owner.reason, /abandoned_after_days/,
    "the reason states the verdict without the evidence behind it");
});

test("a stated reason wins over the generated one", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 3);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 10);

  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b", "--reason", "they left the team"], env).status, 0);
  const owner = historyEntries(backlog, ids[0]).filter((e) => e.field === "owner").pop();
  assert.equal(owner.reason, "they left the team");
});

test("the generated reason carries the evidence, not just the verdict", () => {
  const text = reclaimReason("agent:gone", "2026-08-01", 3);
  assert.match(text, /agent:gone/);
  assert.match(text, /2026-08-01/);
  assert.match(text, /abandoned_after_days 3/);
});

test("take alone never reclaims — the judgement belongs to the dispatcher", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 1);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 30);

  const r = run(["take", ids[0], "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(r.status, 1, "`take` handed a named task over somebody else's claim");
  assert.match(r.stderr, /agent:gone/);
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:gone");

  // POSITIVE CONTROL: `next`, which does judge, takes the very same task.
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 0);
});

// ── the loop contract ──────────────────────────────────────────────────────

test("an empty queue is exit 3 and a usage error is exit 2 — a loop can tell them apart", () => {
  const { backlog, env } = fixture([]);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b"], env).status, 3);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:b", "--nonsense"], env).status, 2);
  assert.equal(run(["next", "--dir", backlog, "--actor", "nonamespace"], env).status, 2);
});

test("--json reports the takeover without anybody parsing a warning", () => {
  const { backlog, env, ids } = fixture();
  setWindow(backlog, 3);
  claimedDaysAgo(backlog, ids[0], "agent:gone", 10);

  const r = run(["next", "--dir", backlog, "--actor", "agent:b", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.taken, true);
  assert.equal(out.reclaimed, "agent:gone");

  // POSITIVE CONTROL: an ordinary take leaves the field null, so it means
  // something rather than being present on every answer.
  const { backlog: b2, env: e2 } = fixture();
  const plain = JSON.parse(run(["next", "--dir", b2, "--actor", "agent:b", "--json"], e2).stdout);
  assert.equal(plain.reclaimed, null);
});

test("the loop pattern is a topic of `instructions`, rendered in this backlog's words", () => {
  const { backlog, env } = fixture();
  const r = run(["instructions", "autonomous-loop", "--dir", backlog], env);
  assert.equal(r.status, 0, r.stderr);
  // The three things a loop cannot be written without.
  assert.match(r.stdout, /\bnext\b/);
  assert.match(r.stdout, /\bdone\b/);
  assert.match(r.stdout, /\b3\b/, "the exit code for an empty queue is not stated");
  // The boundary of the guarantee, which is the part a reader would otherwise
  // assume in the direction that loses work.
  assert.match(r.stdout, /worktree|machine|branch/);
  assert.ok(!r.stdout.includes("{{"), "an unrendered placeholder reached the reader");
});

// ── the policy on a vocabulary that is not ours ────────────────────────────

test("a tie in priority is broken by task number, not by directory order", () => {
  const { backlog } = fixture(["P1", "P1", "P1"]);
  const config = loadConfig(backlog);
  const records = readTaskRecords(join(backlog, "tasks"), config.taskId.file).reverse();
  const { candidates } = selectCandidates(records, config, {
    status: null, priority: null, board: null, label: null, epic: null,
  }, Date.now());
  assert.deepEqual(candidates.map((t) => t.id), ["TASK-1", "TASK-2", "TASK-3"],
    "three equal tasks came back in whatever order the disk listed them");

  // POSITIVE CONTROL: priority still outranks the number, or the sort would be
  // by id alone and the tie-break would be the whole policy.
  const { backlog: b2 } = fixture(["P3", "P0"]);
  const c2 = loadConfig(b2);
  const { candidates: two } = selectCandidates(
    readTaskRecords(join(b2, "tasks"), c2.taskId.file), c2,
    { status: null, priority: null, board: null, label: null, epic: null }, Date.now()
  );
  assert.deepEqual(two.map((t) => t.id), ["TASK-2", "TASK-1"]);
});

test("the mechanism reads the project's words, not ours", () => {
  // Nothing in this backlog is spelled the way ours is: not the statuses, not
  // the one that means in progress, not the priorities. A reclaim that still
  // works here is reading the configuration; one that only works above could be
  // matching literals and nobody would see the difference.
  const { backlog, env, ids } = fixture();
  const path = join(backlog, "config.yaml");
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/^statuses: .*$/m, "statuses: [queued, mine, parked, shipped, dropped]")
    .replace(/^archived_statuses: .*$/m, "archived_statuses: [shipped, dropped]")
    .replace(/^dashboard_open_statuses: .*$/m, "dashboard_open_statuses: [queued, mine, parked]")
    // Written by `init` since TL-140, so a fixture renaming the statuses has to
    // rename it too or the configuration names words its own `statuses` lack.
    .replace(/^reason_required_statuses: .*$/m, "reason_required_statuses: [parked, dropped]")
    .replace(/^priorities: .*$/m, "priorities: [high, low]")
    .replace(/^# in_progress_status: .*$/m, "in_progress_status: mine")
    .replace(/^abandoned_after_days: .*$/m, "abandoned_after_days: 2"), "utf8");
  setField(backlog, ids[0], "priority", "high");
  setField(backlog, ids[0], "status", "mine");
  setField(backlog, ids[0], "owner", "agent:gone");
  setField(backlog, ids[0], "updated", daysAgo(9));

  const r = run(["next", "--dir", backlog, "--actor", "agent:b"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reclaimed from agent:gone/);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "mine",
    "the takeover wrote our word for `in progress` into their tree");
  assert.equal(field(taskText(backlog, ids[0]), "owner"), "agent:b");
});
