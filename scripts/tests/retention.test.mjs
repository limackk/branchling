/**
 * What the activity log gives back: retention, erasure, and one honest report
 * about what is kept (TL-31).
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS. Every case here guards a way in which a
 * mechanism can LOOK like it works and quietly not:
 *
 *   1. RETENTION THAT EATS THE HISTORY. `prune` deletes the raw rows and keeps
 *      the aggregate. If the aggregate were recomputed AFTER the delete instead
 *      of before it, every historical figure would silently become "the last N
 *      days" — the calibration input would shrink every night and the report
 *      would look exactly as healthy as before. The test therefore checks the
 *      surviving minutes, not just the surviving files.
 *   2. ERASURE THAT COMES BACK. `forget` is the OPPOSITE inversion: the
 *      aggregates have to be rebuilt WITHOUT the erased rows, or the person's
 *      data reappears at the next report from a file that outlived them. There
 *      is a positive control for the difference between the two commands,
 *      because it is one line of code and it is the whole semantics.
 *   3. A DRY RUN THAT IS NOT DRY. `forget` deletes with no undo, so the preview
 *      is compared by CONTENT — every activity file's bytes before and after —
 *      rather than by whether the command printed the word "would".
 *   4. A GUARD GREEN ON AN EMPTY SAMPLE. Each deletion case is paired with the
 *      run that must delete something; a `prune` with nothing past the window
 *      and a `prune` that is broken are the same green tick otherwise.
 *
 * The clock is INJECTED everywhere. A retention test that waited 90 days would
 * not be a test, and one that faked the rows' timestamps instead would be
 * asserting against data no writer produces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { activityDir, activityPath, appendActivity, readActivity, readRollup } from "../activity.mjs";
import { cutoff, forget, privacyReport, prune, recomputeRollups, rollupFor } from "../activity-retention.mjs";
import { loadConfig } from "../config.mjs";
import { isolateHome } from "./_repo.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

// Every row this file writes goes to a throwaway home directory, never to
// the machine's real activity log (TL-35).
isolateHome("retention");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "",
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

const DAY = 86400000;
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

/** A backlog with `n` tasks and nothing measured yet. */
function fixture(n = 1) {
  const dir = tmp("retention");
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(r.status, 0, r.stderr);
    ids.push((r.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  return { dir, backlog, state, env, ids, config: loadConfig(backlog) };
}

/** A run of heartbeats `daysAgo` days back: `count` rows, `gapMinutes` apart. */
function session(backlog, task, opts) {
  const rows = [];
  for (let i = 0; i < opts.count; i++) {
    rows.push({
      ts: new Date(NOW - opts.daysAgo * DAY + i * opts.gapMinutes * 60000).toISOString(),
      task, kind: "tool", actor: opts.actor, session: opts.session,
      attribution: opts.attribution || "focus", source: "test",
    });
  }
  return appendActivity(backlog, task, rows);
}

/** Every activity file's exact bytes — the only honest way to ask whether a
 *  dry run wrote anything. */
function snapshot(backlog) {
  const dir = activityDir(backlog);
  if (!existsSync(dir)) return {};
  const out = {};
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".jsonl")) out[f] = readFileSync(join(dir, f), "utf8");
  }
  return out;
}

// ── the aggregate ─────────────────────────────────────────────────────────

test("the rollup carries the five fields §9 allows out, and no sixth", () => {
  const rollup = rollupFor([
    { ts: "2026-09-01T09:00:00Z", kind: "tool", session: "s", attribution: "focus" },
    { ts: "2026-09-01T09:20:00Z", kind: "tool", session: "s", attribution: "focus" },
  ], { idleGapMinutes: 30 });
  assert.deepEqual(Object.keys(rollup).sort(),
    ["first", "last", "minutes", "sessions", "unknown_ratio"]);
  assert.equal(rollup.minutes, 20);
  assert.equal(rollup.sessions, 1);
  // No actor anywhere in it: the aggregate is committed, and a per-actor
  // breakdown in a versioned file would be the working calendar again.
  assert.equal(JSON.stringify(rollup).includes("actor"), false);
});

