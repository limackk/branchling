/**
 * The machine's one mutation slot, and the concurrency a run takes by default
 * (TL-681).
 *
 * WHY A SLOT. On 2026-11-08 and 2026-11-09 the kernel OOM killer took down the
 * session running parallel loops, once together with the user's systemd
 * manager, D-Bus and PipeWire: 411 to 459 node processes, about 25 GB. A
 * mutation run is the largest consumer a loop starts — every Stryker worker
 * runs the selected suite, and every test file in it spawns processes of its
 * own — so two of them at once is where a machine shared by several loops runs
 * out. The loops held each other off with `flock` around `npm run mutation`,
 * which protects only the runs started through that exact wrapper.
 *
 * WHY THE KEY IS THE MACHINE, NOT THE REPOSITORY. The task locks in lock.mjs
 * are keyed by `git rev-parse --git-common-dir`, because what they exclude is
 * two sessions taking one task. What this excludes is two runs sharing one
 * pool of memory, and two clones of two different repositories share it just
 * as much. The slot is therefore ONE file in the state directory (`stateRoot`,
 * `BACKLOG_STATE_DIR` / XDG), created by lock.mjs's `createExclusively`: the
 * name appears only with its content complete, and `link` fails rather than
 * overwrite, so two runs can never both win it.
 *
 * A HOLDER WHOSE PROCESS IS GONE HOLDS NOTHING. A run killed by a signal, or by
 * the OOM killer this exists to avoid, cannot remove its file. A holder on this
 * host whose pid no longer answers is reclaimed, through `removeIfUnchanged`,
 * so two runs that both judged it dead cannot both remove a fresh holder. There
 * is no TTL: a mutation run legitimately lasts hours, and a living run's slot
 * taken over by age would be the very collision the slot prevents. A holder on
 * another host (a state directory on a shared home) cannot be signalled and is
 * treated as alive; its path is in the message, for the person who knows it is
 * not.
 *
 * A RUN STARTED BY THE HOLDER IS NOT A SECOND RUN. Some tests start a real
 * mutation run of their own, and a mutation run executes those tests: the
 * inner run would wait for a slot its own outer run holds until both time out.
 * The holder hands its token to Stryker as `SLOT_TOKEN_ENV`; a run that finds
 * that token in the slot runs inside the holder's slot instead of waiting.
 *
 * WHY THE DEFAULT CONCURRENCY FOLLOWS FREE MEMORY. Half the cores (the earlier
 * default) is 16 workers on a 32-core machine, whatever else that machine is
 * running. A worker's footprint is the test files `node --test` runs at once,
 * each with the CLI processes it spawns; see `PER_TEST_FILE_BYTES`. How many
 * that is, is bounded by `testFileConcurrency()` (TL-706), so a worker's
 * footprint no longer grows with the machine's core count.
 *
 * Tests: scripts/tests/mutation-run.test.mjs.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import os, { hostname } from "node:os";
import { join } from "node:path";

import { createExclusively, pidAlive, readHolder, removeIfUnchanged, stateRoot } from "./lock.mjs";

/** The variable through which a holder tells the runs it starts that the slot is theirs too. */
export const SLOT_TOKEN_ENV = "MUTATION_SLOT_TOKEN";

/** How often a waiting run looks at the slot again. */
export const SLOT_POLL_MS = 2000;

/**
 * The peak resident memory one test file adds while `node --test` runs it:
 * its own process and the CLI processes it spawns. Measured on 2026-11-11 on
 * a 32-core machine, sampling the whole process tree every 100 ms: 40 test
 * files at node's default concurrency (31 at once) peaked at 4852 MB, about
 * 156 MB per file; 8 files at 8 at once peaked at 1427 MB, about 178 MB; the
 * same 40 files at 4 at once peaked at 1392 MB, about 348 MB per file.
 *
 * The figure per file is not constant: the fewer files run at once, the more
 * the peak is set by the heaviest few of them running together. A worker now
 * runs `WORKER_TEST_FILES` at once (TL-706), so the largest figure is taken,
 * rounded up. Where node runs its own default instead — a node without
 * `--test-concurrency`, which the pinned Stryker does not run on either: its
 * version 10 declares Node 22 or later — this overestimates, which errs
 * toward fewer workers, never toward the OOM killer.
 */
export const PER_TEST_FILE_BYTES = 360 * 1024 * 1024;

/**
 * How many test files one worker's `node --test` runs at once, at most
 * (TL-706). Node's own default is cores - 1: 31 files, and 4852 MB, for ONE
 * worker on a 32-core machine, where 4 at once peaked at 1392 MB. Four is the
 * figure the parallel loops ran inside memory with, and it is fixed rather
 * than derived from cores / workers, because what it bounds is one worker's
 * memory, which the core count says nothing about.
 */
export const WORKER_TEST_FILES = 4;

/**
 * The `--test-concurrency` a worker passes to `node --test`, or null where
 * the running node does not accept the flag (it exists from Node 20.10 and
 * 21; package.json allows 18). Never above node's own default of cores - 1,
 * so a small machine is not asked to run more at once than it would anyway.
 *
 * @param {{version?: string, cores?: number}} [opts]
 * @returns {number|null}
 */
export function testFileConcurrency({ version = process.versions.node, cores = cpuCount() } = {}) {
  const [major, minor] = String(version).split(".").map(Number);
  if (!(major > 20 || (major === 20 && minor >= 10))) return null;
  return Math.max(1, Math.min(WORKER_TEST_FILES, cores - 1));
}

/** The test runner itself, before any file starts. */
export const PER_WORKER_BASE_BYTES = 64 * 1024 * 1024;

