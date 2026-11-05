/**
 * The viewer's editing and actor state is either absent or alive (TL-554).
 *
 * TL-379 made the viewer a read-only window, and the page state kept
 * `editing` and `actor` with comments that named tasks of another project's
 * numbering. Field editing has since returned for a served page holding the
 * write capability (TL-450, TL-521), so both fields have readers again. That
 * is the condition under which they may stay: a declaration nobody reads is
 * residue, and a comment that points at somebody else's task id explains
 * nothing to a reader of this repository.
 *
 * WHAT IS ASSERTED, FOR EACH OF THE TWO FIELDS THE PAGE DECLARES:
 *   - the built page reads it somewhere other than on the left of `=`;
 *   - the comment above its declaration names a page function that reads it,
 *     so the live reader is documented where the field is;
 *   - that comment names no task id outside this backlog's prefix.
 * And for `editing`: every write that opens an editor sits in a function that
 * returns first unless CAN_EDIT, so a snapshot can never enter editing state.
 *
 * Absence passes: a page that declares neither field satisfies the thesis.
 * The negative controls below prove each check bites against the real page,
 * so a green run is not a green run over an empty sample.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, readTasks } from "../build-viewer.mjs";
import { loadConfig } from "../config.mjs";
import { BACKLOG_DIR, isolateHome } from "./_repo.mjs";

// The developer's own configuration must not change what the page contains
// (TL-166).
isolateHome("viewer-no-edit-state");

const PAGE = buildHtml(readTasks(BACKLOG_DIR));
const PREFIX = loadConfig(BACKLOG_DIR, { strict: false }).taskIdPrefix;

/** The editing and actor fields of the page state this file holds to account. */
const KEYS = ["editing", "actor"];

/** The source of the page's `const state = { … };` declaration, or "". */
function stateDeclaration(page) {
  const start = page.indexOf("const state = {");
  if (start < 0) return "";
  const end = page.indexOf("\n};", start);
  return end < 0 ? "" : page.slice(start, end);
}

/** The comment lines directly above `key:` in the state declaration, or null when undeclared. */
function declarationComment(declaration, key) {
  const lines = declaration.split("\n");
  const at = lines.findIndex((line) => new RegExp("^\\s*" + key + ":").test(line));
  if (at < 0) return null;
  const comment = [];
  for (let i = at - 1; i >= 0 && /^\s*\/\//.test(lines[i]); i--) comment.unshift(lines[i]);
  return comment.join("\n");
}

/** The source of one top-level page function, braces matched, or null. */
function functionSource(page, name) {
  const match = new RegExp("(?:async\\s+)?function\\s+" + name + "\\s*\\(").exec(page);
  if (!match) return null;
  const open = page.indexOf("{", match.index);
  let depth = 0;
  for (let i = open; i < page.length; i++) {
    if (page[i] === "{") depth++;
    else if (page[i] === "}" && --depth === 0) return page.slice(match.index, i + 1);
  }
  return null;
}

/** A read of `state.<key>`: any occurrence that is not the target of a plain assignment. */
function readsOf(source, key) {
  return new RegExp("state\\." + key + "\\b(?!\\s*=(?!=))", "g").test(source);
}

/** The name of the top-level function enclosing an offset of the page, or null. */
function enclosingFunction(page, offset) {
  const before = page.slice(0, offset);
  const names = [...before.matchAll(/\n(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  return names.length ? names[names.length - 1][1] : null;
}

export function editStateProblems(page, prefix) {
  const problems = [];
  const declaration = stateDeclaration(page);
  if (!declaration) return ["the page state declaration was not found"];
  for (const key of KEYS) {
    const comment = declarationComment(declaration, key);
    if (comment === null) continue;
    if (!readsOf(page, key)) problems.push(`state.${key} is declared and never read`);
    const named = [...comment.matchAll(/\b([A-Za-z_$][\w$]*)\(\)/g)].map((m) => m[1]);
    const documented = named.some((name) => {
      const source = functionSource(page, name);
      return source !== null && readsOf(source, key);
    });
    if (!documented) problems.push(`the comment on state.${key} names no function that reads it`);
    for (const [id, idPrefix] of comment.matchAll(/\b([A-Z][A-Za-z0-9]*)-\d+\b/g)) {
      if (idPrefix !== prefix) problems.push(`the comment on state.${key} names a foreign task id ${id}`);
    }
  }
  if (declarationComment(declaration, "editing") !== null) {
    for (const write of page.matchAll(/state\.editing\s*=(?!=)\s*(?![\s=]|null\b)/g)) {
      const name = enclosingFunction(page, write.index);
      const source = name && functionSource(page, name);
      const guarded = !!source && /^[^{]*\{\s*if\s*\(\s*!CAN_EDIT\b[^)]*\)\s*return/.test(source);
      if (!guarded) problems.push(`state.editing is opened in ${name || "top-level code"} without a CAN_EDIT guard`);
    }
  }
  return problems;
}

test("the page's editing and actor state is read, documented and served-only", () => {
  assert.deepEqual(editStateProblems(PAGE, PREFIX), []);
});

test("negative control: the comments this task replaced fail the check", () => {
  // From the first comment line above `editing:` to the end of `actor:`.
  const current = /\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*editing:[^\n]*\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*actor:[^\n]*/.exec(stateDeclaration(PAGE));
  assert.ok(current, "the fixture must find both declarations");
  const before = current[0];
  const old = [
    "",
    "  // Field editing (BL-1396): { id, field } or null. One field at a time — an open",
    "  // an editor is a state of the view, not a state of the task.",
    "  editing: null,",
    "  // Identity never travels in a shared URL or local storage. The user must name",
    "  // the actor for this server session before the first write.",
    '  actor: "user:",',
  ].join("\n");
  const problems = editStateProblems(PAGE.replace(before, old), PREFIX);
  assert.ok(problems.includes("the comment on state.editing names no function that reads it"), problems.join("; "));
  assert.ok(problems.includes("the comment on state.editing names a foreign task id BL-1396"), problems.join("; "));
  assert.ok(problems.includes("the comment on state.actor names no function that reads it"), problems.join("; "));
});

test("negative control: an unread declaration fails the check", () => {
  const unread = PAGE.replace(/state\.actor\b(?!\s*=(?!=))/g, "window.unrelated");
  assert.ok(editStateProblems(unread, PREFIX).includes("state.actor is declared and never read"));
});

test("negative control: an editor a snapshot can open fails the check", () => {
  const unguarded = PAGE.replace("if (!CAN_EDIT || DEDICATED_FIELDS[field]) return;", "if (DEDICATED_FIELDS[field]) return;");
  assert.notEqual(unguarded, PAGE, "the fixture must find the guard it removes");
  assert.ok(editStateProblems(unguarded, PREFIX).includes("state.editing is opened in startEdit without a CAN_EDIT guard"));
});
