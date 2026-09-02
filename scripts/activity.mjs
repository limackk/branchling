#!/usr/bin/env node
/**
 * Evidence of activity — the data layer under time measurement (TL-27).
 *
 * WHAT THIS IS FOR. This backlog holds closed tasks with estimates written on
 * them and not one number saying how long the work took, so the estimates cannot
 * be checked against anything. §2 of docs/backlog-time-tracking.md (a real path
 * — product-name: allow) measured the three obvious sources of history and
 * disqualified all three; what survived is `git log -S"status: done"`, which
 * found the completion of 20 tasks out of 20 at second resolution.
 *
 * THE LINE THIS DRAWS, AND IT IS DELIBERATE: the completion STAMP is
 * backfilled, the working TIME is not. Time spent before the first heartbeat
 * does not exist, and inferring it would be the same class of pretty untruth
 * that §6 of docs/backlog-field-editing-history.md rejected when it refused to
 * backfill authorship out of git.
 *
 * THE SAME DISCIPLINE AS `history.mjs`, A DIFFERENT FILE. ULIDs, closed actor
 * namespaces, append-only, dedup by `id`. Heartbeats arrive in thousands per
 * task, and putting them in `history/` would flood the viewer's change axis and
 * slow every read of it (§5.1).
 *
 * A CORRUPT LINE MUST NOT LOSE THE REST. Appends below PIPE_BUF are atomic on
 * POSIX and that guarantee does not hold in the same form on Windows (§5.4), so
 * the reader is written to survive what the writer cannot promise.
 *
 * Tests: `node --test scripts/tests/activity.test.mjs`
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { backlogPaths } from "./paths.mjs";
import { eventId, isValidActor } from "./history.mjs";

/**
 * The classes of evidence a row may carry (§5).
 *
 * A CLOSED LIST IN THE CODE, not a vocabulary in config.yaml, for the reason the
 * actor namespaces are closed: `kind` says what KIND of proof this is, and every
 * consumer has to know the whole set to weigh it. A project inventing a sixth
 * would produce rows nothing knows how to read.
 */
export const ACTIVITY_KINDS = ["tool", "prompt", "commit", "edit", "reassign"];

/**
 * Which of those kinds are evidence that somebody was AT THE KEYBOARD.
 *
 * DEFINED ONCE, HERE, because three readers need it — `time --engaged`, the
 * versioned rollup, and any future one — and two of them disagreeing would mean
 * the terminal and the committed aggregate reporting different numbers for the
 * same task, with nothing to say which was right.
 *
 * `commit` is excluded and the reason is specific: almost every `commit` row in
 * existence was BACKFILLED out of git, which reconstructs an instant after the
 * fact. A reconstructed stamp is evidence about a file, not about a person's
 * presence, and admitting it would give every closed task a run of one —
 * inflating the count of runs too short to measure, which is the number the
 * throttling window is meant to be settled with.
 *
 * `reassign` is excluded because it is a CORRECTION to attribution, not
 * activity: counting it would make fixing a mistake look like doing more work,
 * and would leave a one-row cluster on the task somebody corrected AWAY from.
 */
export const HEARTBEAT_KINDS = ["tool", "prompt", "edit"];

/**
 * How the task on a row was decided (§8) — metadata about how much the row is
 * worth, exactly as `source` is for the author of a field change.
 *
 * THE FIVE LEGS OF THE CHAIN LIVE IN `attribution.mjs` (`ATTRIBUTION_CHAIN`) and
 * are repeated here rather than imported, so that the storage layer keeps no
 * dependency on the module that decides. The two are pinned against each other
 * by a test — a repetition nothing checks is how a closed set silently opens.
 *
 * `declared` is the sixth value and belongs to no leg: it marks a row whose task
 * the CALLER stated outright (`activity record --task <ID>`), which is a
 * statement rather than an inference. It stays in the set regardless of what the
 * chain does, because rows carrying it are already written and the file is
 * append-only.
 */
export const ATTRIBUTIONS = ["focus", "session-state", "path", "branch", "declared", "unknown"];

export function activityPath(root, taskId) {
  return join(backlogPaths(root).activityDir, taskId + ".jsonl");
}

