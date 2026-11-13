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
 * A MODULE MOST OF THE SUITE NAMES IS NOT NARROWED BY `--named-only` (TL-661).
 * Nearly every end-to-end test spawns `cli.mjs` by its path, so 230 of 294
 * test files name it, and on 2026-11-08 that selection's initial test run
 * outlasted Stryker's dry-run timeout: 4307 mutants instrumented, none judged,
 * a stack trace instead of a result. When more than `NAMED_ONLY_MAX_SHARE` of
 * the candidate test files name a module, the run therefore refuses before
 * starting Stryker, names the module and the count, and says what to pass
 * instead. Rejected: raising the dry-run timeout to fit (every mutant then
 * costs a run of most of the suite, which is the honest set's price under a
 * name that promises speed); selecting by the command word a test exercises
 * (a `--help` line or a dispatch change in `cli.mjs` belongs to no single
 * command, so the bound would silently stop being one).
 *
 * `--changed-lines` NARROWS WHAT IS MUTATED, not what is tested (TL-648). The
 * whole-module scope cost 2373 mutants and about two hours for a change of
 * about 60 lines (TL-573), which is a check nobody runs. With the flag, each
 * module is mutated only on the lines `git diff --unified=0` against the
 * merge base reports as added or changed — the working tree included, an
 * untracked module whole — handed to Stryker as `path:start-end` entries.
 * Stryker places a mutant only where its whole location lies inside a range,
 * so a mutant that spans a changed line and an unchanged one (a function body
 * removed whole, a multi-line expression) is NOT created; a line that was only
 * deleted leaves nothing behind to mutate. Both are why the report names the
 * ranges and says that every line outside them was not mutated.
 *
 * A `--files` ENTRY WRITTEN AS `path:start-end` UNDER `--changed-lines` IS
 * INTERSECTED, NOT REFUSED (TL-705). git is asked about the bare path, and
 * only the changed lines inside the hand-written range are mutated; an entry
 * whose range holds no changed line is named under "no added line", which is
 * then literally true. The entry used to reach `git diff` whole, matched no
 * file, and the run blamed the change for a parsing gap. Rejected: refusing
 * the combination — both flags narrow the same thing, the lines mutated, and
 * their intersection is the one reading that honours each of them.
 *
 * TEMPLATE-LITERAL TEXT IS NAMED, NOT MUTATED (TL-657). Stryker sees a
 * template literal as one string, so code written inside one — the viewer's
 * page script in build-viewer.mjs — yields no mutant. A range made only of
 * such lines is not handed to Stryker, a run left with nothing else refuses,
 * and every report says which lines were text (`templateTextLines`), so a
 * range that selected nothing no longer reads like one fully killed.
 *
 * A RUN STATES ITS COST BEFORE IT STARTS, AND ONE OVER BUDGET IS REFUSED
 * (TL-682). Without coverage every mutant runs every selected test file, so the
 * cost is known before Stryker starts: the mutant count, from Stryker's own
 * instrumenter over exactly the `mutate` list, times the duration of one run
 * of the selected tests, divided among the workers. That run is the same
 * initial run Stryker makes, timed here once more; it costs one mutant's worth
 * of time and is the only measurement of THIS selection on THIS machine. A
 * whole-module run over doctor.mjs was found to need about seven hours only
 * after it had started (2026-11-09), and another was cut by a timeout at 125
 * of 1079 mutants, settling nothing (2026-11-10). `--plan` prints the count
 * and the estimate; a run prints them first, and refuses when the estimate
 * exceeds `--budget` minutes (`DEFAULT_BUDGET_MINUTES` unless given), naming
 * `--changed-lines` and the `--budget` that would admit it. The estimate
 * assumes the workers do not slow each other down, so it is a floor more
 * often than a ceiling. Without Stryker installed nothing is counted and the
 * plan says so.
 *
 * Stryker is a pinned devDependency, not a runtime one: the published package
 * keeps zero dependencies, and this file does not ship (`files` in
 * package.json). It is a tool for working on this repository.
 *
 *   node scripts/mutation-run.mjs [--base <ref>] [--files <a,b>] [--tests <a,b>]
 *                                 [--concurrency <n>] [--named-only] [--changed-lines]
 *                                 [--no-wait] [--budget <minutes>] [--keep-report <path>]
 *                                 [--plan] [--json] [--help]
 *
 * A RUN WITH NO MUTANT FAILS, NAMING WHAT IT WAS ASKED TO MUTATE (TL-698).
 * Lines can change without holding mutable code — a comment, CSS inside a
 * template literal — and Stryker then reports `All files | n/a` and exits 0.
 * Twice on 2026-11-10 such a run read as green evidence for a change it had
 * not measured at all. The count Stryker's instrumenter gives before the run
 * refuses it there, and `--plan` says so; the report after the run is checked
 * again, because the count is skipped where the instrumenter cannot be
 * loaded, and a count that disagrees with the run must not pass either. An
 * `Ignored` mutant was never run, so it is not counted as one.
 *
 * WHAT THE RUN LEAVES TO READ (TL-686). Survivors and Timeout mutants are both
 * printed by file, line and mutator: a Timeout is counted as detected, so the
 * lines it sits on are the ones whose score is least trustworthy, and naming
 * them is what lets a reader rerun exactly those. Stryker's mutation.json is
 * written into the run's temporary directory, which is removed when the run
 * ends; `--keep-report <path>` copies it there first. Reading the temporary
 * directory afterwards found nothing four times before this flag existed.
 *
 * ONE RUN PER MACHINE, AND A CONCURRENCY THAT FITS ITS MEMORY (TL-681). A run
 * takes the machine's mutation slot before starting Stryker and waits, naming
 * the holder, while another run has it; `--no-wait` refuses instead. Without
 * `--concurrency` the number of workers follows free memory, never above half
 * the cores, and the run prints the value and why. Each worker's `node --test`
 * runs a bounded number of test files at once where the running node accepts
 * `--test-concurrency` (TL-706), so what one worker costs does not grow with
 * the cores, and the worker count is budgeted with that bound. The slot, the
 * count and the bound live in `mutation-slot.mjs`, which says what was measured.
 *
 * NO PROCESS OUTLIVES THE RUN (TL-646). A test that spawns git with a timeout
 * kills git, not git's hook children; they are reparented to PID 1, out of
 * reach of Stryker's kill, which walks the tree by parent. Each test command
 * therefore runs under `mutation-contain.mjs`, which leads a process group of
 * its own and kills what is left in it; and when Stryker returns, whatever
 * still names the run's directory is killed with its group and reported,
 * because a process nobody reports is found only by somebody running `pgrep`.
 *
 * Tests: scripts/tests/mutation-run.test.mjs (scope and selection, no Stryker),
 *        scripts/tests/mutation/subprocess-kill.test.mjs (a real run),
 *        scripts/tests/mutation/no-orphan-processes.test.mjs (nothing left behind).
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SLOT_TOKEN_ENV, acquireSlot, chooseConcurrency, describeHolder, releaseSlot, testFileConcurrency } from "./mutation-slot.mjs";
import { fail, warn, plural } from "./ui.mjs";

