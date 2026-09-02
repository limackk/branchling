#!/usr/bin/env node
/**
 * `decide <ID> --reason "…"` — a decision recorded as an event (TL-114).
 *
 * WHAT IT IS FOR. `handoff` (TL-99) leaves the QUESTION in a task's history as a
 * `__comment__` with an id of its own. This command writes the other half: the
 * answer, as a `__decision__` event that may point back at the question it
 * settles. From here "waiting for a decision" is machine-readable —
 * `openQuestions()` in history.mjs — instead of a thing somebody remembers.
 *
 * WHY AN EVENT AND NOT A FIELD. A decision changes nothing in the frontmatter,
 * so `diffMeta` cannot see it; without a row of its own the only trace would be
 * a sentence attached to whichever field happened to move next. And a reason on
 * a field cannot be pointed AT: nothing addresses it, so nothing could ever say
 * "this answers that".
 *
 * WHY `--reason` IS REQUIRED. A decision with no content is a claim that
 * something was settled, with the settling left out — the same defect as a
 * handoff with no reason, and it is refused the same way, before anything is
 * written.
 *
 * WHY `--resolves` IS OPTIONAL BUT VALIDATED. Somebody may decide without having
 * been asked; a decision that stands alone is legitimate. What is not legitimate
 * is a pointer to an event that is not in this task's history — it would leave a
 * question open forever while looking answered, so it fails BEFORE the write.
 *
 * WHAT IT DOES NOT DO. It does not write a `## Log` line. The analysis in
 * docs/backlog-human-agent-decisions.md §3 asked for one; TL-105 abolished that
 * section afterwards, and `handoff` had already settled the precedent — the
 * reason travels WITH the write, and prose in the file would be a second copy
 * that drifts from the first.
 *
 * It does not touch the status, the owner or the lock either. Deciding is not
 * putting the task down: the session that answered its own question usually
 * carries straight on working, and a command that quietly requeued the task
 * would take it away from them.
 *
 * Tests: `node --test scripts/tests/decide.test.mjs`
 */

import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import {
  ACTOR_NAMESPACES, EVENT_ID_RE, FIELD_DECISION,
  appendEntries, eventId, isValidActor, isValidReason, normalizeReason, openQuestions, readHistory,
} from "./history.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { resolveActor } from "./take-task.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DECIDE_FLAGS = ["--dir", "--actor", "--reason", "--resolves", "--json"];

/** PURE — resolves `decide`'s arguments. Throws on a usage error. */
export function parseDecideArgs(args) {
  const plan = { id: null, dir: null, actor: null, reason: null, resolves: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (DECIDE_FLAGS.indexOf(a) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + DECIDE_FLAGS.join(" "));
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — one decision belongs to one task");
    plan.id = a;
  }
  if (!plan.id) {
    throw new Error("no task id\nusage: " + N + " decide <ID> --reason \"…\" [--resolves <id>]");
  }
  if (plan.reason === null) {
    throw new Error(
      "`--reason` is required\n" +
        "a decision with no content records that something was settled and leaves out\n" +
        "what — which is the one thing a later reader cannot reconstruct."
    );
  }
  if (!isValidReason(plan.reason)) {
    throw new Error(
      "`--reason " + plan.reason + "` is empty or reserved\n" +
        "`unknown` and `proven` are what the tool writes when nobody stated a reason;\n" +
        "typing one by hand would dress a machine's answer up as yours."
    );
  }
  // Checked here rather than against the log, because it is wrong whatever the
  // task holds: an id that is not an event id can never match one.
  if (plan.resolves !== null && !EVENT_ID_RE.test(plan.resolves)) {
    throw new Error(
      "`--resolves " + plan.resolves + "` is not an event id\n" +
        "An event id is 26 characters of Crockford base32 — the `id` of a row in\n" +
        "backlog/history/<ID>.jsonl. `" + N + " history <ID> --json` lists them."
    );
  }
  return plan;
}

/**
 * Record one decision.
 *
 * Returns a RESULT rather than printing or exiting, so its shape is testable
 * without a subprocess — the arrangement `takeTask` and `handoffTask` use.
 *
 * @param {{root: string, config: object, id: string, actor: string, reason: string,
 *          resolves?: string|null, now?: number}} opts
 */
