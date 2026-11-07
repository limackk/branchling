#!/usr/bin/env node
/**
 * A mutation run over the modules changed against a base branch (TL-576).
 *
 * WHAT IT MEASURES. Line coverage says a line executed; it does not say that
 * any assertion would fail if the line were wrong. A mutation run injects a
 * small, known defect into one module at a time and asks whether the suite
 * goes red. A mutant that survives is a place where a green suite proves
 * nothing, which matters most where code and its tests were written in one
 * pass by the same agent.
 *
 * WHY THE COMMAND RUNNER, AND WHY COVERAGE ANALYSIS IS OFF. StrykerJS has no
 * runner for `node:test`. Its TAP runner does run these files, but most of
 * this suite reaches the code through `spawnSync(process.execPath, [cli.mjs,
 * …])`, and coverage recorded in a spawned process never reaches Stryker. The
 * mutants such a test would kill are then reported `NoCoverage` and are never
 * run: measured on 2026-11-05 on `task-id.mjs`, 43.10% with the TAP runner
 * against 53.45% here, on the same 116 mutants, and a mutant that
 * `id-prefix.test.mjs` demonstrably kills was among the skipped ones. The
 * active mutant itself does reach a spawned process, through the inherited
 * `__STRYKER_ACTIVE_MUTANT__` variable, so a runner that does not depend on
 * coverage counts those kills. A `NoCoverage` result from this configuration
 * therefore means the distortion is back, and the run fails on it rather than
 * reporting a score.
 *
 * WHY THE SCOPE IS THE CHANGED MODULES. Without coverage, every selected test
 * file runs for every mutant, so the cost is mutants × selected files. The
 * scope is what changed against `--base` (committed, staged, unstaged and
 * untracked), and a run with nothing to mutate FAILS: a score over an empty
 * set reads exactly like a score over real work.
 *
 * HOW TESTS ARE SELECTED. The candidates are every `*.test.mjs` under
 * `scripts/tests/`, subdirectories included (TL-591): a file kept out of the
 * default glob, such as `mutation/subprocess-kill.test.mjs`, is still a test
 * that kills mutants, and leaving it out reported them Survived. Selecting
 * from a subdirectory changes nothing about what `node --test
 * scripts/tests/*.test.mjs` runs. A test file is run for a changed module M
 * when it
 *   1. names M's filename,
 *   2. names another script whose static import closure contains M, or
 *   3. reaches the repository's `scripts/cli.mjs` and names a command word
 *      whose script's closure contains M (read from the `COMMANDS` table
 *      `scripts/cli.mjs` exports), or M is in the closure of `cli.mjs` itself.
 * Rule 3 recognises the CLI by the path the test builds — `cli.mjs` as the
 * last segment of a `join(…)` or `resolve(…)`, appended as `"/cli.mjs"`, or a
 * relative specifier that resolves from the test's own directory to
 * `scripts/cli.mjs` — not by the bare name: a fixture that writes a file
 * called `cli.mjs` selected a test for every module the CLI imports.
 * Over-selection costs time; under-selection reports a killable mutant as
 * Survived. A script that reaches M only by SPAWNING another script is not
 * followed, so `--tests` exists to widen the set by hand.
 *
 * A module `cli.mjs` imports, directly or through `config.mjs`, selects most
 * of the suite, because any command can reach it. That is the honest set and
 * an expensive one. `--named-only` keeps rule 1 alone: a fast LOWER bound,
 * whose survivors may still be killed by a file it left out.
 *
 * Stryker is a pinned devDependency, not a runtime one: the published package
 * keeps zero dependencies, and this file does not ship (`files` in
 * package.json). It is a tool for working on this repository.
 *
 *   node scripts/mutation-run.mjs [--base <ref>] [--files <a,b>] [--tests <a,b>]
 *                                 [--concurrency <n>] [--named-only] [--plan] [--json]
 *
 * Tests: scripts/tests/mutation-run.test.mjs (scope and selection, no Stryker),
 *        scripts/tests/mutation/subprocess-kill.test.mjs (a real run).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os, { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { fail, warn } from "./ui.mjs";

const COMMAND = "node scripts/mutation-run.mjs";
const FLAGS_WITH_VALUE = new Set(["--base", "--files", "--tests", "--concurrency"]);
const FLAGS_BARE = new Set(["--plan", "--json", "--named-only"]);
const STRYKER_PIN = "@stryker-mutator/core";

/** The mutable surface: shipped code, never the tests that judge it. */
function isMutable(path) {
  return /^(scripts|bin)\/.+\.mjs$/.test(path) && !path.startsWith("scripts/tests/");
}

function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error("git " + args.join(" ") + ": " + (r.stderr || "").trim());
  return r.stdout;
}

