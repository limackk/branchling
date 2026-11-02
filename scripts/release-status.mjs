#!/usr/bin/env node
/**
 * `deploy status` — what waits for which environment (TL-502).
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
 * PLANNED SCOPE (`--release <name>`, TL-505). A task names the release it is
 * planned for in `release:`, a value from the closed `releases:` list — the
 * intent, written by a person, as opposed to the deployment, which is observed.
 * The comparison has four lists, each answering one question a release
 * manager asks:
 *
 *   planned, not shipped   planned and not yet in full in the LAST stage of
 *                          every target it touched — the launch blockers. A
 *                          planned task with no commit on the trunk is here,
 *                          named as such: "not started" is not "deployed"
 *   planned, still open    planned and in an open status, whether or not some of
 *                          its commits already travel
 *   unplanned              on the trunk or in an earlier stage, not yet in the
 *                          last one, and NOT planned for this release: the scope
 *                          the next promotion carries without anybody having
 *                          planned it. Bounded by the pipeline on purpose — what
 *                          already reached the last stage is the project's whole
 *                          history, and listing it as "unplanned" would bury the
 *                          answer
 *   dropped                planned and closed in an archived status other than
 *                          the one `done` writes (the first of
 *                          `archived_statuses:`): planned, then deliberately not
 *                          delivered. Never a blocker
 *
 * Shipped planned tasks are COUNTED, like the last bucket of the pipeline. A
 * planned task whose last stage did not resolve is `unknown`, never shipped and
 * never absent. The report also names the CURRENT release (`current`, TL-515),
 * the first of `releases:` not fully shipped — see `currentRelease()`; when git
 * was not read, `currentJudged` is false and `current` is null for want of a
 * judgement, not because every release has shipped.
 *
 * A SHIPPED RELEASE (TL-516) names the ref where it ends in its entry of
 * `releases:` (`{name, ref}`). Its scope is measured against that ref instead
 * of the pipeline (`shippedScope()`, `scripts/release-shipped.mjs`): a planned
 * task the ref does not hold in full is "planned, not shipped", and a task a
 * commit between the previous release's ref and this one's names, planned for
 * another release or none, is "shipped, unplanned". The pipeline's
 * "unplanned, carried by the next promotion" does not apply to a release that
 * has gone out and is `null` there. A ref that does not resolve is unknown,
 * never an empty release.
 *
 * A TARGET IN ANOTHER REPOSITORY (`repository:`, TL-507) has no stage this
 * repository can read. Its lane is one bucket, `unobservable`, holding the
 * tasks that name it in `target:` — named, with their status, and never placed
 * in a stage or counted as waiting for one. A closed task of such a target is
 * not "named by no commit" either: it is left out of that note, because the
 * reason no commit here names it is known. With `--release`, a planned task of
 * such a target lands in `unobservable` rather than in "planned, not shipped",
 * unless a target of THIS repository it touched still lacks it — that half is
 * observed, and is a blocker like any other.
 *
 * A RECORDED STAGE (TL-506) is a ref `deploy record` moved onto an annotated
 * tag. The report names who recorded it, when and why (`records`), because a
 * stage moved on somebody's word is only as good as the word.
 *
 * Tests: `node --test scripts/tests/release-status.test.mjs`,
 *        `node --test scripts/tests/release-scope.test.mjs`,
 *        `node --test scripts/tests/release-shipped-scope.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { externalTargetsOf, isExternalTarget, observedTargets, pathInTarget } from "./deploy-targets.mjs";
import {
  TRUNK_SOURCE_TEXT, defaultTrunk, deploymentScanJson, deploymentState, explain, parseStageSelector,
  parseTrunkLog, taskDeployment, trunkLogArgs,
} from "./environments.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { readHistory } from "./history.mjs";
import { releaseEntriesOf } from "./release-entries.mjs";
import { readRecord } from "./release-record.mjs";
import { readShipments } from "./release-shipped.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readTaskMetas } from "./task-io.mjs";
import { taskIdScanner } from "./task-id.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;

export const STATUS_FLAGS = ["--target", "--env", "--release", "--count", "--json"];
const VALUE_FLAGS = ["--target", "--env", "--release"];

/** The bucket kinds, in pipeline order. */
export const BUCKET_KINDS = Object.freeze(["closed-off-trunk", "waiting", "reached", "unobservable"]);

function git(run, root, args) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, env: gitDiscoveryEnv(),
  });
}

/** PURE — the flags of `deploy status`. Throws with the available set on the
 *  second line, which is the shape `refusal()` prints. */
