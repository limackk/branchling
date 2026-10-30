#!/usr/bin/env node
/**
 * The `done <ID>` command — closing a task RUNS its verification (TL-82).
 *
 * WHAT THIS CHANGES. `verification:` has been written, validated and taught
 * since the beginning, and no script ever ran it: enforcement was a line in a
 * skill file, addressed to the same agent it was meant to police. That is a
 * convention of discipline wearing the clothes of a guarantee. After this
 * command "done" is an exit code, not a declaration by the party with the
 * strongest interest in the answer being yes.
 *
 * WHAT IT DELIBERATELY DOES NOT PROMISE. A task file is a text file, and anyone
 * can set `status: done` in an editor. This gate raises the COST of a lie; it
 * does not make one impossible. Saying otherwise would be the same species of
 * untruth the command exists to catch, so the README says it too.
 *
 * WHY THERE IS NO `--force`. The task asked for the decision either way, as long
 * as it was not silent. There is none, and the reason is that it would not add a
 * capability — hand-editing the file is already available and already honest
 * about being a bypass, because it leaves a diff a reviewer can see. A flag adds
 * something worse than capability: a SUPPORTED, scriptable bypass, one word long,
 * that ends up in a CI job where nobody reads it again. The escape hatch that
 * costs a visible edit is the right price.
 *
 * WHY IT NEVER RUNS BY ITSELF. Not in `build`, not in `check`, not in `serve`,
 * not in `regen-hook`. A task arriving in somebody else's pull request carries a
 * shell command; it may run only when a person deliberately closes THAT task,
 * and only after its text has been printed. `scripts/tests/verification-gate.test.mjs`
 * holds a test that fails if another command ever learns to run it.
 *
 * Tests: `node --test scripts/tests/verification-gate.test.mjs`
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTOR_ENV, resolveActorSource } from "./actor.mjs";
import { userConfigPath } from "./home.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { backlogPaths, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { loadConfig, loadConfigOrExit } from "./config.mjs";
import { applyProofs, auditTask, parseCriteria, parseVerification } from "./criteria.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { ACTOR_NAMESPACES, appendEntries, currentSession, eventId, FIELD_UNVERIFIED, FIELD_VERIFIED, isValidActor, REASON_PROVEN, reasonRefusal, recordEdit, requiresReason } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { releaseLock } from "./lock.mjs";
import { MARK, color, errColor, failure } from "./ui.mjs";
import { todayStamp } from "./today.mjs";
import { CAPABLE, contractCapability, readCoverageFiles } from "./contract-capability.mjs";
import { taskModifiedFiles } from "./modified-files.mjs";
import { processTreeDetached, stopProcessTree } from "./process-tree.mjs";
import { canonicalPath } from "./canonical-path.mjs";
import { posixShell } from "./posix-shell.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);

/** The placeholder `_template.md` ships. A task closed on this has a contract
 *  that was never written — a different failure from "the verification failed",
 *  and it gets a different message. */
export const TEMPLATE_PLACEHOLDER = "command to run";

/**
 * What a `manual:` entry is NOT evidence of.
 *
 * The enumeration matters more than the request. "Verify this properly" is
 * advice nobody has ever acted on differently; a list of the four things people
 * actually submit instead of evidence is something a reader can check themselves
 * against. Taken from the Backlog.md guidance, which is better here than our
 * silence was.
 */
const NOT_EVIDENCE = [
  "the code being present, or the diff looking right",
  "a grep or a search finding the string you expected",
  "the intention of the implementation, or a reading of the source",
  "\"I checked\" — including when it is true",
];
const IS_EVIDENCE = [
  "  Evidence is a run through the browser, a script against the DOM, a test runner,",
  "  or a described result of a manual interaction another person could repeat.",
];

/** The word the prompt asks for. Not `y`: a confirmation you can give with one
 *  finger on the way to something else is not the deliberate act this is for. */
const CONFIRM_WORD = "confirm";

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────────

const FLAGS = ["--dir", "--dry-run", "--json", "--actor", "--role", "--status", "--confirm-manual", "--reason", "--verbose"];

/** PURE — resolves `done`'s arguments. Throws on a usage error. */
export function parseDoneArgs(args) {
  const taken = takeDirFlag(args, { missing: "`--dir` with no path" });
  args = taken.argv;
  let id = null;
  let dir = taken.dir;
  let dryRun = false;
  let json = false;
  let actor = null;
  let status = null;
  let confirmManual = false;
  let reason = null;
  let role = null;
  let verbose = false;

  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!literal && a === "--") { literal = true; continue; }
    if (!literal && a === "--dry-run") { dryRun = true; continue; }
    if (!literal && a === "--json") { json = true; continue; }
    if (!literal && a === "--confirm-manual") { confirmManual = true; continue; }
    if (!literal && a === "--verbose") { verbose = true; continue; }
    if (!literal && a === "--actor") {
      actor = args[++i] || null;
      if (!actor) throw new Error("`--actor` with no name");
      continue;
    }
    if (!literal && a === "--role") {
      role = args[++i] || null;
      if (!role) throw new Error("`--role` with no value");
      continue;
    }
    if (!literal && a === "--status") {
      status = args[++i] || null;
      if (!status) throw new Error("`--status` with no value");
      continue;
    }
    if (!literal && a === "--reason") {
      reason = args[++i] || null;
      if (!reason) throw new Error("`--reason` with no text");
      // An unusable value is a bad ARGUMENT — wrong whatever the task and
      // whatever the configuration say — so it fails here with the other usage
      // errors rather than as a refusal about this particular closure. WHICH of
      // the three rules it breaks is `reasonRefusal`'s to say (TL-254): this
      // site used to call every unusable reason "reserved" and echo the whole
      // of it back, so a 600-character sentence was refused with the one cause
      // it did not have, and the length that explains it was never printed.
      const refusal = reasonRefusal(reason, "--reason");
      if (refusal) throw new Error(refusal);
      continue;
    }
    if (!literal && a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\navailable: " + FLAGS.join(" "));
    }
    if (id) throw new Error("two task ids given: " + id + " and " + a + " — close one task at a time");
    id = a;
  }
  if (!id) throw new Error("no task id\nusage: " + N + " done <ID> [--dry-run] [--json]");
  return { id, dir, dryRun, json, actor, role, status, confirmManual, reason, verbose };
}

/** The task file for an id, or null. */
export function findTaskFile(tasksDir, config, id) {
  const wanted = String(id || "").toUpperCase();
  for (const f of readdirSync(tasksDir)) {
    if (!config.taskId.file.test(f)) continue;
    const m = f.match(config.taskId.fileId);
    if (m && m[1].toUpperCase() === wanted) return join(tasksDir, f);
  }
  return null;
}

