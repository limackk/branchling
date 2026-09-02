/**
 * The contract of the link to the tasks view (BL-1390).
 *
 * Why this test exists in this shape: the whole viewer is one template literal in
 * build-viewer.mjs, so code from inside it cannot be executed — an assertion
 * `assert.match(html, /encodeTasksHash/)` would pass just as well for a function
 * that returns the wrong URL. The encoding logic therefore lives in a separate
 * module and it is that module which runs here; build-viewer pastes ITS SOURCE
 * into the page, which a separate test below enforces.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TASKS_HASH_ROUTE,
  SORT_DEFAULT,
  encodeTasksHash,
  parseTasksHash,
} from "../viewer-url.mjs";

const PARAMS = ["status", "priority", "type", "phase", "env", "epic"];

/** The view state in the shape the page hands it over in. */
function view(over = {}) {
  return {
    board: "__all__",
    filters: PARAMS.map((param) => ({ param, values: [] })),
    search: "",
    sortBy: SORT_DEFAULT,
    selectedId: null,
    ...over,
  };
}

function filters(map) {
  return PARAMS.map((param) => ({ param, values: map[param] || [] }));
}

function query(hash) {
  const i = hash.indexOf("?");
  assert.equal(hash.slice(0, i < 0 ? hash.length : i), TASKS_HASH_ROUTE);
  return i < 0 ? "" : hash.slice(i + 1);
}

test("filters, search, sort and selection all come back from the URL", () => {
  const before = view({
    board: "backlog-project",
    filters: filters({ status: ["blocked", "in_progress"], priority: ["P0"], epic: ["Legal compliance"] }),
    search: "sync",
    sortBy: "id_desc",
    selectedId: "BL-1390",
  });

  const after = parseTasksHash(query(encodeTasksHash(before)), PARAMS);

  assert.equal(after.board, "backlog-project");
  assert.deepEqual(after.filters.status, ["blocked", "in_progress"]);
  assert.deepEqual(after.filters.priority, ["P0"]);
  assert.deepEqual(after.filters.epic, ["Legal compliance"]);
  assert.deepEqual(after.filters.type, []);
  assert.equal(after.search, "sync");
  assert.equal(after.sortBy, "id_desc");
  assert.equal(after.selectedId, "BL-1390");
});

test("an epic containing a comma stays ONE value", () => {
  // A comma-joined list would fall apart here into two filters, neither of which
  // matches anything — the link would show an empty list instead of the sender's set.
  const epic = "Plan audit, stage 2";
  const after = parseTasksHash(query(encodeTasksHash(view({ filters: filters({ epic: [epic] }) }))), PARAMS);
  assert.deepEqual(after.filters.epic, [epic]);
});

test("the board travels in the link even in the \"all boards\" scope", () => {
  // The scope also has a source in localStorage. If the default scope were omitted,
  // a recipient narrowed to one board would see a SUBSET of the sender's list.
  assert.match(encodeTasksHash(view()), /(^|[?&])board=__all__($|&)/);
});

test("a parameter absent from the link falls back to the default, not to the recipient's state", () => {
  const after = parseTasksHash("board=main&status=done", PARAMS);
  assert.deepEqual(after.filters.priority, []);
  assert.deepEqual(after.filters.epic, []);
  assert.equal(after.search, "");
  assert.equal(after.sortBy, SORT_DEFAULT);
  assert.equal(after.selectedId, null);
});

test("no board= leaves the scope untouched (null) rather than clearing it silently", () => {
  assert.equal(parseTasksHash("status=done", PARAMS).board, null);
  assert.equal(parseTasksHash("board=main", PARAMS).board, "main");
});

test("an unknown sort falls back to the default instead of an order no button shows", () => {
  assert.equal(parseTasksHash("sort=eyes_closed", PARAMS).sortBy, SORT_DEFAULT);
});

test("an empty search and empty filters do not clutter the link", () => {
  const hash = encodeTasksHash(view());
  assert.doesNotMatch(hash, /(^|[?&])q=/);
  assert.doesNotMatch(hash, /(^|[?&])sort=/);
  assert.doesNotMatch(hash, /(^|[?&])id=/);
  assert.doesNotMatch(hash, /(^|[?&])status=/);
});

// ─── The link between the module and the page ─────────────────────────────
// The module alone can be green while the page never calls it once. This test
// enforces one thing: that the module's SOURCE reaches the HTML (rather than a
// second copy of the logic beside it) and that the page has something to call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtml, computeStats } from "../build-viewer.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("viewer-url");

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");

test("viewer: the page carries the source of viewer-url.mjs, not its own copy", () => {
  const tasks = [{
    id: "BL-1", title: "A", board: "main", labels: [], blocked_by: [], blocks: [],
    related_docs: [], epic: "", status: "pending", priority: "P1", type: "code", bodyHtml: "",
  }];
  const html = buildHtml(tasks, computeStats(tasks));

  // A fragment characteristic of the module — if the build stopped pasting it in,
  // the page would still be generated, only without URL routing.
  const src = readFileSync(join(SCRIPTS, "viewer-url.mjs"), "utf8");
  const marker = "export function encodeTasksHash";
  assert.ok(src.includes(marker), "the module changed shape — fix the marker in this test");
  assert.ok(html.includes(marker.replace("export ", "")), "the source of viewer-url.mjs did not reach the page");

  assert.match(html, /tasksSyncHash\(/, "the page has nothing to rewrite the URL with after a filter change");
  assert.match(html, /tasksApplyHash\(/, "the page does not read its state from the URL");
  // The button itself — whether it copies the right text — is checked in a browser
  // (the clipboard API does not exist in node). Here we only enforce that the
  // control did not fall out of the header along with some refactor of the tabs.
  assert.match(html, /id="btnCopyLink"/, "no Copy link button in the header");
  assert.match(html, /getElementById\("btnCopyLink"\)/, "the Copy link button has no handler attached");
});
