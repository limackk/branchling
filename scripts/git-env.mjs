/**
 * The environment a git call that DISCOVERS a repository runs in (TL-483).
 *
 * WHAT WAS MEASURED. A hook in a linked worktree runs with
 * `GIT_DIR=<repo>/.git/worktrees/<name>` exported and no `GIT_WORK_TREE`. git
 * reads that pair as "the repository is there, and the work tree is the current
 * directory", so `git -C <repo>/backlog rev-parse --show-toplevel` answered
 * `<repo>/backlog`. Every `related_docs` path was then looked up one directory
 * too deep, `check --docs` failed on all of them, and no commit could be made
 * from the worktree — while the same `check` run by hand passed.
 *
 * WHY ONLY `GIT_DIR`, AND ONLY WITHOUT `GIT_WORK_TREE`. With both set the
 * caller has named the work tree explicitly (a bare repository driving a home
 * directory, for one) and git's answer is the one they asked for. With
 * `GIT_DIR` alone, the work tree is inferred from whatever directory the call
 * happens to run in, which for this tool is the backlog directory and not the
 * top of anything. Discovery from that directory finds the same repository
 * through its own `.git` file, so nothing the hook pointed at is lost.
 * `GIT_INDEX_FILE` stays: it never moves the work tree, and a call that reads
 * the staged state of a commit in progress needs the index the hook was given.
 */

/** A copy of `env` without a `GIT_DIR` that would pin the work tree to cwd. */
export function gitDiscoveryEnv(env = process.env) {
  if (!env.GIT_DIR || env.GIT_WORK_TREE) return env;
  const { GIT_DIR: _dropped, ...rest } = env;
  return rest;
}

/**
 * The same rule applied to `env` in place, for an entry point whose children
 * inherit it. Returns whether anything was removed.
 */
export function dropInferredGitDir(env = process.env) {
  if (!env.GIT_DIR || env.GIT_WORK_TREE) return false;
  delete env.GIT_DIR;
  return true;
}
