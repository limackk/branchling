#!/usr/bin/env node
/**
 * Reserving a task for one session — the local lock (TL-87).
 *
 * WHY A LOCKFILE AND NOT AN EVENT IN THE HISTORY. A lock written as an event is
 * settled by last-writer-wins, which decides AFTER the fact — and a decision
 * after the fact is not mutual exclusion, it is a report of a collision
 * (docs/branchling-state-and-sync.md §6.1 — product-name: allow, a real path).
 * Exclusion needs a single writer, and on one machine the filesystem is one: a
 * name either gets created or it does not, and no two processes can both win.
 * See `createExclusively` for why creating the name and writing what is behind it
 * have to be the SAME step.
 *
 * WHY THE LOCK LIVES OUTSIDE THE REPOSITORY. The case this exists for is N agent
 * sessions in N worktrees of the SAME repository. Each worktree is a separate
 * checkout with its own `backlog/tasks/…`, so a lock kept inside the backlog
 * would be a different file in each of them and would exclude nobody. The locks
 * therefore live in a per-user state directory, keyed by the repository the
 * backlog belongs to — `git rev-parse --git-common-dir`, which is the SAME path
 * from every linked worktree, and the backlog's own path when there is no git.
 *
 * WHAT IT DELIBERATELY DOES NOT PROMISE. One machine, one user account. Two
 * machines sharing a repository only through git can still both take the same
 * task and will find out at merge time; that boundary is the paid one, and
 * pretending otherwise here would be the same species of untruth `done` exists
 * to catch. A second user account on the same machine has its own state
 * directory and is outside the guarantee too — say so rather than imply it.
 *
 * WHY A TTL AT ALL. A session that is killed leaves its lockfile behind, and a
 * reservation nobody can release is a task that leaves the queue for good. After
 * `lock_ttl_minutes` (from `config.yaml` — the code knows the shape, the project
 * knows the value) the lock is stale and may be taken over, loudly.
 *
 * Tests: `node --test scripts/tests/next.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";

import { BLOCK_MARKER_NAME } from "./product.mjs";

/** The directory name under the user's state directory.
 *
 *  WHY THE FROZEN MARKER AND NOT `PRODUCT_NAME`. This is a path on disk that two
 *  processes have to agree on, exactly like the block marker in somebody's
 *  `.gitignore`. Derived from the display name, a rename would put a running
 *  session and a freshly installed one in DIFFERENT directories — which is to
 *  say it would silently switch mutual exclusion off, the one thing this file
 *  exists to provide. */
const STATE_DIRNAME = BLOCK_MARKER_NAME;

/** The environment variable that moves the whole state directory. Named after
 *  the DATA (`BACKLOG_DIR` is the existing convention), not after the product,
 *  for the same reason as above. */
export const STATE_DIR_ENV = "BACKLOG_STATE_DIR";

export const DEFAULT_LOCK_TTL_MINUTES = 120;

/**
 * Where locks are kept. PURE with respect to the disk — it computes a path.
 *
 * The order of the sources mirrors `resolveBacklogDir`: explicit first.
 */
export function stateRoot(env = process.env) {
  if (env[STATE_DIR_ENV]) return resolve(env[STATE_DIR_ENV]);
  if (env.XDG_STATE_HOME) return join(resolve(env.XDG_STATE_HOME), STATE_DIRNAME);
  return join(homedir(), ".local", "state", STATE_DIRNAME);
}

/**
 * What identifies "the same backlog" across worktrees.
 *
 * @returns {{origin: string, key: string}} `origin` is the path a person can
 *          read when they wonder whose lock this is; `key` is its hash, because
 *          a path is not a legal directory name.
 */
export function lockScope(backlogRoot, opts = {}) {
  const run = opts.run || spawnSync;
  const root = resolve(backlogRoot);
  let origin = root;
  const r = run("git", ["-C", root, "rev-parse", "--git-common-dir"], { encoding: "utf8" });
  if (r && r.status === 0 && String(r.stdout).trim()) {
    // `--git-common-dir` answers with the MAIN repository's `.git` even when it
    // is called from a linked worktree — that is precisely why it is the key.
    // It may come back relative to the directory it was run in.
    origin = resolve(root, String(r.stdout).trim());
  }
  try {
    origin = realpathSync(origin);
  } catch {
    // A path that cannot be resolved is still a usable key; it just cannot be
    // canonicalised. Failing here would mean no locking at all, which is worse.
  }
  return { origin, key: createHash("sha256").update(origin).digest("hex").slice(0, 16) };
}

/** The directory holding one backlog's locks, and the file naming its origin. */
export function lockDir(backlogRoot, opts = {}) {
  const scope = opts.scope || lockScope(backlogRoot, opts);
  return { dir: join(stateRoot(opts.env), "locks", scope.key), origin: scope.origin };
}

function lockPath(dir, taskId) {
  return join(dir, taskId + ".lock");
}

