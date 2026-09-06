/**
 * One task's history, folded into a graph (TL-116).
 *
 * WHAT IT IS FOR. The detail view already lists the history entry by entry, and
 * that list is denser than any picture. What it does not answer at a glance is
 * WHERE THE TASK WENT: who handed it on, who asked, who decided, and how much
 * of the movement was a person's. This fold answers that, and the list stays —
 * two renderings of the same events, not a second mechanism.
 *
 * IT STORES NOTHING (law 2). Every node below is derived from
 * `history/<ID>.jsonl`; delete the graph and a rebuild brings it back
 * unchanged. That is also why it works under `file://`: the page carries the
 * history it was built with, so a single file can be sent to somebody.
 *
 * WHY THE FOLD IS A MODULE AND NOT PAGE CODE. Written inside the viewer's
 * template it would be unreachable from `node --test`, and the strongest
 * assertion left would be a regular expression over the finished HTML — which
 * passes just as well for a fold that returns the wrong answer. This file is
 * pasted into the page BY SOURCE, so the browser and the test run the same code.
 *
 * FOUR RULES THE SHAPE OF THE GRAPH FOLLOWS:
 *
 *   1. **A NODE IS A SIGNIFICANT EVENT, not every entry.** Status transitions,
 *      `role` and `owner` changes, creation and deletion, comments and
 *      decisions. Everything else — a priority, an estimate, a title — is real
 *      but is not where the task WENT, and drawn as nodes it makes the graph of
 *      any long-lived task unreadable. Those collapse into a run between two
 *      nodes, counted and listed, so nothing is hidden: the reader can see
 *      exactly how many changes are in the gap and what they touched.
 *   2. **A QUESTION AND ITS ANSWER ARE JOINED**, by the `resolves` link
 *      `decide` writes (TL-114). A question nothing has answered is marked
 *      OPEN, because that is the state somebody has to act on.
 *   3. **THE ACTOR'S NAMESPACE IS THE CLASS**, never the name: `agent`,
 *      `local`, `user`, `legacy`, `unknown`. `unknown` and `legacy` get a class
 *      of their own rather than being folded into "human" — some of those
 *      entries were agents and some were people, and choosing for them would be
 *      inventing attribution the log does not have.
 *   4. **THE START OF THE DATA IS NOT THE START OF THE TASK.** The first node
 *      carries `firstKnown`, and the caller labels the axis "history since …".
 *      A graph whose left edge silently means "the day we started logging"
 *      tells the reader the task was born then.
 *
 * SHARED WITH TL-91. `stateAt()` is the same fold a board time-lapse replays;
 * it is exported here so the two cannot drift into two definitions of what a
 * task looked like on a given day.
 *
 * Tests: `node --test scripts/tests/task-graph.test.mjs`
 */

import { FIELD_COMMENT, FIELD_CREATED, FIELD_DECISION, FIELD_DELETED, actorParts, isQuestion } from "./task-fields.mjs";

/**
 * The fields whose change is a node of its own.
 *
 * `status` is where the work is; `owner` and `role` are who it is with — TL-99
 * calls a change to those a handoff, and a handoff is the single most useful
 * thing this graph shows. Nothing else in the frontmatter says where the task
 * went.
 */
export const NODE_FIELDS = ["status", "owner", "role"];

/** The pseudo-fields that are nodes. A body edit and a vouched manual entry are
 *  deliberately NOT here: they happen TO the task without moving it. */
export const NODE_EVENTS = [FIELD_CREATED, FIELD_DELETED, FIELD_COMMENT, FIELD_DECISION];

/** Which class of identity made a change. Never the name — see rule 3. */
export function actorClass(actor) {
  return actorParts(actor).namespace;
}

/** Oldest first, and stable: two entries sharing a timestamp keep the order the
 *  log wrote them in, which is the order they happened in.
 *
 *  Exported for the same reason `stateAt()` is: the board time-lapse (TL-91)
 *  needs the last entry before a moment, and a second ordering of its own would
 *  be free to disagree about which of two entries sharing a millisecond came
 *  last — the case `new` writes on every task it creates. */
export function chronological(entries) {
  return (entries || [])
    .filter((e) => e && typeof e.ts === "string")
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.ts === b.e.ts ? a.i - b.i : String(a.e.ts).localeCompare(String(b.e.ts))))
    .map((x) => x.e);
}

