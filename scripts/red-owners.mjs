#!/usr/bin/env node
/**
 * `red` — whose failure is this? (TL-276)
 *
 * WHAT IT ANSWERS. A two-hand pipeline commits red ON PURPOSE: the `spec`
 * hand's whole deliverable is a failing test, and the `dev` hand inherits a
 * tree where the suite is already not green. Every contract in such a
 * repository runs the whole suite, so the inherited red is reported as the
 * hand's own, and "green" stops being available as an answer. Two hands
 * measured the same thing in different waves and both reached for the same
 * dangerous workaround: copying a production file out of the tree, restoring
 * the HEAD version to get a baseline, and copying it back — one of them a
 * single command away from committing the wrong version. `git stash` is
 * forbidden here (the stack is shared across every worktree of a clone), so
 * the workaround people invented instead was more dangerous than the thing
 * that was forbidden.
 *
 * The missing piece was never a baseline run. It was ATTRIBUTION: which task
 * does this failing file belong to.
 *
 * WHY IT IS DERIVED AND NOT DECLARED (the decision on TL-276). A `known_red:`
 * list in `config.yaml` was rejected: it is a versioned copy of something the
 * commit titles already say, it goes stale in silence, and a stale list says
 * "not yours" about a failure that IS yours — a wrong answer wearing the look
 * of a fact, which is the failure mode this project keeps refusing (Law 2). A
 * flag on a `verification:` entry was rejected for a different reason: it is
 * per-task, and the question is about SOMEBODY ELSE'S red, which the task's own
 * contract cannot speak about. The index from file to task already exists —
 * `modified-files.mjs` (TL-75), computed from the task id in commit titles — so
 * this command is one more reader of it and asks nothing new of anybody.
 *
 * WHY NOT `check --red-owners`. `check` is the release gate: a structural
 * verdict that costs about a second, and a `verification:` entry in THIS
 * backlog runs it. A `check` that ran the suite would run itself, and would
 * turn a one-second gate into minutes for every caller that never asked about
 * red.
 *
 * IT SUPPRESSES NOTHING. There is no skip list, no `--expect-failures` that
 * removes a test from the run, and no exit code that forgives a failure. A test
 * that stops running stops proving; this command changes who the reader
 * believes the failure belongs to, and nothing else.
 *
 * WHAT ATTRIBUTION CAN AND CANNOT SAY. It names the task whose commit last
 * touched the failing file, and whether that file differs from HEAD in THIS
 * working tree. That is evidence, not a verdict: a file you edited is yours to
 * explain whoever wrote it first, and a file no commit names carries no answer
 * at all — which is reported as `unattributed` rather than guessed.
 *
 * Exit: 0 the question was answered (a red suite is an answer, not a failure of
 * this command) · 1 the report could not be read · 2 the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/known-red.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { modifiedFilesCached, repoRoot } from "./modified-files.mjs";
import { resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { taskIdScanner } from "./task-id.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const KNOWN_FLAGS = ["--json", "--dir"];
const VALUE_FLAGS = ["--command", "--report", "--mine"];

/**
 * The failing test FILES in a `node --test` report.
 *
 * PURE, so the parse is provable without a suite.
 *
 * WHY THE FILE IS TAKEN FROM THE FAILURE'S LOCATION AND NOT FROM THE NESTING.
 * The obvious reading — a top-level `not ok` names the file, an indented one
 * names a case inside it — is how TAP looked when the runner spawned a process
 * per file. It is not how it looks now: `node --test a b` flattens both files
 * into one numbering, so every `not ok` sits at column zero and the file
 * disappears from the structure entirely. A parser built on that reading
 * attributes every failure to whatever ran first, and says so with a straight
 * face. Both reporters instead state the file OUTRIGHT beside each failure —
 * TAP as `location:` in the failure's YAML block, the spec reporter as the
 * `test at <path>:<line>:<column>` line above it — and that is what is read
 * here.
 *
 * BOTH REPORTERS, because the caller's suite command is the caller's. `--test`
 * has defaulted to the spec reporter since Node 22 whether or not it is writing
 * to a terminal, so a parser that knew only TAP would find nothing in the most
 * ordinary run there is and report a clean tree.
 *
 * A `# SKIP` or `# TODO` directive is not a failure and TAP marks it on the
 * `ok` line, so nothing here has to know about it.
 *
 * @returns {{name: string, failures: string[]}[]} one entry per FILE, in the
 *   order the report first named it, carrying the failing cases inside it
 */
