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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import os, { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SCRIPTS_DIR, isolateHome, isolateState, scriptSource } from "./_repo.mjs";
import { MIN_SWEEP_MARKER, SOURCE_ROOT_ENV, leftoverProcesses, reachesCli, sandboxCommand, strykerEnv, sweepLeftovers } from "../mutation-run.mjs";
import { SLOT_TOKEN_ENV, chooseConcurrency, describeHolder, releaseSlot, slotPath, tryAcquireSlot } from "../mutation-slot.mjs";
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

// ── The machine's mutation slot and the default concurrency (TL-681) ──────────

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;

test("the default concurrency follows free memory, capped at half the cores", () => {
  // 3 test files at once: 64 MiB + 3 × 180 MiB = 604 MiB per worker.
  const roomy = chooseConcurrency({ testFiles: 3, freeBytes: 16 * GiB, cores: 16 });
  assert.equal(roomy.value, 8, "16 GiB fits 20 such workers; the cap is half of 16 cores");
  assert.match(roomy.reason, /^half of 16 cores; 16\.0 GB free, 75% of it at 0\.6 GB per worker \(3 test files at once\) would allow 20$/);

  const tight = chooseConcurrency({ testFiles: 3, freeBytes: 4 * GiB, cores: 16 });
  assert.equal(tight.value, 5, "3 GiB usable over 604 MiB per worker");
  assert.match(tight.reason, /^4\.0 GB free, 75% of it at 0\.6 GB per worker \(3 test files at once\), below the cap of 8 \(half of 16 cores\)$/);

  // Files beyond cores - 1 do not run at once, so they cost nothing more.
  assert.equal(chooseConcurrency({ testFiles: 40, freeBytes: 32 * GiB, cores: 16 }).value,
    chooseConcurrency({ testFiles: 15, freeBytes: 32 * GiB, cores: 16 }).value);
  assert.equal(chooseConcurrency({ testFiles: 15, freeBytes: 32 * GiB, cores: 16 }).value, 8,
    "24 GiB over 64 + 15 × 180 MiB is 8 workers");
  assert.equal(chooseConcurrency({ testFiles: 15, freeBytes: 16 * GiB, cores: 16 }).value, 4);

  const starved = chooseConcurrency({ testFiles: 3, freeBytes: 512 * MiB, cores: 16 });
  assert.equal(starved.value, 1);
  assert.match(starved.reason, /allows none; one worker is the least a run can use$/);
  assert.equal(chooseConcurrency({ testFiles: 1, freeBytes: 64 * GiB, cores: 1 }).value, 1, "one core still runs one worker");
  assert.match(chooseConcurrency({ testFiles: 1, freeBytes: 64 * GiB, cores: 1 }).reason, /\(1 test file at once\)/);

  assert.deepEqual(chooseConcurrency({ concurrency: 3, testFiles: 3, freeBytes: 512 * MiB, cores: 16 }),
    { value: 3, reason: "given by --concurrency" });

  // The boundaries: memory for exactly the cap is the cap, and for exactly one
  // worker is one worker, not "none".
  const exact = chooseConcurrency({ testFiles: 3, freeBytes: 6443 * MiB, cores: 16 });
  assert.equal(exact.value, 8);
  assert.match(exact.reason, /^half of 16 cores; .* would allow 8$/);
  const one = chooseConcurrency({ testFiles: 3, freeBytes: 1 * GiB, cores: 16 });
  assert.equal(one.value, 1);
  assert.match(one.reason, /, below the cap of 8 \(half of 16 cores\)$/);

  // Without a figure for the cores, the machine's own is used.
  // availableParallelism is Node 18.14+, so it is looked up, never imported by name.
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  assert.match(chooseConcurrency({ testFiles: 1, freeBytes: 1024 * GiB }).reason, new RegExp("^half of " + cores + " cores; "));
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
