/**
 * The task change graph — a fold over the history, with nothing stored (TL-116).
 *
 * WHAT HAS TO BE PROVED, and every item has a POSITIVE control, because a fold
 * that returns nothing passes every "it did not draw the wrong thing" assertion:
 *
 *   - each node kind is produced from the entry that means it, and an entry that
 *     means none of them is COLLAPSED rather than dropped — the count on screen
 *     has to agree with the log;
 *   - a question with an answer is joined to it, and one without is OPEN;
 *   - `agent:` is a different class from a person's, and `unknown`/`legacy` a
 *     third — never folded into either, because the log does not say which they
 *     were;
 *   - a task deleted and created again keeps both events, in order;
 *   - the left edge is labelled as the start of the DATA, not of the task;
 *   - `stateAt()` is one fold, shared with the board time-lapse (TL-91).
 *
 * The fixture's vocabulary is its own: the statuses below appear in no
 * configuration this repository ships, so a literal in the fold fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACTOR_GLYPH, actorClass, nodeKind, nodeLabel, renderTaskGraph, stateAt, taskGraph,
} from "../task-graph.mjs";

import { isolateHome } from "./_repo.mjs";

// The suite must not read the DEVELOPER's preferences: since TL-157 the actor
// chain reads the user layer, so a machine with `actor:` in its own config file
// would otherwise see every default-actor assertion below fail.
isolateHome("task-graph");

let seq = 0;
/** A day on the axis. Small numbers only — the tests name the days they mean. */
const at = (n) => "2026-03-" + String(10 + n).padStart(2, "0") + "T09:00:00.000Z";
/** A minute on one day, for entries whose exact day does not matter. */
const tick = (n) => "2026-03-10T09:" + String(n % 60).padStart(2, "0") + ":00.000Z";
const entry = (over = {}) => ({
  id: "E" + String(++seq).padStart(3, "0"),
  ts: tick(seq),
  task: "MAP-1",
  field: "status",
  from: "icebox",
  to: "surveying",
  actor: "agent:worker",
  source: "cli",
  ...over,
});

// ── Which entries become nodes ────────────────────────────────────────────

test("every node kind is produced by the entry that means it", () => {
  assert.equal(nodeKind({ field: "__created__" }), "created");
  assert.equal(nodeKind({ field: "__deleted__" }), "deleted");
  assert.equal(nodeKind({ field: "__comment__", source: "ask" }), "question");
  assert.equal(nodeKind({ field: "__comment__", source: "handoff" }), "message");
  assert.equal(nodeKind({ field: "__comment__", source: "release" }), "message");
  assert.equal(nodeKind({ field: "__decision__" }), "decision");
  assert.equal(nodeKind({ field: "status" }), "status");
  assert.equal(nodeKind({ field: "owner" }), "handoff");
  assert.equal(nodeKind({ field: "role" }), "handoff");
});

test("an ordinary field change is NOT a node", () => {
  for (const field of ["priority", "estimate", "title", "__body__", "__verified__"]) {
    assert.equal(nodeKind({ field }), null, field + " must not be a node");
  }
});

test("collapsed changes are counted and named, never dropped", () => {
  const g = taskGraph([
    entry({ field: "__created__", from: "", to: "A task" }),
    entry({ field: "priority", from: "P2", to: "P1" }),
    entry({ field: "estimate", from: "2h", to: "1d" }),
    entry({ field: "status", from: "icebox", to: "surveying" }),
  ]);
  assert.deepEqual(g.nodes.map((n) => n.kind), ["created", "status"]);
  assert.equal(g.collapsed, 2);
  // They belong to the node they led UP TO: "what happened on the way here".
  assert.deepEqual(g.nodes[1].collapsed.map((c) => c.field), ["priority", "estimate"]);
  assert.equal(g.total, 4, "the total has to be every entry, or the picture disagrees with the log");
});

test("a run of changes AFTER the last node still shows up in the count", () => {
  const g = taskGraph([
    entry({ field: "status" }),
    entry({ field: "priority", from: "P2", to: "P3" }),
  ]);
  assert.equal(g.nodes.length, 1);
  assert.equal(g.collapsed, 1);
  assert.deepEqual(g.trailing.map((c) => c.field), ["priority"]);
});

test("entries arrive in any order and come out oldest first", () => {
  const a = entry({ ts: at(3), field: "status", to: "surveying" });
  const b = entry({ ts: at(1), field: "__created__", from: "", to: "A task" });
  const g = taskGraph([a, b]);
  assert.deepEqual(g.nodes.map((n) => n.kind), ["created", "status"]);
  assert.equal(g.firstKnown, at(1));
  assert.equal(g.lastKnown, at(3));
});

test("a task deleted and created again keeps BOTH events, in order", () => {
  const g = taskGraph([
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(2), field: "__deleted__", from: "A task", to: "" }),
    entry({ ts: at(3), field: "__created__", from: "", to: "A task" }),
  ]);
  assert.deepEqual(g.nodes.map((n) => n.kind), ["created", "deleted", "created"]);
});

