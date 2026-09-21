#!/usr/bin/env node
/**
 * Which viewer servers are running on this machine (TL-266).
 *
 * WHAT WAS WRONG. `serve` is the one command that does not return, and nothing
 * recorded that it had started. Measured on 2026-09-04: six servers listening,
 * three of them with `ppid=1` — their shell was gone and the kernel had
 * reparented them — and three started from worktrees that no longer existed.
 * Measured again while this was written: one had been listening for two days
 * and three hours from the main checkout of this clone. Every one of them is a
 * WRITER: `serve` reconciles the tree on a timer and appends to
 * `backlog/history/` as `unknown`. A writer nobody can name is the one thing
 * the evidence layer cannot absorb, and the only way to find these was `lsof`.
 *
 * WHAT THIS IS NOT. Not a supervisor, and not a daemon manager — law 4 rules
 * that out. It is a register with the same shape and the same reason as the
 * lock directory next to it: a file created when a process starts, removed when
 * it exits, and treated as STALE on read when the process behind it is gone.
 *
 * WHERE IT LIVES, AND WHY NOT IN THE BACKLOG. `stateRoot()` — the same
 * per-user state directory as `locks/` and `mutex/`. A register written into
 * `backlog/` would be a different file in every worktree, so it would answer
 * "nothing is running" in the tree that most needs to be told otherwise
 * (TL-87, same argument).
 *
 * WHY THE FILES ARE FLAT AND KEYED BY PORT, not keyed by repository like the
 * locks. The question a person asks here is "what is holding 4321", and a port
 * is unique per machine while a repository is not unique per server — a clone
 * with four worktrees had three. Each entry still RECORDS the repository
 * (`lockScope().origin`, git's common directory, or the backlog path when there
 * is no git), so a caller can still ask the question the locks ask.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE LIFETIME GUARANTEE, STATED EXACTLY — because an overstated one is worse
 * than none:
 *
 *   GUARANTEED. A server that exits normally, or is asked to stop with SIGINT,
 *   SIGTERM or SIGHUP, removes its own entry before it goes.
 *
 *   NOT GUARANTEED. SIGKILL runs no handler, and neither does a power cut or a
 *   `kill -9` from a frustrated user. The parent dying does not take the child
 *   with it either — that is precisely how the six orphans happened. In both
 *   cases the entry OUTLIVES the process, and the tool does not pretend
 *   otherwise: `listServers()` reports that entry as `stale`, and the next
 *   `serve` reclaims it.
 *
 * So the promise is not "the old server always exits". It is "what is running
 * can be named, and what is no longer running is never reported as running".
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHY A PID IS NOT ENOUGH TO STOP SOMETHING. Pids are recycled. An entry whose
 * pid now belongs to somebody else's program would make `--stop` a way to kill
 * an innocent process with the tool's own hand, which is the worst outcome
 * available here. `identify()` therefore asks the PORT who it is — the same
 * `/api/ping` handshake `serve` already uses to decide whether to start beside
 * an existing instance — and a stop happens only when the answer names this
 * product AND the pid the register recorded.
 *
 * Tests: `node --test scripts/tests/serve-lifetime.test.mjs`
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

import { lockScope, stateRoot } from "./lock.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";

/**
 * The handshake token on `/api/ping`. Derived from the product name rather than
 * written out: it is computed at runtime and persisted nowhere, so a rename
 * costs nothing. (Contrast `BLOCK_MARKER_NAME`, which keys blocks already
 * written into other people's repositories and is frozen for that reason.)
 */
export const PING_ID = `${N}-backlog-viewer`;

/** The directory holding one entry per running server. */
export function serversDir(env = process.env) {
  return join(stateRoot(env), "servers");
}

const entryPath = (port, env) => join(serversDir(env), String(port) + ".json");

