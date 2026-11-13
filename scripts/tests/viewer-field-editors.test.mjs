/**
 * The viewer's field editors, scripts/viewer-field-editors.mjs, judged by
 * running them (TL-724).
 *
 * WHAT IS AT RISK. TL-704 moved the editors out of the page template so a
 * mutation run could reach them, and the first run killed 29 of 250 mutants:
 * the only test executing the module asked startEdit() about actor shapes, and
 * the other editing tests matched the built page's TEXT, which a function
 * returning the wrong answer still matches. Here every function is called and
 * its effect asserted: what state it leaves, what it renders, where focus
 * goes, what markup an editor carries, and what saveField() sends and says.
 *
 * WHAT RUNS. The page's PASTE of the module, taken from the built page, so the
 * code judged is the code the browser runs and, inside a mutation run, the
 * instrumented copy Stryker switches mutants in. It is evaluated with
 * `Function` in this realm, not node:vm: Stryker reads the active mutant from
 * `globalThis.process.env`, which a fresh vm context does not have. The page
 * names the paste resolves at call time are supplied as parameters: the
 * page's own `escape()` and `labelTitle()` taken from the built page, the
 * shared functions of task-fields.mjs, and stubs for the page state, the
 * renderers, the DOM and `fetch`. The fields come from `buildFieldSpecs()`
 * over a fixture configuration, never from this repository's vocabulary.
 *
 * EQUIVALENT MUTANTS, NOT MISSING ASSERTIONS. A whole-module mutation run on
 * 2026-11-13 killed 243 of 250; the line-76 survivor (`< 0` as `<= 0`) is
 * killed by the index-0 select test below. The other six change no
 * observable behaviour, so no test is written against them:
 * - line 79, the `""` in `String(value || "")`: an empty value never matches
 *   an option, because options are non-empty.
 * - line 82, `spec.kind === "list"` as `true`: buildFieldSpecs() sets
 *   `closed` only through `closedFrom` and `alwaysClosed`
 *   (task-fields.mjs, buildFieldSpecs), and both shapes carrying them are
 *   lists.
 * - line 84, `(value || [])` as `["Stryker was here"]`: the result differs
 *   only when an option is literally that string.
 * - line 91, `value == null` as `false`: the page's escape() already turns
 *   null and undefined into "" (build-viewer.mjs, escape).
 * - line 96, saveLines() without `.trim()` or without `.filter(Boolean)`:
 *   saveField() sends normalizeValue()'s result, and normalizeValue() trims
 *   every list item and drops the blank ones (task-fields.mjs, the `list`
 *   branch), so the request body is the same.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, readTasks } from "../build-viewer.mjs";
import { actorRefusal, buildFieldSpecs, fieldSpec, isValidActor, normalizeValue, sameValue } from "../task-fields.mjs";
import { BACKLOG_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-field-editors");

const PAGE = buildHtml(readTasks(BACKLOG_DIR));
const PASTE_OPEN = "// ─── Pasted source of scripts/viewer-field-editors.mjs";
const PASTE_CLOSE = "// ─── end of the pasted module";
const EDITORS = [
  "fieldLabel", "dynamicOptions", "startEdit", "cancelEdit", "editorHtml",
  "saveSelected", "saveText", "saveLines", "saveChips", "saveField",
];

function functionSource(page, name) {
  const start = page.indexOf("function " + name + "(");
  if (start < 0) return null;
  const open = page.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < page.length; i++) {
    if (page[i] === "{") depth++;
    else if (page[i] === "}" && --depth === 0) return page.slice(start, i + 1);
  }
  return null;
}

function pastedEditors(page) {
  const start = page.indexOf(PASTE_OPEN);
  if (start < 0) return null;
  const end = page.indexOf(PASTE_CLOSE, start);
  return end < 0 ? null : page.slice(start, end);
}

const PASTE = pastedEditors(PAGE);
const PAGE_HELPERS = ["escape", "labelTitle"].map((name) => functionSource(PAGE, name));

const CONFIG = {
  statuses: ["pending", "in_progress", "done"],
  priorities: ["P1", "P2"],
  labels: ["ui", "api"],
  externalTargets: ["web", "worker"],
  taskIdPrefix: "X",
  titleMaxLength: 80,
};
const FIELDS = buildFieldSpecs(CONFIG);
const spec = (key) => fieldSpec(key, FIELDS);

/**
 * A fresh page around the pasted editors. `overrides` replaces any page name;
 * `responses` is the queue of answers the `fetch` stub gives, each
 * `{ status, body }` or `{ status, reject: true }` for a body that is not JSON.
 */