test("an empty history is an empty graph, not a crash", () => {
  const g = taskGraph([]);
  assert.deepEqual(g.nodes, []);
  assert.equal(g.firstKnown, null);
  assert.match(renderTaskGraph(g), /No recorded events yet/);
});

// ── Questions and their answers ───────────────────────────────────────────

test("a question with an answer is JOINED to it and is not open", () => {
  const q = entry({ id: "Q1", ts: at(1), field: "__comment__", source: "ask", from: "", to: "Which way?" });
  const d = entry({ id: "D1", ts: at(2), field: "__decision__", from: "", to: "That way.", resolves: "Q1" });
  const g = taskGraph([q, d]);
  assert.equal(g.nodes[0].open, false);
  assert.deepEqual(g.links, [{ from: "Q1", to: "D1", kind: "answers" }]);
});

test("a question nothing has answered is OPEN — the state somebody must act on", () => {
  const g = taskGraph([entry({ id: "Q1", field: "__comment__", source: "ask", from: "", to: "Which way?" })]);
  assert.equal(g.nodes[0].open, true);
  assert.match(nodeLabel(g.nodes[0]), /open/);
  assert.match(renderTaskGraph(g), /is-open/);
});

test("an answer recorded BEFORE the reader meets the question still closes it", () => {
  // The one-pass version of this fold marks such a question open, which is a
  // wrong answer that only appears in logs written out of order.
  const g = taskGraph([
    entry({ id: "D1", ts: at(2), field: "__decision__", from: "", to: "That way.", resolves: "Q1" }),
    entry({ id: "Q1", ts: at(1), field: "__comment__", source: "ask", from: "", to: "Which way?" }),
  ]);
  assert.equal(g.nodes.find((n) => n.id === "Q1").open, false);
});

test("operational comments stay visible as messages and never acquire question links", () => {
  const comment = entry({ id: "H1", ts: at(1), field: "__comment__", source: "handoff", from: "", to: "the reviewer has the release context" });
  const decision = entry({ id: "D1", ts: at(2), field: "__decision__", from: "", to: "recorded separately", resolves: "H1" });
  const g = taskGraph([comment, decision]);
  assert.equal(g.nodes[0].kind, "message");
  assert.equal(g.nodes[0].open, false);
  assert.match(nodeLabel(g.nodes[0]), /^message:/);
  assert.deepEqual(g.links, [], "an operational comment must not become an answerable question");
  assert.match(renderTaskGraph(g), /is-message/);
  assert.doesNotMatch(renderTaskGraph(g), /question · open/);
});

test("a decision pointing at an id this log does not have draws NO arrow", () => {
  const g = taskGraph([
    entry({ id: "D1", field: "__decision__", from: "", to: "Decided.", resolves: "Q-elsewhere" }),
  ]);
  assert.deepEqual(g.links, [], "half an arrow claims a pairing nobody can check");
  assert.equal(g.nodes[0].resolves, "Q-elsewhere", "the reference itself is not erased");
});

// ── Who made the change ───────────────────────────────────────────────────

test("an agent, a person and an unrecorded actor are THREE classes, not two", () => {
  assert.equal(actorClass("agent:claude"), "agent");
  assert.equal(actorClass("local:me"), "local");
  assert.equal(actorClass("user:ann"), "user");
  assert.equal(actorClass("unknown"), "unknown");
  // A bare name predates the namespace convention: it may have been either, and
  // calling it a person would reclassify half of them.
  assert.equal(actorClass("claude"), "legacy");
});

test("the class survives without colour — every one carries a glyph", () => {
  for (const c of ["agent", "local", "user", "legacy", "unknown"]) {
    assert.ok(ACTOR_GLYPH[c], "no glyph for " + c);
  }
  assert.notEqual(ACTOR_GLYPH.agent, ACTOR_GLYPH.local);
  assert.notEqual(ACTOR_GLYPH.agent, ACTOR_GLYPH.unknown);
  assert.equal(ACTOR_GLYPH.legacy, ACTOR_GLYPH.unknown,
    "two shades of not-knowing would suggest the tool can tell them apart");
});

// ── What is drawn ─────────────────────────────────────────────────────────

test("the drawing carries the class, the field to filter by, and the words", () => {
  const g = taskGraph([
    entry({ ts: at(1), field: "__created__", from: "", to: "A task", actor: "unknown" }),
    entry({ ts: at(2), field: "status", from: "icebox", to: "surveying", actor: "agent:worker" }),
    entry({ ts: at(3), field: "owner", from: "", to: "ann", actor: "user:ann" }),
  ]);
  const html = renderTaskGraph(g);
  assert.match(html, /actor-agent/);
  assert.match(html, /actor-user/);
  assert.match(html, /actor-unknown/);
  // Clicking a node narrows the existing per-field history filter, so the field
  // has to travel with the node.
  assert.match(html, /data-graph-field="status"/);
  assert.match(html, /data-graph-field="owner"/);
  // Words, not only marks (TL-52).
  assert.match(html, /icebox → surveying/);
  assert.match(html, /owner → ann/);
});

test("the left edge says it is the start of the DATA, not of the task", () => {
  const html = renderTaskGraph(taskGraph([entry({ ts: at(1), field: "status" })]));
  assert.match(html, /history since 2026-03-11/);
  assert.match(html, /anything earlier is in git/);
});

