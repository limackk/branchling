#!/usr/bin/env node
/**
 * What the REST of this repository says — the branch and worktree scan (TL-73).
 *
 * WHY THIS IS ONE MODULE. Half of it already existed inside `next-backlog-id.mjs`,
 * for a reason that generalises: a view computed from ONE checkout lies about
 * every other one. `next-id` learned that about task NUMBERS ("free here, taken
 * on a branch this tree does not have"); this module asks the same question
 * about task STATE. Two copies of the scan would answer "which branches count"
 * differently, and the disagreement would show up as a task handed to a second
 * session because one of the two callers could not see the first.
 *
 * THE FIRST LAW IS THE REASON THE PROBLEM EXISTS. Data travels with the branch,
 * so a task moved to `in_progress` on `feature/x` is still `pending` on `main` —
 * and `query --status pending` offers it as free work. That is exactly the
 * failure mode external trackers were rejected for, only inverted.
 *
 * THREE RULES THIS MODULE HOLDS TO:
 *
 *   1. **Nothing is resolved silently.** When two branches disagree about a
 *      task's status, the answer names BOTH and says which branch each came
 *      from. Picking a winner here would be the same defect as reading one
 *      checkout — a single value that looks like the truth.
 *   2. **Local refs only.** No `git fetch`, ever. The tool works on a plane.
 *      A branch that exists only on the remote is invisible, and that is a
 *      narrower answer rather than a wrong one.
 *   3. **Bounded work.** Dead branches accumulate; the scan is windowed by
 *      `active_branch_days`. Branches checked out in a worktree are ALWAYS in,
 *      whatever their age — somebody is standing in them.
 *
 * EXISTENCE IS THE THIRD QUESTION OF THE SAME SHAPE (TL-145). `next-id` asks it
 * about NUMBERS, `scanTaskStates` about STATE, and `absentHere` about the tasks
 * themselves: which ids the rest of the repository knows and this tree does not.
 * It was left out while the reader and the writer were one person on one disk;
 * with two, the failure mode reads as success, because the task is not reported
 * as hidden, it is reported as absent. The rule is TL-73's, applied one level
 * up: the difference is SHOWN and the branch is NAMED, never resolved — and
 * such a task is never presented as an ordinary task of this tree, because it
 * is not one.
 *
 * Tests: `node --test scripts/tests/cross-branch-state.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

import { HISTORY_DIRNAME } from "./history.mjs";
import { parseTaskRecord } from "./task-select.mjs";

/** A day, in seconds — the unit `active_branch_days` is expressed in. */
const DAY = 86_400;

/** The byte `-z` and `--porcelain -z` separate records with. Written as an
 *  escape and never as a literal: a raw NUL in the source is invisible in a
 *  diff and indistinguishable from a stray space. */
const NUL = "\u0000";

/**
 * Git, with failure spelled as an empty answer rather than an exception.
 *
 * Every caller here is asking an OPTIONAL question: a directory that is not a
 * repository, a `git` too old for a flag, a corrupt ref — none of them are a
 * reason for `query` to stop working, they are a reason for it to answer from
 * this tree alone and say so.
 */
function git(args, cwd, opts = {}) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: opts.buffer ? undefined : "utf8",
    input: opts.input,
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30_000,
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (r.status !== 0 || !r.stdout) return opts.buffer ? Buffer.alloc(0) : "";
  return r.stdout;
}

/** The top level of the working tree `cwd` sits in, or null outside a repository. */
export function repoRootFor(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim() || null;
}

/**
 * The backlog directory as a path RELATIVE to the repository root — the form
 * `git ls-tree` needs to look into a tree that is not checked out.
 *
 * An empty string is the valid answer for a backlog that IS the repository root
 * (BL-1418); callers must not treat it as "not found". A backlog outside the
 * repository has no relative form at all, and gets null.
 */
export function backlogRelFor(repoRoot, backlogDir) {
  try {
    // `git rev-parse --show-toplevel` has already resolved symbolic links while
    // `resolveBacklogDir()` has not, so on macOS the /tmp to /private/tmp pair
    // made `relative()` return a path starting with `..` for a backlog in the
    // right place (BL-1418).
    const rel = relative(repoRoot, realpathSync(backlogDir));
    return rel.startsWith("..") ? null : rel;
  } catch {
    return null;
  }
}

/** The pathspec for `tasks/` inside a tree — never a leading slash, which git
 *  reads as an attempt at an absolute path and refuses (BL-1418). */