/** What kind of node an entry becomes, or `null` when it is not one. */
export function nodeKind(entry) {
  const field = entry && entry.field;
  if (field === FIELD_CREATED) return "created";
  if (field === FIELD_DELETED) return "deleted";
  if (field === FIELD_COMMENT) return isQuestion(entry) ? "question" : "message";
  if (field === FIELD_DECISION) return "decision";
  if (field === "status") return "status";
  if (field === "owner" || field === "role") return "handoff";
  return null;
}

/**
 * The graph of one task.
 *
 * @param {Array<object>} entries  the task's history, in any order
 * @returns {{nodes: Array<object>, links: Array<object>, firstKnown: string|null,
 *            lastKnown: string|null, total: number, collapsed: number}}
 */
export function taskGraph(entries) {
  const ordered = chronological(entries);
  if (!ordered.length) {
    return { nodes: [], links: [], trailing: [], firstKnown: null, lastKnown: null, total: 0, collapsed: 0 };
  }

  // Which questions have an answer. Computed over the WHOLE log first: a
  // decision may be recorded before the reader scrolls to the question, and a
  // one-pass fold would mark an answered question open until it met the answer.
  const questionIds = new Set(ordered.filter(isQuestion).map((e) => e.id).filter(Boolean));
  const answeredBy = new Map();
  for (const e of ordered) {
    if (e.field === FIELD_DECISION && typeof e.resolves === "string" && questionIds.has(e.resolves)) {
      answeredBy.set(e.resolves, e.id || null);
    }
  }

  const nodes = [];
  const links = [];
  let pending = [];
  let collapsed = 0;

  const flushInto = (node) => {
    // The collapsed run belongs to the node that FOLLOWS it: the reader is
    // looking at where the task went next, and "what happened on the way here"
    // is the question the dots answer.
    node.collapsed = pending.map((e) => ({ field: e.field, ts: e.ts, actor: e.actor || "" }));
    collapsed += pending.length;
    pending = [];
  };

  for (const e of ordered) {
    const kind = nodeKind(e);
    if (!kind) { pending.push(e); continue; }
    const node = {
      id: e.id || null,
      kind,
      field: e.field,
      ts: e.ts,
      actor: e.actor || "",
      actorClass: actorClass(e.actor),
      from: e.from || "",
      to: e.to || "",
      reason: e.reason || "",
      source: e.source || "",
      collapsed: [],
      // A question is OPEN until something resolves it. This is the only piece
      // of state on a node, and it is the one a reader can act on.
      open: kind === "question" ? !(e.id && answeredBy.has(e.id)) : false,
      resolves: typeof e.resolves === "string" ? e.resolves : null,
    };
    flushInto(node);
    nodes.push(node);
    if (node.resolves && questionIds.has(node.resolves)) links.push({ from: node.resolves, to: node.id, kind: "answers" });
  }

  // A run of collapsed changes AFTER the last node has nothing following it, so
  // it hangs off the last node as a trailing run rather than being dropped —
  // dropping it would make the count on screen disagree with the log.
  const trailing = pending.map((e) => ({ field: e.field, ts: e.ts, actor: e.actor || "" }));
  collapsed += trailing.length;

  // Only links whose BOTH ends are on the graph. A decision pointing at an id
  // this log does not carry is a dangling reference, and drawing half an arrow
  // would claim a pairing nobody can check.
  const present = new Set(nodes.map((n) => n.id).filter(Boolean));
  const drawn = links.filter((l) => present.has(l.from) && present.has(l.to));

  return {
    nodes,
    links: drawn,
    trailing,
    // The axis starts where the DATA starts, and the caller has to say so.
    firstKnown: ordered[0].ts,
    lastKnown: ordered[ordered.length - 1].ts,
    total: ordered.length,
    collapsed,
  };
}

/**
 * What the task's fields looked like at a moment in time.
 *
 * SHARED WITH THE BOARD TIME-LAPSE (TL-91) on purpose. Two folds would
 * eventually disagree about what a task's status was on a given day, and the
 * disagreement would surface as a chart and a graph telling different stories
 * about the same week.
 *
 * A field the log never mentions is ABSENT from the answer rather than empty:
 * "the history does not say" and "it was blank" are different facts, and only
 * the first is true of a backlog whose log begins after the task did.
 *
 * @param {Array<object>} entries
 * @param {string|number} at  an ISO timestamp or epoch ms; entries after it are ignored
 */
