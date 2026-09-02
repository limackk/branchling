#!/usr/bin/env node
/**
 * `ask` — an agent's open question stops the task until a person answers it
 * (TL-148).
 *
 * THE MOVE THAT WAS MISSING. An unattended loop had no way to say "I am not
 * allowed to decide this". `handoff` (TL-99) puts the task down, but nothing in
 * what it records says the stop is a QUESTION, so the next session is handed the
 * same task and asks the same thing again. The decision panel (TL-115) shows
 * open questions to a person and does not stop the queue. This command closes
 * the loop by using machinery that already exists, in the order it exists:
 *
 *   1. the question is a `__comment__` — an event with an id, which is what
 *      TL-114's `decide --resolves` can point at;
 *   2. the task moves into the status this project protects with a stated
 *      reason, and the reason NAMES that id (`questionBlockReason`);
 *   3. `next` will not hand out a protected status, so the queue stops here
 *      without anything new having to teach it to.
 *
 * NOTHING IS STORED (law 2). There is no `question:` field and no `awaiting:`
 * flag. "Open question" stays what TL-114 defined it as — a comment no decision
 * resolves — and the block is lifted as a CONSEQUENCE of the decision, not by a
 * second write somebody has to remember. If answering took two commands, the
 * second would be forgotten in exactly the case this exists for.
 *
 * TWO IDENTICAL QUESTIONS ARE TWO QUESTIONS. Nothing here dedupes by text: two
 * sentences said at different times are two utterances, which is the rule
 * `__comment__` has always followed, and a session asking the same thing twice
 * is information rather than noise.
 *
 * Tests: `node --test scripts/tests/ask.test.mjs`
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

import { loadConfigOrExit } from "./config.mjs";
import {
  ACTOR_NAMESPACES, FIELD_COMMENT, appendEntries, eventId, isValidActor, isValidReason,
  questionBlockReason, recordEdit,
} from "./history.mjs";
import { releaseLock } from "./lock.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { resolveActor, todayStamp } from "./take-task.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ASK_FLAGS = ["--dir", "--actor", "--question", "--status", "--json"];

/** PURE — resolves `ask`'s arguments. Throws on a usage error. */
export function parseAskArgs(args) {
  const plan = { id: null, dir: null, actor: null, question: null, status: null, json: false };
  const key = { "--question": "question", "--status": "status", "--dir": "dir", "--actor": "actor" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (Object.prototype.hasOwnProperty.call(key, a)) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + a + "` with no value");
      plan[key[a]] = value;
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + ASK_FLAGS.join(" "));
    if (plan.id) throw new Error("more than one task id: " + plan.id + " and " + a);
    plan.id = a;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " ask <ID> --question \"…\"");
  if (plan.question === null || !String(plan.question).trim()) {
    throw new Error(
      "`--question` is required\n" +
        "A task stopped with no question recorded is a task nobody can answer: the\n" +
        "person who finds it has to be able to read what was being asked."
    );
  }
  if (!isValidReason(plan.question)) {
    throw new Error(
      "`--question " + plan.question + "` is empty or reserved\n" +
        "`unknown` and `proven` are what the tool writes when nobody stated a reason."
    );
  }
  return plan;
}

/**
 * Which status means "waiting for somebody to decide". PURE.
 *
 * DERIVED, never the literal `blocked`: the statuses a project protects with
 * `reason_required_statuses`, minus the archived ones. Those are exactly the
 * statuses somebody must state a reason to enter, which is what a question is.
 * One candidate is an answer; several is a question only the project can settle,
 * so the caller is asked with `--status` rather than guessed at.
 */
export function blockingStatus(config, requested) {
  const archived = new Set(config.archivedStatuses || []);
  const candidates = (config.reasonRequiredStatuses || []).filter((s) => !archived.has(s));
  if (requested) {
    return candidates.indexOf(requested) >= 0
      ? { status: requested }
      : { unknown: requested, candidates };
  }
  if (candidates.length === 1) return { status: candidates[0] };
  return { ambiguous: candidates };
}

/**
 * Record the question and block the task.
 *
 * Returns a RESULT rather than printing or exiting — the arrangement `takeTask`,
 * `handoffTask` and `decideTask` all use.
 *
 * @param {{root: string, config: object, id: string, actor: string, question: string,
 *          status?: string|null, now?: number, env?: object}} opts
 */
