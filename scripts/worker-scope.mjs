/** A short-lived local capability for a worker dispatched by `run` (TL-356). */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lockScope, stateRoot } from "./lock.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

const PREFIX = String(N).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const WORKER_SCOPE_ENV = PREFIX + "_WORKER_SCOPE";

function scopeDir(env) { return join(stateRoot(env), "worker-scopes"); }
function scopePath(id, env) { return join(scopeDir(env), id + ".json"); }
function token() { return randomBytes(24).toString("hex"); }

/** Create a capability that only the current child process tree can present. */
export function createWorkerScope({ root, taskId, actor, runId, env = process.env }) {
  const id = token();
  const secret = token();
  mkdirSync(scopeDir(env), { recursive: true });
  writeFileSync(scopePath(id, env), JSON.stringify({
    version: 1, id, secret, scope: lockScope(root, { env }).key,
    task: String(taskId), actor: String(actor), run: String(runId),
  }) + "\n", { encoding: "utf8", mode: 0o600 });
  return id + "." + secret;
}

export function releaseWorkerScope(value, env = process.env) {
  const id = String(value || "").split(".", 1)[0];
  if (/^[a-f0-9]{48}$/.test(id)) {
    try { unlinkSync(scopePath(id, env)); } catch { /* a killed worker is harmless */ }
  }
}

function readScope(value, env) {
  const [id, secret] = String(value || "").split(".");
  if (!/^[a-f0-9]{48}$/.test(id) || !/^[a-f0-9]{48}$/.test(secret) || !existsSync(scopePath(id, env))) return null;
  try {
    const record = JSON.parse(readFileSync(scopePath(id, env), "utf8"));
    const expected = Buffer.from(String(record.secret || ""));
    const actual = Buffer.from(secret);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return record;
  } catch { return null; }
}

const VALUE_FLAGS = new Set([
  "--dir", "--actor", "--role", "--reason", "--status", "--to-role", "--to-owner",
  "--question", "--option", "--recommend", "--resolves", "--choose", "--base",
]);
function taskId(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (!String(args[i]).startsWith("-")) return args[i];
  }
  return null;
}

const QUEUE_COMMANDS = new Set(["next", "take", "run", "new", "release", "history", "migrate-prefix", "renumber", "mcp", "regen-hook"]);
const ASSIGNED_TASK_COMMANDS = new Set(["done", "handoff", "ask", "decide"]);

/**
 * Refuse a queue operation from a dispatched worker before the child command
 * starts. Returns null when no worker scope is present, or a human-readable
 * refusal when the capability is invalid or insufficient.
 */
export function workerScopeRefusal(command, args, root, env = process.env) {
  const value = env[WORKER_SCOPE_ENV];
  if (!value) return null;
  const record = readScope(value, env);
  if (!record) return "worker scope is missing or invalid; an environment task id is not authority";
  if (record.scope !== lockScope(root, { env }).key) return "worker scope belongs to another local backlog";
  if (QUEUE_COMMANDS.has(command)) return "a dispatched worker cannot own the queue; only the outer `run` may use `" + command + "`";
  if (!ASSIGNED_TASK_COMMANDS.has(command)) return null;
  const id = taskId(args);
  if (String(id || "").toUpperCase() !== String(record.task).toUpperCase()) {
    return "worker scope permits only assigned task `" + record.task + "`";
  }
  return null;
}
