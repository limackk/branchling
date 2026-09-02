/**
 * What THIS session is working on, and how often it may say so (TL-28).
 *
 * TWO PIECES OF SESSION STATE LIVE HERE — the focus pointer that answers "which
 * task" for attribution (§8 leg 1 and leg 2 of docs/backlog-time-tracking.md —
 * a real path, product-name: allow) and the throttle stamp that answers "has
 * this session already been counted in the last minute" (§7). They share a file
 * because they share a lifetime and a scope: both belong to one session, both
 * are worthless to anybody else, and neither may ever be committed.
 *
 * WHY OUTSIDE THE REPOSITORY, against the letter of the task that asked for a
 * gitignored local file. The reasoning is `lock.mjs`'s, measured under TL-87 and
 * unchanged here: the case this exists for is N sessions in N worktrees of one
 * clone, and every worktree has its own checkout. A pointer written into the
 * backlog would be a DIFFERENT file in each of them, so "which task is this
 * session on" would be answered per tree rather than per session — the exact
 * global-state failure §8.1 disqualifies. It would also make the protection of
 * a person's working calendar depend on a correct `.gitignore` in every
 * repository this tool ever reaches, and a single `git add -A` in somebody
 * else's tree writes it into public history irreversibly (§9). A structural
 * guarantee beats a procedure every future user has to maintain.
 *
 * WHY THE FOCUS RECORDS ITS OWN ORIGIN. §8 lists the `focus` command and the last
 * `in_progress` transition as two SEPARATE legs of the chain, weighted
 * differently, and they end up in the same file because auto-focus is how leg 2
 * is implemented (§8.1: a mechanism that depends on someone remembering is the
 * failure that disqualified the off-the-shelf tools). Keeping `origin` on the
 * record is what stops the two collapsing into one: a row attributed from a
 * pointer somebody typed and a row attributed from a status write are not
 * equally strong evidence, and the log has to be able to say which it was.
 *
 * Tests: `node --test scripts/tests/attribution.test.mjs`
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { lockScope, stateRoot } from "./lock.mjs";

/** The session identifier, when the host has one to give. Named after the DATA
 *  like `BACKLOG_DIR` and `BACKLOG_STATE_DIR`, not after the product: a hook
 *  from any editor sets it, and a vendor's name in the variable would say the
 *  core depends on that vendor, which §7 forbids. */
export const SESSION_ENV = "BACKLOG_SESSION";

/** The most explicit leg of the chain (§8, leg 1): a task named in the
 *  environment of the process itself. It beats the file because it cannot
 *  outlive the process that set it. */
export const TASK_ENV = "BACKLOG_TASK";

/** How a focus came to be set. A closed set, for the reason `kind` and
 *  `attribution` are closed in `activity.mjs`: every reader has to know the
 *  whole set to weigh the record. */
export const FOCUS_ORIGINS = ["focus", "session-state"];

/**
 * Which session is this? PURE with respect to the disk.
 *
 * THE FALLBACK IS THE WORKTREE, and it is a deliberate under-claim. With no
 * host session id the finest scope anything here can actually OBSERVE is the
 * checkout, so two sessions run one after another in the same tree share an
 * identifier. That merges their heartbeats into one session for clustering —
 * where the idle gap separates them anyway — and it never merges two sessions
 * running at the SAME time, because those are in different worktrees. Inventing
 * a per-process id instead would look finer-grained and be worse: every command
 * is its own process, so every heartbeat would land in a session of one row and
 * every cluster would be a single (§6 rule 1), reporting zero minutes forever.
 *
 * @param {{env?: object, root?: string}} opts
 */
export function sessionId(opts = {}) {
  const env = opts.env || process.env;
  const explicit = String(env[SESSION_ENV] || "").trim();
  if (explicit) return explicit.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64);
  const tree = resolve(opts.root || process.cwd());
  return "tree-" + createHash("sha256").update(tree).digest("hex").slice(0, 12);
}

/** The directory holding one backlog's session state, keyed exactly as the
 *  locks are — by the shared git directory, so every worktree of one clone
 *  agrees on it while two clones do not. */
export function focusDir(backlogRoot, opts = {}) {
  const scope = opts.scope || lockScope(backlogRoot, opts);
  return join(stateRoot(opts.env), "sessions", scope.key);
}

function focusPath(backlogRoot, opts) {
  return join(focusDir(backlogRoot, opts), sessionId({ env: opts.env, root: backlogRoot }) + ".json");
}

function readState(path) {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Session state is a cache of things that can be re-established, so a
    // corrupt file is dropped rather than reported: failing here would turn a
    // truncated write into a broken `take`.
    return {};
  }
}

function writeState(path, state) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + "\n", "utf8");
}

/**
 * What this session declared it is on, or `null`.
 *
 * @returns {{task: string, actor: string, origin: string, ts: string} | null}
 */