export function parseFailures(text) {
  const lines = String(text || "").split("\n");
  const found = [];

  // The spec reporter's summary: the location on one line, the case on the next.
  for (let i = 0; i < lines.length - 1; i++) {
    const at = lines[i].match(/^\s*test at (.+):\d+:\d+\s*$/);
    if (!at) continue;
    const next = lines[i + 1].match(/^\s*✖ (.*?)(?: \([\d.]+ms\))?\s*$/);
    if (next) found.push({ file: at[1], test: next[1].trim() });
  }

  // TAP: a failing test, then the `location:` inside its own YAML block. The
  // block ends at `...`, so a failure whose location never arrives cannot pick
  // up the next one's.
  let pending = null;
  for (const raw of lines) {
    const bad = raw.match(/^\s*not ok \d+ - (.*)$/);
    if (bad) { pending = bad[1].replace(/\s+#.*$/, "").trim(); continue; }
    if (!pending) continue;
    const where = raw.match(/^\s*location: '(.+):\d+:\d+'\s*$/);
    if (where) { found.push({ file: where[1], test: pending }); pending = null; continue; }
    if (/^\s*\.\.\.\s*$/.test(raw)) pending = null;
  }

  const byFile = new Map();
  for (const hit of found) {
    if (!byFile.has(hit.file)) byFile.set(hit.file, { name: hit.file, failures: [] });
    const entry = byFile.get(hit.file);
    if (hit.test && !entry.failures.includes(hit.test)) entry.failures.push(hit.test);
  }
  return [...byFile.values()];
}

/**
 * The task a file belongs to, by the convention this repository already
 * requires: the task id in the commit title.
 *
 * TWO ANSWERS, NOT ONE. `tasks` is every task whose commits touched the file —
 * the index TL-75 computes in one pass. `lastTask` is the most recent of them,
 * which is the one that most likely made it red, and it needs the ORDER that a
 * set cannot carry. Naming only the last would hide a file two tasks are
 * arguing over; naming only the set would leave the reader to guess which.
 */
export function attributeFile(path, opts) {
  const { root, byTask, scanner, run = spawnSync } = opts;
  const tasks = [];
  for (const [id, paths] of byTask) if (paths.has(path)) tasks.push(id);
  tasks.sort();

  let lastTask = null;
  const log = run("git", ["log", "-n", "50", "--pretty=format:%s", "--", path],
    { cwd: root, encoding: "utf8", timeout: 30_000 });
  if (log.status === 0) {
    for (const subject of String(log.stdout || "").split("\n")) {
      scanner.lastIndex = 0;
      const m = scanner.exec(subject);
      if (m) { lastTask = m[1]; break; }
    }
  }

  // `--quiet` makes the exit code the whole answer: 1 is "it differs from
  // HEAD". A file git has never seen exits 0 with no diff and is caught by the
  // existence check instead, because an untracked test file is as much this
  // session's doing as an edited one.
  const diff = run("git", ["diff", "--quiet", "HEAD", "--", path],
    { cwd: root, encoding: "utf8", timeout: 30_000 });
  const tracked = run("git", ["ls-files", "--error-unmatch", "--", path],
    { cwd: root, encoding: "utf8", timeout: 30_000 });
  const uncommitted = diff.status === 1 || tracked.status !== 0;

  return { path, tasks, lastTask, uncommitted };
}

/**
 * The verdict for one row, in the vocabulary the reader asked in.
 *
 * `yours` is claimed on EVIDENCE IN THIS TREE first — an uncommitted change to
 * the file outranks any commit, because a working tree is nobody else's. Only
 * then does the commit history speak, and only then can it say `elsewhere`.
 */
export function verdictFor(row, mine) {
  if (row.uncommitted) return "yours";
  if (mine && (row.lastTask === mine || row.tasks.includes(mine))) return "yours";
  if (row.lastTask) return mine ? "elsewhere" : "attributed";
  return "unattributed";
}

/** The whole answer, as data. Reads git; writes nothing. */
export function redOwners(opts = {}) {
  const { text, command = null, exitCode = null, root, prefix, mine = null, run = spawnSync } = opts;
  const index = modifiedFilesCached({ root, prefix, run });
  const scanner = taskIdScanner(prefix);

  const parsed = parseFailures(text);
  const files = parsed.map((entry) => {
    // TAP prints the path exactly as the runner was given it — relative to the
    // directory the suite ran in, which is not necessarily the repository root.
    // The index speaks in repository-root paths, so the two are reconciled here
    // rather than at every comparison.
    const abs = resolve(opts.cwd || process.cwd(), entry.name);
    const path = root && existsSync(abs) ? relative(root, abs) : entry.name;
    const row = root
      ? attributeFile(path, { root, byTask: index.byTask, scanner, run })
      : { path, tasks: [], lastTask: null, uncommitted: false };
    row.failures = entry.failures;
    row.verdict = verdictFor(row, mine);
    return row;
  });

  const tally = {
    failed: files.length,
    yours: files.filter((f) => f.verdict === "yours").length,
    elsewhere: files.filter((f) => f.verdict === "elsewhere" || f.verdict === "attributed").length,
    unattributed: files.filter((f) => f.verdict === "unattributed").length,
  };

  return {
    command,
    ran: text !== null,
    reason: text === null ? "no-report" : (index.scanned ? "ok" : index.reason),
    exitCode,
    files,
    mine,
    tally,
  };
}

/** The text answer. PURE, so a test reads it without a terminal. */
export function renderRed(report, opts = {}) {
  const paint = opts.color || color;
  const out = [heading("red", { color: paint }), ""];

  if (!report.ran) {
    out.push("  nothing to attribute — no test report was given");
    out.push("");
    out.push("  " + MARK.arrow + " " + N + " red --command \"<the suite command>\"");
    out.push("  " + MARK.arrow + " <the suite command> | " + N + " red     # a run you already paid for");
    out.push("");
    return out.join("\n");
  }

  if (!report.files.length) {
    out.push("  " + paint.ok(MARK.ok) + " no failing test file in the report");
    out.push("");
    return out.join("\n");
  }

  const rows = report.files.map((f) => {
    const owner = f.uncommitted ? "uncommitted here" : (f.lastTask || "no task in any commit");
    return ["    " + f.path, owner, f.verdict];
  });
  out.push("  " + report.tally.failed + " failing test file(s):");
  out.push(table(rows));
  out.push("");
  out.push("  " + (report.tally.yours ? paint.err(MARK.err) : paint.ok(MARK.ok)) + " yours: " +
    report.tally.yours + "  ·  another task's: " + report.tally.elsewhere +
    "  ·  unattributed: " + report.tally.unattributed);
  if (!report.mine) {
    out.push("  " + MARK.bullet + " `--mine <ID>` names the task you hold, and the verdicts sharpen");
  }
  if (report.reason !== "ok") {
    out.push("  " + paint.warn(MARK.warn) + " the file index could not be computed (" + report.reason +
      ") — every row is unattributed for that reason, not because nobody owns it");
  }
  out.push("");
  return out.join("\n");
}

/** Read a flag's value out of argv, or `null`. Throws on a missing value. */
function valueOf(argv, flag) {
  const at = argv.indexOf(flag);
  if (at < 0) return null;
  const value = argv[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(flag + " needs a value");
  return value;
}

export function main(argv, io = {}) {
  const cli = takeDirFlag(argv);
  const rest = cli.argv;

  let command, reportPath, mine;
  try {
    command = valueOf(rest, "--command");
    reportPath = valueOf(rest, "--report");
    mine = valueOf(rest, "--mine");
  } catch (e) {
    console.error(failure(N + " red", e.message, [], [N + " red --help"]));
    return 2;
  }

  const unknown = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (VALUE_FLAGS.includes(arg)) { i++; continue; }
    if (KNOWN_FLAGS.includes(arg)) continue;
    unknown.push(arg);
  }
  if (unknown.length) {
    console.error(failure(N + " red", "unexpected argument: " + unknown.join(" "),
      ["available: " + KNOWN_FLAGS.concat(VALUE_FLAGS).join(" ")], [N + " red --help"]));
    return 2;
  }
  if (command !== null && reportPath !== null) {
    console.error(failure(N + " red", "`--command` and `--report` name two different runs",
      ["one run, one answer — give whichever you already have"], [N + " red --help"]));
    return 2;
  }

  const asJson = rest.includes("--json");
  const root = resolveBacklogDirOrExit({ dir: cli.dir }, N + " red").root;
  const config = loadConfigOrExit(root);
  const repo = repoRoot(root);

  // THE REPORT COMES FROM ONE OF THREE PLACES, and the order is the order of
  // explicitness. A pipe is last because it is the only one nobody typed.
  let text = null;
  let exitCode = null;
  if (command !== null) {
    // Through the shell on purpose: a suite command is a glob and a pipeline in
    // every repository that has one, and re-implementing word splitting here
    // would refuse the commands people actually run. Which reporter it answers
    // in does not matter: both name the file beside each failure, and both are
    // read.
    const r = (io.run || spawnSync)(command, {
      cwd: repo || root, encoding: "utf8", shell: true, timeout: 30 * 60_000,
      maxBuffer: 256 * 1024 * 1024,
    });
    if (r.error) {
      console.error(failure(N + " red", "the command could not be run: " + r.error.message, [],
        [N + " red --help"]));
      return 1;
    }
    text = String(r.stdout || "") + String(r.stderr || "");
    exitCode = r.status;
  } else if (reportPath !== null) {
    const path = reportPath === "-" ? null : resolve(process.cwd(), reportPath);
    if (path && !existsSync(path)) {
      console.error(failure(N + " red", "no such report: " + reportPath, [], [N + " red --help"]));
      return 1;
    }
    try {
      text = readFileSync(path || 0, "utf8");
    } catch (e) {
      console.error(failure(N + " red", "the report could not be read: " + e.message, [],
        [N + " red --help"]));
      return 1;
    }
  } else if (io.stdin !== undefined) {
    text = io.stdin;
  } else if (!process.stdin.isTTY) {
    // A terminal is NOT read: `red` with no argument at a prompt would hang
    // waiting for a report nobody is typing, and a command that appears to have
    // frozen is worse than one that says what it needs.
    try {
      text = readFileSync(0, "utf8");
    } catch {
      text = null;
    }
  }

  const report = redOwners({
    text, command, exitCode, root: repo, prefix: config.taskIdPrefix, mine,
    cwd: repo || process.cwd(), run: spawnSync,
  });

  if (asJson) {
    printJson("red-owners", report);
    return 0;
  }
  console.log(renderRed(report));
  // A RED SUITE IS AN ANSWER. The exit code says whether the question could be
  // answered, never whether the answer was pleasant — a caller that read a
  // non-zero exit as "some test failed" would have two commands reporting the
  // same failure, and would stop being able to tell a broken attribution from a
  // broken suite.
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("red-owners.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
