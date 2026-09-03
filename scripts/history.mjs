#!/usr/bin/env node
/**
 * The history of task field changes (BL-1397) — writing, reading, reconciling.
 *
 * The model:
 *   backlog/history/<ID>.jsonl      ← append-only, ONE entry = ONE change to one
 *                                     field. Versioned in git.
 *   backlog/history/.snapshot.json  ← the last seen frontmatter of every task.
 *                                     NOT a source of truth, only a reference
 *                                     point for the diff. Gitignored.
 *
 * Why JSONL per task rather than one file: two sessions editing different tasks
 * do not conflict in git, and reading one task's history does not require
 * reading the history of the whole backlog.
 *
 * Why a snapshot: not every change goes through the server. An agent edits a
 * `.md` through Edit/Write, a person through their editor, and `git checkout`
 * rewrites hundreds of files at once. The diff "state on disk versus last seen"
 * is the only mechanism that sees all of them — who the author is, is stated by
 * the caller (a post-edit hook knows it is the agent; the server knows who is
 * selected in the viewer).
 *
 * Honesty instead of guessing: when there is NO snapshot (a fresh clone, a first
 * start), we do not invent history — we write the reference point and append not
 * one entry. Backfilling from git is deliberately NOT done — why, is explained in
 * docs/backlog-field-editing-history.md §6.
 *
 * Tests: `node --test scripts/tests/history.test.mjs`
 */

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { sessionId } from "./focus.mjs";
import { withMutex } from "./lock.mjs";
import { ACTOR_UNKNOWN, FIELD_ATTRIBUTED, FIELD_COMMENT, FIELD_CREATED, FIELD_DECISION, FIELD_DELETED, REASON_UNKNOWN, TRACKED_FIELDS, diffMeta, extractMeta, formatValue, hasStatedReason, normalizeActor as normalizeActorFn, normalizeReason, splitFrontmatter } from "./task-fields.mjs";
import { ANY_HISTORY_FILE, ANY_TASK_FILE, ANY_TASK_FILE_ID, ANY_TASK_ID, taskIdPatterns } from "./task-id.mjs";

export const HISTORY_DIRNAME = "history";
export const SNAPSHOT_FILE = ".snapshot.json";
export const MIGRATIONS_FILE = ".migrations.jsonl";

// The pseudo-fields live in task-fields.mjs (which is pasted into the viewer by
// source, so the browser and node see the same list). Here only a re-export, so
// that existing imports from history.mjs keep working.
export { FIELD_CREATED, FIELD_DELETED, FIELD_BODY, FIELD_COMMENT, FIELD_VERIFIED, FIELD_UNVERIFIED,
  FIELD_ROLE_OVERRIDE, FIELD_DECISION, FIELD_ATTRIBUTED, openQuestions, outstandingVouches, VOUCH_REFUSALS, VOUCH_SOURCES,
  PSEUDO_FIELDS, isPseudoField,
  ACTOR_NAMESPACES, ACTOR_UNKNOWN, actorParts, isValidActor, normalizeActor,
  REASON_UNKNOWN, REASON_PROVEN, REASON_SENTINELS, REASON_MAX_LENGTH, hasStatedReason, isValidReason,
  normalizeReason } from "./task-fields.mjs";

