#!/usr/bin/env node
/**
 * Guard: a promotion with a gap in its traceability (TL-503).
 *
 * Run through `check --release [--env <stage>] [--trunk <ref>]`, by CI as the
 * step before a deploy. The gaps, and what counts as deployed, are described
 * in `release-gaps.mjs`; this program reads the backlog, prints the findings
 * and decides the exit code from `release_gate` in config.yaml.
 *
 * THE TRUNK IS NAMED IN EVERY REPORT. Unless `--trunk` says otherwise it is the
 * remote's default branch, falling back to `HEAD` (`defaultTrunk()`): on a
 * feature branch `HEAD` holds that branch's own commits, and a task closed
 * there and never merged would read as being on the trunk. A report built on
 * the fallback says so, because the reader cannot otherwise tell.
 *
 * Usage:
 *   node scripts/check-release-gaps.mjs [--dir <backlog>] [--env <stage>] [--trunk <ref>] [--json]
 *
 * Exit 0 = no blocking gap (every gap, under the default `report` mode).
 * Exit 1 = under `require`, a gap not accepted in configuration, a stage ref
 *          that did not resolve, or a trunk that did not resolve in a
 *          repository that has commits; in any mode, git could not be read.
 * Exit 2 = the invocation was wrong (an unknown flag, an undeclared stage).
 *
 * Tests: `node --test scripts/tests/release-gaps.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { defaultTrunk, explain, parseStageSelector } from "./environments.mjs";
import { repoRoot } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { gateVerdict, releaseGaps } from "./release-gaps.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, errColor, plain, refusal } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLAGS = ["--dir", "--env", "--trunk", "--json"];

function short(sha) {
  return sha ? String(sha).slice(0, 12) : "unresolved";
}

function main(argv) {
  const cmd = N + " check --release";
  let taken;
  try {
    taken = takeDirFlag(argv, { missing: "`--dir` with no path" });
  } catch (e) {
    console.error(refusal(cmd, e.message, FLAGS.join(" ")));
    return 2;
  }
  let env = null;
  let trunkFlag = null;
  let json = false;
  const rest = taken.argv;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") { json = true; continue; }
    if (a === "--env" || a === "--trunk") {
      const v = rest[++i];
      if (!v || v.startsWith("--")) {
        console.error(refusal(cmd, "`" + a + "` with no value", FLAGS.join(" ")));
        return 2;
      }
      if (a === "--env") env = v; else trunkFlag = v;
      continue;
    }
    console.error(refusal(cmd, "unknown argument: " + a, FLAGS.join(" ")));
    return 2;
  }

  const root = resolveBacklogDir({ dir: taken.dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);

  let selector = null;
  if (env !== null) {
    const sel = parseStageSelector(env, config.deployTargets);
    if (!sel.ok) {
      console.error(errColor.err(MARK.err) + " " + cmd + " --env: " + sel.message);
      return 2;
    }
    selector = { target: sel.target, stage: sel.stage };
  }

  const repo = repoRoot(root);
  const trunk = trunkFlag ? { spec: trunkFlag, source: "flag" } : defaultTrunk(repo);
  const tasks = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const result = releaseGaps({ root: repo, config, tasks, selector, trunk });
  const mode = config.releaseGate;
  const verdict = gateVerdict(result, mode);

  if (json) {
    // Plain JSON, not an envelope: this document is carried inside
    // `check --json` as the `report` of the `release` guard.
    console.log(JSON.stringify({
      mode, ok: verdict.exit === 0, env, ...result,
      blocking: verdict.blocking.map((g) => g.gap + " " + g.subject),
      summary: summaryLine(result, mode, verdict, plain),
    }));
    return verdict.exit;
  }

  const trunkNote = result.trunk.source === "remote-default" ? "the remote's default branch"
    : result.trunk.source === "flag" ? "named by --trunk"
      : "HEAD — the clone records no remote default branch, so pass --trunk in CI";
  // Outside a git repository the trunk was never read; "unresolved" there would
  // read exactly like the `trunk-unresolved` failure.
  const trunkSha = result.reason === "no-git" ? "not read" : short(result.trunk.sha);
  console.log("trunk: " + result.trunk.spec + " " + trunkSha + " (" + trunkNote + ")");
  const why = explain(result.reason);
  if (!result.scanned) {
    for (const line of unobservableLines(result)) console.log(line);
    console.log(summaryLine(result, mode, verdict));
    return verdict.exit;
  }
  if (why) console.log(MARK.bullet + " " + why);
  for (const r of result.refs) {
    console.log("  " + r.target + "/" + r.stage + "  " + r.spec + "  " + short(r.sha));
  }
  for (const u of result.unknownRefs) {
    console.log(color.warn(MARK.warn) + " " + u.target + "/" + u.stage + ": `" + u.spec + "` is unknown — " + u.why +
      "; nothing in it was judged");
  }
  if (result.excludedBeforeAdoption) {
    console.log(MARK.bullet + " " + result.excludedBeforeAdoption +
      " trunk commit(s) older than the first one naming a task id were not judged");
  }
  for (const line of unobservableLines(result)) console.log(line);
  for (const g of result.gaps) {
    const mark = g.accepted ? MARK.bullet : (mode === "require" ? color.err(MARK.err) : color.warn(MARK.warn));
    console.log(mark + " " + g.gap + (g.accepted ? " (accepted)" : "") + "  " + (/^[0-9a-f]{40}$/.test(g.subject) ? short(g.subject) : g.subject) +
      " — " + g.detail);
    console.log("    in: " + g.where.join(", "));
    if (g.commits.length && !(g.commits.length === 1 && g.commits[0] === g.subject)) {
      console.log("    commits: " + g.commits.map(short).join(", "));
    }
  }
  console.log(summaryLine(result, mode, verdict));
  return verdict.exit;
}

/** What was deliberately not looked at: the tasks of each target in another
 *  repository (TL-507). Printed even at zero tasks, because a target the gate
 *  cannot see is a fact about every run, not about this one's findings. */
