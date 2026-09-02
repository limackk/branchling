#!/usr/bin/env node
/**
 * `handoff <ID>` — passing a task to another role, with the reason and a trace
 * (TL-99).
 *
 * WHAT IT IS FOR. An agent working a task reaches a decision outside its
 * mandate. Today the only honest moves are to guess or to stop, and both end the
 * same way: the question lives in one session's scrollback and dies with it. This
 * command is the third move — the task goes back to the queue asking for a
 * DIFFERENT role, and the question travels with it, in the task's history rather
 * than in a chat log nobody else can read.
 *
 * WHY THE REASON IS MANDATORY. A task handed on without one arrives as work with
 * no context — the same defect as a `blocked` status with an empty `blocked_by`,
 * which this backlog already refuses. The receiver has to be able to answer "what
 * am I being asked" from the record alone.
 *
 * WHY IT WRITES A `__comment__` AND NOT ONLY A REASON. Both are written, and they
 * are not the same fact. The reason on the `role:` row explains that field's
 * change and is bounded like every reason. The comment is an EVENT with an id of
 * its own — append-only and conflict-free by construction (§5.1 of
 * docs/worktrail-state-and-sync.md, a real path — product-name: allow) — which
 * makes it addressable: TL-114's `__decision__` answers a comment by pointing
 * at it, and nothing can point at a field's reason. This is
 * the first use of the pseudo-field reserved in BL-1404, and it is deliberately
 * general: a comment written from the viewer by somebody who has never seen this
 * command produces the same row.
 *
 * WHAT IT DOES NOT DO. It does not write a `## Log` line. The original task asked
 * for one; TL-105 abolished the section, and the reason now travels WITH the
 * write. Adding prose back would be the second copy this tool refuses everywhere
 * else.
 *
 * It does not invent vocabulary either. Which status means "back in the queue" is
 * DERIVED from words the project already declared (`next`'s own queue statuses);
 * when more than one qualifies the command refuses and asks, because a dispatcher
 * writing a status by guesswork writes into somebody's tree a value they never
 * chose. And the owner is CLEARED rather than set to a word like "unassigned" —
 * that word is one project's, and it lives in `owners:` if they want it.
 *
 * Tests: `node --test scripts/tests/handoff.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, FIELD_COMMENT, appendEntries, eventId, isValidActor, isValidReason, normalizeReason, readHistory, recordEdit } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { isExpired, lockDir, readLock, releaseLock } from "./lock.mjs";
import { queueStatuses } from "./next-task.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { inProgressStatus, todayStamp } from "./take-task.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const HANDOFF_FLAGS = ["--dir", "--actor", "--to-role", "--to-owner", "--reason", "--status", "--json"];

/** PURE — resolves `handoff`'s arguments. Throws on a usage error. */
export function parseHandoffArgs(args) {
  const plan = { id: null, dir: null, actor: null, toRole: null, toOwner: null, reason: null, status: null, json: false };
  const key = { "--to-role": "toRole", "--to-owner": "toOwner" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (HANDOFF_FLAGS.indexOf(a) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + a + "` with no value");
      plan[key[a] || a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + HANDOFF_FLAGS.join(" "));
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — hand off one task at a time");
    plan.id = a;
  }
  if (!plan.id) {
    throw new Error("no task id\nusage: " + N + " handoff <ID> --to-role <r> --reason \"…\"");
  }
  // Nothing to hand off TO is not a no-op we may perform quietly: it would
  // release the lock and clear the owner while the task still asks for the role
  // it always did, which reads afterwards as somebody having abandoned it.
  if (plan.toRole === null && plan.toOwner === null) {
    throw new Error(
      "neither `--to-role` nor `--to-owner`\n" +
        "a handoff names its receiver — otherwise this is just putting the task down."
    );
  }
  // The reason is a usage error and not a refusal about the task: it is wrong
  // whatever the task says, and it has to fail BEFORE anything is written.
  if (plan.reason === null) {
    throw new Error(
      "`--reason` is required\n" +
        "a task handed on without one arrives as work with no context — the receiver\n" +
        "has to be able to answer \"what am I being asked\" from the record alone."
    );
  }
  if (!isValidReason(plan.reason)) {
    throw new Error(
      "`--reason " + plan.reason + "` is empty or reserved\n" +
        "`unknown` and `proven` are what the tool writes when nobody stated a reason;\n" +
        "typing one by hand would dress a machine's answer up as yours."
    );
  }
  return plan;
}

