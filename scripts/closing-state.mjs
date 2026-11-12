/**
 * Two states a dead session leaves behind that git shows and the tool did not
 * (TL-688): a task closed on disk whose closing no commit carries, and a merge
 * stopped half way.
 *
 * WHAT WAS MEASURED. A supervised-loop session killed after `done` left TL-643
 * closed in the working tree and in no commit (2026-11-08 14:43); a coordinator
 * killed mid-merge left MERGE_HEAD set. Both were found by a person reading
 * `git status`. The task file says `done` in either case, so every reading
 * command answered as if the work had landed — and on another branch, or after
 * a `git checkout`, it had not.
 *
 * READS ONLY. Both questions are answered from git and the task files; nothing
 * is staged, committed or aborted here. `doctor` prints the repair, and the
 * person decides — a merge in particular may hold a resolution half typed.
 *
 * A CLOSING, NOT AN EDIT OF A CLOSED TASK. A task whose status was already an
 * archived one at HEAD and whose body was touched since is a change to a
 * record, not a closing nobody committed; it is not reported. The question is
 * whether the archived status ITSELF is in a commit: absent from HEAD (a file
 * never committed) or different there counts.
 *
 * PATHS ARE RELATIVE TO THE TOP OF THE WORK TREE, because that is where the
 * printed `git add` is run from, and where the backlog is a subdirectory a path
 * relative to the backlog would name nothing.
 *
 * Tests: `node --test scripts/tests/doctor.test.mjs`
 *        `node --test scripts/tests/resume-briefing.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, posix } from "node:path";

import { gitDiscoveryEnv } from "./git-env.mjs";
import { backlogPaths } from "./paths.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, env: gitDiscoveryEnv(), maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || "" };
}

function lines(s) {
  return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** The status a task file's text declares, or "" when it declares none. */
function statusOf(text) {
  return String(extractMeta(splitFrontmatter(text).frontmatter).status || "");
}

/**
 * Task files whose archived status is in no commit.
 *
 * `null` when the question cannot be asked — outside a repository — so a
 * caller can tell "not checked" from "none". Otherwise a list of
 * `{ id, status, path, history }`, both paths relative to the top of the work
 * tree; `history` is null when the task has no history file.
 *
 * @param {string} root the backlog directory
 * @param {{archivedStatuses: string[], taskId: {file: RegExp}}} config
 * @param {{only?: string}} [opts] `only`: the file name of a single task
 */
export function uncommittedClosings(root, config, { only } = {}) {
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok || !top.stdout.trim()) return null;
  const topDir = top.stdout.trim();
  const tasksDir = backlogPaths(root).tasksDir;
  const scope = only ? join(tasksDir, only) : tasksDir;

  // A repository with no commit yet has no HEAD to differ from: every task file
  // in it is untracked, and `ls-files --others` reports it below.
  const hasHead = git(root, ["rev-parse", "--verify", "-q", "HEAD"]).ok;
  const changed = hasHead ? lines(git(root, ["diff", "--name-only", "HEAD", "--", scope]).stdout) : [];
  const untracked = lines(git(root, ["ls-files", "--others", "--exclude-standard", "--full-name", "--", scope]).stdout);

  const found = [];
  for (const path of [...new Set([...changed, ...untracked])].sort()) {
    const name = basename(path);
    if (!config.taskId.file.test(name)) continue;
    const onDisk = join(topDir, path);
    // A deleted task file differs from HEAD too, and is not a closing.
    if (!existsSync(onDisk)) continue;
    const text = readFileSync(onDisk, "utf8");
    const meta = extractMeta(splitFrontmatter(text).frontmatter);
    const status = String(meta.status || "");
    if (!config.archivedStatuses.includes(status)) continue;
    const before = hasHead ? git(topDir, ["show", "HEAD:" + path]) : { ok: false };
    if (before.ok && config.archivedStatuses.includes(statusOf(before.stdout))) continue;
    const id = String(meta.id || name.replace(/\.md$/, ""));
    // The closing's evidence travels in the same commit (AGENTS.md), so the
    // repair names the history file beside the task file when there is one.
    // Derived from the task's own path, which git already gave relative to
    // the top: `tasks/` and `history/` are siblings in every layout.
    const history = posix.join(posix.dirname(posix.dirname(path)), "history", id + ".jsonl");
    found.push({ id, status, path, history: existsSync(join(topDir, history)) ? history : null });
  }
  return found;
}

/**
 * Is a merge stopped half way in the checkout that holds `root`? Asked through
 * `git rev-parse --git-path`, because in a linked worktree MERGE_HEAD lives
 * under `.git/worktrees/<name>/`, not under `.git/`.
 *
 * `null` outside a repository; otherwise `{ inProgress, path }`.
 */
export function mergeInProgress(root) {
  const r = git(root, ["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]);
  if (!r.ok || !r.stdout.trim()) return null;
  const path = r.stdout.trim();
  return { inProgress: existsSync(path), path };
}
