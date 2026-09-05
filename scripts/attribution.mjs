/**
 * Which task did this minute belong to? (TL-28)
 *
 * THE HARD QUESTION IS NOT "HOW MUCH" BUT "ON WHAT". §8 of
 * docs/backlog-time-tracking.md (a real path — product-name: allow) says why
 * this is where systems of this kind lie most often: time attributed to the
 * wrong task looks exactly like time attributed to the right one, so a wrong
 * answer is indistinguishable from a right one at every point after it is
 * written. The chain below therefore records WHICH LEG settled each row, in the
 * same spirit as `source` beside the author of a field change — metadata about
 * how much the row is worth.
 *
 * FIRST MATCH WINS, in this order:
 *
 *   1. `BACKLOG_TASK` in the environment, or the session focus a person set     → focus
 *   2. the session focus set by this session's own `in_progress` write          → session-state
 *   3. the edited file, when it is `<backlog>/tasks/<ID>-*.md`                   → path
 *   4. the branch or worktree name, when it carries an id                        → branch
 *   5. nothing                                                                   → unknown
 *
 * LEGS 3 AND 4 ARE NOT ENOUGH, AND THAT IS MEASURED, NOT PREDICTED (§8.1). Leg 3
 * fires exactly twice per task — on taking it and on closing it — because all
 * the real work happens in files it cannot see. Leg 4 fires for whatever
 * fraction of branches happen to carry an id. That is why legs 1 and 2 have to
 * be automatic, and why `take` sets the focus itself rather than asking anybody
 * to remember the `focus` command: a mechanism that depends on someone
 * remembering is the failure that disqualified the off-the-shelf tools (§4).
 *
 * WHY THE BRANCH LEG IGNORES CASE. This repository names branches
 * `tl-<number>-<slug>` — lowercase, by the rule in CLAUDE.md — while the
 * configured prefix is `TL`. A case-sensitive match makes leg 4 dead in exactly
 * the repository that wrote it, which §8.1 recorded as an observation about
 * branch naming rather than as a defect. It is a defect: an id is an id
 * whichever case a branch names it in, and the id we RETURN is always the
 * canonical one from the configuration, never the spelling found in the branch.
 *
 * PURE. Every signal is handed in; the one function that has to ask git is
 * marked and takes an injectable runner.
 *
 * Tests: `node --test scripts/tests/attribution.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { basename, dirname } from "node:path";

import { TASK_ENV } from "./focus.mjs";
import { TASKS_DIRNAME } from "./paths.mjs";

/** The legs, in priority order. The last one is an ANSWER, not a failure
 *  (§8.2): an honest `unknown` is what makes the ratio in the report mean
 *  anything. */
export const ATTRIBUTION_CHAIN = ["focus", "session-state", "path", "branch", "unknown"];

/**
 * The id of the task a path names, when the path is a task FILE. PURE.
 *
 * The `tasks/` parent is required, exactly as §8 words the leg. Matching the id
 * anywhere in a path would credit `docs/TL-28-notes.md`, a scratch file, or a
 * branch checked out under a directory of that name — all of which are things
 * ABOUT a task rather than evidence of work on it.
 */
export function taskFromPath(filePath, patterns) {
  if (!filePath || !patterns) return null;
  const name = basename(String(filePath));
  if (basename(dirname(String(filePath))) !== TASKS_DIRNAME) return null;
  const m = name.match(patterns.fileId);
  return m ? m[1] : null;
}

/**
 * The id a branch or worktree name carries, or null. PURE.
 *
 * The id is rebuilt from the configured prefix and the captured number, so
 * `tl-28-fix` and `TL-28-fix` both answer `TL-28` — the canonical spelling and
 * not the branch's.
 */
export function taskFromBranch(branch, patterns) {
  if (!branch || !patterns) return null;
  const re = new RegExp(
    "(?:^|[^A-Za-z0-9])" + patterns.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(\\d+)(?![0-9])",
    "i"
  );
  const m = String(branch).match(re);
  return m ? patterns.prefix + "-" + m[1] : null;
}

/**
 * Run the chain. PURE.
 *
 * @param {{env?: object, focus?: {task: string, origin: string}|null,
 *          filePath?: string, branch?: string}} signals
 * @param {{prefix: string, fileId: RegExp}} patterns  from `taskIdPatterns()`
 * @returns {{task: string|null, attribution: string}}
 */
export function attribute(signals = {}, patterns = null) {
  const env = signals.env || {};

  const declared = String(env[TASK_ENV] || "").trim();
  if (declared) return { task: declared, attribution: "focus" };

  const focus = signals.focus;
  if (focus && focus.task) {
    // The record's own `origin` decides which of the two legs this is. Without
    // it a pointer somebody typed and a pointer a status write left behind
    // would be indistinguishable, and §8 weighs them differently on purpose.
    return {
      task: focus.task,
      attribution: focus.origin === "session-state" ? "session-state" : "focus",
    };
  }

  const fromPath = taskFromPath(signals.filePath, patterns);
  if (fromPath) return { task: fromPath, attribution: "path" };

  const fromBranch = taskFromBranch(signals.branch, patterns);
  if (fromBranch) return { task: fromBranch, attribution: "branch" };

  return { task: null, attribution: "unknown" };
}

/**
 * The checked-out branch, or the worktree's directory name when HEAD is
 * detached. THE ONE IMPURE FUNCTION HERE, and the runner is injectable so the
 * chain can be tested without a repository.
 *
 * A detached HEAD is not a dead end: `run --workers` and `git worktree add`
 * produce trees whose NAME carries the id even when the ref does not, and the
 * leg is about the name either way.
 */
export function currentBranch(root, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const name = r && r.status === 0 ? String(r.stdout).trim() : "";
  if (name && name !== "HEAD") return name;
  return basename(root);
}
