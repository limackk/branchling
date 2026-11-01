#!/usr/bin/env node
/**
 * `release status` — what waits for which environment (TL-502).
 *
 * WHAT IT ANSWERS. For every deploy target, the promotion pipeline as a row of
 * buckets, each holding the tasks that stand between two adjacent steps:
 *
 *   closed, not on the trunk       an archived task whose commits exist only off the trunk
 *   on the trunk, waiting for S1   on the trunk, not yet in full in the first stage
 *   in S1, waiting for S2          in full in S1, not in full in S2 — and so on
 *   in Sn                          reached the last stage: COUNTED, never listed,
 *                                  because it grows with the project's whole history
 *
 * A task is placed by the FIRST stage that does not hold it in full, so a task
 * a hotfix put into production before test waits for test: the question asked
 * is "what does the next promotion carry", not "how far did it ever get".
 *
 * WHY A COMPUTED VIEW. Jira answers this with a release hub plus a Deployments
 * panel, Linear with Releases per pipeline; here the answer is read from git and
 * the task files on every call (`scripts/environments.mjs`), so it cannot go
 * stale between builds. The design is `docs/release-tracking.md`.
 *
 * THE TRUNK is the remote's default branch when the clone knows one, else
 * `HEAD` (`defaultTrunk()`), and the report says which. On a feature branch
 * `HEAD` would hold the branch's own commits and a task closed there would
 * read as merged.
 *
 * UNKNOWN IS NOT ZERO. A stage whose ref does not resolve makes its bucket, and
 * every bucket after it, `unknown`: no task can be placed past a stage nobody
 * could read, and "0 in production" there would read as "nothing deployed".
 *
 * HOW LONG A TASK HAS WAITED. Git records no deploy time. The wait is measured
 * from the newest commit of the task for that target, or — when the stage it
 * already stands in is a ref pointing at an annotated tag — from the tag's date,
 * the newest across parallel refs. An archived task off the trunk waits from the
 * day its history records it closed, else its `updated:` date.
 *
 * Tests: `node --test scripts/tests/release-status.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { pathInTarget } from "./deploy-targets.mjs";
import {
  defaultTrunk, deploymentScanJson, deploymentState, explain, parseStageSelector,
  parseTrunkLog, taskDeployment, trunkLogArgs,
} from "./environments.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { readHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { taskIdScanner } from "./task-id.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

export const STATUS_FLAGS = ["--target", "--env", "--count", "--json"];
const VALUE_FLAGS = ["--target", "--env"];

/** The bucket kinds, in pipeline order. */
export const BUCKET_KINDS = Object.freeze(["closed-off-trunk", "waiting", "reached"]);

function git(run, root, args) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, env: gitDiscoveryEnv(),
  });
}

/** PURE — the flags of `release status`. Throws with the available set on the
 *  second line, which is the shape `refusal()` prints. */
export function parseStatusArgs(argv) {
  const opts = { target: null, env: null, count: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--count") { opts.count = true; continue; }
    if (a === "--json") { opts.json = true; continue; }
    if (VALUE_FLAGS.indexOf(a) >= 0) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("`" + a + "` with no value\n" + STATUS_FLAGS.join(" ") + " --dir <path>");
      opts[a.slice(2)] = v;
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\n" + STATUS_FLAGS.join(" ") + " --dir <path>");
    throw new Error("unexpected argument: " + a + "\n" + STATUS_FLAGS.join(" ") + " --dir <path>");
  }
  return opts;
}

/**
 * PURE — narrows the declared targets to what `--target` and `--env` select.
 * An unknown name FAILS: zero tasks caused by a typo read exactly like an answer.
 *
 * @returns {{ok: true, target: string|null, stage: string|null} | {ok: false, message: string}}
 */
