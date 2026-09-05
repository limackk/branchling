#!/usr/bin/env node
/**
 * Report: has a task's state travelled with its branch yet? (TL-230)
 *
 * THE DEFECT, MEASURED. On 2026-09-03 in the `tl-214-role-pipeline` worktree
 * three tasks had their CODE committed while the state change to the task file
 * stayed in the working tree: TL-214 was `in_progress` at `HEAD` and `done` on
 * disk, TL-180 `pending` against `done`, TL-187 `pending` against
 * `in_progress`. The consequence is not hypothetical — `next` handed TL-187 to
 * a second session, which took it, found the suite already green and had
 * nothing to do. The task file said `pending`, and the task file is the only
 * thing `next` reads.
 *
 * WHY CLAUDE.md's ANSWER DOES NOT REACH IT. "After the commit: merge into
 * `main` and close the worktree" covers the same failure ACROSS branches. Here
 * the divergence is between the working tree and `HEAD` of the SAME branch, so
 * there is nothing to merge yet and no worktree to remove. The work was
 * committed; only the record of the work was not.
 *
 * WHY THE TOOL CAN SEE THIS AND A RULE CANNOT. "Commit a task closed by `done`
 * together with its entry in `backlog/history/`" is a convention, and a
 * convention is checked by the person who already forgot it. A committed
 * `status:` differing from the one on disk is a fact `git show HEAD:<path>`
 * answers in one call.
 *
 * THIS IS A REPORT, NOT A FAILURE, and that is the whole design. An
 * uncommitted state change is the NORMAL condition of a session still working
 * — `take` writes one at the start. A guard that failed here would fail every
 * session mid-task, and would be switched off within a day. So it exits 0 and
 * names the tasks, the way the `--reasons` guard already reports gaps it does
 * not fail on.
 *
 * TWO THINGS ARE SILENT, DELIBERATELY. A task file git has never seen has no
 * committed state to disagree with — the absence of a commit is not a
 * divergence, it is a task that has not been committed once. And a backlog
 * outside any repository has no `HEAD` at all; there the command says so out
 * loud rather than printing a tick it never earned, exactly as the history
 * guard does.
 *
 * Usage:
 *   node scripts/check-backlog-task-state-committed.mjs [--dir <backlog>]
 *
 * Exit 0 always — it reports. 2 is a usage error.
 *
 * Tests: `node --test scripts/tests/check-task-state-committed.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { MARK, color } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const WARNM = color.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The fields whose divergence means a session would be handed the wrong
 *  answer. `status:` decides whether `next` offers the task at all; `owner:`
 *  decides whether it looks free. Nothing else in the frontmatter is read by
 *  the selection path, and a wider comparison would report a reworded title as
 *  if it were a lost closing. */
const COMPARED = ["status", "owner"];

/** The repository a directory belongs to, or null. The runner is injectable so
 *  a test can exercise the no-git branch without deleting anything. */
export function gitRoot(dir, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (!r || r.status !== 0) return null;
  const top = String(r.stdout || "").trim();
  return top || null;
}

/**
 * The same path git would print for it. `rev-parse --show-toplevel` answers
 * with the REAL path, and on macOS `/var` is a symlink to `/private/var` — so a
 * backlog under a temporary directory would otherwise compute as `../../..`
 * and match nothing git says. That mistake is green, because an empty set has
 * no divergence in it (the history guard was caught by it first).
 */
function real(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/**
 * The comparison. PURE — it is handed both sides.
 *
 * @param {Array<{id: string, path: string, tree: object, head: object|null}>} pairs
 * @returns {{diverged: Array, compared: number}}
 */
export function compareStates(pairs) {
  const diverged = [];
  let compared = 0;
  for (const pair of pairs) {
    // No committed side: git has never seen this file. Not a divergence.
    if (!pair.head) continue;
    compared++;
    const fields = COMPARED.filter((f) => (pair.tree[f] || "") !== (pair.head[f] || ""));
    if (fields.length) diverged.push({ id: pair.id, path: pair.path, fields, tree: pair.tree, head: pair.head });
  }
  return { diverged, compared };
}

/** The frontmatter of one path as it stands at `HEAD`, or null if git has never
 *  committed it. A file merely STAGED has no `HEAD` blob either, and that is the
 *  same answer for the same reason. */
function metaAtHead(repoRoot, relPath, run = spawnSync) {
  const r = run("git", ["-C", repoRoot, "show", "HEAD:" + relPath], { encoding: "utf8" });
  if (!r || r.status !== 0) return null;
  return extractMeta(splitFrontmatter(String(r.stdout || "")).frontmatter);
}

export function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-task-state-committed.mjs [--dir <backlog>]");
    return 2;
  }
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  const repo = gitRoot(root);
  if (!repo) {
    console.log(`${OKM} task-state: not a git repository — nothing to compare a task file against`);
    return 0;
  }
  const repoRoot = real(repo);
  // A repository with no commits yet has no `HEAD`, so there is no committed
  // side for anything. Said out loud for the same reason as the branch above.
  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" });
  if (!head || head.status !== 0) {
    console.log(`${OKM} task-state: no commit yet — nothing has a committed state to disagree with`);
    return 0;
  }

  const rel = (p) => relative(repoRoot, real(p)).split("\\").join("/");
  const pairs = [];
  if (existsSync(paths.tasksDir)) {
    for (const file of readdirSync(paths.tasksDir).sort()) {
      const m = file.match(config.taskId.fileId);
      if (!m || !config.taskId.file.test(file)) continue;
      const full = join(paths.tasksDir, file);
      const tree = extractMeta(splitFrontmatter(readFileSync(full, "utf8")).frontmatter);
      pairs.push({ id: m[1], path: rel(full), tree, head: metaAtHead(repoRoot, rel(full)) });
    }
  }

  const { diverged, compared } = compareStates(pairs);

  if (!diverged.length) {
    // The counts are the positive control: "0 diverged" over 0 files compared
    // would be a report that read nothing, and it must not look like one that
    // looked and found nothing.
    console.log(
      `${OKM} task-state: ${compared} task file(s) compared with HEAD, each one agrees ` +
        `(${pairs.length} in the tree)`
    );
    return 0;
  }

  console.log(
    `${WARNM} task-state: ${diverged.length} of ${compared} task file(s) differ from HEAD — ` +
      "a state change that has not travelled with the branch yet"
  );
  for (const d of diverged.slice(0, 20)) {
    const shown = d.fields
      .map((f) => `${f}: ${d.head[f] || "(none)"} at HEAD, ${d.tree[f] || "(none)"} on disk`)
      .join("; ");
    console.log(`  - ${d.id} — ${shown}`);
  }
  if (diverged.length > 20) console.log(`  … and ${diverged.length - 20} more`);
  console.log("");
  console.log("  Reported, never failed: a task taken a minute ago is in exactly this state, and");
  console.log("  a guard that failed here would fail every session mid-task. It matters when the");
  console.log("  CODE was committed and the closing was not — `next` reads the task file, so the");
  console.log("  next tree to look sees the task as it was before the work.");
  console.log("");
  console.log("  → If the work is finished, commit the task file and its `backlog/history/`");
  console.log("    entry; if it is still in flight, this line is the normal condition.");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-task-state-committed.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
