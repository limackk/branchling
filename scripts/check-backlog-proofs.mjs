#!/usr/bin/env node
/**
 * Guard: a closed task's proof still holds against the CURRENT tree (TL-147).
 *
 * WHAT IT ADDS TO `done`. `done` proves a task once, against the tree of that
 * moment, and writes `proven` beside the closing. The tree then keeps moving and
 * nothing asks the question again — so a regression surfaces as "test X is red",
 * with no thesis, no context and nobody's name on it. Re-run from here it
 * surfaces as "the proof of PROJ-73 stopped holding", and that task's file
 * already carries why the work was done, what it decided, who closed it and
 * under which run.
 *
 * WHICH CLOSINGS QUALIFY, and why the line is drawn there. Only a closing whose
 * history carries the reserved `proven` reason — that is, one this tool ran a
 * contract for. A task closed by a hand edit was never proven, so reporting it
 * here would claim a proof broke that never existed. That is a different
 * finding, and it belongs to the guard that looks for hand edits, not to this
 * one: two guards claiming the same task say one problem twice.
 *
 * A `manual:` ENTRY IS VOUCHED, NOT BROKEN. It cannot be re-run — a person
 * stated they had seen something — so it is reported as vouched and counts as
 * neither. Passing over it in silence would make a task proved only by a person
 * look permanently green, which is the one reading that is certainly wrong.
 *
 * NO NEW STATE (law 2). Everything here is computed from the archive and the
 * history at read time. A broken proof is a finding for a person, not a
 * reopening: nothing is written, no status moves, and the answer is a report.
 *
 * COST IS THE REASON `--since` EXISTS. Contracts run test suites and the archive
 * only grows. `--since <sha>` keeps the tasks whose own modified files (TL-75)
 * or whose contract commands name a path the range touched, and SAYS what it
 * narrowed and by what rule — a narrowing nobody can see is a narrowing nobody
 * can trust.
 *
 * THE DEFAULT SCOPE STAYS UNNARROWED, AND THE COST IS MADE VISIBLE INSTEAD
 * (TL-265). Defaulting to a range would make a green report mean "the proofs
 * this range touches still hold" while it READS as "the proofs still hold", and
 * the reader has no way to tell the two apart — the same objection that makes
 * `--since` announce what it narrowed. Refusing above some number of closings
 * was rejected for a second reason as well: the threshold would be a number in
 * the code, which is where this project's third law says the vocabulary of a
 * particular backlog must not live. So the whole archive remains the default,
 * and what changes is that the run SAYS what it is about to cost before the
 * first command, says where it has got to as it goes, and stops on one signal.
 *
 * WHAT IT PRINTS WHILE IT RUNS goes to stderr, because stdout carries the
 * report. `--quiet` suppresses it, and `check --json` passes it: there the
 * guard's output is captured into a document, and a commentary meant for a
 * waiting operator has no reader inside it.
 *
 * Usage:
 *   node scripts/check-backlog-proofs.mjs [--dir <backlog>] [--since <sha>] [--quiet]
 *
 * Exit 0 = every proof still holds (and it says how many it ran).
 * Exit 1 = at least one proof no longer holds.
 * Exit 130 = interrupted; it says how far it got and proved nothing beyond that.
 *
 * Tests: `node --test scripts/tests/proofs.test.mjs`,
 *        `node --test scripts/tests/proofs-progress.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { parseVerification } from "./criteria.mjs";
import { REASON_PROVEN, readHistory } from "./history.mjs";
import { modifiedFiles } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { splitFrontmatter } from "./task-fields.mjs";
import { MARK, color, errColor } from "./ui.mjs";
import { repoRootFor, runContract } from "./done-task.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The closing this tool PROVED, or null. PURE.
 *
 * The last one wins: a task closed, reopened and closed again was proved by the
 * run that closed it last, and the earlier run described a tree two changes ago.
 */
