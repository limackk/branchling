/**
 * The two readers outside the writing commands name the half of an actor that
 * is wrong (TL-605).
 *
 * WHAT IS AT RISK. TL-590 moved every writing command onto `actorRefusal()`,
 * so an actor with a right namespace and a wrong name is refused for its name.
 * Two readers kept one fixed sentence whatever the fault: the viewer's
 * identity prompt (`startEdit()` in the page) answered `user:Kamil` exactly as
 * it answered `kamil`, and the agent-profile validation (`profileProblems()`)
 * told `agent:Impl` to become an `agent:` identity it already was.
 *
 * Each reader keeps a namespace requirement of its own — `user:` for the
 * viewer, `agent:` for a profile — and that requirement keeps its own message.
 * So each is asked three things, each with its own expected message: the
 * right namespace with an uppercase name (the name is named, with the shared
 * remedy), a wrong namespace with a valid shape (the reader's own
 * requirement, no shape diagnosis), and a value with no namespace at all (the
 * shared diagnosis together with the reader's requirement, not the shared
 * remedy listing three namespaces the reader would refuse two of).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, readTasks } from "../build-viewer.mjs";
import { parseAgentProfiles } from "../agent-profiles.mjs";
import { actorRefusal, isValidActor } from "../task-fields.mjs";
import { SOURCE_ROOT_ENV } from "../mutation-run.mjs";
import { BACKLOG_DIR, isolateHome, scriptSource } from "./_repo.mjs";

isolateHome("actor-shape-diagnosis-readers");

const NAME_SENTENCE = /has an invalid name — `[^`]+` carries `[A-Z]`/;
const VIEWER_REQUIRED = "Enter a user:name identity before editing.";
const PROFILE_REQUIRED = "actor must be an `agent:<name>` identity";

// The exact messages are assembled from actorRefusal()'s own parts, so these
// assertions pin how each reader joins them (separators, capital, final full
// stop) without copying the shared wording, which belongs to task-fields.mjs.
const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ── The viewer's identity prompt ─────────────────────────────────────────

const PAGE = buildHtml(readTasks(BACKLOG_DIR));

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

// The field editors are scripts/viewer-field-editors.mjs, pasted into the
// page by source (TL-704). The test runs the PASTE, taken from the built page,
// so what it judges is what the browser runs and, inside a mutation run, the
// instrumented copy Stryker switches mutants in.
const PASTE_OPEN = "// ─── Pasted source of scripts/viewer-field-editors.mjs";
const PASTE_CLOSE = "// ─── end of the pasted module";

function pastedEditors(page) {
  const start = page.indexOf(PASTE_OPEN);
  if (start < 0) return null;
  const end = page.indexOf(PASTE_CLOSE, start);
  return end < 0 ? null : page.slice(start, end);
}

/**
 * Runs the page's own `startEdit()` with `actor` typed into "Editing as" and
 * returns what the page would show. The page names it resolves when called are
 * supplied as parameters; the shared functions are the module's, which the
 * page inlines by source (asserted below), so this is the code the browser
 * runs, not a copy of its decision.
 *
 * Evaluated with `Function` in THIS realm rather than in node:vm: Stryker's
 * mutant switch reads the active mutant from `globalThis.process.env`, which a
 * fresh vm context does not have, so every mutant would run as the original.
 */
function viewerAnswer(actor) {
  const source = pastedEditors(PAGE);
  assert.ok(source, "the page no longer pastes viewer-field-editors.mjs");
  assert.ok(functionSource(source, "startEdit"), "the pasted module no longer declares startEdit()");
  const page = {
    CAN_EDIT: true,
    DEDICATED_FIELDS: {},
    state: { actor, editing: null, editMessage: "", editError: false },
    renderDetail() {},
    document: { getElementById() { return { focus() {} }; }, querySelector() { return null; } },
    isValidActor,
    actorRefusal,
  };
  const names = Object.keys(page);
  new Function(...names, source + "\nstartEdit('X-1', 'title');")(...names.map((name) => page[name]));
  return page.state;
}

test("the page carries the shared diagnosis it calls", () => {
  assert.ok(PAGE.includes("function actorRefusal("), "task-fields.mjs is no longer inlined with actorRefusal()");
  assert.ok(functionSource(pastedEditors(PAGE), "startEdit").includes("actorRefusal(state.actor)"));
});

