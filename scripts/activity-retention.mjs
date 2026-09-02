#!/usr/bin/env node
/**
 * Retention, erasure and correction — what the log gives BACK (TL-31).
 *
 * WHY THIS IS NOT A LATER PHASE. From TL-28 onwards `activity/` holds a record
 * of what hour a particular person worked, day after day. In a public
 * repository that is surveillance metadata; in a company repository it is
 * employee data; in the EU it is personal data. §9 of
 * docs/backlog-time-tracking.md (a real path — product-name: allow) makes these
 * three mechanisms a CONDITION of the module rather than a follow-up, and the
 * reason is not legal caution: a system that collects and cannot give back is
 * one whose only remedy is deleting the whole directory, which also deletes
 * everybody else's measurement.
 *
 * THE THREE, AND WHY THEY ARE DIFFERENT OPERATIONS:
 *
 *   prune     Time passes. Raw rows past `activity_retention_days` go, and the
 *             AGGREGATE stays — at the resolution of "TL-28 took 4.5 hours
 *             across 3 sessions" it is no longer data about a person, and it is
 *             the whole input to estimate calibration. Recomputing before
 *             deleting is what stops the retention window eating the history it
 *             exists to make safe to keep.
 *   forget    A person asks. Their raw rows go AND the aggregates are recomputed
 *             WITHOUT them, because an aggregate rebuilt from rows that are gone
 *             is the data coming back at the next report. This is the one place
 *             the two operations differ, and it is the whole difference between
 *             expiry and erasure.
 *   reassign  Somebody was measured against the wrong task. The log is
 *             append-only, so the correction is a NEW row and the reader applies
 *             it (`applyReassignments`). Nothing on disk is edited.
 *
 * WHAT THIS DOES NOT MAKE TRUE. It does not make a deployment compliant with
 * anything. It hands a deployer minimisation, retention, erasure and
 * correction; the legal basis, informing the people measured, and any
 * assessment stay with whoever runs it. `forget --actor` also acts on a CLAIM
 * and not on proof — there is no actor authentication, which is the same
 * boundary the local version has everywhere else.
 *
 * Tests: `node --test scripts/tests/retention.test.mjs`
 */

import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  HEARTBEAT_KINDS, activityDir, activityPath, applyReassignments, legacyActivityDir,
  listActivityTasks, readActivity, readAllActivity, rewriteActivity, rollupPath, writeRollup,
} from "./activity.mjs";
import { engagedTime } from "./cluster.mjs";
import { backlogPaths } from "./paths.mjs";

/**
 * The versioned aggregate for one task (§5.2 and §9). PURE.
 *
 * EXACTLY THE FIVE FIELDS §9 ALLOWS OUT OF THE MACHINE — minutes, sessions,
 * first, last, unknown_ratio — and no sixth. Every field here is a decision
 * about what may survive a person's raw rows, so the list is short on purpose:
 * a per-actor breakdown or a session-by-session table would be the working
 * calendar again, in a file that IS committed.
 *
 * `unknown_ratio` travels with the aggregate because a number nobody can weigh
 * is worse than no number, and after `prune` the rows that would let a reader
 * weigh it themselves are gone.
 */
export function rollupFor(rows, opts = {}) {
  const heartbeats = (rows || []).filter((r) => r && HEARTBEAT_KINDS.indexOf(r.kind) >= 0);
  const stats = engagedTime(heartbeats, opts);
  return {
    minutes: stats.minutes,
    sessions: stats.sessions,
    first: stats.first,
    last: stats.last,
    unknown_ratio: stats.unknownRatio,
  };
}

/**
 * Recompute every task's aggregate from the rows that exist NOW.
 *
 * CORRECTIONS ARE APPLIED FIRST. A rollup built from the raw files would credit
 * the minutes to the task a `reassign` says they do not belong to, and the
 * aggregate is the artefact that OUTLIVES the rows — so a correction that never
 * reached it would be undone by the next `prune`.
 */
export function recomputeRollups(root, config) {
  const rowsByTask = readAllActivity(root);
  const written = [];
  for (const task of Object.keys(rowsByTask).sort()) {
    const rollup = rollupFor(rowsByTask[task], { idleGapMinutes: config.idleGapMinutes });
    writeRollup(root, task, rollup);
    written.push({ task, ...rollup });
  }
  return written;
}

