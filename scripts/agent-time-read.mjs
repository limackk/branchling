/**
 * The disk half of agent time (TL-480): the task files and the ledger, handed
 * to the pure arithmetic in `agent-time.mjs`.
 *
 * Kept apart for the reason `stats.mjs` and `stats-report.mjs` are: the number
 * is testable without a directory, and the three commands that print it —
 * `stats --agent-time`, `new --estimate`, `next` — read it the same way, so
 * they cannot give two different ranges for one estimate.
 */

import { agentTime } from "./agent-time.mjs";
import { readAllHistory } from "./history.mjs";
import { backlogPaths } from "./paths.mjs";
import { readTaskMetas } from "./task-io.mjs";

/**
 * The report for one backlog. `tasks` and `history` may be passed by a caller
 * that has already read them, so a command does not read the tree twice.
 */
export function readAgentTime(root, config, { tasks, history } = {}) {
  const metas = tasks || readTaskMetas(backlogPaths(root).tasksDir, config);
  const ledger = history || readAllHistory(root);
  const at = config.agentTime || {};
  return agentTime(metas, ledger, {
    inProgressStatus: config.inProgressStatus,
    // The FIRST archived status, as `done` closes into it (`closingStatus`):
    // the vocabulary is the project's, and a cancelled task's time says nothing
    // about what its estimate would have cost.
    closedStatus: (config.archivedStatuses || [])[0],
    minN: at.minN,
    capHours: at.capHours,
  });
}
