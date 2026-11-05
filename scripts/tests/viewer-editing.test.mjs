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
    ["the task revision accompanies the write", /revision: task\.revision/],
    ["a stale write refreshes instead of overwriting", /res\.status === 409\) await refreshFromServer\(true\)/],
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
    .replaceAll("await refreshFromServer(true)", "task[field] = normalized.value");
  const problems = editingContractProblems(broken);
  assert.ok(problems.includes("only served pages can edit"));
  assert.ok(problems.includes("the capability accompanies the write"));
  assert.ok(problems.includes("a successful write refreshes disk state"));
});

/** The source of one top-level function of the page, braces matched. */
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

// Names the edit flow may call without the page declaring them: the language
// and the browser. Kept short on purpose — a name that has to be added here is
// worth a second look before it is.
const PLATFORM = new Set([
  "fetch", "Error", "JSON", "String", "Number", "Boolean", "Array", "Object",
  "setTimeout", "clearTimeout", "requestAnimationFrame",
]);

/**
 * Every bare call inside the named functions resolves to a function the page
 * declares (TL-450). TL-379 deleted `refreshInFlight` and left its call in
 * `refreshFromServer`; the ReferenceError was caught AFTER the render, so the
 * data looked right and every save also toasted "Error reading from the server".
 * A string match on the page cannot see that; a resolution check can.
 */
export function undeclaredCalls(page, names) {
  const declared = new Set([...page.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const missing = [];
  for (const name of names) {
    const source = functionSource(page, name);
    if (!source) { missing.push(name + " (not found)"); continue; }
    const body = source.slice(source.indexOf("{"))
      .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/.*$/gm, "");
    for (const m of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      const callee = m[1];
      if (["if", "for", "while", "switch", "catch", "function", "return", "typeof", "await"].includes(callee)) continue;
      if (!declared.has(callee) && !PLATFORM.has(callee)) missing.push(name + " → " + callee);
    }
  }
  return [...new Set(missing)];
}

const EDIT_FLOW = ["refreshFromServer", "saveField", "submitReason", "cancelReason", "focusReasonAsk", "startEdit", "renderDetail"];

test("the edit flow calls only functions the page declares", () => {
  assert.deepEqual(undeclaredCalls(PAGE, EDIT_FLOW), []);
});

test("negative control: a call to a deleted function is reported", () => {
  const broken = PAGE.replace("    render();\n    if (!quiet)", "    render();\n    refreshInFlight();\n    if (!quiet)");
  assert.notEqual(broken, PAGE, "the control did not inject the call — the anchor moved");
  assert.deepEqual(undeclaredCalls(broken, ["refreshFromServer"]), ["refreshFromServer → refreshInFlight"]);
});

/**
 * What a person sees after pressing Save (TL-450 review, 2026-11-05). The
 * result and the reason prompt were rendered after the field grid while
 * renderDetail scrolls to the top, so both were out of sight; the refusal took
 * the project's blocked colour, green in a fresh backlog.
 */
export function visibilityProblems(page) {
  const problems = [];
  const render = functionSource(page, "renderDetail") || "";
  const title = render.indexOf("titleHtml +");
  const result = render.indexOf("editResult + reasonAskHtml(t)");
  const grid = render.indexOf("'<div class=\"detail-meta-grid\">'");
  if (!(title >= 0 && result > title && grid > result)) problems.push("the result and the reason prompt sit between the title and the field grid");
  if (!/state\.reasonAsk = \{[^}]*draft: reason/.test(page)) problems.push("a refused reason keeps what was typed");
  if (!/renderDetail\(\);\s*focusReasonAsk\(\);/.test(page)) problems.push("the reason prompt receives focus");
  if (!/\.edit-result\[role="alert"\][^{]*\{[^}]*var\(--refusal\)/.test(page)) problems.push("a refusal uses the refusal colour, not a status colour");
  return problems;
}

test("a save's result and the reason prompt are where the user is looking", () => {
  assert.deepEqual(visibilityProblems(PAGE), []);
});