/**
 * Which status a task goes back to when it stops being in progress. PURE.
 *
 * FIRST, WHERE IT CAME FROM. `take` recorded the transition it made, so the
 * history already holds the answer for this exact task: the `from` of the most
 * recent change INTO the in-progress status. Restoring it is not a choice the
 * tool is making — it is undoing one, which is the whole of what putting a task
 * down means. A `blocked` task that somebody took goes back to `blocked`, and
 * nothing has to decide whether that was a good idea.
 *
 * ONLY THEN THE VOCABULARY. With no such record — a task set in progress by hand
 * before anybody ran `history` — we fall back to the statuses `next` is willing
 * to hand out (next-task.mjs). One candidate is an answer. Several is a question
 * only the project can settle, and the DEFAULT vocabulary produces two, so
 * guessing here would be guessing in the ordinary case rather than an exotic one.
 *
 * @param {object} config
 * @param {object[]} entries this task's history, oldest first
 * @param {string} inProgress the status the task is leaving
 * @returns {{status: string, from: string}|{ambiguous: string[]}}
 */
export function requeueStatus(config, entries, inProgress) {
  const active = new Set(config.activeStatuses || []);
  for (let i = (entries || []).length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.field !== "status" || e.to !== inProgress) continue;
    // A status renamed since the entry was written is no longer somewhere a task
    // can be put; the vocabulary decides, not a value frozen in an old row.
    if (typeof e.from === "string" && e.from !== inProgress && active.has(e.from)) {
      return { status: e.from, from: "history" };
    }
    break;
  }
  const queue = queueStatuses(config);
  if (queue.length === 1) return { status: queue[0], from: "vocabulary" };
  return { ambiguous: queue };
}

/**
 * Hand one task on: validate, write, record, release.
 *
 * Returns a RESULT rather than printing or exiting, for the same reason
 * `takeTask` does — so the shape is testable without a subprocess.
 *
 * @param {{root: string, config: object, id: string, actor: string, toRole?: string,
 *          toOwner?: string, reason: string, status?: string, now?: number, env?: object}} opts
 */