test("a title carrying HTML cannot break out of the drawing", () => {
  const html = renderTaskGraph(taskGraph([
    entry({ field: "__created__", from: "", to: '<img src=x onerror="alert(1)">' }),
  ]));
  assert.ok(!html.includes("<img"), "the value has to be escaped");
  assert.match(html, /&lt;img/);
});

// ── One fold, shared with the time-lapse (TL-91) ──────────────────────────

test("stateAt replays the log up to a moment and stops there", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(2), field: "status", from: "icebox", to: "surveying" }),
    entry({ ts: at(3), field: "status", from: "surveying", to: "charted" }),
  ];
  assert.equal(stateAt(entries, at(2)).fields.status, "surveying");
  assert.equal(stateAt(entries, at(3)).fields.status, "charted");
});

test("a field the log never mentions is ABSENT, not empty", () => {
  const s = stateAt([entry({ field: "status" })], at(9));
  assert.equal("priority" in s.fields, false,
    "`the history does not say` and `it was blank` are different facts");
});

test("a task whose log begins after it did still EXISTS", () => {
  // No `__created__` anywhere: the log started later. Answering `false` would
  // report a task plainly on disk as one that is not.
  assert.equal(stateAt([entry({ field: "status" })], at(9)).exists, true);
});

test("a deletion is visible in the replay, and so is a later re-creation", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(2), field: "__deleted__", from: "A task", to: "" }),
    entry({ ts: at(3), field: "__created__", from: "", to: "A task" }),
  ];
  assert.equal(stateAt(entries, at(2)).exists, false);
  assert.equal(stateAt(entries, at(3)).exists, true);
});

test("before the first entry, the log says nothing at all", () => {
  assert.equal(stateAt([entry({ ts: at(5), field: "status" })], at(1)).exists, null);
});

// ── The seed: what the fold may know before a field's first change (TL-280) ──
//
// The rule decided in TL-280 and recorded in `backlog/history/TL-280.jsonl`:
// the EARLIEST entry for a field carries `from`, the value it held before that
// change, and that value holds backwards to the log's first entry for the task
// — no further, and never from today's frontmatter or today's template.

test("the value before a field's first change is known, back to the log's start", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(4), field: "status", from: "icebox", to: "surveying" }),
  ];
  // Day 2 is after the log begins and before the only status entry: `from`
  // records what the status WAS then, so the fold is not entitled to shrug.
  assert.equal(stateAt(entries, at(2)).fields.status, "icebox");
  assert.equal(stateAt(entries, at(4)).fields.status, "surveying");
});

test("a seeded value is named as seeded, never passed off as a replayed change", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(4), field: "status", from: "icebox", to: "surveying" }),
  ];
  assert.deepEqual(stateAt(entries, at(2)).seeded, ["status"]);
  assert.deepEqual(stateAt(entries, at(4)).seeded, [],
    "once the change itself is replayed, nothing is inferred any more");
});

test("the seed stops at the log's first entry and does not reach before it", () => {
  const entries = [entry({ ts: at(5), field: "status", from: "icebox", to: "surveying" })];
  const before = stateAt(entries, at(1));
  assert.equal(before.exists, null);
  assert.equal("status" in before.fields, false,
    "`from` extends a field's past to the start of the log, never before it");
});

test("an empty `from` seeds nothing — blank and unrecorded are not the same fact", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(4), field: "owner", from: "", to: "ann" }),
  ];
  assert.equal("owner" in stateAt(entries, at(2)).fields, false);
});

test("a task older than its log and never changed since stays unknown", () => {
  // Only a comment: nothing in the log records a field of this task, so the
  // seed has nothing to work from and must narrow the case, not remove it.
  const entries = [entry({ ts: at(1), field: "__comment__", from: "", to: "a note" })];
  const s = stateAt(entries, at(3));
  assert.equal(s.exists, true);
  assert.equal("status" in s.fields, false);
  assert.deepEqual(s.seeded, []);
});

test("only the EARLIEST entry of a field seeds; a later `from` is not replayed backwards", () => {
  const entries = [
    entry({ ts: at(1), field: "status", from: "icebox", to: "surveying" }),
    entry({ ts: at(5), field: "status", from: "surveying", to: "charted" }),
  ];
  assert.equal(stateAt(entries, at(3)).fields.status, "surveying",
    "day 3 is after the first change, which the replay already covers");
  assert.deepEqual(stateAt(entries, at(3)).seeded, []);
});

test("a list field is seeded by its first `from` as well, and an empty list is not a value", () => {
  const entries = [
    entry({ ts: at(1), field: "__created__", from: "", to: "A task" }),
    entry({ ts: at(4), field: "labels", from: ["chart"], to: ["chart", "fold"] }),
    entry({ ts: at(4), field: "blocked_by", from: [], to: ["MAP-9"] }),
  ];
  const s = stateAt(entries, at(2));
  assert.deepEqual(s.fields.labels, ["chart"]);
  assert.equal("blocked_by" in s.fields, false);
});