export function decideTask(opts) {
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
  const entries = readHistory(root, id);

  // A CLOSED TASK STILL TAKES DECISIONS. `handoff` refuses one, because handing
  // on work nobody is waiting for is a mistake; recording why something was done
  // is not — and the question most worth answering is often the one raised by a
  // task that is already finished.

  if (opts.resolves) {
    const target = entries.find((e) => e && e.id === opts.resolves);
    if (!target) {
      const open = openQuestions(entries);
      return {
        ok: false, kind: "unknown-event", id,
        message: "`--resolves " + opts.resolves + "` names no event in " + id + "'s history",
        details: open.length
          ? ["open questions here: " + open.map((e) => e.id).join(", ")]
          : ["This task's history holds no unanswered question. Decide without `--resolves`."],
      };
    }
  }

  const ts = new Date(now).toISOString();
  const decision = {
    id: eventId(ts), ts, task: id, field: FIELD_DECISION,
    from: "", to: opts.reason,
    actor, source: "decide",
    reason: normalizeReason(opts.reason),
  };
  // `resolves` is written only when it holds something: an empty key in every
  // row would make "answers nothing" and "answers a thing named nowhere" the
  // same shape on disk.
  if (opts.resolves) decision.resolves = opts.resolves;
  appendEntries(root, id, [decision]);

  const after = entries.concat([decision]);
  return { ok: true, id, decision, file: join(paths.historyDir, id + ".jsonl"), open: openQuestions(after) };
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

/** What a caller reads on stdout. The remaining open questions are printed even
 *  when there are none: "0 left" is the answer somebody came for, and silence
 *  reads as "I did not look". */
export function renderDecision(result, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  const rel = relative(process.cwd(), result.file) || result.file;
  const shown = rel.length < result.file.length ? rel : result.file;
  out.push(paint.ok(MARK.ok) + " " + paint.id(result.id) + " decided by " + result.decision.actor);
  out.push("  " + result.decision.to);
  if (result.decision.resolves) out.push("  answers: " + paint.id(result.decision.resolves));
  out.push(
    "  open questions left: " +
      (result.open.length ? String(result.open.length) : paint.ok("0"))
  );
  out.push("  " + paint.dim(shown));
  return out.join("\n");
}

export function decideJson(result) {
  return {
    ok: true,
    id: result.id,
    decision: {
      id: result.decision.id,
      ts: result.decision.ts,
      text: result.decision.to,
      actor: result.decision.actor,
      resolves: result.decision.resolves || null,
    },
    openQuestions: result.open.map((e) => ({ id: e.id, ts: e.ts, text: e.to, actor: e.actor })),
  };
}

/** The same split `take` and `handoff` use: a task that is not there is a bad
 *  argument (2), a refusal about one that exists is 1. */
export function refusalCode(kind) {
  return kind === "not-found" ? 2 : 1;
}

export function run(argv) {
  let plan;
  try {
    plan = parseDecideArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " decide", head, rest, [N + " decide --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    return fail2("the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
      "A decision is the one row where WHO decided is the point — an agent's and a",
      "person's are the same shape, and only the namespace tells them apart.",
    ]);
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    return fail2(e.message, []);
  }
  const config = loadConfigOrExit(root);

  const result = decideTask({
    root, config, id: plan.id, actor, reason: plan.reason, resolves: plan.resolves,
  });
  if (!result.ok) {
    if (plan.json) {
      console.log(JSON.stringify(
        { ok: false, kind: result.kind, id: result.id || plan.id, message: result.message, details: result.details || [] },
        null, 2
      ));
    } else {
      console.error(failure(N + " decide", result.message, result.details || []));
    }
    return refusalCode(result.kind);
  }

  // No `build` here, unlike `handoff`: nothing in the frontmatter moved, so the
  // generated views say exactly what they said before.
  if (plan.json) console.log(JSON.stringify(decideJson(result), null, 2));
  else console.log(renderDecision(result));
  return 0;
}

function fail2(problem, details) {
  console.error(failure(N + " decide", problem, details, [N + " decide --help"]));
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("decide-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