function tasksPathspec(backlogRel) {
  return backlogRel ? backlogRel + "/tasks" : "tasks";
}

// ──────────────────────────────────────────────────────────────────────────
// What exists: worktrees and local branches
// ──────────────────────────────────────────────────────────────────────────

/** @returns {Array<{path: string, branch: string|null}>} every working tree of
 *  this repository, including the one the caller is standing in. */
export function worktrees(root) {
  const out = [];
  let current = null;
  for (const line of git(["worktree", "list", "--porcelain"], root).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length).trim(), branch: null };
      if (current.path) out.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim();
    }
  }
  return out;
}

/** Just the paths — what `next-id` has always asked for. */
export function worktreeRoots(root) {
  return worktrees(root).map((w) => w.path);
}

/** @returns {Array<{ref: string, name: string, time: number}>} local branches
 *  with the timestamp of their last commit. `refs/heads` only: rule 2. */
export function refActivity(root) {
  const FORMAT = "--format=%(refname)%09%(committerdate:unix)";
  return git(["for-each-ref", FORMAT, "refs/heads"], root)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const ref = tab < 0 ? line : line.slice(0, tab);
      return {
        ref,
        name: ref.replace(/^refs\/heads\//, ""),
        time: tab < 0 ? 0 : Number(line.slice(tab + 1)) || 0,
      };
    });
}

/** Every local branch, as full ref names. */
export function localRefs(root) {
  return refActivity(root).map((r) => r.ref);
}

/**
 * The branches worth reading.
 *
 * @param {{days?: number, now?: number, pinned?: Set<string>}} opts
 *        `days` of 0 (or nothing) means no window at all. `pinned` refs are kept
 *        whatever their age — a branch somebody has checked out is active by
 *        definition, and dropping it would hide the one session most likely to
 *        be holding a task.
 */
/**
 * The refs fully merged into `into` — branches that hold no second opinion,
 * because their commits are already reachable from here (TL-235).
 *
 * WHY THIS IS NOT TIDINESS. A merged branch whose worktree was removed still
 * carries the task at the state it had before the merge, and the scan read that
 * as a disagreement. The consequence is not a noisy badge: `next` refuses to
 * hand out a candidate that is "in another state on another branch", so on
 * 2026-09-04 a wave holding one open task produced an empty queue, skipped over
 * two branches that had been merged that morning. Refs only accumulate, so every
 * later run would have been worse.
 *
 * ONE CALL FOR EVERY REF. `git for-each-ref --merged` answers the whole set at
 * once; asking `merge-base --is-ancestor` per ref would make the scan's cost
 * grow with a number that only goes up.
 *
 * A MERGED REF IS DROPPED; A WORKTREE IS NOT. Somebody standing in a tree may
 * have uncommitted work whatever its branch, and that tree is a separate source
 * in `scanTaskStates` — this touches only the committed state of a ref.
 *
 * FULL REF NAMES, matching `refActivity`. The short form is a second spelling
 * of the same thing, and the filter that reads this set compares `r.ref` —
 * which is where the first version of this quietly matched nothing at all.
 *
 * @returns {Set<string>} full ref names, empty when git cannot answer
 */
