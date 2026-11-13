/**
 * The scope of a mutation run: what it mutates and which tests it consults
 * (TL-576). No Stryker here — this file runs in the default suite, which CI
 * runs WITHOUT `npm install`. The run itself is proved by
 * `scripts/tests/mutation/subprocess-kill.test.mjs`.
 *
 * Each fixture is a throwaway git repository with a `main` branch and a
 * feature branch on top, laid out like this one: `scripts/` holds the code,
 * `scripts/tests/` the tests, and `scripts/cli.mjs` exports a `COMMANDS`
 * table that dispatches to scripts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import os, { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REPO_ROOT, SCRIPTS_DIR, isolateHome, isolateState, scriptSource, sourceRoot } from "./_repo.mjs";
import {
  ALLOCATION_FAILURE, DEFAULT_BUDGET_MINUTES, DEFAULT_MEMORY_CAP, MIN_SWEEP_MARKER, formatCap, memoryCapReport, parseMemoryCap, SOURCE_ROOT_ENV, STOP_GRACE_MS, countMutants, estimateSeconds, formatDuration, leftoverProcesses,
  SANDBOX_GIT_INIT, SILENT_LOGGER, keepReport, changedLineRanges, directorySymlinks, importClosure, loadInstrumenter, main, mutateDescriptions,
  parseArgs, reachesCli, runStryker, sandboxCommand, selectTests, strykerConfig, strykerEnv, summarise, sweepLeftovers, timeTests, timingLimitSeconds, costReport, usage, workerTestArgs,
} from "../mutation-run.mjs";
import {
  SLOT_TOKEN_ENV, WORKER_TEST_FILES, cgroupHeadroom, chooseConcurrency, describeHolder, releaseSlot, slotPath, testFileConcurrency, tryAcquireSlot,
} from "../mutation-slot.mjs";
import { STATE_DIR_ENV } from "../lock.mjs";

const HOME = isolateHome("mutation-run");
// Every run spawned here, and the slot holders below, use a throwaway slot,
// never the one a real mutation run on this machine holds.
const STATE = isolateState("mutation-run-state");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

// Built rather than written out: this file would otherwise build the path of
// the repository's CLI itself, and be selected for every module cli.mjs imports.
const SPAWN_CLI = "const c = join(SCRIPTS_DIR, " + JSON.stringify("cli.mjs") + ");";

function fixture() {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-scope-"));
  write(root, "scripts/lib.mjs", "export const lib = () => 1;\n");
  write(root, "scripts/greet.mjs", 'import { lib } from "./lib.mjs";\nconsole.log(lib());\n');
  write(root, "scripts/other.mjs", "export const other = () => 2;\n");
  write(root, "scripts/cli.mjs", 'export const COMMANDS = { greet: { script: "greet.mjs" } };\n');
  // Rule 1: names the module.
  write(root, "scripts/tests/named.test.mjs", 'import "../lib.mjs";\n');
  // Rule 2: names a script that imports it.
  write(root, "scripts/tests/via-script.test.mjs", 'const s = "greet.mjs";\n');
  // Rule 3: builds the path of scripts/cli.mjs and names a command whose script imports it.
  write(root, "scripts/tests/via-command.test.mjs", SPAWN_CLI + ' run(["greet"]);\n');
  // Spawns the CLI, but names no command that reaches lib.mjs.
  write(root, "scripts/tests/cli-unrelated.test.mjs", SPAWN_CLI + ' run(["serve"]);\n');
  write(root, "scripts/tests/unrelated.test.mjs", 'const s = "other.mjs";\n');
  // Names a file called cli.mjs that a fixture of its own writes, and the command
  // word, but never spawns the repository's CLI (TL-591).
  write(root, "scripts/tests/names-cli.test.mjs", 'write(root, "scripts/cli.mjs", ""); run(["greet"]);\n');
  // A relative specifier that resolves to the repository root, not to scripts/.
  write(root, "scripts/tests/wrong-depth.test.mjs", 'const c = new URL("../../cli.mjs", import.meta.url); run(["greet"]);\n');
  // Outside the default glob, and the same specifier resolves to scripts/cli.mjs from here.
  write(root, "scripts/tests/nested/deep.test.mjs", 'const c = new URL("../../cli.mjs", import.meta.url); run(["greet"]);\n');
  write(root, "scripts/tests/nested/unrelated.test.mjs", 'const s = "other.mjs";\n');
  // A helper beside the tests names both modules, but is not a test file.
  write(root, "scripts/tests/nested/_helper.mjs", 'import "../../lib.mjs"; import "../../other.mjs";\n');
  sh(root, "git", ["init", "-q"]);
  sh(root, "git", ["add", "-A"]);
  sh(root, "git", ["commit", "-q", "-m", "base"]);
  sh(root, "git", ["switch", "-q", "-c", "feature"]);
  return root;
}

function run(root, args) {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function planOf(root, extra = []) {
  const r = run(root, ["--base", "main", "--plan", "--json", ...extra]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out);
}

test("the run mutates only the modules changed against the base, the working tree included", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");            // unstaged
    write(root, "scripts/fresh.mjs", "export const fresh = 1;\n");              // untracked
    write(root, "scripts/tests/named.test.mjs", 'import "../lib.mjs"; // x\n'); // a test, never mutated
    write(root, "README.md", "not code\n");
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    sh(root, "git", ["commit", "-qam", "committed change"]);                     // committed on the branch
    write(root, "scripts/lib.mjs", "export const lib = () => 5;\n");

    const p = planOf(root);
    assert.equal(p.kind, "mutation-plan");
    assert.deepEqual(p.modules, ["scripts/fresh.mjs", "scripts/lib.mjs", "scripts/other.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run with nothing changed fails and reports no score", () => {
  const root = fixture();
  try {
    write(root, "scripts/tests/named.test.mjs", "// only a test changed\n");
    const r = run(root, ["--base", "main", "--json"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /nothing to mutate/);
    assert.equal(r.out, "", "a refused run printed something that could be read as a result");
    assert.deepEqual(r.err.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(1, 3), [
      "  A score over an empty set would read like a score over real work, so none is reported.",
      "  → node scripts/mutation-run.mjs --files scripts/<module>.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tests are selected by name, by an importing script and by a command, and not otherwise", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");
    const p = planOf(root);
    assert.deepEqual(p.modules, ["scripts/lib.mjs"]);
    const why = Object.fromEntries(p.tests.map((t) => [t.file, t.why.join("; ")]));
    assert.deepEqual(Object.keys(why).sort(), [
      "scripts/tests/named.test.mjs",
      "scripts/tests/nested/deep.test.mjs",
      "scripts/tests/via-command.test.mjs",
      "scripts/tests/via-script.test.mjs",
    ]);
    assert.match(why["scripts/tests/named.test.mjs"], /lib\.mjs named/);
    assert.match(why["scripts/tests/via-script.test.mjs"], /imported by greet\.mjs/);
    assert.match(why["scripts/tests/via-command.test.mjs"], /via `greet`/);
    assert.match(why["scripts/tests/nested/deep.test.mjs"], /via `greet`/);

    const narrow = planOf(root, ["--named-only"]);
    assert.deepEqual(narrow.tests.map((t) => t.file), ["scripts/tests/named.test.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a nested test file is selected by name like a top-level one (TL-591)", () => {
  const root = fixture();
  try {
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    const p = planOf(root);
    assert.deepEqual(p.tests.map((t) => t.file), [
      "scripts/tests/nested/unrelated.test.mjs",
      "scripts/tests/unrelated.test.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a module the CLI imports selects the tests that spawn the CLI, not the ones that name a file cli.mjs (TL-591)", () => {
  const root = fixture();
  try {
    write(root, "scripts/cli.mjs", 'import "./other.mjs";\nexport const COMMANDS = { greet: { script: "greet.mjs" } };\n');
    sh(root, "git", ["commit", "-qam", "cli imports other"]);
    sh(root, "git", ["branch", "-qf", "main"]);
    write(root, "scripts/other.mjs", "export const other = () => 4;\n");
    const p = planOf(root);
    assert.deepEqual(p.modules, ["scripts/other.mjs"]);
    const why = Object.fromEntries(p.tests.map((t) => [t.file, t.why.join("; ")]));
    assert.deepEqual(Object.keys(why).sort(), [
      "scripts/tests/cli-unrelated.test.mjs",
      "scripts/tests/nested/deep.test.mjs",
      "scripts/tests/nested/unrelated.test.mjs",
      "scripts/tests/unrelated.test.mjs",
      "scripts/tests/via-command.test.mjs",
    ]);
    assert.match(why["scripts/tests/cli-unrelated.test.mjs"], /other\.mjs imported by cli\.mjs/);
    assert.match(why["scripts/tests/nested/deep.test.mjs"], /other\.mjs imported by cli\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the CLI is recognised by the path a test builds, not by the name cli.mjs (TL-591)", () => {
  // `@` stands for the CLI's filename, so that this file does not contain the
  // forms it asserts on and stays unselected for what cli.mjs imports.
  const reaches = (text, at = "scripts/tests/x.test.mjs") => reachesCli(text.split("@").join("cli.mjs"), at);
  for (const text of [
    'spawnSync(process.execPath, [join(SCRIPTS_DIR, "@"), "next"])',
    'const CLI = join(HERE, "..", "@");',
    'const CLI = join(SCRIPTS_DIR,"@" );',
    'const CLI = SCRIPTS_DIR+"/@";',
    'const CLI = join(ROOT, "scripts", "@");',
    'spawnSync(process.execPath, [SCRIPTS_DIR + "/@", "query"])',
    'const CLI = fileURLToPath(new URL("../@", import.meta.url));',
    'import { COMMANDS } from "../@";',
  ]) assert.equal(reaches(text), true, text);
  assert.equal(reaches('const c = new URL("../../@", import.meta.url);', "scripts/tests/nested/x.test.mjs"), true);
  for (const text of [
    'write(root, "scripts/@", "");',
    'step.command === "node scripts/@ check"',
    'const c = new URL("./@", import.meta.url);',
    'const c = new URL("../../@", import.meta.url);',
  ]) assert.equal(reaches(text), false, text);
  // The case that was measured on 2026-11-06: this file's fixtures name
  // cli.mjs, and it was selected for the task-id module, which it never
  // reaches. The module is not named here, or rule 1 would select it again.
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  assert.equal(reachesCli(self, "scripts/tests/mutation-run.test.mjs"), false);
});

test("a changed module that no test reaches fails instead of scoring zero", () => {
  const root = fixture();
  try {
    write(root, "scripts/orphan.mjs", "export const orphan = 1;\n");
    write(root, "scripts/stray.mjs", "export const stray = 1;\n");
    const r = run(root, ["--base", "main"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.deepEqual(r.err.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 3), [
      "✗ node scripts/mutation-run.mjs: no test file reaches scripts/orphan.mjs, scripts/stray.mjs",
      "  Every mutant would survive, and that would measure the selection, not the suite.",
      "  → node scripts/mutation-run.mjs --tests scripts/tests/<file>.test.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a --files entry with a line range selects its module's tests and reaches Stryker unchanged (TL-658)", () => {
  const root = fixture();
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 1;\nexport const two = () => 2;\nexport const three = () => 3;\n");
    for (const extra of [[], ["--named-only"]]) {
      const bare = planOf(root, ["--files", "scripts/lib.mjs", ...extra]);
      const ranged = planOf(root, ["--files", "scripts/lib.mjs:1-2", ...extra]);
      assert.ok(bare.tests.length > 0, "a selection compared against an empty one proves nothing");
      assert.deepEqual(ranged.tests, bare.tests, "the range changed the selection " + extra.join(" "));
      assert.deepEqual(ranged.modules, ["scripts/lib.mjs"]);
      assert.deepEqual(ranged.mutate, ["scripts/lib.mjs:1-2"]);
      assert.deepEqual(ranged.lines, { "scripts/lib.mjs": [{ start: 1, end: 2 }] });
      assert.equal(bare.lines, undefined, "a whole module is reported as ranges");
      assert.equal(ranged.noAddedLines, undefined, "a hand-written range claims a change was read");
    }

    const two = planOf(root, ["--files", "scripts/lib.mjs:1-1,scripts/lib.mjs:3-3,scripts/other.mjs"]);
    assert.deepEqual(two.modules, ["scripts/lib.mjs", "scripts/other.mjs"]);
    assert.deepEqual(two.mutate, ["scripts/lib.mjs:1-1", "scripts/lib.mjs:3-3", "scripts/other.mjs"]);
    assert.deepEqual(two.lines, { "scripts/lib.mjs": [{ start: 1, end: 1 }, { start: 3, end: 3 }] });

    const alsoWhole = planOf(root, ["--files", "scripts/lib.mjs:1-1,scripts/lib.mjs"]);
    assert.deepEqual(alsoWhole.modules, ["scripts/lib.mjs"]);
    assert.equal(alsoWhole.lines, undefined, "a module also given whole is mutated whole");

    const text = run(root, ["--files", "scripts/lib.mjs:1-2,scripts/other.mjs", "--plan"]);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /^mutate \(2\): scripts\/lib\.mjs, scripts\/other\.mjs$/m);
    assert.match(text.out, /^mutated lines only: scripts\/lib\.mjs:1-2$/m);
    assert.match(text.out, /^not mutated: every line outside these ranges/m);
    assert.doesNotMatch(text.out, /no added line/);
    const several = run(root, ["--files", "scripts/lib.mjs:1-1,scripts/lib.mjs:3-3,scripts/other.mjs:1-1", "--plan"]);
    assert.equal(several.code, 0, several.err);
    assert.match(several.out, /^mutated lines only: scripts\/lib\.mjs:1-1,3-3  scripts\/other\.mjs:1-1$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown flag fails", () => {
  const r = run(HOME, ["--everything"]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.err.replace(/\x1b\[[0-9;]*m/g, "").split("\n").slice(0, 3), [
    '✗ node scripts/mutation-run.mjs: unknown argument "--everything"',
    "  known flags: --base --files --tests --concurrency --budget --keep-report --memory-cap --plan --json --named-only --changed-lines --no-wait",
    "  → node scripts/mutation-run.mjs --help",
  ]);
});

// TL-678. The accepted set is read from the refusal, which the parser builds
// from its own sets, so a flag added there without a help line fails here.
// Colour is stripped, not disabled: under FORCE_COLOR the refusal ends in a
// reset sequence, and the assertions are about the text, not the terminal.
test("--help names every accepted flag with a description and exits 0", () => {
  const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const refused = run(HOME, ["--everything"]);
  const err = plain(refused.err);
  const known = /known flags: (.+)/.exec(err);
  assert.ok(known, err);
  assert.match(err, /→ node scripts\/mutation-run\.mjs --help$/m, "the refusal points at --help");
  const flags = known[1].trim().split(/\s+/);
  assert.ok(flags.includes("--changed-lines") && flags.length >= 10, "positive control: " + flags.join(" "));
  for (const asked of ["--help", "-h"]) {
    const shown = run(HOME, [asked]);
    assert.equal(shown.code, 0, shown.err);
    assert.equal(shown.err, "");
    const out = plain(shown.out);
    assert.match(out, /^usage: node scripts\/mutation-run\.mjs \[flags\]$/m);
    const columns = new Set();
    for (const flag of ["-h, --help", ...flags]) {
      const line = out.split("\n").find((l) => l.startsWith("  " + flag + " "));
      assert.ok(line, flag + " has no help line");
      const m = /^  (\S+(?:,? \S+)?) +(\S.*)$/.exec(line);
      assert.ok(m, flag + ": " + JSON.stringify(line));
      // A value placeholder exactly where the parser demands a value.
      const takesValue = /needs a value/.test(parseArgs([flag]).error || "");
      if (flag !== "-h, --help") assert.equal(/ <[^>]+>$/.test(m[1]), takesValue, flag + ": " + JSON.stringify(line));
      assert.doesNotMatch(m[2], /undefined/, flag);
      columns.add(line.length - m[2].length);
    }
    assert.equal(columns.size, 1, "descriptions start in one column");
    assert.match(out, new RegExp("^  --budget <minutes> +.*\\(default: " + DEFAULT_BUDGET_MINUTES + "\\)$", "m"));
  }
  // --help wins over the flags around it, so it never starts a run.
  const late = run(HOME, ["--plan", "--help"]);
  assert.equal(late.code, 0, late.err);
  assert.match(plain(late.out), /^usage:/);
});

// TL-646. The parsing half of the end-of-run sweep, without `ps` or a process
// to kill; `mutation/no-orphan-processes.test.mjs` holds the half that kills.
test("a leftover is a process naming the marker, never the one asking", () => {
  const ps = [
    "  101   100 /usr/bin/node /tmp/mutation-run-AbCdEf/sandbox/sandbox-1/scripts/cli.mjs",
    "  102   102 /bin/sh .git/hooks/commit-msg .git/COMMIT_EDITMSG",
    "  103   100 node /tmp/mutation-run-AbCdEf/sandbox/sandbox-1/scripts/serve-backlog.mjs --port 0",
    "  104   104 node /tmp/mutation-run-AbCdEg/sandbox/sandbox-1/scripts/cli.mjs",
    "  105   100 node /tmp/mutation-run-AbCdEf/sandbox/x.mjs",
    "not a ps line /tmp/mutation-run-AbCdEf/",
    "",
  ].join("\n");
  assert.deepEqual(leftoverProcesses("/tmp/mutation-run-AbCdEf/", ps, 105), [
    { pid: 101, pgid: 100, args: "/usr/bin/node /tmp/mutation-run-AbCdEf/sandbox/sandbox-1/scripts/cli.mjs" },
    { pid: 103, pgid: 100, args: "node /tmp/mutation-run-AbCdEf/sandbox/sandbox-1/scripts/serve-backlog.mjs --port 0" },
  ]);
});

// TL-629. The end-to-end form of this — a nested run started with an outer
// id — cannot live in `mutation/subprocess-kill.test.mjs`: that file runs
// inside an outer mutation run whenever this module changes, and an id the
// test sets for its child switches on the OUTER run's mutant of that number
// in the child, during the outer initial run as well, so the outer run judged
// mutant 0 instead of the one under test. Measured on 2026-11-09.
test("Stryker is started without the active mutant or the test context of a run above it", () => {
  const above = { PATH: "/bin", HOME: "/h", NODE_TEST_CONTEXT: "child-v8", __STRYKER_ACTIVE_MUTANT__: "0" };
  assert.deepEqual(strykerEnv(above), { PATH: "/bin", HOME: "/h" });
  assert.equal(above.__STRYKER_ACTIVE_MUTANT__, "0", "the caller's environment was changed, not copied");
  assert.equal(strykerEnv().PATH, process.env.PATH, "without an argument it is this process's environment");
});

// TL-653. A test that reads a module's source text must find it as written,
// not the instrumented sandbox copy, or the initial run fails on a change it
// has nothing to do with.
test("Stryker is told the tree the run started in, never an outer run's", () => {
  const above = { PATH: "/bin", [SOURCE_ROOT_ENV]: "/outer" };
  assert.deepEqual(strykerEnv(above, "/inner"), { PATH: "/bin", [SOURCE_ROOT_ENV]: "/inner" });
  assert.deepEqual(strykerEnv(above), { PATH: "/bin" }, "without a root an outer run's tree is dropped, not kept");
});

test("scriptSource reads the tree a mutation run names, and this one otherwise", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-source-root-"));
  write(root, "scripts/build-viewer.mjs", "// the original, uninstrumented\n");
  assert.equal(scriptSource("build-viewer.mjs", { [SOURCE_ROOT_ENV]: root }), "// the original, uninstrumented\n");
  assert.equal(scriptSource("mutation-run.mjs", {}), readFileSync(ENTRY, "utf8")); // source-read: allow — the copy scriptSource must equal
  // A guard that walks scripts/ or bin/ joins onto the same root (TL-702).
  assert.equal(sourceRoot({ [SOURCE_ROOT_ENV]: root }), root);
  assert.equal(sourceRoot({}), REPO_ROOT);
  rmSync(root, { recursive: true, force: true });
});

test("the test command runs inside the containing process group, under this process's node", () => {
  const cmd = sandboxCommand([], ["scripts/tests/a.test.mjs"], "/x/contain.mjs", 4);
  assert.equal(cmd, SANDBOX_GIT_INIT + " && ulimit -d 4194304 && " + [process.execPath, "/x/contain.mjs", process.execPath, "--test", "--test-concurrency=4",
    "scripts/tests/a.test.mjs"].map((s) => "'" + s + "'").join(" "));
});

// TL-706: node's default runs cores - 1 test files at once, 4852 MB for ONE
// worker on a 32-core machine; at 4 at once the same files peaked at 1392 MB.
test("a worker's test command bounds the files run at once, and leaves the flag out where node has none", () => {
  assert.deepEqual(workerTestArgs(["a.test.mjs", "b.test.mjs"], 4), ["--test", "--test-concurrency=4", "a.test.mjs", "b.test.mjs"]);
  assert.deepEqual(workerTestArgs(["a.test.mjs"], null), ["--test", "a.test.mjs"], "Node 18 would refuse the flag");
  const without = sandboxCommand([], ["scripts/tests/a.test.mjs"], "/x/contain.mjs", null);
  assert.ok(without.endsWith(" '" + process.execPath + "' '--test' 'scripts/tests/a.test.mjs'"), without);
  assert.ok(!without.includes("--test-concurrency"), without);
  // The default is this node's own answer, in the command and the arguments alike.
  assert.equal(sandboxCommand([], ["t.test.mjs"], "/c.mjs"), sandboxCommand([], ["t.test.mjs"], "/c.mjs", testFileConcurrency()));
  assert.deepEqual(workerTestArgs(["t.test.mjs"]), workerTestArgs(["t.test.mjs"], testFileConcurrency()));
});

test("the bound is passed only to a node that accepts --test-concurrency, and never above cores - 1", () => {
  for (const version of ["18.0.0", "18.20.4", "19.9.0", "20.0.0", "20.9.0"]) {
    assert.equal(testFileConcurrency({ version, cores: 32 }), null, version + " has no --test-concurrency");
  }
  for (const version of ["20.10.0", "20.18.1", "21.0.0", "22.22.0", "24.1.0"]) {
    assert.equal(testFileConcurrency({ version, cores: 32 }), WORKER_TEST_FILES, version);
  }
  assert.equal(WORKER_TEST_FILES, 4);
  assert.equal(testFileConcurrency({ version: "22.0.0", cores: 5 }), 4);
  assert.equal(testFileConcurrency({ version: "22.0.0", cores: 4 }), 3, "node's own default on four cores is three");
  assert.equal(testFileConcurrency({ version: "22.0.0", cores: 2 }), 1);
  assert.equal(testFileConcurrency({ version: "22.0.0", cores: 1 }), 1, "one core still runs one file");
  // Without a version, the running node's.
  assert.equal(testFileConcurrency({ cores: 32 }), testFileConcurrency({ version: process.versions.node, cores: 32 }));
});

// TL-726: on 2026-11-13 one test process of a mutation run reached 30 GB off
// the V8 heap in under a minute and the OOM killer took the whole terminal.
test("the sandbox command sets the data cap right before node --test, and none leaves it out", () => {
  assert.equal(DEFAULT_MEMORY_CAP, "4G");
  const capped = sandboxCommand([], ["t.test.mjs"], "/c.mjs", 4, 524288);
  const node = [process.execPath, "/c.mjs", process.execPath, "--test", "--test-concurrency=4", "t.test.mjs"].map((s) => "'" + s + "'").join(" ");
  assert.equal(capped, SANDBOX_GIT_INIT + " && ulimit -d 524288 && " + node);
  assert.equal(sandboxCommand([], ["t.test.mjs"], "/c.mjs", 4, null), SANDBOX_GIT_INIT + " && " + node);
  assert.equal(sandboxCommand([], ["t.test.mjs"], "/c.mjs", 4), sandboxCommand([], ["t.test.mjs"], "/c.mjs", 4, 4 * 1024 * 1024),
    "the default is 4 GiB in KiB, the unit ulimit -d takes");
  const p = { mutate: ["scripts/lib.mjs"], tests: [{ file: "t.test.mjs" }] };
  assert.match(strykerConfig(p, { concurrency: 1 }, [], "/work").commandRunner.command, / && ulimit -d 4194304 && /);
  assert.match(strykerConfig(p, { concurrency: 1, memoryCap: 1024 }, [], "/work").commandRunner.command, / && ulimit -d 1024 && /);
  assert.doesNotMatch(strykerConfig(p, { concurrency: 1, memoryCap: null }, [], "/work").commandRunner.command, /ulimit/);
});

test("--memory-cap reads binary sizes, none and 0 disable it, anything else fails", () => {
  assert.equal(parseArgs([]).opts.memoryCap, 4194304);
  assert.equal(parseArgs(["--memory-cap", "512M"]).opts.memoryCap, 524288);
  assert.equal(parseArgs(["--memory-cap", "2g"]).opts.memoryCap, 2097152);
  assert.equal(parseArgs(["--memory-cap", "64KiB"]).opts.memoryCap, 64);
  assert.equal(parseArgs(["--memory-cap", "1GB"]).opts.memoryCap, 1048576);
  assert.equal(parseArgs(["--memory-cap", "none"]).opts.memoryCap, null);
  assert.equal(parseArgs(["--memory-cap", "0"]).opts.memoryCap, null);
  for (const bad of ["4", "4T", "-1G", "0G", "04G", "G", "lots", "4 G", ""]) {
    assert.deepEqual(parseArgs(["--memory-cap", bad]),
      { error: "--memory-cap takes a size such as 512M or 4G, or none, not " + JSON.stringify(bad) }, bad);
  }
  assert.deepEqual(parseArgs(["--memory-cap"]), { error: "--memory-cap needs a value" });
  assert.deepEqual(parseMemoryCap("3M"), 3072);
});

test("the cap is printed in the unit a reader would write, and says where it is only advisory", () => {
  assert.equal(formatCap(4194304), "4 GiB");
  assert.equal(formatCap(524288), "512 MiB");
  assert.equal(formatCap(1536 * 1024), "1536 MiB");
  assert.equal(formatCap(100), "100 KiB");
  assert.equal(memoryCapReport(4194304, "linux"), "memory cap: 4 GiB of data per test process (ulimit -d)");
  assert.equal(memoryCapReport(4194304, "darwin"),
    "memory cap: 4 GiB of data per test process (ulimit -d); macOS does not enforce it, so here it is advisory");
  assert.match(memoryCapReport(null, "linux"), /^memory cap: none \(--memory-cap none\)/);
  assert.match(usage(), /--memory-cap <size> +data cap \(ulimit -d\) of every test process.*default: 4G; none or 0 disables; not enforced on macOS/);
});

// Bounded on purpose: without the cap this allocates 1 GiB and passes, so a
// mutant that drops the cap is caught without letting anything run away.
const ALLOCATES_ONE_GIB = `
import { test } from "node:test";
test("allocates 1 GiB in 32 MiB buffers", () => {
  const held = [];
  for (let i = 0; i < 32; i++) held.push(Buffer.alloc(32 * 1024 * 1024, 1));
});
`;

test("POSITIVE CONTROL: a test process that allocates beyond the command's cap dies of an allocation failure",
  { skip: process.platform !== "linux" && "only Linux enforces RLIMIT_DATA" }, () => {
  const dir = gitlessSandbox();
  write(dir, "scripts/tests/hog.test.mjs", ALLOCATES_ONE_GIB);
  const started = Date.now();
  const r = runIn(dir, sandboxCommand([], ["scripts/tests/hog.test.mjs"], undefined, 1, 256 * 1024));
  assert.notEqual(r.status, 0, "the process grew past the cap: " + r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, ALLOCATION_FAILURE);
  assert.ok(Date.now() - started < 30_000, "it died, but not before Stryker's own timeout");
  const free = runIn(dir, sandboxCommand([], ["scripts/tests/hog.test.mjs"], undefined, 1, 2 * 1024 * 1024));
  assert.equal(free.status, 0, "under a cap the allocation fits, the same test passes: " + free.stdout + free.stderr);
});

test("a mutant killed by an allocation failure is named apart from those an assertion killed", () => {
  const at = (line, status, statusReason) => ({ status, statusReason, mutatorName: "M", replacement: "r", location: { start: { line } } });
  const s = summarise({ files: { "scripts/a.mjs": { mutants: [
    at(1, "Killed", "not ok 1 - x\n  error: 'Expected values to be strictly equal'"),
    at(2, "Killed", "RangeError: Array buffer allocation failed"),
    at(3, "Killed", "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory"),
    at(4, "Survived", "Array buffer allocation failed"),
    at(5, "Killed", undefined),
  ] } } });
  assert.deepEqual(s.cappedOut.map((m) => m.line), [2, 3]);
  assert.deepEqual(s.survivors.map((m) => m.line), [4]);
  assert.equal(s.files["scripts/a.mjs"].Killed, 4, "still counted as detected");
});

test("a node that accepts the flag runs the tests under the bounded command",
  { skip: testFileConcurrency({ cores: 32 }) === null && "this node has no --test-concurrency" }, () => {
  const dir = gitlessSandbox();
  const r = runIn(dir, sandboxCommand([], ["scripts/tests/git.test.mjs"], undefined, 2));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# pass 1/);
});

// TL-674: Stryker's sandbox is a copy of the tree without `.git`, and a test
// asking git about its own tree failed the initial run, so no mutant was
// judged. The sandbox is played here by a directory outside any repository.
const ASKS_GIT_ABOUT_ITS_TREE = `
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
test("git answers about this tree", () => {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  assert.equal(realpathSync(top), realpathSync(process.cwd()));
  const eol = execFileSync("git", ["check-attr", "eol", "--", "README.md"], { encoding: "utf8" }).trim();
  assert.equal(eol.split(": ").pop(), "lf");
});
`;

function gitlessSandbox() {
  const dir = fixtureDir(join(tmpdir(), "branchling-test-mutation-sandbox-"));
  write(dir, ".gitattributes", "* text eol=lf\n");
  write(dir, "README.md", "x\n");
  write(dir, "scripts/tests/git.test.mjs", ASKS_GIT_ABOUT_ITS_TREE);
  return dir;
}

function runIn(dir, cmd, env = process.env) {
  const clean = { ...env };
  delete clean.NODE_TEST_CONTEXT;
  return spawnSync("sh", ["-c", cmd], { cwd: dir, encoding: "utf8", env: clean, timeout: 60_000 });
}

test("a test asking git about its own tree passes in a sandbox copied without .git", () => {
  const dir = gitlessSandbox();
  const r = runIn(dir, sandboxCommand([], ["scripts/tests/git.test.mjs"]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("POSITIVE CONTROL: without the init step the same test fails in that sandbox", () => {
  const dir = gitlessSandbox();
  const withoutInit = sandboxCommand([], ["scripts/tests/git.test.mjs"]).slice((SANDBOX_GIT_INIT + " && ").length);
  const r = runIn(dir, withoutInit);
  assert.notEqual(r.status, 0, "the fixture is inside a repository, so it cannot tell the step's absence apart");
});

test("a sandbox that already is a repository is not initialised again", () => {
  const dir = gitlessSandbox();
  sh(dir, "git", ["init", "-q"]);
  sh(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  sh(dir, "git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "kept"]);
  const r = runIn(dir, sandboxCommand([], ["scripts/tests/git.test.mjs"]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(sh(dir, "git", ["log", "--format=%s"]).trim(), "kept");
});

test("an inherited GIT_DIR does not point the sandbox's init at another repository", () => {
  const other = fixtureDir(join(tmpdir(), "branchling-test-mutation-other-"));
  sh(other, "git", ["init", "-q"]);
  const dir = gitlessSandbox();
  const r = runIn(dir, SANDBOX_GIT_INIT, { ...process.env, GIT_DIR: join(other, ".git") });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(dir, ".git", "HEAD")), "the sandbox received no repository of its own");
});

// The guards of the sweep, judged on a `ps` listing and a recording `kill`, so
// a defect here signals nothing real. The sweep's own header says why each of
// these is a guard and not a style choice.
function recordedSweep(marker, ps, self = 900) {
  const calls = [];
  const swept = sweepLeftovers(marker, { ps, self, kill: (pid, signal) => calls.push([pid, signal]) });
  return { swept, calls };
}

test("the sweep kills a leftover's group and the leftover, never its own group", () => {
  const marker = "/tmp/mutation-run-AbCdEf/";
  const ps = [
    "  900   800 node scripts/mutation-run.mjs",
    "  101   100 node /tmp/mutation-run-AbCdEf/sandbox/scripts/cli.mjs",
    "  102   800 node /tmp/mutation-run-AbCdEf/sandbox/scripts/serve-backlog.mjs",
    "  103     1 node /tmp/mutation-run-AbCdEf/sandbox/scripts/cli.mjs",
    "  104     0 node /tmp/mutation-run-AbCdEf/sandbox/scripts/cli.mjs",
    "  105   105 node /tmp/elsewhere/cli.mjs",
  ].join("\n");
  const { swept, calls } = recordedSweep(marker, ps);
  assert.deepEqual(swept.map((p) => p.pid), [101, 102, 103, 104]);
  assert.deepEqual(calls, [
    [-100, "SIGKILL"], [101, "SIGKILL"],
    // 800 is the sweeper's own group: by pid only.
    [102, "SIGKILL"],
    // A pgid of 1 or 0 is never signalled as a group: kill(-1) reaches every
    // process the user owns, kill(-0) the sweeper's own group.
    [103, "SIGKILL"],
    [104, "SIGKILL"],
  ]);
});

test("a kill that fails on the group still kills the leftover", () => {
  const calls = [];
  const kill = (pid, signal) => {
    calls.push([pid, signal]);
    if (pid < 0) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
  };
  sweepLeftovers("/tmp/mutation-run-AbCdEf/", { self: 1, kill, ps: "  101   100 node /tmp/mutation-run-AbCdEf/x.mjs\n" });
  assert.deepEqual(calls, [[-100, "SIGKILL"], [101, "SIGKILL"]]);
});

test("a marker too short to be a run's own directory is refused before anything is killed", () => {
  const ps = "  101   100 node /tmp/x.mjs\n  102   102 sh -c true\n";
  for (const marker of ["", "/", "/tmp/", "x".repeat(MIN_SWEEP_MARKER - 1), NaN, undefined]) {
    const calls = [];
    assert.throws(() => sweepLeftovers(marker, { ps, self: 1, kill: (...a) => calls.push(a) }), /refusing to sweep/,
      "marker " + JSON.stringify(marker) + " was accepted");
    assert.deepEqual(calls, []);
  }
  // POSITIVE CONTROL: one character more is a marker, so the refusal above is
  // the length, not something else about the call.
  const { calls } = recordedSweep("x".repeat(MIN_SWEEP_MARKER), "  101   100 node /" + "x".repeat(MIN_SWEEP_MARKER) + "\n", 1);
  assert.deepEqual(calls, [[-100, "SIGKILL"], [101, "SIGKILL"]]);
});

// ── The machine's mutation slot and the default concurrency (TL-681) ──────────

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

test("the default concurrency follows free memory, capped at half the cores", () => {
  // 3 test files at once: 64 MiB + 3 × 360 MiB = 1144 MiB per worker.
  const roomy = chooseConcurrency({ testFiles: 3, freeBytes: 16 * GiB, cores: 16, fileConcurrency: 4 });
  assert.equal(roomy.value, 8, "16 GiB fits 10 such workers; the cap is half of 16 cores");
  assert.match(roomy.reason,
    /^half of 16 cores; 16\.0 GB free, 75% of it at 1\.1 GB per worker \(3 test files at once, --test-concurrency=4\) would allow 10$/);

  const tight = chooseConcurrency({ testFiles: 3, freeBytes: 4 * GiB, cores: 16, fileConcurrency: 4 });
  assert.equal(tight.value, 2, "3 GiB usable over 1144 MiB per worker");
  assert.match(tight.reason,
    /^4\.0 GB free, 75% of it at 1\.1 GB per worker \(3 test files at once, --test-concurrency=4\), below the cap of 8 \(half of 16 cores\)$/);

  const starved = chooseConcurrency({ testFiles: 3, freeBytes: 512 * MiB, cores: 16, fileConcurrency: 4 });
  assert.equal(starved.value, 1);
  assert.match(starved.reason, /allows none; one worker is the least a run can use$/);
  assert.equal(chooseConcurrency({ testFiles: 1, freeBytes: 64 * GiB, cores: 1, fileConcurrency: 1 }).value, 1, "one core still runs one worker");
  assert.match(chooseConcurrency({ testFiles: 1, freeBytes: 64 * GiB, cores: 1, fileConcurrency: 1 }).reason, /\(1 test file at once, /);

  assert.deepEqual(chooseConcurrency({ concurrency: 3, testFiles: 3, freeBytes: 512 * MiB, cores: 16, fileConcurrency: 4 }),
    { value: 3, reason: "given by --concurrency" });

  // The boundaries: memory for exactly the cap is the cap, and for exactly one
  // worker is one worker, not "none". 8 × 1144 / 0.75 = 12202.7 MiB.
  const exact = chooseConcurrency({ testFiles: 3, freeBytes: 12203 * MiB, cores: 16, fileConcurrency: 4 });
  assert.equal(exact.value, 8);
  assert.match(exact.reason, /^half of 16 cores; .* would allow 8$/);
  assert.equal(chooseConcurrency({ testFiles: 3, freeBytes: 12202 * MiB, cores: 16, fileConcurrency: 4 }).value, 7);
  const one = chooseConcurrency({ testFiles: 3, freeBytes: 1526 * MiB, cores: 16, fileConcurrency: 4 });
  assert.equal(one.value, 1);
  assert.match(one.reason, /, below the cap of 8 \(half of 16 cores\)$/);
  assert.match(chooseConcurrency({ testFiles: 3, freeBytes: 1525 * MiB, cores: 16, fileConcurrency: 4 }).reason, /allows none/);

  // Without a figure for the cores, the machine's own is used.
  // availableParallelism is Node 18.14+, so it is looked up, never imported by name.
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  assert.match(chooseConcurrency({ testFiles: 1, freeBytes: 1024 * GiB }).reason, new RegExp("^half of " + cores + " cores; "));
});

// TL-706: the worker count is budgeted with the bound the workers run under.
test("a worker is budgeted at its --test-concurrency, so its share does not grow with the cores", () => {
  // 4 files at once: 64 + 4 × 360 = 1504 MiB; 6 GiB usable over that is 4 workers.
  const small = chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 16, fileConcurrency: 4 });
  const large = chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4 });
  assert.equal(small.value, 4);
  assert.equal(large.value, 4, "twice the cores, the same memory per worker");
  assert.match(large.reason, /at 1\.5 GB per worker \(4 test files at once, --test-concurrency=4\), below the cap of 16/);
  assert.deepEqual(chooseConcurrency({ testFiles: 4, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4 }), large,
    "files beyond the bound do not run at once, so they cost nothing more");
  assert.equal(chooseConcurrency({ testFiles: 2, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4 }).value, 7,
    "fewer files than the bound: 64 + 2 × 360 = 784 MiB per worker");

  // The default is the bound this node's workers will run under.
  const bound = testFileConcurrency({ cores: 32 });
  assert.equal(chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32 }).value,
    chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: bound }).value);
  // ...for the cores given, not the machine's: on four cores node's own default is three.
  assert.deepEqual(chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 4 }),
    chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 4, fileConcurrency: testFileConcurrency({ cores: 4 }) }));
});

test("where node has no --test-concurrency, a worker is budgeted at node's default and the reason says so", () => {
  // 15 files at once on 16 cores: 64 + 15 × 360 = 5464 MiB; 24 GiB usable is 4 workers.
  const old = chooseConcurrency({ testFiles: 15, freeBytes: 32 * GiB, cores: 16, fileConcurrency: null });
  assert.equal(old.value, 4);
  assert.match(old.reason, /\(15 test files at once, node's default of cores - 1: this node has no --test-concurrency\)/);
  assert.equal(chooseConcurrency({ testFiles: 40, freeBytes: 32 * GiB, cores: 16, fileConcurrency: null }).value, 4,
    "files beyond cores - 1 do not run at once, so they cost nothing more");
  // The same 40 files on 32 cores: 31 at once fit no worker in 8 GiB, where the bounded run fits 4.
  assert.match(chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: null }).reason, /allows none/);
  assert.equal(chooseConcurrency({ testFiles: 3, freeBytes: 64 * GiB, cores: 1, fileConcurrency: null }).value, 1);
  assert.match(chooseConcurrency({ testFiles: 3, freeBytes: 64 * GiB, cores: 1, fileConcurrency: null }).reason, /\(1 test file at once, /);
});

// TL-725: a run inside a memory-capped cgroup budgets from what the cgroup can still take.
function cgroupFixture(own, levels) {
  const dir = fixtureDir(join(tmpdir(), "branchling-test-cgroup-"));
  write(dir, "proc-cgroup", own);
  for (const [path, max, current] of levels) {
    write(dir, join("fs", path, "memory.max"), max + "\n");
    write(dir, join("fs", path, "memory.current"), current + "\n");
  }
  return { procFile: join(dir, "proc-cgroup"), root: join(dir, "fs") };
}

const SCOPE = "/user.slice/app.slice/run.scope";

test("a cgroup limit below free memory lowers the concurrency, and the reason names the cgroup", () => {
  const paths = cgroupFixture("0::" + SCOPE + "\n", [
    [SCOPE, 8 * GiB, 2 * GiB], ["/user.slice/app.slice", "max", 30 * GiB], ["/user.slice", "max", 31 * GiB],
  ]);
  const cgroup = cgroupHeadroom(paths);
  assert.deepEqual(cgroup, { bytes: 6 * GiB, path: SCOPE });
  // 6 GiB headroom: 4.5 GiB usable over 1504 MiB per worker is 3; 55 GiB free alone allows the cap of 16.
  const machineOnly = chooseConcurrency({ testFiles: 40, freeBytes: 55 * GiB, cores: 32, fileConcurrency: 4 });
  assert.equal(machineOnly.value, 16);
  const capped = chooseConcurrency({ testFiles: 40, freeBytes: 55 * GiB, cores: 32, fileConcurrency: 4, cgroup });
  assert.equal(capped.value, 3);
  assert.equal(capped.reason, "6.0 GB free under the memory.max of cgroup " + SCOPE + " (55.0 GB free on the machine), "
    + "75% of it at 1.5 GB per worker (4 test files at once, --test-concurrency=4), below the cap of 16 (half of 32 cores)");

  // A cgroup with more room than the machine has free leaves the machine's figure in charge, and says so.
  const roomy = chooseConcurrency({ testFiles: 40, freeBytes: 4 * GiB, cores: 32, fileConcurrency: 4, cgroup });
  assert.equal(roomy.value, chooseConcurrency({ testFiles: 40, freeBytes: 4 * GiB, cores: 32, fileConcurrency: 4 }).value);
  assert.match(roomy.reason, new RegExp("^4\\.0 GB free on the machine \\(cgroup " + SCOPE + " leaves 6\\.0 GB\\), "));
});

test("a limit on an ancestor of the cgroup, not on the cgroup itself, still counts", () => {
  const cgroup = cgroupHeadroom(cgroupFixture("0::" + SCOPE + "\n", [
    [SCOPE, "max", 1 * GiB], ["/user.slice/app.slice", 12 * GiB, 9 * GiB], ["/user.slice", 20 * GiB, 10 * GiB],
  ]));
  assert.deepEqual(cgroup, { bytes: 3 * GiB, path: "/user.slice/app.slice" }, "the smallest headroom on the way to the root");
  assert.equal(chooseConcurrency({ testFiles: 40, freeBytes: 55 * GiB, cores: 32, fileConcurrency: 4, cgroup }).value, 1);
  // The smallest headroom wins wherever it sits, and on a tie the level nearest the process is named.
  assert.deepEqual(cgroupHeadroom(cgroupFixture("0::/a/b\n", [["/a/b", 10 * GiB, 0], ["/a", 5 * GiB, 2 * GiB]])),
    { bytes: 3 * GiB, path: "/a" });
  assert.deepEqual(cgroupHeadroom(cgroupFixture("0::/a/b\n", [["/a/b", 4 * GiB, GiB], ["/a", 5 * GiB, 2 * GiB]])),
    { bytes: 3 * GiB, path: "/a/b" });
  // A current above max (memory.high reclaim lag) is no room, not negative room.
  assert.deepEqual(cgroupHeadroom(cgroupFixture("0::/a\n", [["/a", 2 * GiB, 3 * GiB]])), { bytes: 0, path: "/a" });
});

test("without a finite cgroup v2 limit the budget is free memory, as before", () => {
  const before = chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4 });
  const unlimited = cgroupHeadroom(cgroupFixture("0::" + SCOPE + "\n", [
    [SCOPE, "max", 2 * GiB], ["/user.slice/app.slice", "max", 2 * GiB], ["/user.slice", "max", 2 * GiB],
  ]));
  assert.equal(unlimited, null, "max at every level is no limit");
  assert.deepEqual(chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4, cgroup: unlimited }), before);
  // cgroup v1: no 0:: line.
  assert.equal(cgroupHeadroom(cgroupFixture("4:memory:/user.slice\n1:name=systemd:/user.slice\n", [["/user.slice", GiB, 0]])), null);
  // No /proc at all (macOS), and a hierarchy whose files cannot be read: not a limit.
  assert.equal(cgroupHeadroom({ procFile: join(tmpdir(), "branchling-no-such-proc-cgroup"), root: "/" }), null);
  const unreadable = cgroupFixture("0::" + SCOPE + "\n", []);
  assert.equal(cgroupHeadroom(unreadable), null);
  // A level whose memory.current is missing is skipped, not read as zero use.
  const half = cgroupFixture("0::/a/b\n", [["/a", 4 * GiB, GiB]]);
  write(half.root, join("a", "b", "memory.max"), String(GiB));
  assert.deepEqual(cgroupHeadroom(half), { bytes: 3 * GiB, path: "/a" });
  // A value that is not a plain byte count is not a limit, however it starts or ends.
  for (const [max, current] of [["8G", 0], ["x8", 0], [8 * GiB, "1G"], [8 * GiB, "x1"]]) {
    assert.equal(cgroupHeadroom(cgroupFixture("0::/a\n", [["/a", max, current]])), null, max + " / " + current);
  }
  // The positive control: the same fixture shape with one finite limit is read.
  assert.notEqual(cgroupHeadroom(cgroupFixture("0::" + SCOPE + "\n", [[SCOPE, 4 * GiB, GiB]])), null);
});

test("a run that states no free memory reads this process's own cgroup; one that states it is taken at its word", () => {
  const live = cgroupHeadroom();
  const measured = chooseConcurrency({ testFiles: 40, cores: 32, fileConcurrency: 4 }).reason;
  // Inside a capped scope (the supervised loops run in one) the live path is
  // named; elsewhere either the machine is named beside it or no cgroup is.
  if (live === null) assert.doesNotMatch(measured, /cgroup/);
  else assert.match(measured, new RegExp("cgroup " + live.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[ )]"));
  // ...and the machine's free memory is still read when no figure is given.
  assert.match(measured, /^(half of 32 cores; )?\d+\.\d GB free/);
  assert.doesNotMatch(chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4 }).reason, /cgroup/);

  // Where this process does sit under a finite cgroup v2 limit, the default
  // paths find it. Read here independently; where there is none (CI, macOS)
  // this half has nothing to observe.
  let own = null;
  try { own = readFileSync("/proc/self/cgroup", "utf8").split("\n").find((l) => l.startsWith("0::")); } catch { /* none */ }
  if (own) {
    const limited = [];
    for (let level = own.slice(3); ; level = dirname(level)) {
      try { if (/^\d+$/.test(readFileSync(join("/sys/fs/cgroup", level, "memory.max"), "utf8").trim())) limited.push(level); } catch { /* none */ }
      if (level === "/") break;
    }
    if (limited.length) assert.ok(live && limited.includes(live.path), "a finite memory.max at " + limited.join(", "));
  }
});

