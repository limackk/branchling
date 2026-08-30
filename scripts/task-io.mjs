#!/usr/bin/env node
/**
 * Reading task metadata off the disk (TL-62).
 *
 * WHY A MODULE OF ITS OWN, and not a function added to a neighbour. The two
 * obvious homes are both closed by a deliberate constraint:
 *
 *   `stats.mjs`       — pure arithmetic, explicitly disk-free, so that a number
 *                       can be tested without creating a directory;
 *   `task-fields.mjs` — its SOURCE is injected into the viewer page, so an
 *                       `import "node:fs"` would break the browser.
 *
 * That leaves a third place. Worth its own file, because the question "which
 * files are tasks" has to have ONE answer: if `stats` and `doctor` filtered by
 * patterns of their own, "65 tasks" and "64 tasks" would both be true and
 * irreconcilable.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { extractMeta, splitFrontmatter } from "./task-fields.mjs";

/** The filenames counted as tasks — the pattern comes from the CONFIGURATION,
 *  never from a constant. */
export function listTaskFileNames(tasksDir, config) {
  return readdirSync(tasksDir).filter((f) => config.taskId.file.test(f)).sort();
}

/** @returns {Array<object>} the frontmatter of every task, in filename order. */
export function readTaskMetas(tasksDir, config) {
  return listTaskFileNames(tasksDir, config).map((f) =>
    extractMeta(splitFrontmatter(readFileSync(join(tasksDir, f), "utf8")).frontmatter)
  );
}
