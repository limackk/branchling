/**
 * The board, replayed from the event log (TL-91).
 *
 * WHAT THE FEATURE IS. `history/<ID>.jsonl` already knows every status
 * transition with a timestamp, so "what did the board look like on 2026-06-12" is
 * a fold, not a stored snapshot — state = fold(log), which is the architecture
 * this repository is built on. Nothing new is written and nothing new is kept
 * (law 2): delete the replay and a rebuild brings it back unchanged.
 *
 * WHAT THIS FILE HAS TO RULE OUT — the four ways a replay is wrong while every
 * frame still looks plausible:
 *
 *   1. AN EMPTY BOARD PRESENTED AS A FACT. The log begins on the day the tool
 *      began keeping it, and every task older than that had a life before the
 *      first row. A slider that runs back past that day and draws zero columns
 *      is not showing an empty backlog, it is showing that it does not know —
 *      and the two render identically. `docs/backlog-field-editing-history.md` §6 refused a
 *      git backfill for exactly this reason: a pretty and untrue answer. So the
 *      central case here is the NEGATIVE one, and it is asserted before any
 *      frame inside the range is trusted.
 *   2. A SECOND DEFINITION OF WHAT A TASK LOOKED LIKE. `stateAt()` already
 *      exists in `task-graph.mjs` and says so in its own header: it is shared
 *      with this feature on purpose. A replay that folds the log a second time
 *      would eventually disagree with the task graph about the same week, with
 *      nothing to say which picture is right. The agreement is asserted over
 *      a fixture built to be awkward — a deletion and a re-creation, two
 *      entries in the same millisecond, an entry with no namespace on its actor.
 *   3. A STATUS INVENTED FOR A TASK THE LOG NEVER STATED ONE FOR. A task whose
 *      history starts mid-life exists but has no status in the log. Dropping it
 *      into the first column, or into today's frontmatter value, claims for the
 *      past a fact nobody recorded. It gets a bucket of its own.
 *   4. A GREEN MODULE THE PAGE NEVER CALLS. The fold and the drawing live in a
 *      module so `node --test` can reach them; the last cases pin the page to
 *      that module, because a rule nothing invokes passes every test above it.
 *
 * THE VOCABULARY IS THE FIXTURE'S. `todo`, `doing`, `done` are a fixture's
 * words for its own states; asserting the statuses in this project's
 * `config.yaml` would assert somebody else's data (third law).
 *
 * Tests: node --test scripts/tests/board-replay.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  REPLAY_HASH_ROUTE,
  STATUS_UNKNOWN,
  boardAt,
  encodeReplayHash,
  parseReplayHash,
  renderReplayBoard,
  replayTimeline,
} from "../board-replay.mjs";
import { ACTOR_GLYPH, stateAt } from "../task-graph.mjs";
import { buildHtml, computeStats } from "../build-viewer.mjs";
import { loadConfig } from "../config.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each file
// in its own process, so one call covers every case in it.
isolateHome("board-replay");

// ──────────────────────────────────────────────────────────────────────────
// The fixture: a log built by hand, to be awkward on purpose
// ──────────────────────────────────────────────────────────────────────────
//
// Written out rather than produced by running the tool, so a change to the
// WRITING path cannot make the READING path pass by accident.
//
//   FX-1  created, worked, moved to another board, finished — by an agent.
//   FX-2  created, deleted, and created again. Its `__created__` and its first
//         status share a millisecond, which is what `new` actually writes.
//   FX-3  the task the log met in the middle: one entry, on a field that is not
//         `status`, by an actor with no namespace (the `legacy` case).
const HISTORY = {
  "FX-1": [
    { ts: "2026-06-10T09:00:00.000Z", field: "__created__", from: "", to: "First", actor: "user:ada" },
    { ts: "2026-06-10T09:00:00.000Z", field: "status", from: "", to: "todo", actor: "user:ada" },
    { ts: "2026-06-11T09:00:00.000Z", field: "status", from: "todo", to: "doing", actor: "agent:claude" },
    { ts: "2026-06-12T09:00:00.000Z", field: "board", from: "main", to: "later", actor: "agent:claude" },
    { ts: "2026-06-13T09:00:00.000Z", field: "status", from: "doing", to: "done", actor: "agent:claude" },
  ],
  "FX-2": [
    { ts: "2026-06-11T10:00:00.000Z", field: "__created__", from: "", to: "Second", actor: "user:ada" },
    { ts: "2026-06-11T10:00:00.000Z", field: "status", from: "", to: "todo", actor: "user:ada" },
    { ts: "2026-06-12T09:00:00.000Z", field: "status", from: "todo", to: "doing", actor: "user:ada" },
    { ts: "2026-06-12T12:00:00.000Z", field: "__deleted__", from: "", to: "", actor: "user:ada" },
    { ts: "2026-06-14T08:00:00.000Z", field: "__created__", from: "", to: "Second again", actor: "user:ada" },
    { ts: "2026-06-14T08:00:00.000Z", field: "status", from: "", to: "todo", actor: "user:ada" },
  ],
  "FX-3": [
    { ts: "2026-06-12T08:00:00.000Z", field: "priority", from: "P2", to: "P1", actor: "ada" },
  ],
};

const FIRST_KNOWN = "2026-06-10T09:00:00.000Z";
const LAST_KNOWN = "2026-06-14T08:00:00.000Z";

/** Moments chosen so that each one is a different shape of answer. */
const BEFORE = "2026-06-01T00:00:00.000Z";   // earlier than anything logged
const M1 = "2026-06-10T12:00:00.000Z";       // one task known, two not yet
const M2 = "2026-06-12T18:00:00.000Z";       // one deleted, one with no status
const M3 = "2026-06-14T12:00:00.000Z";       // everything back, all three known
const AFTER = "2026-07-01T00:00:00.000Z";    // later than anything logged

