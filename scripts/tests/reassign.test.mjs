/**
 * Correcting an attribution without rewriting the log (TL-31).
 *
 * WHY THIS IS ITS OWN FILE. Attribution to the wrong task is the FIRST bug this
 * module will be told about — §8 says so, and it says why: a wrong attribution
 * looks exactly like a right one, so the mistake is only ever discovered by a
 * person recognising their own week. What that person then needs is a fix that
 * does not require trusting the tool a second time, and the only such fix is one
 * that leaves the original rows on disk, byte for byte, where they can still be
 * read and disputed.
 *
 * SO EVERY CASE HERE IS ABOUT ONE OF THREE FAILURES:
 *
 *   1. A CORRECTION THAT EDITS. If `reassign` rewrote the rows it moves, an
 *      append-only log would be append-only only until somebody made a mistake.
 *      The file's bytes are compared before and after.
 *   2. A CORRECTION THAT DOES NOT COMPOSE. A → B and then B → C has to end in
 *      C, on every machine and in any file order, or the second correction of
 *      the same session is a coin toss. Order comes from the ULID and is
 *      asserted against a SHUFFLED input.
 *   3. MINUTES THAT LEAK. A correction moves rows between tasks, so the totals
 *      before and after must be equal — nothing lost, nothing counted twice.
 *      This is the assertion that would catch a filter that copies instead of
 *      moving, which is the easy mistake here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HEARTBEAT_KINDS, activityPath, appendActivity, applyReassignments, readActivity, readAllActivity,
} from "../activity.mjs";
import { engagedReport } from "../cluster.mjs";
import { reassignPreview } from "../activity-retention.mjs";
import { isolateHome } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

// Every row this file writes goes to a throwaway home directory, never to
// the machine's real activity log (TL-35).
isolateHome("reassign");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "",
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function fixture(n = 2) {
  const dir = tmp("reassign");
  const backlog = join(dir, "bl");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  return { dir, backlog, env, ids };
}

const T0 = Date.parse("2026-09-02T09:00:00.000Z");

/** The rows a report actually counts: corrections applied, then the kinds that
 *  are evidence of presence. Reading it any other way here would test an
 *  arithmetic no command performs. */
function heartbeats(backlog) {
  const out = {};
  for (const [task, rows] of Object.entries(readAllActivity(backlog))) {
    out[task] = rows.filter((r) => HEARTBEAT_KINDS.indexOf(r.kind) >= 0);
  }
  return out;
}

/** A row, with the id fixed so ordering is a decision and not a race. */
function row(id, task, minute, session, kind = "tool") {
  return {
    id, ts: new Date(T0 + minute * 60000).toISOString(), task, kind,
    actor: "local:a", source: "test", session, attribution: "focus",
  };
}

function fix(id, from, to, session, since) {
  return {
    id, ts: new Date(T0 + 600000).toISOString(), task: from, to, session,
    ...(since ? { since } : {}),
    kind: "reassign", actor: "local:a", source: "test", attribution: "declared",
  };
}

// ── it is an append, never an edit ────────────────────────────────────────

test("a correction is appended; the rows it moves stay on disk untouched", () => {
  const { backlog, env, ids } = fixture();
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1"),
  ]);
  const before = readFileSync(activityPath(backlog, ids[0]), "utf8");

  const r = run(["activity", "reassign", "--dir", backlog,
    "--from", ids[0], "--to", ids[1], "--session", "s1", "--actor", "local:a"], env);
  assert.equal(r.status, 0, r.stderr);

  const after = readFileSync(activityPath(backlog, ids[0]), "utf8");
  assert.ok(after.startsWith(before), "the original rows were rewritten, not appended to");
  assert.equal(after.trim().split("\n").length, 3, "exactly one row was added");
  const rows = readActivity(backlog, ids[0]);
  assert.equal(rows[2].kind, "reassign");
  assert.equal(rows[2].to, ids[1]);
});

test("the reader moves the rows the file still holds", () => {
  const { backlog, ids } = fixture();
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1"), row("01C", ids[0], 20, "s2"),
    fix("01Z", ids[0], ids[1], "s1"),
  ]);
  const corrected = readAllActivity(backlog);
  assert.deepEqual(corrected[ids[1]].map((r) => r.id), ["01A", "01B"]);
  assert.deepEqual(corrected[ids[0]].map((r) => r.id), ["01C", "01Z"],
    "the other session stays, and the correction itself is never moved");
});

