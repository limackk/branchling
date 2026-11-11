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
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCRIPTS_DIR, isolateHome, scriptSource } from "./_repo.mjs";
import {
  DEFAULT_BUDGET_MINUTES, MIN_SWEEP_MARKER, SOURCE_ROOT_ENV, countMutants, estimateSeconds, formatDuration, leftoverProcesses,
  loadInstrumenter, main, mutateDescriptions, reachesCli, sandboxCommand, strykerEnv, sweepLeftovers, timeTests,
} from "../mutation-run.mjs";

const HOME = isolateHome("mutation-run");
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
    const r = run(root, ["--base", "main"]);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.err, /no test file reaches scripts\/orphan\.mjs/);
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
  assert.match(r.err, /unknown argument "--everything"/);
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
  assert.equal(scriptSource("mutation-run.mjs", {}), readFileSync(ENTRY, "utf8"));
  rmSync(root, { recursive: true, force: true });
});

test("the test command runs inside the containing process group", () => {
  const cmd = sandboxCommand([], ["scripts/tests/a.test.mjs"], "/x/contain.mjs");
  assert.equal(cmd, [process.execPath, "/x/contain.mjs", "node", "--test", "scripts/tests/a.test.mjs"]
    .map((s) => "'" + s + "'").join(" "));
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
    runStryker: () => { calls.stryker++; return { code: 0, leftovers: [], report: { files: {} } }; },
  };
  return { deps, calls };
}

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