export function resolveFilter({ target, env }, targets) {
  const declared = (targets || []).map((t) => t.name);
  if (target !== null && declared.indexOf(target) < 0) {
    return {
      ok: false,
      message: declared.length
        ? "`" + target + "` is not a declared deploy target (declared: " + declared.join(", ") + ")"
        : "this project declares no `deploy_targets` in config.yaml, so it has no target `" + target + "`",
    };
  }
  if (env === null) return { ok: true, target, stage: null };
  const sel = parseStageSelector(env, targets);
  if (!sel.ok) return sel;
  if (sel.target !== null && target !== null && sel.target !== target) {
    return { ok: false, message: "`--env " + env + "` names target `" + sel.target + "`, but `--target` is `" + target + "`" };
  }
  const t = sel.target !== null ? sel.target : target;
  if (t !== null) {
    const spec = targets.find((x) => x.name === t);
    if (!spec.stages.some((s) => s.name === sel.stage)) {
      return { ok: false, message: "target `" + t + "` declares no stage `" + sel.stage + "` (declared: " + spec.stages.map((s) => s.name).join(", ") + ")" };
    }
  }
  return { ok: true, target: t, stage: sel.stage };
}

/** The date an archived task closed: its last recorded move into an archived
 *  status, else its `updated:` field. ISO day, or null. */
export function closedDate(entries, meta, archived) {
  let last = null;
  for (const e of entries || []) {
    if (e && e.field === "status" && archived.indexOf(e.to) >= 0 && typeof e.ts === "string") last = e.ts;
  }
  if (last) return last.slice(0, 10);
  return meta && meta.updated ? String(meta.updated).slice(0, 10) : null;
}

function waitedDays(since, now) {
  if (since === null || since === undefined) return null;
  const ms = typeof since === "number" ? since : Date.parse(since);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / DAY));
}

/**
 * PURE — the pipeline per target.
 *
 * @param {object} opts
 * @param {object} opts.state       `deploymentState()`
 * @param {readonly object[]} opts.targets  `config.deployTargets`
 * @param {Map<string, object>} opts.tasks  id → `{id, title, status, closed}`
 * @param {Map<string, number>} opts.commitTimes  commit SHA → epoch ms
 * @param {Map<string, number>} opts.tagTimes  resolved ref SHA spec → epoch ms of an annotated tag
 * @param {object[]} opts.offTrunk  archived tasks with no trunk commit: `{id, targets: string[]}`
 * @param {number} opts.now
 * @param {{target: string|null, stage: string|null}} [opts.filter]
 * @param {boolean} [opts.count]  drop the task lists, keep the counts
 */