/**
 * Why this task cannot be closed BEFORE anything is run, or null.
 *
 * Separated from the run on purpose: "this task has no closing contract" is not
 * the same defect as "the verification failed", it is discovered without
 * executing anything, and it deserves its own message. A guard that is green on
 * an empty sample is green with no evidential force (CLAUDE.md), and an empty
 * `verification:` is exactly that sample.
 */
export function contractProblem(entries, problems) {
  if (problems && problems.length) return problems.join("\n");
  if (!entries.length) {
    return (
      "this task has no `verification:` — there is nothing that could prove it is done.\n" +
      "A closing contract is not paperwork: it is the whole difference between a status\n" +
      "somebody set and a status something earned. Write one, then close the task."
    );
  }
  for (const e of entries) {
    const text = e.bash || e.manual || "";
    if (text.trim() === TEMPLATE_PLACEHOLDER) {
      return (
        "`verification:` still holds the template placeholder (`" + TEMPLATE_PLACEHOLDER + "`).\n" +
        "The field was filled in by the template, not by anybody who thought about this task."
      );
    }
  }
  return null;
}

/**
 * The task's contract followed by the project's `closing_contract` (TL-493).
 *
 * APPENDED, not prepended: the task's own entries are the cheaper, narrower
 * question, and a module test that fails should say so before a repository-wide
 * guard spends its minutes. An id the two share is returned as a collision
 * rather than resolved, because which entry a `[proof: id]` meant is a decision
 * only the author of the task can make.
 *
 * @returns {{entries: Array<object>, collisions: string[]}}
 */
export function withClosingContract(entries, closing) {
  const project = (closing || []).map((e) => ({ ...e, project: true }));
  const own = new Set(entries.filter((e) => e.id).map((e) => e.id));
  const collisions = project.filter((e) => e.id && own.has(e.id)).map((e) => e.id);
  return { entries: entries.concat(project), collisions };
}

/**
 * The contract a closing of this task would run, read from its frontmatter
 * (TL-495). ONE reader for `done`, the probe and the proofs audit: each of them
 * used to parse `verification:` on its own, and the two that did not append the
 * project's entries reported green where `done` would refuse.
 *
 * `own` is the task's contract alone, because `done` judges it BEFORE the
 * project's entries exist for it — an empty or unreadable one is a task nobody
 * finished writing, however many project entries would run. Neither of those
 * gets the project's entries appended, so no caller can mistake a contract made
 * entirely of somebody else's lines for this task's proof.
 *
 * @returns {{own: Array<object>, entries: Array<object>, problems: string[], collisions: string[]}}
 */
export function closingContractOf(frontmatter, config) {
  const { entries, problems } = parseVerification(frontmatter);
  if ((problems && problems.length) || !entries.length) {
    return { own: entries, entries, problems: problems || [], collisions: [] };
  }
  const merged = withClosingContract(entries, (config || {}).closingContract);
  return { own: entries, entries: merged.entries, problems: [], collisions: merged.collisions };
}

/** The sentence every reader of the contract refuses a shared id with. */
export function collisionHeadline(id) {
  return id + ": a verification id is also an id in the project's `closing_contract`";
}

/**
 * Literal repository-relative JavaScript files passed to `node --test`.
 *
 * This is deliberately not a shell parser. Only a plain path has one certain
 * meaning before execution; globs, variables, substitutions, absolute paths
 * and arbitrary commands stay the shell runner's responsibility.
 */
const LITERAL_TEST_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:cjs|js|mjs)$/;

export function nodeTestFiles(entry) {
  if (!entry || !entry.bash) return [];
  const found = [];
  for (const segment of String(entry.bash).split(/\n|;|&&|\|\|/)) {
    const match = segment.trim().match(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*(?:[^\s/]+\/)*node\s+--test(?:\s+([\s\S]*))?$/
    );
    if (!match || !match[1]) continue;
    for (let token of match[1].trim().split(/\s+/)) {
      if ((token.startsWith('"') && token.endsWith('"')) ||
          (token.startsWith("'") && token.endsWith("'"))) token = token.slice(1, -1);
      if (LITERAL_TEST_FILE.test(token)) found.push(token);
    }
  }
  return found;
}

/** The first literal `node --test` file that cannot be run, or null. */
export function missingNodeTestFile(entries, repoRoot) {
  for (const entry of entries || []) {
    for (const path of nodeTestFiles(entry)) {
      const absolute = resolve(repoRoot, path);
      try {
        if (!existsSync(absolute) || !statSync(absolute).isFile()) return { entry, path };
      } catch {
        return { entry, path };
      }
    }
  }
  return null;
}

/** The repository root — the working directory for every command.
 *
 *  NOT `join(backlogRoot, "..")`: in a co-located layout the backlog directory
 *  IS the repository root, and in a nested one it is one level down, and neither
 *  is a rule you may assume. Git knows; when there is no git, the backlog root
 *  is the only defensible answer left, and it is stated rather than guessed. */