/**
 * Write this process's entry. Called AFTER the socket is bound, because the
 * port is what the entry is named by and is not known before.
 *
 * Failure is swallowed on purpose: a register that cannot be written is a
 * viewer that cannot be listed, not a viewer that must not run. Taking the
 * server down over its own bookkeeping would be a worse defect than the one
 * this file exists for.
 *
 * @returns {string|null} the path written, or null if it could not be
 */
export function registerServer({ port, backlogDir, projectName, pid, env = process.env, now = Date.now() }) {
  try {
    mkdirSync(serversDir(env), { recursive: true });
    // A new server reclaims what the dead ones left: this is the "detect and
    // reclaim" half of the guarantee above, and the only moment at which a file
    // whose process was SIGKILLed can be removed by anybody.
    pruneStale({ env });
    const record = {
      port,
      pid: pid === undefined ? process.pid : pid,
      host: hostname(),
      tree: resolve(backlogDir),
      repository: lockScope(backlogDir).origin,
      projectName: projectName || null,
      startedAt: new Date(now).toISOString(),
    };
    const path = entryPath(port, env);
    writeFileSync(path, JSON.stringify(record) + "\n", "utf8");
    return path;
  } catch {
    return null;
  }
}

/** Remove this process's entry. Best effort, for the same reason as above. */
export function unregisterServer(port, { env = process.env, pid } = {}) {
  try {
    const held = readEntry(port, env);
    // Somebody else's entry is not ours to drop: after a port is freed and
    // taken by a second server, the first one exiting must not erase the
    // second's record. The same rule as `releaseLock`.
    if (held && pid !== undefined && held.pid !== pid) return false;
    unlinkSync(entryPath(port, env));
    return true;
  } catch {
    return false;
  }
}

function readEntry(port, env) {
  try {
    const rec = JSON.parse(readFileSync(entryPath(port, env), "utf8"));
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    // Unreadable names nobody, exactly as in `readLock`. An entry we cannot
    // parse is reported as stale by `listServers`, not respected as a holder.
    return null;
  }
}

/**
 * Is this pid still a process?
 *
 * `EPERM` means it exists and is not ours to signal, which is still ALIVE —
 * answering "gone" there would report a running server as stale and invite a
 * second one onto the same tree.
 *
 * WHAT IT CANNOT SEE, stated because `--stop` was written wrong once on the
 * strength of it: a ZOMBIE — a process that has exited and whose parent has not
 * reaped it — still accepts signal 0, so for that window an entry reads
 * `running` although nothing is being served. That is why `stopServer` decides
 * at the PORT and not here: a corpse cannot answer `/api/ping`.
 */
export function pidAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/**
 * Every registered server, with the state each one is actually in.
 *
 *   running    the pid is alive on this host
 *   stale      the entry is there and the process is not — a SIGKILL, a crash
 *              or a reboot; the next `serve` removes it
 *   elsewhere  the entry was written by another host (a shared state directory
 *              over a network mount). NOT JUDGED: a pid from another machine
 *              means nothing here, and guessing would be the untruth this
 *              register exists to remove.
 *
 * A pure read — nothing is deleted, so two calls answer the same thing.
 */
export function listServers({ env = process.env, host = hostname(), alive = pidAlive } = {}) {
  const dir = serversDir(env);
  let names = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const port = Number(name.slice(0, -".json".length));
    const rec = readEntry(port, env);
    if (!rec) {
      out.push({ port, state: "stale", unreadable: true });
      continue;
    }
    const state = rec.host !== host ? "elsewhere" : alive(rec.pid) ? "running" : "stale";
    out.push({ ...rec, state });
  }
  return out.sort((a, b) => a.port - b.port);
}

/** Drop the entries of processes that are provably gone. @returns {number} */
export function pruneStale({ env = process.env, host = hostname(), alive = pidAlive } = {}) {
  let removed = 0;
  for (const entry of listServers({ env, host, alive })) {
    if (entry.state !== "stale") continue;
    try { unlinkSync(entryPath(entry.port, env)); removed++; } catch { /* already gone */ }
  }
  return removed;
}