// ──────────────────────────────────────────────────────────────────────────
// The event identifier (BL-1404)
// ──────────────────────────────────────────────────────────────────────────
//
// ULID: 48 bits of time + 80 bits of randomness, Crockford base32, 26 characters.
//
// Why a ULID and not a hash of the content: two replicas stamp the same event
// with their own clocks, so a hash would drift apart anyway — while a random
// identifier gives something a hash cannot: ORDER. Lexicographic sorting is
// chronological sorting, so `id` is a ready-made synchronisation cursor ("give
// me the events after X").
//
// Why not a counter: a counter requires a single writer. The log has three write
// routes (the viewer, the hook, reconciliation) in separate processes, and in the
// target model many replicas — 80 bits of randomness need no agreement with
// anybody.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms, len) {
  let out = "";
  let n = Math.floor(ms);
  for (let i = 0; i < len; i++) {
    out = CROCKFORD[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(len) {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += CROCKFORD[bytes[i] % 32];
  return out;
}

/**
 * @param {string|Date|number} [ts] the event's timestamp; now by default.
 *        It is passed explicitly so that `id` and the `ts` field describe THE
 *        SAME instant — a drift between them would break sorting by id.
 */
export function eventId(ts) {
  const ms = ts === undefined ? Date.now() : new Date(ts).getTime();
  return encodeTime(Number.isFinite(ms) ? ms : Date.now(), 10) + encodeRandom(16);
}

export const EVENT_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const TASK_FILE_RE = ANY_TASK_FILE;

// ──────────────────────────────────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────────────────────────────────

export function historyDir(backlogDir) {
  return join(backlogDir, HISTORY_DIRNAME);
}

export function historyPath(backlogDir, taskId) {
  if (!ANY_TASK_ID.test(String(taskId || ""))) throw new Error("Bad task identifier: " + taskId);
  return join(historyDir(backlogDir), taskId + ".jsonl");
}

export function listTaskFiles(tasksDir) {
  return readdirSync(tasksDir).filter((f) => TASK_FILE_RE.test(f)).sort();
}

export function taskIdFromFile(file) {
  const m = String(file || "").match(ANY_TASK_FILE_ID);
  return m ? m[1] : null;
}

// ──────────────────────────────────────────────────────────────────────────
// Writing and reading entries
// ──────────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Append entries to a task's history. An append (O_APPEND), not a
 * read-modify-write —
 * two processes writing at once (the server and the hook) append rows instead of
 * overwriting one another.
 */
export function appendEntries(backlogDir, taskId, entries) {
  if (!entries || !entries.length) return [];
  ensureDir(historyDir(backlogDir));
  // An EMPTY `session` is never written (TL-164). Every line recorded before the
  // field existed has no session at all, so an empty string would be a third
  // state beside "absent" and "present" that means the same as the first — and a
  // reader would have to know that to count correctly.
  for (const e of entries) if (e && !e.session) delete e.session;
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(historyPath(backlogDir, taskId), lines, "utf8");
  return entries;
}

// ──────────────────────────────────────────────────────────────────────────
// Task lifecycle events (BL-1449)
// ──────────────────────────────────────────────────────────────────────────
//
// `__created__` and `__deleted__` describe a TASK EVENT, not a field change: one
// creation is meant to produce one entry, however many observers saw it. Dedup by
// `id` does not catch that, because a ULID identifies a WRITE — two writes about
// the same event have different ULIDs by definition.
//
// WHY THE KEY IS NOT `task+field+to`. The `to` value on `__created__` is the
// title, and a title is sometimes changed between one observer and the next — at
// which point a duplicate would pass the gate. The key is the event itself.
//
// WHY NOT "at most one per task". A task deleted and created again has TWO real
// creations. What makes a duplicate is a repetition of an event that does not
// change the state — that is, temporally adjacent entries of the same kind with
// no opposite event in between. Which is why what counts is the run, not a
// counter.
//
// WHICH ENTRY WINS: the better attributed one, and on a tie the earlier one.
// "Last write wins" would be the worst possible choice here — the second observer
// knows less by definition (`unknown`/`external`) than the one that saw the
// event.
const LIFECYCLE_FIELDS = [FIELD_CREATED, FIELD_DELETED];

function attributionRank(e) {
  const actor = e && typeof e.actor === "string" ? e.actor : "";
  return actor && actor !== ACTOR_UNKNOWN ? 1 : 0;
}

/** Event order: time, and on an identical stamp the ULID (also chronological). */
function eventOrder(a, b) {
  const ta = String((a && a.ts) || "");
  const tb = String((b && b.ts) || "");
  if (ta !== tb) return ta < tb ? -1 : 1;
  const ia = String((a && a.id) || "");
  const ib = String((b && b.id) || "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

function dedupeLifecycle(entries) {
  const marked = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e && LIFECYCLE_FIELDS.indexOf(e.field) !== -1) marked.push(i);
  }
  if (marked.length < 2) return entries;

  const order = marked.slice().sort((x, y) => eventOrder(entries[x], entries[y]));
  const drop = new Set();
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      let keep = run[0];
      for (const i of run.slice(1)) {
        const better = attributionRank(entries[i]) - attributionRank(entries[keep]);
        if (better > 0 || (better === 0 && eventOrder(entries[i], entries[keep]) < 0)) keep = i;
      }
      for (const i of run) if (i !== keep) drop.add(i);
    }
    run = [];
  };
  for (const i of order) {
    // The OPPOSITE event closes the run — everything after it describes the task's
    // next life, not the same fact all over again.
    if (run.length && entries[run[0]].field !== entries[i].field) flush();
    run.push(i);
  }
  flush();
  return drop.size ? entries.filter((_, i) => !drop.has(i)) : entries;
}

/** The last lifecycle event in the log, or null. */
export function lastLifecycleEvent(entries) {
  const life = (entries || []).filter((e) => e && LIFECYCLE_FIELDS.indexOf(e.field) !== -1);
  if (!life.length) return null;
  return life.sort(eventOrder)[life.length - 1];
}

/**
 * One task's entries, oldest first. A non-JSON line is skipped.
 *
 * Dedup by `id` (BL-1404): a `merge=union` merge can insert the same row twice
 * when two branches appended it independently. An entry WITHOUT an `id` (from
 * before BL-1404) is NOT deduplicated — there is nothing to compare it by, and
 * guessing from the content would collapse two genuine changes to the same value
 * into one.
 *
 * A second layer, by EVENT (BL-1449): the same creation recorded by two observers
 * has two different ULIDs, so dedup by `id` lets it through. This applies ONLY to
 * `__created__`/`__deleted__` — see `dedupeLifecycle()` above.
 */