export function repoRootFor(backlogRoot) {
  const r = spawnSync("git", ["-C", backlogRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", env: gitDiscoveryEnv() });
  const out = (r.stdout || "").trim();
  return r.status === 0 && out ? canonicalPath(out) : backlogRoot;
}

/** How much a passing entry said, for the verdict line — `, 1698 lines not shown`
 *  or nothing at all when the command was silent or was streamed (`--verbose`). */
export function suppressedNote(output) {
  if (output == null) return "";
  const lines = output.split("\n").filter((l) => l.length).length;
  if (!lines) return "";
  return ", " + lines + " line" + (lines === 1 ? "" : "s") + " not shown";
}

/** The gutter every captured line is written behind. Two columns, so the
 *  transcript keeps its own indentation relative to itself. */
export const TRANSCRIPT_GUTTER = "│ ";

/**
 * EVERY REPORT FRAMES THE TRANSCRIPT IT PASTES (TL-275, TL-399).
 *
 * WHAT WENT WRONG WITHOUT IT. A failing entry's output was written to stderr
 * unframed, immediately before this command's own refusal, and the two layers
 * share one alphabet: a test that runs this CLI and asserts it refuses captures
 * `✗` and prints it inside the test runner's stream. Two sessions, six waves
 * apart and neither having seen the other, read those fixture lines as failures
 * of the repository they were closing a task in, and each paid for a second full
 * suite run to find out they were not. A refusal is read by whoever has only the
 * transcript, and an autonomous loop feeds that transcript to the next attempt
 * as the reason the last one failed — so a wrong diagnosis is inherited rather
 * than corrected.
 *
 * WHAT THE FRAME BUYS, PER LINE. Behind the gutter: output of the command the
 * contract ran. Without it: this refusal. That is the whole boundary this
 * command is in a position to know, and it is stated rather than left to the
 * glyphs. The header resolves what is left inside the frame — a line carrying
 * this tool's own error mark is this tool run BY that command — and counts those
 * lines, so the reader knows how many are waiting for them before they scroll.
 *
 * WHY THE LINE COUNT APPEARS TWICE. The transcript is written WHOLE and always
 * has been; what the second report met was a reader whose window cut it before
 * the real failures. This command cannot stop that, and shortening the evidence
 * to fit would be the wrong answer to it. Naming the count in the header and
 * again in the footer makes a cut detectable instead of invisible: a reader who
 * counts fewer lines than the frame claims knows something between here and them
 * truncated it.
 *
 * @param {string|null} output the captured transcript
 * `omittedLines` is for a caller that deliberately relays a tail. The frame
 * then counts the command lines it ACTUALLY writes separately from the earlier
 * lines it names but does not print. A synthetic truncation notice must not sit
 * behind the gutter: every guttered line is promised to come from the command.
 *
 * @param {{command?: string, exitCode?: number, color?: object, omittedLines?: number,
 *          reportName?: string}} opts
 */
export function transcriptBlock(output, opts = {}) {
  const paint = opts.color || errColor;
  const body = String(output == null ? "" : output).replace(/\n+$/, "");
  const rows = body.length ? body.split("\n") : [];
  const count = rows.length + (rows.length === 1 ? " line" : " lines");
  const omitted = Number.isInteger(opts.omittedLines) && opts.omittedLines > 0 ? opts.omittedLines : 0;
  const total = rows.length + omitted;
  const headerCount = omitted
    ? rows.length + " of " + total + " command lines shown"
    : count;
  const footerCount = omitted
    ? rows.length + " command lines written · " + omitted + " earlier command lines omitted"
    : count + " written";
  const reportName = opts.reportName || "refusal";
  const nested = rows.filter((l) => l.indexOf(MARK.err) >= 0).length;
  const out = [
    "",
    paint.dim("── transcript of ") + paint.id("`" + (opts.command || "") + "`") +
      paint.dim(" (exit " + opts.exitCode + ") · " + headerCount + " ──"),
    paint.dim("   Every line behind `" + TRANSCRIPT_GUTTER.trim() + "` is that command's output, not this " +
      reportName + "."),
  ];
  if (nested) {
    // The count is named, the MARK is not REPRINTED. A frame whose own header
    // carried the glyph would put an unguttered error mark inside the region it
    // exists to keep clean, and the sentence would be evidence against itself.
    out.push(paint.dim(
      "   " + nested + " of them " + (nested === 1 ? "is" : "are") + " " + N +
      " refusing inside that command, not a failure of this run."
    ));
  }
  for (const row of rows) out.push(paint.dim(TRANSCRIPT_GUTTER) + row);
  out.push(paint.dim("── end of transcript · " + footerCount + " ──"));
  return out.join("\n") + "\n";
}

// ──────────────────────────────────────────────────────────────────────────
// Running the contract
// ──────────────────────────────────────────────────────────────────────────

function runBash(command, cwd, capture, observeCoverage = false) {
  const started = Date.now();
  const env = { ...process.env };
  // A contract is a child process, not a subtest of the test that happens to
  // exercise `done`. Letting Node inherit this private runner marker makes
  // `node --test` silently skip the very proof the contract asked for.
  delete env.NODE_TEST_CONTEXT;
  const coverageDir = observeCoverage ? mkdtempSync(join(tmpdir(), "contract-coverage-")) : null;
  if (coverageDir) env.NODE_V8_COVERAGE = coverageDir;
  const r = spawnSync(command, {
    shell: posixShell(),
    cwd,
    encoding: "utf8",
    env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    // A whole test suite's transcript is captured here by default (TL-221);
    // Node's 1 MB default would turn a long green run into a spurious failure.
    maxBuffer: 64 * 1024 * 1024,
  });
  const executedFiles = coverageDir ? [...readCoverageFiles(coverageDir, cwd)].sort() : [];
  if (coverageDir) rmSync(coverageDir, { recursive: true, force: true });
  return {
    ok: r.status === 0,
    exitCode: r.status == null ? 1 : r.status,
    ms: Date.now() - started,
    output: capture ? (r.stdout || "") + (r.stderr || "") : null,
    coverageObserved: Boolean(coverageDir),
    executedFiles,
  };
}

/**
 * Run one shell command without blocking Node's signal handlers.
 *
 * On POSIX the shell leads a fresh process group, so an abort reaches the
 * command, its child and every grandchild with one signal. The forced follow-up
 * is deliberate: a descendant that catches SIGTERM must not outlive the audit
 * whose operator just stopped it.
 */
function runBashAsync(command, cwd, capture, observeCoverage = false, signal = null) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const coverageDir = observeCoverage ? mkdtempSync(join(tmpdir(), "contract-coverage-")) : null;
    if (coverageDir) env.NODE_V8_COVERAGE = coverageDir;

    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let overflow = false;
    let interrupted = Boolean(signal && signal.aborted);
    let settled = false;
    let forceTimer = null;
    let child = null;

    const finish = (status, error = null) => {
      if (settled) return;
      settled = true;
      if (forceTimer) clearTimeout(forceTimer);
      if (signal) signal.removeEventListener("abort", abort);
      // The shell can exit before a stubborn descendant. A final group kill
      // closes that race before the caller is told the process tree is gone.
      if (interrupted && child) stopProcessTree(child, "SIGKILL");
      const executedFiles = coverageDir ? [...readCoverageFiles(coverageDir, cwd)].sort() : [];
      if (coverageDir) rmSync(coverageDir, { recursive: true, force: true });
      resolve({
        ok: !interrupted && !overflow && !error && status === 0,
        exitCode: status == null ? 1 : status,
        ms: Date.now() - started,
        output: capture ? stdout + stderr : null,
        coverageObserved: Boolean(coverageDir),
        executedFiles,
        interrupted,
      });
    };

    const abort = () => {
      interrupted = true;
      if (!child) return;
      stopProcessTree(child, "SIGTERM");
      forceTimer = setTimeout(() => stopProcessTree(child, "SIGKILL"), 500);
      forceTimer.unref();
    };

    if (interrupted) return finish(null);
    child = spawn(command, {
      shell: posixShell(),
      cwd,
      env,
      detached: processTreeDetached(),
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    if (capture) {
      const collect = (key, chunk) => {
        const text = String(chunk);
        bytes += Buffer.byteLength(text);
        if (key === "stdout") stdout += text;
        else stderr += text;
        if (bytes > 64 * 1024 * 1024 && !overflow) {
          overflow = true;
          stopProcessTree(child, "SIGKILL");
        }
      };
      child.stdout.on("data", (chunk) => collect("stdout", chunk));
      child.stderr.on("data", (chunk) => collect("stderr", chunk));
    }
    child.once("error", (error) => finish(null, error));
    child.once("close", (status) => finish(status));
    if (signal) signal.addEventListener("abort", abort, { once: true });
    // The signal can arrive between the first check and listener registration.
    if (signal && signal.aborted) abort();
  });
}

/**
 * RUN A CONTRACT. One implementation, shared by the command that closes a task
 * and by the guard that re-runs a closed one (TL-147).
 *
 * WHY THE CALLBACKS RATHER THAN TWO LOOPS. The two callers differ in what they
 * SAY, not in what they do: `done` narrates each entry and asks a person to
 * vouch for a `manual:` one; `check --proofs` prints nothing and cannot ask
 * anybody anything. Two loops would be two answers to "did this contract pass",
 * which is the one question the guard exists to ask about the other's work.
 *
 * IT STOPS AT THE FIRST FAILURE, as `done` always has: the entries after it
 * would run against a tree the failure already describes, and the time is spent
 * for nothing.
 *
 * `manual` is asked for a decision and may return `null` for "cannot be
 * re-run", which is neither a pass nor a failure — a distinction the guard
 * needs, because a task proved only by a person is not broken and is not green
 * either.
 *
 * @param {Array<object>} entries parsed `verification:` entries
 * @param {string} cwd where the commands run — the repository root
 * @param {{capture?: boolean, manual?: function, before?: function, after?: function, signal?: AbortSignal}} opts
 * @returns {Promise<{results: Array<object>, failed: object|null, interrupted: boolean}>}
 */
export async function runContract(entries, cwd, opts = {}) {
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.manual) {
      const decision = opts.manual ? opts.manual(e, i) : { ok: null };
      const row = { id: e.id, kind: "manual", command: e.manual, ok: decision.ok, exitCode: null, ms: 0 };
      if (decision.vouchedBy) row.vouchedBy = decision.vouchedBy;
      if (decision.vouch) row.vouch = decision.vouch;
      results.push(row);
      if (decision.ok === false) return { results, failed: { entry: e, kind: "manual" } };
      continue;
    }
    if (opts.before) opts.before(e, i);
    const r = await runBashAsync(e.bash, cwd, opts.capture,
      Boolean(opts.observeCoverage && nodeTestFiles(e).length), opts.signal || null);
    const row = { id: e.id, kind: "bash", command: e.bash, ok: r.ok, exitCode: r.exitCode, ms: r.ms };
    // Coverage is private runner evidence. It feeds the compact capability
    // reading below rather than inflating `done --json` with every loaded file.
    if (opts.observeCoverage) {
      row.coverageObserved = r.coverageObserved;
      row.executedFiles = r.executedFiles;
    }
    results.push(row);
    if (r.interrupted) return { results, failed: null, interrupted: true };
    if (!r.ok) return { results, failed: { entry: e, kind: "bash", ...r } };
    if (opts.after) opts.after(e, r);
  }
  return { results, failed: null, interrupted: false };
}

