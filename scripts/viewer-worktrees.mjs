/**
 * The working trees of this clone, as SUBJECTS the viewer can be pointed at
 * (TL-188).
 *
 * WHY THIS IS PRESENTATION, NOT A NEW SOURCE OF TRUTH. `branch-scan.mjs`
 * already reads every branch and every worktree of this clone, which is where
 * an `elsewhere:` badge on a card comes from. What the page could not do was
 * change its own subject: a `run` driving a task in a worktree left the viewer,
 * served from the main checkout, showing a board that had not moved for hours.
 * Nothing was broken — data travels with the branch (law 1) and the server was
 * telling the truth about ITS tree — but the reader saw a still image.
 *
 * THE KEY IS NOT THE PATH. A shared link is the point ("look at the fleet's
 * worktree"), and an absolute path is both ugly in a URL and specific to one
 * machine. The key is the tree's directory name, which is what a person calls
 * it; two trees that share one get a digest of the full path appended, so a key
 * stays stable when a third tree appears.
 *
 * THE LIST IS THE ALLOWLIST. `resolveWorktree()` is the ONLY way a request's
 * parameter becomes a directory to read, and it matches against trees git
 * itself reported. A caller can therefore never name a directory — which is
 * what keeps `?worktree=` from being a path the server will read anything from.
 */

import { existsSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";

import { backlogRelFor, repoRootFor, worktrees } from "./branch-scan.mjs";

/** Symlinks and trailing separators are the two ways one tree gets two names;
 *  without normalising, the server's own tree reads as a foreign one. */
function samePathKey(p) {
  try {
    return realpathSync(p);
  } catch {
    return String(p).replace(/\/+$/, "");
  }
}

/** FNV-1a over the path, base36. Only ever a disambiguator — it never has to be
 *  a cryptographic anything, it has to be short and the same on every run. */
function shortDigest(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

/** A key that survives a link: URL-safe, and never empty. */
function keyFor(path) {
  const name = basename(String(path).replace(/\/+$/, ""));
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || shortDigest(path);
}

/** `refs/heads/claude/x` and `claude/x` are the same branch said two ways. */
function branchName(ref) {
  return ref ? String(ref).replace(/^refs\/heads\//, "") : null;
}

/**
 * The worktree list turned into what a switcher offers. PURE — the git call and
 * the disk check are the caller's, which is what lets a test build the awkward
 * cases (two trees of the same name, a detached HEAD, a tree with no backlog)
 * without a repository for each one.
 *
 * @param {Array<{path: string, branch: ?string}>} trees  what `worktrees()` returned
 * @param {{selfPath: string, backlogRel: string,
 *          hasBacklog?: (dir: string) => boolean}} opts
 *        `backlogRel` is where the backlog sits INSIDE a tree; every worktree of
 *        one repository has the same layout, so the same relative path locates
 *        it in all of them.
 * @returns {Array<{key: string, path: string, branch: ?string, label: string,
 *                  backlogDir: string, isSelf: boolean}>} sorted, the server's
 *          own tree first — it is the only one the page may write to.
 */
export function describeWorktrees(trees, opts) {
  const { selfPath, backlogRel } = opts || {};
  const has = (opts && opts.hasBacklog) || ((dir) => existsSync(join(dir, "tasks")));
  const selfKey = selfPath ? samePathKey(selfPath) : null;

  const found = [];
  for (const t of trees || []) {
    if (!t || !t.path) continue;
    const backlogDir = backlogRel ? join(t.path, backlogRel) : t.path;
    // A tree that does not carry this backlog is not a subject. It is not an
    // error either: a worktree made for something else entirely is a normal
    // thing to have, and listing it would offer a view that must then fail.
    if (!has(backlogDir)) continue;
    found.push({
      path: t.path,
      branch: branchName(t.branch),
      backlogDir,
      isSelf: selfKey !== null && samePathKey(t.path) === selfKey,
    });
  }

  // The name a person uses is the directory's; a second tree with that name is
  // rare enough that paying for it with a digest beats numbering everything.
  const counts = new Map();
  for (const e of found) {
    const k = keyFor(e.path);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const entries = found.map((e) => {
    const base = keyFor(e.path);
    const key = counts.get(base) > 1 ? base + "-" + shortDigest(e.path) : base;
    const name = basename(String(e.path).replace(/\/+$/, "")) || e.path;
    // The branch is what the reader is really choosing between; repeating it
    // when the directory name already carries it would be noise in a one-line
    // control, which is where the whole label has to fit. `git worktree add`
    // and the `claude/` branches both produce exactly that pair.
    const redundant = !e.branch || e.branch === name || e.branch.endsWith("/" + name);
    const label = redundant ? name : name + " — " + e.branch;
    return { ...e, key, label };
  });

  entries.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    return a.key.localeCompare(b.key, undefined, { numeric: true });
  });
  return entries;
}

/**
 * Every working tree of this clone that carries this backlog.
 *
 * `reason` is non-null exactly when the enumeration did NOT run, in the shape
 * `crossBranchState()` uses — the caller has to be able to repeat it, because a
 * switcher that silently offers one tree looks exactly like a clone that has
 * one.
 *
 * @param {string} root the backlog directory the server stands in
 * @returns {{listed: boolean, reason: ?string, entries: Array<object>}}
 */
export function listWorktrees(root) {
  const empty = (reason) => ({ listed: false, reason, entries: [] });
  const repoRoot = repoRootFor(root);
  if (!repoRoot) return empty("not-a-repository");
  const backlogRel = backlogRelFor(repoRoot, root);
  if (backlogRel === null) return empty("outside-repository");

  const entries = describeWorktrees(worktrees(repoRoot), {
    selfPath: repoRoot,
    backlogRel,
  });
  return { listed: true, reason: null, entries };
}

/**
 * The tree a `?worktree=` parameter names, or null.
 *
 * THE WHOLE POINT IS THAT IT CAN RETURN NULL. The parameter arrives from a URL
 * anyone can type; matching it against the enumerated trees means the server
 * reads a directory git reported, never one a request composed. An unknown key
 * is refused rather than falling back to the server's own tree — a silent
 * fallback would answer about the wrong backlog and look like it worked.
 *
 * @param {Array<object>} entries what `listWorktrees()` returned
 * @param {?string} key the requested key; empty or absent means the server's own tree
 */
export function resolveWorktree(entries, key) {
  const list = entries || [];
  const wanted = String(key || "").trim();
  if (!wanted) return list.find((e) => e.isSelf) || null;
  return list.find((e) => e.key === wanted) || null;
}

/** The one sentence for a switcher that has nothing to switch between. */
export function worktreeNote(reason) {
  if (reason === "not-a-repository") {
    return "this tree only — the backlog is not in a git repository";
  }
  if (reason === "outside-repository") {
    return "this tree only — the backlog lies outside the repository";
  }
  return null;
}