export function mergedRefs(root, into = "HEAD") {
  const r = spawnSync("git", ["for-each-ref", "--merged", into, "--format=%(refname)", "refs/heads"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return new Set();
  return new Set(String(r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean));
}

export function activeRefs(root, opts = {}) {
  const all = refActivity(root);
  const days = Number(opts.days) || 0;
  if (days <= 0) return all;
  const now = Number.isFinite(opts.now) ? opts.now : Math.floor(Date.now() / 1000);
  const cutoff = now - days * DAY;
  const pinned = opts.pinned || new Set();
  return all.filter((r) => pinned.has(r.ref) || r.time >= cutoff);
}

// ──────────────────────────────────────────────────────────────────────────
// What the trees contain
// ──────────────────────────────────────────────────────────────────────────

/**
 * The task files committed on one ref.
 *
 * `-z` rather than plain `ls-tree`: without it a path carrying a non-ASCII byte
 * comes back C-quoted, and the quoted string matches no filename pattern.
 *
 * @returns {Array<{sha: string, path: string, name: string}>}
 */
export function taskEntriesInRef(root, ref, backlogRel) {
  const out = git(["ls-tree", "-r", "-z", ref, "--", tasksPathspec(backlogRel)], root);
  const entries = [];
  for (const record of out.split(NUL)) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    // `<mode> <type> <object>` stands before the tab.
    const fields = record.slice(0, tab).split(/\s+/);
    if (fields.length < 3 || fields[1] !== "blob") continue;
    const path = record.slice(tab + 1);
    entries.push({ sha: fields[2], path, name: path.split("/").pop() });
  }
  return entries;
}

/**
 * The contents of many blobs in ONE git process.
 *
 * Read as a Buffer and sliced by BYTE offsets: `cat-file --batch` announces each
 * object's size in bytes, and a task written in a language with multi-byte
 * characters would desynchronise the parse the moment that size was applied to
 * a string index.
 *
 * @returns {Map<string, string>} sha to contents; a missing object is absent
 */
export function readBlobs(root, shas) {
  const out = new Map();
  if (!shas || !shas.length) return out;
  const buf = git(["cat-file", "--batch"], root, { buffer: true, input: shas.join("\n") + "\n" });
  let i = 0;
  while (i < buf.length) {
    const nl = buf.indexOf(0x0a, i);
    if (nl < 0) break;
    const header = buf.toString("utf8", i, nl).split(" ");
    // `<sha> missing` for an object this repository does not have — two fields,
    // no body, and the next record starts on the following line.
    if (header.length < 3) {
      i = nl + 1;
      continue;
    }
    const size = Number(header[2]);
    if (!Number.isFinite(size)) break;
    const start = nl + 1;
    out.set(header[0], buf.toString("utf8", start, start + size));
    i = start + size + 1; // the newline git appends after the body
  }
  return out;
}

/**
 * Task files that differ from HEAD in one working tree — modified, staged or
 * untracked.
 *
 * WHY NOT READ THE WHOLE DIRECTORY. Another session's tree holds the same
 * thousand tasks as this one, and reading them all off the disk for every
 * `query` would cost more than the answer is worth. Its committed state is
 * already covered by the ref scan, because a checked-out branch is a local ref;
 * what the ref scan CANNOT see is an edit that has not been committed yet — and
 * that is precisely the state of a task another agent has just taken.
 *
 * @returns {string[]} paths relative to that working tree's root
 */
export function dirtyTaskFiles(worktreePath, backlogRel) {
  const out = git(
    ["status", "--porcelain", "-z", "--untracked-files=all", "--", tasksPathspec(backlogRel)],
    worktreePath
  );
  const records = out.split(NUL);
  const paths = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;
    // `XY <path>`; for a rename or a copy the ORIGINAL path follows as its own
    // NUL-terminated record and has to be skipped, or it would be read as the
    // status line of the next entry.
    const xy = record.slice(0, 2);
    const path = record.slice(3);
    if (xy[0] === "R" || xy[0] === "C") i++;
    if (path) paths.push(path);
  }
  return paths;
}

/**
 * When the log says a status was last SET — the timestamp of the last entry that
 * moved `status` TO the value asked about.
 *
 * NO VOCABULARY HERE. The caller passes the status the tree is CURRENTLY
 * reporting, whatever a project calls it, so this function never names one.
 *
 * THE LAST ENTRY WINS, for the same reason `enteredInProgressAt()` in
 * viewer-plan.mjs takes the last one: a task taken, handed back and taken again
 * has been in flight since the LAST take, and counting from the first reports an
 * elapsed time nobody has been working.
 *
 * @param {string} log the contents of one `history/<ID>.jsonl`
 * @param {string} status the value to look for on the right-hand side
 * @returns {string|null} the entry's `ts`, or null when the log does not say
 */
export function statusSetAt(log, status) {
  if (!log || !status) return null;
  let ts = null;
  for (const line of String(log).split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      // A truncated last line is what a log being appended to right now looks
      // like. It is not a reason to answer nothing about the lines before it.
      continue;
    }
    if (e && e.field === "status" && String(e.to || "") === String(status) && e.ts) ts = String(e.ts);
  }
  return ts;
}

/**
 * The same question asked of ANOTHER working tree's log (TL-210).
 *
 * WHY THAT TREE'S LOG AND NEVER THIS ONE'S. The Execution view draws an elapsed
 * bar under a running card. For a task running in another worktree the only
 * honest source of "since when" is the record that tree wrote: this tree's log
 * would answer with the last time IT held the task — a bar measured from a
 * session that ended days ago, drawn as if somebody were working now.
 *
 * A log that cannot be read is answered with null and no bar, which is the whole
 * reason the reading happens here rather than being reconstructed by the page.
 */
