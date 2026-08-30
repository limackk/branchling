#!/usr/bin/env node
/**
 * Guard: the execution plan (`plan.yaml`) does not contradict the tree (TL-107).
 *
 * WHAT IT PROTECTS. The plan is DATA — an order somebody decided — and the one
 * thing about it that IS computable is whether that order can be executed at
 * all. A plan that schedules a task before the task it is blocked by is not a
 * matter of opinion, and without a guard it fails silently: the file still
 * parses, the viewer still draws waves, and the first person to follow it walks
 * into a dependency nobody scheduled.
 *
 * WHY A MISSING FILE IS NOT A FAILURE. Ordering is optional; a backlog with no
 * plan has simply not made that decision, which is a legitimate state and not a
 * defect to report. The guard says so out loud rather than printing a ✓ that
 * would read as "the plan is fine".
 *
 * WHY THE ✓ COUNTS THINGS. A guard that passes over an empty sample is green
 * with no evidential force (CLAUDE.md). The success line names how many tasks
 * across how many waves were judged, so "checked nothing" cannot be mistaken for
 * "checked and clean" — and the tests carry a positive control for the same
 * reason.
 *
 * Usage:
 *   node scripts/check-backlog-plan.mjs [--dir <backlog>]
 *
 * Exit 0 = clean (warnings are printed and do not fail).
 * Exit 1 = the plan cannot be read, or it contradicts the tree.
 *
 * Tests: `node --test scripts/tests/plan.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { loadPlan, validatePlan } from "./plan.mjs";
import { listTaskFileNames } from "./task-io.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { MARK, color, errColor } from "./ui.mjs";
// The product name comes from the manifest, never from a literal (CLAUDE.md).
import { PRODUCT_NAME as N } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @returns {{exists: boolean, errors: string[], warnings: string[],
 *            planned: number, waves: number}}
 */
export function auditPlan(root, config, read = readFileSync) {
  const paths = backlogPaths(root);
  const loaded = loadPlan(paths.planPath, read);
  if (!loaded.exists) return { exists: false, errors: [], warnings: [], planned: 0, waves: 0 };
  if (loaded.problems.length) {
    // A file that cannot be read is not validated against the tree: every answer
    // would be an answer about a plan nobody wrote.
    return { exists: true, errors: loaded.problems, warnings: [], planned: 0, waves: 0 };
  }

  const tasks = listTaskFileNames(paths.tasksDir, config).map((f) => {
    const meta = extractMeta(splitFrontmatter(read(join(paths.tasksDir, f), "utf8")).frontmatter);
    return { id: meta.id, status: meta.status, blocked_by: meta.blocked_by };
  });

  return { exists: true, ...validatePlan(loaded.plan, tasks, config) };
}

/**
 * The refusal, in ONE place (TL-108). `plan` reads the same file and has to
 * refuse a contradictory plan for the same reason and in the same words — two
 * wordings of one defect send the reader looking for two different problems.
 */
export function reportPlanErrors(errors) {
  console.error(ERRM + " backlog: plan.yaml disagrees with the tasks");
  for (const e of errors) console.error("  - " + e);
  console.error("");
  console.error("The plan is advisory, but it may not contradict `blocked_by`: an order that puts a");
  console.error("task before its own blocker cannot be executed, so it is a defect in the plan and");
  console.error("never a reason to edit the dependency. Move the task to a later wave, or schedule");
  console.error("the blocker in an earlier one.");
}

function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${N} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-plan.mjs [--dir <backlog>]");
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const result = auditPlan(root, config);

  if (!result.exists) {
    console.log(`${OKM} backlog: no plan.yaml — the execution order is optional and this backlog has none`);
    return 0;
  }

  for (const w of result.warnings) console.error(`${WARNM} plan: ${w}`);

  if (!result.errors.length) {
    console.log(
      `${OKM} backlog: plan.yaml schedules ${result.planned} task(s) across ${result.waves} wave(s), ` +
        `and no wave stands before something it is blocked by`
    );
    return 0;
  }

  reportPlanErrors(result.errors);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-plan.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
