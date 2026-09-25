/**
 * The section that every read-modify-write of `history/.snapshot.json` runs
 * inside (TL-228).
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. Every route that performs a read-modify-
 * write of the snapshot imports this module, so the section name and the mutex
 * wrapper have one definition without making the migrations depend on the
 * history implementation they coordinate with.
 *
 * WHY IT IS NOT `withBacklogMutex`. That one keys by `--git-common-dir`, which
 * is right for a task reservation and for the id counter, because those must be
 * unique across every worktree of one clone. The snapshot is the opposite case:
 * it is gitignored and every worktree has its own, so keying by the repository
 * would make writers in unrelated trees wait for each other while still being
 * right. The resource is one FILE, and the name has to say so.
 *
 * The integration control in `scripts/tests/migration-snapshot-race.test.mjs`
 * holds this section and measures that a real `history --file` run waits for it.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import { withMutex } from "./lock.mjs";

/** `realpath` is what makes two spellings of one directory the same section;
 *  a directory not yet on disk still yields a usable name. */
export function snapshotSection(backlogDir) {
  let path = resolve(backlogDir);
  try {
    path = realpathSync(path);
  } catch {
    // Not yet on disk: the resolved path names the same resource, it simply
    // cannot be canonicalised.
  }
  return "snapshot:" + path;
}

/**
 * Run `fn` with no other process on this machine inside this backlog's
 * snapshot section.
 *
 * THE SECTION IS THE SNAPSHOT, NOT THE MIGRATION. It is deliberately taken
 * around the three snapshot calls and NOT around the file renames that precede
 * them. `MUTEX_STALE_MS` is 30 seconds, and a whole-tree rewrite can outlast
 * it — after which another writer judges the holder dead, takes the section
 * over, and two processes are inside a section that still looks held. A wider
 * section would therefore not be stricter exclusion, it would be exclusion that
 * reports itself and is not there.
 *
 * @param {string} backlogDir
 * @param {Function} fn
 * @param {{env?: object, waitMs?: number, staleMs?: number, now?: () => number}} opts
 */
export function withSnapshotMutex(backlogDir, fn, opts = {}) {
  return withMutex(snapshotSection(backlogDir), fn, opts);
}