export function stateAt(entries, at) {
  const cutoff = typeof at === "number" ? at : Date.parse(at);
  const state = {};
  // `null` until the log says anything at all: a task whose history begins after
  // it was created has no `__created__` entry, and answering `false` there would
  // report a task that plainly exists as one that does not.
  let exists = null;
  for (const e of chronological(entries)) {
    if (Date.parse(e.ts) > cutoff) break;
    if (exists === null) exists = true;
    if (e.field === FIELD_CREATED) { exists = true; continue; }
    if (e.field === FIELD_DELETED) { exists = false; continue; }
    if (String(e.field).startsWith("__")) continue;
    state[e.field] = e.to || "";
  }
  return { exists, fields: state };
}

// ──────────────────────────────────────────────────────────────────────────
// Drawing it
// ──────────────────────────────────────────────────────────────────────────
//
// The renderer lives beside the fold and not in the page for the reason given
// at the top: a test can then assert what is DRAWN, not only what was computed.
// It returns a string of HTML — no DOM, so it runs in Node.

/** HTML escaping, local on purpose: this file is pasted into a page that is not
 *  a module, so it may not import one. */
function graphEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A glyph per class of identity, so the distinction survives without colour.
 *
 * TL-52's rule applied to a picture: the hue is emphasis, the mark is the fact.
 * `unknown` and `legacy` share the question mark deliberately — both mean "the
 * log does not say who", and inventing two shades of not-knowing would suggest
 * the tool can tell them apart.
 */
export const ACTOR_GLYPH = { agent: "▲", local: "●", user: "●", legacy: "?", unknown: "?" };

/** What a node says about itself, in words. Never a colour alone. */
export function nodeLabel(node) {
  // A message says WHAT was said, cut to something that fits under a dot; the
  // whole sentence is in the tooltip and, in full, in the list beside the graph.
  const gist = (s) => {
    const one = String(s || "").replace(/\s+/g, " ").trim();
    return one.length > 34 ? one.slice(0, 33) + "…" : one;
  };
  if (node.kind === "created") return "created: " + gist(node.to);
  if (node.kind === "deleted") return "deleted";
  if (node.kind === "question") return (node.open ? "question · open" : "question") + ": " + gist(node.to);
  if (node.kind === "message") return "message: " + gist(node.to);
  if (node.kind === "decision") return "decision: " + gist(node.to);
  if (node.kind === "handoff") return (node.field === "role" ? "role" : "owner") + " → " + (node.to || "nobody");
  return (node.from || "—") + " → " + (node.to || "—");
}

const STEP = 132;
const PAD = 40;
const AXIS_Y = 78;
const RADIUS = 9;

/**
 * The graph as inline SVG inside a scrollable frame.
 *
 * WHY THE SPACING IS BY INDEX AND NOT BY TIME. A task worked in one afternoon
 * and then left for a month would draw as two dots and a very long line — the
 * shape of the calendar rather than the shape of the work. Every node carries
 * its timestamp as text and in its tooltip, so the calendar is still readable
 * where the reader wants it.
 *
 * @param {object} graph  from `taskGraph()`
 * @param {{day?: (ts: string) => string}} opts  how a timestamp reads; injected
 *   so the page can use its own formatter and a test is not tied to a locale
 */