export function readHistory(backlogDir, taskId) {
  const file = historyPath(backlogDir, taskId);
  if (!existsSync(file)) return [];
  const out = [];
  const seen = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; /* a corrupt line does not discard the rest */ }
    if (parsed && typeof parsed.id === "string") {
      if (seen.has(parsed.id)) continue;
      seen.add(parsed.id);
    }
    out.push(parsed);
  }
  return dedupeLifecycle(out);
}

/**
 * The reason a task carries while it waits for an answer, and how to read it
 * back. PURE, and a PAIR on purpose (TL-148).
 *
 * A blocking status may not be entered without a stated reason, so the question
 * is what that sentence says. It names the question's event id, because that is
 * the only thing a later `decide --resolves` can be matched against — and
 * matching it is what lifts the block. A reason that merely said "a question is
 * open" would leave the tool unable to tell WHICH answer discharges it, which is
 * the whole of the mechanism.
 *
 * The sentence is a sentence, not a code: it is read by people in `query`, in
 * the viewer and in `git log`. The id is parsed back out of it rather than kept
 * in a second field, because a second field is a second thing to keep true
 * (law 2).
 */
export const QUESTION_BLOCK_PREFIX = "waiting for an answer to ";

export function questionBlockReason(questionId) {
  return QUESTION_BLOCK_PREFIX + questionId;
}

/** The question id a block's reason names, or null. */
export function questionIdFromReason(reason) {
  const text = String(reason || "");
  if (!text.startsWith(QUESTION_BLOCK_PREFIX)) return null;
  const id = text.slice(QUESTION_BLOCK_PREFIX.length).trim();
  return EVENT_ID_RE.test(id) ? id : null;
}

/** { "<ID>": [...], ... } — only the tasks that have a history file. */
export function readAllHistory(backlogDir) {
  const dir = historyDir(backlogDir);
  if (!existsSync(dir)) return {};
  const out = {};
  for (const file of readdirSync(dir)) {
    const m = file.match(ANY_HISTORY_FILE);
    if (!m) continue;
    const entries = readHistory(backlogDir, m[1]);
    if (entries.length) out[m[1]] = entries;
  }
  return out;
}

/** The last change per field: { status: entry, title: entry, ... }. */
export function lastChangeByField(entries) {
  const out = {};
  for (const e of entries || []) if (e && e.field) out[e.field] = e;
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshot
// ──────────────────────────────────────────────────────────────────────────

/**
 * The name of the section every writer of THIS backlog's reference point has to
 * agree on (TL-214).
 *
 * KEYED BY THE BACKLOG, NOT BY THE REPOSITORY. `lockScope` keys a task
 * reservation by `--git-common-dir`, because the same task must not be handed
 * out twice across worktrees. The snapshot is the opposite case: every worktree
 * has its OWN `history/.snapshot.json`, so keying by the repository would make
 * writers in unrelated trees wait for each other while still being right.
 * `realpath` is what makes two spellings of one directory the same section.
 */
function snapshotSection(backlogDir) {
  let path = resolve(backlogDir);
  try {
    path = realpathSync(path);
  } catch {
    // Not yet on disk (a first `init`): the resolved path is still a usable
    // name, it just cannot be canonicalised.
  }
  return "snapshot:" + path;
}

export function snapshotPath(backlogDir) {
  return join(historyDir(backlogDir), SNAPSHOT_FILE);
}

export function hasSnapshot(backlogDir) {
  return existsSync(snapshotPath(backlogDir));
}

export function loadSnapshot(backlogDir) {
  const file = snapshotPath(backlogDir);
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" && data.tasks ? data : null;
  } catch {
    return null;   // a corrupt snapshot means no reference point, not a crash
  }
}

export function saveSnapshot(backlogDir, snapshot) {
  ensureDir(historyDir(backlogDir));
  const file = snapshotPath(backlogDir);
  // The temporary name carries the PID (TL-87). It used to be a constant, and
  // that was correct for as long as one process wrote at a time: with several
  // sessions taking tasks at once, two of them wrote the SAME temporary file and
  // the second `rename` hit ENOENT — a crash in the middle of a claim, not a
  // lost update. Measured: one failure in six parallel `next` calls.
  const tmp = file + "." + process.pid + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(snapshot, null, 0), "utf8");
    renameSync(tmp, file);   // an atomic swap — a reader never sees half a file
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw e;
  }
}

function pickTracked(meta) {
  const out = {};
  for (const key of TRACKED_FIELDS) out[key] = meta[key] == null ? "" : meta[key];
  return out;
}

export function metaFromText(text) {
  return extractMeta(splitFrontmatter(text).frontmatter);
}