/**
 * PROBE A CONTRACT: run every entry and report each one, stopping at nothing
 * (TL-268). `runContract` stops at the first failure because a closing is a
 * verdict and one red line decides it. A probe is the opposite question — what
 * is red NOW, before any work — and a hand about to start needs every line,
 * because the second failing entry is as much its target as the first.
 *
 * `manual` entries are not run and not judged: they ask a person, and a probe
 * has nobody to ask. They are listed so the hand knows the contract ends in a
 * signature it cannot produce.
 *
 * @param {Array<object>} entries parsed `verification:` entries
 * @param {string} cwd where the commands run — the repository root
 * @returns {{rows: Array<object>, ran: number, failed: number, allPassed: boolean}}
 */
export function probeContract(entries, cwd) {
  const rows = [];
  let ran = 0;
  let failed = 0;
  for (const e of entries || []) {
    if (e.manual) {
      rows.push({ id: e.id || null, kind: "manual", command: e.manual, ok: null, exitCode: null, ms: 0, output: null,
        ...(e.project ? { project: true } : {}) });
      continue;
    }
    const r = runBash(e.bash, cwd, true);
    ran++;
    if (!r.ok) failed++;
    const row = { id: e.id || null, kind: "bash", command: e.bash, ok: r.ok, exitCode: r.exitCode, ms: r.ms, output: r.output };
    if (e.project) row.project = true;
    rows.push(row);
  }
  return { rows, ran, failed, allPassed: ran > 0 && failed === 0 };
}

/**
 * Probe one task's contract as it stands on disk (TL-268). Reads the file,
 * parses `verification:`, runs the probe from the repository root — the same
 * root `done` would use. A task whose contract cannot be parsed is reported
 * with the problems and no rows, not thrown: the probe is advice, and a
 * handover must not fail because the advice could not be produced.
 *
 * @returns {{rows: Array<object>, ran: number, failed: number, allPassed: boolean, problems: string[]}}
 */
export function probeTask(root, taskFile, config) {
  const raw = readFileSync(taskFile, "utf8");
  const { frontmatter } = splitFrontmatter(raw);
  // THE CONTRACT `done` WILL RUN, not the task's half of it (TL-495): a probe
  // that leaves out the project's entries answers "is my module green" while
  // the closing asks "is the repository green", and the hand learns the
  // difference only when `done` refuses.
  const { entries, problems, collisions } = closingContractOf(frontmatter, config || loadConfig(root));
  if (problems.length) return { rows: [], ran: 0, failed: 0, allPassed: false, problems };
  // Refused before anything runs, as `done` refuses it: which of the two
  // entries a `[proof: id]` meant is the author's decision, not the probe's.
  if (collisions.length) {
    return { rows: [], ran: 0, failed: 0, allPassed: false,
      problems: collisions.map((id) => collisionHeadline("`id: " + id + "`")) };
  }
  const probe = probeContract(entries, repoRootFor(root));
  return { ...probe, problems: [] };
}

/** Read one line from the terminal. Returns null when there is no terminal.
 *
 *  It reads `/dev/tty`, not stdin: the command is meant to be usable in a pipe
 *  (`done X --json | jq`), and a prompt that consumed stdin would make
 *  the two mutually exclusive. */
