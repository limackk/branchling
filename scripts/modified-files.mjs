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
 * The link between a commit and a task is the TASK ID AT THE HEAD OF THE
 * COMMIT TITLE, which this repository's own convention already requires ("the
 * title starts with the task id"). Nothing new is asked of anybody, and a
 * project that does not follow that convention gets an empty answer rather than
 * a wrong one — `explain()` says which of the two it is.
 *
 * WHICH IDS COUNT (TL-614). Only the run of ids the title STARTS with: ids
 * separated by whitespace, commas or a colon (`TL-9 TL-10 …`, `TL-9: …`), and
 * a range `TL-607..TL-611`, which counts as every id it spans — the title
 * declares the commit is about each task in the set, and reading only the two
 * endpoints would treat TL-608 differently from TL-607 for no reason the author
 * wrote. The run ends at the first word that is not an id. A reversed range
 * counts as its two endpoints, because nothing says what was meant between
 * them. Merge commits are excluded separately, in `gitLogArgs()`.
 *
 * A RANGE WIDER THAN `MAX_RANGE_SPAN` COUNTS AS ITS TWO ENDPOINTS (TL-627),
 * for the reason a reversed one does: nothing credible says what was meant
 * between them. One typo — `PROJ-6..PROJ-60000` — would otherwise create sixty
 * thousand entries, each holding the commit's files, and `query
 * --modified-file` and the capability record `done` writes would hand those
 * files to tasks that never existed or never touched them. The bound is the
 * width `hi - lo`. The widest head range this repository's own history held
 * when it was set was 24, in the title `TL-626..TL-650 Every open agent task …`  (renumber: allow)
 * (one wave of the plan filed in a single commit); 100 leaves four times that
 * as headroom, and a commit that genuinely concerns more than a hundred
 * consecutive tasks is a bulk edit whose files say little about any one of
 * them. It is a constant here and not a key in `config.yaml` because it is
 * part of the parsing rule, not the project's vocabulary. Rejected: skipping
 * the commit, which would also drop the two ids the author certainly typed;
 * and failing the command, which would let one historical typo — immutable
 * once pushed — break `query` and `done` for good.
 *
 * Rejected: every id anywhere in the message, which is what this module did
 * until TL-614. A body that says "filed as TL-595" or a title that says "the
 * TL-593 review findings are tasks" MENTIONS a task; it does not do its work.
 * Read as a claim, the mention handed a commit's files to the task it named,
 * and `done` then recorded in TL-595's capability record a file TL-595 never
 * touched. Also rejected: any id anywhere in the TITLE. It fixes the body case
 * and keeps the title one, and the title is where filing commits name the tasks
 * they are about without being them.
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
import { canonicalPath } from "./canonical-path.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";

/**
 * ASCII record and unit separators, built rather than typed: a commit message
 * may contain any printable character, newlines and quotes included, so a
 * delimiter that can appear in the data is not a delimiter — and the bytes
 * themselves are invisible in an editor, which is how a delimiter goes missing
 * during an edit nobody can see.
 */
/** The widest range `titleIds()` expands; the module header says why 100. */
export const MAX_RANGE_SPAN = 100;

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

/** The repository holding this backlog, or `null` when there is none. */
export function repoRoot(cwd) {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 30_000, env: gitDiscoveryEnv() });
  if (r.status !== 0) return null;
  const out = String(r.stdout || "").trim();
  return out ? canonicalPath(out) : null;
}

/**
 * PURE — parses one `git log` run, so a test needs no repository.
 *
 * @param {string} text the output of the command `gitLogArgs()` describes
 * @param {RegExp} scanner from `taskIdScanner(prefix)`; only its source is
 *   read, by `titleIds()`, so no `lastIndex` is carried between records
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

    // A commit may name more than one task at its head. All of them get the
    // files: the alternative is to pick one, and picking is a guess this module
    // has no basis for.
    for (const id of titleIds(message, scanner)) {
      if (!byTask.has(id)) byTask.set(id, new Set());
      const set = byTask.get(id);
      for (const f of files) set.add(f);
    }
  }
  return byTask;
}

/**
 * The ids a commit's title starts with — the rule the module header states.
 *
 * The scanner is re-read as a STICKY copy, so an id is matched only where the
 * previous token ended; `parseLog` keeps taking the scanner `taskIdScanner()`
 * builds, and the prefix stays escaped exactly as it is everywhere else. Each
 * token is matched against the REST of the title rather than in place: the
 * scanner's look-behind refuses an id preceded by `.`, which is right in prose
 * and would refuse the second half of `TL-607..TL-611`.
 *
 * @param {string} message the whole commit message (`%B`)
 * @param {RegExp} scanner from `taskIdScanner(prefix)`
 * @returns {Set<string>}
 */
export function titleIds(message, scanner) {
  const title = String(message || "").split("\n")[0];
  const id = new RegExp(scanner.source, "y");
  const separator = /[\s,:]+/y;
  const ids = new Set();
  const at = (pos) => {
    id.lastIndex = 0;
    const m = id.exec(title.slice(pos));
    return m ? { m, end: pos + id.lastIndex } : null;
  };
  let pos = 0;
  for (;;) {
    const head = at(pos);
    if (!head) break;
    const first = head.m;
    ids.add(first[1]);
    pos = head.end;
    if (title.startsWith("..", pos)) {
      const tail = at(pos + 2);
      if (!tail) break;
      const last = tail.m;
      ids.add(last[1]);
      pos = tail.end;
      const lo = Number(first[2]);
      const hi = Number(last[2]);
      const stem = first[1].slice(0, first[1].length - first[2].length);
      if (hi - lo <= MAX_RANGE_SPAN) for (let n = lo + 1; n < hi; n++) ids.add(stem + n);
    }
    separator.lastIndex = pos;
    if (!separator.exec(title)) break;
    pos = separator.lastIndex;
  }
  return ids;
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
 * Files changed in the working tree, including untracked files.
 *
 * A closing happens before its one-task commit, so the history index above
 * cannot yet contain the implementation being proved. The worktree is the
 * current task's other half under the one-task-per-worktree convention. It is
 * kept separate from `modifiedFiles()` because committed attribution and local
 * dirt are different facts and other readers ask only the first question.
 */
export function workingTreeFiles({ root, run = spawnSync }) {
  if (!root) return { files: new Set(), scanned: false, reason: "no-git" };
  const changed = run("git", ["diff", "--name-only", "-z", "HEAD"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  if (changed.status !== 0 || untracked.status !== 0) {
    return { files: new Set(), scanned: false, reason: "git-failed" };
  }
  const files = new Set((String(changed.stdout || "") + String(untracked.stdout || ""))
    .split("\0").filter(Boolean));
  return { files, scanned: true, reason: "ok" };
}

/** Committed files attributed to a task, plus its not-yet-committed work. */
export function taskModifiedFiles({ root, prefix, taskId, run = spawnSync }) {
  const committed = modifiedFiles({ root, prefix, run });
  const working = workingTreeFiles({ root, run });
  if (!committed.scanned && !working.scanned) {
    return { files: new Set(), scanned: false, reason: committed.reason || working.reason };
  }
  return {
    files: new Set([...(committed.byTask.get(taskId) || []), ...working.files]),
    scanned: true,
    reason: "ok",
  };
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
  if (reason === "no-task-ids-in-commits") return "no commit title in this repository starts with a task id, so no file can be attributed to a task";
  return null;
}