// ──────────────────────────────────────────────────────────────────────────
// Prefix migrations (TL-111)
// ──────────────────────────────────────────────────────────────────────────
//
// THE DEFECT THIS EXISTS FOR. `migrate-prefix` renames every task and every
// history log, but the snapshot is keyed by task id and was left holding the OLD
// ids. The next reconcile then compared 74 remembered `BL-*` against 74 present
// `TL-*` and honestly reported 74 deletions and 74 creations — tombstones for a
// backlog that was never deleted. Since `history/*.jsonl` is versioned and
// merges by union, those tombstones are permanent, and every age or velocity
// computed from the log afterwards reads the migration day as the day the whole
// backlog was born.
//
// WHY A VERSIONED FACT AND NOT A HEURISTIC IN RECONCILE. The snapshot is
// gitignored and therefore LOCAL: repointing it in the clone that ran the
// migration fixes that clone and nobody else. The clone next door pulls a `TL-*`
// tree, compares it against its own `BL-*` snapshot and produces the same 74
// tombstones. Two ways out were on the table:
//
//   (b) reconcile RECOGNISES a bulk rename — an id `X-N` gone, a `Y-N` with the
//       same content arrived — and records a rename instead of the pair.
//   (c) the migration leaves an explicit, versioned record of "the prefix went
//       from X to Y at this instant", and reconcile READS it.
//
// (c) was chosen, and (b) rejected: this module's opening line is "honesty
// instead of guessing", and (b) is guessing. Content equality is exactly what a
// migration does NOT guarantee — a renumber landing in the same commit as an
// edit would defeat the match, and two unrelated tasks that happen to share a
// number and a title would satisfy it. (c) costs one more file in the data
// format and pays with an answer that is read rather than inferred, in every
// clone, and that also survives the migration being interrupted halfway.
//
// The file is `history/.migrations.jsonl`: append-only like the rest of the log,
// covered by the same `history/*.jsonl merge=union` rule, and invisible to
// `readAllHistory()` because a leading dot cannot start a task id.

export function migrationsPath(backlogDir) {
  return join(historyDir(backlogDir), MIGRATIONS_FILE);
}

/**
 * Recorded id migrations, oldest first, deduplicated by event id.
 *
 * TWO KINDS, one log. `prefix` changes the letters and keeps the number;
 * `renumber` changes the number and keeps the letters, and therefore cannot be
 * expressed as a rule — it carries an explicit `map` of every id it moved. A
 * reader that understood only one kind would silently treat the other as noise,
 * which is the tombstone bug (TL-111) with a different cause.
 */
export function readMigrations(backlogDir) {
  const file = migrationsPath(backlogDir);
  if (!existsSync(file)) return [];
  const out = [];
  const seen = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; /* a corrupt line does not discard the rest */ }
    if (!parsed) continue;
    if (parsed.kind === "prefix") {
      if (!parsed.from || !parsed.to) continue;
    } else if (parsed.kind === "renumber") {
      if (!parsed.map || typeof parsed.map !== "object") continue;
    } else continue;
    if (typeof parsed.id === "string") {
      if (seen.has(parsed.id)) continue;
      seen.add(parsed.id);
    }
    out.push(parsed);
  }
  return out.sort(eventOrder);
}

/**
 * Append one PREFIX migration to the log.
 *
 * @param {string} backlogDir
 * @param {{from: string, to: string, actor?: string, source?: string, ts?: string}} opts
 */
export function appendMigration(backlogDir, opts) {
  const ts = opts.ts || new Date().toISOString();
  const record = {
    id: eventId(ts), ts, kind: "prefix", from: opts.from, to: opts.to,
    actor: normalizeActorFn(opts.actor),
    source: opts.source || "migrate-prefix",
  };
  ensureDir(historyDir(backlogDir));
  appendFileSync(migrationsPath(backlogDir), JSON.stringify(record) + "\n", "utf8");
  return record;
}

/**
 * Append one RENUMBER migration to the log.
 *
 * WHY THE WHOLE MAP IS IN THE RECORD, and not a rule. A prefix migration is a
 * function of the old id: `BL-7` is `TL-7` under any tree. A renumber is not —
 * `PROJ-1303` becomes `PROJ-1` only because of where it happened to sit in a
 * particular ordering of a particular tree at a particular moment. Anything
 * short of the explicit pairs would ask a later reader to reconstruct that
 * ordering from a tree that no longer has the old ids in it.
 *
 * @param {string} backlogDir
 * @param {{prefix: string, map: Record<string,string>, actor?: string, source?: string, ts?: string}} opts
 */
export function appendRenumberMigration(backlogDir, opts) {
  const ts = opts.ts || new Date().toISOString();
  const record = {
    id: eventId(ts), ts, kind: "renumber", prefix: opts.prefix, map: { ...opts.map },
    actor: normalizeActorFn(opts.actor),
    source: opts.source || "renumber",
  };
  ensureDir(historyDir(backlogDir));
  appendFileSync(migrationsPath(backlogDir), JSON.stringify(record) + "\n", "utf8");
  return record;
}

/**
 * Repoint snapshot keys according to the recorded migrations.
 *
 * WHY EACH KEY IS CHECKED AGAINST THE TREE rather than rewritten wholesale. A
 * clone can hold the log without holding the renamed tasks — the two arrive in
 * one commit, but a checkout of an older revision, or a migration interrupted
 * halfway, separates them. Rewriting `BL-7` to `TL-7` while `BL-7` is still the
 * file on disk would MANUFACTURE the very tombstone pair this function exists to
 * prevent. So a key moves only when the old task is gone and the new one is
 * there — which makes this idempotent, and makes a partial migration heal on the
 * next run instead of hardening.
 *
 * @param {object} snapshot mutated in place
 * @param {object[]} migrations oldest first
 * @param {Set<string>} presentIds task ids currently in `tasks/`
 * @returns {number} how many keys were repointed
 */
