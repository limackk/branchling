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

// ─── Every exposed name is defined (TL-438) ──────────────────────────
//
// PARSING IS NOT ENOUGH, and this file's own header said so before the bug
// arrived: "a page that only THROWS at runtime is a different bug". This is
// that bug. `window.foo = foo;` at the top level runs on load, so a name that
// no longer exists throws a ReferenceError there and every statement after it
// never runs — including the first render. The page then serves 200, carries
// its data, parses clean, and shows a shell with nothing inside it.
//
// Measured on 2026-09-22: thirteen of the fourteen exposures named functions
// TL-379 had removed with the viewer's write surface. The throw was on the
// SECOND line of the block, so the viewer had been blank since that change and
// every test still passed, because they all read the page as text.

const EXPOSURE = /window\.([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;

// THE PAGE CARRIES THE WHOLE BACKLOG, so a task whose text quotes an exposure
// would be read as one — this task's own Context does exactly that. The data
// lines are dropped before the scan, and a control below asserts the drop
// really removed them, so the guard cannot silently start auditing prose.
const DATA_LINE = /^\s*(?:let|const|var)\s+(?:ALL_TASKS|HISTORY)\s*=.*$/gm;

/** @returns {string} the script with its embedded data lines removed. */
function codeOnly(body) {
  return body.replace(DATA_LINE, "");
}

/** @returns {string[]} the right-hand name of every `window.x = y;` in a script. */
function exposedNames(body) {
  return [...body.matchAll(EXPOSURE)].map((m) => m[2]);
}

/** Whether a script declares `name` as a function, const, let or var. */
function declares(body, name) {
  const decl = new RegExp(
    `(?:^|[\\s;{])(?:async\\s+)?function\\s+${name}\\b|(?:^|[\\s;{])(?:const|let|var)\\s+${name}\\b`
  );
  return decl.test(body);
}

test("viewer: every name the page exposes on window is defined in the page", () => {
  const tasks = readTasks();
  assert.ok(tasks.length > 0, "no tasks read — the check would have no sample");

  const bodies = scriptBodies(buildHtml(tasks, computeStats(tasks)));
  let checked = 0;
  for (const body of bodies) {
    const code = codeOnly(body);
    assert.ok(code.length < body.length || !/ALL_TASKS/.test(body),
      "the data lines were not removed — the guard would be auditing the backlog's prose");
    for (const name of exposedNames(code)) {
      checked += 1;
      assert.ok(declares(code, name), `the page assigns window.${name} but never defines ${name} — ` +
        "that is a ReferenceError at load, and everything after it, including the first render, is dead");
    }
  }
  // A ZERO SAMPLE MUST NOT MAKE THIS GREEN: the block exists, so the scan has to find it.
  assert.ok(checked > 0, "no `window.x = y;` exposure found — the guard measured nothing");
});

test("positive control: an exposure with no definition is reported", () => {
  const body = "function present() {}\nwindow.present = present;\nwindow.absent = absent;\n";
  const names = exposedNames(body);
  assert.deepEqual(names, ["present", "absent"], "the scan reads both exposures");
  assert.ok(declares(body, "present"), "a defined name is recognised");
  assert.ok(!declares(body, "absent"), "an undefined name is not recognised");
});
