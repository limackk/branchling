/**
 * A task being worked on has to LOOK like it, and one that stopped has to look
 * like that (TL-189).
 *
 * WHAT EACH CASE HAS TO RULE OUT:
 *
 *   1. A SPINNER. The failure mode of every "is it running" indicator is that it
 *      keeps claiming yes over a session that died. So the central case is the
 *      negative one: an hour-old heartbeat must NOT read as work in progress,
 *      and it is asserted before the positive case is trusted.
 *   2. A SIGNAL WITH NO LOG BEHIND IT. With no heartbeats the card has to render
 *      exactly as it did before this feature existed — the same HTML, not "the
 *      same but with an empty badge". A viewer that grew a slot on every card
 *      would have changed the page for every project that never records one.
 *   3. A GUARANTEE THAT LEAKED. The raw log is a record of what hour a particular
 *      person worked and is kept outside every repository for that reason. The
 *      generated page is mailed around, so it must carry no part of the log —
 *      asserted against a build made while a log with fresh rows exists.
 *   4. A GREEN MODULE THE PAGE NEVER CALLS. The decisions live in in-flight.mjs
 *      and run here for real; the last cases pin the page to that module, because
 *      a rule nothing invokes passes every test in this file.
 *
 * The statuses are the FIXTURE's own, never this project's: `in_progress_status`
 * is a project's word for its own state (third law), and a test asserting the
 * value in `backlog/config.yaml` would assert somebody else's vocabulary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IN_FLIGHT_KINDS,
  ageLabel,
  inFlightCardAttrs,
  inFlightPhrase,
  inFlightSignal,
  inFlightState,
  inFlightVisible,
  shortAgeLabel,
  takeTimestamp,
} from "../in-flight.mjs";
import { HEARTBEAT_KINDS, appendActivity, readActivity } from "../activity.mjs";
import { buildHtml, computeStats } from "../build-viewer.mjs";
import { loadConfig } from "../config.mjs";

import { isolateHome } from "./_repo.mjs";

// Every row this file writes goes to a throwaway home directory, never to the
// machine's real activity log (TL-35).
const HOME = isolateHome("viewer-in-flight");

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

const NOW = "2026-09-03T12:00:00.000Z";
const minutesAgo = (n) => new Date(Date.parse(NOW) - n * 60000).toISOString();

/** One heartbeat, at a stated age. The FIXTURE builds rows by hand rather than
 *  by running the tool, so a change to the recording path cannot make the
 *  reading path pass by accident. */
function beat(ageMinutes, over = {}) {
  return {
    id: "01" + String(1e15 - Math.round(ageMinutes * 1000)).padStart(24, "0"),
    ts: minutesAgo(ageMinutes),
    task: "FX-1",
    kind: "tool",
    actor: "agent:claude",
    session: "s1",
    attribution: "focus",
    ...over,
  };
}

const GAP = { idleGapMinutes: 10, now: NOW };

// ──────────────────────────────────────────────────────────────────────────
// 1. The claim, and above all its negation
// ──────────────────────────────────────────────────────────────────────────

test("a fresh heartbeat reads as work in progress", () => {
  const signal = inFlightSignal([beat(2)], { since: minutesAgo(30) });
  const state = inFlightState(signal, GAP);
  assert.equal(state.known, true);
  assert.equal(state.working, true, "a heartbeat two minutes old is not being read as work");
  assert.equal(state.age, "2 minutes");
});

test("an hour-old heartbeat does NOT read as work in progress", () => {
  // The case the whole feature is for. A spinner passes every other test here.
  const signal = inFlightSignal([beat(60)], { since: minutesAgo(180) });
  const state = inFlightState(signal, GAP);
  assert.equal(state.known, true, "the signal is still KNOWN — it is the age that is the answer");
  assert.equal(state.working, false, "a session silent for an hour is being reported as working");
  assert.equal(state.age, "60 minutes");
});

test("the threshold is the project's idle_gap_minutes, not a number of ours", () => {
  // A project that declares a two-hour gap has said what it means by "stopped".
  // Reading it with a threshold of our own would let the page and that project's
  // own minutes report disagree about one interval, with nothing to say which is
  // right.
  const signal = inFlightSignal([beat(60)], {});
  assert.equal(inFlightState(signal, { now: NOW, idleGapMinutes: 120 }).working, true);
  assert.equal(inFlightState(signal, { now: NOW, idleGapMinutes: 10 }).working, false);
});