const COMMAND = "node scripts/mutation-run.mjs";
const FLAGS_WITH_VALUE = new Set(["--base", "--files", "--tests", "--concurrency", "--budget", "--keep-report"]);
const FLAGS_BARE = new Set(["--plan", "--json", "--named-only", "--changed-lines", "--no-wait"]);
const BARE_KEYS = { "--named-only": "namedOnly", "--changed-lines": "changedLines", "--no-wait": "noWait" };
const STRYKER_PIN = "@stryker-mutator/core";
const INSTRUMENTER = "@stryker-mutator/instrumenter";
/** The longest estimated run started without `--budget`, in minutes. */
export const DEFAULT_BUDGET_MINUTES = 45;
/** Beyond this share of the candidate test files, naming a module selects nothing narrower than the suite. */
export const NAMED_ONLY_MAX_SHARE = 0.5;
/** The variable that names the tree a run started in; see strykerEnv. */
export const SOURCE_ROOT_ENV = "MUTATION_SOURCE_ROOT";
const CONTAIN_ENTRY = containEntry();

/**
 * The `mutation-contain.mjs` this run wraps every test command in: the one
 * beside this file, or, inside an outer run's sandbox, the one in the tree
 * that outer run was started in (TL-673).
 *
 * Inside a sandbox the copy beside this file is the one the OUTER run may
 * mutate, and a nested run would hand it to its own Stryker, whose command
 * runner executes it with `__STRYKER_ACTIVE_MUTANT__` set to the INNER run's
 * ids. Both runs number their mutants from 0, so the outer mutant under test
 * was never the active one there: whichever outer mutant shared the inner id
 * was, and a Killed or Survived verdict on it was evidence about nothing.
 * The source tree's copy is never instrumented, so a nested run is no judge of
 * mutation-contain.mjs at all; the test that judges it is one that runs it in
 * its own process chain, where the outer id is the one inherited
 * (`hook-orphans.test.mjs`, through `tests/_git.mjs`). Rejected: a refusal to
 * report the file's mutants, which would have left it unjudged by design.
 */
export function containEntry(env = process.env, here = dirname(fileURLToPath(import.meta.url))) {
  const source = env[SOURCE_ROOT_ENV];
  return join(source ? join(source, "scripts") : here, "mutation-contain.mjs");
}

const HELP_FLAGS = new Set(["--help", "-h"]);
// One line per accepted flag (TL-678). `usage()` walks the parser's own sets,
// so a flag added there without a line here prints a bare name, which
// `mutation-run.test.mjs` refuses.
const FLAG_HELP = {
  "--base": ["<ref>", "the branch the change is measured against (default: main)"],
  "--files": ["<a,b>", "mutate these modules instead of the changed ones; path:start-end narrows one to lines"],
  "--tests": ["<a,b>", "add these test files to the selection, for a module reached only by spawning"],
  "--concurrency": ["<n>", "Stryker workers (default: chosen from free memory, at most half the cores)"],
  "--budget": ["<minutes>", "refuse a run whose estimate exceeds this (default: " + DEFAULT_BUDGET_MINUTES + ")"],
  "--keep-report": ["<path>", "copy Stryker's mutation.json to this path before the run's directory is removed"],
  "--plan": ["", "print the modules, the selected tests, the mutant count and the estimate; run nothing"],
  "--json": ["", "print the plan or the result as JSON on stdout"],
  "--named-only": ["", "select only the test files that name the module: a fast lower bound"],
  "--changed-lines": ["", "mutate only the lines this branch added or changed, not whole modules"],
  "--no-wait": ["", "refuse instead of waiting while another run holds the machine's mutation slot"],
};