/**
 * Ask a port who is listening on it.
 *
 * @returns {Promise<{app: string|null, pid: number|null, backlogDir: string|null,
 *                    projectName: string|null}|null>} null when nothing
 *          answered, or answered something that is not ours.
 */
export function identify(port, { timeoutMs = 700 } = {}) {
  return new Promise((resolveP) => {
    const req = get({ host: "127.0.0.1", port, path: "/api/ping", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      res.on("end", () => {
        let ping = null;
        try { ping = JSON.parse(body); } catch { /* not our JSON */ }
        if (!ping || ping.app !== PING_ID) { resolveP(null); return; }
        resolveP({
          app: ping.app,
          pid: Number(ping.pid) || null,
          backlogDir: ping.backlogDir || null,
          projectName: ping.projectName || null,
        });
      });
    });
    req.on("timeout", () => { req.destroy(); resolveP(null); });
    req.on("error", () => resolveP(null));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Stop the server registered on `port`, and say honestly what happened.
 *
 * THE OUTCOMES, each of which a caller has to be able to tell apart:
 *
 *   not-registered  nothing was ever recorded for that port
 *   already-gone    the entry was there, the process is not — the entry is
 *                   removed and NOTHING is signalled
 *   not-ours        something IS listening and it is not one of our servers, or
 *                   it is one whose pid does not match the entry. Nothing is
 *                   signalled: a recycled pid is how a tool kills a stranger's
 *                   process, and no convenience is worth that.
 *   elsewhere       the entry belongs to another host; it can be reported and
 *                   not acted on
 *   stopped         it exited after SIGTERM, or after the SIGKILL that follows
 *                   `graceMs` — `forced` says which, because "it stopped" and
 *                   "it was killed" are not the same claim
 *   would-not-stop  it survived both, which is possible (an uninterruptible
 *                   wait) and is reported rather than glossed over
 */
export async function stopServer(port, { env = process.env, host = hostname(), alive = pidAlive,
  kill = process.kill.bind(process), graceMs = 5000, probe = identify } = {}) {
  const entry = listServers({ env, host, alive }).find((e) => e.port === Number(port));
  if (!entry) return { port: Number(port), outcome: "not-registered" };
  if (entry.state === "elsewhere") return { ...entry, outcome: "elsewhere" };
  if (entry.state === "stale") {
    unregisterServer(entry.port, { env });
    return { ...entry, outcome: "already-gone" };
  }

  const ping = await probe(entry.port);
  if (!ping || (ping.pid && entry.pid && ping.pid !== entry.pid)) {
    return { ...entry, outcome: "not-ours", answered: ping };
  }

  // STOPPED IS MEASURED AT THE PORT, NOT AT THE PID. `kill(pid, 0)` succeeds
  // for a ZOMBIE — a process that has exited and whose parent has not reaped it
  // yet — so a pid check alone reports a server that is demonstrably gone as
  // still running, and `--stop` then escalates to SIGKILL against a corpse.
  // What the caller asked about is whether the socket is still being served, so
  // that is what is asked. The pid is the second half: gone at the port AND
  // gone as a process is the only combination that ends the wait early.
  const stillServing = async () => (await probe(entry.port)) !== null;

  try { kill(entry.pid, "SIGTERM"); } catch { /* it went in the meantime */ }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && (await stillServing())) await wait(50);

  let forced = false;
  if (await stillServing()) {
    forced = true;
    try { kill(entry.pid, "SIGKILL"); } catch { /* it went in the meantime */ }
    const hard = Date.now() + 2000;
    while (Date.now() < hard && (await stillServing())) await wait(50);
  }

  if (await stillServing()) return { ...entry, outcome: "would-not-stop", forced };
  // After a SIGKILL nothing in that process ran, so the entry is ours to
  // remove — which is the same reclaim `serve` does on the next start.
  if (existsSync(entryPath(entry.port, env))) unregisterServer(entry.port, { env });
  return { ...entry, outcome: "stopped", forced };
}