test("a gap exactly at the threshold still counts as working", () => {
  // Decided here and pinned, the same way rule 2 in cluster.mjs is: either answer
  // is defensible, an undecided one is not.
  const signal = inFlightSignal([beat(10)], {});
  assert.equal(inFlightState(signal, GAP).working, true);
  assert.equal(inFlightState(inFlightSignal([beat(11)], {}), GAP).working, false);
});

test("negative control: no rows at all is no signal, not a quiet one", () => {
  // Without this the reducer could return an object for everything and every
  // assertion above would still pass — and every card would carry a badge.
  assert.equal(inFlightSignal([], {}), null);
  assert.equal(inFlightSignal(null, {}), null);
  const state = inFlightState(null, GAP);
  assert.deepEqual(state, { known: false, working: false, ageMs: 0, age: "", short: "" });
  assert.deepEqual(inFlightCardAttrs(null, state), { className: "", title: "" });
  assert.equal(inFlightPhrase(null, state), "");
});

// ──────────────────────────────────────────────────────────────────────────
// 2. What the signal is allowed to be built from
// ──────────────────────────────────────────────────────────────────────────

test("the kinds that count are the ones activity.mjs already settled", () => {
  // Repeated rather than imported, so the page can be pasted whole — which means
  // the repetition needs pinning. Two sets drifting apart would have the card and
  // the minutes report disagree about whether anything happened.
  assert.deepEqual(IN_FLIGHT_KINDS, HEARTBEAT_KINDS);
});

test("a backfilled commit row is not evidence that somebody is at the keyboard", () => {
  // `commit` rows are reconstructed out of git after the fact. Admitting them
  // would light up every closed task in the backlog the next time anybody ran a
  // backfill.
  const rows = [beat(400, { kind: "commit" }), beat(400, { kind: "reassign", to: "FX-2" }), beat(400, { kind: "session" })];
  assert.equal(inFlightSignal(rows, {}), null);
});

test("rows older than the take belong to the previous stint, not to this one", () => {
  // A task picked up, dropped and picked up again has two stints. Counting both
  // as one credits this session with the last person's work — and a task taken a
  // minute ago whose only rows are a week old must read as "nothing heard yet".
  const rows = [beat(600), beat(590), beat(3)];
  const full = inFlightSignal(rows, {});
  assert.equal(full.events, 3);
  const stint = inFlightSignal(rows, { since: minutesAgo(30) });
  assert.equal(stint.events, 1, "the window is not being applied to the count");
  assert.equal(stint.last, minutesAgo(3));

  const takenJustNow = inFlightSignal([beat(600), beat(590)], { since: minutesAgo(1) });
  assert.equal(takenJustNow, null, "a stale row is setting `last` for a stint that has heard nothing");
});

test("the take is the LAST entry into the in-progress status, and the status is data", () => {
  const status = "doing";                     // the fixture's word, not this project's
  const history = [
    { ts: "2026-09-01T08:00:00.000Z", field: "status", from: "todo", to: status },
    { ts: "2026-09-02T08:00:00.000Z", field: "status", from: status, to: "todo" },
    { ts: "2026-09-03T08:00:00.000Z", field: "status", from: "todo", to: status },
    { ts: "2026-09-03T09:00:00.000Z", field: "owner", from: "unassigned", to: "agent:claude" },
  ];
  assert.equal(takeTimestamp(history, status), "2026-09-03T08:00:00.000Z");
  // A rule written around a literal `in_progress` would return null here, and a
  // project using its own vocabulary would silently get no signal at all.
  assert.equal(takeTimestamp(history, "in_progress"), null);
  assert.equal(takeTimestamp([], status), null);
});