function harness(overrides = {}) {
  const calls = { renders: [], focus: [], byId: [], selectors: [], fetches: [], refreshes: [] };
  const focusable = (label) => ({ focus() { calls.focus.push(label); } });
  const page = {
    CAN_EDIT: true,
    DEDICATED_FIELDS: {},
    FIELDS,
    ALL_TASKS: [
      { id: "X-1", title: "First", status: "pending", board: "main", epic: "Launch", owner: "user:ann", labels: ["ui"], revision: "r1" },
      { id: "X-2", title: "Second", status: "done", board: "ops", epic: " Billing ", owner: "", labels: [], revision: "r2" },
      { id: "X-3", title: "Third", status: "pending", board: "main", epic: "Launch", owner: null, revision: "r3" },
    ],
    HISTORY: { "X-1": [{ field: "status", to: "pending" }] },
    state: { actor: "user:kamil", editing: { id: "X-9", field: "epic" }, editMessage: "stale", editError: true },
    responses: [],
    renderDetail() { calls.renders.push({ ...page.state }); },
    async refreshFromServer(force) { calls.refreshes.push(force); },
    knownBoards() { return [{ slug: "main", name: "Main" }, { slug: "ops", name: "Ops" }]; },
    document: {
      getElementById(id) { calls.byId.push(id); return focusable("#" + id); },
      querySelector(selector) { calls.selectors.push(selector); return page.editorFocus; },
    },
    editorFocus: focusable("[data-editor-focus]"),
    window: { VIEWER_WRITE: { token: "cap-123" } },
    async fetch(url, init) {
      calls.fetches.push({ url, init, state: { ...page.state } });
      const answer = page.responses.shift() || { status: 200, body: {} };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => { if (answer.reject) throw new SyntaxError("not JSON"); return answer.body; },
      };
    },
    actorRefusal, fieldSpec, isValidActor, normalizeValue, sameValue,
    ...overrides,
  };
  // The page names resolve through `with`, so they are read from `page` at
  // call time and a test may reassign one after the harness is built, as the
  // page itself does when it refreshes ALL_TASKS from the server.
  const body = [
    ...PAGE_HELPERS,
    "with (__page) { return (function () {",
    PASTE,
    "return { " + EDITORS.join(", ") + " };",
    "})(); }",
  ].join("\n");
  const editors = new Function("__page", body)(page);
  return { page, calls, ...editors };
}

test("the paste declares every field editor, and the harness reaches each one", () => {
  assert.ok(PASTE, "the page no longer pastes viewer-field-editors.mjs");
  for (const name of EDITORS) assert.ok(functionSource(PASTE, name), "the paste no longer declares " + name + "()");
  for (const [i, name] of ["escape", "labelTitle"].entries()) assert.ok(PAGE_HELPERS[i], "the page no longer declares " + name + "()");
  const h = harness();
  for (const name of EDITORS) assert.equal(typeof h[name], "function", name);
});

// ── fieldLabel() and dynamicOptions() ─────────────────────────────────────

test("fieldLabel() names a field by its spec's label, and an unknown key by itself", () => {
  const h = harness();
  assert.equal(h.fieldLabel("blocked_by"), "Blocked by");
  assert.equal(h.fieldLabel("title"), "Title");
  assert.equal(h.fieldLabel("no_such_field"), "no_such_field");
});

test("dynamicOptions() offers the known boards and the distinct, trimmed, sorted epics and owners", () => {
  const h = harness();
  h.page.ALL_TASKS.push({ id: "X-4", epic: "Alpha", owner: "agent:loop", board: "main" });
  assert.deepEqual(h.dynamicOptions(), {
    boards: ["main", "ops"],
    epics: ["Alpha", "Billing", "Launch"],
    owners: ["agent:loop", "user:ann"],
  });
});

test("dynamicOptions() over tasks with no epic or owner offers empty lists, not blanks", () => {
  const h = harness({ ALL_TASKS: [{ id: "X-1", epic: "", owner: null }, { id: "X-2", epic: "   " }] });
  assert.deepEqual(h.dynamicOptions(), { boards: ["main", "ops"], epics: [], owners: [] });
});

// ── startEdit() and cancelEdit() ──────────────────────────────────────────