function askLine(prompt) {
  if (!process.stdin.isTTY) return null;
  process.stdout.write(prompt);
  let fd;
  try {
    fd = openSync("/dev/tty", "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(256);
    let out = "";
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      out += buf.toString("utf8", 0, n);
      if (out.indexOf("\n") >= 0) break;
    }
    return out.split("\n")[0].trim();
  } finally {
    closeSync(fd);
  }
}

export function manualPrompt(entry, actor) {
  const lines = [];
  lines.push(WARNM + " no command can prove this one. A person has to vouch for it:");
  lines.push("    " + entry.manual);
  lines.push("");
  lines.push("  These are NOT evidence:");
  for (const n of NOT_EVIDENCE) lines.push("    · " + n);
  for (const l of IS_EVIDENCE) lines.push(l);
  lines.push("");
  lines.push("  Vouching is recorded in the history as " + actor + " and does not go away.");
  return lines.join("\n");
}

/**
 * Would this run ask a person to type `confirm` while nobody has said who that
 * person is? (TL-460)
 *
 * The fallback actor is `agent:claude`, and `scripts/actor.mjs` explains why
 * that is the right answer for an automated write. It is the wrong one for a
 * typed vouch: the prompt is reached only with a terminal attached, the entry
 * exists because a PERSON looked, and `agent:` is the namespace that means
 * automated and unverified. So the decision is made here, for this act alone —
 * the default and the resolution order stay what they are for every other
 * write.
 *
 * Only the TYPED path is judged. `--confirm-manual` is a stated act whoever
 * runs it, `--json` already refuses to ask, and with no terminal nobody is
 * asked, so in all three the record says what it always said.
 *
 * @returns {boolean} true when the run must stop before anything runs
 */
export function vouchNeedsStatedActor({ entries, source, confirmManual, json, terminal }) {
  if (source !== "default" || confirmManual || json || !terminal) return false;
  return (entries || []).some((e) => e.manual);
}