export function releasePipeline({ state, targets, tasks, commitTimes, tagTimes, offTrunk, now, filter = { target: null, stage: null }, count = false }) {
  const describe = (id) => tasks.get(id) || { id, title: null, status: null, closed: null };
  const out = [];
  for (const t of targets) {
    if (filter.target !== null && t.name !== filter.target) continue;
    // A target that does not declare the stage has nothing waiting for it.
    if (filter.stage !== null && !t.stages.some((s) => s.name === filter.stage)) continue;
    // Any unresolved ref at stage i makes buckets i..n unknown — see the header.
    const firstUnknown = t.stages.findIndex((s) => s.refs.some((spec) =>
      state.refs.some((r) => r.target === t.name && r.stage === s.name && r.spec === spec && r.status === "unknown")));
    const unknownRefsOf = (i) => state.refs
      .filter((r) => r.target === t.name && r.stage === t.stages[i].name && r.status === "unknown")
      .map((r) => r.spec);

    const buckets = [];
    buckets.push({ kind: "closed-off-trunk", stage: null, after: null, label: "closed, not on the trunk", unknown: false, unknownRefs: [], listed: true, tasks: [] });
    t.stages.forEach((s, i) => {
      buckets.push({
        kind: "waiting", stage: s.name, after: i === 0 ? null : t.stages[i - 1].name,
        label: (i === 0 ? "on the trunk" : "in " + t.stages[i - 1].name) + ", waiting for " + s.name,
        unknown: firstUnknown >= 0 && i >= firstUnknown,
        unknownRefs: firstUnknown >= 0 && i >= firstUnknown ? unknownRefsOf(firstUnknown) : [],
        listed: true, tasks: [],
      });
    });
    const last = t.stages[t.stages.length - 1];
    buckets.push({
      kind: "reached", stage: last.name, after: null, label: "in " + last.name,
      unknown: firstUnknown >= 0, unknownRefs: firstUnknown >= 0 ? unknownRefsOf(firstUnknown) : [],
      listed: false, tasks: [],
    });

    for (const o of offTrunk) {
      if (o.targets.indexOf(t.name) < 0) continue;
      const d = describe(o.id);
      buckets[0].tasks.push({ ...d, since: d.closed, waitedDays: waitedDays(d.closed, now), state: null, holding: [], refs: [] });
    }

    for (const [id] of state.byTask) {
      const entry = taskDeployment(state, id).targets.find((x) => x.target === t.name);
      if (!entry) continue;
      const k = entry.stages.findIndex((s) => s.state !== "full");
      if (k < 0) { buckets[buckets.length - 1].tasks.push({ id }); continue; }
      const stageState = entry.stages[k];
      const newest = Math.max(...entry.commits.map((sha) => commitTimes.get(sha) || 0));
      let since = newest > 0 ? newest : null;
      if (k > 0) {
        const tagged = entry.stages[k - 1].refs.map((r) => tagTimes.get(r.sha + " " + r.spec)).filter(Boolean);
        if (tagged.length) since = Math.max(...tagged);
      }
      const d = describe(id);
      buckets[1 + k].tasks.push({
        ...d,
        since: since === null ? null : new Date(since).toISOString(),
        waitedDays: waitedDays(since, now),
        state: stageState.state,
        holding: stageState.holding,
        refs: stageState.refs.map((r) => ({ spec: r.spec, sha: r.sha, state: r.state, held: r.held, of: r.of })),
      });
    }

    const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    const selected = buckets.filter((b) => filter.stage === null || (b.kind === "waiting" && b.stage === filter.stage));
    out.push({
      target: t.name,
      buckets: selected.map((b) => {
        const listed = b.listed && !count;
        return {
          kind: b.kind, stage: b.stage, after: b.after, label: b.label,
          count: b.tasks.length, unknown: b.unknown, unknownRefs: b.unknownRefs,
          listed, tasks: listed ? b.tasks.sort(byId) : [],
        };
      }),
    });
  }
  return out;
}

/** Commit times of the trunk, one `git log` pass. */
function readCommitTimes(run, root, trunkSha) {
  const times = new Map();
  if (!trunkSha) return times;
  const r = git(run, root, ["log", "--no-merges", "--format=%H %ct", trunkSha, "--"]);
  if (r.status !== 0) return times;
  for (const line of String(r.stdout || "").split("\n")) {
    const [sha, ct] = line.trim().split(" ");
    if (sha && ct) times.set(sha, Number(ct) * 1000);
  }
  return times;
}

/** The tagger date of every resolved ref that names an annotated tag. Keyed by
 *  `<sha> <spec>`, because two specs can resolve to one commit through
 *  different tags. */
function readTagTimes(run, root, refs) {
  const times = new Map();
  for (const r of refs) {
    if (!r.sha || !r.ref) continue;
    const key = r.sha + " " + r.spec;
    if (times.has(key)) continue;
    const t = git(run, root, ["cat-file", "tag", r.ref]);
    if (t.status !== 0) continue;
    const m = String(t.stdout || "").match(/^tagger .* (\d+) [+-]\d{4}$/m);
    if (m) times.set(key, Number(m[1]) * 1000);
  }
  return times;
}

/**
 * Archived tasks no trunk commit names, attributed to the targets their
 * off-trunk commits touched. One `git log --all --not <trunk>` pass.
 *
 * @returns {{placed: {id: string, targets: string[]}[], unplaced: string[]}}
 */
