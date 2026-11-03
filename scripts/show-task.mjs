#!/usr/bin/env node
/**
 * show-task.mjs — the facts COMPUTED about one task, which its file does not
 * hold (TL-509).
 *
 * WHAT WAS MISSING. Every reading command answered about a LIST. The one-task
 * question — "where is this deployed, does another branch disagree about it,
 * is it still waiting on something" — was reachable only as
 * `query --text <ID> --status <every status> --json`, which a person cannot
 * read and an agent has to assemble flag by flag.
 *
 * WHAT IT PRINTS, decided by the owner on 2026-11-02:
 *
 *   1. the deployment state per target and stage (TL-501), with the trunk and
 *      every ref read and its SHA, `unknown` for a ref that did not resolve, a
 *      line of its own for a task no commit names, and `unobservable` for a
 *      target whose code lives in another repository (TL-507, TL-512);
 *   2. the task's status on other branches and worktrees where it differs from
 *      this tree — the `elsewhere` computation `query` uses (TL-73);
 *   3. each `blocked_by` task with its current status, and whether the task is
 *      still blocked — by the dispatcher's own rule (`blockerResolved`).
 *
 * WHAT IT DOES NOT PRINT: the markdown body or the frontmatter beyond a
 * one-line header. The file is read directly; reprinting it would make this a
 * second, more expensive way to read what is already one `cat` away, and the
 * value of the command is exactly the facts that are NOT in the file.
 *
 * NOTHING IS REUSED FROM A VIEW. Like `query`, it reads `tasks/*.md` and git,
 * so a status changed a moment ago is already the answer.
 *
 * Exit: 0 = answered, 1 = no such task in this tree, 2 = a usage error.
 *
 * Tests: `node --test scripts/tests/show.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { absentHere, crossBranchState, describeDivergence, divergences, scanNote } from "./branch-scan.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { externalTargetsOf } from "./deploy-targets.mjs";
import {
  TRUNK_SOURCE_TEXT, defaultTrunk, deploymentScanJson, deploymentState, describeTaskDeployment, explain,
  taskDeployment, taskDeploymentJson,
} from "./environments.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { blockerResolved } from "./next-task.mjs";
import { backlogPaths, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { printLine } from "./stdout.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, priorityPaint, refusal, statusPaint, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMAND = N + " show";
const KNOWN = ["--json", "--body"];

function shortSha(sha) { return sha ? sha.slice(0, 12) : null; }

// ──────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────

/**
 * PURE apart from what it throws. `{ code, problem, available }` on a refusal,
 * so the caller prints it in the one shape every command shares.
 */
export function parseShowArgs(argv) {
  let taken;
  try {
    taken = takeDirFlag(argv, { missing: "--dir needs a value" });
  } catch (e) {
    throw { code: 2, problem: e.message, available: KNOWN.concat(["--dir"]).join(" ") };
  }
  let id = null;
  let json = false;
  let body = false;
  let literal = false;
  for (const a of taken.argv) {
    if (!literal && a === "--") { literal = true; continue; }
    if (!literal && a === "--json") { json = true; continue; }
    if (!literal && a === "--body") { body = true; continue; }
    if (!literal && a.startsWith("-")) {
      throw { code: 2, problem: "unknown flag: " + a, available: KNOWN.concat(["--dir"]).join(" ") };
    }
    if (id) throw { code: 2, problem: "unexpected argument: " + a + " (one task id, " + id + ", was already given)", available: KNOWN.concat(["--dir"]).join(" ") };
    id = a;
  }
  if (!id) throw { code: 2, problem: "no task id — usage: " + N + " show <ID> [--json]", available: KNOWN.concat(["--dir"]).join(" ") };
  // The body is printed for a PROGRAM only: the text form answers what the
  // file does not hold, and a person reads the file itself.
  if (body && !json) throw { code: 2, problem: "--body is a key of the --json answer, and needs --json", available: KNOWN.concat(["--dir"]).join(" ") };
  return { id, json, body, dir: taken.dir };
}

// ──────────────────────────────────────────────────────────────────────────
// The computation
// ──────────────────────────────────────────────────────────────────────────

/**
 * Everything `show` answers, as data. Reads the tree, the branches and git; it
 * writes nothing.
 *
 * @returns {{ok: true, ...}|{ok: false, refusalKind: string, refusal: string, details: string[]}}
 */
