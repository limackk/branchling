/**
 * The data behind the viewer's Release view (TL-504), computed at build time.
 *
 * WHAT IT IS. One lane per deploy target and one column per step of its
 * promotion: closed but not merged, the trunk, then each stage from
 * `deploy_targets:` in config.yaml. A task sits in the column of the LAST step
 * it has fully reached, and carries the state it has in the NEXT one, which is
 * where a partial deployment shows. The page narrows and draws this with
 * `viewer-release.mjs`; this module only reads git.
 *
 * NOTHING HERE IS A SECOND DEFINITION. The buckets are the ones `deploy
 * status` prints (`computeStatus()` in release-status.mjs): the column "in S"
 * is that command's bucket "in S, waiting for the next stage", the trunk column
 * is "on the trunk, waiting for the first stage", and the last stage is its
 * "reached" bucket. That bucket is counted, not listed, by the command, so its
 * members are recovered here as the complement — every task with commits for
 * the target that no other bucket placed — rather than by restating the rule
 * that put them there. The gap panel is `releaseGaps()` from release-gaps.mjs,
 * handed the same `deploymentState()` so one build reads the refs once.
 *
 * A TARGET IN ANOTHER REPOSITORY (`repository:`, TL-507) gets a lane of one
 * column, `unobservable`: the command's bucket of the same name, holding the
 * tasks that carry the target's labels. Nothing in it is placed in a stage,
 * because no stage of it can be read from this repository. A project whose
 * every target lives elsewhere still gets the view — those lanes are answered
 * from the task files, without git.
 *
 * NO TASK TEXT TRAVELS IN IT. Cards carry ids; the page takes titles and
 * statuses from the tasks it already embeds, so a status edited in the browser
 * shows on the card without a rebuild and the backlog is not embedded twice.
 *
 * THE VIEW SAYS HOW OLD IT IS. Deployment state is read from refs, which move
 * without the page knowing, so the data carries the time of the build and the
 * resolved SHA of every ref it read; the page prints both.
 *
 * Tests: `node --test scripts/tests/viewer-release.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { explain, taskDeployment } from "./environments.mjs";
import { repoRoot } from "./modified-files.mjs";
import { gateVerdict, releaseGaps } from "./release-gaps.mjs";
import { computeStatus } from "./release-status.mjs";
import { CLOSED_COLUMN, TRUNK_COLUMN, UNOBSERVABLE_COLUMN } from "./viewer-release.mjs";

function cardOf(task, nextStage) {
  return {
    id: task.id,
    next: nextStage,
    state: task.state || null,
    holding: task.holding || [],
    refs: (task.refs || []).map((r) => ({ spec: r.spec, sha: r.sha, state: r.state, held: r.held, of: r.of })),
    waitedDays: task.waitedDays === undefined ? null : task.waitedDays,
    since: task.since || null,
  };
}

function refsOf(state, target, stage) {
  return state.refs
    .filter((r) => r.target === target && r.stage === stage)
    .map((r) => ({ spec: r.spec, ref: r.ref, sha: r.sha, status: r.status, why: r.why }));
}

/**
 * PURE — the lanes, from the pipeline `computeStatus()` returned and the
 * deployment state it was computed from.
 */
