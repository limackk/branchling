/**
 * One spelling for one directory, on every platform (TL-463).
 *
 * Paths reach this tool from two sources that disagree about how to write the
 * same place. Node hands out what it was given: on macOS `/var/…` where git
 * prints `/private/var/…`, and on Windows `C:\Users\RUNNER~1\…` (an 8.3 short
 * name from `os.tmpdir()`) where git prints `C:/Users/runneradmin/…`. Compared
 * as strings, or passed through `relative()`, the two land a backlog "outside
 * the repository" and two worktrees of one repository in two lock namespaces —
 * both silently, because each side is a correct path on its own.
 *
 * WHY `realpathSync.native`. The JavaScript `realpathSync` resolves symbolic
 * links but leaves an 8.3 name as it was; the native call asks the operating
 * system, which expands it. On POSIX the two agree. A path that does not exist
 * (yet, or any more) still gets a stable resolved spelling: a failed
 * canonicalisation must not take a command down.
 */
import { realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export function canonicalPath(path) {
  const absolute = resolve(String(path));
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

/**
 * A path inside the repository as git spells it: relative to the root, with
 * `/` between segments on every platform. This is the form `git ls-files`,
 * `git log -- <path>` and every index this tool builds speak; a `\` from
 * `relative()` on Windows matches none of them.
 */
export function repoRelative(root, path) {
  return relative(canonicalPath(root), canonicalPath(path)).split(sep).join("/");
}