/** The instant before which raw rows are past the window. PURE. */
export function cutoff(days, now) {
  return new Date((now || Date.now()) - days * 86400000).toISOString();
}

/**
 * Delete raw rows older than the retention window, keeping the aggregates.
 *
 * THE ORDER IS THE POINT AND IT IS NOT REVERSIBLE. Aggregates are recomputed
 * from the FULL log first, and only then are the old rows removed. Deleting
 * first and recomputing after would silently rewrite every historical figure to
 * "the last 90 days" — the calibration input would shrink every night, and the
 * report would look exactly as healthy as before.
 *
 * @returns {{cutoff: string, removed: number, kept: number,
 *            perTask: Array<{task: string, removed: number, kept: number}>}}
 */
export function prune(root, config, opts = {}) {
  const days = opts.days === undefined ? config.activityRetentionDays : opts.days;
  const before = cutoff(days, opts.now);
  const dryRun = Boolean(opts.dryRun);

  if (!dryRun) recomputeRollups(root, config);

  let removed = 0;
  let kept = 0;
  const perTask = [];
  for (const task of listActivityTasks(root)) {
    const rows = readActivity(root, task);
    const survivors = rows.filter((r) => String(r.ts || "") >= before);
    const gone = rows.length - survivors.length;
    removed += gone;
    kept += survivors.length;
    if (gone) perTask.push({ task, removed: gone, kept: survivors.length });
    if (gone && !dryRun) rewriteActivity(root, task, survivors);
  }
  return { cutoff: before, removed, kept, perTask, dryRun, days };
}

/**
 * Erase one actor's raw rows, and rebuild the aggregates without them.
 *
 * THE RECOMPUTE COMES AFTER, unlike `prune`, and the inversion is the whole
 * semantics: expiry keeps the summary because time passing does not revoke
 * consent, erasure does not because the person asked for their data to stop
 * existing. An aggregate left standing over deleted rows is the data coming
 * back at the next report, which is precisely what somebody exercising this is
 * asking not to happen.
 *
 * A `reassign` ROW BY THAT ACTOR IS KEPT. It is a statement about somebody
 * else's rows, and dropping it would silently un-correct an attribution the
 * person fixed — restoring a claim about them, in the act of erasing them.
 */
export function forget(root, config, opts = {}) {
  const actor = String(opts.actor || "").trim();
  if (!actor) throw new Error("`forget` with no actor would erase everybody");
  const dryRun = Boolean(opts.dryRun);

  let removed = 0;
  let kept = 0;
  const perTask = [];
  for (const task of listActivityTasks(root)) {
    const rows = readActivity(root, task);
    const survivors = rows.filter((r) => r.actor !== actor || r.kind === "reassign");
    const gone = rows.length - survivors.length;
    removed += gone;
    kept += survivors.length;
    if (gone) perTask.push({ task, removed: gone, kept: survivors.length });
    if (gone && !dryRun) rewriteActivity(root, task, survivors);
  }

  if (!dryRun && removed) {
    // Aggregates for tasks whose file is now gone entirely have to go too:
    // `recomputeRollups` walks the files that EXIST, so it would leave a
    // stale rollup behind as the last trace of somebody who asked to be
    // forgotten.
    const alive = new Set(listActivityTasks(root));
    const dir = backlogPaths(root).rollupDir;
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".json")) continue;
        const task = file.slice(0, -".json".length);
        if (!alive.has(task)) rmSync(rollupPath(root, task), { force: true });
      }
    }
    recomputeRollups(root, config);
  }
  return { actor, removed, kept, perTask, dryRun };
}

/**
 * Which rows a correction would move, without writing it. PURE-ish — it reads.
 *
 * `reassign` itself is an APPEND and lives in `activity-command.mjs` beside the
 * other write; this is the preview, and it exists because a correction is one
 * of the few operations whose effect is invisible in the file it is written to.
 */
export function reassignPreview(root, from, session, since) {
  const rows = readActivity(root, from).filter((r) => r && r.kind !== "reassign");
  const at = since ? Date.parse(since) : null;
  return rows.filter((r) =>
    String(r.session || "") === String(session) &&
    (at === null || Date.parse(r.ts || "") >= at));
}