export function unobservableLines(result) {
  return (result.unobservable || []).map((u) =>
    MARK.bullet + " " + u.target + ": deployed from the repository `" + u.repository + "`, which this one cannot observe — " +
    u.count + " task(s) name it in `target:` and none of them is judged on its account");
}

/** Why nothing was judged, for the reasons this guard adds to `explain()`. */
function unjudged(result) {
  if (result.reason === "trunk-unresolved") {
    return "the trunk `" + result.trunk.spec + "` does not resolve to a commit in this repository" +
      (result.trunk.source === "flag" ? " — check the `--trunk` value"
        : result.trunk.source === "remote-default" ? " — the remote default branch was not fetched; fetch it or pass --trunk"
          : " — pass --trunk") +
      ", so no stage could be judged";
  }
  return explain(result.reason) || result.reason;
}

function summaryLine(result, mode, verdict, paint = color) {
  if (!result.scanned) {
    const mark = verdict.exit ? paint.err(MARK.err) : result.reason === "trunk-unresolved" ? paint.warn(MARK.warn) : MARK.bullet;
    const tail = verdict.exit && mode === "require" ? " — `release_gate: require` refuses the promotion"
      : result.reason === "trunk-unresolved" ? " — `release_gate: report` does not block" : "";
    return mark + " release: nothing judged — " + unjudged(result) + tail;
  }
  const n = result.gaps.length;
  const blocking = verdict.blocking.length;
  const accepted = n - blocking;
  const counted = n + " gap(s)" + (accepted ? ", " + accepted + " accepted in `release_gate_accept`" : "");
  if (verdict.exit === 0 && mode !== "require") {
    return (n ? paint.warn(MARK.warn) : paint.ok(MARK.ok)) + " release: " + counted +
      " — `release_gate: report` prints them and does not block";
  }
  if (verdict.exit === 0) return paint.ok(MARK.ok) + " release: " + counted + " — nothing blocks the promotion";
  const unknown = result.unknownRefs.length ? ", " + result.unknownRefs.length + " ref(s) unknown" : "";
  return paint.err(MARK.err) + " release: " + counted + ", " + blocking + " blocking" + unknown +
    " — `release_gate: " + mode + "` refuses the promotion";
}

if (process.argv[1] && process.argv[1].endsWith("check-release-gaps.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
