/**
 * The backlog summary (BL-1412) — a pure function over a list of tasks.
 *
 * Kept apart from `stats-report.mjs`, which is the one that reads the disk and
 * prints: the number is testable without creating a directory, and the
 * formatting can change without touching the arithmetic.
 *
 * The rules this function implements (and which have tests):
 *   - ACTIVE versus ARCHIVED comes from the configuration (`archived_statuses`),
 *     not from the name of the status — otherwise somebody else's backlog using
 *     `closed` instead of `done` would count everything as open;
 *   - the queue (priorities, hours, blockers) is computed from the ACTIVE ones;
 *     closed work is not work to be done;
 *   - a status present in the configuration but unused gets a ZERO instead of
 *     disappearing. A missing row reads as "I did not check", a zero as "I did";
 *   - `divergent` counts the tasks another branch disagrees with (TL-73). The
 *     disagreement is decided by the CALLER (`branch-scan.mjs` fills in
 *     `elsewhere`), because this function must stay computable without a
 *     repository — but the number belongs in the summary, since a backlog whose
 *     state differs across branches is not the backlog the other rows describe.
 *
 * The constraint: no imports other than `estimate.mjs`, and no disk.
 */

import { sumHours } from "./estimate.mjs";

function tally(items, key, seed) {
  const out = Object.create(null);
  for (const s of seed || []) out[s] = 0;
  for (const t of items) {
    const v = t && t[key];
    if (Array.isArray(v)) {
      for (const one of v) out[one] = (out[one] || 0) + 1;
    } else {
      const k = v === undefined || v === null || v === "" ? "—" : v;
      out[k] = (out[k] || 0) + 1;
    }
  }
  return out;
}

/**
 * @param {Array<object>} tasks  the tasks' frontmatter
 * @param {{statuses?: string[], archivedStatuses?: string[], priorities?: string[]}} config
 */
export function summarize(tasks, config) {
  const all = Array.isArray(tasks) ? tasks : [];
  const cfg = config || {};
  const archived = cfg.archivedStatuses || [];
  const isArchived = (t) => archived.indexOf(t && t.status) !== -1;

  const open = all.filter((t) => !isArchived(t));
  const closed = all.filter(isArchived);

  return {
    total: all.length,
    active: open.length,
    archived: closed.length,
    byStatus: tally(all, "status", cfg.statuses),
    byPriority: tally(open, "priority", []),
    byBoard: tally(open, "board", []),
    byType: tally(open, "type", []),
    byLabel: tally(open, "labels", []),
    byEpic: tally(open, "epic", []),
    byOwner: tally(open, "owner", []),
    openHours: sumHours(open),
    blocked: open.filter((t) => Array.isArray(t && t.blocked_by) && t.blocked_by.length > 0).length,
    divergent: all.filter((t) => Array.isArray(t && t.elsewhere) && t.elsewhere.length > 0).length,
  };
}

/** [key, count] pairs sorted descending, skipping zeroes and empties. */
export function ranked(counts, limit) {
  const rows = Object.keys(counts || {})
    .filter((k) => counts[k] > 0 && k !== "—" && k !== "")
    .map((k) => [k, counts[k]])
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return limit ? rows.slice(0, limit) : rows;
}