function statusSetAtIn(worktreePath, backlogRel, id, status) {
  const file = join(worktreePath, backlogRel, HISTORY_DIRNAME, id + ".jsonl");
  if (!existsSync(file)) return null;
  try {
    return statusSetAt(readFileSync(file, "utf8"), status);
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// The state itself
// ──────────────────────────────────────────────────────────────────────────

/** One sighting of a task somewhere other than the caller's own tree. */
function observe(byId, id, entry) {
  if (!id) return;
  const list = byId.get(id);
  if (list) list.push(entry);
  else byId.set(id, [entry]);
}

/** Symlinks and trailing separators are the two ways one tree gets two names;
 *  without normalising, the caller's own worktree is read a second time. */
function samePathKey(p) {
  try {
    return realpathSync(p);
  } catch {
    return String(p).replace(/\/+$/, "");
  }
}

/**
 * The status of every task, as seen from every active branch and every other
 * working tree.
 *
 * @param {{repoRoot: string, backlogRel: string, taskFile: RegExp,
 *          days?: number, now?: number, self?: string}} opts
 *        `self` is the working tree the caller has already read for itself; its
 *        uncommitted files are the caller's own answer, not a second opinion,
 *        and so is the committed state of the branch it has checked out.
 * @returns {{byId: Map<string, Array<{status: string, source: string, kind: string,
 *                                     since?: string|null}>>,
 *            branches: string[], trees: string[]}}
 *        `since` is when THAT tree last set the status it reports, read from its
 *        own history log; only worktrees carry it, and only when the log says.
 */
export function scanTaskStates(opts) {
  const { repoRoot, backlogRel, taskFile } = opts;
  const byId = new Map();
  const trees = [];

  const all = worktrees(repoRoot);
  const pinned = new Set(all.map((w) => w.branch).filter(Boolean));
  const selfKey = opts.self ? samePathKey(opts.self) : null;
  // The caller's OWN branch is not a second opinion about the caller's own tree.
  // Without this, every uncommitted `take` would report "main: pending" against
  // itself for as long as the change sat unstaged — a difference between the
  // disk and the last commit, dressed up as a disagreement between sessions.
  // Nobody would read the fourth one of those, which is how a real one gets
  // missed.
  const selfBranch = selfKey
    ? (all.find((w) => samePathKey(w.path) === selfKey) || {}).branch || null
    : null;
  // A branch already merged into this HEAD is not a second opinion either
  // (TL-235), for the same reason the caller's own branch is not: what it holds
  // is what we hold. Dropping it here rather than at each reader keeps `next`,
  // `query`, `plan` and the viewer answering the same question.
  const merged = mergedRefs(repoRoot);
  const refs = activeRefs(repoRoot, { days: opts.days, now: opts.now, pinned }).filter(
    (r) => r.ref !== selfBranch && !merged.has(r.ref)
  );

  // Every blob is read ONCE even when twenty branches share it — which is the
  // usual case, since branches differ from `main` in a handful of tasks. The
  // cache is what keeps the scan proportional to what actually differs rather
  // than to the size of the backlog times the number of branches.
  const parsedBySha = new Map();
  const perRef = refs.map((ref) => ({
    ref,
    entries: taskEntriesInRef(repoRoot, ref.ref, backlogRel).filter((e) => taskFile.test(e.name)),
  }));
  const wanted = [];
  for (const { entries } of perRef) {
    for (const e of entries) {
      if (parsedBySha.has(e.sha)) continue;
      parsedBySha.set(e.sha, null);
      wanted.push(e.sha);
    }
  }
  const blobs = readBlobs(repoRoot, wanted);
  for (const sha of wanted) {
    const raw = blobs.get(sha);
    const rec = raw ? parseTaskRecord(raw, "") : null;
    parsedBySha.set(sha, rec ? { id: rec.id, status: rec.status } : null);
  }

  for (const { ref, entries } of perRef) {
    for (const e of entries) {
      const rec = parsedBySha.get(e.sha);
      if (rec) observe(byId, rec.id, { status: rec.status, source: ref.name, kind: "branch" });
    }
  }

  for (const w of all) {
    if (selfKey && samePathKey(w.path) === selfKey) continue;
    trees.push(w.path);
    for (const rel of dirtyTaskFiles(w.path, backlogRel)) {
      const name = rel.split("/").pop();
      if (!taskFile.test(name)) continue;
      const abs = join(w.path, rel);
      // A deleted task still shows up in `git status`; there is nothing to read
      // and nothing to say about its state.
      if (!existsSync(abs)) continue;
      let rec = null;
      try {
        rec = parseTaskRecord(readFileSync(abs, "utf8"), name);
      } catch {
        continue;
      }
      // `since` only for worktrees, deliberately. A branch's log would have to be
      // read as a blob per ref, and a branch nobody has checked out has nobody
      // standing in it — the state is committed, not being worked on this minute.
      if (rec) {
        observe(byId, rec.id, {
          status: rec.status,
          source: w.path,
          kind: "worktree",
          since: statusSetAtIn(w.path, backlogRel, rec.id, rec.status),
        });
      }
    }
  }

  return { byId, branches: refs.map((r) => r.name), trees };
}

/**
 * The observations that DISAGREE with the local file.
 *
 * The definition of a difference lives here, in one place, so that `query`,
 * `stats` and the viewer cannot each mean something slightly different by it:
 * the field is `status`, and an observation counts when its value differs from
 * the one in this tree. Duplicates collapse per (status, source) — twelve
 * branches all saying `pending` is one fact, not twelve.
 */
export function divergences(localStatus, observations) {
  return collapse((observations || []).filter((o) => String(o.status || "") !== String(localStatus || "")));
}

/** Twelve branches all saying `pending` is one fact, not twelve. */
function collapse(observations) {
  const out = [];
  const seen = new Set();
  for (const o of observations || []) {
    const key = o.status + " " + o.source;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(o);
  }
  return out;
}

/**
 * The tasks the REST of the repository has and this tree does not. PURE.
 *
 * WHY IT IS NOT `divergences` WITH AN EMPTY LOCAL STATUS. There is no local
 * status to differ from — there is no local file at all — so every observation
 * counts, and filtering by inequality would silently drop a task whose status
 * happens to be empty on the branch that has it.
 *
 * @param {Map<string, Array<object>>} byId the scan's observations
 * @param {Iterable<string>} knownIds the ids this tree holds
 * @returns {Array<{id: string, elsewhere: Array<object>}>} sorted by id
 */
export function absentHere(byId, knownIds) {
  const known = new Set();
  for (const id of knownIds || []) known.add(String(id).toUpperCase());
  const out = [];
  for (const [id, observations] of byId || new Map()) {
    if (!id || known.has(String(id).toUpperCase())) continue;
    out.push({ id, elsewhere: collapse(observations) });
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  return out;
}

/**
 * The whole scan for one backlog, decided by its configuration.
 *
 * `reason` is non-null exactly when the scan did NOT run, and it is a reason the
 * caller has to be able to repeat to the user: a listing that quietly answers
 * from one checkout is the defect this module exists to remove, so nobody is
 * left guessing whether the scan happened.
 *
 * @param {string} root the backlog directory
 * @param {object} config a loaded configuration
 * @returns {{scanned: boolean, reason: string|null, byId: Map, branches: string[], trees: string[]}}
 */
export function crossBranchState(root, config, opts = {}) {
  const empty = (reason) => ({ scanned: false, reason, byId: new Map(), branches: [], trees: [] });
  if (!config || config.crossBranchState === false) return empty("disabled");

  const repoRoot = repoRootFor(root);
  if (!repoRoot) return empty("not-a-repository");
  const backlogRel = backlogRelFor(repoRoot, root);
  if (backlogRel === null) return empty("outside-repository");

  const scan = scanTaskStates({
    repoRoot,
    backlogRel,
    taskFile: config.taskId.file,
    days: config.activeBranchDays,
    now: opts.now,
    self: repoRoot,
  });
  return { scanned: true, reason: null, ...scan };
}

/**
 * The one sentence every command uses for a scan that did not run — one
 * wording, so the same situation cannot read as two different ones.
 *
 * `disabled` gets null: the project asked for silence in its configuration, and
 * a note on every listing would be the tool arguing with that decision.
 */
export function scanNote(reason) {
  if (reason === "not-a-repository") {
    return "state from this tree only — the backlog is not in a git repository";
  }
  if (reason === "outside-repository") {
    return "state from this tree only — the backlog lies outside the repository";
  }
  return null;
}

/** `elsewhere` rendered for a human: `feature/x: in_progress`. The wording lives
 *  in elsewhere.mjs, which is also pasted into the generated page — so the
 *  terminal and the viewer cannot drift into naming one situation two ways. */
export { describeElsewhere as describeDivergence } from "./elsewhere.mjs";