test("when the cgroup leaves exactly what the machine has free, the machine is named", () => {
  const reason = chooseConcurrency({ testFiles: 40, freeBytes: 8 * GiB, cores: 32, fileConcurrency: 4,
    cgroup: { bytes: 8 * GiB, path: "/s" } }).reason;
  assert.match(reason, /^8\.0 GB free on the machine \(cgroup \/s leaves 8\.0 GB\), /);
});

test("the slot is one file per machine, in the state directory, under a name runs of other versions agree on", () => {
  // Not keyed by repository: two clones share the memory as much as two worktrees do.
  assert.equal(slotPath({ [STATE_DIR_ENV]: "/state" }), join("/state", "mutation", "slot.lock"));
  assert.equal(SLOT_TOKEN_ENV, "MUTATION_SLOT_TOKEN", "a nested run of another version would no longer recognise its holder");
  assert.equal(describeHolder({ pid: 7, host: "h", ts: "T", tree: "/r" }, "/s/slot.lock"),
    "pid 7 on h since T, run from /r (/s/slot.lock)");
  assert.equal(describeHolder(null, "/s/slot.lock"), "an unreadable record at /s/slot.lock");
});

function slotEnv(label) {
  return { [STATE_DIR_ENV]: fixtureDir(join(tmpdir(), "branchling-test-" + label + "-")) };
}

