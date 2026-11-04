/**
 * The viewer carries no residue of the history panel TL-379 removed (TL-530).
 *
 * TL-379 took the per-task history list and /api/history out of the viewer,
 * but its label table, state keys, helpers and two document listeners stayed
 * in the page. The listeners called `openHistory`, which nothing defined, so
 * the first graph node on the page would have thrown a ReferenceError. The
 * residue also misled a later task (TL-526) into believing the viewer still
 * rendered history entries.
 *
 * `scripts/task-graph.mjs` was pasted into the page with the panel and had no
 * caller after it went. It is no longer pasted; the module stays, because its
 * test file is the `verification:` contract of closed tasks that
 * `check --proofs` re-runs.
 *
 * The embedded HISTORY data is NOT residue: the decision panel reads it. The
 * positive control below proves the page still hands it over.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, computeStats, readTasks } from "../build-viewer.mjs";

import { isolateHome } from "./_repo.mjs";

// The developer's own configuration must not change what the page contains
// (TL-166).
isolateHome("viewer-history-residue");

// Every identifier that served only the removed panel or the graph pasted
// beside it. A name here reappearing in the page means code with no reader.
const RESIDUE = [
  "HISTORY_FIELD_LABELS",
  "historyOpen",
  "historyField",
  "historyLoaded",
  "histTime",
  "graphOpen",
  "data-graph-node",
  "graphField",
  "renderTaskGraph",
  "taskGraph(",
];

/** The residual names a page source still carries, and any call to an undefined openHistory. */
function residueIn(html) {
  const found = RESIDUE.filter((name) => html.includes(name));
  const callsOpenHistory = /\bopenHistory\s*\(/.test(html);
  const definesOpenHistory = /function\s+openHistory\s*\(|\bopenHistory\s*=/.test(html);
  if (callsOpenHistory && !definesOpenHistory) found.push("openHistory (called, never defined)");
  return found;
}

const SENTINEL_ID = "ZZ-HISTORY-SENTINEL";

function buildPage() {
  // The page embeds task DATA, and this task's own body names every residual
  // identifier; a task that quotes one is data about the page, not page code,
  // so it is left out of the sample rather than excused in the detector.
  const tasks = readTasks().filter((t) => residueIn(JSON.stringify(t)).length === 0);
  assert.ok(tasks.length > 0, "no tasks read — the page would be built from an empty sample");
  const history = {
    [SENTINEL_ID]: [{
      id: "01SENTINEL0000000000000000",
      ts: "2026-11-04T00:00:00.000Z",
      task: SENTINEL_ID,
      field: "__comment__",
      from: "",
      to: "Which way?",
      actor: "agent:test",
      source: "ask",
    }],
  };
  // `undefined` keeps the default configuration and plan; only the history is
  // pinned, so the positive control can find a value it put there itself.
  return buildHtml(tasks, computeStats(tasks), undefined, history);
}

test("viewer: the page names none of the removed history panel's identifiers", () => {
  assert.deepEqual(residueIn(buildPage()), []);
});

test("positive control: the decision panel still receives the embedded HISTORY", () => {
  const html = buildPage();
  const m = html.match(/let HISTORY = (\{[\s\S]*?\});\n/);
  assert.ok(m, "the page embeds no HISTORY");
  const embedded = JSON.parse(m[1]);
  assert.ok(embedded[SENTINEL_ID], "the history passed to buildHtml is not the one the page carries");
  assert.match(html, /decisionPanel\(ALL_TASKS, HISTORY\b/, "nothing in the page hands HISTORY to the decision panel");
});

test("positive control: the detector flags the residue it exists to catch", () => {
  const removed = [
    "const HISTORY_FIELD_LABELS = { updated: 'Updated' };",
    "document.addEventListener('click', function (e) {",
    "  const node = e.target.closest('[data-graph-node]');",
    "  openHistory(state.selectedId, node.dataset.graphField);",
    "});",
  ].join("\n");
  const found = residueIn(removed);
  assert.ok(found.includes("HISTORY_FIELD_LABELS"));
  assert.ok(found.includes("data-graph-node"));
  assert.ok(found.includes("openHistory (called, never defined)"));
  // A defined openHistory is a live panel, not residue.
  assert.deepEqual(residueIn("function openHistory(id) {}\nopenHistory(1);"), []);
});
