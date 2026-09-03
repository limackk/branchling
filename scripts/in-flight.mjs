/**
 * A task being WORKED ON, between the two writes that are all the backlog
 * records (TL-189).
 *
 * A task file changes exactly twice per session: `next`/`take` writes `status`
 * and `owner` at the start, `done` writes `status` at the end. Everything
 * between those two writes is invisible in the backlog, because the backlog
 * records DECISIONS, not work. A reader watching a fleet through statuses alone
 * sees two frames of a two-hour film, and pushing those two frames faster
 * (TL-122) does not add a third.
 *
 * The material already exists: the heartbeat log records per-session evidence
 * that somebody was at the keyboard. This module is the rule for reducing it to
 * ONE signal per task and for putting that signal into words.
 *
 * WHAT THE SIGNAL MAY CLAIM, AND WHAT IT MAY NOT. Not a spinner: a spinner is a
 * claim with no evidence behind it, and it spins just as convincingly over a
 * session that died an hour ago. The three things the log actually holds are
 * the last heartbeat's timestamp, the actor it names and how many rows have
 * arrived since the take — and every one of them is a fact rather than an
 * inference. A session that stopped therefore READS as stopped, which is the
 * same distinction a dead session is spotted by (TL-151).
 *
 * NO IMPORTS, on purpose: this file is pasted verbatim into the generated page
 * (`readModuleSource` in build-viewer.mjs), the way elsewhere.mjs and
 * estimate.mjs are, so the browser and `node --test` run one implementation of
 * the wording. The reducing half runs on the server, which is the only side that
 * may read the raw log at all — see `inFlightSignal`.
 *
 * Tests: `node --test scripts/tests/viewer-in-flight.test.mjs`
 */

/**
 * Which heartbeat kinds are evidence that somebody is AT THE KEYBOARD NOW.
 *
 * THE SAME SET AS `HEARTBEAT_KINDS` in activity.mjs, repeated here rather than
 * imported and pinned against it by a test — the same trade activity.mjs itself
 * makes with `ATTRIBUTIONS`. The reason is the paste above: a module inlined
 * into the page may only reach names an earlier paste defined, and pulling in a
 * module that opens files to get three strings would put `node:fs` into the
 * browser's paste order for no gain.
 *
 * The exclusions carry more weight here than they do for minutes. A `commit`
 * row is almost always BACKFILLED out of git, so it is evidence about a file at
 * a reconstructed instant, not about a person being present — and a backfill run
 * today would light up every closed task in the backlog as freshly worked on.
 */
export const IN_FLIGHT_KINDS = ["tool", "prompt", "edit"];

/**
 * One task's rows → the one signal, or `null` when the log says nothing.
 *
 * SERVER-SIDE ONLY, and that is a boundary rather than a detail. The raw log
 * lives outside every repository, in the user's data directory (§9 of
 * docs/backlog-time-tracking.md — a real path, product-name: allow), because a
 * record of what hour somebody worked cannot be taken back out of a public
 * history. The viewer's server runs on the machine that holds that log and may
 * read it; the GENERATED page may not carry the result, because that file is
 * mailed around and opened over file://. So this function is called by the
 * server for one HTTP response and never at build time.
 *
 * `since` IS THE TAKE, and the window matters. Counting every row a task ever
 * collected would report the previous person's stint as this one's, and a task
 * picked up, dropped and picked up again would read as one long run. Rows older
 * than the take are therefore not merely uncounted — they do not set `last`
 * either, so a task taken a minute ago with all its heartbeats from last week
 * correctly reads as "nothing heard yet" rather than as a week-old session.
 *
 * WHY THE SESSIONS ARE COUNTED. Parallel sessions on one task is a real state,
 * not an edge case (rule 3 in cluster.mjs), and a signal naming one actor would
 * quietly report two agents as one.
 *
 * @param {object[]} rows one task's activity rows, corrections already applied
 * @param {{since?: string|null}} opts `since` = when the task was taken
 * @returns {null | {last: string, actor: string, session: string,
 *                   events: number, sessions: number, since: string|null}}
 */