export function askTask(opts) {
  const { root, config, actor } = opts;
  const paths = backlogPaths(root);
  const wanted = String(opts.id || "").toUpperCase();
  const now = opts.now || Date.now();

  const records = readTaskRecords(paths.tasksDir, config.taskId.file);
  const record = records.find((t) => String(t.id).toUpperCase() === wanted);
  if (!record) {
    return { ok: false, kind: "not-found", id: opts.id, message: "no task " + opts.id + " in " + paths.tasksDir };
  }
  const id = record.id;

  if ((config.archivedStatuses || []).indexOf(record.status) >= 0) {
    return {
      ok: false, kind: "closed", id,
      message: id + " is closed (status: " + record.status + ")",
      details: [
        "A closed task has no queue to stop. A question about finished work is a",
        "`" + N + " decide` on it, which records the answer without reopening anything.",
      ],
    };
  }

  const target = blockingStatus(config, opts.status || null);
  if (target.unknown) {
    return {
      ok: false, kind: "unknown-status", id,
      message: "`" + target.unknown + "` is not a status this backlog protects with a reason",
      details: target.candidates.length
        ? ["`reason_required_statuses` in config.yaml holds: " + target.candidates.join(", ")]
        : ["This backlog protects no status with a stated reason, so there is nowhere to stop."],
    };
  }
  if (target.ambiguous) {
    return {
      ok: false, kind: "ambiguous-status", id,
      message: "this backlog has " + (target.ambiguous.length || "no") + " statuses that mean `waiting for somebody`",
      details: target.ambiguous.length
        ? [
            "candidates: " + target.ambiguous.join(", "),
            "Say which one with `--status <s>` — choosing for you would write a status into",
            "your tree that you never picked.",
          ]
        : [
            "`reason_required_statuses` in config.yaml is empty, so no status here means",
            "`waiting for somebody`. Declare one before an agent can stop on a question.",
          ],
    };
  }

  const file = join(paths.tasksDir, String(record.file).replace(/^tasks\//, ""));
  const raw = readFileSync(file, "utf8");
  const before = extractMeta(splitFrontmatter(raw).frontmatter);

  // THE QUESTION IS WRITTEN FIRST, because the block's reason has to name it.
  // The reverse order would leave a task stopped for a reason pointing at an
  // event that does not exist if the second write failed.
  const ts = new Date(now).toISOString();
  const question = {
    id: eventId(ts), ts, task: id, field: FIELD_COMMENT,
    from: "", to: opts.question,
    actor, source: "ask", reason: opts.question,
  };
  appendEntries(root, id, [question]);

  const specs = buildFieldSpecs(config);
  let text = raw;
  try {
    text = setFrontmatterField(text, "status", target.status, fieldSpec("status", specs));
    // The owner is cleared for the same reason `handoff` clears it: the session
    // that asked has stopped working on the task, and a claim left behind would
    // say somebody is on it while nobody is.
    text = setFrontmatterField(text, "owner", "", fieldSpec("owner", specs));
    text = setFrontmatterField(text, "updated", todayStamp(now));
  } catch (e) {
    return { ok: false, kind: "unwritable", id, message: id + ": " + e.message };
  }
  writeFileSync(file, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  const changes = recordEdit(root, {
    taskId: id, before, after, actor, ts, source: "ask",
    reason: questionBlockReason(question.id),
  });
  const released = releaseLock({ root, taskId: id, actor, env: opts.env });

  return { ok: true, id, file, text, before, after, question, changes, released };
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

export function renderAsk(result, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  out.push(
    paint.ok(MARK.ok) + " " + paint.id(result.id) + " is waiting for an answer — " +
      result.before.status + " " + MARK.arrow + " " + result.after.status
  );
  out.push("  " + paint.dim(result.question.id) + "  " + result.question.to);
  out.push("");
  out.push("  answered by: " + N + " decide " + result.id + " --resolves " + result.question.id + " --reason \"…\"");
  out.push("  " + paint.dim("until then `" + N + " next` passes over it — a protected status is not dispatched"));
  return out.join("\n");
}

export function askJson(result) {
  return {
    ok: true, id: result.id, file: result.file,
    question: { id: result.question.id, ts: result.question.ts, text: result.question.to, actor: result.question.actor },
    changes: (result.changes || []).map((c) => ({ field: c.field, from: c.from, to: c.to })),
    blockedReason: questionBlockReason(result.question.id),
  };
}

export function run(argv) {
  let plan;
  try {
    plan = parseAskArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " ask", head, rest, [N + " ask --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    console.error(failure(N + " ask", "the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
      "A question with no attributable asker cannot be answered by anybody in particular.",
    ], [N + " ask --help"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " ask", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const result = askTask({ root, config, id: plan.id, actor, question: plan.question, status: plan.status });

  if (!result.ok) {
    if (plan.json) {
      printJson("task-ask", { ok: false, refusalKind: result.kind, refusal: result.message, details: result.details || [] });
    } else {
      console.error(failure(N + " ask", result.message, result.details || []));
    }
    return result.kind === "not-found" || result.kind === "closed" ? 1 : 2;
  }

  if (plan.json) printJson("task-ask", askJson(result));
  else console.log(renderAsk(result));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("ask-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