/** The text `--help` prints: every flag the parser accepts, one line each. */
export function usage() {
  const flags = [...FLAGS_WITH_VALUE, ...FLAGS_BARE];
  const left = flags.map((f) => (FLAG_HELP[f] && FLAG_HELP[f][0] ? f + " " + FLAG_HELP[f][0] : f));
  const width = Math.max(...left.map((l) => l.length));
  return [
    "usage: " + COMMAND + " [flags]",
    "",
    "Mutation run over the modules changed against --base. See the header of",
    "scripts/mutation-run.mjs for what is measured and why.",
    "",
    ...flags.map((f, i) => "  " + (FLAG_HELP[f] ? left[i].padEnd(width) + "  " + FLAG_HELP[f][1] : left[i])),
    "  " + "-h, --help".padEnd(width) + "  print this text",
  ].join("\n");
}

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
  const opts = {
    base: "main", files: null, tests: null, concurrency: null, budget: null, keepReport: null,
    plan: false, json: false, namedOnly: false, changedLines: false, noWait: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (HELP_FLAGS.has(flag)) return { help: true };
    if (FLAGS_BARE.has(flag)) {
      opts[BARE_KEYS[flag] || flag.slice(2)] = true;
    } else if (FLAGS_WITH_VALUE.has(flag)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return { error: flag + " needs a value" };
      const key = flag === "--keep-report" ? "keepReport" : flag.slice(2);
      if (key === "files" || key === "tests") opts[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
      else if (key === "concurrency" || key === "budget") {
        if (!/^[1-9]\d*$/.test(value)) return { error: flag + " takes a positive integer, not " + JSON.stringify(value) };
        opts[key] = Number(value);
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

/**
 * The new-side line ranges of a `git diff --unified=0` for ONE file, merged
 * where they touch. Only `@@` headers are read: a hunk line starts with `+`,
 * `-`, a space or a backslash, so `@@` in column 0 is always a header, while
 * an added line that reads `++ x` appears as `+++ x` and is not a file name.
 * A hunk adding no line (`+c,0`) is a deletion and contributes nothing.
 */
export function hunkRanges(diffText) {
  const found = [];
  for (const line of diffText.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) found.push({ start: Number(m[1]), end: Number(m[1]) + count - 1 });
  }
  return mergeRanges(found);
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * For each of `modules`, the lines added or changed against the merge base
 * with `base`, the working tree included. An untracked module is new in
 * every line. A module with no such line is absent from the result: there is
 * nothing in it this change wrote.
 */
export function changedLineRanges(root, base, modules) {
  const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
  const untracked = new Set(lines(git(root, ["ls-files", "--others", "--exclude-standard"])));
  const result = {};
  for (const m of modules) {
    let ranges;
    if (untracked.has(m)) {
      const text = existsSync(join(root, m)) ? readFileSync(join(root, m), "utf8") : "";
      const count = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      ranges = count > 0 ? [{ start: 1, end: count }] : [];
    } else {
      ranges = hunkRanges(git(root, ["diff", "--unified=0", "--no-color", "--no-ext-diff", mergeBase, "--", m]));
    }
    if (ranges.length) result[m] = ranges;
  }
  return result;
}

// After one of these, a `/` opens a regular expression; after anything else it divides.
const REGEX_AFTER_PUNCT = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await"]);

/**
 * The lines of `source` that hold template-literal text and nothing else, as
 * merged `{start, end}` ranges (TL-657).
 *
 * WHY A RUN NEEDS TO KNOW. Stryker mutates the code it parses. To it a
 * template literal is one string, however much JavaScript the string holds:
 * the viewer's whole page script, `startEdit()` included, is text inside the
 * template `buildHtml()` returns. A range of such lines produces no mutant,
 * and a run that produced none in a range used to read exactly like a run
 * whose mutants there were all killed.
 *
 * WHY A LEXER AND NOT STRYKER'S PARSER. Babel arrives with Stryker, and the
 * default suite and CI run without `npm install`; a classification that only
 * exists where Stryker is installed could not be tested where the suite runs.
 * The lexer knows strings, comments, regular expressions (by the token before
 * the `/`) and nested `${ … }`, which is all a template boundary depends on.
 * It errs one way only: a line that carries any delimiter or expression is
 * code, so a line it calls text cannot hold a mutant. Source it cannot follow
 * to the end (an unterminated template or string) yields no text lines at all.
 */
export function templateTextLines(source) {
  const src = String(source);
  const code = new Set();
  const text = new Set();
  const stack = [];          // "tmpl", or { depth } for an open `${`
  let line = 1;
  let regexMayStart = true;  // whether a `/` here opens a regular expression rather than dividing
  let i = 0;
  const take = (set) => { set.add(line); if (src[i] === "\n") line++; i++; };
  const takeCode = () => take(code);

  while (i < src.length) {
    const c = src[i];
    if (stack[stack.length - 1] === "tmpl") {
      if (c === "`") { stack.pop(); regexMayStart = false; takeCode(); continue; }
      if (c === "$" && src[i + 1] === "{") { stack.push({ depth: 0 }); regexMayStart = true; takeCode(); takeCode(); continue; }
      if (c === "\\") take(text);
      take(text);
      continue;
    }
    if (/\s/.test(c)) { takeCode(); continue; }
    if (src.startsWith("//", i)) { while (i < src.length && src[i] !== "\n") takeCode(); continue; }
    if (src.startsWith("/*", i)) {
      const close = src.indexOf("*/", i + 2);
      if (close < 0) return [];
      while (i < close + 2) takeCode();
      continue;
    }
    if (c === "`") { stack.push("tmpl"); takeCode(); continue; }
    if (c === "'" || c === '"') {
      takeCode();
      while (src[i] !== c) {
        if (i >= src.length || src[i] === "\n") return [];
        if (src[i] === "\\") takeCode();
        takeCode();
      }
      takeCode();
      regexMayStart = false;
      continue;
    }
    if (c === "/" && regexMayStart) {
      takeCode();
      let inClass = false;
      while (inClass || src[i] !== "/") {
        if (i >= src.length || src[i] === "\n") return [];
        if (src[i] === "\\") takeCode();
        else if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        takeCode();
      }
      takeCode();
      regexMayStart = false;
      continue;
    }
    if (/[\w$]/.test(c)) {
      const start = i;
      while (/[\w$]/.test(src[i] || "")) takeCode();
      regexMayStart = REGEX_AFTER_WORD.has(src.slice(start, i));
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && c === "}" && top.depth === 0) { stack.pop(); takeCode(); continue; }
    if (top && c === "{") top.depth++;
    if (top && c === "}") top.depth--;
    regexMayStart = REGEX_AFTER_PUNCT.has(c);
    takeCode();
  }
  if (stack.length) return [];
  const only = [...text].filter((l) => !code.has(l)).map((l) => ({ start: l, end: l }));
  return mergeRanges(only);
}

/** The part of `ranges` that lies inside `{start, end}`. */
function clip(ranges, within) {
  return ranges
    .map((r) => ({ start: Math.max(r.start, within.start), end: Math.min(r.end, within.end) }))
    .filter((r) => r.start <= r.end);
}

function lineCount(ranges) {
  return ranges.reduce((n, r) => n + r.end - r.start + 1, 0);
}

/** `path` or `path:start-end`, the two shapes Stryker's `mutate` accepts here. */
function parseEntry(entry) {
  const m = /^(.+):(\d+)-(\d+)$/.exec(entry);
  return m ? { file: m[1], range: { start: Number(m[2]), end: Number(m[3]) } } : { file: entry, range: null };
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

/** How many test files the selection chooses from: every `*.test.mjs` under `scripts/tests/`. */
export function candidateTestCount(root) {
  const testsDir = join(root, "scripts", "tests");
  return existsSync(testsDir) ? testFilesUnder(testsDir).length : 0;
}

/**
 * The modules a `--named-only` selection does not narrow: each one named by
 * more than `NAMED_ONLY_MAX_SHARE` of the `candidates` test files, with that
 * count, read from the reasons `selectTests` recorded.
 */
export function unselectiveModules(tests, modules, candidates) {
  return modules
    .map((m) => ({ module: m, named: tests.filter((t) => t.why.includes(basename(m) + " named")).length, of: candidates }))
    .filter((u) => u.named > candidates * NAMED_ONLY_MAX_SHARE);
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

/**
 * What the run mutates and which tests judge it. `mutate` is exactly the list
 * handed to Stryker; with `--changed-lines`, or a `--files` entry written as
 * `path:start-end`, it holds such entries and `lines` holds the same ranges per
 * module mutated on ranges only. `modules` holds bare paths either way, since
 * they select the tests. `noAddedLines` (`--changed-lines` only) names the
 * selected entries, as written, left out because the change added no line to
 * them — to the module, or inside a hand-written range of it.
 */
export async function plan(root, opts) {
  let modules = opts.files || changedModules(root, opts.base);
  let changed = null;
  let noAddedLines = [];
  if (opts.changedLines) {
    // git is asked about the bare path; a hand-written range then narrows
    // the changed lines instead of naming a file git does not have (TL-705).
    const asked = modules.map((raw) => ({ raw, ...parseEntry(raw) }));
    const files = [...new Set(asked.map((e) => e.file))];
    const diff = changedLineRanges(root, opts.base, files);
    const within = (e) => (diff[e.file] ? (e.range ? clip(diff[e.file], e.range) : diff[e.file]) : []);
    changed = {};
    for (const f of files) {
      // A bare entry contributes every changed line, so a file also given whole keeps them all.
      const ranges = mergeRanges(asked.filter((e) => e.file === f).flatMap(within));
      if (ranges.length) changed[f] = ranges;
    }
    noAddedLines = asked.filter((e) => !within(e).length).map((e) => e.raw);
    modules = files.filter((f) => changed[f]);
  }
  const entries = changed
    ? modules.flatMap((m) => changed[m].map((r) => ({ raw: m + ":" + r.start + "-" + r.end, module: m, file: m, range: r })))
    : modules.map((m) => ({ raw: m, module: m, ...parseEntry(m) }));
  // Template text is reported, and a range made of nothing else is not handed
  // to Stryker: it can produce no mutant there (see templateTextLines).
  const templateText = {};
  const kept = entries.filter((e) => {
    const abs = join(root, e.file);
    const all = existsSync(abs) ? templateTextLines(readFileSync(abs, "utf8")) : [];
    const text = e.range ? clip(all, e.range) : all;
    if (text.length) {
      const seen = templateText[e.file] || { whole: false, ranges: [] };
      templateText[e.file] = { whole: seen.whole || !e.range, ranges: mergeRanges([...seen.ranges, ...text]) };
    }
    return !(e.range && lineCount(text) === e.range.end - e.range.start + 1);
  });
  const onlyText = [...new Set(entries.map((e) => e.module))].filter((m) => !kept.some((e) => e.module === m));
  // Tests are selected by the file, never by the entry: a `path:start-end`
  // names no test and is imported by no script (TL-658).
  modules = [...new Set(kept.map((e) => e.file))];
  const mutate = kept.map((e) => e.raw);
  if (changed) {
    // `lines` names what IS mutated; the text ranges are reported apart.
    for (const m of Object.keys(changed)) {
      const ranges = kept.filter((e) => e.module === m).map((e) => e.range);
      if (ranges.length) changed[m] = ranges;
      else delete changed[m];
    }
  } else {
    // A file also given whole is mutated whole, so it has no ranges to report.
    const ranged = {};
    for (const e of kept) if (e.range && !kept.some((w) => w.file === e.file && !w.range)) (ranged[e.file] ||= []).push(e.range);
    if (Object.keys(ranged).length) changed = ranged;
  }
  const tests = opts.tests
    ? opts.tests.map((file) => ({ file, why: ["--tests"] }))
    : await selectTests(root, modules, { namedOnly: opts.namedOnly });
  const unselective = opts.namedOnly && !opts.tests ? unselectiveModules(tests, modules, candidateTestCount(root)) : null;
  return { base: opts.base, modules, mutate, ...(changed ? { lines: changed, ...(opts.changedLines ? { noAddedLines } : {}) } : {}), tests,
    templateText, onlyText, ...(unselective ? { unselective } : {}) };
}

/** What a reader is told about the lines no mutant can reach. */
export const TEMPLATE_TEXT_GUARD = "a template literal is one string to Stryker, so code written inside one — "
  + "the viewer's page script in build-viewer.mjs — is guarded only by tests that execute the text it builds "
  + "(the page script run in node:vm), not by this run";

/** The template-literal text inside what the run was asked to mutate, for a reader. */
export function templateTextReport(p) {
  const files = Object.keys(p.templateText || {});
  if (!files.length) return [];
  const out = ["not mutated (template-literal text): " + files.map((f) => {
    const { whole, ranges } = p.templateText[f];
    return f + (whole ? " (" + lineCount(ranges) + " " + plural(lineCount(ranges), "line", "lines") + ")" : ":" + ranges.map((r) => r.start + "-" + r.end).join(","));
  }).join("  ")];
  out.push("  " + TEMPLATE_TEXT_GUARD);
  return out;
}

/** The ranges a run mutates (from `--changed-lines` or a `--files` range), and what it did not, for a reader. */
function rangeReport(p) {
  const ranged = p.modules.filter((m) => p.lines[m]);
  const out = ["mutated lines only: " + ranged.map((m) => m + ":" + p.lines[m].map((r) => r.start + "-" + r.end).join(",")).join("  ")];
  out.push("not mutated: every line outside these ranges, and every mutant spanning one");
  if (p.noAddedLines && p.noAddedLines.length) out.push("not mutated (no added line): " + p.noAddedLines.join(", "));
  return out;
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

/**
 * The counts a reader needs, per file, from Stryker's JSON report, and the
 * mutants a reader has to look at by line: those that survived and those that
 * timed out, which Stryker counts as detected without any assertion failing.
 */
export function summarise(report) {
  const files = {};
  const survivors = [];
  const timedOut = [];
  let noCoverage = 0;
  let timeouts = 0;
  let mutants = 0;
  for (const [file, data] of Object.entries(report.files || {})) {
    const c = { Killed: 0, Survived: 0, Timeout: 0, NoCoverage: 0, RuntimeError: 0, CompileError: 0, Ignored: 0 };
    for (const m of data.mutants) {
      c[m.status] = (c[m.status] || 0) + 1;
      const where = { file, line: m.location.start.line, mutator: m.mutatorName, replacement: m.replacement };
      if (m.status === "Survived") survivors.push(where);
      else if (m.status === "Timeout") timedOut.push(where);
    }
    noCoverage += c.NoCoverage;
    timeouts += c.Timeout;
    mutants += data.mutants.length - c.Ignored;
    const detected = c.Killed + c.Timeout;
    const valid = detected + c.Survived + c.NoCoverage;
    files[file] = { ...c, score: valid ? Math.round((detected / valid) * 10000) / 100 : null };
  }
  return { files, survivors, timedOut, noCoverage, timeouts, mutants };
}

/**
 * What Stryker's instrumenter is told to mutate for each file of `mutate`, by
 * the same reading Stryker applies to the list: a bare path is the whole file,
 * `path:start-end` the lines from `start` to `end` (1-based, both included),
 * which Stryker hands on 0-based and to the end of the last line. A file also
 * listed whole is mutated whole.
 */
export function mutateDescriptions(mutate) {
  const files = new Map();
  for (const raw of mutate) {
    const { file, range } = parseEntry(raw);
    const seen = files.get(file);
    if (!range || seen === true) { files.set(file, true); continue; }
    const located = { start: { line: range.start - 1, column: 0 }, end: { line: range.end - 1, column: Number.MAX_SAFE_INTEGER } };
    files.set(file, [...(seen || []), located]);
  }
  return files;
}

export const SILENT_LOGGER = Object.fromEntries([
  ...["trace", "debug", "info", "warn", "error", "fatal"].map((l) => [l, () => {}]),
  ...["Trace", "Debug", "Info", "Warn", "Error", "Fatal"].map((l) => ["is" + l + "Enabled", () => false]),
]);

/**
 * Stryker's instrumenter, the one its core runs, or null where Stryker is not
 * installed. It is a dependency of the core rather than of this repository, so
 * it is resolved from the core's own location.
 */
export async function loadInstrumenter() {
  let entry;
  try {
    const core = createRequire(import.meta.url).resolve(STRYKER_PIN + "/package.json");
    entry = createRequire(core).resolve(INSTRUMENTER);
  } catch {
    return null;
  }
  const mod = await import(pathToFileURL(entry).href);
  return new mod.Instrumenter(SILENT_LOGGER);
}

/**
 * How many mutants Stryker will create for `mutate`, in total and per file,
 * counted by `instrumenter` with Stryker's default mutator options; null when
 * no instrumenter is available. Nothing is run and nothing is written.
 */
export async function countMutants(root, mutate, instrumenter) {
  if (!instrumenter) return null;
  const files = {};
  let total = 0;
  for (const [file, description] of mutateDescriptions(mutate)) {
    const name = join(root, file);
    // Stryker matches a missing path to no file and mutates nothing there.
    if (!existsSync(name)) { files[file] = 0; continue; }
    const result = await instrumenter.instrument([{ name, mutate: description, content: readFileSync(name, "utf8") }],
      { plugins: null, excludedMutations: [], ignorers: [] });
    files[file] = result.mutants.length;
    total += result.mutants.length;
  }
  return { total, files };
}

/**
 * One run of `testFiles` as Stryker's command runner makes it — in its own
 * process group, in the environment Stryker is handed — timed. A failing run
 * is reported, not hidden: Stryker's initial run would fail on it too.
 */
export function timeTests(root, testFiles) {
  const started = performance.now();
  const r = spawnSync(process.execPath, [CONTAIN_ENTRY, process.execPath, ...workerTestArgs(testFiles)], {
    cwd: root, env: strykerEnv(process.env, root), stdio: "ignore",
  });
  return { seconds: (performance.now() - started) / 1000, passed: r.status === 0 };
}

/**
 * Wall time of a run: the initial test run, then every mutant running the
 * same tests, `concurrency` at a time. Workers are assumed not to slow each
 * other down, which on a loaded machine makes this a floor.
 */
export function estimateSeconds({ mutants, testSeconds, concurrency }) {
  if (mutants === 0) return 0;
  return testSeconds * (1 + Math.ceil(mutants / Math.max(1, concurrency)));
}

/** A duration for a reader: seconds, minutes, or hours and minutes. */
export function formatDuration(seconds) {
  if (seconds < 60) return Math.ceil(seconds) + " s";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 120) return minutes + " min";
  return Math.floor(minutes / 60) + " h " + (minutes % 60) + " min";
}

/**
 * The cost of plan `p`: mutants counted, the selected tests timed once, the
 * estimate, and whether it fits the budget. `{ counted: false }` when Stryker
 * is not installed, since nothing can then be counted.
 */
export async function measureCost(root, p, opts, deps = {}) {
  const instrumenter = await (deps.loadInstrumenter || loadInstrumenter)();
  const count = await (deps.countMutants || countMutants)(root, p.mutate, instrumenter);
  const budgetMinutes = opts.budget || DEFAULT_BUDGET_MINUTES;
  if (!count) return { counted: false, budgetMinutes };
  const concurrency = chooseConcurrency({ concurrency: opts.concurrency, testFiles: p.tests.length }).value;
  const initial = count.total === 0 ? { seconds: 0, passed: true } : (deps.timeTests || timeTests)(root, p.tests.map((t) => t.file));
  const estimate = estimateSeconds({ mutants: count.total, testSeconds: initial.seconds, concurrency });
  return {
    counted: true, mutants: count.total, mutantsPerFile: count.files,
    initialRunSeconds: Math.round(initial.seconds * 100) / 100, initialRunPassed: initial.passed,
    concurrency, estimateSeconds: Math.round(estimate * 100) / 100, budgetMinutes,
    overBudget: estimate > budgetMinutes * 60,
  };
}

/** Why a run with no mutant is not evidence, in the plan and in the refusal alike (TL-698). */
const NO_MUTANT_REASON = "a change with no mutable code has no mutation evidence";

/** The refusal of a run whose `mutate` list holds no mutant, before or after Stryker ran. */
function failNoMutant(p, when) {
  return fail(COMMAND, "no mutant in " + p.mutate.join(", ") + ": " + NO_MUTANT_REASON,
    [when, "A score over an empty set would read like a score over real work, so none is reported.",
      ...templateTextReport(p)],
    [], 1);
}

/** What a reader is told about the cost before anything is mutated. */
export function costReport(cost) {
  if (!cost.counted) return ["mutants: not counted — " + STRYKER_PIN + " is not installed (npm install)"];
  const out = ["mutants (" + cost.mutants + "): " + Object.entries(cost.mutantsPerFile).map(([f, n]) => f + " " + n).join(", ")];
  out.push("estimate: " + formatDuration(cost.estimateSeconds) + " — one run of the selected tests took "
    + formatDuration(cost.initialRunSeconds) + ", run once more for each mutant, " + cost.concurrency + " at a time; budget "
    + cost.budgetMinutes + " min" + (cost.overBudget ? ", exceeded: a run is refused without a larger --budget" : ""));
  if (!cost.initialRunPassed) out.push("the selected tests failed without a mutant, so Stryker's initial run will fail too");
  if (cost.mutants === 0) out.push("no mutant: " + NO_MUTANT_REASON + "; a run is refused");
  return out;
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
 * Make the sandbox a git repository of its own when it is not one (TL-674).
 *
 * Stryker copies the tree without `.git`, so a test that asks git about ITS
 * OWN tree — `git check-attr` in line-endings.test.mjs, the document root
 * `check --docs` takes from `git rev-parse --show-toplevel` in
 * docs-links.test.mjs — failed in the initial run on 2026-11-09, and Stryker
 * judged no mutant. The same suite was green outside the sandbox. An empty
 * repository answers both questions from the sandbox's own files, so those
 * tests keep judging the code under test instead of being left out of the
 * selection. It answers nothing about history or the index: a test that needs
 * the repository's commits still fails the initial run, and Stryker names it.
 * The initial run is one process, so the first `git init` happens before any
 * worker shares the directory. The repository's own variables are unset so
 * an inherited `GIT_DIR` cannot point the init at a real repository.
 */
export const SANDBOX_GIT_INIT = "{ [ -e .git ] || env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE git init -q . >/dev/null 2>&1 || true; }";

/**
 * The arguments of one worker's `node --test`: at most `fileConcurrency` test
 * files at once (TL-706), or node's own default where the flag is null
 * because the running node does not accept it. `chooseConcurrency()` budgets
 * each worker with the same figure.
 */
export function workerTestArgs(testFiles, fileConcurrency = testFileConcurrency()) {
  return ["--test", ...(fileConcurrency ? ["--test-concurrency=" + fileConcurrency] : []), ...testFiles];
}

/**
 * The command the runner executes in the sandbox: give it a git repository
 * (`SANDBOX_GIT_INIT`), recreate each ignored link with its own relative
 * target, then run the tests in a process group of their own
 * (`mutation-contain.mjs`). Every worker shares one sandbox, so a link another
 * worker made first is not an error; the check after `ln` is what decides.
 *
 * The tests run under this process's own node, not whatever `node` is first
 * on PATH: whether `--test-concurrency` is passed is decided from this
 * process's version, so it must be the node that receives it.
 */
export function sandboxCommand(links, testFiles, contain = CONTAIN_ENTRY, fileConcurrency = testFileConcurrency()) {
  const steps = [SANDBOX_GIT_INIT];
  steps.push(...links.map((l) => {
    const p = shellQuote(l.path);
    const parent = shellQuote(dirname(l.path));
    return "{ mkdir -p " + parent + " && { ln -s " + shellQuote(l.target) + " " + p + " 2>/dev/null; [ -L " + p + " ]; }; }";
  }));
  steps.push([process.execPath, contain, process.execPath, ...workerTestArgs(testFiles, fileConcurrency)].map(shellQuote).join(" "));
  return steps.join(" && ");
}

/** `ps` for every process: `pid pgid args`, one per line, nothing truncated. */
function processListing() {
  const r = spawnSync("ps", ["-A", "-ww", "-o", "pid=,pgid=,args="], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ps: " + (r.stderr || r.error || "").toString().trim());
  return r.stdout;
}

/**
 * Every process whose command line names `marker`, with its process group,
 * from `ps` output (`pid= pgid= args=`). The caller itself is never one.
 */
export function leftoverProcesses(marker, psOutput = null, self = process.pid) {
  if (psOutput === null) psOutput = processListing();
  const found = [];
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m || Number(m[1]) === self || !m[3].includes(marker)) continue;
    found.push({ pid: Number(m[1]), pgid: Number(m[2]), args: m[3] });
  }
  return found;
}

/** Shorter than this, a marker could name processes that are not the run's. */
export const MIN_SWEEP_MARKER = 8;

/**
 * Kill every process that still names `marker`, and the group it leads.
 *
 * The group matters as much as the process: a git hook runs as `/bin/sh
 * .git/hooks/commit-msg`, which names no sandbox path, while the CLI it runs
 * does. A group shared with this process is never killed whole, because this
 * process and whatever started it are in it.
 *
 * TWO checks stand between a process and this kill: the filter in
 * `leftoverProcesses()` and the one below it. Either alone looks redundant;
 * together they mean no SINGLE defect makes this function match every process
 * on the machine. That is not hypothetical: a mutation run mutates this file,
 * one mutant at a time, while its own tests call this function for real, and
 * a mutant that dropped the only filter would SIGKILL every process group the
 * user owns, desktop session included. A marker too short to be a run's own
 * directory is refused for the same reason.
 *
 * `ps`, `kill` and `self` are injectable so the guards can be judged without
 * killing anything.
 */
export function sweepLeftovers(marker, { ps = null, kill = process.kill, self = process.pid } = {}) {
  if (typeof marker !== "string" || marker.length < MIN_SWEEP_MARKER) {
    throw new Error("refusing to sweep for " + JSON.stringify(marker) + ": a marker this short could name any process");
  }
  if (ps === null) {
    if (process.platform === "win32") return [];
    ps = processListing();
  }
  const ownGroup = leftoverProcesses("", ps, -1).find((p) => p.pid === self);
  const leftovers = leftoverProcesses(marker, ps, self).filter((p) => p.args.includes(marker));
  for (const p of leftovers) {
    // A pgid of 0 or 1 is the kernel's or init's: `kill(-1)` would signal
    // every process this user owns, so such a leftover is killed by pid only.
    if (p.pgid > 1 && (!ownGroup || p.pgid !== ownGroup.pgid)) {
      try { kill(-p.pgid, "SIGKILL"); } catch { /* the group is already gone */ }
    }
    try { kill(p.pid, "SIGKILL"); } catch { /* it exited meanwhile */ }
  }
  return leftovers;
}

/** The Stryker configuration for plan `p`, its work files under `work`. */
export function strykerConfig(p, opts, links, work) {
  return {
    testRunner: "command",
    commandRunner: { command: sandboxCommand(links, p.tests.map((t) => t.file)) },
    coverageAnalysis: "off",
    mutate: p.mutate,
    // Exactly the links, anchored, never their parent: see directorySymlinks.
    ignorePatterns: links.map((l) => "/" + l.path),
    plugins: [],
    reporters: ["json", "clear-text", "progress"],
    jsonReporter: { fileName: join(work, "mutation.json") },
    clearTextReporter: { reportMutants: false },
    tempDirName: join(work, "sandbox"),
    cleanTempDir: true,
    // Every test file here spawns processes of its own, so one Stryker worker
    // occupies more than one core. Stryker's default (cores - 1) turned 101
    // of 116 mutants into Timeouts on a 15-core machine on 2026-11-05, which
    // it counts as DETECTED: a 100% score with almost nothing killed. At
    // half the cores and a wider timeout the same run gave 62 Killed, 54
    // Survived, 0 Timeout. Below that cap, free memory decides (TL-681).
    concurrency: chooseConcurrency({ concurrency: opts.concurrency, testFiles: p.tests.length }).value,
    timeoutFactor: 3,
    timeoutMS: 30000,
  };
}

/**
 * The environment handed to Stryker: this process's, minus what belongs to a
 * run ABOVE this one.
 *
 * A nested `node --test` that inherits NODE_TEST_CONTEXT reports to a parent
 * runner instead of through its exit code, and exits 0 on a failing test.
 * Inherited here, every mutant would be reported Survived. Measured on
 * 2026-11-05 when this file was itself started from a test.
 *
 * The active mutant of an OUTER mutation run must not reach this one either
 * (TL-629). Both runs speak through the same `__STRYKER_ACTIVE_MUTANT__` and
 * number their mutants from 0, and Stryker's command runner starts the initial
 * test run with the environment as it finds it, so an inherited id switched on
 * THIS run's mutant of that number during the run that must pass unmutated.
 * The initial run failed, the test that started this run failed, and the outer
 * mutant was reported Killed by something other than an assertion. Measured
 * with `subprocess-kill.test.mjs` under ids 0 and 1. The outer mutant stays
 * active in the process that calls this, which read the id when it loaded;
 * only the copy handed to Stryker loses it.
 *
 * What it ADDS is `SOURCE_ROOT_ENV`, naming the tree this run was started in
 * (TL-653). A test that reads a module's SOURCE TEXT finds the sandbox copy,
 * which Stryker has instrumented: every string literal is wrapped in a mutant
 * switch, so a regex for `X + "-backlog"` cannot match and the initial run
 * fails before a single mutant is tried. The instrumented text is the same
 * for every mutant, so such a test can never kill one; reading the original
 * through `scriptSource()` in `tests/_repo.mjs` keeps it a true statement
 * about the code instead of a failure the change under test did not cause.
 * An outer run's value is replaced, never inherited: its tree is not this
 * run's.
 */
export function strykerEnv(env = process.env, root = null) {
  const copy = { ...env };
  delete copy.NODE_TEST_CONTEXT;
  delete copy.__STRYKER_ACTIVE_MUTANT__;
  delete copy[SOURCE_ROOT_ENV];
  if (root) copy[SOURCE_ROOT_ENV] = root;
  return copy;
}

/**
 * Copy Stryker's report from `from` to `to`: `to` when it was written, or
 * `{ error }` when it was not. A failure is returned, not thrown, because the
 * run it belongs to has already finished and its result is still worth
 * printing.
 */
export function keepReport(from, to) {
  try {
    copyFileSync(from, to);
    return to;
  } catch (e) {
    return { error: e.message };
  }
}

export function runStryker(root, p, opts, slot, stryker = strykerBin, sweep = sweepLeftovers) {
  const bin = stryker();
  if (!bin) return { code: 2, problem: STRYKER_PIN + " is not installed", next: ["npm install"] };
  const links = directorySymlinks(root);
  const work = mkdtempSync(join(tmpdir(), "mutation-run-"));
  try {
    const config = strykerConfig(p, opts, links, work);
    const reportPath = config.jsonReporter.fileName;
    const configPath = join(work, "stryker.config.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const r = spawnSync(process.execPath, [bin, "run", configPath], {
      cwd: root,
      // The token lets a run a test starts inside this one share its slot.
      env: { ...strykerEnv(process.env, root), [SLOT_TOKEN_ENV]: slot.token },
      stdio: ["ignore", opts.json ? "pipe" : "inherit", opts.json ? "pipe" : "inherit"],
      encoding: "utf8",
    });
    let leftovers = [];
    try {
      leftovers = sweep(work + sep);
    } catch (e) {
      console.error(warn("cannot look for processes the run left behind: " + e.message));
    }
    if (!existsSync(reportPath)) {
      return { code: r.status || 1, problem: "Stryker produced no report", leftovers,
        details: lines((r.stderr || "") + (r.stdout || "")).slice(-10) };
    }
    // Copied before the parse, so a report this file cannot read is kept too.
    const kept = opts.keepReport ? keepReport(reportPath, opts.keepReport) : null;
    return { code: r.status, leftovers, kept, report: JSON.parse(readFileSync(reportPath, "utf8")) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function reportLeftovers(leftovers) {
  if (!leftovers || leftovers.length === 0) return;
  console.error(warn(leftovers.length + " " +
    plural(leftovers.length, "process outlived the run and was", "processes outlived the run and were") + " killed: a test left them behind"));
  for (const p of leftovers.slice(0, 10)) console.error("  " + p.pid + "  " + p.args);
}

/** `argv` without its `--budget <minutes>`, so a suggested command does not carry two. */
function withoutBudget(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--budget") i++;
    else out.push(argv[i]);
  }
  return out;
}

/**
 * `deps` replaces the parts that need Stryker or real time — `loadInstrumenter`,
 * `countMutants`, `timeTests`, `runStryker` — so the gate can be judged where
 * Stryker is not installed.
 */
export async function main(argv, cwd = process.cwd(), deps = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usage());
    return 0;
  }
  if (parsed.error) {
    return fail(COMMAND, parsed.error, ["known flags: " + [...FLAGS_WITH_VALUE, ...FLAGS_BARE].join(" ")], [COMMAND + " --help"]);
  }
  const { opts } = parsed;
  if (opts.keepReport && opts.plan) {
    return fail(COMMAND, "--keep-report has nothing to keep under --plan",
      ["A plan starts no Stryker run, so no mutation.json is written."], [COMMAND + " --plan (without --keep-report)"]);
  }
  if (opts.keepReport) {
    // Checked before the run, which can take most of an hour, not after it.
    opts.keepReport = resolve(cwd, opts.keepReport);
    const parent = dirname(opts.keepReport);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      return fail(COMMAND, "--keep-report " + opts.keepReport + ": " + parent + " is not a directory",
        ["The report would be lost when the run's directory is removed, so the run is not started."], [], 1);
    }
  }
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

  if (p.modules.length === 0 && p.onlyText.length) {
    const ranges = p.onlyText.map((m) => {
      const t = p.templateText[parseEntry(m).file];
      return parseEntry(m).range ? m : m + ":" + t.ranges.map((r) => r.start + "-" + r.end).join(",");
    });
    return fail(COMMAND, "nothing to mutate: every line asked for is template-literal text, " + ranges.join(", "),
      ["Stryker would create no mutant there, and a run with none would read like one whose mutants were all killed.",
        "Not mutated because " + TEMPLATE_TEXT_GUARD + ".",
        ...(p.noAddedLines && p.noAddedLines.length ? ["Not mutated (no added line): " + p.noAddedLines.join(", ")] : [])],
      [], 1);
  }
  if (p.modules.length === 0 && opts.changedLines && p.noAddedLines.length) {
    return fail(COMMAND, "nothing to mutate: the change added no line to " + p.noAddedLines.join(", "),
      ["A line that was only deleted leaves nothing to mutate, and a score over an empty set would read like a score over real work."],
      [COMMAND + " --files " + p.noAddedLines.join(",")], 1);
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

  if (p.unselective && p.unselective.length) {
    const names = p.unselective.map((u) => u.module);
    const others = p.modules.filter((m) => !names.includes(m));
    const flags = (opts.base !== "main" ? " --base " + opts.base : "") + (opts.changedLines ? " --changed-lines" : "");
    const next = [COMMAND + flags + " --tests scripts/tests/<file>.test.mjs"];
    if (others.length) next.push(COMMAND + flags + " --named-only --files " + others.join(","));
    return fail(COMMAND, "--named-only does not narrow the tests for " + names.join(", "),
      [...p.unselective.map((u) => u.module + " is named by " + u.named + " of " + u.of + " test files, more than "
        + Math.round(NAMED_ONLY_MAX_SHARE * 100) + "% of the suite"),
      "That selection is close to the whole suite: neither fast nor a lower bound, and its initial test run",
      "outlasts Stryker's dry-run timeout, so no mutant would be judged. Stryker was not started.",
      "Name the tests that exercise the changed lines with --tests, or leave the module out with --files."],
      next, 1);
  }

  let cost;
  try {
    cost = await measureCost(root, p, opts, deps);
  } catch (e) {
    return fail(COMMAND, "cannot count the mutants of " + p.mutate.join(", "), [String(e.message)], [], 1);
  }

  if (opts.plan) {
    if (opts.json) console.log(JSON.stringify({ kind: "mutation-plan", ...p, cost }, null, 2));
    else {
      console.log("mutate (" + p.modules.length + "): " + p.modules.join(", "));
      if (p.lines) for (const l of rangeReport(p)) console.log(l);
      for (const l of templateTextReport(p)) console.log(l);
      console.log("tests (" + p.tests.length + "):");
      for (const t of p.tests) console.log("  " + t.file + "  — " + t.why.join("; "));
      for (const l of costReport(cost)) console.log(l);
    }
    return 0;
  }

  for (const l of costReport(cost)) console.error(l);
  if (cost.overBudget) {
    const rest = withoutBudget(argv);
    const next = [];
    if (!opts.changedLines) next.push([COMMAND, ...rest, "--changed-lines"].join(" "));
    next.push([COMMAND, ...rest, "--budget", String(Math.ceil(cost.estimateSeconds / 60))].join(" "));
    return fail(COMMAND, "the run is estimated at " + formatDuration(cost.estimateSeconds) + ", over the budget of "
      + cost.budgetMinutes + " min: " + cost.mutants + " " + plural(cost.mutants, "mutant", "mutants") + " × "
      + formatDuration(cost.initialRunSeconds) + " of tests, " + cost.concurrency + " at a time",
    ["A run cut off by a timeout settles nothing, so Stryker was not started.",
      (opts.changedLines ? "" : "--changed-lines mutates only the lines this change wrote; ")
        + "--budget <minutes> admits a longer run deliberately."],
    next, 1);
  }
  if (cost.counted && cost.mutants === 0) {
    return failNoMutant(p, "Stryker's instrumenter places none on those lines, so Stryker was not started.");
  }

  const slot = await acquireSlot({
    wait: !opts.noWait,
    tree: root,
    onWait: (holder, path) => console.error(warn("waiting for the machine's mutation slot, held by " + describeHolder(holder, path))),
  });
  if (!slot.ok) {
    return fail(COMMAND, "another mutation run holds the machine's slot: " + describeHolder(slot.holder, slot.path),
      ["Two runs at once can exhaust the machine's memory, so --no-wait refuses rather than start a second."],
      [COMMAND + " (without --no-wait, to wait for it)"], 1);
  }
  let run;
  try {
    // Chosen here, after the wait: memory the previous holder used is free now.
    const concurrency = chooseConcurrency({ concurrency: opts.concurrency, testFiles: p.tests.length });
    console.error("concurrency " + concurrency.value + ": " + concurrency.reason);
    run = (deps.runStryker || runStryker)(root, p, { ...opts, concurrency: concurrency.value }, slot);
  } finally {
    releaseSlot(slot);
  }
  reportLeftovers(run.leftovers);
  if (!run.report) return fail(COMMAND, run.problem, run.details || [], run.next || [], run.code || 1);
  const summary = summarise(run.report);
  const kept = typeof run.kept === "string" ? run.kept : null;
  if (summary.mutants === 0) {
    if (kept) console.error("report kept: " + kept);
    return failNoMutant(p, "Stryker ran and its report holds none.");
  }

  if (opts.json) {
    console.log(JSON.stringify({ kind: "mutation-run", ...p, cost, ...summary, keptReport: kept }, null, 2));
  } else {
    for (const s of summary.survivors) console.log("survived  " + s.file + ":" + s.line + "  " + s.mutator + " → " + s.replacement);
    for (const s of summary.timedOut) console.log("timed out  " + s.file + ":" + s.line + "  " + s.mutator + " → " + s.replacement);
    if (p.lines) for (const l of rangeReport(p)) console.log(l);
    for (const l of templateTextReport(p)) console.log(l);
  }
  // Reported before any verdict below, which may return: the report is most
  // wanted exactly when the run did not end cleanly.
  if (kept) console.error("report kept: " + kept);
  const keepFailed = Boolean(run.kept && run.kept.error);
  if (keepFailed) console.error(warn("the report could not be kept at " + opts.keepReport + ": " + run.kept.error));
  if (summary.noCoverage > 0) {
    return fail(COMMAND, summary.noCoverage + " " + plural(summary.noCoverage, "mutant", "mutants") + " reported NoCoverage under coverageAnalysis: off",
      ["This configuration cannot lose coverage, so the result is not a score; the runner setup has changed."],
      [], 1);
  }
  if (summary.timeouts > 0) {
    // Stryker counts a Timeout as detected. On this suite a timeout is far
    // more often an overloaded machine than a mutant that loops, so it is
    // reported where a reader of the score cannot miss it.
    console.error(warn(summary.timeouts + " " +
      plural(summary.timeouts, "mutant timed out and is", "mutants timed out and are") + " counted as detected; "
      + "rerun with a lower --concurrency before trusting the score"));
  }
  if (keepFailed) return 1;
  return run.code === 0 ? 0 : run.code || 1;
}

if (process.argv[1] && process.argv[1].endsWith("mutation-run.mjs")) {
  process.exitCode = await main(process.argv.slice(2));
}