export function parseStatusArgs(argv) {
  const opts = { target: null, env: null, release: null, count: false, json: false };
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
    if (isExternalTarget(spec)) {
      return { ok: false, message: "target `" + t + "` is deployed from the repository `" + spec.repository + "` and has no stage this one can read" };
    }
    if (!spec.stages.some((s) => s.name === sel.stage)) {
      return { ok: false, message: "target `" + t + "` declares no stage `" + sel.stage + "` (declared: " + spec.stages.map((s) => s.name).join(", ") + ")" };
    }
  }
  return { ok: true, target: t, stage: sel.stage };
}

/**
 * PURE — `--release` checked against `releases:` and the other flags. An
 * undeclared release FAILS: a typo would otherwise list every planned task as
 * missing and every travelling one as unplanned, which reads exactly like an
 * answer. `--env` is refused beside it, because the comparison is with the
 * LAST stage by definition, and narrowing it to another would answer a
 * different question under the same heading.
 *
 * @returns {{ok: true} | {ok: false, message: string}}
 */
export function checkReleaseFlag({ release, env }, releases) {
  if (release === null) return { ok: true };
  const declared = releases || [];
  if (declared.indexOf(release) < 0) {
    return {
      ok: false,
      message: declared.length
        ? "`" + release + "` is not a declared release (declared: " + declared.join(", ") + ")"
        : "this project declares no `releases` in config.yaml, so it plans no release `" + release + "`",
    };
  }
  if (env !== null) {
    return { ok: false, message: "`--release` compares the plan with the LAST stage of each target; `--env` cannot narrow it to another" };
  }
  return { ok: true };
}

/**
 * Where a task stands on one target: the first stage that does not hold it in
 * full, read the same way the pipeline places it.
 */
function standingOn(te) {
  const k = te.stages.findIndex((s) => s.state !== "full");
  if (k < 0) return { target: te.target, at: te.stages[te.stages.length - 1].stage, waitingFor: null, state: "full" };
  return {
    target: te.target,
    at: k === 0 ? null : te.stages[k - 1].stage,
    waitingFor: te.stages[k].stage,
    state: te.stages[k].state,
  };
}

/**
 * PURE — the planned scope of one release against what the stages hold. The
 * four lists are described in the header.
 *
 * @param {object} opts
 * @param {object} opts.state  `deploymentState()`
 * @param {readonly object[]} opts.targets  `config.deployTargets`
 * @param {object[]} opts.tasks  every task: `{id, title, status, priority, release, target}`
 * @param {string} opts.release  a declared release
 * @param {readonly string[]} opts.archived  `archived_statuses`
 * @param {string|null} [opts.target]  `--target`
 * @param {boolean} [opts.count]  drop the lists, keep the counts
 * @param {object|null} [opts.shipment]  this release's entry of `readShipments()`
 *   when `releases:` names a ref for it — the scope is then judged against
 *   that ref (`shippedScope()`), not against the pipeline
 */
