#!/usr/bin/env node
/**
 * Guard: does the history log actually REACH git? (TL-43)
 *
 * THE DEFECT, MEASURED. On 2026-08-31 in a consumer repository, 28 of 71
 * history logs were untracked while the task files beside them were committed.
 * The cause is procedural rather than technical: the rule "`git add` with
 * enumerated paths" is deliberate and sound — it stops a session sweeping up
 * somebody else's work in flight — and its cost is that the `.md` gets added
 * because a person is thinking about it, while the `.jsonl` beside it does not,
 * because no person ever created it.
 *
 * WHY THAT MATTERS AFTER TL-39 CLOSED THE SYMPTOM. The `.md` travels with the
 * branch; the `.jsonl` only travels if somebody added it. A second tree that
 * sees a task with no history honestly takes it for new — that is how the third
 * duplicate happened, AFTER the fix for the first two. TL-39 added a read-time
 * dedup, so nothing is lost any more; what remains is that attribution is
 * reconstructed after the fact, and any metric computed in a tree without the
 * log is computed from incomplete data and cannot tell.
 *
 * THE FAILURE CONDITION IS THE ASYMMETRY, NOT THE ABSENCE, and that decides the
 * question step 4 of the task poses. "This log is untracked" is not by itself a
 * defect: a backlog nobody has committed yet has no tracked anything, and a
 * guard failing there would make `check` red on a fresh `init` — the worst
 * possible first minute. What IS a defect is a log untracked while its own task
 * file is tracked, because that pair can only mean the log was left behind. With
 * the rule stated that way the guard is safe in the default run, which is where
 * a guard has to be: one wired to nothing passes every test of its own.
 *
 * NO GIT IS AN ANSWER, NOT A PASS. `--dir` may point at a directory outside any
 * repository, and this guard has nothing to say there. It says exactly that,
 * out loud — a green tick would be a claim that the logs are safely versioned,
 * made by a run that never looked.
 *
 * AN ORPHANED LOG IS A DIFFERENT DEFECT AND IS COUNTED APART. A
 * `history/<ID>.jsonl` with no `tasks/<ID>-*.md` beside it usually means the
 * task lives on another branch, which is the whole point of data travelling
 * with branches — so it REPORTS and does not fail. Rolled together with the
 * untracked ones it would hide both: one is somebody's missing commit, the
 * other is somebody's other branch.
 *
 * Usage:
 *   node scripts/check-backlog-history-tracked.mjs [--dir <backlog>]
 *
 * Exit 0 all tracked (or no git) · 1 an untracked log · 2 a usage error.
 *
 * Tests: `node --test scripts/tests/history-tracked.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { ANY_HISTORY_FILE } from "./task-id.mjs";
import { MARK, color } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const WARNM = color.warn(MARK.warn);
const ERRM = color.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The repository a directory belongs to, or null. The runner is injectable so a
 * test can exercise the no-git branch without deleting anything.
 */
export function gitRoot(dir, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (!r || r.status !== 0) return null;
  const top = String(r.stdout || "").trim();
  return top || null;
}

/**
 * The same path git would print for it.
 *
 * WHY THIS IS NOT PARANOIA. `rev-parse --show-toplevel` answers with the REAL
 * path, and on macOS `/var` is a symlink to `/private/var` — so a backlog under
 * a temporary directory gives a repository root and a backlog root that share
 * no prefix at all. Every path then computes as `../../..` and matches nothing
 * in `git ls-files`, which the guard reads as "nothing is tracked" and reports
 * as a pass. It stayed green through its own first test run for exactly that
 * reason: an empty set has no asymmetry in it.
 */
function real(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/** Every path git tracks under one directory, relative to the repository root.
 *  One call rather than one per file: 158 `git ls-files` invocations to answer a
 *  question git answers once is the difference between a guard people run and
 *  one they switch off. */
export function trackedUnder(repoRoot, dir, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", repoRoot, "ls-files", "--", dir], { encoding: "utf8" });
  if (!r || r.status !== 0) return new Set();
  return new Set(String(r.stdout || "").split("\n").filter(Boolean));
}

/**
 * The audit. PURE — it is handed the three sets it compares.
 *
 * @param {string[]} taskIds     ids with a file in `tasks/`
 * @param {string[]} logIds      ids with a file in `history/`
 * @param {(id: string) => boolean} taskTracked  is the TASK file tracked?
 * @param {(id: string) => boolean} logTracked   is the LOG tracked?
 */
export function auditTracking(taskIds, logIds, taskTracked, logTracked) {
  const tasks = new Set(taskIds);
  const untracked = [];
  const orphans = [];
  let checked = 0;

  for (const id of [...logIds].sort()) {
    if (!tasks.has(id)) {
      orphans.push(id);
      continue;
    }
    checked++;
    // The asymmetry is the defect. A log untracked beside a task that is ALSO
    // untracked is a backlog nobody has committed yet, which is not this
    // guard's business and must not be reported as one.
    if (!logTracked(id) && taskTracked(id)) untracked.push(id);
  }

  // A task with no log at all is not reported: `history/` is written on the
  // first change, so a task created and never touched legitimately has none.
  return { untracked, orphans, checked, logs: logIds.length, tasks: tasks.size };
}

function idsIn(dir, pattern, strip) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const file of readdirSync(dir)) {
    const m = file.match(pattern);
    if (m) out.push(strip ? m[1] : file);
  }
  return out;
}

