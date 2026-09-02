/**
 * The generated page has to PARSE (TL-32 fallout, found in the field).
 *
 * The whole viewer is one template literal in build-viewer.mjs, so an escape
 * that is correct in the SOURCE can be wrong in the OUTPUT: `\'` inside the
 * template collapses to a bare `'` and terminates the single-quoted string that
 * the page was supposed to contain. The browser then throws a SyntaxError on the
 * first line of the script, the page renders as static HTML, the connection bar
 * stays on its default "snapshot" text — and nothing in the terminal says a word.
 *
 * Every other viewer test asserts on the HTML as a STRING, which a broken page
 * satisfies exactly as well as a working one. This one runs the parser instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import { buildHtml, computeStats, readTasks } from "../build-viewer.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("viewer-script-syntax");

const SCRIPT_TAG = /<script\b[^>]*>([\s\S]*?)<\/script>/g;

/** @returns {string[]} the body of every inline script in the page. */
function scriptBodies(html) {
  return [...html.matchAll(SCRIPT_TAG)].map((m) => m[1]);
}

/** Parses without executing — a page that only THROWS at runtime is a different bug. */
function parseOrThrow(source) {
  new vm.Script(source);
}

test("viewer: every script in the generated page parses", () => {
  const tasks = readTasks();
  // Positive control: a page built from an empty tree would satisfy this test
  // while containing none of the text that broke it.
  assert.ok(tasks.length > 0, "no tasks read — the check would have no sample");

  const bodies = scriptBodies(buildHtml(tasks, computeStats(tasks)));
  assert.ok(bodies.length > 0, "the page carries no inline script — the check has nothing to parse");
  for (const [i, body] of bodies.entries()) {
    assert.doesNotThrow(() => parseOrThrow(body), `script #${i + 1} in the generated page does not parse`);
  }
});

test("viewer: task text with quotes does not break the page", () => {
  const tasks = readTasks();
  const nasty = {
    ...tasks[0],
    id: tasks[0].id,
    title: `a task's "title" with \\ and </script> and \` inside`,
  };
  for (const body of scriptBodies(buildHtml([nasty], computeStats([nasty])))) {
    assert.doesNotThrow(() => parseOrThrow(body), "a quote in a task's data breaks the page");
  }
});

test("positive control: the parser rejects the escape that actually broke the page", () => {
  assert.throws(() => parseOrThrow(`const s = 'a task's <code>updated</code>';`));
});