test("--dry-run appends nothing but still says what would move", () => {
  const { backlog, env, ids } = fixture();
  appendActivity(backlog, ids[0], [row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1")]);
  const before = readFileSync(activityPath(backlog, ids[0]), "utf8");

  const r = run(["activity", "reassign", "--dir", backlog, "--dry-run",
    "--from", ids[0], "--to", ids[1], "--session", "s1"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 row\(s\) would move/);
  assert.equal(readFileSync(activityPath(backlog, ids[0]), "utf8"), before);
});

// ── composition and order ─────────────────────────────────────────────────

test("two corrections on one session compose, in ULID order", () => {
  const { backlog, ids } = fixture(3);
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1"),
    fix("01Y", ids[0], ids[1], "s1"),
  ]);
  appendActivity(backlog, ids[1], [fix("01Z", ids[1], ids[2], "s1")]);

  const corrected = readAllActivity(backlog);
  assert.deepEqual(corrected[ids[2]].map((r) => r.id), ["01A", "01B"],
    "A → B → C has to end in C");
  assert.deepEqual(corrected[ids[0]].map((r) => r.id), ["01Y"]);
  assert.deepEqual(corrected[ids[1]].map((r) => r.id), ["01Z"]);
});

test("the order is the ULID's, not the file's — a shuffled input gives the same answer", () => {
  const rows = {
    A: [row("01A", "A", 0, "s1"), row("01B", "A", 10, "s1"), fix("01Y", "A", "B", "s1")],
    B: [fix("01Z", "B", "C", "s1")],
    C: [],
  };
  const straight = applyReassignments(rows);
  const shuffled = applyReassignments({
    C: [], B: [fix("01Z", "B", "C", "s1")],
    A: [fix("01Y", "A", "B", "s1"), row("01B", "A", 10, "s1"), row("01A", "A", 0, "s1")],
  });
  assert.deepEqual(shuffled, straight);
  assert.deepEqual(straight.C.map((r) => r.id), ["01A", "01B"]);

  // The positive control for "order matters at all": swap which correction was
  // made first and the rows land somewhere else.
  const reversed = applyReassignments({
    A: [row("01A", "A", 0, "s1"), fix("01Z", "A", "B", "s1")],
    B: [fix("01Y", "B", "C", "s1")],
    C: [],
  });
  assert.deepEqual(reversed.B.map((r) => r.id), ["01A", "01Y"],
    "the B → C correction was made BEFORE the rows arrived in B, so it does not reach them");
});

// ── nothing lost, nothing duplicated ──────────────────────────────────────

test("minutes carry over whole: the totals before and after a correction are equal", () => {
  const { backlog, ids } = fixture();
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1"), row("01C", ids[0], 20, "s1"),
  ]);
  const before = engagedReport(heartbeats(backlog), { idleGapMinutes: 15 });
  assert.equal(before.minutes, 20);

  appendActivity(backlog, ids[0], [fix("01Z", ids[0], ids[1], "s1")]);
  const after = engagedReport(heartbeats(backlog), { idleGapMinutes: 15 });

  assert.equal(after.minutes, before.minutes, "a correction may not create or destroy time");
  assert.deepEqual(after.tasks.map((t) => t.task), [ids[1]]);
  assert.equal(after.tasks[0].minutes, 20);
});

test("`--since` moves only the rows after it, and splits a session cleanly", () => {
  const { backlog, ids } = fixture();
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s1"),
    row("01C", ids[0], 20, "s1"), row("01D", ids[0], 30, "s1"),
  ]);
  appendActivity(backlog, ids[0], [
    fix("01Z", ids[0], ids[1], "s1", new Date(T0 + 20 * 60000).toISOString()),
  ]);
  const corrected = readAllActivity(backlog);
  assert.deepEqual(corrected[ids[0]].map((r) => r.id), ["01A", "01B", "01Z"]);
  assert.deepEqual(corrected[ids[1]].map((r) => r.id), ["01C", "01D"]);

  // The minutes do NOT have to be equal here and that is honest: splitting one
  // run in two loses the ten minutes that spanned the split, because after the
  // split no cluster contains both sides of it. Asserting equality would be
  // asserting a lie; what has to hold is that nothing was duplicated.
  const after = engagedReport(heartbeats(backlog), { idleGapMinutes: 15 });
  assert.equal(after.minutes, 20, "10 minutes on each side; the gap between them belongs to neither");
});

// ── refusals ──────────────────────────────────────────────────────────────

test("a correction with no session, no destination, or onto itself is refused", () => {
  const { backlog, env, ids } = fixture();
  const missing = run(["activity", "reassign", "--dir", backlog, "--from", ids[0], "--to", ids[1]], env);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--session/);

  const noTo = run(["activity", "reassign", "--dir", backlog, "--from", ids[0], "--session", "s1"], env);
  assert.equal(noTo.status, 2);

  const itself = run(["activity", "reassign", "--dir", backlog,
    "--from", ids[0], "--to", ids[0], "--session", "s1"], env);
  assert.equal(itself.status, 1, "a correction from a task to itself corrects nothing");
});

test("an unknown flag fails instead of being ignored", () => {
  const { backlog, env, ids } = fixture();
  const r = run(["activity", "reassign", "--dir", backlog, "--from", ids[0], "--to", ids[1],
    "--session", "s1", "--frobnicate"], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag/);
});

test("the preview counts what would move, and ignores corrections already made", () => {
  const { backlog, ids } = fixture();
  appendActivity(backlog, ids[0], [
    row("01A", ids[0], 0, "s1"), row("01B", ids[0], 10, "s2"),
    fix("01Z", ids[0], ids[1], "s3"),
  ]);
  assert.equal(reassignPreview(backlog, ids[0], "s1").length, 1);
  assert.equal(reassignPreview(backlog, ids[0], "s3").length, 0,
    "a `reassign` row is not activity and is never itself moved");
});
