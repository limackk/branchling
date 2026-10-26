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
 * honours a request made after IT started; an older one is left behind, harmless,
 * and is simply overwritten by the next request.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
 * The request a run started at `sinceMs` must honour, or null. An unreadable
 * file is no request: a loop that stopped on garbage would be stopped by
 * anything that can write a byte there, and nothing here wrote it.
 */
export function stopRequestedSince(backlogRoot, sinceMs, opts = {}) {
  const { path } = stopRequestPath(backlogRoot, opts);
  let request;
  try {
    request = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const at = Date.parse(request && request.requestedAt);
  return Number.isFinite(at) && at >= sinceMs ? request : null;
}