function plantSlot(env, record) {
  mkdirSync(dirname(slotPath(env)), { recursive: true });
  writeFileSync(slotPath(env), typeof record === "string" ? record : JSON.stringify(record) + "\n");
}

test("a holder whose process is alive keeps the slot; a dead or unreadable one is reclaimed", () => {
  const env = slotEnv("mutation-slot-stale");
  const held = { pid: 4242, host: "here", tree: "/elsewhere", ts: "2026-11-11T00:00:00.000Z", token: "t1" };
  try {
    plantSlot(env, held);
    const refused = tryAcquireSlot({ env, tree: "/me", host: "here", alive: () => true });
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.holder, held);
    // On another host the pid cannot be signalled, so it is not judged dead.
    const foreign = tryAcquireSlot({ env, tree: "/me", host: "there", alive: () => false });
    assert.equal(foreign.ok, false);

    // POSITIVE CONTROL: the same record, its process gone.
    const won = tryAcquireSlot({ env, tree: "/me", host: "here", alive: () => false });
    assert.equal(won.ok, true);
    assert.deepEqual(won.tookOver, held);
    const now = JSON.parse(readFileSync(slotPath(env), "utf8"));
    assert.equal(now.pid, process.pid);
    assert.equal(now.tree, "/me");
    assert.equal(now.token, won.token);

    assert.ok(readFileSync(slotPath(env), "utf8").endsWith("}\n"), "the record is not one line");

    plantSlot(env, "{not json");
    const fromCorrupt = tryAcquireSlot({ env: { ...env, [SLOT_TOKEN_ENV]: "t1" }, tree: "/me", host: "here", alive: () => true });
    assert.equal(fromCorrupt.ok, true, "a record naming nobody blocked the slot");
    assert.equal(fromCorrupt.tookOver, null);

    assert.equal(releaseSlot(fromCorrupt), true);
    const fresh = tryAcquireSlot({ env, tree: "/me" });
    assert.equal(fresh.ok, true);
    assert.equal("tookOver" in fresh, false, "a free slot reported a holder it took over");
  } finally {
    rmSync(env[STATE_DIR_ENV], { recursive: true, force: true });
  }
});