/**
 * Which half of this guard to speak (TL-383).
 *
 * THE GUARD ANSWERS TWO QUESTIONS AND ONLY ONE OF THEM IS A GATE. A log left
 * untracked beside a task file that IS tracked can only mean the log was left
 * behind, and another tree then reads a task with no history — current,
 * repairable, and it fails. A log with no task in this tree usually means the
 * task is on somebody else's branch, which is not a defect at all but the point
 * of data travelling with branches: it cannot be repaired from here and never
 * failed anything. Printed together in a release verdict, the second taught
 * readers that a `!` from this command means nothing.
 *
 * ONE FLAG AND NOT TWO GUARDS, because the two findings are computed from one
 * walk of the same two sets; splitting the script would walk the tree twice to
 * separate outputs that were never expensive to separate. Absent, it says
 * everything — a caller who asked for this guard by name asked the whole
 * question.
 */
export function parseOnly(argv) {
  const rest = [];
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") {
      only = argv[++i] || null;
      if (!["gates", "advisory"].includes(only)) {
        throw new Error("`--only` takes `gates` or `advisory`, not `" + (only || "") + "`");
      }
      continue;
    }
    rest.push(argv[i]);
  }
  return { only, argv: rest };
}

export function main(argv) {
  let only, afterOnly;
  try {
    ({ only, argv: afterOnly } = parseOnly(argv));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const { dir, argv: rest } = takeDirFlag(afterOnly);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-history-tracked.mjs [--dir <backlog>]");
    return 2;
  }
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  const repo = gitRoot(root);
  if (!repo) {
    // Said out loud, and 0. A tick here would be a claim about versioning made
    // by a run that never looked at a repository.
    console.log(`${OKM} history: not a git repository — nothing to check about tracking`);
    console.log("  The log is meant to be versioned; outside git that sentence has no subject.");
    return 0;
  }

  const taskIds = idsIn(paths.tasksDir, config.taskId.fileId, true);
  const logIds = idsIn(paths.historyDir, ANY_HISTORY_FILE, true);
  const tracked = trackedUnder(real(repo), real(paths.root));

  const rel = (p) => relative(real(repo), real(p)).split("\\").join("/");
  const taskFileFor = new Map();
  if (existsSync(paths.tasksDir)) {
    for (const file of readdirSync(paths.tasksDir)) {
      const m = file.match(config.taskId.fileId);
      if (m && config.taskId.file.test(file)) taskFileFor.set(m[1], join(paths.tasksDir, file));
    }
  }

  const result = auditTracking(
    taskIds, logIds,
    (id) => taskFileFor.has(id) && tracked.has(rel(taskFileFor.get(id))),
    (id) => tracked.has(rel(join(paths.historyDir, id + ".jsonl")))
  );

  if (result.orphans.length && only !== "gates") {
    console.log(
      `${WARNM} history: ${result.orphans.length} log(s) with no task in this tree — ` +
        "usually a task on another branch, which is the point of data travelling with branches"
    );
    for (const id of result.orphans.slice(0, 10)) {
      console.log(`  - ${id}.jsonl`);
    }
    if (result.orphans.length > 10) console.log(`  … and ${result.orphans.length - 10} more`);
    console.log("  Counted apart from the untracked ones on purpose: this is somebody's other");
    console.log("  branch, that is somebody's missing commit, and one number would hide both.");
  }

  if (only === "advisory") {
    // Asked for the advisory half alone, a tick about the gate would be an
    // answer to a question nobody put — and `audit` is not entitled to report
    // that a release gate passed.
    return 0;
  }

  if (!result.untracked.length) {
    // The counts are the positive control: "0 untracked" over 0 logs would be a
    // guard that read nothing, and it must not look like a guard that passed.
    console.log(
      `${OKM} history: ${result.checked} log(s) checked against git, each one tracked ` +
        `(${result.tasks} task(s) in the tree)`
    );
    return 0;
  }

  console.log(
    `${ERRM} history: ${result.untracked.length} of ${result.checked} log(s) are NOT tracked, ` +
      "while their task files are"
  );
  for (const id of result.untracked.slice(0, 20)) {
    console.log(`  - ${rel(join(paths.historyDir, id + ".jsonl"))}`);
  }
  if (result.untracked.length > 20) console.log(`  … and ${result.untracked.length - 20} more`);
  console.log("");
  console.log("  The task travels with the branch and the log does not, so another tree sees a");
  console.log("  task with no history and honestly takes it for new. Attribution is then");
  console.log("  reconstructed after the fact, and any metric computed there is computed from");
  console.log("  incomplete data without being able to tell.");
  console.log("");
  console.log("  → `git add` them, in a commit of their own, after checking that none belongs");
  console.log("    to somebody else's work in flight.");
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-history-tracked.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