/**
 * The share of free memory a run may plan to use. The rest is for what the
 * machine is already doing: the other loops' suites, the session that started
 * this run, the desktop. Free memory is read once, at the start, and the
 * suites beside this run grow after it.
 */
export const FREE_MEMORY_SHARE = 0.75;

export function slotPath(env = process.env) {
  return join(stateRoot(env), "mutation", "slot.lock");
}

function cpuCount() {
  // availableParallelism is Node 18.14+; the default suite also runs on 18.0.
  return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}

function gb(bytes) {
  return (bytes / 1024 ** 3).toFixed(1) + " GB";
}

/**
 * The concurrency a run uses, and the sentence that says why.
 *
 * Each worker is budgeted as `node --test` running `min(testFiles,
 * fileConcurrency)` files at once — the bound a worker passes as
 * `--test-concurrency` — at `PER_TEST_FILE_BYTES` each. Where the running node
 * has no such flag (`fileConcurrency` null), node's own default of cores - 1
 * is budgeted instead, and the reason says so. The result is never above half
 * the cores (see `strykerConfig` in mutation-run.mjs for why) and never below
 * one.
 *
 * @param {{concurrency?: number|null, testFiles: number, freeBytes?: number, cores?: number,
 *          fileConcurrency?: number|null}} opts
 * @returns {{value: number, reason: string}}
 */
export function chooseConcurrency({ concurrency = null, testFiles, freeBytes = os.freemem(), cores = cpuCount(),
  fileConcurrency = testFileConcurrency({ cores }) }) {
  if (concurrency) return { value: concurrency, reason: "given by --concurrency" };
  const cap = Math.max(1, Math.floor(cores / 2));
  const atOnce = Math.max(1, Math.min(testFiles, fileConcurrency || cores - 1));
  const perWorker = PER_WORKER_BASE_BYTES + atOnce * PER_TEST_FILE_BYTES;
  const byMemory = Math.floor((freeBytes * FREE_MEMORY_SHARE) / perWorker);
  const why = fileConcurrency ? "--test-concurrency=" + fileConcurrency
    : "node's default of cores - 1: this node has no --test-concurrency";
  const budget = gb(freeBytes) + " free, " + Math.round(FREE_MEMORY_SHARE * 100) + "% of it at " + gb(perWorker)
    + " per worker (" + atOnce + " test " + (atOnce === 1 ? "file" : "files") + " at once, " + why + ")";
  if (byMemory >= cap) return { value: cap, reason: "half of " + cores + " cores; " + budget + " would allow " + byMemory };
  if (byMemory < 1) return { value: 1, reason: budget + " allows none; one worker is the least a run can use" };
  return { value: byMemory, reason: budget + ", below the cap of " + cap + " (half of " + cores + " cores)" };
}

/** A sentence naming the holder, for a person deciding whether to wait. */
export function describeHolder(holder, path) {
  if (!holder) return "an unreadable record at " + path;
  return "pid " + holder.pid + " on " + holder.host + " since " + holder.ts + ", run from " + holder.tree
    + " (" + path + ")";
}

/**
 * One attempt at the slot. Never waits.
 *
 * @returns {{ok: true, path: string, token: string, nested?: boolean, tookOver?: object|null}
 *          |{ok: false, path: string, holder: object|null}}
 */
export function tryAcquireSlot({ env = process.env, tree, alive = pidAlive, host = hostname(), interleave = () => {} } = {}) {
  const path = slotPath(env);
  mkdirSync(join(path, ".."), { recursive: true });
  const record = { pid: process.pid, host, tree: String(tree || process.cwd()), ts: new Date().toISOString(),
    token: randomBytes(16).toString("hex") };
  let tookOver;
  // Three passes: one may be spent on a holder that released meanwhile, one on
  // removing a dead holder, and the last decides.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (createExclusively(path, JSON.stringify(record) + "\n")) {
      return { ok: true, path, token: record.token, ...(tookOver !== undefined ? { tookOver } : {}) };
    }
    // A test seam, as in lock.mjs: the two points where another run can
    // change the file under this one.
    interleave("contended");
    const seen = readHolder(path);
    if (!seen) continue;
    const held = seen.record;
    if (held && env[SLOT_TOKEN_ENV] && held.token === env[SLOT_TOKEN_ENV]) {
      return { ok: true, path, token: held.token, nested: true };
    }
    // A record that names nobody cannot be waited for, and a holder on this
    // host whose process is gone will never release.
    const dead = !held || (held.host === host && !alive(held.pid));
    if (!dead) return { ok: false, path, holder: held };
    removeIfUnchanged(path, seen);
    tookOver = held;
    interleave("removed");
  }
  const seen = readHolder(path);
  return { ok: false, path, holder: seen && seen.record };
}

/**
 * The slot, waiting for it unless `wait` is false. `onWait(holder, path)` is
 * called once, when the first attempt finds it held.
 */
export async function acquireSlot({ wait = true, pollMs = SLOT_POLL_MS, onWait = () => {}, ...opts } = {}) {
  let r = tryAcquireSlot(opts);
  if (r.ok || !wait) return r;
  onWait(r.holder, r.path);
  while (!r.ok) {
    await new Promise((done) => setTimeout(done, pollMs));
    r = tryAcquireSlot(opts);
  }
  return r;
}

/**
 * Give the slot back, if it is still this run's. A run inside its holder's slot
 * gives nothing back: the slot is the holder's.
 */
export function releaseSlot(slot) {
  if (!slot || !slot.ok || slot.nested) return false;
  try {
    const held = JSON.parse(readFileSync(slot.path, "utf8"));
    if (!held || held.token !== slot.token) return false;
    unlinkSync(slot.path);
    return true;
  } catch {
    return false;
  }
}
