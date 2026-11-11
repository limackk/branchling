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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SCRIPTS_DIR, isolateHome, scriptSource } from "./_repo.mjs";
import { MIN_SWEEP_MARKER, SOURCE_ROOT_ENV, leftoverProcesses, reachesCli, sandboxCommand, strykerEnv, sweepLeftovers } from "../mutation-run.mjs";

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
