#!/usr/bin/env node
/**
 * The one honest zero point: when each closed task was actually finished
 * (TL-27).
 *
 * WHAT IT READS AND WHY THAT ONE. `git log -S"status: done"` on a task's file
 * finds the commit that introduced the closing line, at second resolution. §2 of
 * docs/backlog-time-tracking.md (a real path — product-name: allow) measured it
 * against the three obvious alternatives and disqualified all of them:
 * `history/*.jsonl` began too recently to describe old work; `created` →
 * `updated` has a day's resolution while 71% of tasks close on the day they were
 * created, so it reports zero for seven tasks in ten; and the span of commits
 * touching a file is polluted by mass field backfills.
 *
 * WHAT IT DOES NOT WRITE, and this is the boundary the task drew: nothing about
 * DURATION. `-S"status: in_progress"` finds a start for 3 tasks in 20, because
 * an agent usually commits `pending → done` in one move and the intermediate
 * state never existed. Inventing a start from what is there would be the pretty
 * untruth §6 of docs/backlog-field-editing-history.md already refused once.
 *
 * IT IS IDEMPOTENT BY EVENT, NOT BY ROW ID. A ULID is fresh on every run, so
 * dedup by `id` would let a second pass write a second stamp for the same
 * commit. The key is (task, kind, timestamp) — `hasStamp` in activity.mjs.
 *
 * Exit: 0 = done (with `--dry-run`, nothing was written) · 2 = the invocation
 * was wrong or git could not be read.
 *
 * Tests: `node --test scripts/tests/activity.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { appendActivity, hasStamp, readActivity } from "./activity.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BACKFILL_FLAGS = ["--dir", "--actor"];

/** PURE — resolves the arguments. Throws on a usage error. */
export function parseBackfillArgs(args) {
  const plan = { dir: null, actor: "agent:backfill", dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { plan.dryRun = true; continue; }
    if (BACKFILL_FLAGS.indexOf(a) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    throw new Error(
      (a.startsWith("-") ? "unknown flag: " : "unexpected argument: ") + a + "\n" +
        "usage: " + N + " backfill-completions [--dry-run] [--actor <ns:name>] [--dir <path>]"
    );
  }
  return plan;
}

/**
 * When the closing line first appeared in this file, as an ISO instant.
 *
 * `--diff-filter=A` is NOT used: a task file is usually added while still open,
 * so the addition is not the closing. The pickaxe asks the right question —
 * which commit introduced the text — and `--reverse` takes the FIRST such
 * commit, because a task closed, reopened and closed again was first finished
 * then.
 *
 * @returns {string|null} null when git has nothing to say, which is not an error
 */
export function completionStamp(repoRoot, filePath, closingStatuses, run = spawnSync) {
  for (const status of closingStatuses) {
    const r = run("git", [
      "log", "--reverse", "--format=%cI", "-S" + "status: " + status, "--", filePath,
    ], { cwd: repoRoot, encoding: "utf8" });
    if (r.status !== 0) continue;
    const first = String(r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean)[0];
    if (first) return first;
  }
  return null;
}

/**
 * The whole pass, as DATA. PURE of writing when `dryRun` is set.
 *
 * @returns {{written: number, already: number, unstamped: string[], closed: number}}
 */
export function backfill(root, config, opts = {}) {
  const dryRun = !!opts.dryRun;
  const actor = opts.actor || "agent:backfill";
  const run = opts.run || spawnSync;
  const repoRoot = opts.repoRoot || root;
  const paths = backlogPaths(root);
  const archived = new Set(config.archivedStatuses || []);
  const records = readTaskRecords(paths.tasksDir, config.taskId.file);

  let written = 0;
  let already = 0;
  const unstamped = [];
  const closed = records.filter((t) => archived.has(t.status));

  for (const task of closed) {
    const abs = join(paths.tasksDir, task.file.replace(/^tasks\//, ""));
    const rel = relative(repoRoot, abs) || abs;
    const ts = completionStamp(repoRoot, rel, config.archivedStatuses || [], run);
    if (!ts) {
      // Reported, never invented. A task whose closing git cannot see is a hole
      // in the measurement, and a hole nobody counts is a sum pretending to be
      // complete.
      unstamped.push(task.id);
      continue;
    }
    if (hasStamp(readActivity(root, task.id), "commit", ts)) {
      already++;
      continue;
    }
    if (!dryRun) {
      appendActivity(root, task.id, [{
        ts, task: task.id, kind: "commit", actor,
        source: "git-backfill", session: "", attribution: "path",
      }]);
    }
    written++;
  }
  return { written, already, unstamped, closed: closed.length };
}

function main(argv) {
  let plan;
  try {
    plan = parseBackfillArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " backfill-completions", head, rest, []));
    return 2;
  }
  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " backfill-completions", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const repoRoot = gitRoot(root) || root;
  const result = backfill(root, config, { dryRun: plan.dryRun, actor: plan.actor, repoRoot });

  console.log(
    color.ok(MARK.ok) + " " + (plan.dryRun ? "would stamp " : "stamped ") + result.written +
      " of " + result.closed + " closed task(s)" +
      (result.already ? "; " + result.already + " already had one" : "")
  );
  if (result.unstamped.length) {
    console.log(
      "  " + color.dim(result.unstamped.length + " closed task(s) have no completion git can see: " +
        result.unstamped.slice(0, 8).join(", ") +
        (result.unstamped.length > 8 ? ", …" : ""))
    );
  }
  if (plan.dryRun) console.log("  " + color.dim("`--dry-run`: nothing was written"));
  return 0;
}

/** The repository the backlog lives in — the paths handed to git are relative to
 *  it, and a backlog outside a repository simply has no stamps to find. */
export function gitRoot(from, run = spawnSync) {
  const r = run("git", ["rev-parse", "--show-toplevel"], { cwd: from, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout || "").trim() || null;
}

if (process.argv[1] && process.argv[1].endsWith("backfill-completions.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