export function applyIdMigrations(snapshot, migrations, presentIds) {
  if (!snapshot || !snapshot.tasks || !migrations || !migrations.length) return 0;
  let moved = 0;
  for (const m of migrations) {
    for (const id of Object.keys(snapshot.tasks)) {
      const newId = migratedId(m, id);
      if (newId === null || newId === id) continue;
      if (presentIds.has(id) || !presentIds.has(newId)) continue;
      if (snapshot.tasks[newId] === undefined) snapshot.tasks[newId] = snapshot.tasks[id];
      delete snapshot.tasks[id];
      moved++;
    }
  }
  return moved;
}

/** What one recorded migration says an id became, or null when it says nothing. */
function migratedId(m, id) {
  if (m.kind === "renumber") return Object.prototype.hasOwnProperty.call(m.map, id) ? m.map[id] : null;
  // The patterns come from task-id.mjs and not from a local template string:
  // a prefix is user input, and an unescaped `.` in it would widen the match
  // to ids belonging to another prefix entirely.
  const fromPat = taskIdPatterns(m.from);
  if (!fromPat.id.test(id)) return null;
  return m.to + "-" + id.match(fromPat.fileNumber)[1];
}

// ──────────────────────────────────────────────────────────────────────────
// Recording changes
// ──────────────────────────────────────────────────────────────────────────

/**
 * WHY `reason` IS ON EVERY ENTRY AND NOT ONLY THE ONES THAT REQUIRE IT
 * (TL-105). A field present on some rows and absent on others makes "no reason
 * given" and "no reason needed here" the same shape on disk, and a reader six
 * months on cannot tell them apart. Every entry carries the field; what varies
 * is whether it holds a sentence or a sentinel.
 */
function entry(taskId, field, from, to, actor, source, ts, reason, session, role) {
  const e = {
    id: eventId(ts), ts, task: taskId, field, from, to,
    actor: normalizeActorFn(actor),
    source: source || "unknown",
    reason: normalizeReason(reason),
  };
  // OMITTED WHEN THERE IS NONE, never written as "" (TL-164). The log is
  // append-only and every line written before this field existed has no session;
  // an empty string would be a THIRD state beside "absent" and "present", and a
  // reader would have to know that two of the three mean the same thing. An
  // absent key is what "nobody recorded which session" already looks like.
  const id = normalizeSession(session);
  if (id) e.session = id;
  // THE ROLE THE ACTOR WAS ACTING AS, under the same rule as `session` above
  // (TL-222): omitted when there is none, never written as "". Every line the
  // log already holds was written before this field existed, so an empty string
  // would be a third state beside absent and present.
  //
  // IT IS THE ACTOR'S ROLE, NOT THE TASK'S. The task's `role:` is a field and
  // `diffMeta` already reports a change to it; this says which hand made the
  // change, and the two differ exactly when they matter — a `handoff` writes
  // `role: dev → review` while the hand performing it is still `dev`.
  const acting = String(role || "").trim();
  if (acting) e.role = acting;
  return e;
}

/**
 * The session this process belongs to, for stamping an entry it is about to
 * write (TL-164).
 *
 * THE SAME VALUE THE ACTIVITY LOG USES, from the same function — that is the
 * whole point. The `session <id>` report joins the two logs, and a second
 * derivation of "which session is this" would make the join fail in exactly the
 * cases it exists for. `focus.mjs` documents why the fallback is the worktree
 * and why a per-process id would be worse.
 *
 * WHICH WRITES MAY STAMP IT, and this is the decision the field turns on: only
 * a command that MADE the change. Reconciliation records changes it merely
 * SAW — made by an editor, by git, by another session — and stamping the
 * observing process there would attribute somebody else's work to whoever
 * happened to run the reconcile. That is TL-130's defect with a new field, and
 * it is why `reconcile()` passes no session at all.
 */
export function currentSession(backlogDir, env = process.env) {
  try {
    return sessionId({ env, root: backlogDir });
  } catch {
    return "";
  }
}

/** The same shape the activity log accepts, so the two sides of the join cannot
 *  disagree about what counts as an identifier. */
export function normalizeSession(value) {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
}

/**
 * Which changes may not be made without a stated reason.
 *
 * The list is a VOCABULARY from `config.yaml` (`reason_required_statuses`), not
 * a set of literals here: `blocked` and `cancelled` are one project's words. The
 * shape of the rule lives in code, the values live in the configuration.
 *
 * ONLY status transitions, and that is a decision rather than a first cut.
 * Requiring a reason on every field change produces a "reason" on every typo
 * fixed in a title, and a field that is always filled with "update" carries no
 * signal a week later. The transitions that qualify are the ones whose why is
 * irrecoverable afterwards.
 *
 * @param {object} config the result of `loadConfig()`
 * @param {{field: string, to: any}} change
 */
