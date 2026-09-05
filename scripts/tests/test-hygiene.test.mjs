/**
 * No test may read the DEVELOPER's home directory (TL-166).
 *
 * WHY THIS GUARD EXISTS. TL-157 wired the user preferences layer into the actor
 * chain, and preferences are facts about a PERSON: their actor, their editor,
 * the model endpoint on their laptop. A test that reads them answers differently
 * on different machines, and it does so silently — green here, red on somebody
 * whose config file happens to say something.
 *
 * IT WAS NOT HYPOTHETICAL. Run against a home declaring every preference,
 * `seed-adapter.test.mjs` failed: it asserts the message you get when NO model
 * is configured, and its own comment said "no `llm_endpoint` is configured in
 * this test environment" — an assumption about the machine, written down as if
 * it were a fact about the suite. On a developer with a local model that test
 * fails, and nothing would have said why.
 *
 * THE RULE IS UNIFORM, and that is the decision: EVERY test file calls
 * `isolateHome()`. The narrower rule — only the files that spawn the CLI or
 * touch the activity log — needs the guard to detect "spawns the CLI" by
 * reading source text, and it misses a file that merely imports a module which
 * reads the home in-process. A rule with a hole is worse than a broad rule,
 * because the hole is where the next file lands.
 *
 * `node --test` runs each FILE in its own process, so one call per file covers
 * every case in it, and no case can be forgotten individually.
 *
 * THE POSITIVE CONTROL IS THE POINT. A guard that only ever sees a clean tree is
 * green with no evidentiary force (CLAUDE.md), so the detection is a pure
 * function fed a file that does not isolate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("test-hygiene");

const TESTS_DIR = join(SCRIPTS_DIR, "tests");

/** A deliberate exception, declared beside the reason for it, exactly as the
 *  language and product-name guards take theirs. */
export const ALLOW_MARKER = "home-isolation: allow";

/**
 * PURE — given file names and a reader, which ones do not isolate their home?
 *
 * The check is for the CALL, not the import: importing the helper and never
 * calling it is the shape a careless edit leaves behind, and it would satisfy
 * any rule written about imports.
 */
export function filesWithoutIsolation(names, read) {
  return names
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => {
      const text = read(f);
      return !/\bisolateHome\s*\(/.test(text) && !text.includes(ALLOW_MARKER);
    });
}

test("every test file isolates its home", () => {
  const names = readdirSync(TESTS_DIR).sort();
  const missing = filesWithoutIsolation(names, (f) => readFileSync(join(TESTS_DIR, f), "utf8"));
  assert.deepEqual(missing, [],
    "these test files read the developer's own home directory — call `isolateHome(\"<name>\")` " +
      "once at the top, or declare the exception with a `" + ALLOW_MARKER + "` comment");
});

test("POSITIVE CONTROL: a file that does not isolate is CAUGHT", () => {
  // Without this the assertion above would pass just as happily against a rule
  // that can never fire.
  const files = {
    "good.test.mjs": 'import { isolateHome } from "./_repo.mjs";\nisolateHome("good");\n',
    "bad.test.mjs": 'import { test } from "node:test";\ntest("x", () => {});\n',
    // Imported and never called: the shape a careless edit leaves behind.
    "half.test.mjs": 'import { isolateHome } from "./_repo.mjs";\ntest("x", () => {});\n',
    "allowed.test.mjs": "// home-isolation: allow — this one tests a real home on purpose\n",
    "_helper.mjs": "export const x = 1;\n",
  };
  assert.deepEqual(
    filesWithoutIsolation(Object.keys(files).sort(), (f) => files[f]),
    ["bad.test.mjs", "half.test.mjs"]
  );
});

test("the guard is looking at a real directory full of real tests", () => {
  // The other half of the control: if the listing were empty or the path wrong,
  // "no file is missing isolation" would be true and worthless.
  const names = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".test.mjs"));
  assert.ok(names.length > 50, "only " + names.length + " test files found — the guard is looking in the wrong place");
});
