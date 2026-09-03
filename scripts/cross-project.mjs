#!/usr/bin/env node
/**
 * One question asked of every registered backlog at once (TL-36).
 *
 * WHAT IT IS, AND WHAT IT REFUSES TO BE. A VIEW. The pass reads N backlog
 * directories and assembles the answer in memory: no storage of its own, no
 * copied tasks, no cache that would need invalidating. Deleting the registry
 * takes this view away and nothing else (law 2) — every command inside a
 * repository keeps working, because a backlog is found by walking upwards and
 * that answer must never be contradicted by a file.
 *
 * THE IDENTITY IS THE PAIR `(project, id)`, NEVER THE ID. Task numbers are
 * unique within a project, and two projects both having a `TL-12` is the normal
 * case rather than a clash to resolve. A row without its project name is
 * useless, which is why `project` is written onto every row and printed first.
 *
 * AN UNAVAILABLE PROJECT IS PART OF THE ANSWER, not a line on stderr. A
 * registry entry whose directory has been moved or deleted would otherwise turn
 * "you moved the repository" into "that project has no tasks" — and a consumer
 * reading `--json` would count an incomplete set as complete. So `unavailable`
 * travels with the rows, in the text output and in the envelope.
 *
 * THE PER-PROJECT PIPELINE IS SHARED WITH THE SINGLE-PROJECT PATH on purpose:
 * `collectProject()` is what `query` runs against one root as well, so asking
 * five projects gives exactly the five answers asking each of them separately
 * would. Two pipelines would be two definitions of what a row is.
 *
 * Tests: `node --test scripts/tests/cross-project.test.mjs`
 */

import { existsSync } from "node:fs";

import { absentHere, crossBranchState, divergences } from "./branch-scan.mjs";
import { loadConfig } from "./config.mjs";
import { modifiedFiles, repoRoot } from "./modified-files.mjs";
import { backlogPaths, looksLikeBacklogDir } from "./paths.mjs";
import { readRegistry } from "./registry.mjs";
import { readTaskRecords } from "./task-select.mjs";

/**
 * Everything one backlog contributes to an answer. The SAME function for one
 * project and for many.
 *
 * @param {string} root            the backlog directory
 * @param {{modifiedFile?: string, project?: string}} opts
 * @returns {{root, project, config, tasks, scan, elsewhereOnly, index, error}}
 */
export function collectProject(root, opts = {}) {
  const project = opts.project || null;
  // A CALLER THAT ALREADY LOADED THE CONFIGURATION PASSES IT IN, and that is
  // not an optimisation. `loadConfigOrExit` refuses a user-layer file holding
  // project vocabulary with its own message and its own exit code (TL-64); a
  // second load here would answer the same question a second way, and a
  // single-project `query` would stop reporting the refusal it is supposed to.
  // The cross-project pass has the opposite need — one project's broken
  // configuration must not exit the process — so it lets this branch run.
  let config = opts.config || null;
  try {
    if (!config) config = loadConfig(root);
  } catch (e) {
    return { root, project, config: null, tasks: [], scan: null, elsewhereOnly: [], index: null,
      error: "the configuration could not be read: " + e.message };
  }
  if (config.problems && config.problems.length) {
    // THE SAME STRICTNESS AS EVERY OTHER COMMAND (TL-60), but it stops ONE
    // project rather than the pass: a broken config in project four must not
    // silence projects one to three, and it must not be silent either.
    return { root, project, config: null, tasks: [], scan: null, elsewhereOnly: [], index: null,
      error: "the configuration has problems: " + config.problems.join("; ") };
  }

  let tasks;
  try {
    tasks = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  } catch (e) {
    return { root, project, config, tasks: [], scan: null, elsewhereOnly: [], index: null,
      error: "the tasks could not be read: " + e.message };
  }

  const scan = crossBranchState(root, config);
  for (const t of tasks) {
    t.elsewhere = divergences(t.status, scan.byId.get(t.id));
    // ONLY WHERE THERE IS ONE. A single-project answer keeps exactly the shape
    // it always had — adding `project: null` to every row would change a
    // contract for nothing. Which mode produced an answer is already stated
    // once, at the envelope level, by `projects`.
    if (project) t.project = project;
  }
  const elsewhereOnly = absentHere(scan.byId, tasks.map((t) => t.id))
    .map((t) => (project ? { ...t, project } : t));

  let index = null;
  if (opts.modifiedFile !== undefined) {
    index = modifiedFiles({ root: repoRoot(root), prefix: config.taskIdPrefix });
  }
  return { root, project, config, tasks, scan, elsewhereOnly, index, error: null };
}

/**
 * Every registered project, collected. PURE apart from the reads it delegates.
 *
 * `unavailable` carries three different failures under one key, each with its
 * own sentence: a path that is gone, a directory that no longer looks like a
 * backlog, and one whose configuration cannot be read. They are one list
 * because a consumer needs one number — "this answer is short by N projects" —
 * and three sentences because the fixes are different.
 */
export function collectAllProjects(opts = {}) {
  const env = opts.env || process.env;
  const registry = readRegistry(env);
  const collected = [];
  const unavailable = registry.missing.map((p) => ({
    project: p.name,
    root: p.path,
    why: existsSync(p.path)
      ? "the directory is no longer a backlog — no tasks/ beside a config.yaml"
      : "the directory does not exist any more",
  }));

  for (const entry of registry.projects) {
    if (!looksLikeBacklogDir(entry.path, existsSync)) {
      unavailable.push({ project: entry.name, root: entry.path, why: "the directory is no longer a backlog" });
      continue;
    }
    const one = collectProject(entry.path, { project: entry.name, modifiedFile: opts.modifiedFile });
    if (one.error) {
      unavailable.push({ project: entry.name, root: entry.path, why: one.error });
      continue;
    }
    collected.push(one);
  }
  return { registry: registry.path, registered: registry.projects.length + registry.missing.length, collected, unavailable };
}

/**
 * The filter values NO project has heard of.
 *
 * A VALUE IS REFUSED ONLY IF EVERY PROJECT REFUSES IT. Judging `--status
 * shipped` against one project's configuration would refuse a query that is
 * perfectly meaningful in the second; judging it against nothing at all would
 * bring back the defect TL-161 closed, where a typo answers "there is no such
 * work" and an agent stops. The intersection is the only rule that holds both.
 *
 * With NO project available the answer is empty: there is nothing to be wrong
 * about, and the empty result already says the pass reached nobody.
 */
export function unknownEverywhere(collected, f, unknownFor) {
  if (!collected.length) return [];
  let surviving = null;
  for (const one of collected) {
    const here = new Map(unknownFor(f, one.config).map((p) => [p.axis + "\u0000" + p.value, p]));
    if (surviving === null) { surviving = here; continue; }
    for (const key of [...surviving.keys()]) if (!here.has(key)) surviving.delete(key);
  }
  return [...surviving.values()];
}