export function handoffTask(opts) {
  const { root, config, actor } = opts;
  const paths = backlogPaths(root);
  const warnings = [];
  const wanted = String(opts.id || "").toUpperCase();
  const now = opts.now || Date.now();

  const records = readTaskRecords(paths.tasksDir, config.taskId.file);
  const record = records.find((t) => String(t.id).toUpperCase() === wanted);
  if (!record) {
    return { ok: false, kind: "not-found", id: opts.id, message: "no task " + opts.id + " in " + paths.tasksDir };
  }
  const id = record.id;
  const file = join(paths.tasksDir, record.file.replace(/^tasks\//, ""));

  if (config.archivedStatuses.indexOf(record.status) >= 0) {
    return {
      ok: false, kind: "closed", id,
      message: id + " is closed (status: " + record.status + ")",
      details: ["A closed task has nobody waiting on it — reopen it deliberately first."],
    };
  }

  const inProgress = inProgressStatus(config);

  // Somebody else is holding it. The same refusal `take` gives, and for the same
  // reason: an explicit instruction outranks a field, but not another session's
  // live claim — handing their task on would take it out from under them without
  // either side finding out until the merge.
  if (inProgress && record.status === inProgress && record.owner && record.owner !== actor) {
    return {
      ok: false, kind: "other-owner", id,
      message: id + " is " + inProgress + ", owner: " + record.owner,
      details: ["It is theirs to hand on. Ask them, or take it over deliberately — not silently."],
    };
  }
  const held = readLock(lockDir(root, opts).dir, id);
  if (held && held.actor !== actor && !isExpired(held, config.lockTtlMinutes, now)) {
    return {
      ok: false, kind: "locked", id, holder: held,
      message: id + " is held by " + (held.actor || "another session"),
      details: [
        "since " + (held.ts || "?") + ", pid " + (held.pid || "?") + " on " + (held.host || "?"),
        "The lock expires after " + config.lockTtlMinutes + " minutes (`lock_ttl_minutes`).",
      ],
    };
  }

  // The status change, decided BEFORE the first write. A task that is in
  // progress stops being in progress — that is the whole of it. Every other
  // status was entered by a decision this command is not making: `blocked` stays
  // `blocked`, and the handoff is what tells the next role why.
  let nextStatus = null;
  if (inProgress && record.status === inProgress) {
    if (opts.status) {
      nextStatus = opts.status;
    } else {
      const queue = requeueStatus(config, readHistory(root, id), inProgress);
      if (queue.ambiguous) {
        return {
          ok: false, kind: "ambiguous-queue-status", id,
          message: "this backlog has " + (queue.ambiguous.length || "no") + " statuses that mean `waiting for somebody`",
          details: [
            queue.ambiguous.length
              ? "candidates: " + queue.ambiguous.join(", ")
              : "`statuses` minus `archived_statuses`, `in_progress_status` and `reason_required_statuses` is empty",
            "Nothing in this task's history says where it was taken FROM either.",
            "Say which one it goes back to with `--status <s>` — choosing for you would",
            "write a status into your tree that you never picked.",
          ],
        };
      }
      nextStatus = queue.status;
    }
  } else if (!inProgress) {
    // Not a refusal: the status is a side effect here, and the role change — the
    // point of the command — does not depend on it.
    warnings.push("`in_progress_status` is not declared, so the status was left as `" + record.status + "`");
  }

  const raw = readFileSync(file, "utf8");
  const before = extractMeta(splitFrontmatter(raw).frontmatter);
  const specs = buildFieldSpecs(config);
  let text = raw;
  try {
    if (opts.toRole != null) text = setFrontmatterField(text, "role", opts.toRole, fieldSpec("role", specs));
    // The owner is CLEARED, not set to a word. "Nobody holds this" is the
    // absence of a claim; `owners:` is a project's vocabulary of people, and
    // nothing in it says which entry means nobody. Naming one would be this
    // tool writing somebody else's word into their tree.
    text = setFrontmatterField(text, "owner", opts.toOwner == null ? "" : opts.toOwner, fieldSpec("owner", specs));
    if (nextStatus) text = setFrontmatterField(text, "status", nextStatus, fieldSpec("status", specs));
    text = setFrontmatterField(text, "updated", todayStamp(now));
  } catch (e) {
    return { ok: false, kind: "unwritable", id, message: id + ": " + e.message };
  }
  writeFileSync(file, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  const ts = new Date(now).toISOString();
  const changes = recordEdit(root, { taskId: id, before, after, actor, ts, source: "handoff", reason: opts.reason });

  // The comment carries the same sentence as the field rows above, and that is
  // not an accident: a reason belongs to the ACT, and one act moving several
  // fields copies it onto each so that any single row answers on its own
  // (TL-105). What the comment adds is an EVENT with an id — the thing an
  // answer can be attached to later.
  const comment = {
    id: eventId(ts), ts, task: id, field: FIELD_COMMENT,
    from: "", to: opts.reason,
    actor, source: "handoff", reason: normalizeReason(opts.reason),
  };
  appendEntries(root, id, [comment]);

  // The reservation is over: this session is no longer the one working on it.
  // Only OUR lock — `releaseLock` refuses somebody else's, and a task handed on
  // by a third party must not have the holder's claim dropped underneath them.
  const released = releaseLock({ root, taskId: id, actor, env: opts.env });

  return { ok: true, id, file, text, before, after, comment, changes, released, warnings };
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

/**
 * The words for the two empty ends, for READING only — neither is ever written
 * to a file. They differ because the fields do: an empty `owner` means nobody
 * holds the task, an empty `role` means anybody may take it. One word for both
 * would report the more open of the two states as the more closed one.
 */
const EMPTY = { owner: "(nobody)", role: "(anybody)", status: "(none)" };

/**
 * What a caller gets on stdout.
 *
 * NOT the whole task file, which is what `take` prints. The reader of a `take`
 * is about to do the work and needs the text in front of them; the reader of a
 * `handoff` has just put it down, and printing it back would be handing them the
 * thing they are done with.
 */
export function renderHandoff(result, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  const rel = relative(process.cwd(), result.file) || result.file;
  const shown = rel.length < result.file.length ? rel : result.file;
  for (const w of result.warnings || []) out.push(paint.warn(MARK.warn) + " " + w);

  const moved = (key) => {
    const [from, to] = [result.before[key], result.after[key]];
    if (from === to) return null;
    return "  " + key + ": " + (from || EMPTY[key]) + " " + MARK.arrow + " " + paint.id(to || EMPTY[key]);
  };

  out.push(paint.ok(MARK.ok) + " " + paint.id(result.id) + " handed off by " + result.comment.actor);
  for (const key of ["role", "owner", "status"]) {
    const row = moved(key);
    if (row) out.push(row);
  }
  out.push("  reason: " + result.comment.to);
  out.push("  " + paint.dim(shown));
  return out.join("\n");
}

export function handoffJson(result) {
  return {
    ok: true,
    id: result.id,
    file: result.file,
    task: result.after,
    role: { from: result.before.role || "", to: result.after.role || "" },
    owner: { from: result.before.owner || "", to: result.after.owner || "" },
    status: { from: result.before.status, to: result.after.status },
    comment: { id: result.comment.id, ts: result.comment.ts, text: result.comment.to, actor: result.comment.actor },
    released: result.released,
    warnings: result.warnings || [],
  };
}

/** The exit code for a refusal — the same split `take` uses: a task that is not
 *  there is a bad argument (2), a refusal about one that exists is 1. */
export function refusalCode(kind) {
  return kind === "not-found" ? 2 : 1;
}

/** Rebuild the generated views. Outside `handoffTask()` for the reason `take`
 *  gives: the write is what must be atomic, and the views are computed (law 2). */
export function rebuildViews(root) {
  const build = spawnSync(process.execPath, [join(__dirname, "build-backlog.mjs"), "--dir", root], {
    encoding: "utf8",
  });
  return build.status === 0;
}

export function run(argv) {
  let plan;
  try {
    plan = parseHandoffArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " handoff", head, rest, [N + " handoff --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    return fail2("the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
      "The namespace says how much the attribution is worth — local: declared,",
      "agent: automated, user: an authenticated account. BL-1404.",
    ]);
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    return fail2(e.message, []);
  }
  const config = loadConfigOrExit(root);

  // Every vocabulary check happens here, before the task is even looked up: a
  // typo in a role is wrong whatever the task says, and a handoff to a role
  // nobody serves is the phantom `role:` TL-97 exists to keep out of files.
  if (plan.toRole !== null && (config.roles || []).indexOf(plan.toRole) < 0) {
    return fail2("unknown role `" + plan.toRole + "`", (config.roles || []).length
      ? ["`roles` in config.yaml holds: " + config.roles.join(", ")]
      : [
          "This backlog declares no `roles:` in config.yaml, so there is no role to hand to.",
          "Declare the vocabulary there first — a handoff to a role nobody serves is a",
          "task that leaves every queue without a word.",
        ]);
  }
  if (plan.toOwner !== null && (config.owners || []).length && config.owners.indexOf(plan.toOwner) < 0) {
    return fail2("`" + plan.toOwner + "` is not an allowed value for the field `owner`",
      ["allowed: " + config.owners.join(" | ")]);
  }
  if (plan.status !== null) {
    if (config.statuses.indexOf(plan.status) < 0) {
      return fail2("unknown status `" + plan.status + "`", ["`statuses` in config.yaml holds: " + config.statuses.join(", ")]);
    }
    if (config.archivedStatuses.indexOf(plan.status) >= 0) {
      return fail2("`" + plan.status + "` is an archived status", [
        "A handoff puts a task back in the queue; closing one is `" + N + " done`, which",
        "runs its verification first.",
      ]);
    }
  }

  const result = handoffTask({
    root, config, id: plan.id, actor,
    toRole: plan.toRole, toOwner: plan.toOwner, reason: plan.reason, status: plan.status,
  });
  if (!result.ok) {
    if (plan.json) {
      printJson("task-handoff", {
        ok: false, id: result.id || plan.id, refusalKind: result.kind,
        refusal: result.message, details: result.details || [],
      });
    } else {
      console.error(failure(N + " handoff", result.message, result.details || []));
    }
    return refusalCode(result.kind);
  }

  if (!rebuildViews(root)) {
    console.error(failure(N + " handoff", "the views were not rebuilt — run `" + N + " build` yourself", []));
  }
  if (plan.json) printJson("task-handoff", handoffJson(result));
  else console.log(renderHandoff(result));
  return 0;
}

function fail2(problem, details) {
  console.error(failure(N + " handoff", problem, details, [N + " handoff --help"]));
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("handoff-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