export function provenClosing(entries, archivedStatuses) {
  const archived = new Set(archivedStatuses || []);
  let found = null;
  for (const e of entries || []) {
    if (!e || e.field !== "status") continue;
    if (!archived.has(e.to)) { found = null; continue; }
    found = e.reason === REASON_PROVEN ? { actor: e.actor || "", ts: e.ts || "", status: e.to } : null;
  }
  return found;
}

/** The paths a commit range touched, or null when the range cannot be read. */
function changedPaths(repoRoot, since) {
  const r = spawnSync("git", ["-C", repoRoot, "diff", "--name-only", since + "..HEAD"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return new Set(String(r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean));
}

/**
 * Does this task's proof have anything to do with the range? PURE.
 *
 * Two ways in, both stated rather than guessed: a file the task itself touched
 * (which is what `modified_files` knows), or a path named literally in one of
 * its contract commands. Everything else is left out, and the caller reports the
 * count so that nobody mistakes a narrowed run for a complete one.
 */
export function touchedByRange(task, entries, changed, touchedFiles) {
  for (const f of touchedFiles || []) if (changed.has(f)) return true;
  for (const e of entries || []) {
    const text = String(e.bash || "");
    for (const path of changed) if (path && text.indexOf(path) >= 0) return true;
  }
  return false;
}

async function main(argv) {
  const { dir, argv: afterDir } = takeDirFlag(argv);
  let since = null;
  let quiet = false;
  const rest = [];
  for (let i = 0; i < afterDir.length; i++) {
    if (afterDir[i] === "--since") { since = afterDir[++i] || null; continue; }
    if (afterDir[i] === "--quiet") { quiet = true; continue; }
    rest.push(afterDir[i]);
  }
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-proofs.mjs [--dir <backlog>] [--since <sha>] [--quiet]");
    return 2;
  }
  if (since === null && afterDir.includes("--since")) {
    console.error(`${N} check: --since needs a commit`);
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);
  const repoRoot = repoRootFor(root);
  const records = readTaskRecords(paths.tasksDir, config.taskId.file);

  const candidates = [];
  for (const t of records) {
    if ((config.archivedStatuses || []).indexOf(t.status) < 0) continue;
    const closing = provenClosing(readHistory(root, t.id), config.archivedStatuses);
    if (!closing) continue;
    const raw = readFileSync(paths.tasksDir + "/" + String(t.file).replace(/^tasks\//, ""), "utf8");
    const { entries } = parseVerification(splitFrontmatter(raw).frontmatter);
    if (!entries.length) continue;
    candidates.push({ id: t.id, file: t.file, closing, entries });
  }

  let selected = candidates;
  let narrowedNote = null;
  if (since) {
    const changed = changedPaths(repoRoot, since);
    if (changed === null) {
      console.error(`${ERRM} proofs: cannot read the range \`${since}..HEAD\` — nothing was run`);
      return 2;
    }
    const index = modifiedFiles({ root: repoRoot, prefix: config.taskIdPrefix });
    selected = candidates.filter((c) =>
      touchedByRange(c, c.entries, changed, (index.byTask && index.byTask.get(c.id)) || []));
    narrowedNote =
      `narrowed to ${selected.length} of ${candidates.length} by ${since}..HEAD ` +
      "— a task is kept when the range touched a file it changed, or a path its contract names";
  }

  // PROGRESS GOES TO STDERR (TL-265). stdout carries the report, and a consumer
  // reading it must not have to sift a running commentary out of the verdict.
  const progress = quiet ? null : (text) => process.stderr.write(text + "\n");

  // ONE INTERRUPT ENDS THE AUDIT (TL-265). Without a handler the audit died on
  // the first signal and left the contract it had in flight — a whole `node
  // --test` run spawning into temporary trees — with no parent to stop it, so
  // stopping the command took three kills and the tree went on growing between
  // them. The handler records the signal and the loop stops at the next
  // boundary; the command already running is allowed to FINISH, because
  // `runContract` is synchronous and a process that has no way to interrupt its
  // child has no way to clean up after killing itself either. Finishing is what
  // buys the guarantee: when this returns, nothing of its own is left running.
  let stopped = null;
  const onSignal = (sig) => { stopped = sig; };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const commandsTotal = selected.reduce((n, c) => n + c.entries.length, 0);
  if (progress) {
    // THE COST, BEFORE THE FIRST COMMAND. Each of these is somebody's contract
    // and some of them are whole test suites; an operator who learns the size
    // of the run at minute 68 learns it too late to decide anything.
    progress(
      `${MARK.bullet} proofs: re-running ${commandsTotal} verification command(s) from ` +
        `${selected.length} proven closing(s)`
    );
    progress(`  in ${repoRoot} — narrow the run with \`--since <sha>\`, stop it with one interrupt`);
  }

  const started = Date.now();
  const broken = [];
  const vouched = [];
  let ran = 0;
  let walked = 0;
  let commandsLeft = commandsTotal;
  for (const c of selected) {
    // A TURN OF THE EVENT LOOP IS WHAT MAKES THE SIGNAL ARRIVE. `runContract` is
    // synchronous, so a handler registered above cannot run while a contract is
    // in flight and a wholly synchronous walk would deliver every queued signal
    // only after the last one had finished — that is, exactly as if there were
    // no handler at all. Yielding here is what turns "stops eventually" into
    // "stops at the next boundary".
    await new Promise((resolve) => setImmediate(resolve));
    if (stopped) break;
    walked++;
    if (progress) {
      progress(
        `  [${walked}/${selected.length}] ${c.id}: ${c.entries.length} entr(ies), ` +
          `${commandsLeft} command(s) left`
      );
    }
    const { results, failed } = runContract(c.entries, repoRoot, {
      capture: true,
      // Named BEFORE it runs, not after: the line an operator needs while the
      // command hangs is the one that says which command is hanging.
      before: progress ? (e) => progress(`      ${MARK.arrow} ${e.bash}`) : undefined,
      after: progress ? (e, r) => progress(`      ${MARK.ok} ${(r.ms / 1000).toFixed(1)}s`) : undefined,
    });
    commandsLeft -= c.entries.length;
    for (const r of results) {
      if (r.kind === "manual") vouched.push({ id: c.id, entry: r.id || r.command });
      else ran++;
    }
    if (failed) broken.push({ ...c, failed });
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

  if (stopped) {
    console.error(
      `${WARNM} proofs: stopped by ${stopped} after ${walked} of ${selected.length} proven closing(s) ` +
        "— the command in flight was allowed to finish, so nothing was left running"
    );
  }

  const lines = [];
  if (narrowedNote) lines.push("  " + narrowedNote);
  if (vouched.length) {
    lines.push(
      `  ${WARNM} ${vouched.length} manual entr(ies) were vouched for by a person and cannot be re-run`
    );
    for (const v of vouched) lines.push(`    ${MARK.bullet} ${v.id}: ${v.entry}`);
  }

  if (!broken.length) {
    console.log(
      `${OKM} proofs: ${ran} verification command(s) re-run across ${selected.length} proven closing(s), ` +
        `each still passing (${seconds}s)`
    );
    for (const l of lines) console.log(l);
    // An interrupted run proved nothing about what it never reached, so it must
    // not exit 0 — that is the code a complete green run owns.
    return stopped ? 130 : 0;
  }

  console.error(`${ERRM} proofs: ${broken.length} closed task(s) whose proof no longer holds`);
  for (const b of broken) {
    const range = b.closing.ts ? " closed " + b.closing.ts : "";
    console.error(
      `  - ${b.id} by ${b.closing.actor || "(nobody named)"}${range}: ` +
        `\`${b.failed.entry.bash || b.failed.entry.manual}\` exits ${b.failed.exitCode}`
    );
    console.error(`    ${b.file}`);
  }
  for (const l of lines) console.error(l);
  console.error("");
  console.error("Nothing was changed and no task was reopened: a broken proof is a finding for a");
  console.error("person. The task file says why the work was done and what it decided — start there,");
  console.error("and use the range since the closing to find what moved:");
  for (const b of broken) {
    console.error(`  git log --oneline --since='${(b.closing.ts || "").slice(0, 10)}'`);
    break;
  }
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-proofs.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { main };