function lines(text) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function parseArgs(argv) {
  const opts = { base: "main", files: null, tests: null, concurrency: null, plan: false, json: false, namedOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (FLAGS_BARE.has(flag)) {
      opts[flag === "--named-only" ? "namedOnly" : flag.slice(2)] = true;
    } else if (FLAGS_WITH_VALUE.has(flag)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return { error: flag + " needs a value" };
      const key = flag.slice(2);
      if (key === "files" || key === "tests") opts[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (key === "concurrency") {
        if (!/^[1-9]\d*$/.test(value)) return { error: "--concurrency takes a positive integer, not " + JSON.stringify(value) };
        opts.concurrency = Number(value);
      } else opts[key] = value;
    } else {
      return { error: "unknown argument " + JSON.stringify(flag) };
    }
  }
  return { opts };
}

/**
 * Every mutable module changed against the merge base with `base`, the working
 * tree included. Deleted files are dropped: there is nothing left to mutate.
 */
export function changedModules(root, base) {
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  const tracked = lines(git(root, ["diff", "--name-only", "--diff-filter=d", mergeBase]));
  const untracked = lines(git(root, ["ls-files", "--others", "--exclude-standard"]));
  return [...new Set([...tracked, ...untracked])]
    .filter(isMutable)
    .filter((p) => existsSync(join(root, p)))
    .sort();
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+\.mjs)["']/g;

/** Static import closure of one module, as repository-relative paths. */
export function importClosure(root, entry, cache = new Map()) {
  if (cache.has(entry)) return cache.get(entry);
  const seen = new Set([entry]);
  cache.set(entry, seen);
  const abs = join(root, entry);
  if (!existsSync(abs)) return seen;
  for (const m of readFileSync(abs, "utf8").matchAll(IMPORT_RE)) {
    const dep = relative(root, resolve(dirname(abs), m[1])).split(sep).join("/");
    for (const d of importClosure(root, dep, cache)) seen.add(d);
  }
  return seen;
}

async function commandScripts(root) {
  const cli = join(root, "scripts", "cli.mjs");
  if (!existsSync(cli)) return new Map();
  const mod = await import(pathToFileURL(cli).href);
  const table = new Map();
  for (const [name, spec] of Object.entries(mod.COMMANDS || {})) {
    if (spec && spec.script) table.set(name, "scripts/" + spec.script);
  }
  return table;
}

function scriptsIn(root) {
  const dir = join(root, "scripts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => "scripts/" + f);
}

/** Every `*.test.mjs` under `dir`, as paths relative to it, subdirectories included. */
function testFilesUnder(dir, rel = "") {
  const found = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const path = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...testFilesUnder(dir, path));
    else if (entry.isFile() && entry.name.endsWith(".test.mjs")) found.push(path);
  }
  return found;
}

const CLI_PATH_RES = [
  /,\s*["'`]cli\.mjs["'`]\s*\)/,   // join(SCRIPTS_DIR, "cli.mjs"), resolve(HERE, "..", "cli.mjs")
  /\+\s*["'`]\/cli\.mjs["'`]/,      // SCRIPTS_DIR + "/cli.mjs"
];
// Only `../` can lead from a test under scripts/tests/ to scripts/cli.mjs.
const RELATIVE_CLI_RE = /["'`]((?:\.\.\/)+cli\.mjs)["'`]/g;

/**
 * Whether the test at `testPath` (repository-relative) builds the path of the
 * repository's `scripts/cli.mjs`, rather than merely naming a file `cli.mjs`.
 */
export function reachesCli(text, testPath) {
  if (CLI_PATH_RES.some((re) => re.test(text))) return true;
  const from = dirname(testPath);
  for (const m of text.matchAll(RELATIVE_CLI_RE)) {
    if (join(from, m[1]).split(sep).join("/") === "scripts/cli.mjs") return true;
  }
  return false;
}

/**
 * The test files that can kill a mutant in any of `modules`, by the three rules
 * in the header. Returned with the reason each one was chosen, so a reader can
 * see why a file is in the set without re-deriving it.
 */
export async function selectTests(root, modules, { namedOnly = false } = {}) {
  const testsDir = join(root, "scripts", "tests");
  if (!existsSync(testsDir)) return [];
  const testFiles = testFilesUnder(testsDir).sort();
  const cache = new Map();
  const scripts = scriptsIn(root);
  const commands = await commandScripts(root);
  const cliClosure = commands.size ? importClosure(root, "scripts/cli.mjs", cache) : new Set();
  const selected = [];

  for (const f of testFiles) {
    const file = "scripts/tests/" + f;
    const text = readFileSync(join(testsDir, f), "utf8");
    const named = scripts.filter((s) => text.includes(basename(s)));
    const words = new Set([...text.matchAll(/["'`]([a-z][a-z0-9-]*)["'`]/g)].map((m) => m[1]));
    const spawnsCli = reachesCli(text, file);
    const why = [];
    for (const m of modules) {
      if (text.includes(basename(m))) { why.push(basename(m) + " named"); continue; }
      if (namedOnly) continue;
      const via = named.find((s) => s !== "scripts/cli.mjs" && importClosure(root, s, cache).has(m));
      if (via) { why.push(basename(m) + " imported by " + basename(via)); continue; }
      if (!spawnsCli) continue;
      if (cliClosure.has(m)) { why.push(basename(m) + " imported by cli.mjs"); continue; }
      const cmd = [...commands].find(([name, script]) => words.has(name) && importClosure(root, script, cache).has(m));
      if (cmd) why.push(basename(m) + " via `" + cmd[0] + "`");
    }
    if (why.length) selected.push({ file, why });
  }
  return selected;
}

export async function plan(root, opts) {
  const modules = opts.files || changedModules(root, opts.base);
  const tests = opts.tests
    ? opts.tests.map((file) => ({ file, why: ["--tests"] }))
    : await selectTests(root, modules, { namedOnly: opts.namedOnly });
  return { base: opts.base, modules, tests };
}

function strykerBin() {
  try {
    const pkg = createRequire(import.meta.url).resolve(STRYKER_PIN + "/package.json");
    return join(dirname(pkg), "bin", "stryker.js");
  } catch {
    return null;
  }
}

function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** The counts a reader needs, per file, from Stryker's JSON report. */
export function summarise(report) {
  const files = {};
  const survivors = [];
  let noCoverage = 0;
  let timeouts = 0;
  for (const [file, data] of Object.entries(report.files || {})) {
    const c = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0, RuntimeError: 0, CompileError: 0, Ignored: 0 };
    for (const m of data.mutants) {
      c[m.status] = (c[m.status] || 0) + 1;
      if (m.status === "Survived") {
        survivors.push({ file, line: m.location.start.line, mutator: m.mutatorName, replacement: m.replacement });
      }
    }
    noCoverage += c.NoCoverage;
    timeouts += c.Timeout;
    const detected = c.Killed + c.Timeout;
    const valid = detected + c.Survived + c.NoCoverage;
    files[file] = { ...c, score: valid ? Math.round((detected / valid) * 10000) / 100 : null };
  }
  return { files, survivors, noCoverage, timeouts };
}

function defaultConcurrency() {
  // availableParallelism is Node 18.14+; the default suite also runs on 18.0.
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, Math.floor(cores / 2));
}

const WALK_SKIP = new Set(["node_modules", ".git"]);

/**
 * Every symbolic link to a directory in the tree, with the target as written.
 *
 * Stryker copies the tree into its sandbox file by file and fails with
 * `ENOTSUP copyfile` on a link to a directory. Ignoring the directory that
 * holds such links instead (TL-576 ignored `.claude`) removed files a test
 * reads through them, and Stryker's initial run went red (TL-583).
 */
export function directorySymlinks(root, rel = "") {
  const found = [];
  for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (WALK_SKIP.has(entry.name)) continue;
    const path = rel ? rel + "/" + entry.name : entry.name;
    if (entry.isSymbolicLink()) {
      let isDir = false;
      try { isDir = statSync(join(root, path)).isDirectory(); } catch { /* a dangling link is copied as nothing */ }
      if (isDir) found.push({ path, target: readlinkSync(join(root, path)) });
    } else if (entry.isDirectory()) {
      found.push(...directorySymlinks(root, path));
    }
  }
  return found;
}

/**
 * The command the runner executes in the sandbox: recreate each ignored link
 * with its own relative target, then run the tests. Every worker shares one
 * sandbox, so a link another worker made first is not an error; the check
 * after `ln` is what decides.
 */
export function sandboxCommand(links, testFiles) {
  const steps = links.map((l) => {
    const p = shellQuote(l.path);
    const parent = shellQuote(dirname(l.path));
    return "{ mkdir -p " + parent + " && { ln -s " + shellQuote(l.target) + " " + p + " 2>/dev/null; [ -L " + p + " ]; }; }";
  });
  steps.push("node --test " + testFiles.map(shellQuote).join(" "));
  return steps.join(" && ");
}

function runStryker(root, p, opts) {
  const bin = strykerBin();
  if (!bin) return { code: 2, problem: STRYKER_PIN + " is not installed", next: ["npm install"] };
  const links = directorySymlinks(root);
  const work = mkdtempSync(join(tmpdir(), "mutation-run-"));
  try {
    const reportPath = join(work, "mutation.json");
    const config = {
      testRunner: "command",
      commandRunner: { command: sandboxCommand(links, p.tests.map((t) => t.file)) },
      coverageAnalysis: "off",
      mutate: p.modules,
      // Exactly the links, anchored, never their parent: see directorySymlinks.
      ignorePatterns: links.map((l) => "/" + l.path),
      plugins: [],
      reporters: ["json", "clear-text", "progress"],
      jsonReporter: { fileName: reportPath },
      clearTextReporter: { reportMutants: false },
      tempDirName: join(work, "sandbox"),
      cleanTempDir: true,
      // Every test file here spawns processes of its own, so one Stryker worker
      // occupies more than one core. Stryker's default (cores - 1) turned 101
      // of 116 mutants into Timeouts on a 15-core machine on 2026-11-05, which
      // it counts as DETECTED: a 100% score with almost nothing killed. At
      // half the cores and a wider timeout the same run gave 62 Killed, 54
      // Survived, 0 Timeout.
      concurrency: opts.concurrency || defaultConcurrency(),
      timeoutFactor: 3,
      timeoutMS: 30000,
    };
    const configPath = join(work, "stryker.config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    // A nested `node --test` that inherits NODE_TEST_CONTEXT reports to a
    // parent runner instead of through its exit code, and exits 0 on a failing
    // test. Inherited here, every mutant would be reported Survived. Measured
    // on 2026-11-05 when this file was itself started from a test.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, [bin, "run", configPath], {
      cwd: root,
      env,
      stdio: ["ignore", opts.json ? "pipe" : "inherit", opts.json ? "pipe" : "inherit"],
      encoding: "utf8",
    });
    if (!existsSync(reportPath)) {
      return { code: r.status || 1, problem: "Stryker produced no report", details: lines((r.stderr || "") + (r.stdout || "")).slice(-10) };
    }
    return { code: r.status, report: JSON.parse(readFileSync(reportPath, "utf8")) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function main(argv, cwd = process.cwd()) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    return fail(COMMAND, parsed.error, ["known flags: " + [...FLAGS_WITH_VALUE, ...FLAGS_BARE].join(" ")], [COMMAND + " --plan"]);
  }
  const { opts } = parsed;
  let root;
  try {
    root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  } catch (e) {
    return fail(COMMAND, "not inside a git repository", [String(e.message)], []);
  }

  let p;
  try {
    p = await plan(root, opts);
  } catch (e) {
    return fail(COMMAND, "cannot work out what changed against " + JSON.stringify(opts.base), [String(e.message)], [COMMAND + " --base <ref>"]);
  }

  if (p.modules.length === 0) {
    return fail(COMMAND, "nothing to mutate: no module under scripts/ or bin/ changed against " + opts.base,
      ["A score over an empty set would read like a score over real work, so none is reported."],
      [COMMAND + " --files scripts/<module>.mjs"], 1);
  }
  if (p.tests.length === 0) {
    return fail(COMMAND, "no test file reaches " + p.modules.join(", "),
      ["Every mutant would survive, and that would measure the selection, not the suite."],
      [COMMAND + " --tests scripts/tests/<file>.test.mjs"], 1);
  }

  if (opts.plan) {
    if (opts.json) console.log(JSON.stringify({ kind: "mutation-plan", ...p }, null, 2));
    else {
      console.log("mutate (" + p.modules.length + "): " + p.modules.join(", "));
      console.log("tests (" + p.tests.length + "):");
      for (const t of p.tests) console.log("  " + t.file + "  — " + t.why.join("; "));
    }
    return 0;
  }

  const run = runStryker(root, p, opts);
  if (!run.report) return fail(COMMAND, run.problem, run.details || [], run.next || [], run.code || 1);
  const summary = summarise(run.report);

  if (opts.json) {
    console.log(JSON.stringify({ kind: "mutation-run", ...p, ...summary }, null, 2));
  } else {
    for (const s of summary.survivors) console.log("survived  " + s.file + ":" + s.line + "  " + s.mutator + " → " + s.replacement);
  }
  if (summary.noCoverage > 0) {
    return fail(COMMAND, summary.noCoverage + " mutant(s) reported NoCoverage under coverageAnalysis: off",
      ["This configuration cannot lose coverage, so the result is not a score; the runner setup has changed."],
      [], 1);
  }
  if (summary.timeouts > 0) {
    // Stryker counts a Timeout as detected. On this suite a timeout is far
    // more often an overloaded machine than a mutant that loops, so it is
    // reported where a reader of the score cannot miss it.
    console.error(warn(summary.timeouts + " mutant(s) timed out and are counted as detected; "
      + "rerun with a lower --concurrency before trusting the score"));
  }
  return run.code === 0 ? 0 : run.code || 1;
}

if (process.argv[1] && process.argv[1].endsWith("mutation-run.mjs")) {
  process.exitCode = await main(process.argv.slice(2));
}