export function computeShow({ root, config, id }) {
  const records = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const byId = new Map(records.map((t) => [String(t.id).toUpperCase(), t]));
  const scan = crossBranchState(root, config);
  const task = byId.get(String(id).toUpperCase());

  if (!task) {
    // A task only another branch has is not a row of this tree — the same line
    // `query` draws (TL-145) — but naming where it is beats "no such task".
    const away = absentHere(scan.byId, records.map((t) => t.id))
      .find((t) => String(t.id).toUpperCase() === String(id).toUpperCase());
    if (away) {
      return {
        ok: false, id: away.id, refusalKind: "elsewhere-only",
        refusal: "there is no task " + away.id + " in this tree; another branch or worktree has it",
        details: away.elsewhere.map((o) => "elsewhere: " + describeDivergence(o)),
      };
    }
    return {
      ok: false, id, refusalKind: "no-such-task",
      refusal: "there is no task " + id + " in " + backlogPaths(root).tasksDir,
      details: [],
    };
  }

  const archived = new Set(config.archivedStatuses);
  const blockers = (task.blocked_by || []).map((ref) => {
    const b = byId.get(String(ref).toUpperCase());
    if (!b) {
      const away = absentHere(scan.byId, records.map((t) => t.id))
        .find((t) => String(t.id).toUpperCase() === String(ref).toUpperCase());
      return {
        id: ref, title: null, status: null, resolved: false, found: false,
        elsewhere: away ? away.elsewhere : [],
      };
    }
    return {
      id: b.id, title: b.title, status: b.status, resolved: blockerResolved(b, archived), found: true,
      elsewhere: divergences(b.status, scan.byId.get(b.id)),
    };
  });

  return {
    ok: true,
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    confidence: task.confidence,
    blocks: task.blocks || [],
    file: task.file,
    ...computeDeploy({ root, config, task }),
    elsewhere: divergences(task.status, scan.byId.get(task.id)),
    scan: { scanned: scan.scanned, reason: scan.reason, branches: scan.branches, trees: scan.trees.length },
    blockers,
    blocked: blockers.some((b) => !b.resolved),
  };
}

/**
 * One task's deployment answer, with the scan it came from. `null` when the
 * project declares no `deploy_targets` — the same rule `query --json` follows:
 * nobody computed it, which is not the same as "deployed nowhere".
 */
function computeDeploy({ root, config, task }) {
  const targets = config.deployTargets;
  if (!targets || !targets.length) return { deploy: null, deployLines: [] };
  const repo = repoRoot(root);
  // The remote's default branch, as `deploy status` reads it: on a feature
  // branch `HEAD` holds that branch's own commits, and a task worked there
  // would read as merged.
  const trunk = defaultTrunk(repo);
  const state = deploymentState({ root: repo, prefix: config.taskIdPrefix, targets, trunk: trunk.spec });
  const scanJson = deploymentScanJson(state);
  const away = externalTargetsOf(targets, task);
  const answer = taskDeployment(state, task.id);
  const deploy = {
    scanned: scanJson.scanned,
    reason: scanJson.reason,
    explanation: state.reason === "ok" ? null : explain(state.reason),
    trunk: { spec: state.trunk.spec, sha: state.trunk.sha, source: trunk.source },
    refs: scanJson.refs,
    // The task's own answer: per target and stage, plus `unobservable`.
    ...taskDeploymentJson(answer, away),
  };
  // The text lines come from the same describer `environments.mjs` gives every
  // report, so `show` cannot word a state differently from the rest.
  return { deploy, deployLines: state.scanned ? describeTaskDeployment(answer) : [] };
}