export function releaseScope({ state, targets, tasks, release, archived, target = null, count = false, shipment = null }) {
  if (shipment) return shippedScope({ targets, tasks, release, archived, target, count, shipment });
  const done = archived[0] || null;
  const known = new Map(tasks.map((t) => [t.id, t]));
  const inScope = (te) => target === null || te.target === target;
  const scoped = (t) => targets.some((x) => x.name === t && (target === null || x.name === target));
  const row = (id, standing, note) => {
    const t = known.get(id) || { id, title: null, status: null, priority: null, release: "" };
    const entry = state.byTask.get(id);
    return {
      id, title: t.title, status: t.status, priority: t.priority, release: t.release || "",
      commits: entry ? entry.commits.length : 0, standing, note,
    };
  };

  const planned = tasks.filter((t) => t.release === release);
  const notShipped = [];
  const open = [];
  const dropped = [];
  const unobservable = [];
  let shipped = 0;
  for (const t of planned) {
    const isArchived = archived.indexOf(t.status) >= 0;
    if (isArchived && t.status !== done) { dropped.push(row(t.id, [], null)); continue; }
    if (!isArchived) open.push(row(t.id, [], null));
    // The targets in another repository this task belongs to, within `--target`.
    const away = externalTargetsOf(targets, t).filter((x) => target === null || x.name === target);
    const elsewhere = away.length
      ? row(t.id, away.map((x) => ({ target: x.name, repository: x.repository, at: null, waitingFor: null, state: "unobservable" })), "unobservable")
      : null;
    if (!state.scanned) {
      // With no target in this repository there is no half to read; otherwise
      // the half here was not read, and that is what the row has to say.
      if (elsewhere && !observedTargets(targets).length) unobservable.push(elsewhere);
      else notShipped.push(row(t.id, [], "unscanned"));
      continue;
    }
    const entry = state.byTask.get(t.id);
    if (!entry || !entry.commits.length) {
      if (elsewhere) unobservable.push(elsewhere);
      else if (!externalTargetsOf(targets, t).length) notShipped.push(row(t.id, [], "no-commits"));
      continue;
    }
    const tes = entry.targets.filter(inScope);
    if (!tes.length) {
      if (elsewhere) { unobservable.push(elsewhere); continue; }
      // Commits that touch no selected target: outside this answer when
      // `--target` excluded them, and otherwise nothing that can ship anywhere.
      if (target === null) notShipped.push(row(t.id, [], "no-target"));
      continue;
    }
    const standing = tes.map(standingOn);
    // Observed in full here, and unobservable in the other repository: never
    // "shipped", because half of it could not be looked at.
    if (standing.every((s) => s.state === "full") && elsewhere) { unobservable.push(elsewhere); continue; }
    if (standing.every((s) => s.state === "full")) { shipped++; continue; }
    notShipped.push(row(t.id, standing.filter((s) => s.state !== "full").concat(elsewhere ? elsewhere.standing : []),
      standing.some((s) => s.state === "unknown") ? "unknown" : null));
  }

  const unplanned = [];
  for (const [id, entry] of state.byTask) {
    const t = known.get(id);
    if (t && t.release === release) continue;
    const standing = entry.targets.filter((te) => inScope(te) && scoped(te.target)).map(standingOn)
      .filter((s) => s.state !== "full");
    if (!standing.length) continue;
    unplanned.push(row(id, standing, t ? null : "no-task-file"));
  }

  const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const list = (rows) => ({ count: rows.length, tasks: count ? [] : rows.sort(byId) });
  return {
    name: release,
    planned: planned.length,
    shipped: { count: shipped },
    notShipped: list(notShipped),
    open: list(open),
    unplanned: list(unplanned),
    dropped: list(dropped),
    unobservable: list(unobservable),
    shippedAt: null,
    shippedUnplanned: null,
  };
}

/**
 * PURE — the scope of a release that names the ref where it ends (TL-516). The
 * lists keep their meaning, measured against that ref instead of the pipeline:
 *
 *   planned, not shipped   planned, not dropped, and not held in full by the
 *                          ref: some or none of its trunk commits are in it,
 *                          or no commit names it at all
 *   shipped, unplanned     named by a commit the release carried — between the
 *                          previous release's ref and this one's — and planned
 *                          for another release or none
 *
 * `unplanned` ("carried by the next promotion") is `null` here: a release that
 * has gone out is not what the next promotion carries. A ref that does not
 * resolve makes every planned task that is not dropped `release-ref-unknown`
 * and `shippedUnplanned` unknown (`count: null`); a beginning that does not
 * resolve makes only `shippedUnplanned` unknown. Unknown is never empty.
 */
