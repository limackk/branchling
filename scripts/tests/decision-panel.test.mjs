/**
 * "Waiting on you" — the panel's arithmetic (TL-115).
 *
 * WHAT IS AT RISK, and why each case is paired with its opposite:
 *
 *   1. A QUEUE THAT INCLUDES WORK NOBODY CAN START. A task marked for a person
 *      but still blocked is not waiting on a decision, it is waiting on another
 *      task. Every "it is in the panel" case has an "and this one is not".
 *   2. A QUESTION THAT WILL NOT CLOSE. `openQuestions` is the definition of the
 *      state; the control is a fixture where one question is answered and
 *      another, in the same log, is not.
 *   3. AN ORDER THAT ARGUES FOR THE WRONG DECISION. `unblocks` is counted
 *      TRANSITIVELY and only over tasks this one actually releases — a task
 *      with another open blocker must not be counted, or the panel would
 *      promote a decision that frees nothing.
 *   4. A MENU THAT WAS NEVER OFFERED. The options a question was asked with
 *      travel on its row (TL-204) so the panel can render them, and the control
 *      is a question asked WITHOUT any: it must carry an empty menu, never an
 *      invented one, because the panel is read by somebody who cannot go and
 *      check the log.
 *
 * The statuses are the FIXTURE's own: this project's words are not the tool's
 * contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { decisionPanel, minePanel, unblocksCount } from "../decision-panel.mjs";
import { FIELD_COMMENT, FIELD_DECISION } from "../task-fields.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("decision-panel");

const ARCHIVED = ["shipped"];
const task = (over) => ({
  id: "FX-0", title: "", status: "queued", priority: "P2", owner: "", role: "",
  executor: "", blocked_by: [], blocks: [], ...over,
});
const panel = (tasks, history, opts) =>
  decisionPanel(tasks, history || {}, { archivedStatuses: ARCHIVED, now: Date.parse("2026-02-10T00:00:00Z"), ...(opts || {}) });

const comment = (id, ts, text, actor) => ({ id, ts, field: FIELD_COMMENT, source: "ask", from: "", to: text, actor });
const decision = (id, ts, text, resolves) => ({ id, ts, field: FIELD_DECISION, from: "", to: text, resolves, actor: "local:k" });

// ── Tasks marked for a person ─────────────────────────────────────────────

test("an unblocked `executor: human` task is in the panel", () => {
  const rows = panel([task({ id: "FX-1", executor: "human", title: "decide the shape" })]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "task");
  assert.deepEqual(rows[0].why, ["executor"]);
});

test("POSITIVE CONTROL: the same task, still blocked, is NOT in the panel", () => {
  const rows = panel([
    task({ id: "FX-1", executor: "human", blocked_by: ["FX-2"] }),
    task({ id: "FX-2", status: "queued" }),
  ]);
  assert.deepEqual(rows, []);
  // …and it appears the moment its blocker closes.
  const after = panel([
    task({ id: "FX-1", executor: "human", blocked_by: ["FX-2"] }),
    task({ id: "FX-2", status: "shipped" }),
  ]);
  assert.deepEqual(after.map((r) => r.id), ["FX-1"]);
});

test("a closed task marked for a person is not waiting for anybody", () => {
  assert.deepEqual(panel([task({ id: "FX-1", executor: "human", status: "shipped" })]), []);
});

test("a task with no `executor` and no unserved role is not in the panel", () => {
  assert.deepEqual(panel([task({ id: "FX-1" })]), []);
});

test("a role nobody here serves puts a task in the panel — but only when the roles are KNOWN", () => {
  const tasks = [task({ id: "FX-1", role: "analyst" })];
  // The page does not know the agent map, so with no `servedRoles` the row must
  // not appear: guessing an empty map would put every roled task in the queue.
  assert.deepEqual(panel(tasks), []);
  const rows = panel(tasks, {}, { servedRoles: ["developer"] });
  assert.deepEqual(rows.map((r) => r.why), [["role"]]);
  // And a role that IS served is not a decision waiting for anybody.
  assert.deepEqual(panel(tasks, {}, { servedRoles: ["analyst"] }), []);
});

// ── Questions ─────────────────────────────────────────────────────────────

test("an unanswered question is a row; an answered one is gone", () => {
  const history = {
    "FX-1": [
      comment("Q1", "2026-02-08T00:00:00Z", "which of the two do we build", "agent:worker"),
      comment("Q2", "2026-02-09T00:00:00Z", "and who pays for it", "agent:worker"),
      decision("D1", "2026-02-09T12:00:00Z", "the first one", "Q1"),
    ],
  };
  const rows = panel([task({ id: "FX-1", title: "the task" })], history);
  assert.deepEqual(rows.map((r) => r.eventId), ["Q2"]);
  assert.equal(rows[0].question, "and who pays for it");
  assert.equal(rows[0].asker, "agent:worker");
  assert.equal(rows[0].ageDays, 1);
});

test("a question on a CLOSED task is not waiting on anybody", () => {
  const history = { "FX-1": [comment("Q1", "2026-02-08T00:00:00Z", "?", "agent:worker")] };
  assert.deepEqual(panel([task({ id: "FX-1", status: "shipped" })], history), []);
});

// ── The menu a question was asked with (TL-204, rendered by TL-205) ────────

test("a question asked with options carries them, in order, and names the recommended one", () => {
  const q = comment("Q1", "2026-02-08T00:00:00Z", "split it or take it whole", "agent:worker");
  q.options = ["split it into four — each design gets its own session", "take it whole in a fresh session"];
  q.recommend = 2;
  const rows = panel([task({ id: "FX-1" })], { "FX-1": [q] });
  assert.equal(rows.length, 1);
  // The order is the asker's, and the number `decide --choose` takes is the
  // position in this array plus one — nothing here may reorder it.
  assert.deepEqual(rows[0].options, q.options);
  assert.equal(rows[0].recommend, 2);
});

test("POSITIVE CONTROL: a question asked with NO options invents none", () => {
  // The three states on disk are different things (TL-204): no `options` key is
  // an event written before the flag existed, `[]` is a session that offered
  // none. Neither may become a menu, and neither may become a missing field the
  // renderer has to test for.
  const older = comment("Q1", "2026-02-08T00:00:00Z", "written before options existed", "agent:worker");
  const none = comment("Q2", "2026-02-08T00:00:00Z", "no enumerable answers", "agent:worker");
  none.options = [];
  const rows = panel([task({ id: "FX-1" })], { "FX-1": [older, none] });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.deepEqual(r.options, []);
    assert.equal(r.recommend, null);
  }
});

test("the row's options are a COPY: mutating them cannot rewrite the log in memory", () => {
  const q = comment("Q1", "2026-02-08T00:00:00Z", "?", "agent:worker");
  q.options = ["one", "two"];
  q.recommend = 1;
  const rows = panel([task({ id: "FX-1" })], { "FX-1": [q] });
  rows[0].options.push("three");
  assert.deepEqual(q.options, ["one", "two"]);
});

test("a recommendation that is not a positive whole number is dropped, not passed on", () => {
  // A hand-edited log is the only way to get here, and a renderer comparing a
  // row number against `"2"` or `0` would mark the wrong option, or none, with
  // no sign that anything was wrong.
  for (const bad of ["2", 0, -1, 1.5, null, undefined, true]) {
    const q = comment("Q1", "2026-02-08T00:00:00Z", "?", "agent:worker");
    q.options = ["one", "two"];
    q.recommend = bad;
    const rows = panel([task({ id: "FX-1" })], { "FX-1": [q] });
    assert.equal(rows[0].recommend, null, "recommend: " + String(bad));
  }
  // …and the control: a good one survives.
  const ok = comment("Q1", "2026-02-08T00:00:00Z", "?", "agent:worker");
  ok.options = ["one", "two"];
  ok.recommend = 1;
  assert.equal(panel([task({ id: "FX-1" })], { "FX-1": [ok] })[0].recommend, 1);
});

test("a task row carries no menu: only a question was ever asked with one", () => {
  const rows = panel([task({ id: "FX-1", executor: "human" })]);
  assert.equal(rows[0].kind, "task");
  assert.equal(rows[0].options, undefined);
  assert.equal(rows[0].recommend, undefined);
});

// ── The order ─────────────────────────────────────────────────────────────

test("unblocksCount follows the chain, and stops at what stays blocked", () => {
  const byId = new Map([
    ["FX-1", task({ id: "FX-1", executor: "human" })],
    ["FX-2", task({ id: "FX-2", blocked_by: ["FX-1"] })],
    ["FX-3", task({ id: "FX-3", blocked_by: ["FX-2"] })],
    // Waits on FX-1 AND on something still open: finishing FX-1 releases nothing here.
    ["FX-4", task({ id: "FX-4", blocked_by: ["FX-1", "FX-9"] })],
    ["FX-9", task({ id: "FX-9" })],
  ]);
  assert.equal(unblocksCount("FX-1", byId, ARCHIVED), 2);
  // POSITIVE CONTROL: close the other blocker and FX-4 joins the chain.
  byId.set("FX-9", task({ id: "FX-9", status: "shipped" }));
  assert.equal(unblocksCount("FX-1", byId, ARCHIVED), 3);
});

test("a cycle in `blocked_by` does not hang the count", () => {
  const byId = new Map([
    ["FX-1", task({ id: "FX-1", blocked_by: ["FX-2"] })],
    ["FX-2", task({ id: "FX-2", blocked_by: ["FX-1"] })],
  ]);
  assert.equal(unblocksCount("FX-1", byId, ARCHIVED), 1);
});

test("the panel is ordered by what a decision releases, not by age", () => {
  const tasks = [
    task({ id: "FX-1", executor: "human", title: "frees nothing" }),
    task({ id: "FX-2", executor: "human", title: "frees two" }),
    task({ id: "FX-3", blocked_by: ["FX-2"] }),
    task({ id: "FX-4", blocked_by: ["FX-3"] }),
  ];
  assert.deepEqual(panel(tasks).map((r) => r.id), ["FX-2", "FX-1"]);
});

test("at an equal count a question outranks a task: somebody is actually waiting", () => {
  const tasks = [
    task({ id: "FX-1", executor: "human" }),
    task({ id: "FX-2" }),
  ];
  const history = { "FX-2": [comment("Q1", "2026-02-01T00:00:00Z", "well?", "agent:worker")] };
  assert.deepEqual(panel(tasks, history).map((r) => r.kind), ["question", "task"]);
});

// ── "Only mine" ───────────────────────────────────────────────────────────

test("the mine filter matches a declared actor, as owner or as asker", () => {
  const tasks = [
    task({ id: "FX-1", executor: "human", owner: "local:kamil" }),
    task({ id: "FX-2", executor: "human", owner: "agent:worker" }),
    task({ id: "FX-3" }),
  ];
  const history = { "FX-3": [comment("Q1", "2026-02-01T00:00:00Z", "?", "local:kamil")] };
  const rows = panel(tasks, history);
  assert.deepEqual(minePanel(rows, "local:kamil").map((r) => r.id), ["FX-3", "FX-1"]);
  // No actor declared is not a filter: it would silently empty the panel.
  assert.equal(minePanel(rows, "").length, rows.length);
});