export function rollupPath(root, taskId) {
  return join(backlogPaths(root).rollupDir, taskId + ".json");
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * One row, validated. PURE — it builds the object and refuses a bad one; it does
 * not write.
 *
 * EVERY FIELD IS CHECKED BEFORE ANYTHING IS APPENDED, because this file is
 * append-only: a row written wrong cannot be edited out later, only explained.
 *
 * @param {{ts?: string, task: string, kind: string, actor: string,
 *          source?: string, session?: string, attribution?: string}} row
 */
export function activityEntry(row) {
  const task = String((row && row.task) || "").trim();
  if (!task) throw new Error("an activity row with no task — the task is the whole point of the row");
  const kind = String((row && row.kind) || "").trim();
  if (ACTIVITY_KINDS.indexOf(kind) < 0) {
    throw new Error(
      "unknown activity kind `" + kind + "` — one of: " + ACTIVITY_KINDS.join(", ") + "\n" +
        "The set is closed on purpose: every reader has to know it to weigh the row."
    );
  }
  const actor = String((row && row.actor) || "").trim();
  if (!isValidActor(actor)) {
    throw new Error("the actor `" + actor + "` has no valid namespace");
  }
  const attribution = String((row && row.attribution) || "unknown").trim();
  if (ATTRIBUTIONS.indexOf(attribution) < 0) {
    throw new Error("unknown attribution `" + attribution + "` — one of: " + ATTRIBUTIONS.join(", "));
  }
  const ts = row.ts || new Date().toISOString();
  if (Number.isNaN(Date.parse(ts))) throw new Error("`ts` is not a date: " + ts);
  const entry = {
    id: row.id || eventId(ts),
    ts,
    task,
    kind,
    actor,
    source: String((row && row.source) || "").trim() || "unknown",
    session: String((row && row.session) || "").trim(),
    attribution,
  };

  // A CORRECTION CARRIES TWO EXTRA FIELDS AND NOTHING ELSE DOES (TL-31). The
  // log is append-only, so a misattributed row cannot be edited — the fix is a
  // NEW event saying where those rows should have gone, applied by the reader.
  // `to` and `since` are therefore meaningful only on a `reassign`, and putting
  // them on every row would both bloat a file that grows in the thousands and
  // invite a reader to look for a destination on rows that have none.
  const to = String((row && row.to) || "").trim();
  const since = String((row && row.since) || "").trim();
  if (kind === "reassign") {
    if (!to) throw new Error("a `reassign` with no `to` corrects nothing");
    if (to === task) throw new Error("a `reassign` from " + task + " to itself is not a correction");
    if (!entry.session) {
      throw new Error(
        "a `reassign` with no session would move every row of " + task + " ever recorded\n" +
          "The session is the scope of the mistake; without it this is not a correction but a merge."
      );
    }
    if (since && Number.isNaN(Date.parse(since))) throw new Error("`since` is not a date: " + since);
    entry.to = to;
    if (since) entry.since = since;
  } else if (to || since) {
    throw new Error("`to`/`since` belong to a `reassign` row, not to a `" + kind + "`");
  }
  return entry;
}

/** Append rows for ONE task. Returns what was written. */
export function appendActivity(root, taskId, rows) {
  if (!rows || !rows.length) return [];
  const entries = rows.map((r) => activityEntry({ ...r, task: r.task || taskId }));
  ensureDir(backlogPaths(root).activityDir);
  appendFileSync(activityPath(root, taskId), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return entries;
}

/**
 * One task's rows, oldest first, deduplicated by `id`.
 *
 * A line that does not parse is SKIPPED and the rest is returned — see the
 * header. Returning nothing would turn one interleaved write into the loss of a
 * whole task's measurement.
 */
export function readActivity(root, taskId) {
  const file = activityPath(root, taskId);
  if (!existsSync(file)) return [];
  const out = [];
  const seen = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (!parsed || typeof parsed !== "object") continue;
    if (typeof parsed.id === "string") {
      if (seen.has(parsed.id)) continue;
      seen.add(parsed.id);
    }
    out.push(parsed);
  }
  return out;
}

/**
 * Replace one task's rows with `rows`, or remove the file when none are left.
 *
 * THE ONE LEGITIMATE REWRITE OF AN APPEND-ONLY LOG, and it is narrow on
 * purpose: DELETION. Retention and erasure are the two operations that cannot
 * be expressed as an append — an event saying "forget the rows above" leaves
 * the rows above on disk, which is the whole thing a person asking to be
 * forgotten is asking not to happen (§9). Everything else — a correction, a
 * takeover, a mistake — is a new row and goes through `appendActivity`.
 *
 * IT NEVER EDITS A ROW. The rows handed in are rows that were already written;
 * this function only decides which of them survive. A caller passing a modified
 * row would be rewriting history through a door meant for removing it.
 */
export function rewriteActivity(root, taskId, rows) {
  const file = activityPath(root, taskId);
  if (!rows || !rows.length) {
    if (existsSync(file)) rmSync(file, { force: true });
    return 0;
  }
  ensureDir(backlogPaths(root).activityDir);
  writeFileSync(file, rows.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  return rows.length;
}

/** Every task this backlog holds activity for. */
export function listActivityTasks(root) {
  const dir = backlogPaths(root).activityDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.slice(0, -".jsonl".length))
    .sort();
}

/**
 * Every task's rows, with the corrections applied. PURE.
 *
 * WHY A CORRECTION IS APPLIED AT READ TIME AND NOT WRITTEN INTO THE FILE. The
 * log is append-only, and the reason is the same one `history/` has: a file
 * somebody may rewrite is a file whose past cannot be relied on. So the fix for
 * a row attributed to the wrong task is a NEW row saying where those rows
 * belong, and every reader applies it — the same shape as the dedup by `id`
 * that `readActivity` already does.
 *
 * DETERMINISTIC BY `id`, WHICH IS A ULID. Corrections compose: a session moved
 * from A to B and then from B to C has to end in C for every reader, on every
 * machine, whatever order the files happen to be read in. Lexicographic order
 * on a ULID is time order, so sorting by `id` is sorting by when the correction
 * was made, and applying them in that order is the only rule that composes.
 *
 * A `reassign` ROW IS NEVER ITSELF MOVED. It is a statement about activity, not
 * activity, and moving it would make a correction disappear into the task it
 * corrected — after which nothing could be corrected twice.
 *
 * @param {Record<string, object[]>} rowsByTask
 * @returns {Record<string, object[]>} a NEW map; the input is not mutated
 */
export function applyReassignments(rowsByTask) {
  const out = {};
  const corrections = [];
  for (const [task, rows] of Object.entries(rowsByTask || {})) {
    out[task] = [];
    for (const row of rows || []) {
      if (row && row.kind === "reassign" && row.to) corrections.push(row);
      out[task].push(row);
    }
  }
  corrections.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const fix of corrections) {
    const from = out[fix.task];
    if (!from) continue;
    const since = fix.since ? Date.parse(fix.since) : null;
    const moved = [];
    out[fix.task] = from.filter((row) => {
      if (!row || row.kind === "reassign") return true;
      if (String(row.session || "") !== String(fix.session)) return true;
      if (since !== null && Date.parse(row.ts || "") < since) return true;
      moved.push(row);
      return false;
    });
    if (!moved.length) continue;
    out[fix.to] = (out[fix.to] || []).concat(moved);
  }

  for (const task of Object.keys(out)) {
    out[task].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

/** Every task's rows in one call, corrections applied. The read path every
 *  report uses — a report reading `readActivity` directly would see the
 *  uncorrected log and would be wrong in exactly the way `reassign` exists to
 *  fix. */
export function readAllActivity(root) {
  const rowsByTask = {};
  for (const id of listActivityTasks(root)) rowsByTask[id] = readActivity(root, id);
  return applyReassignments(rowsByTask);
}

/**
 * Is this stamp already on record? PURE.
 *
 * DEDUP BY `id` IS NOT ENOUGH and that is the whole reason this exists: a ULID
 * is generated fresh on every run, so a second backfill would write a second
 * stamp for the same commit and every one of them would look like a distinct
 * event. The key is what the EVENT is — the task, the kind and the instant.
 */
export function hasStamp(entries, kind, ts) {
  return (entries || []).some((e) => e && e.kind === kind && e.ts === ts);
}

/**
 * The per-task aggregate, which IS versioned (§5.2).
 *
 * PER TASK AND NEVER ONE FILE. A single rollup would be a second `INDEX.yaml`:
 * every branch would rewrite it, and two branches sharing no task at all would
 * still conflict. Per task, a branch touches only its own tasks' files, and a
 * conflict means a real conflict.
 */
export function writeRollup(root, taskId, data) {
  ensureDir(backlogPaths(root).rollupDir);
  writeFileSync(rollupPath(root, taskId), JSON.stringify(data, null, 2) + "\n", "utf8");
  return data;
}

export function readRollup(root, taskId) {
  const file = rollupPath(root, taskId);
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