function readOffTrunk({ run, root, state, targets, prefix, archivedIds }) {
  const candidates = archivedIds.filter((id) => !state.byTask.has(id));
  if (!candidates.length) return { placed: [], unplaced: [] };
  const args = trunkLogArgs(state.trunk.sha);
  // `trunkLogArgs` ends with `<trunk> --`; the off-trunk walk is every ref
  // EXCEPT what the trunk already reaches.
  const walk = args.slice(0, -2).concat(["--all", "--not", state.trunk.sha, "--"]);
  const r = git(run, root, walk);
  const commits = r.status === 0 ? parseTrunkLog(r.stdout, taskIdScanner(prefix)) : [];
  const touched = new Map();
  for (const c of commits) {
    const names = targets.filter((t) => c.files.some((f) => pathInTarget(t, f))).map((t) => t.name);
    for (const id of c.ids) {
      if (!touched.has(id)) touched.set(id, new Set());
      for (const n of names) touched.get(id).add(n);
    }
  }
  const placed = [];
  const unplaced = [];
  for (const id of candidates) {
    const set = touched.get(id);
    if (set && set.size) placed.push({ id, targets: [...set] });
    else unplaced.push(id);
  }
  return { placed, unplaced };
}

function shortSha(sha) { return sha ? sha.slice(0, 12) : null; }

const TRUNK_SOURCE_TEXT = {
  "remote-default": "the remote's default branch",
  head: "HEAD — this clone has no `origin/HEAD`",
};

/** The text answer. */
export function renderStatus(report, paint = color) {
  const lines = [];
  const trunk = report.trunk;
  lines.push(paint.bold("trunk") + "  " + trunk.spec + " " + (shortSha(trunk.sha) || "unresolved") + "  (" + TRUNK_SOURCE_TEXT[trunk.source] + ")");
  const refWidth = Math.max(0, ...report.scan.refs.map((r) => (r.target + "/" + r.stage).length));
  const refName = (r) => (r.ref && r.ref !== r.spec ? r.spec + " → " + r.ref : r.spec);
  const nameWidth = Math.max(0, ...report.scan.refs.map((r) => refName(r).length));
  for (const r of report.scan.refs) {
    if (report.filter.target !== null && r.target !== report.filter.target) continue;
    const where = (r.target + "/" + r.stage).padEnd(refWidth);
    lines.push("  " + where + "  " + refName(r).padEnd(nameWidth) + "  " + (r.sha ? shortSha(r.sha) : paint.warn("unknown") + " — " + r.why));
  }
  for (const t of report.targets) {
    lines.push("");
    lines.push(paint.bold(t.target));
    const width = Math.max(...t.buckets.map((b) => b.label.length));
    for (const b of t.buckets) {
      let tally = String(b.count);
      if (b.unknown) tally = "? " + paint.warn("unknown") + " — " + b.unknownRefs.join(", ") + " does not resolve" + (b.count ? "; " + b.count + " could not be placed past it" : "");
      else if (b.kind === "reached" && !b.listed && b.count) tally += paint.dim("  (counted, not listed)");
      lines.push("  " + b.label.padEnd(width) + "  " + tally);
      for (const task of b.tasks) {
        const parts = [];
        if (task.status === null) parts.push("no task file");
        else if (task.closed && report.archived.indexOf(task.status) >= 0) parts.push(task.status + " " + task.closed);
        else parts.push(task.status);
        if (task.waitedDays !== null) parts.push("waiting " + task.waitedDays + "d");
        if (task.state && task.state !== "absent") {
          parts.push(task.state + (task.refs.length > 1 && task.holding.length ? " (held by " + task.holding.join(", ") + ")" : ""));
        } else if (task.refs.length > 1) {
          parts.push("held by none of " + task.refs.map((r) => r.spec).join(", "));
        }
        lines.push("    " + paint.id(task.id) + "  " + (task.title === null ? "" : task.title) + "  " + paint.dim(parts.join(" · ")));
      }
    }
  }
  if (report.unplaced.count) {
    lines.push("");
    lines.push(paint.dim(MARK.bullet + " " + report.unplaced.count + " closed task(s) are named by no commit on any ref, so no target can be given to them"));
  }
  return lines.join("\n");
}