/**
 * Create the file with its content already in it, or report that somebody got
 * there first. `false` means EEXIST and nothing else — every other failure
 * throws.
 *
 * WHY IT IS NOT `open(path, "wx")` FOLLOWED BY A WRITE (measured, TL-87). That
 * pair leaves the file existing and EMPTY for as long as it takes to write it,
 * and a second process reaching it in that window reads no record, concludes the
 * lock is corrupt — that is, that there is nothing to respect — and takes it
 * over. Six parallel `next` calls handed the same task to two sessions. Writing
 * a temporary file first and LINKING it into place closes the window: the name
 * appears only when the content behind it is complete, and `link` fails rather
 * than overwrite.
 */
function createExclusively(path, content) {
  const tmp = path + "." + process.pid + "." + randomBytes(4).toString("hex") + ".tmp";
  writeFileSync(tmp, content, "utf8");
  try {
    linkSync(tmp, path);
    return true;
  } catch (e) {
    if (e.code === "EEXIST") return false;
    // A filesystem without hard links (some network and container mounts). The
    // window above comes back, and that is worth saying rather than failing
    // outright — `wx` still excludes two CREATIONS, which is most of the value.
    if (e.code === "EPERM" || e.code === "ENOSYS" || e.code === "EXDEV" || e.code === "EOPNOTSUPP") {
      try {
        const fd = openSync(path, "wx");
        try {
          writeFileSync(fd, content, "utf8");
        } finally {
          closeSync(fd);
        }
        return true;
      } catch (inner) {
        if (inner.code === "EEXIST") return false;
        throw inner;
      }
    }
    throw e;
  } finally {
    try { unlinkSync(tmp); } catch { /* the link took it, or it was never created */ }
  }
}

function ensureDir(dir, origin) {
  mkdirSync(dir, { recursive: true });
  // A directory named by a hash tells a person nothing. One file next to the
  // locks says which tree they belong to — for the moment somebody finds this
  // directory and has to decide whether it is safe to delete.
  const marker = join(dir, "origin");
  if (!existsSync(marker)) writeFileSync(marker, origin + "\n", "utf8");
}

/** @returns {object|null} the lock record, or null when the file is absent or
 *  unreadable. A corrupt lock is treated as no lock: it can name no holder, so
 *  refusing on its account would block the queue on a byte nobody can read. */
export function readLock(dir, taskId) {
  try {
    const raw = readFileSync(lockPath(dir, taskId), "utf8");
    const rec = JSON.parse(raw);
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    return null;
  }
}

/** Has this lock outlived its TTL? A record with no readable timestamp counts as
 *  expired — see `readLock`. */
export function isExpired(lock, ttlMinutes, now = Date.now()) {
  if (!lock) return true;
  const ts = Date.parse(lock.ts || "");
  if (!Number.isFinite(ts)) return true;
  return now - ts > Math.max(0, Number(ttlMinutes)) * 60_000;
}

/**
 * Take the lock, or say who is holding it.
 *
 * @param {{root: string, taskId: string, actor: string, ttlMinutes?: number,
 *          now?: number, env?: object, scope?: object}} opts
 * @returns {{ok: boolean, lock?: object, holder?: object, tookOver?: object,
 *            path: string}}
 */
