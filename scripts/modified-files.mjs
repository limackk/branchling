#!/usr/bin/env node
/**
 * Which files a task changed — COMPUTED from git, never stored (TL-75).
 *
 * WHAT IT ANSWERS. `git log <file>` says who changed a file and when. It does
 * not say AS PART OF WHAT, and that is the question somebody actually has while
 * reading unfamiliar code: "why does this function look like this". The answer
 * exists already — it is in a task's `## Goal` and `## Context` — and all that
 * was missing was the index from file to task. Nothing an external tracker can
 * offer, because it needs the tasks and the code in ONE tree: Law 1's payoff,
 * until now unrealised.
 *
 * WHY COMPUTED AND NOT A FRONTMATTER FIELD. This was the decision TL-75 left
 * open, and it is Law 2 almost verbatim. A `modified_files:` field would be
 * versioned, would have to be maintained by hand or by a hook, and would be
 * WRONG the moment either fails — wrong while looking exactly like a fact,
 * which is the failure mode this project keeps refusing. The commits are the
 * record; the index over them is a view, and a view may be deleted and rebuilt.
 * The cost is honest and bounded: one `git log` per query.
 *
 * The link between a commit and a task is the TASK ID IN THE COMMIT MESSAGE,
 * which this repository's own convention already requires ("the title starts
 * with the task id"). Nothing new is asked of anybody, and a project that does
 * not follow that convention gets an empty answer rather than a wrong one —
 * `explain()` says which of the two it is.
 *
 * PATHS ARE RELATIVE TO THE REPOSITORY ROOT, not to the backlog directory. In a
 * co-located layout the two are the same and the distinction is invisible; in
 * this repository the backlog is `backlog/` and they are not. Git reports paths
 * from the repository root, so this module keeps them there and says so, rather
 * than rewriting them against a directory the user did not type.
 *
 * Tests: `node --test scripts/tests/modified-files.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { taskIdScanner } from "./task-id.mjs";

/**
 * ASCII record and unit separators, built rather than typed: a commit message
 * may contain any printable character, newlines and quotes included, so a
 * delimiter that can appear in the data is not a delimiter — and the bytes
 * themselves are invisible in an editor, which is how a delimiter goes missing
 * during an edit nobody can see.
 */
const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

/** The repository holding this backlog, or `null` when there is none. */
export function repoRoot(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0) return null;
  const out = String(r.stdout || "").trim();
  return out || null;
}

/**
 * PURE — parses one `git log` run, so a test needs no repository.
 *
 * @param {string} text the output of the command `gitLogArgs()` describes
 * @param {RegExp} scanner from `taskIdScanner(prefix)` — GLOBAL, so it is
 *   re-armed per record rather than carried between them
 * @returns {Map<string, Set<string>>} task id to the paths its commits touched
 */
export function parseLog(text, scanner) {
  const byTask = new Map();
  for (const record of String(text || "").split(RS)) {
    if (!record.trim()) continue;
    const cut = record.indexOf(US);
    if (cut < 0) continue;
    const message = record.slice(0, cut);
    const files = record.slice(cut + 1).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!files.length) continue;

    // A commit may name more than one task. Both get the files: the alternative
    // is to pick one, and picking is a guess this module has no basis for.
    const ids = new Set();
    scanner.lastIndex = 0;
    for (const m of message.matchAll(scanner)) ids.add(m[1]);
    for (const id of ids) {
      if (!byTask.has(id)) byTask.set(id, new Set());
      const set = byTask.get(id);
      for (const f of files) set.add(f);
    }
  }
  return byTask;
}

/** The one `git log` invocation. Separate so a test can assert the arguments
 *  rather than the shape of somebody's actual history. */
export function gitLogArgs() {
  // `--name-only` without `-m` reports nothing for merge commits, which is what
  // we want: a merge introduces no change of its own, and counting its files
  // would attribute a whole branch to whatever task the merge message names.
  return ["log", "--name-only", "--pretty=format:" + RS + "%B" + US];
}

/**
 * The whole index, in one pass over the history.
 *
 * @param {{root: string, prefix: string, run?: Function}} opts
 * @returns {{byTask: Map<string, Set<string>>, scanned: boolean, reason: string}}
 */
export function modifiedFiles({ root, prefix, run = spawnSync }) {
  if (!root) return { byTask: new Map(), scanned: false, reason: "no-git" };
  const r = run("git", gitLogArgs(), {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) return { byTask: new Map(), scanned: false, reason: "git-failed" };
  const byTask = parseLog(r.stdout, taskIdScanner(prefix));
  return { byTask, scanned: true, reason: byTask.size ? "ok" : "no-task-ids-in-commits" };
}

/**
 * The same index, computed at most once per COMMIT.
 *
 * WHY A CACHE AT ALL. The viewer is rebuilt on every change while `serve` is
 * running, and one `git log` over the whole history is cheap on a young
 * repository and not cheap on an old one. The key is HEAD, because that is
 * exactly what the answer depends on: an uncommitted edit changes no commit
 * message, so it cannot change which task a file belongs to.
 *
 * Process-local on purpose. A cache on disk would be a computed thing that
 * outlives the process that computed it, which is the shape of every stale
 * index this project keeps refusing (Law 2).
 */
const CACHE = new Map();
export function modifiedFilesCached({ root, prefix, run = spawnSync }) {
  if (!root) return { byTask: new Map(), scanned: false, reason: "no-git" };
  const head = run("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", timeout: 30_000 });
  // No HEAD at all is a repository with no commits — a real state, and one where
  // the honest answer is an empty index rather than a failure.
  const key = root + "@" + (head.status === 0 ? String(head.stdout).trim() : "no-head");
  if (!CACHE.has(key)) CACHE.set(key, modifiedFiles({ root, prefix, run }));
  return CACHE.get(key);
}

/**
 * Does this task touch this path?
 *
 * TWO MATCHES, ONE FLAG. An exact path answers "what was this file changed
 * for"; a path ending in `/` asks the same about a directory. Requiring the
 * slash is what keeps the two apart: without it `scripts/cli` would match both
 * `scripts/cli.mjs` and `scripts/client/` — a prefix match wearing the look of
 * an exact one.
 */
export function touches(paths, query) {
  const q = String(query || "");
  if (!q) return false;
  if (q.endsWith("/")) return [...paths].some((p) => p.startsWith(q));
  return paths.has(q);
}

/** Why an empty answer is empty. A query that matched nothing and a repository
 *  that was never scanned look identical in a list of zero rows, and only one of
 *  them is an answer. */
export function explain(reason) {
  if (reason === "no-git") return "not a git repository — the file index is computed from commit messages, so there is nothing to read";
  if (reason === "git-failed") return "`git log` failed — the file index could not be computed";
  if (reason === "no-task-ids-in-commits") return "no commit message in this repository names a task id, so no file can be attributed to a task";
  return null;
}