/** The whole computation, for a resolved backlog. */
export function computeStatus({ root, config, filter, count, now = Date.now(), run = spawnSync }) {
  const targets = config.deployTargets;
  const repo = repoRoot(root);
  const trunk = defaultTrunk(repo, run);
  const state = deploymentState({ root: repo, prefix: config.taskIdPrefix, targets, trunk: trunk.spec, run });
  const report = {
    trunk: { spec: trunk.spec, sha: state.trunk.sha, source: trunk.source },
    scan: deploymentScanJson(state),
    explanation: state.reason === "ok" ? null : explain(state.reason),
    filter,
    archived: config.archivedStatuses,
    targets: [],
    unplaced: { count: 0, ids: [] },
  };
  if (!state.scanned) return { report, state };

  const metas = readTaskMetas(backlogPaths(root).tasksDir, config);
  const archived = config.archivedStatuses;
  const tasks = new Map();
  const archivedIds = [];
  for (const m of metas) {
    if (!m.id) continue;
    const isArchived = archived.indexOf(m.status) >= 0;
    if (isArchived) archivedIds.push(m.id);
    tasks.set(m.id, { id: m.id, title: m.title, status: m.status, closed: null, isArchived, meta: m });
  }
  // History is read only for the tasks a bucket will list, never the whole tree.
  const closedOf = (id) => {
    const t = tasks.get(id);
    if (!t || !t.isArchived) return null;
    return closedDate(readHistory(root, id), t.meta, archived);
  };

  const off = readOffTrunk({ run, root: repo, state, targets, prefix: config.taskIdPrefix, archivedIds });
  const pipeline = releasePipeline({
    state, targets,
    tasks: new Map([...tasks].map(([id, t]) => [id, { id, title: t.title, status: t.status, closed: null }])),
    commitTimes: readCommitTimes(run, repo, state.trunk.sha),
    tagTimes: readTagTimes(run, repo, state.refs),
    offTrunk: off.placed,
    now,
    filter,
    count,
  });
  for (const t of pipeline) {
    for (const b of t.buckets) {
      for (const task of b.tasks) {
        task.closed = closedOf(task.id);
        if (b.kind === "closed-off-trunk") {
          task.since = task.closed;
          task.waitedDays = waitedDays(task.closed, now);
        }
      }
    }
  }
  report.targets = pipeline;
  report.unplaced = { count: off.unplaced.length, ids: count ? [] : off.unplaced };
  return { report, state };
}

export function run(argv) {
  const cmd = N + " release status";
  const dirFlag = takeDirFlag(argv);
  const wantsJson = dirFlag.argv.includes("--json");
  let opts;
  try { opts = parseStatusArgs(dirFlag.argv); }
  catch (e) {
    const [head, avail] = e.message.split("\n");
    console.error(refusal(cmd, head, avail));
    return 2;
  }
  let root;
  try { root = resolveBacklogDir({ dir: dirFlag.dir || undefined, moduleDir: HERE }).root; }
  catch (e) { console.error(failure(cmd, e.message, [], [cmd + " --help"])); return 2; }
  const config = loadConfigOrExit(root);
  const filter = resolveFilter(opts, config.deployTargets);
  if (!filter.ok) { console.error(failure(cmd, filter.message, [], [cmd + " --help"])); return 2; }

  const { report, state } = computeStatus({ root, config, filter: { target: filter.target, stage: filter.stage }, count: opts.count });
  if (wantsJson) {
    printJson("release-status", {
      trunk: report.trunk, scan: report.scan, explanation: report.explanation,
      filter: report.filter, targets: report.targets, unplaced: report.unplaced,
    });
  } else if (!state.scanned) {
    console.log(color.ok(MARK.ok) + " nothing to report — " + report.explanation);
  } else {
    if (report.explanation) console.error(color.warn(MARK.warn) + " " + report.explanation);
    console.log(renderStatus(report));
  }
  return state.reason === "git-failed" ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("release-status.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