/**
 * What the tool holds about the people it measures, in one place.
 *
 * ONE PLACE, because the alternative is a person reading five files to work out
 * what a tool records about them — and a mechanism that has to be reconstructed
 * before it can be used is one nobody uses. It reports the window, the mode,
 * what is versioned and what is not, and it counts the rows rather than
 * describing them.
 */
export function privacyReport(root, config) {
  const paths = backlogPaths(root);
  const rowsByTask = {};
  for (const task of listActivityTasks(root)) rowsByTask[task] = readActivity(root, task);
  const corrected = applyReassignments(rowsByTask);

  const actors = new Map();
  let rows = 0;
  let oldest = null;
  for (const list of Object.values(rowsByTask)) {
    for (const row of list) {
      rows++;
      actors.set(row.actor, (actors.get(row.actor) || 0) + 1);
      if (!oldest || String(row.ts) < oldest) oldest = String(row.ts);
    }
  }

  return {
    root,
    privacy: config.activityPrivacy,
    retentionDays: config.activityRetentionDays,
    cutoff: cutoff(config.activityRetentionDays, Date.now()),
    rawRows: rows,
    oldestRow: oldest,
    tasks: Object.keys(corrected).length,
    actors: [...actors.entries()].sort((a, b) => b[1] - a[1]).map(([actor, count]) => ({ actor, count })),
    // Said as paths rather than as a sentence: "the raw log is not versioned"
    // is a claim, and a path is something a person can go and check.
    versioned: [paths.rollupDir],
    // Since TL-35 the raw log is not merely ignored by git, it is OUTSIDE every
    // repository. Reported as a path rather than as a sentence for the reason
    // the versioned one is: a person can go and look at a path.
    notVersioned: [activityDir(root) + "/*.jsonl"],
  };
}


/**
 * Move a raw log written before TL-35 into the home directory.
 *
 * WHY THIS EXISTS AT ALL. The relocation is a structural fix, and a structural
 * fix that leaves the old data where it was has moved the RULE without moving
 * the DATA: the measurement simply disappears from every report, which reads
 * exactly like a tool that never recorded anything. So there is one command,
 * and it is idempotent.
 *
 * IDEMPOTENT BY ROW ID, NOT BY FILE. Running it twice must not double anybody's
 * minutes, and a file-level "already moved?" check cannot answer that once a
 * partial move has happened. The rows of both locations are merged on `id` —
 * the same key `readActivity` already dedups on — and the source file is removed
 * only after the merged set is safely written.
 *
 * IT DOES NOT TOUCH `rollup/`. The aggregate stays in the repository and stays
 * versioned; that boundary is §9's and this task does not move it.
 */
export function migrate(root, opts = {}) {
  const env = opts.env || process.env;
  const from = legacyActivityDir(root);
  const dryRun = Boolean(opts.dryRun);
  const moved = [];
  let rows = 0;

  if (!existsSync(from)) return { from, to: activityDir(root, env), files: moved, rows, dryRun };

  for (const file of readdirSync(from).sort()) {
    if (!file.endsWith(".jsonl")) continue;
    const task = file.slice(0, -".jsonl".length);
    const source = join(from, file);
    const incoming = readJsonl(source);
    if (!incoming.length) continue;

    const existing = readActivity(root, task, env);
    const seen = new Set(existing.map((r) => r.id));
    const added = incoming.filter((r) => r && r.id && !seen.has(r.id));
    moved.push({ task, rows: incoming.length, added: added.length });
    rows += added.length;
    if (dryRun) continue;

    // Written first, removed second. The other order loses the rows if the
    // write fails, and this is the one operation whose input cannot be
    // reconstructed from anywhere else.
    const merged = existing.concat(added).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    rewriteActivity(root, task, merged, env);
    rmSync(source, { force: true });
  }
  return { from, to: activityDir(root, env), files: moved, rows, dryRun };
}

/** One file's rows, skipping what does not parse — the same tolerance
 *  `readActivity` has, and for the same reason. */
function readJsonl(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch { /* a corrupt line loses itself, not the file */ }
  }
  return out;
}
