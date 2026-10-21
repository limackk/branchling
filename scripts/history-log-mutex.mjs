/**
 * Mutual exclusion for one logical task history while its id is changing
 * (TL-410).
 *
 * The section is keyed by the DESTINATION id recorded by the migration. A
 * writer that still knows the old id and the migration moving that log therefore
 * compute the same name. Unlike the snapshot section, this lock is never held
 * across a whole-tree rewrite: migrate-prefix holds it for one log's rewrite
 * and rename, while renumber releases it between each staging operation. That
 * keeps every hold within the scale `withMutex`'s stale rule was designed for.
 */


import { withMutex } from "./lock.mjs";
import { canonicalPath } from "./canonical-path.mjs";

export function historyLogSection(backlogDir, destinationId) {
  // A not-yet-created backlog still has one stable resolved spelling.
  const path = canonicalPath(backlogDir);
  return "history-log:" + path + "\0" + destinationId;
}

export function withHistoryLogMutex(backlogDir, destinationId, fn, opts = {}) {
  return withMutex(historyLogSection(backlogDir, destinationId), fn, opts);
}