export function releaseLanes({ pipeline, state, targets, trunk }) {
  const lanes = [];
  for (const p of pipeline) {
    const spec = targets.find((t) => t.name === p.target);
    if (p.repository) {
      const bucket = p.buckets.find((b) => b.kind === "unobservable");
      lanes.push({
        target: p.target,
        repository: p.repository,
        columns: [{
          key: UNOBSERVABLE_COLUMN, stage: null, refs: [], unknown: false, unknownRefs: [],
          cards: bucket.tasks.map((t) => cardOf(t, null)),
        }],
      });
      continue;
    }
    const stages = spec.stages.map((s) => s.name);
    const closed = p.buckets.find((b) => b.kind === "closed-off-trunk");
    const waiting = p.buckets.filter((b) => b.kind === "waiting");
    const reached = p.buckets.find((b) => b.kind === "reached");

    const columns = [];
    columns.push({
      key: CLOSED_COLUMN, stage: null, refs: [], unknown: false, unknownRefs: [],
      cards: closed.tasks.map((t) => cardOf(t, null)),
    });
    // The bucket "waiting for stage i" holds what stands in the step BEFORE it.
    waiting.forEach((b, i) => {
      columns.push({
        key: i === 0 ? TRUNK_COLUMN : stages[i - 1],
        stage: i === 0 ? null : stages[i - 1],
        refs: i === 0 ? [{ spec: trunk.spec, ref: trunk.spec, sha: trunk.sha, status: trunk.sha ? "resolved" : "unknown", why: null }]
          : refsOf(state, p.target, stages[i - 1]),
        unknown: b.unknown, unknownRefs: b.unknownRefs,
        cards: b.tasks.map((t) => cardOf(t, b.stage)),
      });
    });
    const placed = new Set(waiting.flatMap((b) => b.tasks.map((t) => t.id)));
    const done = [];
    for (const id of state.byTask.keys()) {
      if (placed.has(id)) continue;
      if (!taskDeployment(state, id).targets.some((x) => x.target === p.target)) continue;
      done.push(id);
    }
    done.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const last = stages[stages.length - 1];
    columns.push({
      key: last, stage: last, refs: refsOf(state, p.target, last),
      unknown: reached.unknown, unknownRefs: reached.unknownRefs,
      cards: done.map((id) => cardOf({ id }, null)),
    });
    lanes.push({ target: p.target, repository: null, columns });
  }
  return lanes;
}

/**
 * The whole computation for one backlog. Never throws: a page that could not
 * read git still has to render, and says why this view is empty.
 *
 * @param {object} opts
 * @param {string} opts.root the backlog directory
 * @param {object} opts.config the loaded configuration
 * @param {{id: string, status: string}[]} opts.tasks every task the page embeds
 * @param {number} [opts.now]
 */
export function releaseViewData({ root, config, tasks, now = Date.now(), run = spawnSync }) {
  const targets = config.deployTargets || [];
  const data = {
    available: false,
    reason: "no-targets",
    explanation: explain("no-targets"),
    builtAt: new Date(now).toISOString(),
    trunk: null,
    refs: [],
    lanes: [],
    unplaced: { count: 0, ids: [] },
    gaps: null,
  };
  if (!targets.length) return data;
  try {
    const { report, state } = computeStatus({
      root, config, filter: { target: null, stage: null }, count: false, now, run,
    });
    data.reason = state.reason;
    data.explanation = state.reason === "ok" ? null : explain(state.reason);
    data.trunk = report.trunk;
    data.refs = report.scan.refs;
    if (!state.scanned && state.reason !== "only-external-targets") return data;
    data.available = true;
    data.unplaced = report.unplaced;
    data.lanes = releaseLanes({ pipeline: report.targets, state, targets, trunk: report.trunk });
    if (!state.scanned) return data;

    const gaps = releaseGaps({
      root: repoRoot(root), config,
      tasks: (tasks || []).filter((t) => t && t.id).map((t) => ({ id: t.id, status: t.status, labels: t.labels || [] })),
      trunk: { spec: report.trunk.spec, source: report.trunk.source },
      state, run,
    });
    const mode = config.releaseGate;
    const verdict = gateVerdict(gaps, mode);
    data.gaps = {
      mode,
      scanned: gaps.scanned,
      reason: gaps.reason,
      explanation: gaps.scanned ? null : explain(gaps.reason),
      excludedBeforeAdoption: gaps.excludedBeforeAdoption,
      unknownRefs: gaps.unknownRefs,
      exit: verdict.exit,
      items: gaps.gaps,
    };
  } catch (e) {
    data.available = false;
    data.reason = "git-failed";
    data.explanation = explain("git-failed") + " (" + e.message + ")";
  }
  return data;
}
