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
import { backlogPaths, resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { describeHold, loadPlan, planState, validatePlan } from "./plan.mjs";
import { readHistory } from "./history.mjs";
import { crossBranchState, divergences } from "./branch-scan.mjs";
import { EDIT_SUBCOMMANDS, runPlanEdit, runPlanInit } from "./plan-write.mjs";
import { reportPlanErrors } from "./check-backlog-plan.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { MARK, color, failure, heading, refusal, statusPaint, table, width } from "./ui.mjs";
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
    // The open tasks `next` hands out to NOBODY now (TL-645): left out of next
    // up, so each is named below with its hold. Without that line a claim, or a
    // task awaiting a vouch, would simply vanish from the answer, and the empty
    // line would blame a blocker for what is in fact a hold.
    const withheld = w.tasks.filter((e) => e.open && e.hold && !e.hold.startable);
    if (!state.nextUp.length) {
      out.push("  " + paint.dim(w.held
        ? "none — no open task of this wave is one `next` hands out"
        : withheld.length
          ? "none — `next` hands out the tasks named below to nobody now, and the rest wait on a blocker"
          : "none — every open task of this wave is waiting on a blocker"));
    }
    for (const entry of state.nextUp) {
      const ids = entry.ids.map((id) => paint.id(id)).join(", ");
      // The mark is APPENDED to the row the plan was going to print anyway
      // (TL-199): the order is somebody's decision and `executor:` is a filter
      // the dispatcher applies, so nothing here may reorder or drop a row.
      let mark = entry.waitsOnHuman ? "  " + paint.dim("— asks for an executor an unattended run is not (human)") : "";
      // A group member `next` hands out to nobody is not next up (TL-645), but
      // the group is still one act, so the rest of it is named beside it.
      if (entry.together) {
        const group = w.together.find((g) => g.indexOf(entry.ids[0]) >= 0) || [];
        const members = withheld.filter((e) => group.indexOf(e.id) >= 0);
        if (members.length) {
          mark += "  " + paint.dim("— with " + members.map((e) => e.id).join(", ") + ", which `next` hands out to nobody now");
        }
      }
      // The group is named as a group. Splitting it into three bullets would
      // lose the one thing `together:` says.
      out.push("  " + (entry.together ? "together: " + ids : ids) + mark);
    }
    // Said per wave as well as per row, because the two answers differ: a wave
    // whose only `executor: human` task is still behind a blocker marks no row
    // here and yet cannot be finished by a fleet either.
    if (w.endsOnHuman) {
      out.push("  " + paint.dim("this wave ends on a person — an unattended run cannot close it on its own"));
    }
    // HELD, AND WHY, ONE TASK PER LINE (TL-645). Without it a wave nobody can
    // move printed the same rows as a wave with work in it, while `run
    // --dry-run --plan` stopped here; the sentences are the ones it prints.
    // A wave that is NOT held still names what it withholds, for the same
    // reason: a stalled task must not read as work somebody is about to start.
    if (w.held) {
      out.push("  " + paint.bold("held") + " — no unattended run will take any open task of this wave, so `run --plan` stops here:");
      for (const e of w.tasks) {
        if (e.open && e.hold) out.push("    " + paint.id(e.id) + "  " + describeHold(e.hold));
      }
    } else if (withheld.length) {
      out.push("  " + paint.bold("withheld") + " — `next` hands these out to nobody now:");
      for (const e of withheld) out.push("    " + paint.id(e.id) + "  " + describeHold(e.hold));
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

  const coverage = state.coverage || {
    open: state.unplanned.length,
    planned: 0,
    unplanned: state.unplanned.length,
    share: state.unplanned.length ? 100 : 0,
  };
  out.push("unplanned open tasks: " + (coverage.unplanned
    ? coverage.unplanned + " of " + coverage.open + " (" + coverage.share + "%)"
    : paint.dim("none")));
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
  // A WORD BEFORE THE FLAGS IS AN EDIT (TL-213). The reading form is untouched:
  // `plan` and `plan --json` answer exactly as before, and the writing forms are
  // subcommands rather than flags because `--add TL-1 --wave x` would make one
  // command mean two things depending on which flags happened to be present.
  // An unknown word FAILS — a silent no-op looks like it worked.
  const first = argv[0];
  if (first !== undefined && !first.startsWith("-")) {
    if (first === "init") return runPlanInit(argv.slice(1));
    if (EDIT_SUBCOMMANDS.indexOf(first) < 0) {
      console.error(failure(N + " plan", "unknown subcommand: " + first,
        ["available: init, " + EDIT_SUBCOMMANDS.join(", ") + ", or no subcommand at all to READ the plan"],
        [N + " plan --help"]));
      return 2;
    }
    return runPlanEdit(first, argv.slice(1));
  }

  const cli = takeDirFlag(argv);
  for (const a of cli.argv) {
    if (KNOWN_FLAGS.indexOf(a) < 0) {
      console.error(refusal(N + " plan", "unknown flag: " + a,
        KNOWN_FLAGS.join(" ") + " --dir <path>"));
      return 2;
    }
  }
  const asJson = cli.argv.includes("--json");

  const root = resolveBacklogDirOrExit({ dir: cli.dir, moduleDir: __dirname, jsonKind: asJson ? "plan" : null }, N + " plan").root;
  const config = loadConfigOrExit(root);
  const loaded = loadPlan(backlogPaths(root).planPath);

  if (!loaded.exists) {
    // NOT an error. Ordering is an optional decision; a backlog that has not
    // made it is in a legitimate state, and exit 1 here would turn "we have no
    // plan" into something a CI job fails on.
    if (asJson) {
      printJson("plan", { ok: true, root, exists: false, inProgressStatus: config.inProgressStatus || null });
      return 0;
    }
    console.log(
      color.ok(MARK.ok) +
        ` no plan file — ${backlogPaths(root).planPath} does not exist, and the execution order is optional`
    );
    return 0;
  }

  // A plan that cannot be read or cannot be executed is a REFUSAL, and under
  // `--json` it is still an envelope (TL-534): an empty stdout read as the
  // consumer's own error, and an unreadable file used to answer an empty plan.
  const refuse = (refusalKind, problems, sentence) => {
    reportPlanErrors(problems);
    if (asJson) {
      printJson("plan", {
        ok: false, root, exists: true, inProgressStatus: config.inProgressStatus || null,
        refusalKind, refusal: sentence, problems,
      });
    }
    return 1;
  };

  if (loaded.problems.length) {
    return refuse("plan-unparsable", loaded.problems,
      backlogPaths(root).planPath + " cannot be read as a plan");
  }

  const tasks = readTaskMetas(backlogPaths(root).tasksDir, config);
  for (const task of tasks) task.history = readHistory(root, task.id);
  // What the REST of this clone says about each task (TL-664), attached from
  // the scan `readDispatchRecords` attaches it from: a task claimed in a
  // sibling worktree is one `next` and `run` skip, and a plan that could not see
  // the claim listed it as next up while the run's projection stopped short.
  const scan = crossBranchState(root, config);
  for (const task of tasks) task.elsewhere = divergences(task.status, scan.byId.get(task.id));
  const audit = validatePlan(loaded.plan, tasks, config);
  if (audit.errors.length) {
    return audit.blockedBy.length
      ? refuse("plan-contradicts-blocked-by", audit.errors, "the plan puts a task before what it is blocked by, so the order cannot be executed")
      : refuse("plan-contradicts-tree", audit.errors, "the plan names tasks the tree does not hold as it says");
  }

  // The clock is passed IN, so `planState` stays pure: it is what ages a
  // claim into a parked one (TL-645).
  const state = planState(loaded.plan, tasks, { ...config, now: Date.now() });

  if (asJson) {
    printJson("plan", { ok: true, root, exists: true, ...state });
    return 0;
  }
  console.log(renderPlan(state, config));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("plan-report.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