test("a run gives up after three passes when dead holders keep reappearing, and retries when one vanishes", () => {
  const env = slotEnv("mutation-slot-passes");
  const dead = { pid: 4242, host: "here", tree: "/x", ts: "T", token: "d" };
  const opts = { env, tree: "/me", host: "here", alive: () => false };
  try {
    // Every removal is followed by another dead holder: three passes, then a refusal naming the last.
    plantSlot(env, dead);
    let removed = 0;
    const exhausted = tryAcquireSlot({ ...opts, interleave: (step) => {
      if (step === "removed") { removed++; plantSlot(env, { ...dead, pid: 5000 + removed }); }
    } });
    assert.equal(removed, 3);
    assert.deepEqual(exhausted, { ok: false, path: slotPath(env), holder: { ...dead, pid: 5003 } });

    // The last removal leaves nothing behind: still a refusal, naming nobody.
    plantSlot(env, dead);
    removed = 0;
    const vanished = tryAcquireSlot({ ...opts, interleave: (step) => {
      if (step === "removed" && ++removed < 3) plantSlot(env, dead);
    } });
    assert.deepEqual(vanished, { ok: false, path: slotPath(env), holder: null });

    // The holder released between the failed create and the read: the next pass wins.
    plantSlot(env, { ...dead, host: "elsewhere" });
    const released = tryAcquireSlot({ ...opts, interleave: (step) => {
      if (step === "contended") rmSync(slotPath(env), { force: true });
    } });
    assert.equal(released.ok, true);
    assert.equal("tookOver" in released, false);
  } finally {
    rmSync(env[STATE_DIR_ENV], { recursive: true, force: true });
  }
});

test("releasing nothing, or a slot whose file is gone, is a quiet no", () => {
  assert.equal(releaseSlot(null), false);
  assert.equal(releaseSlot(undefined), false);
  assert.equal(releaseSlot({ ok: true, path: join(STATE, "no-such-dir", "slot.lock"), token: "t" }), false);
});

test("a real dead pid is reclaimed with the real liveness check", () => {
  const env = slotEnv("mutation-slot-dead");
  try {
    // Written, not logged: under FORCE_COLOR console.log paints a number.
    const gone = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    const pid = Number(gone.stdout.trim());
    plantSlot(env, { pid, host: hostname(), tree: "/x", ts: "2026-11-11T00:00:00.000Z", token: "t" });
    const r = tryAcquireSlot({ env, tree: "/me" });
    assert.equal(r.ok, true);
    assert.equal(r.tookOver.pid, pid);
    // POSITIVE CONTROL: this process is alive, and its record is respected.
    releaseSlot(r);
    plantSlot(env, { pid: process.pid, host: hostname(), tree: "/x", ts: "2026-11-11T00:00:00.000Z", token: "u" });
    assert.equal(tryAcquireSlot({ env, tree: "/me" }).ok, false);
  } finally {
    rmSync(env[STATE_DIR_ENV], { recursive: true, force: true });
  }
});

test("a run started inside the holder's run shares its slot and does not release it", () => {
  const env = slotEnv("mutation-slot-nested");
  try {
    const outer = tryAcquireSlot({ env, tree: "/outer" });
    assert.equal(outer.ok, true);
    const inner = tryAcquireSlot({ env: { ...env, [SLOT_TOKEN_ENV]: outer.token }, tree: "/sandbox" });
    assert.equal(inner.ok, true);
    assert.equal(inner.nested, true);
    assert.equal(releaseSlot(inner), false);
    assert.equal(JSON.parse(readFileSync(slotPath(env), "utf8")).token, outer.token, "the inner run released the outer slot");

    const stranger = tryAcquireSlot({ env: { ...env, [SLOT_TOKEN_ENV]: "another run's token" }, tree: "/b" });
    assert.equal(stranger.ok, false, "a token that is not the holder's opened the slot");

    // A run whose slot was taken over does not remove the new holder's file.
    const taker = { ...outer, token: "stale" };
    assert.equal(releaseSlot(taker), false);
    assert.equal(releaseSlot(outer), true);
    assert.equal(tryAcquireSlot({ env, tree: "/next" }).ok, true, "a released slot was not free");
  } finally {
    rmSync(env[STATE_DIR_ENV], { recursive: true, force: true });
  }
});

// The slot module run in a process of its own: acquires, says so, and holds
// the slot until its stdin closes.
const SLOT_URL = pathToFileURL(join(SCRIPTS_DIR, "mutation-slot.mjs")).href;
const HOLDER = `import { acquireSlot, releaseSlot } from ${JSON.stringify(SLOT_URL)};
const slot = await acquireSlot({ pollMs: 50, tree: process.argv[1], onWait: (h) => console.log("waiting " + h.pid) });
console.log("held " + process.pid);
process.stdin.resume();
process.stdin.on("end", () => { releaseSlot(slot); console.log("released"); process.exit(0); });`;