export function renderTaskGraph(graph, opts = {}) {
  const day = opts.day || ((ts) => String(ts || "").slice(0, 10));
  if (!graph || !graph.nodes.length) {
    return '<section class="tgraph is-empty"><p>No recorded events yet. The history is kept from the ' +
      "moment the tool began keeping it — anything earlier lives in git.</p></section>";
  }

  const width = PAD * 2 + Math.max(graph.nodes.length - 1, 0) * STEP;
  const x = (i) => PAD + i * STEP;
  const indexOf = new Map(graph.nodes.map((n, i) => [n.id, i]));

  // The answering arcs are drawn FIRST so a node sits on top of its own arc.
  const arcs = graph.links.map((l) => {
    const a = x(indexOf.get(l.from));
    const b = x(indexOf.get(l.to));
    const lift = Math.min(46, 16 + Math.abs(b - a) / 6);
    return '<path class="tgraph-link" d="M' + a + "," + (AXIS_Y - RADIUS) +
      " C" + a + "," + (AXIS_Y - lift) + " " + b + "," + (AXIS_Y - lift) + " " + b + "," + (AXIS_Y - RADIUS) +
      '" />';
  }).join("");

  const marks = graph.nodes.map((n, i) => {
    const cx = x(i);
    const cls = ["tgraph-node", "is-" + n.kind, "actor-" + graphEsc(n.actorClass)];
    if (n.open) cls.push("is-open");
    // The run of ordinary changes that happened on the way to this node: three
    // dots and a count, never silence — the reader has to be able to see that
    // the gap is not empty.
    const dots = n.collapsed.length
      ? '<g class="tgraph-collapsed"><circle cx="' + (cx - STEP / 2 - 8) + '" cy="' + AXIS_Y + '" r="2"/>' +
        '<circle cx="' + (cx - STEP / 2) + '" cy="' + AXIS_Y + '" r="2"/>' +
        '<circle cx="' + (cx - STEP / 2 + 8) + '" cy="' + AXIS_Y + '" r="2"/>' +
        '<text x="' + (cx - STEP / 2) + '" y="' + (AXIS_Y + 18) + '">+' + n.collapsed.length + "</text>" +
        "<title>" + graphEsc(n.collapsed.map((c) => c.field).join(", ")) + "</title></g>"
      : "";
    return dots +
      '<g class="' + cls.join(" ") + '" data-graph-node="' + graphEsc(n.id || "") +
      '" data-graph-field="' + graphEsc(n.field) + '" tabindex="0" role="button">' +
      "<title>" + graphEsc(n.ts + " · " + (n.actor || "unknown") + (n.reason ? " · " + n.reason : "")) + "</title>" +
      '<circle cx="' + cx + '" cy="' + AXIS_Y + '" r="' + RADIUS + '"/>' +
      '<text class="tgraph-glyph" x="' + cx + '" y="' + (AXIS_Y + 4) + '">' +
        graphEsc(ACTOR_GLYPH[n.actorClass] || "?") + "</text>" +
      '<text class="tgraph-when" x="' + cx + '" y="' + (AXIS_Y - 22) + '">' + graphEsc(day(n.ts)) + "</text>" +
      '<text class="tgraph-label" x="' + cx + '" y="' + (AXIS_Y + 34) + '">' + graphEsc(nodeLabel(n)) + "</text>" +
      '<text class="tgraph-actor" x="' + cx + '" y="' + (AXIS_Y + 48) + '">' + graphEsc(n.actor || "unknown") + "</text>" +
      "</g>";
  }).join("");

  // THE LEFT EDGE IS THE START OF THE DATA, NOT OF THE TASK. Said in words, on
  // the picture, because a reader who is not told will read the first node as
  // the day the work began.
  const since = '<p class="tgraph-since">history since ' + graphEsc(day(graph.firstKnown)) +
    " — anything earlier is in git, not here</p>";
  const trailing = graph.trailing && graph.trailing.length
    ? '<p class="tgraph-trailing">' + graph.trailing.length +
      " later change(s) not shown as nodes: " + graphEsc(graph.trailing.map((c) => c.field).join(", ")) + "</p>"
    : "";
  const legend =
    '<p class="tgraph-legend">' +
    '<span class="actor-agent">▲ agent</span>' +
    '<span class="actor-local">● a person</span>' +
    '<span class="actor-unknown">? not recorded</span>' +
    '<span class="tgraph-legend-open">dashed ring: an open question</span>' +
    "</p>";

  return (
    '<section class="tgraph">' + since +
    '<div class="tgraph-scroll"><svg class="tgraph-svg" width="' + width + '" height="140" ' +
    'viewBox="0 0 ' + width + ' 140" role="img" aria-label="Change graph: ' + graph.nodes.length +
    " event(s) between " + graphEsc(day(graph.firstKnown)) + " and " + graphEsc(day(graph.lastKnown)) + '">' +
    '<line class="tgraph-axis" x1="' + PAD + '" y1="' + AXIS_Y + '" x2="' + (width - PAD) + '" y2="' + AXIS_Y + '"/>' +
    arcs + marks +
    "</svg></div>" + trailing + legend +
    "</section>"
  );
}