test("startEdit() does nothing in a page that cannot edit", () => {
  const h = harness({ CAN_EDIT: false });
  const before = { ...h.page.state };
  h.startEdit("X-1", "title");
  assert.deepEqual({ ...h.page.state }, before);
  assert.deepEqual(h.calls.renders, []);
  assert.deepEqual(h.calls.focus, []);
});

test("startEdit() does nothing for a field with dedicated commands, and opens the others", () => {
  const h = harness({ DEDICATED_FIELDS: { status: ["done"] } });
  const before = { ...h.page.state };
  h.startEdit("X-1", "status");
  assert.deepEqual({ ...h.page.state }, before);
  assert.deepEqual(h.calls.renders, []);
  h.startEdit("X-1", "title");
  assert.deepEqual({ ...h.page.state.editing }, { id: "X-1", field: "title" });
});

test("startEdit() with a valid user: identity opens the editor, renders, and focuses it", () => {
  const h = harness();
  h.startEdit("X-2", "epic");
  assert.deepEqual({ ...h.page.state.editing }, { id: "X-2", field: "epic" });
  assert.equal(h.page.state.editMessage, "");
  assert.equal(h.calls.renders.length, 1);
  assert.deepEqual({ ...h.calls.renders[0].editing }, { id: "X-2", field: "epic" }, "rendered after the editor is set");
  assert.deepEqual(h.calls.selectors, ["[data-editor-focus]"]);
  assert.deepEqual(h.calls.focus, ["[data-editor-focus]"]);
  assert.deepEqual(h.calls.byId, []);
});

test("startEdit() tolerates an editor with nothing to focus", () => {
  const h = harness({ editorFocus: null });
  h.page.editorFocus = null;
  h.startEdit("X-2", "epic");
  assert.equal(h.calls.renders.length, 1);
  assert.deepEqual(h.calls.focus, []);
});

test("startEdit() under a refused identity keeps the editor closed and sends focus to the identity field", () => {
  for (const actor of ["", "agent:loop", "kamil", "user:Kamil"]) {
    const h = harness();
    h.page.state.actor = actor;
    h.page.state.editing = null;
    h.page.state.editError = false;
    h.startEdit("X-1", "title");
    assert.equal(h.page.state.editing, null, actor);
    assert.equal(h.page.state.editError, true, actor);
    assert.ok(h.page.state.editMessage.length > 0, actor);
    assert.equal(h.calls.renders.length, 1, actor);
    assert.equal(h.calls.renders[0].editError, true, "rendered after the message is set: " + actor);
    assert.deepEqual(h.calls.byId, ["editingActor"], actor);
    assert.deepEqual(h.calls.focus, ["#editingActor"], actor);
    assert.deepEqual(h.calls.selectors, [], actor);
  }
});

test("startEdit() without an identity asks for one in the page's own words", () => {
  const h = harness();
  h.page.state.actor = "";
  h.startEdit("X-1", "title");
  const bad = actorRefusal("");
  const expected = bad
    ? bad.refusal.charAt(0).toUpperCase() + bad.refusal.slice(1) + ". Enter a user:name identity before editing."
    : "Enter a user:name identity before editing.";
  assert.equal(h.page.state.editMessage, expected);
});

test("cancelEdit() closes the editor and renders", () => {
  const h = harness();
  h.cancelEdit();
  assert.equal(h.page.state.editing, null);
  assert.equal(h.calls.renders.length, 1);
  assert.equal(h.calls.renders[0].editing, null);
});

// ── editorHtml() ─────────────────────────────────────────────────────────

const ACTIONS = (save, id, key) =>
  '<div class="editor-actions"><button type="button" onclick="' + save + "('" + id + "','" + key + "',this)\">Save</button>" +
  '<button type="button" onclick="cancelEdit()">Cancel</button></div>';

test("editorHtml(): a vocabulary field is a select of its options, the current one selected", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", status: "in_progress" }, spec("status")),
    '<select class="field-editor" data-editor-focus>' +
    '<option value="pending">Pending</option>' +
    '<option value="in_progress" selected>In progress</option>' +
    '<option value="done">Done</option>' +
    "</select>" + ACTIONS("saveSelected", "X-1", "status"));
});

test("editorHtml(): a current value first in the vocabulary is selected once, not appended again", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", status: "pending" }, spec("status")),
    '<select class="field-editor" data-editor-focus>' +
    '<option value="pending" selected>Pending</option>' +
    '<option value="in_progress">In progress</option>' +
    '<option value="done">Done</option>' +
    "</select>" + ACTIONS("saveSelected", "X-1", "status"));
});

