/**
 * One task-field write, shared by every caller that sets a field (TL-521).
 *
 * WHY ONE MODULE. The served viewer's POST /api/task was the only general field
 * write, and an external interface (another package, an editor extension, a
 * script) had no supported way to make the same edit: it could write the
 * markdown itself, bypassing the field specs, the reason rule and the history,
 * or depend on a private HTTP contract. The fourth law promises a callable
 * input on every writing operation, so `set` exists — and a second copy of the
 * validation beside the server's would drift on its first change. Both paths
 * call `writeTaskField()`; what differs between them is only who they are
 * (`source`), which fields they may touch (`refusedFields`) and whether the
 * caller must prove it read the current text (`revision`).
 *
 * Returns a RESULT rather than throwing or printing, for the reason `takeTask`
 * and `handoffTask` do: the shape is testable without a subprocess, and each
 * caller renders a refusal in its own medium (an HTTP status, an exit code).
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readTasks } from "./build-viewer.mjs";
import { listTaskFiles, recordEdit, requiresReason } from "./history.mjs";
import { backlogPaths } from "./paths.mjs";
import { ANY_TASK_ID } from "./task-id.mjs";
import {
  ACTOR_NAMESPACES,
  buildFieldSpecs,
  extractMeta,
  isValidActor,
  isValidReason,
  normalizeValue,
  reasonRefusal,
  setFrontmatterField,
  splitFrontmatter,
} from "./task-fields.mjs";
import { todayStamp } from "./today.mjs";

/**
 * The fields a general write refuses because a dedicated command owns them,
 * with the commands that do. A status change is not a field edit: `done` runs
 * the verification, `take` reserves, `handoff` and `release` record the
 * exchange, `ask` records the question. A second path that only rewrote the
 * value would skip every one of those, and the owner moves with the same
 * commands for the same reason.
 */
export const DEDICATED_FIELDS = Object.freeze({
  status: ["take", "done", "handoff", "release", "ask"],
  owner: ["take", "handoff", "release"],
});

/** The optimistic revision of a task's text — what a reader proves it saw. */
export function taskRevision(text) {
  return createHash("sha256").update(text).digest("base64url");
}

/** The task file for an id, or null — never a guess from a partial match. */
export function fileForTaskId(tasksDir, id) {
  if (!ANY_TASK_ID.test(String(id || ""))) return null;
  return listTaskFiles(tasksDir).find((file) => file.startsWith(id + "-")) || null;
}

/** The dynamic vocabularies `normalizeValue` checks against, read from the tree. */
export function fieldOptions(root, config) {
  const tasks = readTasks(root, config);
  const values = (key) => [...new Set(tasks.map((task) => String(task[key] || "").trim()).filter(Boolean))].sort();
  return { boards: config.boards.map((board) => board.slug), epics: values("epic"), owners: values("owner") };
}

/** The fields a caller refusing `refusedFields` may set, in declaration order. */
export function writableFields(config, refusedFields = []) {
  return buildFieldSpecs(config).filter((spec) => refusedFields.indexOf(spec.key) < 0);
}

function atomicReplace(file, text) {
  const staged = file + `.write-${process.pid}-${randomBytes(6).toString("hex")}`;
  writeFileSync(staged, text, { encoding: "utf8", flag: "wx" });
  try { renameSync(staged, file); } catch (error) {
    try { unlinkSync(staged); } catch { /* the rename may already have consumed it */ }
    throw error;
  }
}

function refused(kind, status, message, extra = {}) {
  return { ok: false, kind, status, message, details: [], ...extra };
}

/**
 * Validate, write and record one field of one task.
 *
 * Every refusal is decided BEFORE the file is touched; the one failure after
 * the write — the history could not be appended — restores the original text,
 * because an edit with no attribution is indistinguishable from a hand edit.
 *
 * @param {{root: string, config: object, id: string, field: string, value: unknown,
 *          actor: string, reason?: string, source: string, revision?: string|null,
 *          refusedFields?: string[]}} opts
 *   `revision` — when the key is present (even as null) the write requires it to
 *   equal the task's current revision; when absent no proof is asked.
 *   `refusedFields` — fields this caller may not set (`DEDICATED_FIELDS` keys).
 */
export function writeTaskField(opts) {
  const { root, config, source } = opts;
  const id = String(opts.id || "");
  const field = String(opts.field || "");
  const actor = String(opts.actor || "");
  const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
  const refusedFields = opts.refusedFields || [];

  if (!isValidActor(actor)) {
    return refused("usage", 400, "actor must use a declared namespace",
      { details: ["Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")] });
  }
  if (refusedFields.indexOf(field) >= 0 && DEDICATED_FIELDS[field]) {
    return refused("dedicated", 400, "`" + field + "` has dedicated commands and is not set here",
      { details: ["use: " + DEDICATED_FIELDS[field].join(", ")] });
  }
  const fields = writableFields(config, refusedFields);
  const spec = fields.find((candidate) => candidate.key === field);
  if (!spec) {
    return refused("usage", 400, "This field is not editable: " + field,
      { details: ["editable: " + fields.map((f) => f.key).join(", ")] });
  }
  const normalized = normalizeValue(field, opts.value, { fields, options: fieldOptions(root, config) });
  if (!normalized.ok) {
    // A value outside the vocabulary is a kind of its own (TL-543): the fix is
    // one of `declared`, which a caller can offer instead of a usage message.
    if (normalized.unknown) {
      return refused("unknown-value", 400, normalized.error, {
        rejected: { field, value: normalized.unknown.value }, declared: normalized.unknown.declared,
      });
    }
    return refused("usage", 400, normalized.error);
  }
  // A reason that IS given has to be a sentence somebody wrote: the reserved
  // values are what the tool writes when nobody stated one.
  if (reason && !isValidReason(reason)) {
    const [head, ...rest] = reasonRefusal(reason, "reason").split("\n");
    return refused("usage", 400, head, { details: rest });
  }
  if (requiresReason(config, { field, to: normalized.value }) && !reason) {
    return refused("reason-required", 422, "This status requires a non-reserved reason", { needsReason: true });
  }

  const tasksDir = backlogPaths(root).tasksDir;
  const taskFile = fileForTaskId(tasksDir, id);
  if (!taskFile) return refused("not-found", 404, "Task not found: " + id);
  const full = join(tasksDir, taskFile);
  const original = readFileSync(full, "utf8");
  const revision = taskRevision(original);
  if ("revision" in opts && opts.revision !== revision) {
    return refused("conflict", 409, "The task changed after this page read it; refresh before editing", { revision });
  }

  const before = extractMeta(splitFrontmatter(original).frontmatter);
  let text = setFrontmatterField(original, field, normalized.value, spec);
  text = setFrontmatterField(text, "updated", todayStamp());
  const after = extractMeta(splitFrontmatter(text).frontmatter);

  atomicReplace(full, text);
  let entries;
  try {
    entries = recordEdit(root, { taskId: after.id || id, before, after, actor, source, reason });
  } catch (error) {
    atomicReplace(full, original);
    return refused("history", 500, "History could not be recorded; the task was restored: " + error.message);
  }
  return {
    ok: true, id, field, value: normalized.value, actor, entries,
    file: taskFile, revision: taskRevision(text),
  };
}