test("the page pastes viewer-field-editors.mjs by source, without its import and exports", () => {
  const module = scriptSource("viewer-field-editors.mjs");
  const paste = pastedEditors(PAGE);
  assert.ok(paste, "the page no longer pastes viewer-field-editors.mjs");
  assert.match(module, /^export function startEdit\(/m, "startEdit() is no longer the module's own");
  assert.doesNotMatch(paste, /^(import|export) /m, "the paste is a script, not a module");
  assert.equal(PAGE.split("function startEdit(").length, 2, "startEdit() is declared once in the page");
  if (!process.env[SOURCE_ROOT_ENV]) {
    // Outside a mutation run the page carries the module's text exactly; inside
    // one the paste is the instrumented sandbox copy, which no source equals.
    assert.ok(paste.includes(module.replace(/^import [^;]*;\n/gm, "").replace(/^export /gm, "")),
      "the page's copy differs from scripts/viewer-field-editors.mjs");
  }
});

test("viewer: a user: identity with an uppercase name is refused for its name", () => {
  const answer = viewerAnswer("user:Kamil");
  assert.equal(answer.editing, null, "no editor opens");
  assert.equal(answer.editError, true);
  assert.match(answer.editMessage, /^The actor `user:Kamil`/);
  assert.match(answer.editMessage, NAME_SENTENCE);
  assert.match(answer.editMessage, /The namespace `user:` is right/);
  assert.match(answer.editMessage, /`user:kamil`/, "lowercasing is the whole repair, so it is offered");
  assert.doesNotMatch(answer.editMessage, /namespace —/, "the namespace is not blamed");
  assert.ok(!answer.editMessage.includes(VIEWER_REQUIRED), "the namespace requirement is not the fault here");
  const bad = actorRefusal("user:Kamil");
  assert.equal(answer.editMessage, capitalised(bad.refusal) + ". " + bad.hint + ".");
});

test("viewer: a valid identity in the wrong namespace keeps the user: requirement", () => {
  const answer = viewerAnswer("agent:loop");
  assert.equal(answer.editing, null);
  assert.equal(answer.editMessage, VIEWER_REQUIRED);
});

test("viewer: no namespace is diagnosed, and the remedy is the page's own", () => {
  const answer = viewerAnswer("kamil");
  assert.equal(answer.editing, null);
  assert.match(answer.editMessage, /^The actor `kamil` has no valid namespace/);
  assert.ok(answer.editMessage.endsWith(VIEWER_REQUIRED), answer.editMessage);
  assert.doesNotMatch(answer.editMessage, /local:<name>/, "the page accepts only user:, so it does not offer three namespaces");
  assert.equal(answer.editMessage, capitalised(actorRefusal("kamil").refusal) + ". " + VIEWER_REQUIRED);
});

test("viewer: a wrong name under the wrong namespace does not vouch for the namespace", () => {
  const answer = viewerAnswer("agent:Impl");
  assert.match(answer.editMessage, NAME_SENTENCE);
  assert.doesNotMatch(answer.editMessage, /is right/);
  assert.ok(answer.editMessage.endsWith(VIEWER_REQUIRED), answer.editMessage);
  assert.equal(answer.editMessage, capitalised(actorRefusal("agent:Impl").refusal) + ". " + VIEWER_REQUIRED);
});

test("viewer: positive control — a valid user: identity opens the editor", () => {
  const answer = viewerAnswer("user:kamil");
  assert.deepEqual({ ...answer.editing }, { id: "X-1", field: "title" });
  assert.equal(answer.editMessage, "");
});

// ── The agent-profile validation ─────────────────────────────────────────

function profileProblemsFor(actor) {
  const text = [
    "profiles:",
    "  - name: impl",
    "    adapter: /opt/wrapper",
    "    prompt: 'Work.'",
    "    actor: '" + actor + "'",
  ].join("\n") + "\n";
  return parseAgentProfiles(text, "/nonexistent/agent-profiles.yaml").problems;
}

test("profile: an agent: actor with an uppercase name is refused for its name", () => {
  const problems = profileProblemsFor("agent:Impl");
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /^profile `impl` actor: the actor `agent:Impl`/);
  assert.match(problems[0], NAME_SENTENCE);
  assert.match(problems[0], /The namespace `agent:` is right/);
  assert.match(problems[0], /`agent:impl`/);
  assert.ok(!problems[0].includes(PROFILE_REQUIRED), "the namespace requirement is not the fault here");
  const bad = actorRefusal("agent:Impl");
  assert.equal(problems[0], "profile `impl` actor: " + bad.refusal + ". " + bad.hint);
});

test("profile: a valid actor in the wrong namespace keeps the agent: requirement", () => {
  assert.deepEqual(profileProblemsFor("local:person"), ["profile `impl` " + PROFILE_REQUIRED]);
});

test("profile: no namespace is diagnosed together with the agent: requirement", () => {
  const problems = profileProblemsFor("impl");
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.ok(problems[0].startsWith("profile `impl` " + PROFILE_REQUIRED), problems[0]);
  assert.match(problems[0], /the actor `impl` has no valid namespace/);
  assert.doesNotMatch(problems[0], /local:<name>/);
  assert.equal(problems[0], "profile `impl` " + PROFILE_REQUIRED + " — " + actorRefusal("impl").refusal);
});

test("profile: a wrong name under the wrong namespace does not vouch for the namespace", () => {
  const problems = profileProblemsFor("user:Impl");
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.ok(problems[0].startsWith("profile `impl` " + PROFILE_REQUIRED), problems[0]);
  assert.match(problems[0], NAME_SENTENCE);
  assert.doesNotMatch(problems[0], /is right/);
  assert.equal(problems[0], "profile `impl` " + PROFILE_REQUIRED + " — " + actorRefusal("user:Impl").refusal);
});

test("profile: positive control — a valid agent: actor raises no problem", () => {
  assert.deepEqual(profileProblemsFor("agent:impl"), []);
});