test("editorHtml(): a value outside the vocabulary is kept as an option, not silently replaced", () => {
  const h = harness();
  const html = h.editorHtml({ id: "X-1", status: "legacy" }, spec("status"));
  assert.ok(html.endsWith('<option value="legacy" selected>Legacy</option></select>' + ACTIONS("saveSelected", "X-1", "status")), html);
  assert.deepEqual(spec("status").options, ["pending", "in_progress", "done"], "the spec's own list is not extended");
  const none = h.editorHtml({ id: "X-1", status: "" }, spec("status"));
  assert.doesNotMatch(none, /selected/);
  assert.equal(none.split("<option").length, 4, "an empty value adds no option");
});

test("editorHtml(): an optional vocabulary field offers none first; a dynamic one draws from the tasks", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", executor: "agent" }, spec("executor")),
    '<select class="field-editor" data-editor-focus>' +
    '<option value="">— none —</option>' +
    '<option value="human">Human</option>' +
    '<option value="agent" selected>Agent</option>' +
    "</select>" + ACTIONS("saveSelected", "X-1", "executor"));
  assert.equal(h.editorHtml({ id: "X-1", board: "ops" }, spec("board")),
    '<select class="field-editor" data-editor-focus>' +
    '<option value="main">Main</option>' +
    '<option value="ops" selected>Ops</option>' +
    "</select>" + ACTIONS("saveSelected", "X-1", "board"));
  assert.equal(h.editorHtml({ id: "X-1", board: "" }, { key: "board", kind: "enum", dynamic: "nothing" }),
    '<select class="field-editor" data-editor-focus></select>' + ACTIONS("saveSelected", "X-1", "board"));
  assert.equal(h.editorHtml({ id: "X-1", x: "" }, { key: "x", kind: "enum" }),
    '<select class="field-editor" data-editor-focus></select>' + ACTIONS("saveSelected", "X-1", "x"));
});

test("editorHtml(): a closed list is a set of checkboxes, the current items checked", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", target: ["worker"] }, spec("target")),
    '<div class="field-editor chips-editor" data-editor-focus tabindex="-1">' +
    '<label class="chip-opt"><input type="checkbox" value="web"> web</label>' +
    '<label class="chip-opt"><input type="checkbox" value="worker" checked> worker</label>' +
    ACTIONS("saveChips", "X-1", "target") + "</div>");
  assert.equal(h.editorHtml({ id: "X-1" }, { key: "t", kind: "list", closed: true }),
    '<div class="field-editor chips-editor" data-editor-focus tabindex="-1">' + ACTIONS("saveChips", "X-1", "t") + "</div>");
  assert.doesNotMatch(h.editorHtml({ id: "X-1" }, spec("target")), /checked/);
});

test("editorHtml(): an open list is a textarea of one item per line", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", blocked_by: ["X-2", "X-3"] }, spec("blocked_by")),
    '<div class="field-editor"><textarea class="field-input" data-editor-focus rows="3" placeholder="X-123">X-2\nX-3</textarea>' +
    ACTIONS("saveLines", "X-1", "blocked_by") + "</div>");
  assert.equal(h.editorHtml({ id: "X-1" }, { key: "l", kind: "list" }),
    '<div class="field-editor"><textarea class="field-input" data-editor-focus rows="3" placeholder="one value per line"></textarea>' +
    ACTIONS("saveLines", "X-1", "l") + "</div>");
});

test("editorHtml(): a text field is an input, bounded where the config bounds it", () => {
  const h = harness();
  assert.equal(h.editorHtml({ id: "X-1", title: 'A "quoted" <title>' }, spec("title")),
    '<div class="field-editor"><input class="field-input" data-editor-focus value="A &quot;quoted&quot; &lt;title&gt;" maxlength="80">' +
    ACTIONS("saveText", "X-1", "title") + "</div>");
  assert.equal(h.editorHtml({ id: "X-1", estimate: null }, spec("estimate")),
    '<div class="field-editor"><input class="field-input" data-editor-focus value="">' +
    ACTIONS("saveText", "X-1", "estimate") + "</div>");
  assert.equal(h.editorHtml({ id: "X-1", estimate: 0 }, spec("estimate")),
    '<div class="field-editor"><input class="field-input" data-editor-focus value="0">' +
    ACTIONS("saveText", "X-1", "estimate") + "</div>");
});

