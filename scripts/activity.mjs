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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/** How the task on a row was decided (§8) — metadata about how much the row is
 *  worth, exactly as `source` is for the author of a field change. */
export const ATTRIBUTIONS = ["focus", "branch", "path", "declared", "unknown"];

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
  return {
    id: row.id || eventId(ts),
    ts,
    task,
    kind,
    actor,
    source: String((row && row.source) || "").trim() || "unknown",
    session: String((row && row.session) || "").trim(),
    attribution,
  };
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
