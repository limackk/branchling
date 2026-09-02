/**
 * Heartbeats → minutes, and the five ways that arithmetic lies (TL-28).
 *
 * WHAT EACH CASE HAS TO RULE OUT. Every assertion here is about a number, and a
 * number is the easiest thing in the world to produce for the wrong reason — so
 * each rule is tested as a PAIR: the case that must hold, and the smallest
 * change that must flip it. A threshold test that only checks the inside of the
 * window would pass against a clusterer with no window at all.
 *
 *   1. INVENTED MINUTES. A run of one heartbeat spans nothing. Rounding it up
 *      to a "nominal five minutes" would inflate exactly the finest-grained
 *      sessions, so it is zero, and the COUNT of such runs is reported instead
 *      (§6 rule 1 of docs/backlog-time-tracking.md — product-name: allow).
 *   2. AN UNDECIDED BOUNDARY. A gap exactly at `idle_gap_minutes` has to belong
 *      somewhere on purpose, not by whichever comparison somebody typed.
 *   3. TRUST IN FILE ORDER. The log is append-only across parallel sessions and
 *      a reader may concatenate two files, so shuffled input is the normal case.
 *   4. INFINITE TIME. The failure heartbeats exist to survive: a session that
 *      was killed and never wrote a closing row.
 *   5. A SUM THAT PRETENDS TO BE WHOLE. Effort and calendar time answer two
 *      different questions, and the share of minutes nothing could attribute is
 *      part of the answer rather than a footnote to it (§8.2).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { clusterHeartbeats, engagedReport, engagedTime, unionMinutes } from "../cluster.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("cluster");

const T0 = Date.parse("2026-09-02T09:00:00.000Z");

/** One heartbeat, `m` minutes after the reference instant. */
function hb(m, session = "s1", attribution = "focus") {
  return { ts: new Date(T0 + m * 60000).toISOString(), session, attribution, kind: "tool" };
}

// ── clustering ────────────────────────────────────────────────────────────

test("a run of heartbeats is one cluster, and its minutes are its span", () => {
  const clusters = clusterHeartbeats([hb(0), hb(5), hb(9), hb(14)], { idleGapMinutes: 10 });
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 4);
  assert.equal(clusters[0].minutes, 14);
  assert.equal(clusters[0].single, false);
});

test("a gap EXACTLY at the threshold continues the cluster — and a second more splits it", () => {
  const atThreshold = clusterHeartbeats([hb(0), hb(10)], { idleGapMinutes: 10 });
  assert.equal(atThreshold.length, 1, "a gap of exactly idle_gap_minutes must not split");
  assert.equal(atThreshold[0].minutes, 10);

  // The positive control. Without it this file would pass against a clusterer
  // that never splits anything at all.
  const justOver = clusterHeartbeats(
    [hb(0), { ...hb(10), ts: new Date(T0 + 10 * 60000 + 1000).toISOString() }],
    { idleGapMinutes: 10 }
  );
  assert.equal(justOver.length, 2, "one second past the threshold has to start a new cluster");
  assert.equal(justOver[0].minutes, 0);
  assert.equal(justOver[1].minutes, 0);
});

test("a run of one heartbeat is zero minutes and is counted as such", () => {
  const stats = engagedTime([hb(0), hb(30), hb(60)], { idleGapMinutes: 10 });
  assert.equal(stats.minutes, 0, "three isolated heartbeats measure nothing — no nominal minutes");
  assert.equal(stats.clusters, 3);
  assert.equal(stats.singles, 3, "the count is what settles the throttling window later");

  // The control: the same three rows close enough together really do measure.
  const together = engagedTime([hb(0), hb(3), hb(6)], { idleGapMinutes: 10 });
  assert.equal(together.minutes, 6);
  assert.equal(together.singles, 0);
});

test("shuffled heartbeats give the same answer as sorted ones", () => {
  const rows = [hb(0), hb(4), hb(8), hb(40), hb(44)];
  const sorted = engagedTime(rows, { idleGapMinutes: 10 });
  const shuffled = engagedTime([rows[3], rows[0], rows[4], rows[2], rows[1]], { idleGapMinutes: 10 });
  assert.deepEqual(shuffled, sorted);
  assert.equal(sorted.minutes, 12, "8 minutes and 4 minutes, in two clusters");
});

test("a session that was killed and never closed does not produce infinite time", () => {
  // The whole reason for heartbeats rather than start/stop pairs (§5.3): there
  // is no closing row here, and there never will be.
  const stats = engagedTime([hb(0), hb(2), hb(4)], { idleGapMinutes: 10 });
  assert.equal(Number.isFinite(stats.minutes), true);
  assert.equal(stats.minutes, 4, "time ends at the last thing actually observed");
});

test("a row with an unparseable timestamp is dropped, not counted as the epoch", () => {
  const stats = engagedTime([hb(0), { ts: "not a date", session: "s1" }, hb(4)], { idleGapMinutes: 10 });
  assert.equal(stats.minutes, 4);
});

// ── effort against calendar time (§6 rule 3) ──────────────────────────────