/** How to state an actor — the three sources above the fallback, by name. */
function statedActorOptions(env) {
  return [
    "  · `--actor user:<name>` on this command;",
    "  · `" + ACTOR_ENV + "=user:<name>` in this shell;",
    "  · `actor: user:<name>` in " + userConfigPath(env) + ", stated once and kept.",
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

/**
 * The status a closed task lands in.
 *
 * From `archived_statuses`, never from the literal "done": the vocabulary is
 * this project's (third law), and a backlog that calls it `shipped` must not
 * need a different tool. `--status` picks another archived one — closing a task
 * as `cancelled` is a real ending, and it is still an ending that has to be
 * spelled, not inferred from a mood.
 */
export function closingStatus(config, requested) {
  const archived = config.archivedStatuses || [];
  if (!archived.length) {
    throw new Error(
      "`archived_statuses` in config.yaml is empty — this backlog has no status that means\n" +
        "\"closed\", so there is nothing for `done` to set. Name one there first."
    );
  }
  if (!requested) return archived[0];
  if (archived.indexOf(requested) < 0) {
    throw new Error(
      "`--status " + requested + "` is not one of `archived_statuses` (" + archived.join(", ") + ").\n" +
        "`done` closes a task; moving it to an OPEN status is an edit, not a closure."
    );
  }
  return requested;
}

function log(json, text) {
  if (!json) console.log(text);
}

/**
 * A refusal, in both shapes at once.
 *
 * `--json` consumers need a machine-readable answer to "why not" just as much as
 * to "yes" — a refusal that prints only prose makes the flag useless for exactly
 * the case a script cares about. The human text still goes to stderr, so the two
 * outputs never fight over stdout.
 */
function refuse(plan, headline, details, results, reason) {
  console.error(failure(N + " done", headline, details));
  if (plan.json) {
    printJson("verification-run", {
      task: plan.id, ok: false, closed: false, dryRun: plan.dryRun,
      refusalKind: reason, refusal: headline, details: details || [],
      entries: results || [],
    });
  }
  return 1;
}

/**
 * @param {string[]} argv
 * @param {{env?: object, terminal?: boolean, ask?: (prompt: string) => string | null}} io
 *        injected so a test can stand in for a person at a terminal without
 *        one, and never resolves the actor of the session running it.
 */
async function run(argv, io = {}) {
  const env = io.env || process.env;
  const terminal = io.terminal === undefined ? !!process.stdin.isTTY : io.terminal;
  const ask = io.ask || askLine;
  let plan;
  try {
    plan = parseDoneArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " done", head, rest, [N + " done --help"]));
    return 2;
  }

  const root = resolveBacklogDirOrExit({ dir: plan.dir || undefined, moduleDir: __dirname }, N + " done").root;
  const config = loadConfigOrExit(root);
  const tasksDir = backlogPaths(root).tasksDir;

  // A role outside the project's vocabulary is a bad ARGUMENT, wrong whatever
  // this task says — the same judgement `take` makes, and it fails here with the
  // other usage errors rather than as a refusal about this particular closure.
  if (plan.role !== null && (config.roles || []).indexOf(plan.role) < 0) {
    console.error(failure(N + " done", "unknown role `" + plan.role + "`",
      (config.roles || []).length
        ? ["`roles` in config.yaml holds: " + (config.roles || []).join(", ")]
        : ["This backlog declares no `roles:` in config.yaml, so no task asks for one."],
      [N + " done --help"]));
    return 2;
  }
  const { actor, source: actorSource } = resolveActorSource(plan.actor, { env });
  if (!isValidActor(actor)) {
    console.error(
      failure(N + " done", "the actor `" + actor + "` has no valid namespace", [
        "use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
        "the namespace says how much a vouching is worth, and vouching is the only",
        "thing `manual:` can offer instead of a command.",
      ])
    );
    return 2;
  }

  let status;
  try {
    status = closingStatus(config, plan.status);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " done", head, rest));
    return 2;
  }

  // The reason is settled BEFORE anything runs (TL-105). A contract that passes
  // and then stops on a missing sentence would have spent the whole run to reach
  // a usage error.
  //
  // WHY THE DEFAULT CLOSING STATUS IS EXEMPT. `done` reaches it by RUNNING the
  // verification and refusing on the first failure, so the why of that transition
  // is a recorded run — kept as `proven`, next to the `__verified__` entries from
  // the same act. Any OTHER archived status is a decision the run does not make:
  // a passing contract says nothing about why a task is being abandoned.
  const provenStatus = (config.archivedStatuses || [])[0];
  const statedReason = plan.reason;
  if (!statedReason && status !== provenStatus && requiresReason(config, { field: "status", to: status })) {
    return refuse(
      plan,
      "closing to `" + status + "` needs `--reason \"…\"`",
      [
        "`reason_required_statuses` in config.yaml names it: " +
          (config.reasonRequiredStatuses || []).join(", ") + ".",
        "",
        "`" + provenStatus + "` is exempt because the verification run proves it. `" + status + "` is not",
        "reached by proving anything — the run says the contract holds, not why the task",
        "is being closed this way, and that why is what nobody can reconstruct later.",
      ],
      [],
      "reason-required"
    );
  }

  const file = findTaskFile(tasksDir, config, plan.id);
  if (!file) return refuse(plan, "there is no task " + plan.id + " in " + tasksDir, [], [], "no-such-task");

  const raw = readFileSync(file, "utf8");
  const { frontmatter, body } = splitFrontmatter(raw);
  const before = extractMeta(frontmatter);

  if ((config.archivedStatuses || []).indexOf(before.status) >= 0 && !plan.dryRun) {
    return refuse(plan, plan.id + " is already closed (`status: " + before.status + "`)", [
      "Nothing was run. Re-running a contract against a tree that has moved on",
      "would answer a different question than the one that closed this task.",
    ], [], "already-closed");
  }

  // A dry run is the one exception: it promises to run the whole contract and
  // leave no trace. That makes it the callable, side-effect-free way for the
  // context budget to price a green closing without changing a closed task.
  // An actual `done` keeps refusing here — a moved tree must not be closed a
  // second time merely because its old contract still happens to pass.

  const closingContract = closingContractOf(frontmatter, config);
  let { own: entries, problems } = closingContract;
  const contract = contractProblem(entries, problems);
  if (contract) {
    // TWO DEFECTS, TWO DIAGNOSES (TL-173). "has no closing contract" is the
    // message for a task nobody finished WRITING, and the guide it points at
    // says to go and write one. A contract that exists and is four entries long
    // but holds one line the parser cannot read sent the reader to that repair,
    // where they would rewrite something already correct. The headline and the
    // `refusalKind` both split, because the machine-readable cause is the half a
    // report is built from and conflating it there is the same wrong answer.
    if (problems.length) {
      return refuse(plan, plan.id + ": a line of the closing contract cannot be read",
        contract.split("\n").concat([
          "",
          "The contract is there — this is one line of it, not the whole thing. Fix the",
          "line above; nothing was run and the file is untouched.",
        ]), [], "unreadable-contract");
    }
    return refuse(plan, plan.id + " has no closing contract", contract.split("\n"), [], "no-contract");
  }

  // AFTER the task's own contract is judged, never in place of it: a task with
  // no `verification:` is still a task nobody finished writing, however many
  // project entries would run for it.
  if (closingContract.collisions.length) {
    return refuse(plan, collisionHeadline(plan.id),
      closingContract.collisions.map((id) => "`id: " + id + "`").concat([
        "",
        "A proof id names ONE entry, and a criterion pointing at it would be ambiguous.",
        "Rename the task's entry; nothing was run and the file is untouched.",
      ]), [], "closing-contract-collision");
  }
  entries = closingContract.entries;

  const cwd = repoRootFor(root);
  const missingTest = missingNodeTestFile(entries, cwd);
  if (missingTest) {
    return refuse(
      plan,
      plan.id + ": a `node --test` file in the closing contract does not exist",
      [
        "`" + missingTest.path + "`",
        "",
        "Create the named file or correct the contract. Nothing was run and the task file was untouched.",
        "This check covers literal repository-relative `.js`, `.cjs` and `.mjs` paths after",
        "`node --test`; it does not guess at globs, variables or other shell expansions.",
      ],
      [],
      "missing-test-file"
    );
  }

  // A BROKEN criterion link fails before anything runs: it can only have been
  // written by somebody already using the mechanism, so it is a mistake to fix,
  // not a legacy task to be lenient with (TL-86).
  const audit = auditTask({ frontmatter, body, policy: config.criteriaLinks });
  if (audit.errors.length) {
    return refuse(
      plan,
      plan.id + ": the acceptance criteria and the verification do not agree",
      audit.errors.concat([
        "",
        "Nothing was run. Under `criteria_links: " + config.criteriaLinks + "` this is a refusal",
        "BEFORE the contract, not after it — running commands to then reject the result",
        "would spend the time and answer nothing.",
      ]),
      [],
      "criteria"
    );
  }

  // BEFORE the contract runs, and before anything is written (TL-460). Asking at
  // the `manual:` entry itself would spend the whole run first, and stopping
  // there leaves the `__unverified__` record of TL-170 — signed by the very
  // fallback this refusal exists to keep off a person's act. Nobody was asked
  // here, so there is no refusal of a vouch to record.
  if (vouchNeedsStatedActor({ entries, source: actorSource, confirmManual: plan.confirmManual, json: plan.json, terminal })) {
    return refuse(
      plan,
      plan.id + ": a `manual:` entry is vouched for by a person, and nobody said who",
      [
        "With no actor stated the vouch would be recorded as " + actor + " — the namespace",
        "for an automated, unverified write, which is the opposite of what typing `" + CONFIRM_WORD + "`",
        "means. Nothing was run and nothing was written. State who you are:",
      ].concat(statedActorOptions(env)),
      [],
      "unstated-actor"
    );
  }

  log(plan.json, "");
  log(plan.json, "  " + plan.id + " — " + entries.length + " verification entr" +
    (entries.length === 1 ? "y" : "ies") + ", run in " + cwd);
  log(plan.json, "");

  // ONE runner, shared with `check --proofs` (TL-147). What differs between the
  // two callers is the narration and the question put to a person, so those are
  // the callbacks; the loop, the order and the stop-at-first-failure are not
  // this command's private behaviour any more.
  //
  // A PASSING ENTRY'S TRANSCRIPT IS NOT PRINTED (TL-221). The answer `done` owes
  // is a verdict per entry; the stdout of a command that passed is evidence
  // nobody reads, and on this repository it ran to 1698 lines of `✔` before the
  // two lines that mattered — paid for by every session that closes a task. So
  // the output is captured, its size is reported in the verdict line, and the
  // FAILING entry's output is written out whole: the refusal is the one place
  // the transcript is the answer. `--verbose` streams everything as it runs,
  // for the person watching a slow contract who wants to see it move.
  const capture = plan.json || !plan.verbose;
  // A project entry is named as one, so a red line nobody wrote into the task
  // file is not hunted for there.
  const tagOf = (e, i) => "  " + (i + 1) + "/" + entries.length + "  " +
    (e.project ? "closing_contract  " : "") + (e.id ? e.id + "  " : "");
  let stop = null;
  const { results, failed } = await runContract(entries, cwd, {
    capture,
    observeCoverage: true,
    before: (e, i) => log(plan.json, tagOf(e, i) + "bash: " + e.bash),
    after: (e, r) => {
      log(plan.json, "  " + OKM + " passed (" + r.ms + " ms" + suppressedNote(r.output) + ")");
      log(plan.json, "");
    },
    manual: (e, i) => {
      // The text is printed BEFORE anything is asked, and the entry is named as
      // manual, so nobody confirms a sentence they have not read.
      log(plan.json, tagOf(e, i) + "manual");
      log(plan.json, manualPrompt(e, actor));
      let confirmed = plan.confirmManual;
      if (!confirmed && plan.json) {
        // Asking a person for consent while the output is being parsed by a
        // program is incoherent, and the prompt would land in the middle of the
        // JSON besides. `--json` has to say so rather than produce broken output.
        stop = {
          kind: "manual-needs-person",
          refusal: "json",
          manual: e.manual,
          headline: plan.id + ": `--json` cannot ask a person to vouch for a `manual:` entry",
          details: [
            "  " + e.manual,
            "",
            "Run it without `--json` and type `" + CONFIRM_WORD + "`, or pass `--confirm-manual`",
            "if you are vouching for it yourself.",
          ],
          refuse: true,
        };
        return { ok: false };
      }
      if (!confirmed) {
        const answer = ask("  type `" + CONFIRM_WORD + "` to vouch, anything else to stop: ");
        confirmed = answer === CONFIRM_WORD;
        if (answer === null) {
          stop = {
            refusal: "no-terminal",
            manual: e.manual,
            headline: plan.id + ": a `manual:` entry needs a person, and there is no terminal here",
            details: [
              "Nothing was changed. Two ways on:",
              "  · run it in a terminal and type `" + CONFIRM_WORD + "` when asked;",
              "  · or pass `--confirm-manual`, which vouches for EVERY manual entry at once",
              "    and records " + actor + " as the one who did.",
            ],
          };
          return { ok: false };
        }
      }
      if (!confirmed) {
        stop = {
          refusal: "declined",
          manual: e.manual,
          headline: plan.id + ": not vouched for — the task file was not touched",
          details: [],
        };
        return { ok: false, vouchedBy: actor };
      }
      log(plan.json, "  " + OKM + " vouched for by " + actor);
      log(plan.json, "");
      // WHICH path vouched, not merely that one did (TL-171). `--confirm-manual`
      // answers every manual entry in the contract at once and a typed word
      // answers this one; both are legitimate, and a table that could not tell
      // them apart would be reporting the guarantee and the ritual as one
      // number.
      return { ok: true, vouchedBy: actor, vouch: plan.confirmManual ? "flag" : "typed" };
    },
  });

  // THE REFUSAL LEAVES A TRACE (TL-170). Everything below this point used to
  // return without a single write, and two of the messages say so out loud —
  // which made the promise true about the task FILE and false about the fact:
  // "every automatic entry passed, one human vouch is missing" existed only in
  // the terminal that printed it and died with that session. What the next
  // reader found instead was a task in progress, indistinguishable from one
  // somebody walked away from.
  //
  // The task file is still not touched. The reason travels with a write to the
  // LOG, which is where this project says a reason travels.
  //
  // NOT UNDER `--dry-run`. That flag promises the whole contract runs and
  // nothing changes, and a history entry is a change. A rehearsal that annotated
  // the task would make the honest move — checking yourself before announcing
  // you are finished — the one that leaves marks.
  if (stop && !plan.dryRun) {
    const ran = results.filter((r) => r.kind === "bash");
    const notRun = entries.length - results.length;
    const ts = new Date().toISOString();
    appendEntries(root, before.id, [{
      id: eventId(ts), ts, task: before.id, field: FIELD_UNVERIFIED,
      from: "", to: stop.manual || "", actor, source: "done",
      refusal: stop.refusal,
      // Counted, not asserted: a `manual:` entry can stand anywhere in a
      // contract, so "everything else passed" is only true when nothing was
      // left unrun. Saying it unconditionally would be the same class of claim
      // this whole gate exists to refuse.
      reason: "stopped at a `manual:` entry (" + stop.refusal + "); " +
        ran.length + " automatic entr" + (ran.length === 1 ? "y" : "ies") + " passed" +
        (notRun > 0 ? ", " + notRun + " not run" : ", none left to run"),
      session: currentSession(root),
    }]);
  }

  if (stop && stop.refuse) return refuse(plan, stop.headline, stop.details, results, stop.kind);
  if (stop) {
    console.error("");
    console.error(failure(N + " done", stop.headline, stop.details));
    return finishFailed(plan, results, 1);
  }
  if (failed) {
    // Captured output is the failing entry's whole transcript, and it goes to
    // stderr before the refusal so the last screen a reader sees is the verdict.
    // FRAMED, not pasted (TL-275): unframed, its lines are indistinguishable
    // from the refusal's own, and this tool's `✗` captured from a nested run
    // reads as a failure of the repository being closed.
    if (failed.output) {
      process.stderr.write(transcriptBlock(failed.output, {
        command: failed.entry.bash,
        exitCode: failed.exitCode,
      }));
    }
    console.error("");
    console.error(
      failure(N + " done", plan.id + ": verification failed (exit " + failed.exitCode + ")", [
        "`" + failed.entry.bash + "`",
        "",
        "The task file was NOT touched — its status is still `" + before.status + "`.",
      ])
    );
    return finishFailed(plan, results, 1);
  }

  const modified = taskModifiedFiles({ root: cwd, prefix: config.taskIdPrefix, taskId: before.id });
  const capability = modified.scanned
    ? contractCapability(results, modified.files)
    : contractCapability(results.map((r) => ({ ...r, coverageObserved: false })), []);

  if (config.contractCapability === "require" && capability.verdict !== CAPABLE) {
    return refuse(
      plan,
      plan.id + ": the closing contract did not execute a file this task changed",
      [
        capability.statement + ".",
        "",
        "`contract_capability: require` makes this project's opt-in policy a closing gate.",
        "The verification commands passed, but the task file was NOT touched.",
      ],
      results,
      "contract-capability"
    );
  }

  // Every entry is green. Tick what that proves, then refuse if anything is left
  // unproved — a task closed with a dead checkbox is the defect measured in
  // TL-86 (12 of 44 closed tasks, 60 dead checkboxes).
  const passed = results.filter((r) => r.ok && r.id).map((r) => r.id);
  const proofed = applyProofs(raw, passed);
  const remaining = parseCriteria(splitFrontmatter(proofed.text).body).items.filter((c) => !c.checked);

  // Under `require` a criterion naming no proof was already refused ABOVE, before
  // anything ran. What is left here is the other half: a criterion that names
  // proofs which ALL passed and is still unticked. That cannot happen while the
  // runner and `applyProofs` agree about what passed — which is exactly why it is
  // checked. A gate that trusts its own bookkeeping is a gate with a blind spot.
  const inconsistent = remaining.filter((c) => c.proofs.length && c.proofs.every((pid) => passed.indexOf(pid) >= 0));
  if (inconsistent.length) {
    return refuse(
      plan,
      plan.id + ": a criterion whose every proof passed was not ticked",
      inconsistent.map((c) => "  · " + c.text).concat([
        "",
        "This is a defect in the tool, not in the task: the run and the ticking disagree.",
        "The task file was NOT touched.",
      ]),
      results,
      "internal"
    );
  }
  if (remaining.length) {
    log(plan.json, "  " + WARNM + " " + remaining.length + " criteri" +
      (remaining.length === 1 ? "on names" : "a name") + " no proof — closed anyway (criteria_links: " +
      config.criteriaLinks + ")");
  }

  if (plan.dryRun) {
    log(plan.json, "");
    log(plan.json, "  " + OKM + " the whole contract passed. `--dry-run`: nothing was changed.");
    log(plan.json, "    would set: status " + before.status + " → " + status);
    log(plan.json, "    would tick: " + (proofed.ticked.length || "no") + " criteri" +
      (proofed.ticked.length === 1 ? "on" : "a"));
    log(plan.json, "    contract capability: " + capability.statement);
    if (plan.json) answer(plan, results, {
      status: before.status, wouldBe: status, ticked: proofed.ticked, closed: false, capability,
    });
    return 0;
  }

  // The frontmatter is written through `task-fields.mjs`, the same door `take`
  // uses, and NOT with a regex over the whole file. Two behaviours are the
  // reason, both observed: `^status: .*$` erases a trailing comment the reader
  // put beside the value (TL-70 says a comment is a comment in every reader),
  // and on a task whose frontmatter lacks the field the replacement matches
  // nothing and silently writes nothing — a closed task with no `updated:` and
  // an exit code of 0. The setter edits inside the frontmatter, keeps the
  // comment and INSERTS a missing field in its ordered place.
  const day = todayStamp();
  const specs = buildFieldSpecs(config);
  let text = proofed.text;
  try {
    text = setFrontmatterField(text, "status", status, fieldSpec("status", specs));
    text = setFrontmatterField(text, "updated", day);
  } catch (e) {
    return refuse(
      plan,
      plan.id + ": the whole contract passed, but the task file could not be written",
      [e.message, "", "The task file was NOT touched — its status is still `" + before.status + "`."],
      results,
      "unwritable"
    );
  }
  writeFileSync(file, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  try { recordEdit(root, {
    taskId: before.id, before, after, actor, source: "done",
    // Which hand closed it, when the closer said (TL-222). A run serving several
    // roles from one queue passes the role it dispatched on, so the closing entry
    // names the stage rather than leaving it to be guessed from the actor.
    role: plan.role,
    reason: statedReason || REASON_PROVEN,
    contractCapability: capability,
  }); } catch (error) {
    // A closed file without its append-only explanation is a false close. The
    // history route can fail (for example a local state directory is unwritable)
    // after the task write, so restore the exact pre-contract text before returning.
    writeFileSync(file, raw, "utf8");
    return refuse(plan, plan.id + ": history could not be recorded; the task was restored", [error.message], results, "history-unwritable");
  }

  // The vouching is an EVENT, not a field change, so it does not come out of
  // diffMeta and has to be written on purpose. Without it a `manual:` entry would
  // leave no trace of who stood behind it, which is the only thing it has to
  // offer instead of a command.
  const vouched = results.filter((r) => r.kind === "manual" && r.ok);
  if (vouched.length) {
    const ts = new Date().toISOString();
    appendEntries(root, before.id, vouched.map((v) => ({
      id: eventId(ts), ts, task: before.id, field: FIELD_VERIFIED,
      from: "", to: v.command, actor, source: "done", vouch: v.vouch,
      reason: statedReason || REASON_PROVEN,
      session: currentSession(root),
    })));
  }

  log(plan.json, "");
  log(plan.json, "  " + OKM + " " + plan.id + " closed — status " + before.status + " → " + status);
  log(plan.json, "    contract capability: " + capability.statement);
  if (proofed.ticked.length) {
    log(plan.json, "    ticked " + proofed.ticked.length + " criteri" + (proofed.ticked.length === 1 ? "on" : "a") + " from the run");
  }

  // The reservation `take` made is over: the task is closed, so holding it would
  // only make the state directory grow. Best effort — the lock has a TTL, and a
  // failure here must not turn a finished piece of work into an error.
  releaseLock({ root, taskId: before.id, actor });

  const build = spawnSync(process.execPath, [join(__dirname, "build-backlog.mjs"), "--dir", root], {
    encoding: "utf8",
  });
  if (build.status !== 0) {
    console.error(WARNM + " the views were not rebuilt — run `" + N + " build` yourself");
  }

  if (plan.json) answer(plan, results, { status, ticked: proofed.ticked, closed: true, capability });
  return 0;
}

// A prose line summarising the run USED to be appended to a `## Log` section
// here (TL-105). It is gone, and not because it was wrong: it was a SECOND
// copy of what the history already held, kept by hand in a file, and a second
// copy is the thing this tool refuses everywhere else. The run now leaves its
// record in one place — the history entries written just above, carrying the
// reason, the actor and the vouched-for `manual:` entries.
//
// Sections that already exist in older task files are left alone. They hold
// sentences nobody can reconstruct, and deleting a person's writing to tidy up a
// convention would cost more than the tidiness is worth.

/** The answer, in the envelope every other command uses (TL-119). The kind is
 *  `verification-run` and not `task-done`, because what a consumer reads here is
 *  the EVIDENCE — `--dry-run` produces the same payload with `closed: false`. */
function answer(plan, results, extra) {
  printJson("verification-run", {
    task: plan.id,
    ok: results.every((r) => r.ok),
    dryRun: plan.dryRun,
    entries: results.map(({ coverageObserved, executedFiles, ...entry }) => entry),
    ...extra,
  });
}

function finishFailed(plan, results, code) {
  if (plan.json) answer(plan, results, { closed: false });
  return code;
}

if (process.argv[1] && process.argv[1].endsWith("done-task.mjs")) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

export { run };