export function readFocus(backlogRoot, opts = {}) {
  const state = readState(focusPath(backlogRoot, opts));
  const focus = state.focus;
  if (!focus || !focus.task) return null;
  return {
    task: String(focus.task),
    actor: String(focus.actor || ""),
    origin: FOCUS_ORIGINS.indexOf(focus.origin) >= 0 ? focus.origin : "focus",
    ts: String(focus.ts || ""),
  };
}

/**
 * Point this session at a task.
 *
 * THE LATEST WRITE WINS, INCLUDING OVER AN EXPLICIT ONE. A session that takes a
 * second task really is on the second task, and the first one's heartbeats stay
 * in the log with the attribution they were written with — we do not rewrite
 * backwards, for the same reason `history/` is append-only. An auto-focus that
 * refused to overwrite a typed one would leave a session silently crediting its
 * work to a task it stopped touching an hour ago, which is the failure mode
 * §8 exists to prevent, not a safeguard against it.
 */
export function writeFocus(backlogRoot, focus, opts = {}) {
  const origin = FOCUS_ORIGINS.indexOf(focus && focus.origin) >= 0 ? focus.origin : "focus";
  const path = focusPath(backlogRoot, opts);
  const state = readState(path);
  state.focus = {
    task: String((focus && focus.task) || "").trim(),
    actor: String((focus && focus.actor) || "").trim(),
    origin,
    ts: focus && focus.ts ? focus.ts : new Date().toISOString(),
  };
  if (!state.focus.task) throw new Error("a focus with no task is not a focus");
  writeState(path, state);
  return state.focus;
}

/** Forget it. Returns whether there was anything to forget. */
export function clearFocus(backlogRoot, opts = {}) {
  const path = focusPath(backlogRoot, opts);
  const state = readState(path);
  if (!state.focus) return false;
  delete state.focus;
  writeState(path, state);
  return true;
}

/**
 * Set the focus without ever failing the caller (TL-28 step 5).
 *
 * `take` and `next` call this AFTER the task file is written. Measurement is
 * subordinate to the work: a state directory that is read-only, full, or on a
 * machine where `git rev-parse` is not available must not turn a successful
 * claim into an error. What is lost is one leg of the attribution chain, and
 * §8.2 already says the answer to that is an honest `unknown`, not a failure.
 */
export function focusQuietly(backlogRoot, focus, opts = {}) {
  try {
    return writeFocus(backlogRoot, focus, opts);
  } catch {
    return null;
  }
}

/**
 * May this session write a heartbeat for `(task, kind)` yet? (§7)
 *
 * THROTTLING IS MANDATORY, NOT AN OPTIMISATION. The matcher has to cover every
 * tool — a subset produces an undercount CORRELATED with the kind of work,
 * which looks like signal and skews calibration — and covering every tool means
 * the log otherwise grows linearly with how chatty the agent is. Resolution is
 * bounded by the clustering threshold anyway, so the rows past the first in a
 * window buy nothing.
 *
 * PER `(task, kind)`, NOT PER SESSION. `commit`, `edit` and `reassign` are
 * discrete events that happen once and matter; a session-wide window would let
 * a stream of `tool` rows swallow the `commit` row that lands in the same
 * minute, and that row is the one `time` reads for the completion stamp.
 *
 * @returns {{allowed: boolean, since: number|null, seconds: number}} `since` is
 *          how many seconds ago the last accepted row was, or null for none.
 */
export function throttleCheck(backlogRoot, key, seconds, opts = {}) {
  const now = opts.now || Date.now();
  const state = readState(focusPath(backlogRoot, opts));
  const last = state.throttle && state.throttle[key];
  const at = last ? Date.parse(last) : NaN;
  if (Number.isNaN(at)) return { allowed: true, since: null, seconds };
  const since = (now - at) / 1000;
  return { allowed: since >= seconds, since, seconds };
}

/**
 * Record that a heartbeat was accepted.
 *
 * THE WINDOW IS ENFORCED HERE AND NOT IN THE ADAPTER, although a check in the
 * shell script would save a node start on most tool calls. Two reasons, and
 * both outrank the 40 milliseconds: the window's VALUE lives in `config.yaml`
 * (law 3), so a shell copy would either duplicate it or read it back out of the
 * tool it is trying to avoid starting; and the throttle has to hold for EVERY
 * adapter (§7 lists four and expects more), so a rule implemented per adapter
 * is a rule the next adapter does not have.
 */
export function throttleMark(backlogRoot, key, seconds, opts = {}) {
  const now = opts.now || Date.now();
  const path = focusPath(backlogRoot, opts);
  const state = readState(path);
  state.throttle = state.throttle || {};
  state.throttle[key] = new Date(now).toISOString();
  writeState(path, state);
}

/** Drop a session's whole state. For tests, and for the case where a person
 *  wants the pointer and the window gone together. Best effort: a missing file
 *  is the desired end state. */
export function forgetSession(backlogRoot, opts = {}) {
  try {
    rmSync(focusPath(backlogRoot, opts), { force: true });
    return true;
  } catch {
    return false;
  }
}