export function requiresReason(config, change) {
  if (!config || !change || change.field !== "status") return false;
  const required = config.reasonRequiredStatuses || [];
  return required.indexOf(String(change.to)) !== -1;
}

/** The changes in a set that require a reason — for a caller that has to refuse
 *  BEFORE writing anything. */
export function changesRequiringReason(config, changes) {
  return (changes || []).filter((c) => requiresReason(config, c));
}

/**
 * Record a change for which we KNOW both states (the server's route: we read the
 * file, we write the file, we have the "before" and the "after"). The snapshot is
 * updated along the way, so that reconciliation does not report the same change a
 * second time as "unknown".
 */
export function recordEdit(backlogDir, opts) {
  const { taskId, before, after, actor, source, reason, role } = opts;
  const ts = opts.ts || new Date().toISOString();
  // This route is a command WRITING a change it is making, so the session is
  // known and is the process's own. A caller may state one (a server acting for
  // a request that carries its own) and pass "" to state that there is none.
  const session = opts.session === undefined ? currentSession(backlogDir) : opts.session;
  const changes = diffMeta(before, after);
  // The reason belongs to the ACT, and one act can move several fields — the
  // viewer writes one field at a time, `done` writes status and updated
  // together. Copying it onto every entry of the act is what makes the answer
  // survive reading any one of them alone.
  const entries = changes.map((c) => entry(taskId, c.field, c.from, c.to, actor, source, ts, reason, session, role));
  // The snapshot is one file for the whole backlog and this is a
  // read-modify-write of it (TL-214): without exclusion a writer that overlaps
  // with another saves a snapshot computed before the other's advance and
  // erases it, and the erased reference point is what the NEXT diff is taken
  // against. The entries are appended inside the section too, so that a reader
  // never sees a snapshot that has moved past entries nobody has written yet.
  return withMutex(snapshotSection(backlogDir), () => {
    appendEntries(backlogDir, taskId, entries);
    const snap = loadSnapshot(backlogDir) || { version: 1, tasks: {} };
    snap.tasks[taskId] = pickTracked(after);
    saveSnapshot(backlogDir, snap);
    return entries;
  });
}

/**
 * Compare the WHOLE tasks/ directory against the snapshot and record the
 * differences. This is the route for changes the server did not make: the agent
 * (through the hook), an editor, git.
 *
 * WHY THE REASON IS `unknown` HERE BY DEFAULT (TL-105). This route sees a
 * change that has ALREADY happened in a file somebody edited elsewhere; there is
 * nobody left to ask. Writing "" would say "no reason was needed", which is a
 * different claim and one nothing here can support — the same honesty the actor
 * gets on this path. A caller who DOES know (a person running `history` after a
 * batch of their own edits) passes `reason` and speaks for themselves.
 *
 * @param {string} backlogDir
 * @param {{actor?: string, source?: string, ts?: string, only?: string[], reason?: string,
 *          dryRun?: boolean}} opts
 *        `only` narrows which ids may produce ENTRIES (the hook knows one file).
 *        It does NOT narrow the seed: a first run writes a reference point for
 *        the whole tree, or it leaves 193 tasks in a state where their edits are
 *        absorbed unrecorded (TL-185). `dryRun` computes the entries and writes
 *        NOTHING — neither the log nor the snapshot.
 * @returns {{entries: object[], seeded: boolean, adopted: string[], dryRun?: boolean}}
 *          `adopted` names the tasks taken into the snapshot on the log's word
 *          alone, for fields the log has never mentioned and cannot vouch for.
 */
export function reconcile(backlogDir, opts = {}) {
  // WHY THE WHOLE FUNCTION AND NOT JUST THE SAVE (TL-214). What has to be
  // indivisible is load → diff → append → save: a snapshot read before another
  // writer's advance produces a diff against a reference point that no longer
  // exists, and saving it back erases that writer's advance whether or not the
  // save itself is atomic. `dryRun` is inside as well — a diagnosis taken
  // while somebody is halfway through writing describes a tree that never was.
  return withMutex(snapshotSection(backlogDir), () => reconcileLocked(backlogDir, opts));
}

