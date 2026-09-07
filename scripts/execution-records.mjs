/** Replaceable local control-plane records for agent runs (TL-357). */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lockScope, stateRoot } from "./lock.mjs";

export const EXECUTION_RECORD_VERSION = 1;
function now() { return new Date().toISOString(); }
function id() { return randomBytes(12).toString("hex"); }
function directory(root, env = process.env) { return join(stateRoot(env), "executions", lockScope(root, { env }).key); }
function path(root, recordId, env) { return join(directory(root, env), recordId + ".json"); }

/** Atomic replacement makes interrupted updates unreadable, never plausible. */
export function writeExecutionRecord(root, record, env = process.env) {
  const dir = directory(root, env); mkdirSync(dir, { recursive: true });
  const target = path(root, record.id, env);
  const temporary = target + "." + process.pid + ".tmp";
  writeFileSync(temporary, JSON.stringify(record) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
  return target;
}

export function readExecutionRecord(root, recordId, env = process.env) {
  try {
    const record = JSON.parse(readFileSync(path(root, recordId, env), "utf8"));
    return record && record.version === EXECUTION_RECORD_VERSION && typeof record.id === "string" ? record : null;
  } catch { return null; }
}
export function listExecutionRecords(root, env = process.env) {
  try { return readdirSync(directory(root, env)).filter((f) => f.endsWith(".json")).map((f) => readExecutionRecord(root, f.slice(0, -5), env)).filter(Boolean); } catch { return []; }
}

export function startRunRecord({ root, actor, delegation, id: recordId = null, supervisor = null, env = process.env }) {
  const ts = now();
  const record = { version: EXECUTION_RECORD_VERSION, id: recordId || "run-" + id(), kind: "run", actor,
    delegation, phase: "starting", startedAt: ts, updatedAt: ts, attempts: [] };
  if (supervisor) record.supervisor = supervisor;
  writeExecutionRecord(root, record, env); return record;
}

export function updateRunRecord(root, record, patch, env = process.env) {
  Object.assign(record, patch, { updatedAt: now() }); writeExecutionRecord(root, record, env); return record;
}

export function startAttemptRecord({ root, run, task, attempt, env = process.env }) {
  const ts = now();
  const record = { version: EXECUTION_RECORD_VERSION, id: "attempt-" + id(), kind: "attempt", run: run.id,
    actor: run.actor, task: task.id, role: task.role || "", leg: task.leg || 1, attempt,
    profile: task.profile ? task.profile.name : null,
    requested: { model: task.profile ? task.profile.model || null : null, effort: task.profile ? task.profile.effort || null : null },
    delegation: { requested: task.delegation || "provider", enforcement: task.delegationEnforcement || "requested" },
    phase: "starting", startedAt: ts, updatedAt: ts };
  writeExecutionRecord(root, record, env);
  run.attempts.push(record.id); updateRunRecord(root, run, { phase: "running" }, env);
  return record;
}

export function updateAttemptRecord(root, record, patch, env = process.env) {
  Object.assign(record, patch, { updatedAt: now() }); writeExecutionRecord(root, record, env); return record;
}

export function removeExecutionRecord(root, recordId, env = process.env) {
  try { unlinkSync(path(root, recordId, env)); } catch { /* no record is a valid end state */ }
}
