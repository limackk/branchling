/**
 * Asking a running `run` to finish the task it is on and then stop (TL-485).
 *
 * WHAT WAS MEASURED. The two choices were to kill the loop mid-task — the claim
 * stays `in_progress` and the hand's work stays uncommitted — or to let it drain
 * the queue. A watcher downstream froze the loop with SIGSTOP as it spawned
 * `next`, meaning to kill it once `next` returned; `next` runs under
 * `spawnSync`, so after exiting it stayed a zombie until the frozen parent
 * reaped it, the watcher waited on that pid forever, and the loop sat frozen for
 * fifty minutes holding a task `next` had already claimed.
 *
 * WHY A FILE AND NOT A SIGNAL. The process a person sees is the dispatcher in
 * `cli.mjs`, which runs the loop as a child under `spawnSync`: a signal sent to
 * the visible pid never reaches the loop, and the dispatcher cannot forward one
 * while it is blocked. Ctrl-C reaches the whole foreground group instead, which
 * includes a `done` in the middle of its contract. A request written where the
 * loop looks before every `next` needs no pid, works from any shell, and cannot
 * interrupt anything.
 *
 * WHY KEYED LIKE THE LOCK. The state directory and the key are the ones
 * `lock.mjs` uses — the shared git directory — so one request reaches every run
 * of one clone, from whichever worktree either was started in. That is the unit
 * a person means by "stop the loops here".
 *
 * WHY A TIMESTAMP AND NOT A FILE THAT IS CONSUMED. Several runs may share one
 * clone, and the first to delete a request would hide it from the others. A run
 * honours a request made after IT started; an older one does not stop a run
 * started later, and is simply overwritten by the next request.
 *
 * TWO LIFETIMES, ONE FILE (TL-697). A loop built on `next` alone — a workflow
 * whose supervisors call `next --plan` directly — has no start time for the
 * request to postdate: `next` is one-shot. For `next` the request therefore
 * holds from the moment it is written until somebody withdraws it with
 * `run --stop --clear`, which deletes the file. A run keeps its own rule: when
 * it spawns `next` it passes its start time in `STOP_SINCE_ENV`, and that
 * `next` honours only a request at least that recent — otherwise a request left
 * behind would make every later run refuse at its first `next`, which is the
 * behaviour the run's rule was written to avoid. An expiry was not added: a
 * stop that lapses on a clock nobody is watching restarts loops nobody asked to
 * restart, and an explicit withdrawal is the one act that cannot do that.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { lockScope, stateRoot } from "./lock.mjs";

/** Where the request for this backlog's clone is kept. */
export function stopRequestPath(backlogRoot, opts = {}) {
  const scope = opts.scope || lockScope(backlogRoot, opts);
  return { path: join(stateRoot(opts.env), "stops", scope.key + ".json"), origin: scope.origin };
}

/**
 * Write the request. A temporary file renamed into place, so a loop reading it
 * at the same moment sees the old request or the new one, never half of one.
 */
export function requestStop(backlogRoot, opts = {}) {
  const { path, origin } = stopRequestPath(backlogRoot, opts);
  const request = { requestedAt: new Date(opts.now || Date.now()).toISOString(), by: opts.actor || null, origin };
  mkdirSync(join(path, ".."), { recursive: true });
  const tmp = path + "." + process.pid + ".tmp";
  writeFileSync(tmp, JSON.stringify(request) + "\n", "utf8");
  renameSync(tmp, path);
  return { ...request, path };
}

/**
 * The environment variable through which `run` tells the `next` it spawns when
 * the run started, so that `next` applies the run's rule rather than its own
 * (see the header). Set on that one child only, never on the run's own
 * environment, so an agent the run starts does not inherit it.
 */
export const STOP_SINCE_ENV = "BACKLOG_STOP_SINCE";

/**
 * The request a run started at `sinceMs` must honour, or null. An unreadable
 * file is no request: a loop that stopped on garbage would be stopped by
 * anything that can write a byte there, and nothing here wrote it.
 */
export function stopRequestedSince(backlogRoot, sinceMs, opts = {}) {
  const request = readRequest(stopRequestPath(backlogRoot, opts).path);
  return request && Date.parse(request.requestedAt) >= sinceMs ? request : null;
}

/**
 * The request in force for a one-shot `next`, or null (TL-697): any readable
 * request that has not been withdrawn. With `opts.env[STOP_SINCE_ENV]` naming a
 * valid time — the `next` a run spawned — the run's rule applies instead.
 */
export function stopRequestInForce(backlogRoot, opts = {}) {
  const since = Date.parse((opts.env || process.env)[STOP_SINCE_ENV] || "");
  if (Number.isFinite(since)) return stopRequestedSince(backlogRoot, since, opts);
  return readRequest(stopRequestPath(backlogRoot, opts).path);
}

/**
 * Withdraw the request (TL-697): the file is deleted, so neither `next` nor a
 * run honours it any longer. Returns what was withdrawn — `request` is null
 * when there was nothing to withdraw, which is an answer, not an error.
 */
export function clearStop(backlogRoot, opts = {}) {
  const { path, origin } = stopRequestPath(backlogRoot, opts);
  const request = readRequest(path);
  rmSync(path, { force: true });
  return { request, path, origin };
}

function readRequest(path) {
  let request;
  try {
    request = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  return request && Number.isFinite(Date.parse(request.requestedAt)) ? request : null;
}