test("parallel sessions on one task are counted, not collapsed into one actor", () => {
  const signal = inFlightSignal(
    [beat(5, { session: "s1", actor: "agent:claude" }), beat(2, { session: "s2", actor: "user:kamil" })],
    {}
  );
  assert.equal(signal.sessions, 2);
  assert.equal(signal.actor, "user:kamil", "the actor is not the one of the LAST heartbeat");
  assert.match(inFlightPhrase(signal, inFlightState(signal, GAP)), /in 2 sessions/);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. The words
// ──────────────────────────────────────────────────────────────────────────

test("the age is floored, never rounded up", () => {
  // "3 minutes ago" has to mean AT LEAST three minutes: a gap reported smaller
  // than it was is the one direction that makes silence less visible.
  assert.equal(ageLabel(59_000), "less than a minute");
  assert.equal(ageLabel(119_000), "1 minute");
  // Minutes run to ninety rather than to sixty, on purpose: everything an hour
  // and a bit old would otherwise collapse into "1 hour", and the difference
  // between sixty-five minutes and a hundred and fifteen is exactly what a reader
  // deciding whether to go and look is weighing.
  assert.equal(ageLabel(60 * 60_000), "60 minutes");
  assert.equal(ageLabel(89 * 60_000), "89 minutes");
  assert.equal(ageLabel(90 * 60_000), "1 hour");
  assert.equal(ageLabel(47 * 3600_000), "47 hours");
  assert.equal(ageLabel(72 * 3600_000), "3 days");
  assert.equal(shortAgeLabel(30_000), "now");
  assert.equal(shortAgeLabel(5 * 60_000), "5m");
  assert.equal(shortAgeLabel(5 * 3600_000), "5h");
});

test("the sentence never claims work without saying when it was last heard", () => {
  // The reader's question is not "is a flag set" but "should I still be waiting",
  // and only the age answers it.
  const live = inFlightSignal([beat(1)], { since: minutesAgo(20) });
  const said = inFlightPhrase(live, inFlightState(live, GAP));
  assert.match(said, /Being worked on/);
  assert.match(said, /last heard from 1 minute ago/);
  assert.match(said, /agent:claude/);
  assert.match(said, /since it was taken/);

  const dead = inFlightSignal([beat(120)], { since: minutesAgo(300) });
  const alsoSaid = inFlightPhrase(dead, inFlightState(dead, GAP));
  assert.doesNotMatch(alsoSaid, /Being worked on/, "a two-hour silence is being announced as work");
  assert.match(alsoSaid, /^Last heard from 2 hours ago/);
});

test("a count with no take behind it does not pretend to have one", () => {
  const signal = inFlightSignal([beat(1)], {});
  assert.match(inFlightPhrase(signal, inFlightState(signal, GAP)), /1 event recorded/);
});

test("only a LIVE signal marks the card; a stale one keeps its badge and loses the highlight", () => {
  const live = inFlightSignal([beat(1)], {});
  assert.equal(inFlightCardAttrs(live, inFlightState(live, GAP)).className, "in-flight");
  const dead = inFlightSignal([beat(120)], {});
  assert.equal(inFlightCardAttrs(dead, inFlightState(dead, GAP)).className, "in-flight-stale");
});

test("a stopped session is shown on a task the backlog calls in progress, and nowhere else", () => {
  // Two asymmetric cases. The badge on a quiet in-progress task IS how a dead
  // session is spotted; the same badge on a task closed last week is noise the
  // Measured row already covers.
  const dead = inFlightSignal([beat(120)], {});
  const state = inFlightState(dead, GAP);
  const opts = { inProgressStatus: "doing" };
  assert.equal(inFlightVisible({ status: "doing" }, state, opts), true);
  assert.equal(inFlightVisible({ status: "done" }, state, opts), false);

  // …but heartbeats arriving on a task somebody has already closed are the honest
  // anomaly, and those are always shown.
  const live = inFlightState(inFlightSignal([beat(1)], {}), GAP);
  assert.equal(inFlightVisible({ status: "done" }, live, opts), true);
});

test("clock skew between two machines is not reported as work done in advance", () => {
  const signal = inFlightSignal([beat(-5)], {});
  const state = inFlightState(signal, GAP);
  assert.equal(state.ageMs, 0);
  assert.equal(state.working, true);
});

// ──────────────────────────────────────────────────────────────────────────
// 4. The page
// ──────────────────────────────────────────────────────────────────────────

/** A backlog of its own, with its own vocabulary, and a raw log beside it. */
function fixture(rows) {
  const root = mkdtempSync(join(tmpdir(), "branchling-in-flight-"));
  mkdirSync(join(root, "tasks"), { recursive: true });
  writeFileSync(
    join(root, "config.yaml"),
    [
      "project_name: Fixture",
      "task_id_prefix: FX",
      "statuses: [todo, doing, done]",
      "archived_statuses: [done]",
      "dashboard_open_statuses: [todo, doing]",
      "in_progress_status: doing",
      "priorities: [P1, P2]",
      "types: [task]",
      "idle_gap_minutes: 10",
      "",
    ].join("\n"),
    "utf8"
  );
  if (rows && rows.length) appendActivity(root, "FX-1", rows);
  return root;
}

const TASK = {
  id: "FX-1", title: "A task", board: "main", labels: [], blocked_by: [], blocks: [],
  related_docs: [], epic: "", status: "doing", priority: "P1", type: "task", bodyHtml: "",
  elsewhere: [],
};

test("viewer: the page carries the source of in-flight.mjs and calls it", () => {
  const root = fixture([]);
  const html = buildHtml([TASK], computeStats([TASK]), loadConfig(root));

  const src = readFileSync(join(SCRIPTS, "in-flight.mjs"), "utf8");
  for (const marker of ["export function inFlightState", "export function inFlightVisible", "export function inFlightPhrase"]) {
    assert.ok(src.includes(marker), "the module changed shape — fix the marker in this test");
    assert.ok(html.includes(marker.replace("export ", "")), marker + " did not reach the page");
  }
  assert.match(html, /inFlightBadgeHtml\(t\.id\)/, "the card renderer never asks whether anybody is on this task");
  assert.match(html, /inFlightRow\(t\.id\)/, "the detail panel never asks");
  assert.match(html, /api\/in-flight/, "the page has no route to ask for the signal");
  assert.match(html, /addEventListener\("activity-changed"/, "a heartbeat would never reach an open tab");
  assert.match(html, /setInterval\(paintInFlight/, "nothing advances the age, so silence never becomes visible");
});

test("viewer: the mark is not carried by colour alone", () => {
  const html = buildHtml([TASK], computeStats([TASK]), loadConfig(fixture([])));
  assert.match(html, /\.badge-in-flight::before\s*\{/, "the badge has no shape, only a colour");
  assert.match(html, /--in-flight:/, "the live colour is not a token");
  assert.match(html, /--in-flight-bg:/);
  // A colour defined only in the light block turns invisible in dark mode, and
  // the page still renders, which is why this is asserted rather than looked at.
  const dark = html.slice(html.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(dark, /--in-flight:/, "the live colour has no dark-mode value");
  assert.match(dark, /--in-flight-bg:/, "the badge background has no dark-mode value");
});

test("viewer: with no log the card renders exactly as it did before this feature", () => {
  // The slot is empty, not absent — it is what the repaint writes into — but
  // nothing inside it, no class on the card and no row in the panel.
  const html = buildHtml([TASK], computeStats([TASK]), loadConfig(fixture([])));
  assert.doesNotMatch(html, /badge-in-flight" title=/, "a badge was rendered with no heartbeat behind it");
  assert.ok(!html.includes('class="task-card in-flight"'), "a card was marked live with no log at all");
});

test("viewer: the generated page carries no part of the raw log", () => {
  // THE BOUNDARY, and it is the reason the signal is a route rather than a
  // variable. This file is written to backlog/viewer.html and mailed around; the
  // log is a record of what hour a named person worked. A build made while fresh
  // rows exist must contain none of them.
  const root = fixture([
    beat(1, { session: "session-that-must-not-travel", actor: "user:kamil" }),
    beat(4, { session: "session-that-must-not-travel", actor: "user:kamil" }),
  ]);
  assert.equal(readActivity(root, "FX-1").length, 2, "the fixture wrote no rows — the assertion below proves nothing");

  const html = buildHtml([TASK], computeStats([TASK]), loadConfig(root));
  assert.ok(!html.includes("session-that-must-not-travel"), "a session id from the raw log reached the generated page");
  assert.ok(!html.includes(minutesAgo(1)), "a heartbeat timestamp reached the generated page");
  assert.ok(!html.includes("user:kamil"), "an actor from the raw log reached the generated page");
  assert.match(html, /let IN_FLIGHT = \{\}/, "the page starts with something other than an empty signal map");
});

test("the log this suite writes stays in the throwaway home", () => {
  // The positive control on the isolation itself: without it every case above
  // could be writing a person's real working calendar, and all of them would
  // still be green.
  const root = fixture([beat(1)]);
  assert.ok(readActivity(root, "FX-1").length > 0);
  assert.ok(process.env.BACKLOG_HOME === HOME || process.env.XDG_DATA_HOME === HOME || HOME.includes("branchling-test-"));
});