export function shippedScope({ targets, tasks, release, archived, target = null, count = false, shipment }) {
  const done = archived[0] || null;
  const known = new Map(tasks.map((t) => [t.id, t]));
  const spec = target === null ? null : targets.find((x) => x.name === target) || null;
  const local = spec !== null && !isExternalTarget(spec);
  // The commits of `--target` only; every commit without it.
  const inTarget = (c) => target === null || (local && c.files.some((f) => pathInTarget(spec, f)));
  const row = (id, standing, note, commits) => {
    const t = known.get(id) || { id, title: null, status: null, priority: null, release: "" };
    return { id, title: t.title, status: t.status, priority: t.priority, release: t.release || "", commits, standing, note };
  };
  const resolved = shipment.status === "resolved";
  const rangeKnown = resolved && shipment.rangeKnown;
  const carried = new Map();
  for (const c of rangeKnown ? shipment.range : []) {
    if (!inTarget(c)) continue;
    for (const id of c.ids) carried.set(id, (carried.get(id) || 0) + 1);
  }
  const allCarried = new Set(rangeKnown ? shipment.range.flatMap((c) => c.ids) : []);

  const planned = tasks.filter((t) => t.release === release);
  const notShipped = [];
  const open = [];
  const dropped = [];
  const unobservable = [];
  let shipped = 0;
  for (const t of planned) {
    const isArchived = archived.indexOf(t.status) >= 0;
    if (isArchived && t.status !== done) { dropped.push(row(t.id, [], null, 0)); continue; }
    if (!isArchived) open.push(row(t.id, [], null, 0));
    const away = externalTargetsOf(targets, t).filter((x) => target === null || x.name === target);
    const elsewhere = away.length
      ? row(t.id, away.map((x) => ({ target: x.name, repository: x.repository, at: null, waitingFor: null, state: "unobservable" })), "unobservable", 0)
      : null;
    if (!resolved) { notShipped.push(row(t.id, [], "release-ref-unknown", 0)); continue; }
    const everyTrunk = shipment.trunkByTask.get(t.id) || [];
    const trunk = everyTrunk.filter(inTarget);
    const onRelease = carried.get(t.id) || 0;
    if (!everyTrunk.length && !allCarried.has(t.id)) {
      if (elsewhere) unobservable.push(elsewhere);
      else if (!externalTargetsOf(targets, t).length) notShipped.push(row(t.id, [], "no-commits", 0));
      continue;
    }
    // Commits outside `--target`: outside this answer.
    if (!trunk.length && !onRelease) {
      if (elsewhere) unobservable.push(elsewhere);
      continue;
    }
    const held = trunk.filter((c) => !shipment.missing.has(c.sha)).length;
    const full = trunk.length ? held === trunk.length : onRelease > 0;
    if (full) {
      if (elsewhere) unobservable.push(elsewhere);
      else shipped++;
      continue;
    }
    const state = held > 0 || onRelease > 0 ? "partial" : "absent";
    notShipped.push(row(t.id, [{ release, ref: shipment.ref, state, held, of: trunk.length }]
      .concat(elsewhere ? elsewhere.standing : []), null, trunk.length));
  }

  const shippedUnplanned = [];
  for (const [id, n] of carried) {
    const t = known.get(id);
    if (t && t.release === release) continue;
    shippedUnplanned.push(row(id, [{ release, ref: shipment.ref, state: "full", held: n, of: n }], t ? null : "no-task-file", n));
  }

  const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const list = (rows) => ({ count: rows.length, tasks: count ? [] : rows.sort(byId) });
  return {
    name: release,
    planned: planned.length,
    shipped: { count: shipped },
    notShipped: list(notShipped),
    open: list(open),
    unplanned: null,
    dropped: list(dropped),
    unobservable: list(unobservable),
    shippedAt: {
      ref: shipment.ref, sha: shipment.sha, status: shipment.status, why: shipment.why,
      since: shipment.since, rangeKnown,
    },
    shippedUnplanned: rangeKnown ? list(shippedUnplanned) : { count: null, unknown: true, tasks: [] },
  };
}

/**
 * THE CURRENT RELEASE (TL-515): the first entry of `releases:` not yet fully
 * shipped.
 *
 * WHY IT IS COMPUTED. `planned-blocker-open` used to count an open task at the
 * top of `priorities:` planned for ANY declared release, because releases had
 * no order; a project shipping one release while planning the next was blocked
 * by the next one's work and had to accept the gap wholesale, which silenced
 * the blockers that mattered as well. An explicit `current_release:` key was
 * rejected by the owner on 2026-11-02: it is a pointer somebody must move after
 * every release, and a forgotten move reads like a fact. The order of
 * `releases:` — a list the project already maintains — is read as
 * chronological instead, and the current release is derived from it (Law 2).
 *
 * WHAT "FULLY SHIPPED" MEANS. Every task planned for the release that is not
 * dropped (closed in an archived status other than the first) is closed, and in
 * full in the last stage of every target it touched. The judgement is
 * `releaseScope()`'s, read row by row, so `deploy status --release` and
 * `releaseShipped()` work from the same placement and cannot disagree about a
 * task. In particular:
 *
 *   - a last stage that does not resolve is `unknown`, and unknown is never
 *     shipped: the release stays current;
 *   - deployment that was not read at all (`unscanned`) is not shipped either;
 *   - an OPEN planned task keeps the release current even when every commit it
 *     has so far is in the last stage — the work is not finished, and letting
 *     the release go past it would release its blocker with it;
 *   - a CLOSED task of a target in another repository (TL-507) does not keep
 *     it current. That half is unobservable by design, not by accident, so
 *     holding the release until it is observed would pin it forever; while
 *     such a task is open it holds the release like any other open task;
 *   - a CLOSED task whose trunk commits touch no deploy target's paths (a
 *     docs-only or backlog-only task, `no-target`) does not keep it current.
 *     It touched no target, so "in the last stage of every target it touched"
 *     holds vacuously, and no promotion could ever change that — counting it
 *     would pin the release forever. `releaseScope()` still LISTS it under
 *     "planned, not shipped", which is TL-505's answer to "where is it", not a
 *     claim that the release is waiting for it;
 *   - a CLOSED task that no trunk commit names (`no-commits`) DOES keep it
 *     current. Unlike `no-target`, nothing was measured: the work may sit on
 *     a branch nobody merged (`done-not-on-trunk` reports that case), and a
 *     release that skipped past it would call unmerged work shipped. It stops
 *     holding the release once a trunk commit names it, or once it is dropped
 *     or planned elsewhere;
 *   - a release with no planned task left to ship is shipped: an empty entry
 *     at the head of the list does not hold back the ones after it;
 *   - a release whose entry names a `ref` (TL-516) is judged against that ref,
 *     not the pipeline: it is shipped when the ref resolves, every planned task
 *     that is not dropped is closed and held in full by it, and none is missing
 *     a commit. A ref that does not resolve keeps it current (unknown is never
 *     shipped), and so does a planned task the ref does not hold: the release
 *     went out without it, and until somebody plans it for a later release or
 *     drops it, that gap is what the gate has to keep naming. Deployment still
 *     has to have been read for any release to be judged, so that one rule
 *     governs "not judged" whatever the shape of the entries.
 *
 * If every release is shipped there is no current release (`null`), and no
 * planned task blocks anything.
 *
 * WHEN GIT WAS NOT READ there is no answer at all, not `null`: every planned
 * task would be `unscanned`, and the first release with any plan would be
 * named current on no measurement. `currentRelease()` refuses an unscanned
 * state; its callers carry "not judged" as a separate flag (`currentJudged` in
 * `deploy status`, `currentReleaseJudged` in the gate), so that "every
 * release has shipped" and "nothing was read" never share one value.
 */