/** The model as the envelope carries it. */
export function showJson(model) {
  if (!model.ok) return model;
  const out = { ...model };
  delete out.deployLines;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────

export function renderShow(model, config, paint = color) {
  const lines = [];
  const st = statusPaint(config, paint);
  const pr = priorityPaint(config, paint);
  lines.push(paint.id(model.id) + "  " + model.title + "  " +
    [st(model.status), pr(model.priority)].filter(Boolean).join(" " + MARK.bullet + " "));

  // 1. Deployment
  lines.push("");
  lines.push(paint.bold("deploy"));
  const d = model.deploy;
  if (!d) {
    lines.push("  " + paint.dim(explain("no-targets")));
  } else {
    const rows = [];
    rows.push(["  trunk", (d.trunk.spec || "") + " " + (shortSha(d.trunk.sha) || "unresolved") +
      (TRUNK_SOURCE_TEXT[d.trunk.source] ? "  " + paint.dim("(" + TRUNK_SOURCE_TEXT[d.trunk.source] + ")") : "")]);
    for (const l of model.deployLines) {
      const cut = l.indexOf(": ");
      rows.push(cut > 0 ? ["  " + l.slice(0, cut), l.slice(cut + 2)] : ["", l]);
    }
    for (const u of d.unobservable) {
      rows.push(["  " + u.target, paint.warn("unobservable") + " — deployed from `" + u.repository + "`, which is not read here"]);
    }
    if (d.explanation) rows.push(["", paint.dim(d.explanation)]);
    // Every ref read, with its SHA: the answer is only as fresh as these.
    d.refs.forEach((r, i) => {
      const where = r.target + "/" + r.stage + "  " + r.spec;
      const value = r.sha ? shortSha(r.sha) : paint.warn("unknown") + " — " + r.why;
      rows.push([i === 0 ? "  refs read" : "", where + "  " + value]);
    });
    lines.push(table(rows));
  }

  // 2. Other branches and worktrees
  lines.push("");
  lines.push(paint.bold("elsewhere"));
  if (model.elsewhere.length) {
    for (const o of model.elsewhere) lines.push("  " + describeDivergence(o));
  } else if (model.scan.scanned) {
    lines.push("  " + paint.dim("no other branch or worktree disagrees (" + model.scan.branches.length +
      " branch(es) and " + model.scan.trees + " worktree(s) read)"));
  } else {
    const note = scanNote(model.scan.reason);
    lines.push("  " + paint.dim(note || "not read — `cross_branch_state` is off in config.yaml"));
  }

  // 3. Blockers
  lines.push("");
  if (!model.blockers.length) {
    lines.push(paint.bold("blockers") + "  " + paint.dim("none"));
  } else {
    const open = model.blockers.filter((b) => !b.resolved).length;
    lines.push(paint.bold("blockers") + "  " + (model.blocked
      ? paint.warn("still blocked") + " — " + open + " of " + model.blockers.length + " open"
      : paint.ok("not blocked") + " — every blocker is closed"));
    const rows = model.blockers.map((b) => {
      const mark = b.resolved ? paint.ok(MARK.ok) : paint.err(MARK.err);
      const status = b.found ? st(b.status) : "no such task in this tree";
      const where = b.elsewhere.length ? paint.dim("elsewhere: " + b.elsewhere.map(describeDivergence).join(", ")) : "";
      return ["  " + mark, paint.id(b.id), status, (b.title || "") + (where ? "  " + where : "")];
    });
    lines.push(table(rows));
  }
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

/**
 * The markdown after a task's frontmatter, verbatim (TL-542) — "" when there is
 * none. Closed tasks live in `tasks/` too, so this reaches them alike. The text
 * is the task author's and UNTRUSTED: a consumer renders it as markdown it
 * did not write.
 */
export function taskBody(root, file) {
  const text = readFileSync(join(root, file), "utf8");
  const m = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return m ? text.slice(m[0].length) : text;
}

export function run(argv) {
  let plan;
  try {
    plan = parseShowArgs(argv);
  } catch (e) {
    if (!e || e.code === undefined) throw e;
    console.error(refusal(COMMAND, e.problem, e.available));
    return e.code;
  }
  const root = resolveBacklogDirOrExit({ dir: plan.dir || undefined, moduleDir: __dirname }, COMMAND).root;
  const config = loadConfigOrExit(root);
  const model = computeShow({ root, config, id: plan.id });

  if (!model.ok) {
    if (plan.json) printJson("task-show", showJson(model));
    else console.error(failure(COMMAND, model.refusal, model.details, [N + " query --text " + plan.id + " --status " + config.statuses.join(",")]));
    return 1;
  }
  if (plan.json) printJson("task-show", { ...showJson(model), body: plan.body ? taskBody(root, model.file) : null });
  else printLine(renderShow(model, config));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("show-task.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