function reconcileLocked(backlogDir, opts) {
  const tasksDir = join(backlogDir, "tasks");
  const ts = opts.ts || new Date().toISOString();
  const actor = opts.actor;
  const source = opts.source || "reconcile";
  const reason = opts.reason === undefined ? REASON_UNKNOWN : opts.reason;
  const only = opts.only && opts.only.length ? new Set(opts.only) : null;

  const existing = loadSnapshot(backlogDir);
  const seeding = existing === null;
  const snap = existing || { version: 1, tasks: {} };

  const taskFiles = listTaskFiles(tasksDir);
  // BEFORE the diff, not after (TL-111): a prefix migration renamed every task,
  // and a snapshot still keyed by the old ids would make the diff below report
  // the whole backlog as deleted and recreated. The migration log is the fact
  // that turns that pair back into the rename it was.
  if (!seeding) {
    const presentIds = new Set(taskFiles.map(taskIdFromFile).filter(Boolean));
    applyIdMigrations(snap, readMigrations(backlogDir), presentIds);
  }

  const seenIds = new Set();
  const entries = [];
  const adopted = [];

  for (const file of taskFiles) {
    const id = taskIdFromFile(file);
    if (!id) continue;
    seenIds.add(id);
    const selected = !only || only.has(id);
    // A SEED COVERS THE WHOLE TREE, even when the run names ONE file (TL-185).
    // The `only` filter says which task may produce ENTRIES; it must not decide
    // how much of the tree gets a reference point. It used to do both, and a
    // single post-edit hook firing in a tree with no snapshot — which is EVERY
    // fresh worktree, `.snapshot.json` being gitignored — wrote a snapshot
    // holding one task out of 194. From that moment the other 193 were "missing
    // from the snapshot", and the branch below absorbed their edits in silence.
    // Measured on 2026-09-03: nine `executor` fields and one `priority` moved
    // into the snapshot and reached no log.
    if (!selected && !seeding) continue;
    let meta;
    try {
      meta = metaFromText(readFileSync(join(tasksDir, file), "utf8"));
    } catch {
      continue;
    }
    const after = pickTracked(meta);
    const before = snap.tasks[id];
    if (!seeding && selected) {
      // The snapshot is LOCAL, the history file is SHARED (versioned). A task
      // missing from the snapshot does not mean "new": it also means "it arrived
      // by a merge or a pull". Before writing anything, we ask the history what
      // it already knows.
      const hist = readHistory(backlogDir, id);
      const known = lastChangeByField(hist);
      const alreadyRecorded = (field, value) =>
        known[field] !== undefined && formatValue(known[field].to) === formatValue(value);

      if (!before) {
        // An empty history means the task really was created here. A non-empty
        // one means somebody has already recorded its creation; we are only
        // adding a reference point.
        //
        // The exception (BL-1449): a history ending in `__deleted__` describes a
        // task that NO LONGER EXISTS. Since the file is back, this is a new
        // creation, not a repeat of the previous one — without this condition a
        // recreated task would never reach the history at all.
        const life = lastLifecycleEvent(hist);
        if (!Object.keys(known).length || (life && life.field === FIELD_DELETED)) {
          entries.push(entry(id, FIELD_CREATED, "", meta.title || id, actor, source, ts, reason));
        } else {
          // THE HISTORY IS THE REFERENCE POINT WHEN THE SNAPSHOT HAS NONE
          // (TL-185). Deciding the task is not new used to end the matter: the
          // file was taken as the reference point and every pending change went
          // into the snapshot unrecorded. The log already holds the last value
          // of every field it has ever seen — that is a reference point, and it
          // is the same one `alreadyRecorded` trusts in the branch below, so the
          // two cannot disagree about what counts as recorded.
          //
          // A task that arrived by a pull carries its OWN log, so the values
          // agree and nothing is written — the case this branch was built for is
          // unaffected. A task edited by hand while absent from the snapshot
          // disagrees, and that disagreement IS the unrecorded change.
          const fromLog = {};
          for (const key of TRACKED_FIELDS) if (known[key] !== undefined) fromLog[key] = known[key].to;
          const attested = Object.keys(fromLog);
          for (const c of diffMeta(fromLog, after, attested)) {
            entries.push(entry(id, c.field, c.from, c.to, actor, source, ts, reason));
          }
          // WHAT THE LOG CANNOT ATTEST TO. A field the log has never mentioned
          // has no last value, so there is no honest `from` to write and no way
          // to tell an edit apart from the value the task was created with.
          // Inventing `from: ""` would put a fabricated change in an append-only
          // log. It is absorbed — and NAMED, because absorbing it in silence is
          // the whole defect this task was opened for.
          if (attested.length < TRACKED_FIELDS.length) adopted.push(id);
        }
      } else {
        for (const c of diffMeta(before, after)) {
          // The same change recorded in another tree arrives TOGETHER with its
          // entry. Without this condition every `git pull` would log it a second
          // time as `unknown`, erasing the real author in the reader's eyes.
          if (alreadyRecorded(c.field, c.to)) continue;
          entries.push(entry(id, c.field, c.from, c.to, actor, source, ts, reason));
        }
      }
    }
    snap.tasks[id] = after;
  }

  // Files that disappeared — only on a full run; with `only`, a missing file
  // means "not this task", not "deleted".
  if (!seeding && !only) {
    for (const id of Object.keys(snap.tasks)) {
      if (seenIds.has(id)) continue;
      // Symmetrically to `__created__` (BL-1449): a deletion is also seen by each
      // observer separately, and the snapshot is local. If the shared history
      // already knows about it, a second entry would describe the same event as
      // `unknown`.
      const life = lastLifecycleEvent(readHistory(backlogDir, id));
      if (!life || life.field !== FIELD_DELETED) {
        entries.push(entry(id, FIELD_DELETED, snap.tasks[id].title || id, "", actor, source, ts, reason));
      }
      delete snap.tasks[id];
    }
  }

  // `dryRun` ASKS the question without answering it in the log (TL-162).
  // `doctor` needs exactly this diff and fixes nothing by design; a diagnosis
  // that wrote would also sign somebody else's edit with whoever happened to run
  // it, which is the defect TL-130 describes on the server's side. The snapshot
  // is left alone too — moving it forward is what makes a change invisible to
  // the person who is about to claim it.
  if (opts.dryRun) return { entries, seeded: seeding, adopted, dryRun: true };

  // THE LOG FIRST, THE SNAPSHOT AFTER, and the order is the guarantee (TL-185):
  // a crash between the two loses the reference point, which the next run
  // rebuilds, and never the entries, which nothing can rebuild. Reversed, the
  // snapshot would say the change had been seen while no log recorded it — the
  // one failure this whole mechanism exists to prevent.
  for (const e of entries) appendEntries(backlogDir, e.task, [e]);
  saveSnapshot(backlogDir, snap);
  return { entries, seeded: seeding, adopted };
}