export function inFlightSignal(rows, opts = {}) {
  const sinceText = opts && opts.since ? String(opts.since) : null;
  const since = sinceText ? Date.parse(sinceText) : null;
  const window = since !== null && !Number.isNaN(since) ? since : null;

  let lastAt = null;
  let last = "";
  let actor = "";
  let session = "";
  let events = 0;
  const sessions = new Set();

  for (const row of rows || []) {
    if (!row || IN_FLIGHT_KINDS.indexOf(row.kind) < 0) continue;
    const at = Date.parse(row.ts || "");
    if (Number.isNaN(at)) continue;
    if (window !== null && at < window) continue;
    events++;
    if (row.session) sessions.add(String(row.session));
    // `>=` so that the LAST row of a tie wins: rows arrive in id order, which is
    // time order, and two rows sharing a second are ordered by the file, not by
    // the clock.
    if (lastAt === null || at >= lastAt) {
      lastAt = at;
      last = String(row.ts);
      actor = String(row.actor || "");
      session = String(row.session || "");
    }
  }
  if (lastAt === null) return null;
  return { last, actor, session, events, sessions: sessions.size, since: sinceText };
}

/** "less than a minute", "3 minutes", "2 hours", "4 days" — the AGE, without
 *  the "ago", so a caller may put it in a sentence of its own shape.
 *
 *  FLOOR, NEVER ROUND. "3 minutes ago" then means AT LEAST three minutes, and a
 *  gap is never reported as smaller than it was — which is the direction that
 *  matters, because the whole point is that silence must become visible. */
export function ageLabel(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n < 60000) return "less than a minute";
  const minutes = Math.floor(n / 60000);
  if (minutes < 90) return minutes + " minute" + (minutes === 1 ? "" : "s");
  const hours = Math.floor(n / 3600000);
  if (hours < 48) return hours + " hour" + (hours === 1 ? "" : "s");
  const days = Math.floor(n / 86400000);
  return days + " day" + (days === 1 ? "" : "s");
}

/** The same age in the width a badge on a card has: `2m`, `3h`, `4d`. */
export function shortAgeLabel(ms) {
  const n = Number(ms);
  if (!isFinite(n) || n < 60000) return "now";
  const minutes = Math.floor(n / 60000);
  if (minutes < 90) return minutes + "m";
  const hours = Math.floor(n / 3600000);
  if (hours < 48) return hours + "h";
  return Math.floor(n / 86400000) + "d";
}

/**
 * Is this signal still evidence of somebody working, and how old is it?
 *
 * THE THRESHOLD IS `idle_gap_minutes` AND IS NOT A NEW NUMBER. The project has
 * already declared how long a gap between heartbeats ends a working session —
 * that key is what `cluster.mjs` splits runs on. Inventing a second threshold
 * here would let the page call a task "being worked on" over an interval the
 * same project's own minutes report had already cut in two, and nothing would
 * say which was right.
 *
 * `<=` AT THE BOUNDARY, deciding it the same way rule 2 in cluster.mjs decides
 * it. Either answer is defensible; an undecided one is not.
 *
 * @param {null|{last: string}} signal
 * @param {{now?: number|string|Date, idleGapMinutes?: number}} opts
 * @returns {{known: boolean, working: boolean, ageMs: number,
 *            age: string, short: string}}
 */
export function inFlightState(signal, opts = {}) {
  const gapMinutes = Number(opts.idleGapMinutes);
  const gapMs = (isFinite(gapMinutes) && gapMinutes > 0 ? gapMinutes : 10) * 60000;
  const nowRaw = opts.now === undefined ? Date.now() : opts.now;
  const now = nowRaw instanceof Date ? nowRaw.getTime() : Number(new Date(nowRaw).getTime());
  const at = signal ? Date.parse(signal.last || "") : NaN;
  if (Number.isNaN(at) || Number.isNaN(now)) {
    return { known: false, working: false, ageMs: 0, age: "", short: "" };
  }
  // A stamp from the future is clock skew between two machines, not work done in
  // advance: clamped to zero rather than reported as a negative age.
  const ageMs = Math.max(0, now - at);
  return {
    known: true,
    working: ageMs <= gapMs,
    ageMs,
    age: ageLabel(ageMs),
    short: shortAgeLabel(ageMs),
  };
}

