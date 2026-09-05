/**
 * The board as it stood at a moment in time (TL-91).
 *
 * WHAT IT IS. `history/<ID>.jsonl` already records every field change with a
 * timestamp, so "what did the board look like on 2026-06-12" is a FOLD, not a
 * stored snapshot. Nothing is written and nothing is kept (law 2): delete the
 * replay and a rebuild brings it back unchanged. It also means the replay runs
 * on the history the page was built with, so it works on a file somebody was
 * mailed exactly as it does on a served page.
 *
 * THE FOLD IS `stateAt()` FROM task-graph.mjs, NOT A SECOND ONE. A replay with
 * a fold of its own would eventually disagree with the change graph about the
 * same week, with nothing to say which of the two pictures is right. This file
 * arranges what that fold returns into a board; it never decides for itself what
 * a task looked like.
 *
 * THREE THINGS IT REFUSES TO GUESS:
 *
 *   1. **A moment the log cannot speak about is not an empty backlog.** The log
 *      begins on the day the tool began keeping it, and every task older than
 *      that had a life before the first row. `known: false` is that answer, and
 *      the frame carries `firstKnown` so the boundary can be drawn where it is.
 *   2. **A task the log never stated a status for has no status.** It gets
 *      `STATUS_UNKNOWN` — a reserved key, never a value out of somebody's
 *      `config.yaml` — instead of being dropped into the first column or into
 *      today's frontmatter value, either of which claims for the past a fact
 *      nobody recorded.
 *   3. **A field is replayed as it was, not as it is today.** The board a task
 *      sits on is a field like any other and it moves; scoping a frame by the
 *      task's CURRENT board would put it there days before anybody did.
 *
 * The renderer lives here rather than in the page for the reason task-graph.mjs
 * gives: written inside the viewer's template it would be unreachable from
 * `node --test`, and the strongest assertion left would be a regular expression
 * over the finished HTML — which passes just as well for a fold that returns the
 * wrong answer. It returns a string, so it runs in Node with no DOM.
 *
 * Tests: `node --test scripts/tests/board-replay.test.mjs`
 */

import { ACTOR_GLYPH, actorClass, chronological, stateAt } from "./task-graph.mjs";

/** The hash prefix of the replay view — `#replay?at=…`. Renaming it breaks links
 *  already sent. */
export const REPLAY_HASH_ROUTE = "replay";

/**
 * The bucket for "the log does not say what status this had".
 *
 * A NAMED EXPORT rather than a literal buried in the fold, and shaped like the
 * pseudo-fields in `task-fields.mjs` for the same reason: a project whose
 * vocabulary happened to contain this word would silently merge two different
 * facts into one column.
 */
export const STATUS_UNKNOWN = "__unknown__";

const REPLAY_DAY_MS = 86400000;

/** The day an ISO timestamp falls on, in UTC. The default formatter; the page
 *  passes its own. */
function replayDay(ts) {
  return String(ts || "").slice(0, 10);
}

/** The first and the last moment the whole log speaks about. Both are kept as
 *  the STRINGS the log carries — a reformatted timestamp would not compare equal
 *  to the entry it came from. */
function replayBounds(history) {
  let first = null;
  let last = null;
  for (const id of Object.keys(history || {})) {
    for (const e of history[id] || []) {
      if (!e || typeof e.ts !== "string") continue;
      const t = Date.parse(e.ts);
      if (!Number.isFinite(t)) continue;
      if (first === null || t < first.t) first = { t, ts: e.ts };
      if (last === null || t > last.t) last = { t, ts: e.ts };
    }
  }
  return {
    firstKnown: first ? first.ts : null,
    lastKnown: last ? last.ts : null,
    firstMs: first ? first.t : null,
    lastMs: last ? last.t : null,
  };
}

/** The last entry at or before a moment, in the order the log wrote them. Who
 *  moved the task last is the one thing a frame needs that `stateAt()` does not
 *  return — it answers with fields, and an actor is not a field. */
function replayLastEntry(entries, cutoff) {
  let last = null;
  for (const e of chronological(entries)) {
    if (Date.parse(e.ts) > cutoff) break;
    last = e;
  }
  return last;
}

/**
 * The board at a moment.
 *
 * @param {Object<string, Array<object>>} history  `{ "<ID>": [entry, …] }`
 * @param {string|number} at  an ISO timestamp or epoch ms
 * @returns {{known: boolean, at: ?string, tasks: Array<object>,
 *            byStatus: Object<string, number>, total: number,
 *            firstKnown: ?string, lastKnown: ?string}}
 */
export function boardAt(history, at) {
  const log = history || {};
  const bounds = replayBounds(log);
  const cutoff = typeof at === "number" ? at : Date.parse(at);
  const moment = Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null;
  const frame = {
    known: false,
    at: moment,
    tasks: [],
    byStatus: {},
    total: 0,
    firstKnown: bounds.firstKnown,
    lastKnown: bounds.lastKnown,
  };
  // Before the first row, or against a log with no rows at all. Silence AFTER
  // the last row is a different fact and stays `known`: the log covers that
  // moment and says nothing changed.
  if (bounds.firstMs === null || !Number.isFinite(cutoff) || cutoff < bounds.firstMs) return frame;

  frame.known = true;
  for (const id of Object.keys(log).sort()) {
    const entries = log[id] || [];
    const state = stateAt(entries, cutoff);
    // `exists === null` is "the log has not met this task yet" and `false` is
    // "it was deleted". Neither belongs on the board, and only the second is a
    // statement about the task.
    if (state.exists !== true) continue;
    const last = replayLastEntry(entries, cutoff);
    const status = state.fields.status || STATUS_UNKNOWN;
    frame.tasks.push({
      id,
      status,
      fields: state.fields,
      // The actor of the LAST change, never of the creation: a frame that kept
      // the creator would paint the whole board human on any backlog an agent
      // worked through.
      actor: (last && last.actor) || "",
      actorClass: actorClass(last && last.actor),
      ts: last ? last.ts : null,
    });
    frame.byStatus[status] = (frame.byStatus[status] || 0) + 1;
  }
  frame.total = frame.tasks.length;
  return frame;
}