function startHolder(env, tree) {
  const child = spawn(process.execPath, ["--input-type=module", "-e", HOLDER, tree], {
    env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const until = (re, ms = 20000) => new Promise((done, reject) => {
    const started = Date.now();
    const look = () => {
      if (re.test(out)) return done(out);
      if (Date.now() - started > ms) return reject(new Error("no " + re + " in " + JSON.stringify(out) + " / " + err));
      setTimeout(look, 20);
    };
    look();
  });
  return { child, until, out: () => out };
}

test("two processes never hold the slot at once: the second waits, naming the first, until it releases", async () => {
  const env = slotEnv("mutation-slot-two");
  const first = startHolder(env, "/first");
  let second;
  try {
    await first.until(/^held (\d+)$/m);
    const firstPid = Number(/^held (\d+)$/m.exec(first.out())[1]);
    second = startHolder(env, "/second");
    await second.until(/^waiting \d+$/m);
    assert.match(second.out(), new RegExp("^waiting " + firstPid + "$", "m"));
    await new Promise((done) => setTimeout(done, 300));
    assert.doesNotMatch(second.out(), /held/, "the second process took a slot the first still held");

    first.child.stdin.end();
    await first.until(/^released$/m);
    await second.until(/^held \d+$/m);
    assert.equal(JSON.parse(readFileSync(slotPath(env), "utf8")).pid, second.child.pid);
  } finally {
    first.child.kill("SIGKILL");
    if (second) second.child.kill("SIGKILL");
    rmSync(env[STATE_DIR_ENV], { recursive: true, force: true });
  }
});

test("a mutation run refuses with --no-wait, and otherwise waits naming the holder, while another run holds the slot", async () => {
  const root = fixture();
  const holder = startHolder({}, "/holder");
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");
    await holder.until(/^held \d+$/m);
    const pid = holder.child.pid;

    const refused = run(root, ["--base", "main", "--no-wait"]);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.match(refused.err, new RegExp("another mutation run holds the machine's slot: pid " + pid + " on "));
    assert.match(refused.err, /run from \/holder/);
    assert.ok(refused.err.includes(slotPath({ [STATE_DIR_ENV]: STATE })), "the refusal does not say where the slot is");
    assert.match(refused.err, /^  Two runs at once can exhaust the machine's memory, so --no-wait refuses rather than start a second\.$/m);
    assert.match(refused.err.replace(/\x1b\[[0-9;]*m/g, ""), /^  \S+ node scripts\/mutation-run\.mjs \(without --no-wait, to wait for it\)$/m);

    const waiting = spawn(process.execPath, [ENTRY, "--base", "main"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    waiting.stderr.on("data", (d) => { err += d; });
    try {
      const started = Date.now();
      while (!/waiting for the machine's mutation slot/.test(err) && Date.now() - started < 20000) {
        await new Promise((done) => setTimeout(done, 20));
      }
      assert.match(err, new RegExp("waiting for the machine's mutation slot, held by pid " + pid + " on "));
      assert.doesNotMatch(err, /^concurrency /m, "the waiting run went on to choose its workers");
    } finally {
      waiting.kill("SIGKILL");
    }
    assert.equal(JSON.parse(readFileSync(slotPath({ [STATE_DIR_ENV]: STATE }), "utf8")).pid, pid);
  } finally {
    holder.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-682. The cost gate, judged without Stryker: the instrumenter, the timed
// test run and Stryker itself are replaced, so the arithmetic and the refusal
// are what is asserted, wherever the suite runs.
test("the estimate is the initial run plus one test run per mutant, concurrency at a time", () => {
  assert.equal(estimateSeconds({ mutants: 600, testSeconds: 10, concurrency: 2 }), 3010);
  assert.equal(estimateSeconds({ mutants: 601, testSeconds: 10, concurrency: 2 }), 3020, "a remainder costs a whole round");
  assert.equal(estimateSeconds({ mutants: 1, testSeconds: 4, concurrency: 8 }), 8);
  assert.equal(estimateSeconds({ mutants: 0, testSeconds: 4, concurrency: 1 }), 0, "nothing to mutate costs nothing");
  assert.equal(formatDuration(59.2), "60 s");
  assert.equal(formatDuration(61), "2 min");
  assert.equal(formatDuration(60), "1 min", "a whole minute is not 60 s");
  assert.equal(formatDuration(120 * 60), "2 h 0 min", "two whole hours are not 120 min");
  assert.equal(formatDuration(119 * 60), "119 min");
  assert.equal(formatDuration(125 * 60), "2 h 5 min");
});

test("the mutate list is read as Stryker reads it: 1-based lines handed on 0-based, whole beats ranged", () => {
  const d = mutateDescriptions(["a.mjs:3-4", "a.mjs:9-9", "b.mjs", "c.mjs:2-2", "c.mjs"]);
  const end = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(d.get("a.mjs"), [
    { start: { line: 2, column: 0 }, end: { line: 3, column: end } },
    { start: { line: 8, column: 0 }, end: { line: 8, column: end } },
  ]);
  assert.equal(d.get("b.mjs"), true);
  assert.equal(d.get("c.mjs"), true);
  const wholeFirst = mutateDescriptions(["c.mjs", "c.mjs:2-2"]);
  assert.equal(wholeFirst.get("c.mjs"), true, "a range listed after the whole file narrowed it");
});

async function inProcess(argv, cwd, deps) {
  const out = [];
  const err = [];
  const { log, error } = console;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => err.push(a.join(" "));
  try {
    const code = await main(argv, cwd, deps);
    // The painter was chosen when ui.mjs loaded, from the terminal of that
    // moment; the words are what is asserted, not the observer's colours.
    const plain = (lines) => lines.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    return { code, out: plain(out), err: plain(err) };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function costDeps({ mutants, seconds }) {
  const calls = { stryker: 0, timed: [] };
  const deps = {
    loadInstrumenter: async () => ({}),
    countMutants: async (_root, mutate) => ({ total: mutants, files: Object.fromEntries(mutate.map((m) => [m, mutants])) }),
    timeTests: (_root, files) => { calls.timed.push(files); return { seconds, passed: true }; },
    runStryker: () => { calls.stryker++; return { code: 0, leftovers: [], report: ONE_KILLED }; },
    // The machine's own hard limit is not this fixture's business.
    hardDataLimit: () => Infinity,
  };
  return { deps, calls };
}

test("the run states its memory cap and names each mutant an allocation failure killed (TL-726)", async () => {
  const root = fixture();
  try {
    const { deps } = costDeps({ mutants: 2, seconds: 1 });
    deps.runStryker = (_root, _p, opts) => {
      assert.equal(opts.memoryCap, 524288, "the run was not handed the cap it was given");
      return { code: 0, leftovers: [], report: { files: { "scripts/lib.mjs": { mutants: [
        { status: "Killed", statusReason: "RangeError: Array buffer allocation failed", location: { start: { line: 1 } }, mutatorName: "ArrowFunction", replacement: "() => undefined" },
        { status: "Killed", statusReason: "not ok 1", location: { start: { line: 1 } }, mutatorName: "BooleanLiteral", replacement: "false" },
      ] } } } };
    };
    const r = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--memory-cap", "512M"], root, deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /^memory cap: 512 MiB of data per test process \(ulimit -d\)/m);
    assert.deepEqual(r.out.split("\n").filter((l) => l.startsWith("hit the memory cap")),
      ["hit the memory cap  scripts/lib.mjs:1  ArrowFunction → () => undefined"]);
    assert.match(r.err, /1 mutant was killed by an allocation failure at the memory cap, not by an assertion/);

    deps.runStryker = (_root, _p, opts) => {
      assert.equal(opts.memoryCap, null);
      return { code: 0, leftovers: [], report: ONE_KILLED };
    };
    const none = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--memory-cap", "none"], root, deps);
    assert.match(none.err, /^memory cap: none \(--memory-cap none\)/m);
    assert.doesNotMatch(none.out + none.err, /hit the memory cap|allocation failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a cap above the hard data limit is refused before Stryker starts, naming one that fits (TL-726)", async () => {
  const root = fixture();
  try {
    const { deps, calls } = costDeps({ mutants: 2, seconds: 1 });
    deps.hardDataLimit = () => 2 * 1024 * 1024;
    const refused = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1"], root, deps);
    assert.equal(refused.code, 1, refused.err);
    assert.equal(calls.stryker, 0);
    assert.match(refused.err, /--memory-cap 4 GiB is above this shell's hard data limit of 2 GiB$/m);
    assert.match(refused.err, /^  → node scripts\/mutation-run\.mjs --memory-cap 2G$/m);
    // POSITIVE CONTROL: at the limit, and with no cap at all, the run starts.
    assert.equal((await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--memory-cap", "2G"], root, deps)).code, 0);
    assert.equal((await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--memory-cap", "none"], root, deps)).code, 0);
    assert.equal(calls.stryker, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A run that judged one mutant: the smallest report that is evidence (TL-698).
const ONE_KILLED = {
  files: { "scripts/lib.mjs": { mutants: [{ status: "Killed", location: { start: { line: 1 } }, mutatorName: "ArrowFunction", replacement: "() => undefined" }] } },
};

test("--plan states the mutant count and the estimate (TL-682)", async () => {
  const root = fixture();
  try {
    const { deps, calls } = costDeps({ mutants: 40, seconds: 3 });
    const text = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "2", "--plan"], root, deps);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /^mutants \(40\): scripts\/lib\.mjs 40$/m);
    assert.doesNotMatch(text.out, /failed without a mutant/, "a passing initial run was reported failed");
    const two = await inProcess(["--files", "scripts/lib.mjs,scripts/other.mjs", "--plan"], root, deps);
    assert.match(two.out, /^mutants \(40\): scripts\/lib\.mjs 40, scripts\/other\.mjs 40$/m);
    assert.match(text.out, /^estimate: 2 min — one run of the selected tests took 3 s, run once more for each mutant, 2 at a time; budget 45 min$/m);
    assert.ok(calls.timed[0].length > 0 && calls.timed[0].includes("scripts/tests/named.test.mjs"),
      "the timed run was not the selection: " + JSON.stringify(calls.timed));

    const json = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "2", "--plan", "--json"], root, deps);
    const cost = JSON.parse(json.out).cost;
    assert.equal(cost.mutants, 40);
    assert.equal(cost.estimateSeconds, 63);
    assert.equal(cost.budgetMinutes, DEFAULT_BUDGET_MINUTES);
    assert.equal(cost.overBudget, false);
    assert.equal(calls.stryker, 0, "a plan started Stryker");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run over budget is refused before Stryker starts, naming --changed-lines and --budget (TL-682)", async () => {
  const root = fixture();
  try {
    // 600 mutants × 10 s, 2 at a time: 3010 s, just over 45 minutes.
    const { deps, calls } = costDeps({ mutants: 600, seconds: 10 });
    const argv = ["--files", "scripts/lib.mjs", "--concurrency", "2"];
    const refused = await inProcess(argv, root, deps);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.equal(calls.stryker, 0, "Stryker was started over budget");
    assert.equal(refused.out, "", "a refused run printed something that could be read as a result");
    assert.match(refused.err, /^estimate: 51 min — /m, "the estimate was not stated before the refusal");
    assert.match(refused.err, /: the run is estimated at 51 min, over the budget of 45 min: 600 mutants × 10 s of tests, 2 at a time$/m);
    assert.match(refused.err, /^  A run cut off by a timeout settles nothing, so Stryker was not started\.$/m);
    assert.match(refused.err, /^  --changed-lines mutates only the lines this change wrote; --budget <minutes> admits a longer run deliberately\.$/m);
    assert.doesNotMatch(refused.err, /was stopped|full length is unknown/, "a fully timed run was reported cut (TL-716)");
    assert.deepEqual(refused.err.split("\n").filter((l) => l.startsWith("  →")), [
      "  → node scripts/mutation-run.mjs --files scripts/lib.mjs --concurrency 2 --changed-lines",
      "  → node scripts/mutation-run.mjs --files scripts/lib.mjs --concurrency 2 --budget 51",
    ]);

    const plan = await inProcess([...argv, "--plan"], root, deps);
    assert.equal(plan.code, 0, "--plan is refused instead of reporting the cost");
    assert.match(plan.out, /budget 45 min, exceeded: a run is refused/);

    // A run already narrowed is not told to narrow; the budget it is told to
    // pass replaces the one it gave instead of adding a second.
    write(root, "scripts/lib.mjs", "export const lib = () => 7;\n");
    const narrowed = await inProcess([...argv, "--changed-lines", "--budget", "50"], root, deps);
    assert.equal(narrowed.code, 1, narrowed.err);
    assert.deepEqual(narrowed.err.split("\n").filter((l) => l.startsWith("  →")), [
      "  → node scripts/mutation-run.mjs --files scripts/lib.mjs --concurrency 2 --changed-lines --budget 51",
    ]);
    assert.match(narrowed.err, /^  --budget <minutes> admits a longer run deliberately\.$/m);
    assert.equal(calls.stryker, 0);

    // POSITIVE CONTROL: the same run under a budget that admits it starts, and
    // states its estimate first.
    const admitted = await inProcess([...argv, "--budget", "51", "--json"], root, deps);
    assert.equal(admitted.code, 0, admitted.err);
    assert.equal(calls.stryker, 1, "a run within its budget did not start");
    assert.match(admitted.err, /^estimate: 51 min — /m);
    const result = JSON.parse(admitted.out);
    assert.equal(result.kind, "mutation-run");
    assert.equal(result.cost.estimateSeconds, 3010);

    const one = costDeps({ mutants: 1, seconds: 1500 });
    assert.match((await inProcess(argv, root, one.deps)).err, /: 1 mutant × 25 min of tests, 2 at a time$/m);

    // An estimate exactly at the budget is within it: 538 mutants × 10 s, 2 at a time, is 2700 s.
    const exact = costDeps({ mutants: 538, seconds: 10 });
    assert.equal((await inProcess(argv, root, exact.deps)).code, 0);
    assert.equal(exact.calls.stryker, 1, "a run estimated at exactly its budget was refused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-698. A change whose lines hold no mutable code — here a comment — has
// no mutation evidence, and Stryker reports `All files | n/a` with exit 0 for it.
// Two comments, so the change is two ranges and the refusal has to name both.
function commentOnly(root) {
  write(root, "scripts/lib.mjs", "// a comment above\nexport const lib = () => 1;\n// a comment below\n");
}
const NO_MUTANT_LINE = /: no mutant in scripts\/lib\.mjs:1-1, scripts\/lib\.mjs:3-3: a change with no mutable code has no mutation evidence$/m;
const EMPTY_SET_LINE = /^  A score over an empty set would read like a score over real work, so none is reported\.$/m;

test("a run with no mutant is refused before Stryker starts, naming the ranges, and --plan says so (TL-698)", async () => {
  const root = fixture();
  try {
    commentOnly(root);
    const argv = ["--base", "main", "--changed-lines", "--named-only", "--concurrency", "1"];
    const { deps, calls } = costDeps({ mutants: 0, seconds: 1 });
    const refused = await inProcess(argv, root, deps);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.equal(calls.stryker, 0, "Stryker was started for a selection with no mutant");
    assert.equal(refused.out, "", "a refused run printed something that could be read as a result");
    assert.match(refused.err, NO_MUTANT_LINE);
    assert.match(refused.err, /^  Stryker's instrumenter places none on those lines, so Stryker was not started\.$/m);
    assert.match(refused.err, EMPTY_SET_LINE);
    assert.doesNotMatch(refused.err, /→/, "a refusal with nothing to run suggested a command");

    const plan = await inProcess([...argv, "--plan"], root, deps);
    assert.equal(plan.code, 0, plan.err);
    assert.match(plan.out, /^no mutant: a change with no mutable code has no mutation evidence; a run is refused$/m);
    assert.equal(calls.stryker, 0);

    // POSITIVE CONTROL: the same selection with a mutant to judge starts, and
    // neither the plan nor the run says there is none.
    const one = costDeps({ mutants: 1, seconds: 1 });
    const admitted = await inProcess(argv, root, one.deps);
    assert.equal(admitted.code, 0, admitted.err);
    assert.equal(one.calls.stryker, 1);
    assert.doesNotMatch(admitted.err, /no mutant/);
    assert.doesNotMatch((await inProcess([...argv, "--plan"], root, one.deps)).out, /no mutant/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Stryker report with no mutant fails, naming the ranges, though nothing was counted first (TL-698)", async () => {
  const root = fixture();
  try {
    commentOnly(root);
    const argv = ["--base", "main", "--changed-lines", "--named-only", "--concurrency", "1"];
    const reports = {
      empty: { files: {} },
      "no mutant in the file": { files: { "scripts/lib.mjs": { mutants: [] } } },
      "only ignored": { files: { "scripts/lib.mjs": { mutants: [{ ...ONE_KILLED.files["scripts/lib.mjs"].mutants[0], status: "Ignored" }] } } },
    };
    for (const [name, report] of Object.entries(reports)) {
      const { deps, calls } = costDeps({ mutants: 0, seconds: 1 });
      deps.loadInstrumenter = async () => null;
      delete deps.countMutants;
      deps.runStryker = () => { calls.stryker++; return { code: 0, leftovers: [], report }; };
      for (const extra of [[], ["--json"]]) {
        const r = await inProcess([...argv, ...extra], root, deps);
        assert.equal(r.code, 1, name + ": a run with no mutant passed\n" + r.out + r.err);
        assert.equal(r.out, "", name + ": a run with no mutant printed a result");
        assert.match(r.err, NO_MUTANT_LINE, name);
        assert.match(r.err, /^  Stryker ran and its report holds none\.$/m, name);
        assert.match(r.err, EMPTY_SET_LINE, name);
        assert.doesNotMatch(r.err, /→|report kept/, name + ": a command was suggested, or a report nobody kept was named");
      }
      assert.equal(calls.stryker, 2, name + ": the run was refused before Stryker, so the report was not what was judged");
    }
    // A report kept on request is named even though the run is refused: it is
    // what a reader opens to see why Stryker found nothing.
    const kept = costDeps({ mutants: 0, seconds: 1 });
    kept.deps.loadInstrumenter = async () => null;
    delete kept.deps.countMutants;
    const keptAt = join(root, "kept.json");
    kept.deps.runStryker = () => ({ code: 0, leftovers: [], report: reports.empty, kept: keptAt });
    const withKept = await inProcess([...argv, "--keep-report", "kept.json"], root, kept.deps);
    assert.equal(withKept.code, 1);
    assert.ok(withKept.err.split("\n").includes("report kept: " + keptAt), withKept.err);
    // POSITIVE CONTROL: one judged mutant beside an ignored one is evidence.
    const { deps } = costDeps({ mutants: 0, seconds: 1 });
    deps.loadInstrumenter = async () => null;
    delete deps.countMutants;
    const judged = { files: { "scripts/lib.mjs": { mutants: [...reports["only ignored"].files["scripts/lib.mjs"].mutants, ...ONE_KILLED.files["scripts/lib.mjs"].mutants] } } };
    deps.runStryker = () => ({ code: 0, leftovers: [], report: judged });
    const ok = await inProcess(argv, root, deps);
    assert.equal(ok.code, 0, ok.err);
    assert.equal(summarise(judged).mutants, 1, "an Ignored mutant was counted as judged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--plan takes no slot: it starts nothing", async () => {
  const root = fixture();
  const holder = startHolder({}, "/holder");
  try {
    write(root, "scripts/lib.mjs", "export const lib = () => 3;\n");
    await holder.until(/^held \d+$/m);
    const p = run(root, ["--base", "main", "--plan", "--no-wait"]);
    assert.equal(p.code, 0, p.err);
  } finally {
    holder.child.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});

test("without Stryker installed the plan says nothing was counted, and no test is timed (TL-682)", async () => {
  const root = fixture();
  try {
    const { deps, calls } = costDeps({ mutants: 1, seconds: 1 });
    deps.loadInstrumenter = async () => null;
    delete deps.countMutants;
    const r = await inProcess(["--files", "scripts/lib.mjs", "--plan"], root, deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^mutants: not counted — @stryker-mutator\/core is not installed/m);
    assert.deepEqual(calls.timed, []);
    const json = await inProcess(["--files", "scripts/lib.mjs", "--plan", "--json"], root, deps);
    assert.deepEqual(JSON.parse(json.out).cost, { counted: false, budgetMinutes: DEFAULT_BUDGET_MINUTES });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("nothing to mutate times no test, a failing initial run is named, and a count that fails is refused (TL-682)", async () => {
  const root = fixture();
  try {
    const none = costDeps({ mutants: 0, seconds: 30 });
    const zero = JSON.parse((await inProcess(["--files", "scripts/lib.mjs", "--plan", "--json"], root, none.deps)).out).cost;
    assert.deepEqual(none.calls.timed, [], "tests were timed for a selection with no mutant");
    assert.equal(zero.initialRunSeconds, 0);
    assert.equal(zero.initialRunPassed, true);
    assert.equal(zero.estimateSeconds, 0);

    const red = costDeps({ mutants: 4, seconds: 1 });
    red.deps.timeTests = () => ({ seconds: 1, passed: false });
    const failing = await inProcess(["--files", "scripts/lib.mjs", "--plan"], root, red.deps);
    assert.match(failing.out, /^the selected tests failed without a mutant, so Stryker's initial run will fail too$/m);

    const broken = costDeps({ mutants: 4, seconds: 1 });
    broken.deps.countMutants = async () => { throw new Error("Unexpected token (3:1)"); };
    const r = await inProcess(["--files", "scripts/lib.mjs,scripts/other.mjs"], root, broken.deps);
    assert.equal(r.code, 1);
    assert.equal(broken.calls.stryker, 0);
    assert.match(r.err, /: cannot count the mutants of scripts\/lib\.mjs, scripts\/other\.mjs$/m);
    assert.doesNotMatch(r.err, /→/, "a count that failed suggested a command");
    assert.match(r.err, /^  Unexpected token \(3:1\)$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the timed run is the selected tests' own verdict and duration (TL-682)", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-time-"));
  try {
    write(root, "scripts/tests/slow.test.mjs",
      'import { test } from "node:test";\ntest("waits", () => new Promise((r) => setTimeout(r, 400)));\n');
    write(root, "scripts/tests/red.test.mjs", 'import { test } from "node:test";\ntest("fails", () => { throw new Error("red"); });\n');
    const before = performance.now();
    const green = timeTests(root, ["scripts/tests/slow.test.mjs"]);
    const outside = (performance.now() - before) / 1000;
    assert.equal(green.passed, true);
    assert.ok(green.seconds >= 0.4 && green.seconds <= outside, "duration " + green.seconds + " s, measured around it " + outside + " s");
    // Run from inside node --test, as this is: a run that inherited the test
    // context would report through it and exit 0 on a failure.
    assert.equal(timeTests(root, ["scripts/tests/red.test.mjs"]).passed, false, "a failing selection was reported passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-716. A test that records its pid and then outlives any reasonable plan:
// the shape of the real-run tests under scripts/tests/mutation/, which start
// Stryker and wait for the machine's mutation slot.
function slowTest(pidFile) {
  return 'import { test } from "node:test";\nimport { writeFileSync } from "node:fs";\n'
    + "writeFileSync(" + JSON.stringify(pidFile) + ", String(process.pid));\n"
    + 'const named = "lib.mjs";\n'
    + 'test("outlives the plan", () => new Promise((r) => setTimeout(r, 300000)));\n';
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("a timed run still going at its limit is stopped with its process group, and reported cut (TL-716)", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-cut-"));
  const pidFile = join(root, "slow.pid");
  try {
    write(root, "scripts/tests/mutation/slow.test.mjs", slowTest(pidFile));
    const before = performance.now();
    const r = timeTests(root, ["scripts/tests/mutation/slow.test.mjs"], { limitSeconds: 2 });
    const outside = (performance.now() - before) / 1000;
    assert.equal(r.cut, true, "a run past its limit was not reported cut: " + JSON.stringify(r));
    assert.equal(r.passed, null, "a run with no verdict was given one");
    assert.ok(r.seconds >= 1.9 && outside < 30, "stopped after " + r.seconds + " s, returned after " + outside + " s");
    // POSITIVE CONTROL: the test file really ran, so its absence afterwards is the kill, not a run that never started.
    assert.ok(existsSync(pidFile), "the slow test never started");
    const pid = Number(readFileSync(pidFile, "utf8"));
    const deadline = Date.now() + 5000;
    while (alive(pid) && Date.now() < deadline) spawnSync("sleep", ["0.1"]);
    assert.equal(alive(pid), false, "the test process " + pid + " outlived the cut run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a timed run that cannot start is a failure, not a cut (TL-716)", () => {
  // A spawn error other than the timeout: the working directory does not exist.
  const r = timeTests(join(tmpdir(), "branchling-test-mutation-absent-" + process.pid), ["scripts/tests/x.test.mjs"], { limitSeconds: 30 });
  assert.equal(r.cut, false, "a run that never started was reported cut: " + JSON.stringify(r));
  assert.equal(r.passed, false);
});

test("a cut estimate names one mutant in the singular (TL-716)", () => {
  const lines = costReport({ counted: true, mutants: 1, mutantsPerFile: { "scripts/lib.mjs": 1 }, initialRunSeconds: 30,
    initialRunPassed: null, initialRunCut: true, concurrency: 1, estimateSeconds: 60, budgetMinutes: 1, overBudget: true });
  assert.ok(lines.includes("estimate: more than 1 min — one run of the selected tests was stopped after 30 s, by which point "
    + "1 mutant, 1 at a time, exceed the budget of 1 min: a run is refused without a larger --budget"), lines.join("\n"));
  assert.ok(!lines.some((l) => /failed without a mutant/.test(l)), "a cut run was reported failed");
});

test("the timing limit is the run length at which the estimate reaches the budget (TL-716)", () => {
  assert.equal(timingLimitSeconds({ mutants: 40, concurrency: 2, budgetMinutes: 45 }), 2700 / 21);
  assert.equal(timingLimitSeconds({ mutants: 41, concurrency: 2, budgetMinutes: 45 }), 2700 / 22, "a remainder costs a whole round");
  assert.equal(timingLimitSeconds({ mutants: 59, concurrency: 1, budgetMinutes: 1 }), 1);
  for (const [mutants, concurrency, budgetMinutes] of [[40, 2, 45], [7, 3, 10], [1, 8, 1]]) {
    const testSeconds = timingLimitSeconds({ mutants, concurrency, budgetMinutes });
    assert.ok(Math.abs(estimateSeconds({ mutants, testSeconds, concurrency }) - budgetMinutes * 60) < 1e-9);
  }
});

test("--plan over a selection holding a real-run test returns at the timing limit, not after the test (TL-716)", async () => {
  const root = fixture();
  const pidFile = join(root, "slow.pid");
  try {
    write(root, "scripts/tests/mutation/slow.test.mjs", slowTest(pidFile));
    // The real timeTests: only the instrumenter is replaced. 59 mutants, one
    // at a time, within 1 minute: one run of the tests may last 1 s.
    const deps = {
      loadInstrumenter: async () => ({}),
      countMutants: async (_root, mutate) => ({ total: 59, files: Object.fromEntries(mutate.map((m) => [m, 59])) }),
      runStryker: () => { throw new Error("Stryker was started"); },
    };
    const argv = ["--files", "scripts/lib.mjs", "--named-only", "--concurrency", "1", "--budget", "1"];
    const before = performance.now();
    const plan = await inProcess([...argv, "--plan"], root, deps);
    const took = (performance.now() - before) / 1000;
    assert.equal(plan.code, 0, plan.err);
    assert.ok(took < 30, "--plan took " + took + " s");
    assert.match(plan.out, /^  scripts\/tests\/mutation\/slow\.test\.mjs  — lib\.mjs named$/m, "the real-run test was not in the selection");
    assert.match(plan.out, /^estimate: more than 1 min — one run of the selected tests was stopped after 1 s, by which point 59 mutants, 1 at a time, exceed the budget of 1 min: a run is refused without a larger --budget$/m);
    assert.doesNotMatch(plan.out, /failed without a mutant/, "a cut run was reported failed");
    assert.ok(existsSync(pidFile), "the slow test never started");

    const json = JSON.parse((await inProcess([...argv, "--plan", "--json"], root, deps)).out).cost;
    assert.equal(json.initialRunCut, true);
    assert.equal(json.initialRunPassed, null);
    assert.equal(json.overBudget, true);
    assert.equal(json.estimateSeconds, 60);

    const refused = await inProcess(argv, root, deps);
    assert.equal(refused.code, 1, refused.out + refused.err);
    assert.match(refused.err, /: the run is estimated at more than 1 min, over the budget of 1 min: 59 mutants × more than 1 s of tests, 1 at a time$/m);
    assert.match(refused.err, /^  The timed run of the selected tests was stopped once the budget was certain to be exceeded, so its full length is unknown\.$/m);
    assert.deepEqual(refused.err.split("\n").filter((l) => l.startsWith("  →")), [
      "  → node scripts/mutation-run.mjs --files scripts/lib.mjs --named-only --concurrency 1 --changed-lines",
      "  → node scripts/mutation-run.mjs --files scripts/lib.mjs --named-only --concurrency 1 --budget <minutes>",
    ], "a cut run named a budget it cannot know");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-686. A report with one mutant of every status that matters to a reader.
const REPORT = {
  files: {
    "scripts/lib.mjs": {
      mutants: [
        { status: "Killed", location: { start: { line: 1 } }, mutatorName: "ArithmeticOperator", replacement: "x - 1" },
        { status: "Survived", location: { start: { line: 2 } }, mutatorName: "ConditionalExpression", replacement: "true" },
        { status: "Timeout", location: { start: { line: 7 } }, mutatorName: "BlockStatement", replacement: "{}" },
        { status: "Timeout", location: { start: { line: 9 } }, mutatorName: "UpdateOperator", replacement: "i--" },
      ],
    },
  },
};

test("Timeout mutants are listed by file, line and mutator like survivors (TL-686)", async () => {
  const s = summarise(REPORT);
  assert.equal(s.timeouts, 2);
  assert.deepEqual(s.timedOut, [
    { file: "scripts/lib.mjs", line: 7, mutator: "BlockStatement", replacement: "{}" },
    { file: "scripts/lib.mjs", line: 9, mutator: "UpdateOperator", replacement: "i--" },
  ]);
  assert.deepEqual(s.survivors.map((m) => m.line), [2], "a Timeout was listed as a survivor, or a survivor was lost");

  const root = fixture();
  try {
    const { deps } = costDeps({ mutants: 4, seconds: 1 });
    deps.runStryker = () => ({ code: 0, leftovers: [], report: REPORT });
    const text = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1"], root, deps);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, /^survived  scripts\/lib\.mjs:2  ConditionalExpression → true$/m);
    assert.match(text.out, /^timed out  scripts\/lib\.mjs:7  BlockStatement → \{\}$/m);
    assert.match(text.out, /^timed out  scripts\/lib\.mjs:9  UpdateOperator → i--$/m);
    assert.match(text.err, /2 mutants timed out and are counted as detected/);
    const json = JSON.parse((await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--json"], root, deps)).out);
    assert.deepEqual(json.timedOut.map((m) => m.file + ":" + m.line), ["scripts/lib.mjs:7", "scripts/lib.mjs:9"]);
    assert.equal(json.keptReport, null, "a report nobody asked to keep was named");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--keep-report copies the report, and a destination that cannot hold it is refused before the run (TL-686)", async () => {
  const root = fixture();
  try {
    const from = join(root, "mutation.json");
    writeFileSync(from, JSON.stringify(REPORT));
    const to = join(root, "kept.json");
    assert.equal(keepReport(from, to), to);
    assert.deepEqual(JSON.parse(readFileSync(to, "utf8")), REPORT, "the kept report is not Stryker's");
    const lost = keepReport(from, join(root, "no-such-dir", "kept.json"));
    assert.match(lost.error, /ENOENT/, "a copy that failed was reported written");

    // The path handed to the run is resolved against the directory the run starts in.
    const { deps, calls } = costDeps({ mutants: 4, seconds: 1 });
    let handed = null;
    deps.runStryker = (_root, _p, opts) => {
      calls.stryker++;
      handed = opts.keepReport;
      return { code: 0, leftovers: [], report: REPORT, kept: keepReport(from, opts.keepReport) };
    };
    const kept = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--keep-report", "out.json"], root, deps);
    assert.equal(kept.code, 0, kept.err);
    assert.equal(handed, join(root, "out.json"));
    assert.ok(existsSync(join(root, "out.json")), "the report was not kept");
    assert.match(kept.err, new RegExp("^report kept: " + join(root, "out.json").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "m"));
    const json = JSON.parse((await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--json", "--keep-report", "j.json"], root, deps)).out);
    assert.equal(json.keptReport, join(root, "j.json"));

    // A copy that failed after the run is reported, and the run does not read as clean.
    deps.runStryker = () => ({ code: 0, leftovers: [], report: REPORT, kept: { error: "EACCES: permission denied" } });
    const failed = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--keep-report", "x.json"], root, deps);
    assert.equal(failed.code, 1);
    assert.match(failed.err, /the report could not be kept at .*x\.json: EACCES/);
    assert.match(failed.out, /^survived  scripts\/lib\.mjs:2/m, "the result was withheld because the copy failed");
    assert.doesNotMatch(failed.err, /report kept/, "a report that was not kept was announced as kept");

    const before = calls.stryker;
    const missing = await inProcess(["--files", "scripts/lib.mjs", "--keep-report", "no-such-dir/r.json"], root, deps);
    assert.equal(missing.code, 1);
    assert.deepEqual(missing.err.replace(/^\S+ /, "").split("\n"), [
      "node scripts/mutation-run.mjs: --keep-report " + join(root, "no-such-dir", "r.json") + ": " + join(root, "no-such-dir") + " is not a directory",
      "  The report would be lost when the run's directory is removed, so the run is not started.",
    ]);
    const plan = await inProcess(["--files", "scripts/lib.mjs", "--plan", "--keep-report", "r.json"], root, deps);
    assert.equal(plan.code, 2);
    assert.deepEqual(plan.err.replace(/^\S+ /, "").split("\n"), [
      "node scripts/mutation-run.mjs: --keep-report has nothing to keep under --plan",
      "  A plan starts no Stryker run, so no mutation.json is written.",
      "  → node scripts/mutation-run.mjs --plan (without --keep-report)",
    ]);
    assert.equal(calls.stryker, before, "a refused --keep-report started Stryker");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--keep-report refuses a destination that is an existing directory before the run (TL-717)", async () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "out"));
    const { deps, calls } = costDeps({ mutants: 4, seconds: 1 });
    deps.runStryker = () => {
      calls.stryker++;
      return { code: 0, leftovers: [], report: REPORT, kept: null };
    };
    for (const [arg, dir] of [["out/", join(root, "out")], ["out", join(root, "out")], [".", root]]) {
      const refused = await inProcess(["--files", "scripts/lib.mjs", "--keep-report", arg], root, deps);
      assert.equal(refused.code, 1, "--keep-report " + arg + " was not refused");
      assert.deepEqual(refused.err.replace(/^\S+ /, "").split("\n"), [
        "node scripts/mutation-run.mjs: --keep-report " + dir + " is a directory",
        "  The flag names the report's own file, and a copy onto a directory fails only after the run, so the run is not started.",
      ]);
    }
    assert.equal(calls.stryker, 0, "a directory as --keep-report started Stryker");
    assert.deepEqual(calls.timed, [], "a refused --keep-report went on to time the suite");

    // Positive control: a file inside that directory is accepted and the run starts.
    const accepted = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1", "--keep-report", "out/m.json"], root, deps);
    assert.equal(accepted.code, 0, accepted.err);
    assert.equal(calls.stryker, 1, "a file inside an existing directory was refused");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--budget takes a positive integer", () => {
  for (const value of ["0", "-3", "1.5", "lots"]) {
    const r = run(HOME, ["--budget", value]);
    assert.equal(r.code, 2, value);
    assert.match(r.err, /--budget takes a positive integer/);
  }
});

// Stryker's own instrumenter counts, where it is installed; the default suite
// runs without `npm install`, and then there is nothing to count with.
const instrumenter = await loadInstrumenter();
let coreInstalled = true;
try { createRequire(import.meta.url).resolve("@stryker-mutator/core/package.json"); } catch { coreInstalled = false; }

test("where Stryker is installed its instrumenter is found, so the count below is not skipped", () => {
  assert.equal(Boolean(instrumenter), coreInstalled);
});
test("the mutant count is Stryker's instrumenter over exactly the lines asked for (TL-682)",
  { skip: instrumenter ? false : "@stryker-mutator/core is not installed" }, async () => {
    const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-count-"));
    try {
      write(root, "scripts/m.mjs", "export const a = (x) => x + 1;\nexport const b = (x) => x > 2 && x < 9;\nexport const c = 'text';\n");
      const whole = await countMutants(root, ["scripts/m.mjs"], instrumenter);
      const first = await countMutants(root, ["scripts/m.mjs:1-1"], instrumenter);
      const second = await countMutants(root, ["scripts/m.mjs:2-2"], instrumenter);
      const both = await countMutants(root, ["scripts/m.mjs:1-1", "scripts/m.mjs:2-2"], instrumenter);
      assert.ok(first.total > 0 && second.total > 0, "a line with an operator yielded no mutant");
      assert.equal(both.total, first.total + second.total);
      assert.ok(whole.total > both.total, "the third line's string was not counted in the whole file");
      assert.deepEqual(whole.files, { "scripts/m.mjs": whole.total });
      const missing = await countMutants(root, ["scripts/gone.mjs"], instrumenter);
      assert.deepEqual(missing, { total: 0, files: { "scripts/gone.mjs": 0 } }, "Stryker mutates nothing at a missing path");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

// TL-676. The options are read only through the run they configure, and a
// test that runs with the defaults cannot tell a dropped flag from an unused one.
test("every flag lands in the option the run reads, and a malformed value is named", () => {
  const defaults = {
    base: "main", files: null, tests: null, concurrency: null, budget: null, keepReport: null, memoryCap: 4194304,
    plan: false, json: false, namedOnly: false, changedLines: false, noWait: false,
  };
  assert.deepEqual(parseArgs([]), { opts: defaults });
  assert.deepEqual(parseArgs([
    "--base", "dev", "--files", " a.mjs , ,b.mjs:3-4 ", "--tests", "t.test.mjs", "--concurrency", "10", "--budget", "7",
    "--keep-report", "out/m.json", "--memory-cap", "1G", "--plan", "--json", "--named-only", "--changed-lines", "--no-wait",
  ]), { opts: {
    base: "dev", files: ["a.mjs", "b.mjs:3-4"], tests: ["t.test.mjs"], concurrency: 10, budget: 7, keepReport: "out/m.json", memoryCap: 1048576,
    plan: true, json: true, namedOnly: true, changedLines: true, noWait: true,
  } });
  assert.deepEqual(parseArgs(["--base"]), { error: "--base needs a value" });
  assert.deepEqual(parseArgs(["--files", "--plan"]), { error: "--files needs a value" });
  assert.deepEqual(parseArgs(["--tests", "-x"]), { opts: { ...defaults, tests: ["-x"] } }, "one dash is a value, two are a flag");
  for (const value of ["02", "5x", "x5", ""]) {
    assert.deepEqual(parseArgs(["--concurrency", value]), { error: "--concurrency takes a positive integer, not " + JSON.stringify(value) });
  }
  assert.deepEqual(parseArgs(["--plan", "--everything"]), { error: 'unknown argument "--everything"' });
});

test("the summary counts every status per file, scores only the valid ones, and lists each survivor", () => {
  const at = (line) => ({ start: { line, column: 0 } });
  const mutant = (status, line, mutatorName = "M", replacement = "r") => ({ status, location: at(line), mutatorName, replacement });
  const s = summarise({ files: {
    "a.mjs": { mutants: [
      mutant("Killed", 1), mutant("Killed", 2), mutant("Timeout", 3), mutant("Survived", 4, "ConditionalExpression", "true"),
      mutant("NoCoverage", 5), mutant("RuntimeError", 6), mutant("CompileError", 7), mutant("Ignored", 8),
    ] },
    "b.mjs": { mutants: [mutant("Ignored", 1)] },
    "c.mjs": { mutants: [mutant("Killed", 1), mutant("Killed", 2), mutant("Survived", 3, "StringLiteral", '""')] },
  } });
  assert.deepEqual(s.files["a.mjs"], {
    Killed: 2, Survived: 1, Timeout: 1, NoCoverage: 1, RuntimeError: 1, CompileError: 1, Ignored: 1, score: 60,
  });
  assert.equal(s.files["b.mjs"].score, null, "a file with no valid mutant has no score, not zero");
  assert.equal(s.files["c.mjs"].score, 66.67, "the score is rounded to two decimals");
  assert.deepEqual(s.survivors, [
    { file: "a.mjs", line: 4, mutator: "ConditionalExpression", replacement: "true" },
    { file: "c.mjs", line: 3, mutator: "StringLiteral", replacement: '""' },
  ]);
  assert.equal(s.noCoverage, 1);
  assert.equal(s.timeouts, 1);
  assert.equal(s.mutants, 10, "an Ignored mutant is not one the run produced (TL-698)");
  assert.deepEqual(s.timedOut, [{ file: "a.mjs", line: 3, mutator: "M", replacement: "r" }]);
  assert.deepEqual(summarise({}), { files: {}, survivors: [], timedOut: [], cappedOut: [], noCoverage: 0, timeouts: 0, mutants: 0 });
});

/** A stand-in for Stryker that returns `result` and records what it was handed. */
function strykerReturning(result) {
  const { deps } = costDeps({ mutants: 2, seconds: 1 });
  const seen = [];
  deps.runStryker = (root, p, opts, slot) => { seen.push({ root, p, opts, slot }); return result; };
  return { deps, seen };
}

const reportOf = (...mutants) => ({ files: { "scripts/lib.mjs": { mutants: mutants.map(([status, line, mutatorName, replacement]) =>
  ({ status, location: { start: { line, column: 0 } }, mutatorName, replacement })) } } });

// TL-676. The text a person reads after a run: no other test reads it, so a
// survivor line, a range or a warning could vanish with the suite still green.
test("a text run names each survivor, the lines it mutated, what it killed afterwards and what timed out", async () => {
  const root = fixture();
  try {
    const leftovers = Array.from({ length: 12 }, (_, i) => ({ pid: 100 + i, pgid: 100, args: "node /tmp/x-" + i }));
    const { deps, seen } = strykerReturning({ code: 0, leftovers, report: reportOf(
      ["Survived", 1, "ArrowFunction", "() => undefined"], ["Timeout", 1, "M", "r"], ["Timeout", 1, "M", "r"], ["Killed", 1, "M", "r"]) });
    const r = await inProcess(["--files", "scripts/lib.mjs:1-1", "--concurrency", "3"], root, deps);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, [
      "survived  scripts/lib.mjs:1  ArrowFunction → () => undefined",
      "timed out  scripts/lib.mjs:1  M → r",
      "timed out  scripts/lib.mjs:1  M → r",
      "mutated lines only: scripts/lib.mjs:1-1",
      "not mutated: every line outside these ranges, and every mutant spanning one",
    ].join("\n"));
    const err = r.err.split("\n");
    assert.ok(err.includes("concurrency 3: given by --concurrency"), r.err);
    assert.match(r.err, /^\S+ 12 processes outlived the run and were killed: a test left them behind$/m);
    assert.deepEqual(err.filter((l) => /^  1\d\d  /.test(l)), leftovers.slice(0, 10).map((p) => "  " + p.pid + "  " + p.args),
      "the first ten leftovers are named, and only those");
    assert.ok(err.some((l) => / 2 mutants timed out and are counted as detected; rerun with a lower --concurrency before trusting the score$/.test(l)), r.err);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].opts.concurrency, 3, "Stryker was not handed the concurrency the run chose");
    assert.equal(seen[0].root, root);
    assert.deepEqual(seen[0].p.mutate, ["scripts/lib.mjs:1-1"]);
    assert.equal(typeof seen[0].slot.token, "string", "Stryker was not handed the slot it runs under");

    const one = strykerReturning({ code: 0, leftovers: [{ pid: 9, pgid: 9, args: "git hook" }], report: reportOf(["Timeout", 1, "M", "r"]) });
    const single = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1"], root, one.deps);
    assert.equal(single.code, 0, single.err);
    assert.equal(single.out, "timed out  scripts/lib.mjs:1  M → r", "a run with no survivor and no range printed more than its timeout");
    assert.match(single.err, / 1 process outlived the run and was killed: a test left them behind$/m);
    assert.match(single.err, /^  9  git hook$/m);
    assert.match(single.err, / 1 mutant timed out and is counted as detected; /m);

    const quiet = strykerReturning({ code: 0, leftovers: [], report: reportOf(["Killed", 1, "M", "r"]) });
    const clean = await inProcess(["--files", "scripts/lib.mjs", "--concurrency", "1"], root, quiet.deps);
    assert.doesNotMatch(clean.err, /outlived|timed out/, "a clean run warned");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run's exit code is Stryker's, NoCoverage fails it, and a run without a report says why", async () => {
  const root = fixture();
  const argv = ["--files", "scripts/lib.mjs", "--concurrency", "1"];
  try {
    const red = strykerReturning({ code: 3, leftovers: [], report: reportOf(["Killed", 1, "M", "r"]) });
    assert.equal((await inProcess(argv, root, red.deps)).code, 3, "Stryker's failure was not the run's");
    const nullCode = strykerReturning({ code: null, leftovers: [], report: reportOf(["Killed", 1, "M", "r"]) });
    assert.equal((await inProcess(argv, root, nullCode.deps)).code, 1, "a Stryker killed by a signal read as success");

    const uncovered = strykerReturning({ code: 0, leftovers: [], report: reportOf(["NoCoverage", 1, "M", "r"], ["NoCoverage", 1, "M", "r"]) });
    const nc = await inProcess([...argv, "--json"], root, uncovered.deps);
    assert.equal(nc.code, 1);
    assert.equal(JSON.parse(nc.out).noCoverage, 2, "the JSON report was not printed before the failure");
    assert.match(nc.err, /: 2 mutants reported NoCoverage under coverageAnalysis: off$/m);
    assert.match(nc.err, /^  This configuration cannot lose coverage, so the result is not a score; the runner setup has changed\.$/m);
    assert.doesNotMatch(nc.err, /→/, "a NoCoverage failure suggested a command");
    const ncOne = strykerReturning({ code: 0, leftovers: [], report: reportOf(["NoCoverage", 1, "M", "r"]) });
    assert.match((await inProcess(argv, root, ncOne.deps)).err, /: 1 mutant reported NoCoverage/m);

    const missing = strykerReturning({ code: 2, problem: "@stryker-mutator/core is not installed", next: ["npm install"] });
    const m = await inProcess(argv, root, missing.deps);
    assert.equal(m.code, 2);
    assert.equal(m.out, "");
    assert.match(m.err, /^\S+ node scripts\/mutation-run\.mjs: @stryker-mutator\/core is not installed$/m);
    assert.match(m.err, /^  \S+ npm install$/m);
    assert.match(m.err, /: @stryker-mutator\/core is not installed\n  \S+ npm install$/, "a problem without details printed some");

    const noReport = strykerReturning({ code: null, problem: "Stryker produced no report", details: ["last line"],
      leftovers: [{ pid: 5, pgid: 5, args: "node stray" }] });
    const n = await inProcess(argv, root, noReport.deps);
    assert.equal(n.code, 1, "a run with no report and no exit code read as success");
    assert.match(n.err, /: Stryker produced no report$/m);
    assert.match(n.err, /^  last line$/m);
    assert.match(n.err, /^  5  node stray$/m, "leftovers of a run that produced no report were not named");
    assert.doesNotMatch(n.err, /→/, "a problem without a next step suggested one");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-676. What counts as a module to mutate, read from the change itself.
test("only scripts/ and bin/ modules that exist are mutated, never a look-alike path", () => {
  const root = fixture();
  try {
    write(root, "docs/scripts/example.mjs", "export const e = 1;\n");
    write(root, "scripts/lib.mjs.orig", "export const lib = () => 0;\n");
    write(root, "bin/tool.mjs", "export const t = 1;\n");
    write(root, "scripts/tests/tool.test.mjs", 'const s = "tool.mjs example.mjs lib.mjs.orig dangling.mjs";\n');
    sh(root, "ln", ["-s", "nowhere.mjs", join(root, "scripts", "dangling.mjs")]);
    assert.deepEqual(planOf(root).modules, ["bin/tool.mjs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failing git is named with its own words, outside a repository and for an unknown base", () => {
  const outside = fixtureDir(join(tmpdir(), "branchling-test-mutation-nogit-"));
  const root = fixture();
  try {
    const r = run(outside, ["--plan"]);
    assert.equal(r.code, 2, r.out + r.err);
    const err = r.err.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    assert.match(err[0], /^\S+ node scripts\/mutation-run\.mjs: not inside a git repository$/);
    assert.match(err[1], /^  git rev-parse --show-toplevel: fatal: not a git repository/);
    assert.equal(err.length, 3, "git's own trailing newline reached the detail: " + JSON.stringify(err));

    const b = run(root, ["--base", "no-such-ref", "--plan"]);
    assert.equal(b.code, 2, b.out + b.err);
    assert.match(b.err, /: cannot work out what changed against "no-such-ref"$/m);
    assert.match(b.err, /^  git merge-base no-such-ref HEAD: fatal: /m);
    assert.match(b.err.replace(/\x1b\[[0-9;]*m/g, ""), /^  \S+ node scripts\/mutation-run\.mjs --base <ref>$/m);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("an untracked module is new in every line it has, and an empty one in none", () => {
  const root = fixture();
  try {
    write(root, "scripts/fresh.mjs", "export const x = 1;\nexport const y = 2;\nexport const z = 3;");
    write(root, "scripts/empty.mjs", "");
    write(root, "scripts/tests/fresh.test.mjs", 'import "../fresh.mjs"; import "../empty.mjs";\n');
    const p = planOf(root, ["--changed-lines"]);
    assert.deepEqual(p.lines, { "scripts/fresh.mjs": [{ start: 1, end: 3 }] }, "a last line without a newline is still a line");
    assert.deepEqual(p.noAddedLines, ["scripts/empty.mjs"]);
    write(root, "scripts/fresh.mjs", "export const x = 1;\nexport const y = 2;\n");
    assert.deepEqual(planOf(root, ["--changed-lines"]).lines, { "scripts/fresh.mjs": [{ start: 1, end: 2 }] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("template text from ranges given out of order is merged in line order", () => {
  const root = fixture();
  try {
    write(root, "scripts/view.mjs", [
      "export const a = `", "text", "text", "`;", "export const x = 1;", "export const y = 2;",
      "export const b = `", "more", "more", "`;", "",
    ].join("\n"));
    write(root, "scripts/tests/view.test.mjs", 'import "../view.mjs";\n');
    const p = planOf(root, ["--files", "scripts/view.mjs:7-10,scripts/view.mjs:1-4"]);
    assert.deepEqual(p.templateText["scripts/view.mjs"], { whole: false, ranges: [{ start: 2, end: 3 }, { start: 8, end: 9 }] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-676. What surrounds Stryker — its configuration file, its environment,
// its report and the directory it all lives in — judged with a stand-in that
// records what it was handed, so it is judged where Stryker is not installed.
const FAKE_STRYKER = `
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
const [, , verb, configPath] = process.argv;
const config = JSON.parse(readFileSync(configPath, "utf8"));
const mode = readFileSync("mode.txt", "utf8").trim();
writeFileSync("seen.json", JSON.stringify({ verb, configPath, config, cwd: process.cwd(), env: {
  source: process.env.MUTATION_SOURCE_ROOT ?? null, token: process.env.${SLOT_TOKEN_ENV} ?? null,
  mutant: process.env.__STRYKER_ACTIVE_MUTANT__ ?? null, context: process.env.NODE_TEST_CONTEXT ?? null } }));
if (mode === "stray") {
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", config.tempDirName], { detached: true, stdio: "ignore" }).unref();
}
if (mode === "noreport") {
  process.stdout.write("out one\\n");
  process.stderr.write(Array.from({ length: 12 }, (_, i) => "  line " + i + "  ").join("\\n\\n") + "\\n");
  process.exit(3);
}
if (mode === "vanish") {
  rmSync(dirname(configPath), { recursive: true, force: true });
  process.exit(0);
}
if (mode === "obeys" || mode === "stubborn") {
  // A helper in Stryker's own group whose command line names nothing of the
  // run, so only a kill aimed at the group reaches it, not the sweep. Each
  // records the SIGTERM it receives; under "obeys" Stryker ends on it and the
  // helper does not, under "stubborn" the other way round.
  const record = (name, exit) => "process.on('SIGTERM', () => { require('fs').writeFileSync('" + name + "', ''); "
    + (exit ? "process.exit(0); " : "") + "}); setInterval(() => {}, 1000);";
  const helper = spawn(process.execPath, ["-e", record("helper-termed", mode === "stubborn")], { stdio: "ignore" });
  if (mode === "stubborn") {
    for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => writeFileSync("stryker-termed", ""));
  }
  // Written once the helper's handler can run, so a signal sent on seeing it is never early.
  setTimeout(() => writeFileSync("sleeping.json", JSON.stringify({ work: dirname(configPath), helper: helper.pid, stryker: process.pid })), 300);
  setInterval(() => {}, 1000);
}
process.stdout.write("progress text\\n");
process.stderr.write("progress on stderr\\n");
writeFileSync(config.jsonReporter.fileName, JSON.stringify({ files: { "scripts/lib.mjs": { mutants: [] } } }));
`;

test("Stryker is handed its configuration, an environment of its own and the slot, and its directory is removed", async () => {
  const root = fixture();
  const bin = join(root, "fake-stryker.mjs");
  write(root, "fake-stryker.mjs", FAKE_STRYKER);
  const p = { mutate: ["scripts/lib.mjs"], tests: [{ file: "scripts/tests/named.test.mjs" }] };
  const saved = { mutant: process.env.__STRYKER_ACTIVE_MUTANT__, context: process.env.NODE_TEST_CONTEXT };
  try {
    write(root, "mode.txt", "report");
    process.env.__STRYKER_ACTIVE_MUTANT__ = "41";
    const listening = ["SIGTERM", "SIGINT"].map((s) => process.listenerCount(s));
    const r = await runStryker(root, p, { concurrency: 1, json: true }, { token: "tok-1" }, () => bin);
    assert.deepEqual(["SIGTERM", "SIGINT"].map((s) => process.listenerCount(s)), listening,
      "a finished run still listens for signals, and would act on a Stryker long gone");
    process.env.__STRYKER_ACTIVE_MUTANT__ = saved.mutant;
    if (saved.mutant === undefined) delete process.env.__STRYKER_ACTIVE_MUTANT__;
    assert.deepEqual(r, { code: 0, leftovers: [], kept: null, report: { files: { "scripts/lib.mjs": { mutants: [] } } } });
    const seen = JSON.parse(readFileSync(join(root, "seen.json"), "utf8"));
    assert.equal(seen.verb, "run");
    assert.equal(seen.cwd, root);
    assert.equal(seen.configPath, join(dirname(seen.configPath), "stryker.config.json"));
    assert.match(dirname(seen.configPath), new RegExp("^" + tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/mutation-run-"));
    assert.equal(seen.config.jsonReporter.fileName, join(dirname(seen.configPath), "mutation.json"));
    assert.equal(seen.config.tempDirName, join(dirname(seen.configPath), "sandbox"));
    assert.deepEqual(seen.config.mutate, ["scripts/lib.mjs"]);
    assert.deepEqual(seen.env, { source: root, token: "tok-1", mutant: null, context: null },
      "Stryker inherited a run above it, or was not told its tree and slot");
    assert.equal(existsSync(dirname(seen.configPath)), false, "the run's work directory outlived it");

    write(root, "mode.txt", "stray");
    const stray = await runStryker(root, p, { concurrency: 1, json: true }, { token: "tok-2" }, () => bin);
    const sandbox = JSON.parse(readFileSync(join(root, "seen.json"), "utf8")).config.tempDirName;
    assert.equal(stray.leftovers.length, 1, "a process naming the work directory was not swept: " + JSON.stringify(stray.leftovers));
    assert.ok(stray.leftovers[0].args.includes(sandbox), stray.leftovers[0].args);

    write(root, "mode.txt", "noreport");
    const none = await runStryker(root, p, { concurrency: 1, json: true }, { token: "tok-3" }, () => bin);
    assert.equal(none.code, 3);
    assert.equal(none.problem, "Stryker produced no report");
    assert.deepEqual(none.details, ["line 3", "line 4", "line 5", "line 6", "line 7", "line 8", "line 9", "line 10", "line 11", "out one"],
      "the details are not the last ten lines Stryker printed, trimmed and without blanks");
    assert.equal(existsSync(dirname(JSON.parse(readFileSync(join(root, "seen.json"), "utf8")).configPath)), false);
    // A text run hands Stryker the terminal, so its progress reaches the reader and nothing is captured.
    const shown = await runStryker(root, p, { concurrency: 1, json: false }, { token: "tok-4" }, () => bin);
    assert.equal(shown.code, 3);
    assert.deepEqual(shown.details, [], "a text run captured what Stryker printed instead of showing it");

    // A sweep that cannot list processes is a warning, never a failed run or an invented leftover.
    write(root, "mode.txt", "report");
    const errors = [];
    const { error } = console;
    console.error = (...a) => errors.push(a.join(" "));
    let blind;
    try {
      blind = await runStryker(root, p, { concurrency: 1, json: true }, { token: "tok-5" }, () => bin, () => { throw new Error("ps: denied"); });
    } finally {
      console.error = error;
    }
    assert.deepEqual(blind.leftovers, []);
    assert.equal(blind.code, 0);
    assert.deepEqual(errors.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\S+ /, "")),
      ["cannot look for processes the run left behind: ps: denied"]);

    // A work directory that is already gone when the run ends is not an error of the run.
    write(root, "mode.txt", "vanish");
    const vanished = await runStryker(root, p, { concurrency: 1, json: true }, { token: "tok-6" }, () => bin, () => []);
    assert.equal(vanished.problem, "Stryker produced no report");

    assert.deepEqual(await runStryker(root, p, { concurrency: 1 }, { token: "t" }, () => null),
      { code: 2, problem: "@stryker-mutator/core is not installed", next: ["npm install"] });
  } finally {
    if (saved.mutant === undefined) delete process.env.__STRYKER_ACTIVE_MUTANT__;
    else process.env.__STRYKER_ACTIVE_MUTANT__ = saved.mutant;
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-713. A run cut off by `timeout` or Ctrl-C used to die inside spawnSync
// with its work directory, a sandbox copy of the repository, left behind.
test("a run terminated by a signal stops Stryker's group and removes its work directory", async () => {
  const root = fixture();
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const settle = async (check, ms = 10000) => {
    for (let i = 0; i < ms / 50 && !check(); i++) await new Promise((r) => setTimeout(r, 50));
    return check();
  };
  // Everything a run started, so a mutant that breaks the cleanup under test
  // leaves nothing running or on disk after this test.
  const started = { helpers: [], strykers: [], works: [] };
  const probes = [];
  try {
    write(root, "fake-stryker.mjs", FAKE_STRYKER);
    write(root, "probe.mjs", "import { runStryker } from " + JSON.stringify(pathToFileURL(ENTRY).href) + ";\n"
      + "const r = await runStryker(process.cwd(), { mutate: [\"scripts/lib.mjs\"], tests: [{ file: \"scripts/tests/named.test.mjs\"}] },\n"
      + "  { concurrency: 1, json: true }, { token: \"t\" }, () => process.argv[2]);\n"
      + "process.stdout.write(JSON.stringify(r));\n"
      + "process.exitCode = r.code;\n");
    const cases = [["obeys", "SIGTERM", 143], ["obeys", "SIGINT", 130], ["stubborn", "SIGTERM", 143]];
    for (const [mode, signal, code] of cases) {
      const label = signal + " (Stryker " + mode + ")";
      for (const f of ["sleeping.json", "helper-termed", "stryker-termed"]) rmSync(join(root, f), { force: true });
      write(root, "mode.txt", mode);
      const probe = spawn(process.execPath, [join(root, "probe.mjs"), join(root, "fake-stryker.mjs")], { cwd: root });
      probes.push(probe);
      let out = "";
      probe.stdout.on("data", (c) => { out += c; });
      probe.stderr.on("data", (c) => { out += c; });
      let end = null;
      probe.on("exit", (status, sig) => { end = { status, sig }; });
      assert.ok(await settle(() => existsSync(join(root, "sleeping.json"))), "the fake Stryker never started: " + out);
      const { work, helper, stryker } = JSON.parse(readFileSync(join(root, "sleeping.json"), "utf8"));
      started.helpers.push(helper);
      started.strykers.push(stryker);
      started.works.push(work);
      // POSITIVE CONTROL: before the signal the directory, a process naming
      // it and the helper in Stryker's group all exist, so the checks below
      // can fail.
      assert.ok(existsSync(work), "the work directory did not exist while the run was going");
      assert.ok(leftoverProcesses(work).length > 0, "no process named the work directory while the run was going");
      assert.ok(alive(helper), "the helper in Stryker's group was not running");

      const sent = Date.now();
      probe.kill(signal);
      assert.ok(await settle(() => end !== null, STOP_GRACE_MS + 10000), label + " did not end the run: " + out);
      const took = Date.now() - sent;
      assert.deepEqual(end, { status: code, sig: null }, label + " did not end the run with its conventional code: " + out);
      const r = JSON.parse(out);
      assert.equal(r.signal, signal);
      assert.equal(r.problem, "the run was terminated by " + signal + "; Stryker was stopped and its work directory removed");
      assert.equal(existsSync(work), false, "the work directory outlived " + label);
      assert.deepEqual(leftoverProcesses(work), [], "a process naming the work directory outlived " + label);
      assert.equal(alive(helper), false, "the helper in Stryker's group outlived " + label);
      // SIGTERM first, so a test run's own group is stopped by the
      // mutation-contain.mjs that leads it, which a SIGKILL would not let run.
      assert.ok(existsSync(join(root, "helper-termed")), "Stryker's group was not sent SIGTERM before SIGKILL: " + label);
      if (mode === "obeys") {
        // Stryker ended on SIGTERM, so its group is killed then, not after the grace period.
        assert.ok(took < STOP_GRACE_MS, label + " waited out the grace period although Stryker had ended: " + took + " ms");
      } else {
        assert.ok(existsSync(join(root, "stryker-termed")), "Stryker was not sent SIGTERM: " + label);
        assert.ok(took >= STOP_GRACE_MS, "a Stryker that ignores SIGTERM ended before the grace period: " + took + " ms");
      }
    }
  } finally {
    for (const probe of probes) probe.kill("SIGKILL");
    for (const pid of started.strykers) { try { process.kill(-pid, "SIGKILL"); } catch { /* already gone */ } }
    for (const pid of [...started.strykers, ...started.helpers]) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
    for (const work of started.works) rmSync(work, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test("--plan in text names every reason a test was chosen, and a text run names the template text it skipped", async () => {
  const root = fixture();
  try {
    write(root, "scripts/tests/both.test.mjs", 'import "../lib.mjs"; import "../other.mjs";\n');
    write(root, "scripts/view.mjs", "export const page = `\nbody\n`;\n");
    write(root, "scripts/tests/view.test.mjs", 'import "../view.mjs";\n');
    const planned = await inProcess(["--files", "scripts/lib.mjs,scripts/other.mjs", "--plan"], root, costDeps({ mutants: 1, seconds: 1 }).deps);
    assert.match(planned.out, /^  scripts\/tests\/both\.test\.mjs  — lib\.mjs named; other\.mjs named$/m);

    const { deps } = strykerReturning({ code: 0, leftovers: [], report: reportOf(["Killed", 1, "M", "r"]) });
    const r = await inProcess(["--files", "scripts/view.mjs", "--concurrency", "1"], root, deps);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^not mutated \(template-literal text\): scripts\/view\.mjs \(1 line\)$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-676. Assertions on behaviour of mutation-run.mjs that no test read. The
// whole module was then mutated in seven line-range chunks on 2026-11-12,
// with these tests in place; each assertion added after that run (here and
// in mutation-template-text.test.mjs) was checked to fail on the mutant it
// answers, and the survivors no test can tell apart from the original are
// named in the task's commit, not chased.
const ANSI = /\x1b\[[0-9;]*m/g;

test("--help opens with the usage line and says where the run is explained", () => {
  assert.deepEqual(usage().split("\n").slice(0, 5), [
    "usage: node scripts/mutation-run.mjs [flags]",
    "",
    "Mutation run over the modules changed against --base. See the header of",
    "scripts/mutation-run.mjs for what is measured and why.",
    "",
  ]);
});

test("a git that cannot be started fails with the command that failed, and no invented detail", () => {
  const empty = fixtureDir(join(tmpdir(), "branchling-test-mutation-nopath-"));
  try {
    const r = spawnSync(process.execPath, [ENTRY, "--plan"], { cwd: empty, encoding: "utf8", env: { ...process.env, PATH: empty } });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    const err = r.stderr.replace(ANSI, "").split("\n");
    assert.match(err[0], /: not inside a git repository$/);
    assert.equal(err[1].trimEnd(), "  git rev-parse --show-toplevel:");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test("an untracked link to nothing has no changed line", () => {
  const root = fixture();
  try {
    sh(root, "ln", ["-s", "nowhere.mjs", join(root, "scripts", "dangling.mjs")]);
    assert.deepEqual(changedLineRanges(root, "main", ["scripts/dangling.mjs"]), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the import closure follows every spelling of a relative import, and a missing target ends it", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-closure-"));
  try {
    write(root, "scripts/entry.mjs", [
      'import{a}from"./a.mjs";',
      'const b = await import("./b.mjs");',
      'const c = await import ( "./c.mjs" );',
      'import  "./d.mjs";',
      'export * from "../e.mjs";',
      'import "./missing.mjs";',
      "",
    ].join("\n"));
    for (const f of ["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs", "e.mjs"]) write(root, f, "export {};\n");
    assert.deepEqual([...importClosure(root, "scripts/entry.mjs")].sort(), [
      "e.mjs", "scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs", "scripts/d.mjs", "scripts/entry.mjs", "scripts/missing.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("test selection called bare follows imports and commands, in path order, and reads only .mjs scripts", async () => {
  const root = fixture();
  const bare = fixtureDir(join(tmpdir(), "branchling-test-mutation-notests-"));
  try {
    // A command entry that is not an object is skipped, not dereferenced.
    write(root, "scripts/cli.mjs", 'export const COMMANDS = { gone: null, greet: { script: "greet.mjs" } };\n');
    // Not a module: an import written in it reaches nothing.
    write(root, "scripts/notes.txt", 'import "./lib.mjs";\n');
    write(root, "scripts/tests/notes.test.mjs", 'const s = "notes.txt";\n');
    write(root, "scripts/tests/zz-named.test.mjs", 'import "../lib.mjs";\n');
    write(root, "scripts/tests/aa/named.test.mjs", 'import "../../lib.mjs";\n');
    // A directory is listed before a file its name prefixes ("nested" before
    // "nested-a.test.mjs"), while the path order puts "-" before "/".
    write(root, "scripts/tests/nested-a.test.mjs", 'import "../lib.mjs";\n');
    const selected = await selectTests(root, ["scripts/lib.mjs"]);
    assert.deepEqual(selected, [
      { file: "scripts/tests/aa/named.test.mjs", why: ["lib.mjs named"] },
      { file: "scripts/tests/named.test.mjs", why: ["lib.mjs named"] },
      { file: "scripts/tests/nested-a.test.mjs", why: ["lib.mjs named"] },
      { file: "scripts/tests/nested/deep.test.mjs", why: ["lib.mjs via `greet`"] },
      { file: "scripts/tests/via-command.test.mjs", why: ["lib.mjs via `greet`"] },
      { file: "scripts/tests/via-script.test.mjs", why: ["lib.mjs imported by greet.mjs"] },
      { file: "scripts/tests/zz-named.test.mjs", why: ["lib.mjs named"] },
    ]);
    assert.deepEqual(await selectTests(bare, ["scripts/lib.mjs"]), [], "a tree with no scripts/tests selected something");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test("a test file given with --tests is selected for that reason alone", () => {
  const root = fixture();
  try {
    const p = planOf(root, ["--files", "scripts/lib.mjs", "--tests", "scripts/tests/unrelated.test.mjs"]);
    assert.deepEqual(p.tests, [{ file: "scripts/tests/unrelated.test.mjs", why: ["--tests"] }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a path with a single quote reaches the sandbox command quoted, not cut", () => {
  const cmd = sandboxCommand([{ path: "it's/dir", target: "../o'k" }], ["t.test.mjs"], "/c.mjs");
  assert.ok(cmd.includes("ln -s '../o'\\''k' 'it'\\''s/dir'"), cmd);
  assert.ok(cmd.includes("mkdir -p 'it'\\''s'"), cmd);
});

test("where Stryker is not installed the instrumenter is null, not an error", () => {
  // loadInstrumenter resolves Stryker from the module's own location, so the
  // module is loaded from a copy of scripts/ with no node_modules above it.
  const bare = fixtureDir(join(tmpdir(), "branchling-test-mutation-nostryker-"));
  try {
    const tests = join(SCRIPTS_DIR, "tests");
    cpSync(SCRIPTS_DIR, join(bare, "scripts"), { recursive: true, filter: (src) => join(src) !== tests && !join(src).startsWith(tests + "/") });
    cpSync(join(SCRIPTS_DIR, "..", "package.json"), join(bare, "package.json"));
    const probe = "const { loadInstrumenter } = await import(" + JSON.stringify(pathToFileURL(join(bare, "scripts", "mutation-run.mjs")).href)
      + "); console.log(JSON.stringify(await loadInstrumenter()));";
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", probe],
      { cwd: bare, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "null\n");
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
});

test("the logger handed to Stryker's instrumenter answers every level and enables none", () => {
  const out = [];
  const { log, error, warn: w, info } = console;
  console.log = console.error = console.warn = console.info = (...a) => out.push(a.join(" "));
  try {
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"]) {
      assert.equal(typeof SILENT_LOGGER[level], "function", level);
      assert.equal(SILENT_LOGGER[level]("message"), undefined, level);
      const enabled = "is" + level[0].toUpperCase() + level.slice(1) + "Enabled";
      assert.equal(SILENT_LOGGER[enabled](), false, enabled);
    }
  } finally {
    Object.assign(console, { log, error, warn: w, info });
  }
  assert.deepEqual(out, []);
});

test("timing the tests discards what they print, however much", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-loud-"));
  try {
    write(root, "scripts/tests/loud.test.mjs",
      'import { test } from "node:test";\ntest("loud", () => { process.stdout.write("x".repeat(3000000) + "\\n"); });\n');
    assert.equal(timeTests(root, ["scripts/tests/loud.test.mjs"]).passed, true, "output past the pipe buffer failed the run");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only links to directories are recreated, never inside node_modules or .git", () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-links-"));
  try {
    write(root, "real/f.txt", "x\n");
    write(root, "nested/keep.txt", "x\n");
    write(root, "node_modules/keep.txt", "x\n");
    write(root, ".git/keep.txt", "x\n");
    sh(root, "ln", ["-s", "real", "link-dir"]);
    sh(root, "ln", ["-s", "real/f.txt", "link-file"]);
    sh(root, "ln", ["-s", "nowhere", "dangling"]);
    sh(root, "ln", ["-s", "../real", "nested/inner"]);
    sh(root, "ln", ["-s", "../real", "node_modules/pkg"]);
    sh(root, "ln", ["-s", "../real", ".git/linked"]);
    assert.deepEqual(directorySymlinks(root).sort((a, b) => a.path.localeCompare(b.path)), [
      { path: "link-dir", target: "real" },
      { path: "nested/inner", target: "../real" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Stryker's configuration anchors the ignored links, loads no plugin, and removes its sandbox", () => {
  const p = { mutate: ["scripts/lib.mjs"], tests: [{ file: "scripts/tests/named.test.mjs" }] };
  const c = strykerConfig(p, { concurrency: 1 }, [{ path: "a/b", target: "x" }], "/work");
  assert.deepEqual(c.ignorePatterns, ["/a/b"]);
  assert.deepEqual(c.plugins, []);
  assert.deepEqual(c.clearTextReporter, { reportMutants: false });
  assert.equal(c.cleanTempDir, true);
  assert.equal(c.tempDirName, join("/work", "sandbox"));
});

test("a ps line is read from its first column, and the command keeps its own spacing", () => {
  const ps = ["x 12 34 node marker-abcdef", "  5   6   node  marker-abcdef tail"].join("\n");
  assert.deepEqual(leftoverProcesses("marker-abcdef", ps, 0), [{ pid: 5, pgid: 6, args: "node  marker-abcdef tail" }]);
});

test("a marker too short to sweep for is refused in words that name it", () => {
  assert.throws(() => sweepLeftovers("short"),
    { message: 'refusing to sweep for "short": a marker this short could name any process' });
});

test("the sweeper's own group is found by its own pid, whatever that pid is", () => {
  const ps = ["    1    50 node runner", "    7    50 node /tmp/marker-abcdef/x"].join("\n");
  const { swept, calls } = recordedSweep("/tmp/marker-abcdef/", ps, 1);
  assert.deepEqual(swept.map((p) => p.pid), [7]);
  assert.deepEqual(calls, [[7, "SIGKILL"]], "the sweeper's own group was killed whole");
});

test("on Windows the sweep lists nothing and kills nothing", () => {
  const marker = join(tmpdir(), "mutation-run-win32probe-" + process.pid) + "/";
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)", marker], { stdio: "ignore" });
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  const calls = [];
  try {
    // The sleeper names the marker, so a sweep that listed processes would find it.
    assert.equal(leftoverProcesses(marker).length, 1, "the positive control found no process naming the marker");
    Object.defineProperty(process, "platform", { value: "win32" });
    assert.deepEqual(sweepLeftovers(marker, { kill: (...a) => calls.push(a) }), []);
  } finally {
    Object.defineProperty(process, "platform", saved);
    sleeper.kill("SIGKILL");
  }
  assert.deepEqual(calls, []);
});

test("a ps that fails is named with its own words, and one that cannot start with the reason", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-test-mutation-ps-"));
  try {
    write(dir, "probe.mjs", "import { leftoverProcesses } from " + JSON.stringify(pathToFileURL(ENTRY).href) + ";\n"
      + 'try { console.log(JSON.stringify(leftoverProcesses("marker-abcdef", null, 0))); } catch (e) { console.log(JSON.stringify(e.message)); }\n');
    const listed = (script) => {
      const bin = join(dir, "bin");
      rmSync(bin, { recursive: true, force: true });
      mkdirSync(bin);
      if (script !== null) writeFileSync(join(bin, "ps"), "#!/bin/sh\n" + script + "\n", { mode: 0o755 });
      const r = spawnSync(process.execPath, [join(dir, "probe.mjs")], { encoding: "utf8", env: { ...process.env, PATH: bin } });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };
    assert.deepEqual(listed("printf '  7     7 node marker-abcdef\\n'; exit 0"), [{ pid: 7, pgid: 7, args: "node marker-abcdef" }]);
    assert.equal(listed("printf '  denied \\n' >&2; exit 1"), "ps: denied");
    assert.equal(listed("exit 1"), "ps: ");
    assert.equal(listed(null), "ps: Error: spawnSync ps ENOENT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a text run hands Stryker the terminal, so what it prints reaches the reader", () => {
  const root = fixture();
  try {
    write(root, "fake-stryker.mjs", FAKE_STRYKER);
    write(root, "mode.txt", "report");
    write(root, "probe.mjs", "import { runStryker } from " + JSON.stringify(pathToFileURL(ENTRY).href) + ";\n"
      + "const r = await runStryker(process.cwd(), { mutate: [\"scripts/lib.mjs\"], tests: [{ file: \"scripts/tests/named.test.mjs\" }] },\n"
      + "  { concurrency: 1, json: false }, { token: \"t\" }, () => process.argv[2], () => []);\n"
      + "process.exitCode = r.code;\n");
    const r = spawnSync(process.execPath, [join(root, "probe.mjs"), join(root, "fake-stryker.mjs")], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^progress text$/m);
    assert.match(r.stderr, /^progress on stderr$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Stryker's instrumenter places no mutant on a line that is only a comment, so the run is refused (TL-698)",
  { skip: instrumenter ? false : "@stryker-mutator/core is not installed" }, async () => {
    const root = fixture();
    try {
      commentOnly(root);
      const argv = ["--base", "main", "--changed-lines", "--named-only", "--concurrency", "1"];
      const { deps, calls } = costDeps({ mutants: 0, seconds: 1 });
      delete deps.countMutants;
      deps.loadInstrumenter = async () => instrumenter;
      const r = await inProcess(argv, root, deps);
      assert.equal(r.code, 1, r.out + r.err);
      assert.equal(calls.stryker, 0);
      assert.match(r.err, NO_MUTANT_LINE);
      // POSITIVE CONTROL: a changed line of code in the same file yields mutants.
      write(root, "scripts/lib.mjs", "// a comment above\nexport const lib = () => 1 + 1;\n// a comment below\n");
      const code = await inProcess([...argv, "--plan", "--json"], root, deps);
      assert.ok(JSON.parse(code.out).cost.mutants > 0, "a changed line of code yielded no mutant: " + code.out);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