/**
 * PURE — whether a release is fully shipped, from its scope. A `no-target` row
 * does not hold it (see above), so the rows are needed, not only the counts.
 *
 * @param {ReturnType<typeof releaseScope>} scope  computed with no `--target`
 *   and without `count`
 */
export function releaseShipped(scope) {
  if (scope.notShipped.tasks.length !== scope.notShipped.count) {
    throw new Error("releaseShipped() reads the rows of `notShipped` — compute the scope without `count`");
  }
  return scope.open.count === 0 && scope.notShipped.tasks.every((row) => row.note === "no-target");
}

/**
 * PURE — the current release: the first of `releases` that is not fully
 * shipped, or `null` when every one is. Throws on a state git was not read
 * into: there, no release can be judged at all.
 *
 * @param {object} opts
 * @param {object} opts.state  `deploymentState()`
 * @param {readonly object[]} opts.targets  `config.deployTargets`
 * @param {object[]} opts.tasks  every task: `{id, status, priority, release, labels}`
 * @param {readonly string[]} opts.releases  `config.releases`, in the project's order
 * @param {readonly string[]} opts.archived  `archived_statuses`
 * @param {Map<string, object>} [opts.shipments]  `readShipments()`, for the
 *   releases that name a ref
 * @returns {string|null}
 */