test("a correction is applied before the aggregate is written", () => {
  const { backlog, ids, config } = fixture(2);
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "s1" });
  appendActivity(backlog, ids[0], [{
    task: ids[0], to: ids[1], session: "s1", kind: "reassign", actor: "local:a",
    source: "test", attribution: "declared",
  }]);

  recomputeRollups(backlog, config);
  assert.equal(readRollup(backlog, ids[0]).minutes, 0, "the minutes must not stay on the wrong task");
  assert.equal(readRollup(backlog, ids[1]).minutes, 20, "…they belong to the task the correction names");
});

// ── prune ─────────────────────────────────────────────────────────────────

test("prune deletes only rows past the window, and leaves the rest alone", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 200, count: 3, gapMinutes: 10, actor: "local:a", session: "old" });
  session(backlog, ids[0], { daysAgo: 2, count: 3, gapMinutes: 10, actor: "local:a", session: "new" });
  assert.equal(readActivity(backlog, ids[0]).length, 6);

  const result = prune(backlog, config, { now: NOW });
  assert.equal(result.removed, 3);
  assert.equal(result.kept, 3);
  const left = readActivity(backlog, ids[0]);
  assert.equal(left.length, 3);
  assert.deepEqual([...new Set(left.map((r) => r.session))], ["new"],
    "the rows inside the window are exactly the ones that survived");
});

test("the aggregate is computed BEFORE the delete — the window does not eat the history", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 200, count: 3, gapMinutes: 10, actor: "local:a", session: "old" });
  session(backlog, ids[0], { daysAgo: 2, count: 3, gapMinutes: 10, actor: "local:a", session: "new" });

  prune(backlog, config, { now: NOW });
  const rollup = readRollup(backlog, ids[0]);
  assert.equal(rollup.minutes, 40, "20 minutes from each session — the old one was measured before it went");
  assert.equal(rollup.sessions, 2);
  assert.equal(readActivity(backlog, ids[0]).length, 3, "…while the raw rows really are gone");

  // The positive control for the ORDER. Recomputing from what is left now would
  // give 20; the assertion above is only meaningful because this one differs.
  const afterwards = rollupFor(readActivity(backlog, ids[0]), { idleGapMinutes: config.idleGapMinutes });
  assert.equal(afterwards.minutes, 20, "a rollup computed after the delete would have halved the history");
});

test("prune with nothing past the window changes nothing — and the control that it can", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 2, count: 3, gapMinutes: 10, actor: "local:a", session: "s1" });
  const before = snapshot(backlog);

  assert.equal(prune(backlog, config, { now: NOW }).removed, 0);
  assert.deepEqual(snapshot(backlog), before);
  // The control: the same rows against a one-day window DO go, so the green
  // tick above is about the window and not about a prune that never deletes.
  assert.equal(prune(backlog, config, { now: NOW, days: 1 }).removed, 3);
});

test("prune --dry-run deletes nothing and writes no aggregate", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 200, count: 3, gapMinutes: 10, actor: "local:a", session: "old" });
  const before = snapshot(backlog);

  const result = prune(backlog, config, { now: NOW, dryRun: true });
  assert.equal(result.removed, 3, "it still says what would go");
  assert.deepEqual(snapshot(backlog), before);
  assert.equal(readRollup(backlog, ids[0]), null, "a dry run may not leave a computed file behind either");
});

test("a task whose rows all expire loses its file, not just its rows", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 200, count: 2, gapMinutes: 10, actor: "local:a", session: "old" });
  prune(backlog, config, { now: NOW });
  assert.equal(existsSync(activityPath(backlog, ids[0])), false);
  assert.notEqual(readRollup(backlog, ids[0]), null, "…but the aggregate outlives the rows, which is the point");
});

// ── forget ────────────────────────────────────────────────────────────────

test("forget removes one actor's rows and leaves everybody else's", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "sa" });
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:b", session: "sb" });

  const result = forget(backlog, config, { actor: "local:a" });
  assert.equal(result.removed, 3);
  const left = readActivity(backlog, ids[0]);
  assert.deepEqual([...new Set(left.map((r) => r.actor))], ["local:b"]);
});

test("after forget the report does not reconstruct the actor's data", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "sa" });
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:b", session: "sb" });

  recomputeRollups(backlog, config);
  assert.equal(readRollup(backlog, ids[0]).minutes, 40, "the control: both sessions were counted first");

  forget(backlog, config, { actor: "local:a" });
  assert.equal(readRollup(backlog, ids[0]).minutes, 20,
    "an aggregate left standing over deleted rows is the data coming back at the next report");
  assert.equal(readRollup(backlog, ids[0]).sessions, 1);
});