test("two parallel sessions sum as effort and merge as calendar time", () => {
  const rows = [
    hb(0, "a"), hb(15, "a"), hb(30, "a"),
    hb(0, "b"), hb(15, "b"), hb(30, "b"),
  ];
  const stats = engagedTime(rows, { idleGapMinutes: 20 });
  assert.equal(stats.sessions, 2);
  assert.equal(stats.minutes, 60, "two agents for half an hour each is an hour of effort");
  assert.equal(stats.calendarMinutes, 30, "…and half an hour on the clock");
  assert.notEqual(stats.minutes, stats.calendarMinutes, "the two figures answer different questions");
});

test("calendar time does not readmit the idle gap between two sessions", () => {
  const rows = [hb(0, "a"), hb(20, "a"), hb(120, "b"), hb(140, "b")];
  const stats = engagedTime(rows, { idleGapMinutes: 30 });
  assert.equal(stats.minutes, 40);
  assert.equal(stats.calendarMinutes, 40, "`last − first` would say 140 and count an idle hour and a half");
});

test("unionMinutes merges overlapping intervals and keeps disjoint ones apart", () => {
  assert.equal(unionMinutes([[T0, T0 + 600000], [T0 + 300000, T0 + 900000]]), 15);
  assert.equal(unionMinutes([[T0, T0 + 600000], [T0 + 6000000, T0 + 6600000]]), 20);
  assert.equal(unionMinutes([]), 0);
});

// ── the unattributed share (§8.2) ─────────────────────────────────────────

test("an interval is credited to the heartbeat that closes it", () => {
  const rows = [hb(0, "s1", "focus"), hb(10, "s1", "focus"), hb(20, "s1", "unknown")];
  const stats = engagedTime(rows, { idleGapMinutes: 10 });
  assert.equal(stats.minutes, 20);
  assert.equal(stats.minutesByAttribution.focus, 10);
  assert.equal(stats.minutesByAttribution.unknown, 10);
  assert.equal(stats.unknownRatio, 0.5);
  assert.equal(
    Object.values(stats.minutesByAttribution).reduce((a, b) => a + b, 0),
    stats.minutes,
    "the parts have to sum to the whole — otherwise minutes are being invented or lost"
  );
});

test("unknownRatio is present and zero when everything was attributed", () => {
  const stats = engagedTime([hb(0), hb(10)], { idleGapMinutes: 15 });
  assert.equal(stats.unknownRatio, 0);
  assert.equal("unknownRatio" in stats, true, "the key is never omitted, even at zero");
});

test("with no heartbeats at all the ratio is 0 rather than null or absent", () => {
  const stats = engagedTime([], {});
  assert.equal(stats.minutes, 0);
  assert.equal(stats.unknownRatio, 0);
  assert.equal(stats.first, null);
  assert.equal(stats.last, null);
});

// ── across tasks ──────────────────────────────────────────────────────────

test("the report's ratio is weighted by minutes, not averaged over tasks", () => {
  const report = engagedReport({
    "TL-1": [hb(0, "s1", "unknown"), hb(2, "s1", "unknown")],
    "TL-2": [hb(0, "s2", "focus"), hb(200, "s2", "focus"), hb(202, "s2", "focus")],
  }, { idleGapMinutes: 5 });

  assert.equal(report.minutes, 4, "2 minutes on TL-1 plus 2 on TL-2's second run");
  assert.equal(report.unknownMinutes, 2);
  assert.equal(report.unknownRatio, 0.5);
  // A mean of the two per-task ratios would be 0.5 here too, so the fixture is
  // deliberately asymmetric below: a tiny fully-unattributed task must not drag
  // a large well-attributed one.
  const lopsided = engagedReport({
    "TL-1": [hb(0, "s1", "unknown"), hb(1, "s1", "unknown")],
    "TL-2": [hb(0, "s2", "focus"), hb(99, "s2", "focus")],
  }, { idleGapMinutes: 120 });
  assert.equal(lopsided.minutes, 100);
  assert.equal(lopsided.unknownRatio, 0.01, "a mean over tasks would have said 50%");
});

test("a task whose only run was too short stays in the table, at zero", () => {
  // Dropping it would be the same lie as rounding it up: the task HAS evidence
  // of work, and what the measurement can honestly say about it is "nothing",
  // not "no activity". The tasks are ordered by minutes, so it sorts last.
  const report = engagedReport({
    "TL-1": [hb(0, "s1")],
    "TL-2": [hb(0, "s2"), hb(5, "s2")],
  }, { idleGapMinutes: 10 });
  assert.deepEqual(report.tasks.map((t) => t.task), ["TL-2", "TL-1"]);
  assert.equal(report.tasks[1].minutes, 0);
  assert.equal(report.minutes, 5);
  assert.equal(report.singles, 1, "the run too short to measure is still counted");
});

test("a task with no heartbeats at all does not appear", () => {
  const report = engagedReport({ "TL-1": [], "TL-2": [hb(0), hb(3)] }, { idleGapMinutes: 10 });
  assert.deepEqual(report.tasks.map((t) => t.task), ["TL-2"]);
});