test("editorHtml(): the id and the key are escaped where they enter the markup", () => {
  const h = harness();
  const html = h.editorHtml({ id: 'X-"1"' }, { key: "a&b", kind: "text" });
  assert.ok(html.includes("saveText('X-&quot;1&quot;','a&amp;b',this)"), html);
});

// ── The save buttons ─────────────────────────────────────────────────────

/** The value saveField() was handed, read from the request it sent. */
async function sentValue(h, call) {
  await call();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.calls.fetches.length, 1, "exactly one request");
  return JSON.parse(h.calls.fetches[0].init.body).value;
}

function closestOnly(selector, element) {
  return { closest(wanted) { return wanted === selector ? element : null; } };
}

test("saveSelected() saves the value of the select before the button's actions", async () => {
  const h = harness();
  const button = { parentElement: { previousElementSibling: { value: "done" } } };
  assert.equal(await sentValue(h, () => h.saveSelected("X-1", "status", button)), "done");
});

test("saveText() saves the value of the editor's input", async () => {
  const h = harness();
  const editor = { querySelector(selector) { return selector === "input" ? { value: "  Renamed  " } : null; } };
  assert.equal(await sentValue(h, () => h.saveText("X-1", "title", closestOnly(".field-editor", editor))), "Renamed");
});

test("saveLines() saves the textarea's non-blank lines, trimmed", async () => {
  const h = harness();
  const editor = { querySelector(selector) { return selector === "textarea" ? { value: " X-2 \n\n  \nX-3\n" } : null; } };
  assert.deepEqual(await sentValue(h, () => h.saveLines("X-1", "blocked_by", closestOnly(".field-editor", editor))), ["X-2", "X-3"]);
});

test("saveChips() saves the checked boxes in their order", async () => {
  const h = harness();
  const editor = {
    querySelectorAll(selector) { return selector === "input:checked" ? [{ value: "web" }, { value: "worker" }] : []; },
  };
  assert.deepEqual(await sentValue(h, () => h.saveChips("X-1", "target", closestOnly(".chips-editor", editor))), ["web", "worker"]);
});

// ── saveField() ──────────────────────────────────────────────────────────

test("saveField(): a task that is gone is refused without a request", async () => {
  const h = harness();
  h.page.state.editError = false;
  await h.saveField("X-404", "title", "Anything");
  assert.equal(h.page.state.editMessage, "The task is no longer available.");
  assert.equal(h.page.state.editError, true);
  assert.equal(h.calls.renders.length, 1);
  assert.equal(h.calls.renders[0].editError, true);
  assert.deepEqual(h.calls.fetches, []);
});

test("saveField(): a value the field refuses is refused with the field's own reason", async () => {
  const h = harness();
  h.page.state.editError = false;
  await h.saveField("X-1", "status", "bogus");
  const expected = normalizeValue("status", "bogus", { fields: FIELDS, options: {} }).error;
  assert.ok(expected);
  assert.equal(h.page.state.editMessage, expected);
  assert.equal(h.page.state.editError, true);
  assert.equal(h.calls.renders.length, 1);
  assert.deepEqual(h.calls.fetches, []);
});

test("saveField(): a dynamic field is checked against the options the tasks offer", async () => {
  const h = harness();
  await h.saveField("X-1", "board", "nowhere");
  assert.match(h.page.state.editMessage, /^Unknown value "nowhere" — allowed: main, ops$/);
  assert.deepEqual(h.calls.fetches, []);
  await h.saveField("X-1", "board", "ops");
  assert.equal(h.calls.fetches.length, 1);
});

test("saveField(): an unchanged value closes the editor without a request", async () => {
  const h = harness();
  await h.saveField("X-1", "title", "  First ");
  assert.equal(h.page.state.editing, null);
  assert.equal(h.page.state.editMessage, "stale", "no message is written");
  assert.equal(h.calls.renders.length, 1);
  assert.deepEqual(h.calls.fetches, []);
});

test("saveField(): a change is posted with the capability, the actor and the revision", async () => {
  const h = harness();
  h.page.responses.push({ status: 200, body: { actor: "user:server", entries: [{ field: "title", to: "Renamed" }] } });
  await h.saveField("X-1", "title", " Renamed ");
  assert.equal(h.calls.fetches.length, 1);
  const { url, init, state } = h.calls.fetches[0];
  assert.equal(url, "api/task");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { "Content-Type": "application/json", "X-Viewer-Capability": "cap-123" });
  assert.deepEqual(JSON.parse(init.body), { id: "X-1", field: "title", value: "Renamed", actor: "user:kamil", revision: "r1" });
  assert.deepEqual(state, { actor: "user:kamil", editing: null, editMessage: "Saving…", editError: false },
    "the editor closes and says it is saving before the request");
  assert.equal(h.calls.renders[0].editMessage, "Saving…");
});