export function currentRelease({ state, targets, tasks, releases, archived, shipments = new Map() }) {
  if (!state.scanned) throw new Error("currentRelease() needs deployment that was read — check `state.scanned` first");
  for (const release of releases || []) {
    const scope = releaseScope({
      state, targets: targets || [], tasks, release, archived: archived || [], shipment: shipments.get(release) || null,
    });
    if (!releaseShipped(scope)) return release;
  }
  return null;
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
 * @param {Map<string, string[]>} [opts.unobservable]  target in another repository → the ids of its tasks
 * @param {number} opts.now
 * @param {{target: string|null, stage: string|null}} [opts.filter]
 * @param {boolean} [opts.count]  drop the task lists, keep the counts
 */
export function releasePipeline({ state, targets, tasks, commitTimes, tagTimes, offTrunk, now, filter = { target: null, stage: null }, count = false, unobservable = new Map() }) {
  const describe = (id) => tasks.get(id) || { id, title: null, status: null, closed: null };
  const out = [];
  for (const t of targets) {
    if (filter.target !== null && t.name !== filter.target) continue;
    if (isExternalTarget(t)) {
      // It declares no stage, so a stage filter selects nothing in it.
      if (filter.stage !== null) continue;
      out.push(unobservableLane(t, (unobservable.get(t.name) || []).map(describe), count));
      continue;
    }
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
      repository: null,
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

/** PURE — the lane of a target in another repository: one bucket, its tasks. */
export function unobservableLane(t, tasks, count) {
  const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  const listed = !count;
  return {
    target: t.name,
    repository: t.repository,
    buckets: [{
      kind: "unobservable", stage: null, after: null,
      label: "unobservable here",
      count: tasks.length, unknown: false, unknownRefs: [], listed,
      tasks: listed
        ? tasks.map((d) => ({ ...d, since: null, waitedDays: null, state: null, holding: [], refs: [] })).sort(byId)
        : [],
    }],
  };
}

/**
 * PURE — the tasks of each target in another repository, by `target:`: every
 * task naming it except those closed in an archived status other
 * than the one `done` writes, which were deliberately not delivered and have
 * nothing to deploy.
 *
 * @returns {Map<string, string[]>}
 */
export function unobservableTasks(targets, metas, archived) {
  const out = new Map();
  const done = archived[0] || null;
  for (const t of targets || []) if (isExternalTarget(t)) out.set(t.name, []);
  if (!out.size) return out;
  for (const m of metas) {
    if (!m.id) continue;
    if (archived.indexOf(m.status) >= 0 && m.status !== done) continue;
    for (const t of externalTargetsOf(targets, m)) out.get(t.name).push(m.id);
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

/** The record behind every resolved ref of a recorded stage. A ref of such a
 *  stage that carries no record (CI moved it, or it was set by hand) is left
 *  out rather than described as one. */
function readRecords({ run, root, targets, refs }) {
  const out = [];
  if (!root) return out;
  for (const t of targets || []) {
    for (const s of t.stages) {
      if (!s.recorded) continue;
      for (const r of refs || []) {
        if (r.target !== t.name || r.stage !== s.name || !r.sha || !r.ref) continue;
        const rec = readRecord({ root, ref: r.ref, run });
        if (!rec || rec.commit !== r.sha) continue;
        out.push({ target: t.name, stage: s.name, spec: r.spec, sha: r.sha, actor: rec.actor, at: rec.at, reason: rec.reason });
      }
    }
  }
  return out;
}

function shortSha(sha) { return sha ? sha.slice(0, 12) : null; }

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
    const rec = (report.records || []).find((x) => x.target === r.target && x.stage === r.stage && x.spec === r.spec);
    if (rec) lines.push("  " + " ".repeat(refWidth) + "  " + paint.dim("recorded by " + rec.actor + " at " + rec.at + " — " + rec.reason));
  }
  if (report.release) {
    lines.push("");
    lines.push(...renderScope(report.release, report.archived, paint));
    return lines.join("\n");
  }
  lines.push(...renderLanes(report.targets, report.archived, paint));
  if (report.unplaced.count) {
    lines.push("");
    lines.push(paint.dim(MARK.bullet + " " + report.unplaced.count + " closed task(s) are named by no commit on any ref, so no target can be given to them"));
  }
  return lines.join("\n");
}

/** The lanes, one per target, each a column of buckets. */
export function renderLanes(targets, archived, paint = color) {
  const lines = [];
  for (const t of targets) {
    lines.push("");
    lines.push(paint.bold(t.target) + (t.repository ? "  " + paint.dim("deployed from the repository `" + t.repository + "` — its commits and refs are not read here") : ""));
    const width = Math.max(...t.buckets.map((b) => b.label.length));
    for (const b of t.buckets) {
      let tally = String(b.count);
      if (b.unknown) tally = "? " + paint.warn("unknown") + " — " + b.unknownRefs.join(", ") + " does not resolve" + (b.count ? "; " + b.count + " could not be placed past it" : "");
      else if (b.kind === "reached" && !b.listed && b.count) tally += paint.dim("  (counted, not listed)");
      lines.push("  " + b.label.padEnd(width) + "  " + tally);
      for (const task of b.tasks) {
        const parts = [];
        if (task.status === null) parts.push("no task file");
        else if (task.closed && archived.indexOf(task.status) >= 0) parts.push(task.status + " " + task.closed);
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
  return lines;
}

/** Where one row stands, in words. */
function describeStanding(task) {
  if (task.note === "unscanned") return ["deployment not read"];
  if (task.note === "no-commits") return ["no commit on the trunk names it"];
  if (task.note === "no-target") return ["its commits touch no deploy target's paths"];
  if (task.note === "release-ref-unknown") return ["unknown — the release's ref does not resolve"];
  return task.standing.map((s) => {
    if (s.ref !== undefined) {
      if (s.state === "full") return "in " + s.ref;
      if (s.state === "absent") return "not in " + s.ref;
      return "partly in " + s.ref + (s.of ? " (" + s.held + " of " + s.of + " trunk commit(s))" : "");
    }
    if (s.state === "unobservable") return s.target + ": unobservable — deployed from `" + s.repository + "`";
    if (s.state === "unknown") return s.target + ": unknown — a ref of " + s.waitingFor + " does not resolve";
    const where = s.at === null ? "on the trunk" : "in " + s.at;
    return s.target + ": " + where + ", waiting for " + s.waitingFor + (s.state === "partial" ? " (partial)" : "");
  });
}

/** Which release is current, in words, from the point of view of `scope`. */
export function describeCurrent(scope) {
  if (scope.currentJudged === false) return "which release is current was not judged — deployment was not read";
  if (scope.current === null) return "no current release — every release in `releases:` has shipped, so none of its tasks blocks";
  if (scope.current === scope.name) return "the current release — the first in `releases:` not fully shipped";
  return "not the current release, which is " + scope.current + " — the first in `releases:` not fully shipped";
}

/** Where a release that names a ref ends and began, in words (TL-516). */
export function describeShippedAt(at, paint = color) {
  if (at.status !== "resolved") return "shipped at " + at.ref + " — " + paint.warn("unknown") + ": " + (at.why || "the ref does not resolve");
  let since = "since the root — the first release that names a ref";
  if (at.since) {
    since = "since " + at.since.release + " at " + at.since.ref + " " +
      (at.since.sha ? shortSha(at.since.sha) : paint.warn("unknown") + " — " + (at.since.why || "the ref does not resolve"));
  }
  return "shipped at " + at.ref + " " + shortSha(at.sha) + ", " + since;
}

/** The text answer of `--release`. */
export function renderScope(scope, archived, paint = color) {
  const lines = [];
  lines.push(paint.bold("release " + scope.name) + "  " + scope.planned + " planned · " +
    scope.shipped.count + " shipped (counted, not listed) · " + scope.dropped.count + " dropped");
  if (scope.current !== undefined) lines.push("  " + describeCurrent(scope));
  if (scope.shippedAt) lines.push("  " + describeShippedAt(scope.shippedAt, paint));
  const sections = [
    ["planned, not shipped", scope.notShipped, true],
    ["planned, still open", scope.open, false],
    scope.shippedAt
      ? ["shipped, unplanned", scope.shippedUnplanned, true]
      : ["unplanned, carried by the next promotion", scope.unplanned, true],
    ["planned, then dropped", scope.dropped, false],
  ];
  // Only a project with a target in another repository can have this list;
  // printing it at zero everywhere else would name a concept nobody declared.
  if (scope.unobservable.count) sections.splice(1, 0, ["planned, unobservable here", scope.unobservable, true]);
  const width = Math.max(...sections.map(([label]) => label.length));
  for (const [label, part, where] of sections) {
    lines.push("  " + label.padEnd(width) + "  " + (part.count === null ? "? " + paint.warn("unknown") : part.count));
    for (const task of part.tasks) {
      const parts = [task.status === null ? "no task file" : task.status];
      if (task.priority) parts.push(task.priority);
      if ((part === scope.unplanned || part === scope.shippedUnplanned) && task.release) parts.push("planned for " + task.release);
      if (where) parts.push(...describeStanding(task));
      lines.push("    " + paint.id(task.id) + "  " + (task.title === null ? "" : task.title) + "  " + paint.dim(parts.join(" · ")));
    }
  }
  return lines;
}

/** The whole computation, for a resolved backlog. */
export function computeStatus({ root, config, filter, count, release = null, now = Date.now(), run = spawnSync }) {
  const targets = config.deployTargets;
  const observed = observedTargets(targets);
  const repo = repoRoot(root);
  const trunk = defaultTrunk(repo, run);
  const state = deploymentState({ root: repo, prefix: config.taskIdPrefix, targets, trunk: trunk.spec, run });
  // Read only for `--release`, and only for entries naming a ref (TL-516).
  const shipments = release === null ? new Map() : readShipments({
    root: repo, prefix: config.taskIdPrefix, entries: releaseEntriesOf(config),
    trunkSha: state.scanned ? state.trunk.sha : resolveTrunkSha(run, repo, trunk.spec),
    trunkCommits: state.scanned ? state.commits : null, run,
  });
  const report = {
    trunk: { spec: trunk.spec, sha: state.trunk.sha, source: trunk.source },
    scan: deploymentScanJson(state),
    explanation: state.reason === "ok" ? null : explain(state.reason),
    filter,
    archived: config.archivedStatuses,
    targets: [],
    unplaced: { count: 0, ids: [] },
    release: null,
    records: readRecords({ run, root: repo, targets, refs: state.refs }),
  };
  // The plan is read even when git could not be: which planned tasks are open
  // is still an answer. Every other planned task is marked `unscanned` rather
  // than placed — "not shipped" there would be a verdict nobody measured.
  if (!state.scanned) {
    const metas = readTaskMetas(backlogPaths(root).tasksDir, config).filter((m) => m.id);
    // A target in another repository is answered without git: which tasks are
    // its, by their `target:` field. A project whose every target lives
    // elsewhere has nothing else to show.
    if (filter.stage === null) {
      const away = unobservableTasks(targets, metas, config.archivedStatuses);
      const describe = new Map(metas.map((m) => [m.id, { id: m.id, title: m.title, status: m.status, closed: null }]));
      for (const t of targets) {
        if (!isExternalTarget(t) || (filter.target !== null && t.name !== filter.target)) continue;
        report.targets.push(unobservableLane(t, away.get(t.name).map((id) => describe.get(id)), count));
      }
    }
    if (release !== null) {
      report.release = withCurrent(releaseScope({
        state, targets, tasks: metas.map(scopeRecord), release, archived: config.archivedStatuses,
        target: filter.target, count, shipment: shipments.get(release) || null,
      }), { state, targets, tasks: metas.map(scopeRecord), releases: config.releases, archived: config.archivedStatuses, shipments });
    }
    return { report, state };
  }

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

  const away = unobservableTasks(targets, metas, archived);
  const awayIds = new Set([...away.values()].flat());
  const off = readOffTrunk({ run, root: repo, state, targets: observed, prefix: config.taskIdPrefix, archivedIds });
  // A closed task of a target in another repository is named in that target's
  // lane; "named by no commit here" is not news about it.
  off.unplaced = off.unplaced.filter((id) => !awayIds.has(id));
  const pipeline = releasePipeline({
    state, targets,
    tasks: new Map([...tasks].map(([id, t]) => [id, { id, title: t.title, status: t.status, closed: null }])),
    commitTimes: readCommitTimes(run, repo, state.trunk.sha),
    tagTimes: readTagTimes(run, repo, state.refs),
    offTrunk: off.placed,
    now,
    filter,
    count,
    unobservable: away,
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
  if (release !== null) {
    const records = metas.filter((m) => m.id).map(scopeRecord);
    report.release = withCurrent(releaseScope({
      state, targets, tasks: records, release, archived, target: filter.target, count,
      shipment: shipments.get(release) || null,
    }), { state, targets, tasks: records, releases: config.releases, archived, shipments });
  }
  return { report, state };
}

/** The trunk's SHA when `deploymentState()` did not read it (no targets). */
function resolveTrunkSha(run, root, spec) {
  if (!root) return null;
  const r = git(run, root, ["rev-parse", "--verify", "--quiet", spec + "^{commit}"]);
  return r.status === 0 ? String(r.stdout || "").trim() || null : null;
}

/** The scope, naming the current release — computed over every target, never
 *  the one `--target` narrowed the scope to, because which release is current
 *  is a fact about the project, not about one deployable. With git unread it is
 *  not judged: `current: null` with `currentJudged: false`, which is not the
 *  `null` of "every release has shipped". */
function withCurrent(scope, opts) {
  if (!opts.state.scanned) return { ...scope, current: null, currentJudged: false };
  return { ...scope, current: currentRelease(opts), currentJudged: true };
}

function scopeRecord(m) {
  return { id: m.id, title: m.title, status: m.status, priority: m.priority || null, release: m.release || "", target: m.target || [] };
}

export function run(argv) {
  const cmd = N + " deploy status";
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
  const planned = checkReleaseFlag(opts, config.releases);
  if (!planned.ok) { console.error(failure(cmd, planned.message, [], [cmd + " --help"])); return 2; }

  const { report, state } = computeStatus({
    root, config, filter: { target: filter.target, stage: filter.stage }, count: opts.count, release: opts.release,
  });
  if (wantsJson) {
    printJson("release-status", {
      trunk: report.trunk, scan: report.scan, explanation: report.explanation,
      filter: report.filter, targets: report.targets, unplaced: report.unplaced, release: report.release,
      records: report.records,
    });
  } else if (!state.scanned) {
    console.log(color.ok(MARK.ok) + " nothing to report — " + report.explanation);
    // A target in another repository is answered from the task files alone.
    if (report.targets.length) console.log(renderLanes(report.targets, report.archived).join("\n"));
    // The plan is still an answer without git: which planned tasks are open.
    if (report.release) console.log(renderScope(report.release, report.archived).join("\n"));
  } else {
    if (report.explanation) console.error(color.warn(MARK.warn) + " " + report.explanation);
    console.log(renderStatus(report));
  }
  return state.reason === "git-failed" ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("release-status.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