/**
 * The calendar the slider runs along: every day the log covers, and where it
 * starts.
 *
 * DAYS, NOT ROWS. The reader is moving through a calendar, so a week in which
 * nothing happened has to take a week's worth of slider — a row counter would
 * make an idle month look like an afternoon.
 *
 * @returns {{firstKnown: ?string, lastKnown: ?string, days: string[]}}
 */
export function replayTimeline(history) {
  const bounds = replayBounds(history || {});
  if (bounds.firstMs === null) return { firstKnown: null, lastKnown: null, days: [] };
  const days = [];
  for (let t = Date.parse(replayDay(bounds.firstKnown) + "T00:00:00.000Z"); t <= bounds.lastMs; t += REPLAY_DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return { firstKnown: bounds.firstKnown, lastKnown: bounds.lastKnown, days };
}

// ──────────────────────────────────────────────────────────────────────────
// The moment in the link
// ──────────────────────────────────────────────────────────────────────────
//
// The contract follows viewer-url.mjs: a parameter omitted means the DEFAULT,
// never "keep whatever the recipient had". The moment is a MOMENT and not a day,
// because a day-only parameter would encode every frame of one day's animation
// to the same address.

/** @param {{at: ?string, board: ?string}} view */
export function encodeReplayHash(view) {
  const p = new URLSearchParams();
  if (view && view.at) p.set("at", view.at);
  if (view && view.board) p.set("board", view.board);
  return REPLAY_HASH_ROUTE + "?" + p.toString();
}

/** @param {string} query  the part of the hash after "?" */
export function parseReplayHash(query) {
  const p = new URLSearchParams(query || "");
  return { at: p.get("at") || null, board: p.get("board") || null };
}

// ──────────────────────────────────────────────────────────────────────────
// Drawing it
// ──────────────────────────────────────────────────────────────────────────

/** HTML escaping, local on purpose: this file is pasted into a page that is not
 *  a module, so it may not import one. */
function replayEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** What a column is called. The key is the project's word and travels in the
 *  attribute; only the reserved bucket needs a sentence. */
function replayColumnLabel(status) {
  return status === STATUS_UNKNOWN ? "the log does not say" : status;
}

/**
 * One frame as HTML.
 *
 * @param {object} frame  from `boardAt()`
 * @param {{day?: (ts: string) => string, statuses?: string[]}} opts  how a
 *   timestamp reads and the order the columns go in — both injected, so a test
 *   is tied neither to a locale nor to another project's vocabulary
 */
export function renderReplayBoard(frame, opts = {}) {
  const day = (opts && opts.day) || replayDay;

  // THE CASE THE WHOLE FEATURE STANDS OR FALLS ON. A board drawn with no columns
  // reads as "the backlog was empty", and the reader has no way to tell that
  // apart from "the log does not reach this far back".
  if (!frame || frame.known !== true) {
    const since = frame && frame.firstKnown ? day(frame.firstKnown) : "";
    return (
      '<section class="replay-board is-unknown">' +
      '<p class="replay-unknown">This is not an empty board — it is a moment the log cannot speak ' +
      "about: history since " +
      (since ? replayEsc(since) : "nothing at all has been recorded yet") +
      ", and the tasks that were open before that day left no row here. Anything earlier is in git." +
      "</p></section>"
    );
  }

  const order = [];
  for (const s of opts.statuses || []) if (frame.byStatus[s] !== undefined) order.push(s);
  for (const s of Object.keys(frame.byStatus)) if (order.indexOf(s) === -1) order.push(s);

  const columns = order
    .map((status) => {
      const cards = frame.tasks
        .filter((t) => t.status === status)
        .map(
          (t) =>
            '<li class="replay-card actor-' +
            replayEsc(t.actorClass) +
            '" data-replay-task="' +
            replayEsc(t.id) +
            '" title="' +
            replayEsc(t.id + " · last change " + (t.ts || "not recorded") + " by " + (t.actor || "not recorded")) +
            '">' +
            // The glyph, not the hue, carries the fact (TL-52): a page that
            // separates an agent's work from a person's by colour alone says
            // nothing to a reader who cannot tell the two hues apart.
            '<span class="replay-glyph" aria-hidden="true">' +
            replayEsc(ACTOR_GLYPH[t.actorClass] || "?") +
            "</span>" +
            '<span class="replay-id">' +
            replayEsc(t.id) +
            "</span>" +
            '<span class="replay-actor">' +
            replayEsc(t.actor || "not recorded") +
            "</span></li>"
        )
        .join("");
      return (
        '<section class="replay-col" data-status="' +
        replayEsc(status) +
        '"><h3>' +
        replayEsc(replayColumnLabel(status)) +
        ' <span class="replay-count">' +
        frame.byStatus[status] +
        "</span></h3><ul>" +
        cards +
        "</ul></section>"
      );
    })
    .join("");

  const head =
    '<p class="replay-head"><span class="replay-when">' +
    replayEsc(day(frame.at)) +
    '</span><span class="replay-total">' +
    frame.total +
    " task(s)</span><span class=\"replay-range\">the log runs from " +
    replayEsc(day(frame.firstKnown)) +
    " to " +
    replayEsc(day(frame.lastKnown)) +
    "</span></p>";

  return '<section class="replay-board">' + head + '<div class="replay-cols">' + columns + "</div></section>";
}