test("saveField(): a saved change appends its history, refreshes, and names the recorded actor", async () => {
  const h = harness();
  h.page.responses.push({ status: 200, body: { actor: "user:server", entries: [{ field: "title", to: "Renamed" }] } });
  await h.saveField("X-1", "title", "Renamed");
  assert.deepEqual(h.page.HISTORY["X-1"], [{ field: "status", to: "pending" }, { field: "title", to: "Renamed" }]);
  assert.deepEqual(h.calls.refreshes, [true]);
  assert.equal(h.page.state.editMessage, "Title saved to Markdown and history as user:server.");
  assert.equal(h.page.state.editError, false);
  assert.equal(h.calls.renders.length, 2);
  assert.equal(h.calls.renders[1].editMessage, "Title saved to Markdown and history as user:server.");
  assert.deepEqual(h.calls.focus, []);
});

test("saveField(): a first history entry starts the task's list; an answer without entries leaves it", async () => {
  const h = harness();
  h.page.responses.push({ status: 200, body: { entries: [{ field: "epic", to: "Launch" }] } });
  await h.saveField("X-2", "epic", "Launch");
  assert.deepEqual(h.page.HISTORY["X-2"], [{ field: "epic", to: "Launch" }]);
  assert.equal(h.page.state.editMessage, "Epic saved to Markdown and history as user:kamil.", "the page's actor when the answer names none");
  h.page.responses.push({ status: 200, body: {} });
  await h.saveField("X-3", "title", "Renamed");
  assert.equal("X-3" in h.page.HISTORY, false);
  assert.deepEqual(Object.keys(h.page.HISTORY).sort(), ["X-1", "X-2"]);
});

test("saveField(): a conflict refreshes the tasks and reports the server's reason", async () => {
  const h = harness();
  h.page.responses.push({ status: 409, body: { error: "The task changed since it was read" } });
  await h.saveField("X-1", "title", "Renamed");
  assert.deepEqual(h.calls.refreshes, [true]);
  assert.equal(h.page.state.editMessage, "Not saved: The task changed since it was read");
  assert.equal(h.page.state.editError, true);
  assert.equal(h.calls.renders.length, 2);
  assert.equal(h.calls.renders[1].editError, true);
  assert.deepEqual(h.calls.focus, []);
  assert.deepEqual(Object.keys(h.page.HISTORY), ["X-1"]);
});

test("saveField(): another refusal does not refresh, and a reason-less one names the status", async () => {
  const h = harness();
  h.page.responses.push({ status: 500, body: {} });
  await h.saveField("X-1", "title", "Renamed");
  assert.deepEqual(h.calls.refreshes, []);
  assert.equal(h.page.state.editMessage, "Not saved: HTTP 500");
  assert.equal(h.page.state.editError, true);
});

test("saveField(): an answer that is not JSON is reported by its status", async () => {
  const h = harness();
  h.page.responses.push({ status: 502, reject: true });
  await h.saveField("X-1", "title", "Renamed");
  assert.equal(h.page.state.editMessage, "Not saved: HTTP 502");
  h.page.responses.push({ status: 200, reject: true });
  await h.saveField("X-1", "title", "Again");
  assert.equal(h.page.state.editMessage, "Title saved to Markdown and history as user:kamil.");
  assert.equal(h.page.state.editError, false);
});

test("saveField(): a refusal for want of an actor sends focus to the identity field", async () => {
  const h = harness();
  h.page.responses.push({ status: 400, body: { error: "Name who is editing", refusalKind: "actor-required" } });
  await h.saveField("X-1", "title", "Renamed");
  assert.equal(h.page.state.editMessage, "Not saved: Name who is editing");
  assert.deepEqual(h.calls.byId, ["editingActor"]);
  assert.deepEqual(h.calls.focus, ["#editingActor"]);
  assert.deepEqual(h.calls.refreshes, []);
  const other = harness();
  other.page.responses.push({ status: 400, body: { error: "No", refusalKind: "something-else" } });
  await other.saveField("X-1", "title", "Renamed");
  assert.deepEqual(other.calls.focus, []);
});
