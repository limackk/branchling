/**
 * The live viewer exposes the guarded writer without making snapshots writable
 * (TL-450). This is a source contract because the browser and server integration
 * is exercised over HTTP by viewer-write-api.test.mjs; here we prove that the
 * controls call that one route with the capability, identity and reason.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, readTasks } from "../build-viewer.mjs";
import { BACKLOG_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-editing");

const PAGE = buildHtml(readTasks(BACKLOG_DIR));

export function editingContractProblems(page) {
  const problems = [];
  const checks = [
    ["the actor is explicit and namespaced", /id="editingActor"[\s\S]*value="user:"/],
    ["the active backlog path is shown", /Writing to ["']? \+ data\.backlogDir/],
    ["only served pages can edit", /const CAN_EDIT = SERVER_MODE && !!window\.VIEWER_WRITE/],
    ["field controls come from the shared specs", /FIELDS\.filter[\s\S]*metaRowHtml/],
    ["the guarded route is used", /fetch\("api\/task"/],
    ["the capability accompanies the write", /"X-Viewer-Capability": window\.VIEWER_WRITE\.token/],
    ["protected transitions ask first", /reasonRequiredFor\(field, normalized\.value\)[\s\S]*state\.reasonAsk/],
    ["a successful write refreshes disk state", /await refreshFromServer\(true\)/],
    ["the result is announced", /aria-live="polite"/],
    ["snapshot mode says it is read-only", /This snapshot is read-only/],
  ];
  for (const [claim, pattern] of checks) if (!pattern.test(page)) problems.push(claim);
  if (/localStorage\.setItem\([^\n]*actor/.test(page)) problems.push("identity is persisted in browser storage");
  return problems;
}

test("live editing is attributed, guarded and configuration-derived", () => {
  assert.deepEqual(editingContractProblems(PAGE), []);
});

test("negative control: an unguarded optimistic writer fails the contract", () => {
  const broken = PAGE
    .replace("const CAN_EDIT = SERVER_MODE && !!window.VIEWER_WRITE", "const CAN_EDIT = true")
    .replace('"X-Viewer-Capability": window.VIEWER_WRITE.token', '"X-Viewer-Capability": "public"')
    .replace("await refreshFromServer(true)", "task[field] = normalized.value");
  const problems = editingContractProblems(broken);
  assert.ok(problems.includes("only served pages can edit"));
  assert.ok(problems.includes("the capability accompanies the write"));
  assert.ok(problems.includes("a successful write refreshes disk state"));
});