const MOMENTS = [M1, M2, M3, AFTER];

test("the fixture is awkward in all three ways the cases below rely on", () => {
  // The positive control on the DATA. Every assertion in this file is a claim
  // about a log with a deletion, a same-millisecond pair and an actor with no
  // namespace in it; against a simpler fixture they would all pass and prove
  // nothing.
  const flat = Object.values(HISTORY).flat();
  assert.ok(flat.some((e) => e.field === "__deleted__"), "no deletion in the fixture");
  assert.equal(
    HISTORY["FX-2"][4].ts, HISTORY["FX-2"][5].ts,
    "the re-creation and its status no longer share a millisecond — the ordering case is gone"
  );
  assert.ok(flat.some((e) => e.actor.indexOf(":") === -1), "no actor without a namespace in the fixture");
  assert.ok(
    !HISTORY["FX-3"].some((e) => e.field === "status"),
    "FX-3 has gained a status — the 'log met it in the middle' case is gone"
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 1. Before the log begins is NOT an empty board
// ──────────────────────────────────────────────────────────────────────────

test("a moment before the log begins is unknown, not an empty backlog", () => {
  // The case the whole feature stands or falls on. A fold that simply counts
  // nothing before the first row passes every other test in this file and
  // tells the reader the project did not exist in May.
  const frame = boardAt(HISTORY, BEFORE);
  assert.equal(frame.known, false, "a moment the log cannot speak about is being reported as fact");
  assert.deepEqual(frame.tasks, [], "tasks were placed on a board the log knows nothing about");
  assert.deepEqual(frame.byStatus, {});
  assert.equal(frame.total, 0);
  // The frame has to carry the boundary itself — the caller cannot label an
  // axis "history since …" from a bare `false`.
  assert.equal(frame.firstKnown, FIRST_KNOWN);
});

test("POSITIVE CONTROL: a moment inside the range is a real board", () => {
  // Without this the assertions above are satisfied by a fold that answers
  // "unknown" to every question ever asked of it.
  const frame = boardAt(HISTORY, M3);
  assert.equal(frame.known, true);
  assert.equal(frame.total, 3, "the fold reports nothing at a moment when three tasks are logged");
  assert.deepEqual(frame.byStatus, { done: 1, todo: 1, [STATUS_UNKNOWN]: 1 });
});

test("a moment after the last entry is known — the board simply stopped moving", () => {
  // The other end of the slider. Silence after the last row is not a gap in
  // what is known:
  // the log covers that moment and says nothing changed.
  const frame = boardAt(HISTORY, AFTER);
  assert.equal(frame.known, true, "'nothing has happened since' is being reported as 'we do not know'");
  assert.equal(frame.total, 3);
  assert.equal(frame.lastKnown, LAST_KNOWN);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. One fold, shared with the task graph
// ──────────────────────────────────────────────────────────────────────────

test("every frame agrees, task by task, with stateAt()", () => {
  // The assertion that keeps one fold from becoming two. `stateAt()` is
  // exported from task-graph.mjs
  // saying it is shared with this feature; this is what "shared" has to mean in
  // practice — a second fold would pass its own tests and disagree here.
  for (const at of MOMENTS) {
    const frame = boardAt(HISTORY, at);
    const expected = Object.keys(HISTORY).filter((id) => stateAt(HISTORY[id], at).exists === true);
    assert.deepEqual(
      frame.tasks.map((t) => t.id).sort(), expected.sort(),
      "the set of tasks on the board at " + at + " is not the set stateAt() says exists"
    );
    for (const t of frame.tasks) {
      const fields = stateAt(HISTORY[t.id], at).fields;
      assert.equal(
        t.status, fields.status || STATUS_UNKNOWN,
        t.id + " at " + at + ": the replayed status is not the folded one"
      );
    }
  }
});

test("a deleted task leaves the board and a re-created one comes back", () => {
  const ids = (at) => boardAt(HISTORY, at).tasks.map((t) => t.id);
  assert.ok(ids(M2).indexOf("FX-2") === -1, "a task deleted before this moment is still on the board");
  assert.ok(ids(M3).indexOf("FX-2") >= 0, "a task created again is not back on the board");
  // …and it comes back with the status of the SECOND life, not the first.
  assert.equal(boardAt(HISTORY, M3).tasks.find((t) => t.id === "FX-2").status, "todo");
});

test("a task the log has not met yet is absent, not empty", () => {
  // `stateAt()` answers `exists: null` here rather than `false`, and the
  // difference matters: FX-3 plainly existed on 2026-06-10, the log just had not
  // met it. Either way it is not on the board — what must not happen is a
  // column entry with no status behind it.
  const frame = boardAt(HISTORY, M1);
  assert.deepEqual(frame.tasks.map((t) => t.id), ["FX-1"]);
  assert.deepEqual(frame.byStatus, { todo: 1 });
});

test("two entries in the same millisecond keep the order the log wrote them in", () => {
  // FX-2's re-creation and its status share a timestamp. A sort that is not
  // stable would leave the task either with no status or deleted at M3, and both
  // answers look like a plausible frame.
  const t = boardAt(HISTORY, M3).tasks.find((x) => x.id === "FX-2");
  assert.equal(t.status, "todo");
});

// ──────────────────────────────────────────────────────────────────────────
// 3. A status nobody recorded is not a status
// ──────────────────────────────────────────────────────────────────────────

test("a task whose status the log never stated gets a bucket of its own", () => {
  const t = boardAt(HISTORY, M2).tasks.find((x) => x.id === "FX-3");
  assert.ok(t, "FX-3 is on no board at all, though the log has met it by then");
  assert.equal(t.status, STATUS_UNKNOWN, "a status was invented for a task the log never stated one for");
});

test("the unknown bucket is not a word the project might be using itself", () => {
  // It is a NAMED export rather than a literal buried in the fold, because a
  // project whose vocabulary happened to contain it would silently merge two
  // different facts into one column. The fixture declares its own statuses, and
  // the bucket must not be one of them.
  const config = loadConfig(fixtureRoot());
  assert.ok(
    config.statuses.indexOf(STATUS_UNKNOWN) === -1,
    "the bucket for 'the log does not say' collides with a status a project declared"
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 4. The timeline the slider runs along
// ──────────────────────────────────────────────────────────────────────────

test("the timeline covers the days the log covers, and says where it starts", () => {
  const line = replayTimeline(HISTORY);
  assert.equal(line.firstKnown, FIRST_KNOWN);
  assert.equal(line.lastKnown, LAST_KNOWN);
  // Every day from 2026-06-10 to 2026-06-14 — a day counter, not a row
  // counter: the reader is moving through a calendar.
  assert.deepEqual(line.days, ["2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]);
});

test("NEGATIVE CONTROL: no log at all is no timeline, not a timeline of one day", () => {
  // Without this the slider would render a range against a backlog that has
  // never recorded anything, and the reader would move through invented days.
  assert.deepEqual(replayTimeline({}), { firstKnown: null, lastKnown: null, days: [] });
  assert.deepEqual(replayTimeline(null), { firstKnown: null, lastKnown: null, days: [] });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Who moved it — the class of the actor, never the name
// ──────────────────────────────────────────────────────────────────────────

test("each task carries the class of the actor that last moved it", () => {
  // TL-52's rule, and rule 3 of task-graph.mjs: the NAMESPACE is the fact. The
  // name is a person or a session and belongs in a tooltip, not in a class.
  const by = Object.fromEntries(boardAt(HISTORY, M3).tasks.map((t) => [t.id, t]));
  assert.equal(by["FX-1"].actorClass, "agent", "an agent's change is not marked as one");
  assert.equal(by["FX-2"].actorClass, "user");
  assert.equal(by["FX-3"].actorClass, "legacy", "an actor with no namespace is being guessed at");
  // The name travels too — the distinction is drawn from the class, but a
  // reader asking "who" must not have to open the history to find out.
  assert.equal(by["FX-1"].actor, "agent:claude");
});

test("the actor is the one of the LAST change, not of the creation", () => {
  // FX-1 was created by a person and finished by an agent. A frame that keeps
  // the creator would paint the whole board human on any backlog an agent
  // worked through — which is precisely the picture this feature exists to show.
  const early = boardAt(HISTORY, M1).tasks.find((t) => t.id === "FX-1");
  const late = boardAt(HISTORY, M3).tasks.find((t) => t.id === "FX-1");
  assert.equal(early.actorClass, "user");
  assert.equal(late.actorClass, "agent");
});

// ──────────────────────────────────────────────────────────────────────────
// 6. The board a task was on is itself replayed
// ──────────────────────────────────────────────────────────────────────────

test("a frame carries the fields as they were, not as they are today", () => {
  // The board is a field like any other and it changes. A replay scoped by the
  // task's CURRENT board would put FX-1 in `later` on 2026-06-10, three days
  // before anybody moved it there — a frame that is wrong about the past in
  // exactly the way a reader cannot see.
  const early = boardAt(HISTORY, M1).tasks.find((t) => t.id === "FX-1");
  const late = boardAt(HISTORY, M3).tasks.find((t) => t.id === "FX-1");
  assert.equal(late.fields.board, "later");
  assert.ok(
    !("board" in early.fields),
    "a board was claimed for a moment before the log says anything about it"
  );
});

// ──────────────────────────────────────────────────────────────────────────
// 7. The moment is in the link
// ──────────────────────────────────────────────────────────────────────────

test("a moment survives a round trip through the URL", () => {
  // "The board on 2026-06-12" has to be something you can send to somebody. The
  // contract follows viewer-url.mjs: a parameter omitted means the DEFAULT, not
  // "keep whatever the recipient had".
  const hash = encodeReplayHash({ at: M2, board: "main" });
  assert.ok(hash.startsWith(REPLAY_HASH_ROUTE + "?"), "the replay has no route of its own: " + hash);
  const back = parseReplayHash(hash.slice(hash.indexOf("?") + 1));
  assert.equal(back.at, M2, "the moment did not survive the link");
  assert.equal(back.board, "main");
});

test("the moment is a moment, not a day", () => {
  // A day-only parameter would make the animation impossible to link:
  // everything within one day would encode to the same address.
  const back = parseReplayHash(encodeReplayHash({ at: M1 }).split("?")[1]);
  assert.equal(back.at, M1);
  assert.notEqual(parseReplayHash(encodeReplayHash({ at: M2 }).split("?")[1]).at, back.at);
});

test("a link with no moment in it means the default, not the recipient's state", () => {
  assert.deepEqual(parseReplayHash(""), { at: null, board: null });
  assert.deepEqual(parseReplayHash(null), { at: null, board: null });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. What is drawn
// ──────────────────────────────────────────────────────────────────────────
//
// The renderer lives beside the fold for the reason task-graph.mjs gives: in the
// page it would be unreachable from `node --test`, and the strongest assertion
// left would be a regular expression over the finished HTML — which passes just
// as well for a fold that returns the wrong answer.

test("a frame the log cannot speak about draws the boundary, not an empty board", () => {
  const out = renderReplayBoard(boardAt(HISTORY, BEFORE));
  assert.match(out, /history since/i, "the page draws no data boundary — the reader sees an empty backlog");
  assert.ok(out.includes("2026-06-10"), "the boundary is drawn without saying where it is");
});

test("POSITIVE CONTROL: a frame inside the range draws the counts", () => {
  const out = renderReplayBoard(boardAt(HISTORY, M3));
  assert.doesNotMatch(out, /history since/i, "a real frame is being drawn as the no-data boundary");
  for (const status of ["done", "todo"]) {
    assert.ok(out.includes(status), "the column for " + status + " is not drawn");
  }
});

test("an agent's task is distinguishable from a person's, and not by colour alone", () => {
  // TL-52 seen from the picture's side: the hue is emphasis, the mark is the
  // fact. A page that separates the two by colour only says nothing to a reader
  // who cannot tell the two hues apart, and nothing at all in print.
  const out = renderReplayBoard(boardAt(HISTORY, M3));
  assert.ok(out.includes("actor-agent"), "an agent's task carries no class of its own");
  assert.ok(out.includes("actor-user"), "a person's task carries no class of its own");
  assert.ok(out.includes(ACTOR_GLYPH.agent), "the agent mark is carried by colour alone");
  assert.ok(out.includes(ACTOR_GLYPH.user), "the human mark is carried by colour alone");
  assert.notEqual(ACTOR_GLYPH.agent, ACTOR_GLYPH.user, "the two marks are the same — they distinguish nothing");
});

// ──────────────────────────────────────────────────────────────────────────
// 9. The page
// ──────────────────────────────────────────────────────────────────────────

/** A backlog with a vocabulary of its own. Never this project's (third law). */
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "branchling-board-replay-"));
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
      "",
    ].join("\n"),
    "utf8"
  );
  return root;
}

const TASKS = [
  {
    id: "FX-1", title: "First", board: "later", labels: [], blocked_by: [], blocks: [],
    related_docs: [], epic: "", status: "done", priority: "P1", type: "task", bodyHtml: "",
    elsewhere: [],
  },
];

/** How many times a needle occurs. Counting is what tells a PASTE apart from a
 *  CALL: the definition contributes its own occurrences and nothing else. */
function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function builtPage() {
  return buildHtml(TASKS, computeStats(TASKS), loadConfig(fixtureRoot()), HISTORY);
}

test("viewer: the page carries the source of board-replay.mjs and CALLS it", () => {
  // Case 4 of the header. Pasted and never invoked, the module is green here and
  // absent from the product.
  const src = readFileSync(join(SCRIPTS_DIR, "board-replay.mjs"), "utf8");
  const html = builtPage();

  for (const name of ["boardAt", "replayTimeline", "renderReplayBoard"]) {
    assert.ok(src.includes("function " + name + "("), "the module changed shape — fix the marker in this test");
    assert.ok(html.includes("function " + name + "("), name + " did not reach the page");
    assert.ok(
      occurrences(html, name + "(") > occurrences(src, name + "("),
      "the page carries " + name + " but never calls it"
    );
  }
});

test("viewer: the replay is a view of its own that a link can address", () => {
  // Pinned to the tab mechanism the page already has, rather than to the bare
  // word: once the module is pasted the route string is in the file either way,
  // and "the constant reached the page" would be true of a replay nobody can
  // open.
  const html = builtPage();
  assert.ok(
    html.includes('data-view="' + REPLAY_HASH_ROUTE + '"'),
    "the replay is not one of the page's views — there is no way to open it"
  );
  assert.ok(occurrences(html, "parseReplayHash(") > 1, "the page never reads a moment out of the address");
});

test("the replay reaches for nothing outside the page it was built into", () => {
  // "Works under file:// and writes nothing" (TL-91's acceptance criteria) is
  // one property: the fold runs on the history the page already carries. A
  // request of any kind would make the replay work on a served page and fail
  // silently on the file somebody was sent.
  const src = readFileSync(join(SCRIPTS_DIR, "board-replay.mjs"), "utf8");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "writeFileSync", "appendFileSync"]) {
    assert.ok(!src.includes(forbidden), "the replay reaches for " + forbidden + " — it cannot run from a file");
  }
  // THE POSITIVE CONTROL ON THE SEARCH ITSELF. `fetch(` is a string that really
  // does occur in this page's code; without this, the assertion above would be
  // satisfied just as well by a typo in the needle.
  assert.ok(builtPage().includes("fetch("), "the search string matches nothing anywhere — the check above proves nothing");
});
