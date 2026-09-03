#!/usr/bin/env node
/**
 * The 60-second demo scenario is executable, not a screenshot (TL-102).
 *
 * `docs/demo/scenario.md` is the script for the recording that hangs in the
 * README header. A recording is a frozen claim about how the tool behaves: the
 * moment `branchling done` changes a word of its refusal, the recording starts
 * lying and nothing says so. Re-recording is a manual act; noticing that it is
 * needed must not be.
 *
 * So this test replays the scenario against the live CLI and asserts the three
 * beats the recording is built on:
 *
 *   1. `done` REFUSES on a failing verification, exits non-zero, and shows the
 *      real test output rather than a summary of it.
 *   2. The refusal leaves the task file byte-for-byte untouched — that is the
 *      sentence the recording freezes on.
 *   3. After the fix the same invocation closes the task AND ticks the criterion
 *      that names the verification entry which proved it.
 *
 * A failure here does not mean the code is broken. It means the recording is
 * now out of date, and the scenario has to be re-walked before release.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("demo-scenario");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const SCENARIO = join(HERE, "..", "..", "docs", "demo", "scenario.md");

/**
 * Runs the CLI in `cwd`, returning stdout+stderr and the exit code instead of throwing.
 *
 * The environment is scrubbed of `NODE_TEST_CONTEXT` on purpose. The demo's own
 * verification entry is `node --test parse.test.mjs`, and a `node --test` that
 * inherits that variable reports its result UP to the outer runner and exits 0 —
 * so the refusal scene would silently turn green here while behaving correctly
 * in the user's shell the recording is made in.
 */
function cli(cwd, args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

// Scene 2 of the scenario: an empty text falls apart into one empty line.
const PARSE_BROKEN = `export function parse(text) {
  return text.split("\\n").map((line) => line.trim());
}
`;

// Scene 4: the one-line fix.
const PARSE_FIXED = `export function parse(text) {
  if (text.trim() === "") return [];
  return text.split("\\n").map((line) => line.trim());
}
`;

const PARSE_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "./parse.mjs";

test("an empty file parses to no rows", () => {
  const rows = parse("");
  assert.equal(rows.length, 0, \`expected 0 rows, got \${JSON.stringify(rows)}\`);
});
`;

/** Walks scenes 0-2: a fresh backlog, a task carrying its own contract, broken code. */
function stageDemo() {
  const root = mkdtempSync(join(tmpdir(), "branchling-demo-"));
  // Scene 0 runs `git init` on purpose: verification entries run from the
  // REPOSITORY root, so without it the relative `parse.test.mjs` in the
  // contract resolves against the backlog directory and fails for a reason
  // that has nothing to do with the demo.
  execFileSync("git", ["init", "-q", "."], { cwd: root, stdio: "ignore" });
  const init = cli(root, ["init", "--dir", "./backlog"]);
  assert.equal(init.code, 0, `scene 0 (init) failed:\n${init.out}`);

  const made = cli(root, ["new", "--title", "Parser accepts an empty file"]);
  assert.equal(made.code, 0, `scene 1 (new) failed:\n${made.out}`);

  const tasksDir = join(root, "backlog", "tasks");
  const name = readdirSync(tasksDir).find((f) => /accepts-an-empty-file/.test(f));
  assert.ok(name, "scene 1: `new` did not produce the task file the scenario names");
  const file = join(tasksDir, name);
  // The id comes from the frontmatter, never from the filename: the prefix is a
  // config value, so a fixture that parses the name would encode this project's
  // vocabulary into a test of the tool.
  const id = readFileSync(file, "utf8").match(/^id: (\S+)$/m)?.[1];
  assert.ok(id, "scene 1: the generated task carries no `id:`");

  // The one manual edit the recording shows: a real verification entry, and a
  // criterion that points at it by id.
  const text = readFileSync(file, "utf8")
    .replace(
      /verification:[\s\S]*?bash: "command to run"/,
      'verification:\n  - id: empty-file\n    bash: "node --test parse.test.mjs"',
    )
    .replace(
      /- \[ \] Verifiable, not subjective\. \[proof: the-name\]/,
      "- [ ] `parse(\"\")` returns no rows. [proof: empty-file]",
    )
    .replace("status: pending", "status: in_progress");
  writeFileSync(file, text);

  writeFileSync(join(root, "parse.mjs"), PARSE_BROKEN);
  writeFileSync(join(root, "parse.test.mjs"), PARSE_TEST);
  return { root, file, id };
}

test("scene 3: `done` refuses on a failing verification and says the file was not touched", () => {
  const { root, file, id } = stageDemo();
  try {
    const before = readFileSync(file, "utf8");
    const run = cli(root, ["done", id]);

    assert.notEqual(run.code, 0, `the refusal must exit non-zero, got 0:\n${run.out}`);
    assert.match(run.out, /verification failed/, "the refusal must name what failed");
    assert.match(
      run.out,
      /expected 0 rows, got \[""\]/,
      "the refusal must carry the REAL test output — a summary is not evidence",
    );
    assert.match(
      run.out,
      /was NOT touched/,
      "the sentence the recording freezes on is missing from the refusal",
    );
    assert.equal(
      readFileSync(file, "utf8"),
      before,
      "the refusal changed the task file — the scenario's whole claim is that it does not",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scene 4: after the fix the same invocation closes the task and ticks the criterion", () => {
  const { root, file, id } = stageDemo();
  try {
    assert.notEqual(cli(root, ["done", id]).code, 0, "staging is wrong: the demo must fail first");

    writeFileSync(join(root, "parse.mjs"), PARSE_FIXED);
    const run = cli(root, ["done", id]);

    assert.equal(run.code, 0, `scene 4 must close the task, got exit ${run.code}:\n${run.out}`);
    const after = readFileSync(file, "utf8");
    assert.match(after, /^status: done$/m, "the task did not reach `done`");
    assert.match(
      after,
      /- \[x\] `parse\(""\)` returns no rows\. \[proof: empty-file\]/,
      "the criterion was not ticked by the run — a checkbox ticked by hand is the thing this refuses",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the scenario document still describes the commands this test replays", () => {
  const doc = readFileSync(SCENARIO, "utf8");
  for (const beat of [
    "branchling init --dir ./backlog",
    'branchling new --title "Parser accepts an empty file"',
    "branchling done TASK-2",
    "was NOT touched",
    'bash: "node --test parse.test.mjs"',
  ]) {
    assert.ok(
      doc.includes(beat),
      `docs/demo/scenario.md no longer contains \`${beat}\` — the script and the replay have drifted apart`,
    );
  }
});