export function acquireLock(opts) {
  const ttl = opts.ttlMinutes === undefined ? DEFAULT_LOCK_TTL_MINUTES : opts.ttlMinutes;
  const now = opts.now || Date.now();
  const { dir, origin } = lockDir(opts.root, opts);
  ensureDir(dir, origin);
  const path = lockPath(dir, opts.taskId);

  const record = {
    task: opts.taskId,
    actor: opts.actor,
    pid: process.pid,
    host: hostname(),
    tree: resolve(opts.root),
    ts: new Date(now).toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    if (createExclusively(path, JSON.stringify(record) + "\n")) {
      return { ok: true, lock: record, path };
    }

    const held = readLock(dir, opts.taskId);
    // The same session asking again is not a collision: `take` on a task you are
    // already holding has to be idempotent, otherwise a retried command refuses
    // on the strength of its own first run.
    if (held && held.actor === opts.actor && held.pid === process.pid && held.tree === record.tree) {
      return { ok: true, lock: held, path, alreadyMine: true };
    }
    if (!isExpired(held, ttl, now)) return { ok: false, holder: held, path };

    // Stale. Remove it and try ONCE more — the `wx` create below is what decides
    // between two processes that both saw the same stale lock; whoever loses the
    // race reads the winner's fresh record on the next pass and steps aside.
    try {
      unlinkSync(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    record.tookOver = held || null;
  }

  return { ok: false, holder: readLock(dir, opts.taskId), path };
}

/**
 * Give the lock back. Best effort by design: a release that throws would turn
 * "the work is finished" into an error, and the TTL already covers the case of a
 * lock nobody removed.
 *
 * @returns {boolean} whether a lock was actually removed
 */
export function releaseLock(opts) {
  try {
    const { dir } = lockDir(opts.root, opts);
    const path = lockPath(dir, opts.taskId);
    const held = readLock(dir, opts.taskId);
    // Somebody else's lock is not ours to drop: after a take-over the previous
    // session finishing its work would otherwise release the new holder's claim.
    if (held && opts.actor && held.actor !== opts.actor) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Every lock held for this backlog — for a status readout and for tests. */
export function listLocks(root, opts = {}) {
  const { dir } = lockDir(root, opts);
  let names = [];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith(".lock"));
  } catch {
    return [];
  }
  return names
    .map((f) => readLock(dir, f.slice(0, -".lock".length)))
    .filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────────────
// Mutual exclusion around a read-modify-write (TL-214)
// ──────────────────────────────────────────────────────────────────────────
//
// WHY THIS LIVES BESIDE THE TASK LOCK AND NOT IN THE MODULE THAT NEEDS IT. It
// is the same problem with the same answer — on one machine the filesystem is
// the single writer, and `createExclusively` above is already the primitive
// that settles who won. What differs is the scale: a task lock is held for a
// whole session and names a task, this one is held for the milliseconds of a
// file's read-modify-write and names the file.
//
// WHAT IT IS FOR. `history/.snapshot.json` is ONE file per backlog that every
// writing route loads, mutates and writes back. Two writers that overlap both
// compute their new snapshot from the same starting point, and whichever
// renames last erases the other's advance — after which the log describes
// transitions nobody made, or misses a change altogether. Measured on
// 2026-09-03 and reproduced by `scripts/tests/concurrent-attribution.test.mjs`.

/** After this, a mutex file describes a process that died inside the section
 *  rather than one still working in it. The section is a read-modify-write of
 *  one file; anything on this scale is a corpse. */
export const MUTEX_STALE_MS = 30_000;

/** How long a writer waits for its turn before giving up. Giving up is LOUD:
 *  the change stays in the file, so the next reconcile still sees it and
 *  records it, whereas proceeding unlocked is the one outcome that loses it. */
export const MUTEX_WAIT_MS = 10_000;

/** Sections this process is already inside. Reconcile and `recordEdit` are both
 *  synchronous, so nothing interleaves within one process — but a caller that
 *  nests them would otherwise wait for a lock it holds itself. */
const INSIDE = new Set();

/** Block without a timer: the callers are synchronous top to bottom, and an
 *  `await` in the middle of a critical section would be a different design. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readRecord(path) {
  try {
    const rec = JSON.parse(readFileSync(path, "utf8"));
    return rec && typeof rec === "object" ? rec : null;
  } catch {
    // Unreadable names no holder, exactly as in `readLock`: respecting a byte
    // nobody can read would block every writer for as long as it sits there.
    return null;
  }
}

/**
 * Run `fn` with no other process on this machine inside the section `name`.
 *
 * @param {string} name  identifies the RESOURCE, not the caller — every writer
 *        of one file has to compute the same string for any of this to hold.
 * @param {Function} fn
 * @param {{env?: object, waitMs?: number, staleMs?: number, now?: () => number}} opts
 * @returns whatever `fn` returns
 * @throws {Error} with `code: "EBUSY"` when the wait ran out
 */
export function withMutex(name, fn, opts = {}) {
  if (INSIDE.has(name)) return fn();
  const now = opts.now || Date.now;
  const waitMs = opts.waitMs === undefined ? MUTEX_WAIT_MS : opts.waitMs;
  const staleMs = opts.staleMs === undefined ? MUTEX_STALE_MS : opts.staleMs;
  const dir = join(stateRoot(opts.env), "mutex");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, createHash("sha256").update(name).digest("hex").slice(0, 16) + ".mutex");
  const record = { section: name, pid: process.pid, host: hostname(), ts: new Date(now()).toISOString() };

  const deadline = now() + Math.max(0, waitMs);
  for (;;) {
    if (createExclusively(path, JSON.stringify(record) + "\n")) break;
    const holder = readRecord(path);
    const heldSince = holder ? Date.parse(holder.ts || "") : NaN;
    if (!Number.isFinite(heldSince) || now() - heldSince > staleMs) {
      // Whoever loses this removal finds the winner's fresh record on the next
      // pass and waits for it, the same way `acquireLock` settles a stale lock.
      try { unlinkSync(path); } catch (e) { if (e.code !== "ENOENT") throw e; }
      continue;
    }
    if (now() >= deadline) {
      const e = new Error("another process is still writing " + name + " (holder: pid " +
        (holder && holder.pid) + " on " + (holder && holder.host) + ", since " + (holder && holder.ts) +
        "). Nothing was written; run the command again.");
      e.code = "EBUSY";
      throw e;
    }
    // Jittered, so that N writers released together do not collide again as a
    // block on the next attempt.
    sleepSync(5 + Math.floor(Math.random() * 10));
  }

  INSIDE.add(name);
  try {
    return fn();
  } finally {
    INSIDE.delete(name);
    try { unlinkSync(path); } catch { /* stolen as stale, or already gone */ }
  }
}
