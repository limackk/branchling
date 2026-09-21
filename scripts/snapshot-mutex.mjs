/**
 * The section that every read-modify-write of `history/.snapshot.json` runs
 * inside (TL-228).
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. `history.mjs` already computes this name
 * for `recordEdit` and `reconcile`, and it computes it privately. The two
 * whole-tree migrations — `migrate-prefix.mjs` and `renumber.mjs` — perform the
 * SAME read-modify-write on the SAME file (`loadSnapshot` → `applyIdMigrations`
 * → `saveSnapshot`) and were doing it with nothing coordinating them, so a
 * writer overlapping with either of them saved a snapshot keyed by the OLD ids
 * over the repointed one and the next reconcile read the whole backlog as
 * deleted and created again — the tombstones `applyIdMigrations` was introduced
 * to prevent (TL-111).
 *
 * WHY IT IS NOT `withBacklogMutex`. That one keys by `--git-common-dir`, which
 * is right for a task reservation and for the id counter, because those must be
 * unique across every worktree of one clone. The snapshot is the opposite case:
 * it is gitignored and every worktree has its own, so keying by the repository
 * would make writers in unrelated trees wait for each other while still being
 * right. The resource is one FILE, and the name has to say so.
 *
 * WHAT THE DUPLICATED NAME COSTS, AND WHAT GUARDS IT. Two modules computing one
 * section name is exactly the shape that switches mutual exclusion off silently
 * if they ever drift — the name is the whole of the agreement. The guard is a
 * POSITIVE CONTROL rather than a comment: the test
 * `scripts/tests/migration-snapshot-race.test.mjs` holds this section and then
 * measures that a real `history --file` run is blocked by it. If the two names
 * stop naming one section, that measurement fails and says why. Collapsing the
 * duplication by exporting the name from `history.mjs` is TL-409.
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