// ──────────────────────────────────────────────────────────────────────────
// Claiming a change the log recorded as nobody's (TL-130)
// ──────────────────────────────────────────────────────────────────────────
//
// THE DEFECT. The viewer's server reconciles the tree on a timer, so a change
// made by hand while it is running is recorded before the session that made it
// can say so — as `actor: unknown`, `source: external`, `reason: unknown`.
// Reconcile then updates the snapshot, so the documented path (`history --actor
// <ns:name> --source manual --reason "…"`) finds no DIFFERENCE and prints "no
// changes to record". It looks like it worked. Measured on 2026-09-01 against
// TL-99 and TL-100.
//
// WHY NOT A LONGER GRACE WINDOW. `RECONCILE_DELAY_MS` already is one, and it
// works for a hook that writes in milliseconds. Widening it is still a bet on
// timing: a person who edits a file and attributes the change a minute later
// loses whatever the number is. A rule that holds regardless of when the two
// writers happen to run is worth more than a bigger number.
//
// WHY NOT MAKE RECONCILE READ-ONLY. Then a change nobody ever claims never
// reaches the log at all, and the mechanism's whole point — that a change leaves
// a trace even when its author says nothing — would be traded away to fix the
// case where the author DOES say something.
//
// SO: THE ENTRY STAYS AND IS CLAIMED BESIDE IT. The log remains append-only, no
// timing is assumed, and the original entry keeps saying `unknown` — which was
// true when it was written.

/** Whether this entry is one nobody has claimed: the tool wrote it because it
 *  saw a change, not because anybody said they made it. */
export function isUnattributed(e) {
  return !!e && normalizeActorFn(e.actor) === ACTOR_UNKNOWN && !hasStatedReason(e);
}

/**
 * The recorded changes that nobody has claimed, per task.
 *
 * A change already claimed by an `__attributed__` entry is not offered again —
 * two people claiming one change is a conversation the log cannot represent, and
 * the FIRST claim is the one that was made in good faith.
 *
 * @param {string} backlogDir
 * @param {{only?: string[]}} opts  restrict to these task ids
 * @returns {Array<{task: string, entry: object}>} oldest first
 */
export function unattributedChanges(backlogDir, opts = {}) {
  const only = opts.only && opts.only.length ? new Set(opts.only) : null;
  const all = readAllHistory(backlogDir);
  const out = [];
  for (const task of Object.keys(all).sort()) {
    if (only && !only.has(task)) continue;
    const entries = all[task] || [];
    const claimed = new Set(
      entries.filter((e) => e.field === FIELD_ATTRIBUTED && e.attributes).map((e) => e.attributes)
    );
    for (const e of entries) {
      // An `__attributed__` entry is itself always attributed — it exists
      // because somebody spoke. Offering it back would let a claim be claimed.
      if (e.field === FIELD_ATTRIBUTED) continue;
      if (!isUnattributed(e)) continue;
      if (e.id && claimed.has(e.id)) continue;
      out.push({ task, entry: e });
    }
  }
  return out.sort((a, b) => String(a.entry.ts).localeCompare(String(b.entry.ts)));
}

/**
 * Claim them: one `__attributed__` entry per change, appended.
 *
 * @param {string} backlogDir
 * @param {Array<{task: string, entry: object}>} changes  from `unattributedChanges`
 * @param {{actor: string, reason: string, source?: string, ts?: string}} by
 * @returns {Array<object>} the entries written
 */
export function attributeChanges(backlogDir, changes, by) {
  const ts = by.ts || new Date().toISOString();
  const written = [];
  for (const { task, entry: target } of changes) {
    // `to` is the FIELD that was changed, so the row reads as a sentence
    // without following the link; `attributes` is the link, and it is what a
    // second claim of the same change is refused by.
    const e = entry(task, FIELD_ATTRIBUTED, "", target.field, by.actor, by.source || "manual", ts, by.reason);
    e.attributes = target.id || null;
    appendEntries(backlogDir, task, [e]);
    written.push(e);
  }
  return written;
}
