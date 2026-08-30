#!/usr/bin/env node
/**
 * The `plan` command — where the execution order has got to (TL-108).
 *
 * WHAT IT IS FOR. `plan.yaml` is DATA: an order somebody decided, which nothing
 * in the tree can recompute (TL-107). What IS computable is where that order
 * has got to — which wave is active, what may be started now, what ran ahead,
 * and what the plan has stopped covering. Without this command an agent has to
 * assemble that graph itself out of seventy task files and a YAML file; with
 * `--json` it is one call.
 *
 * THE ARITHMETIC IS NOT HERE. `planState` in `plan.mjs` owns the five
 * definitions, because the viewer (TL-109) reads the same ones and two copies
 * would eventually disagree about which task is next. This file is the disk
 * read, the flags, the exit codes and the formatting — the same three-layer
 * split as `stats` / `stats-report`.
 *
 * IT READS `tasks/*.md`, NOT THE GENERATED VIEWS. Those are a snapshot of the
 * last build; a plan read out of a snapshot describes a backlog that may have
 * moved an hour ago, and it reads exactly like a current answer.
 *
 * WHY A CONTRADICTORY PLAN REFUSES INSTEAD OF REPORTING. An order that puts a
 * task before its own blocker cannot be executed, so every line computed from it
 * — starting with "next up" — would be advice to do something impossible. The
 * refusal is the guard's, word for word (`reportPlanErrors`): one defect must
 * not have two wordings.
 *
 * Exit: 0 = the plan was read (a backlog with no plan.yaml included)
 *       1 = the plan cannot be read, or it contradicts the tree
 *       2 = the invocation was wrong
 *
 * Tests: `node --test scripts/tests/plan-command.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadPlan, planState, validatePlan } from "./plan.mjs";
import { reportPlanErrors } from "./check-backlog-plan.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { MARK, color, heading, statusPaint, table, width } from "./ui.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWN_FLAGS = ["--json"];

/** Ids on as few lines as the terminal allows. A list that runs off the right
 *  edge is a list nobody reads to the end — and the ones at the end are the
 *  point of `unplanned`. */
export function wrapIds(ids, indent, columns) {
  const out = [];
  let row = "";
  for (const id of ids) {
    const piece = row ? row + ", " + id : id;
    // `+ 1` reserves the comma the flushed line ends with: without it the very
    // line this function exists to keep inside the terminal is one character too
    // wide, which is the only width that ever actually wraps.
    if (row && indent.length + piece.length + 1 > columns) {
      out.push(indent + row + ",");
      row = id;
      continue;
    }
    row = piece;
  }
  if (row) out.push(indent + row);
  return out;
}

/**
 * The whole text answer, as a string. PURE — the tests read it without a
 * terminal, and the shape of the report is asserted without asserting colour.
 *
 * EVERY SECTION IS PRINTED EVEN WHEN IT IS EMPTY, with the word `none`. A
 * missing section reads as "I did not look", and the two sections most worth
 * trusting when empty — `unplanned` and `stale` — are exactly the ones a reader
 * would otherwise never see.
 */
export function renderPlan(state, config, opts = {}) {
  const paint = opts.color || color;
  const columns = opts.columns || width();
  const paintStatus = statusPaint(config, paint);
  const out = [];

  const title = (config.projectName || "Backlog") + " — execution plan";
  out.push(heading(state.updated ? title + " (updated " + state.updated + ")" : title, { color: paint }));
  if (state.rationale) out.push("  " + paint.dim(state.rationale));
  out.push("");

  const rows = state.waves.map((w) => [
    "  " + (w.active ? MARK.arrow : " ") + " wave " + (w.index + 1),
    w.name || "(unnamed)",
    w.open + " open",
    w.closed + " closed",
    w.active ? paint.bold("active") : "",
  ]);
  out.push(rows.length ? table(rows) : "  " + paint.dim("the plan schedules no waves"));
  out.push("");

  if (state.activeWave === null) {
    out.push("next up: " + paint.dim("none — every task the plan schedules is closed"));
  } else {
    const w = state.waves[state.activeWave];
    out.push("next up (wave " + (w.index + 1) + " — " + (w.name || "unnamed") + "):");
    if (!state.nextUp.length) {
      out.push("  " + paint.dim("none — every open task of this wave is waiting on a blocker"));
    }
    for (const entry of state.nextUp) {
      const ids = entry.ids.map((id) => paint.id(id)).join(", ");
      // The group is named as a group. Splitting it into three bullets would
      // lose the one thing `together:` says.
      out.push("  " + (entry.together ? "together: " + ids : ids));
    }
  }
  out.push("");

  out.push("in progress:");
  if (!state.inProgressStatus) {
    // Law 3: the word for work in flight is the project's. Without
    // `in_progress_status` and without the default vocabulary's own word, there
    // is nothing to count — and a silent empty list would read as "nobody is
    // working on anything".
    out.push("  " + paint.dim("this backlog declares no in-progress status, so there is nothing to count"));
  } else if (!state.inProgress.length) {
    out.push("  " + paint.dim("none"));
  } else {
    for (const t of state.inProgress) {
      out.push("  " + paint.id(t.id) + "  " + paintStatus(t.status) + "  wave " + (t.wave + 1));
    }
  }
  out.push("");

  out.push("unplanned open tasks: " + (state.unplanned.length || paint.dim("none")));
  if (state.unplanned.length) {
    out.push(...wrapIds(state.unplanned.map((t) => t.id), "  ", columns));
  }
  out.push("");

  out.push("stale — closed in a wave after the active one: " + (state.stale.length || paint.dim("none")));
  if (state.stale.length) {
    out.push(...wrapIds(state.stale.map((t) => t.id + " (wave " + (t.wave + 1) + ")"), "  ", columns));
  }

  return out.join("\n");
}

function main(argv) {
  const cli = takeDirFlag(argv);
  for (const a of cli.argv) {
    if (KNOWN_FLAGS.indexOf(a) < 0) {
      console.error(`${N} plan: unknown flag: ` + a);
      console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
      return 2;
    }
  }
  const asJson = cli.argv.includes("--json");

  const root = resolveBacklogDir({ dir: cli.dir, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const loaded = loadPlan(backlogPaths(root).planPath);

  if (!loaded.exists) {
    // NOT an error. Ordering is an optional decision; a backlog that has not
    // made it is in a legitimate state, and exit 1 here would turn "we have no
    // plan" into something a CI job fails on.
    if (asJson) {
      printJson("plan", { root, exists: false, inProgressStatus: config.inProgressStatus || null });
      return 0;
    }
    console.log(
      color.ok(MARK.ok) +
        ` no plan file — ${backlogPaths(root).planPath} does not exist, and the execution order is optional`
    );
    return 0;
  }

  if (loaded.problems.length) {
    reportPlanErrors(loaded.problems);
    return 1;
  }

  const tasks = readTaskMetas(backlogPaths(root).tasksDir, config);
  const audit = validatePlan(loaded.plan, tasks, config);
  if (audit.errors.length) {
    reportPlanErrors(audit.errors);
    return 1;
  }

  const state = planState(loaded.plan, tasks, config);

  if (asJson) {
    printJson("plan", { root, exists: true, ...state });
    return 0;
  }
  console.log(renderPlan(state, config));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("plan-report.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