/**
 * The signal in one sentence, for a title attribute and for the detail panel.
 *
 * IT NEVER SAYS "WORKING" WITHOUT SAYING WHEN. The reader's question is not
 * "is a flag set" but "should I still be waiting for this", and only the age
 * answers it. So the age is in every branch, including the one that has just
 * heard from the session.
 */
export function inFlightPhrase(signal, state) {
  if (!signal || !state || !state.known) return "";
  const parts = [];
  parts.push((state.working ? "Being worked on — last heard from " : "Last heard from ") + state.age + " ago");
  if (signal.actor) parts.push("by " + signal.actor);
  if (signal.sessions > 1) parts.push("in " + signal.sessions + " sessions");
  const count = signal.events + " event" + (signal.events === 1 ? "" : "s");
  parts.push(signal.since ? count + " since it was taken" : count + " recorded");
  return parts.join(", ");
}

/**
 * How a task's CARD is marked while somebody is on it.
 *
 * THE MARK IS ONLY EVER ON A LIVE SIGNAL. A card carrying it for a session that
 * stopped an hour ago would be the spinner this module exists instead of: the
 * mark would then be on every task anybody ever touched, and a mark on every
 * card is no mark. The stopped case keeps its badge — the age is still worth
 * reading, and reading it is how a dead session is found — but loses the
 * highlight.
 *
 * @returns {{className: string, title: string}} empty strings when nothing is known
 */
export function inFlightCardAttrs(signal, state) {
  if (!signal || !state || !state.known) return { className: "", title: "" };
  return {
    className: state.working ? "in-flight" : "in-flight-stale",
    title: inFlightPhrase(signal, state),
  };
}

/**
 * When the task was TAKEN — the instant the window in `inFlightSignal` opens.
 *
 * THE LAST TRANSITION INTO THE IN-PROGRESS STATUS, not the first: a task picked
 * up, put down and picked up again has two stints, and reporting them as one
 * would credit this session with the previous one's rows. The first transition
 * is the right answer to a different question (how long has this been open),
 * and that question already has `created:`.
 *
 * THE STATUS COMES IN AS A VALUE, never as a literal here (third law). A project
 * whose statuses are `todo`/`doing` sets `in_progress_status`, and a rule
 * naming `in_progress` would simply never fire there — silently, which is the
 * failure mode the whole signal exists against.
 *
 * @param {object[]} entries one task's history entries
 * @param {string} inProgressStatus the value `take`/`next` writes
 * @returns {string|null} an ISO timestamp, or null when the task was never taken
 */
export function takeTimestamp(entries, inProgressStatus) {
  const target = String(inProgressStatus || "");
  if (!target) return null;
  let best = null;
  let bestAt = null;
  for (const e of entries || []) {
    if (!e || e.field !== "status" || String(e.to) !== target) continue;
    const at = Date.parse(e.ts || "");
    if (Number.isNaN(at)) continue;
    if (bestAt === null || at >= bestAt) { bestAt = at; best = String(e.ts); }
  }
  return best;
}

/**
 * Does this task's card carry the signal at all?
 *
 * TWO CASES AND NOT ONE, because the interesting states are not symmetrical. A
 * task the backlog says is in progress carries it ALWAYS, including when it has
 * been quiet for three hours — that badge is precisely how a session that died
 * is spotted, and hiding it would restore the two-frame film. A task in any
 * other status carries it only while the signal is LIVE, which is the honest
 * anomaly: heartbeats arriving on a task somebody has already closed.
 *
 * Everything else — a task closed last week whose log still holds the rows that
 * measured it — shows nothing. That is history, `Measured` already reports it,
 * and a badge on every card the log ever saw is no badge.
 */
export function inFlightVisible(task, state, opts = {}) {
  if (!state || !state.known) return false;
  if (state.working) return true;
  return String((task && task.status) || "") === String(opts.inProgressStatus || "");
}