test("forget removes the aggregate too when nothing of the task is left", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "sa" });
  recomputeRollups(backlog, config);
  assert.notEqual(readRollup(backlog, ids[0]), null);

  forget(backlog, config, { actor: "local:a" });
  assert.equal(readRollup(backlog, ids[0]), null,
    "a rollup nobody recomputes is the last trace of somebody who asked to be forgotten");
});

test("forget --dry-run touches not one byte", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "sa" });
  const before = snapshot(backlog);

  const result = forget(backlog, config, { actor: "local:a", dryRun: true });
  assert.equal(result.removed, 3, "it says what would go");
  assert.deepEqual(snapshot(backlog), before, "…and this command has no undo, so it may not go yet");
});

test("forget with no actor is refused rather than erasing everybody", () => {
  const { backlog, config } = fixture();
  assert.throws(() => forget(backlog, config, {}), /would erase everybody/);
  const cli = run(["activity", "forget", "--dir", backlog]);
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /--actor/);
});

test("a correction by the erased actor survives them", () => {
  // It is a statement about somebody else's rows. Dropping it would silently
  // un-correct an attribution — restoring a claim, in the act of erasing one.
  const { backlog, ids, config } = fixture(2);
  session(backlog, ids[0], { daysAgo: 1, count: 2, gapMinutes: 10, actor: "local:b", session: "sb" });
  appendActivity(backlog, ids[0], [{
    task: ids[0], to: ids[1], session: "sb", kind: "reassign", actor: "local:a",
    source: "test", attribution: "declared",
  }]);

  forget(backlog, config, { actor: "local:a" });
  const left = readActivity(backlog, ids[0]);
  assert.equal(left.filter((r) => r.kind === "reassign").length, 1);
});

// ── the report ────────────────────────────────────────────────────────────

test("report --privacy says the window, the mode, the rows and which paths are versioned", () => {
  const { backlog, ids, config } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 3, gapMinutes: 10, actor: "local:a", session: "sa" });

  const report = privacyReport(backlog, config);
  assert.equal(report.privacy, "local");
  assert.equal(report.retentionDays, 90);
  assert.equal(report.rawRows, 3);
  assert.deepEqual(report.actors, [{ actor: "local:a", count: 3 }]);
  assert.ok(report.versioned.some((p) => p.endsWith("rollup")), "the aggregate is the versioned part");
  assert.ok(report.notVersioned.some((p) => p.includes("activity") && p.endsWith(".jsonl")),
    "the raw log is the part that stays on this machine");
});

test("the privacy report is printed by the command, not only computed", () => {
  const { backlog, env, ids } = fixture();
  session(backlog, ids[0], { daysAgo: 1, count: 2, gapMinutes: 10, actor: "local:a", session: "sa" });
  const r = run(["activity", "report", "--privacy", "--dir", backlog], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /activity_retention_days/);
  assert.match(r.stdout, /activity_privacy/);
  assert.match(r.stdout, /local:a/);
  assert.match(r.stdout, /not a compliance claim/i,
    "the report must not let a reader take a mechanism for compliance");
});

test("`report` without --privacy is a usage error, not a different report", () => {
  const { backlog, env } = fixture();
  const r = run(["activity", "report", "--dir", backlog], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--privacy/);
});

test("the cutoff is the window, counted from now", () => {
  assert.equal(cutoff(90, NOW), new Date(NOW - 90 * DAY).toISOString());
  assert.equal(cutoff(0, NOW), new Date(NOW).toISOString());
});

// ── the README says all this ──────────────────────────────────────────────

test("the README tells a reader what is recorded and how to get rid of it", () => {
  // A mechanism nobody can find is not a mechanism. This is the one place a
  // person who has not read the design document looks.
  const readme = readFileSync(join(HERE, "..", "..", "README.md"), "utf8");
  const at = readme.indexOf("## What it records about you");
  assert.notEqual(at, -1, "the README does not say what the tool records about a person");
  const section = readme.slice(at, at + 4000);
  assert.match(section, /activity_retention_days/, "it does not say for how long");
  assert.match(section, /activity forget/, "it does not say how to get rid of it");
  assert.match(section, /activity reassign/, "it does not say how to correct it");
  assert.match(section, /not a compliance claim/i, "it lets a reader take a mechanism for compliance");
});
