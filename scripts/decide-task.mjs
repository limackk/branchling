#!/usr/bin/env node
/**
 * `decide <ID> --reason "…"` — a decision recorded as an event (TL-114).
 *
 * WHAT IT IS FOR. `ask` leaves the QUESTION in a task's history as a
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
 * WHY THERE IS NO READING FORM (TL-396). `--help` advertised a third usage,
 * `decide <ID> [--json]`, described as "the decision and what remains
 * unanswered, for a program", and the command answered it with exit 2 and a
 * sentence about the flag the caller deliberately had not passed. The line is
 * gone rather than implemented: `decide` WRITES, and the only thing that could
 * have selected a read is the ABSENCE of `--reason` — so a reason dropped by a
 * shell, or arriving empty from a variable, would stop refusing and start
 * printing, exit 0, with nothing recorded. TL-256 had already settled the
 * general form of this when it rejected `history --show`: one name may not mean
 * both a read and a write. The promise is kept where reading belongs —
 * `log <ID> --decisions`, which the refusal above names.
 *
 * WHY `--resolves` IS OPTIONAL BUT VALIDATED. Somebody may decide without having
 * been asked; a decision that stands alone is legitimate. What is not legitimate
 * is a pointer to an event that is not in this task's history — it would leave a
 * question open forever while looking answered, so it fails BEFORE the write.
 *
 * ANSWERING BY NUMBER (TL-204). A question asked with `ask --option` carries its
 * menu, and `--choose <n>` answers by picking a row. What is RECORDED is the
 * option's text, in the same `to` a typed `--reason` fills, so the log reads
 * identically whether the answer was picked or written — a consumer that had to
 * resolve a number against another event to know what was decided would be
 * reading a foreign key, and the log would stop being readable on its own.
 *
 * WHY `--choose` REQUIRES `--resolves`. A bare number indexes a menu, and which
 * menu is not something the tool may guess: one task can carry two open
 * questions, and picking "option 2" of the wrong one records a real answer to a
 * question nobody asked. The number and the question it belongs to arrive
 * together or not at all.
 *
 * WHY `--choose` AND `--reason` ARE MUTUALLY EXCLUSIVE. Both say what was
 * decided, and one field holds it. An answer that is not on the menu is a plain
 * `--reason`; a caveat ON a chosen option is a second decision, and it reads
 * better as one.
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
import { readFileSync, writeFileSync } from "node:fs";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, appendEntries, currentSession, EVENT_ID_RE, eventId, FIELD_DECISION, isValidActor, isValidReason, normalizeReason, openQuestions, questionIdFromReason, readHistory, reasonRefusal, recordEdit } from "./history.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { todayStamp } from "./take-task.mjs";
import { requeueStatus } from "./handoff-task.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DECIDE_FLAGS = ["--dir", "--actor", "--reason", "--resolves", "--choose", "--json"];

/** PURE — resolves `decide`'s arguments. Throws on a usage error. */
export function parseDecideArgs(args) {
  const plan = { id: null, dir: null, actor: null, reason: null, resolves: null, choose: null, json: false };
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
      throw new Error("unknown flag: " + a + "\navailable: " + DECIDE_FLAGS.join(" "));
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — one decision belongs to one task");
    plan.id = a;
  }
  if (!plan.id) {
    throw new Error("no task id\nusage: " + N + " decide <ID> --reason \"…\" [--resolves <id>]");
  }

  if (plan.choose !== null) {
    if (plan.reason !== null) {
      throw new Error(
        "`--choose` and `--reason` both say what was decided\n" +
          "One of them fills the record. Pick a row from the menu, or write an answer that\n" +
          "is not on it — a remark ABOUT a chosen option is a second `" + N + " decide`."
      );
    }
    if (plan.resolves === null) {
      throw new Error(
        "`--choose " + plan.choose + "` with no `--resolves <event id>`\n" +
          "A number on its own indexes a menu, and one task can carry two open questions —\n" +
          "so which question the row belongs to is not something this may guess.\n" +
          "`" + N + " history <ID> --json` lists the events and their options."
      );
    }
    if (!/^[0-9]+$/.test(String(plan.choose)) || Number(plan.choose) < 1) {
      throw new Error(
        "`--choose " + plan.choose + "` is not an option number\n" +
          "Options are numbered from 1, in the order they were offered."
      );
    }
    plan.choose = Number(plan.choose);
  } else if (plan.reason === null) {
    throw new Error(
      "`--reason` is required unless a menu row is chosen\n" +
        "a decision with no content records that something was settled and leaves out\n" +
        "what — which is the one thing a later reader cannot reconstruct.\n" +
        "Where the question was asked with options, `--choose <n>` fills it from one.\n" +
        "To READ what was decided already, and what is still open, ask the command that\n" +
        "reads: `" + N + " log " + (plan.id || "<ID>") + " --decisions`."
    );
  }

  if (plan.reason !== null) {
    const refusal = reasonRefusal(plan.reason, "--reason");
    if (refusal) throw new Error(refusal);
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
 * @param {{root: string, config: object, id: string, actor: string, reason?: string|null,
 *          resolves?: string|null, choose?: number|null, now?: number}} opts
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

  let target = null;
  if (opts.resolves) {
    target = entries.find((e) => e && e.id === opts.resolves);
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

  // THE ROW BECOMES THE REASON. Everything downstream — the log, the lifted
  // block, the printed task file — reads `to`, and none of it needs to know
  // whether a person typed the sentence or picked it.
  let reason = opts.reason;
  let chosen = null;
  if (opts.choose) {
    const options = Array.isArray(target.options) ? target.options : [];
    if (!options.length) {
      return {
        ok: false, kind: "no-options", id,
        message: "the question " + opts.resolves + " was asked with no options",
        details: [
          "`--choose <n>` picks a row from a menu, and this question does not carry one.",
          "Answer it with `--reason \"…\"`.",
        ],
      };
    }
    if (opts.choose > options.length) {
      return {
        ok: false, kind: "option-range", id,
        message: "`--choose " + opts.choose + "` names no option — " + opts.resolves + " offers " + options.length,
        details: options.map((text, i) => "  " + (i + 1) + ". " + text),
      };
    }
    reason = options[opts.choose - 1];
    // A LOG EDITED BY HAND can hold an option this command may not record: the
    // two reserved words dressed as somebody's answer is the exact confusion
    // `isValidReason` exists to prevent, and `normalizeReason` below would turn
    // an empty one into `unknown` — a machine's word written as a person's.
    if (!isValidReason(reason)) {
      return {
        ok: false, kind: "unusable-option", id,
        message: "option " + opts.choose + " of " + opts.resolves + " cannot be recorded as a reason",
        details: [
          "It is empty, longer than 500 characters, or one of the two words the tool",
          "reserves for itself. Answer with `--reason \"…\"` instead.",
        ],
      };
    }
    chosen = { n: opts.choose, of: options.length, recommend: target.recommend || null };
  }

  const ts = new Date(now).toISOString();
  const decision = {
    id: eventId(ts), ts, task: id, field: FIELD_DECISION,
    from: "", to: reason,
    actor, source: "decide",
    reason: normalizeReason(reason),
    session: currentSession(root, opts.env),
  };
  // `resolves` is written only when it holds something: an empty key in every
  // row would make "answers nothing" and "answers a thing named nowhere" the
  // same shape on disk.
  if (opts.resolves) decision.resolves = opts.resolves;
  // `chose` is not a second copy of the answer — the answer is `to`. It records
  // WHICH row was taken, which is the only way a later review can ask how often
  // the recommendation was followed.
  if (chosen) decision.chose = chosen.n;
  appendEntries(root, id, [decision]);

  const after = entries.concat([decision]);
  // THE BLOCK IS LIFTED AS A CONSEQUENCE, not by a second command (TL-148). A
  // task stopped by `ask` carries a reason naming the question's id; answering
  // THAT question is what discharges the stop, so nobody has to remember a
  // follow-up write in exactly the situation where one would be forgotten.
  const lifted = liftQuestionBlock({ root, config, id, actor, entries: after, decision, now, paths });
  return {
    ok: true, id, decision, file: join(paths.historyDir, id + ".jsonl"),
    open: openQuestions(after), lifted, chosen,
  };
}

/**
 * Put a question-blocked task back where it came from, or leave it alone.
 *
 * THREE CONDITIONS, and each one is a way the answer might not be the answer:
 * this decision ANSWERS something (`--resolves`, not a note in passing); the
 * task stands in a protected status entered with a reason naming a question;
 * and after this answer no question on the task is open at all.
 *
 * WHY THE LAST ONE IS "NOTHING OPEN" AND NOT "IT ANSWERS THE NAMED QUESTION".
 * A session may ask twice, and the second `ask` changes no status — the task is
 * already stopped — so the reason in force still names the FIRST question.
 * Matching against that name would deadlock: answering the first would not lift
 * it (the second is open), and answering the second would not match. The set
 * being empty is the same rule seen from the other side, and it is the one that
 * stays true however many questions were asked. A decision naming some OTHER
 * event still leaves the task blocked, because the question it waits on is
 * still in that set.
 *
 * WHERE IT GOES BACK TO is read from the history, never chosen: `requeueStatus`
 * finds the `from` of the change that entered the blocking status. Restoring it
 * is undoing a transition, not making one.
 */
function liftQuestionBlock(ctx) {
  const { root, config, id, actor, entries, decision, now, paths } = ctx;
  if (!decision.resolves) return null;

  const records = readTaskRecords(paths.tasksDir, config.taskId.file);
  const record = records.find((t) => String(t.id).toUpperCase() === String(id).toUpperCase());
  if (!record) return null;
  const protectedOnes = new Set(
    (config.reasonRequiredStatuses || []).filter((s) => (config.archivedStatuses || []).indexOf(s) < 0)
  );
  if (!protectedOnes.has(record.status)) return null;

  // The reason of the LAST change into this status — that is the stop currently
  // in force. An older one described a block that was already lifted.
  let blockedOn = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e || e.field !== "status" || e.to !== record.status) continue;
    blockedOn = questionIdFromReason(e.reason);
    break;
  }
  if (!blockedOn) return null;
  if (openQuestions(entries).length) return null;

  const back = requeueStatus(config, entries, record.status);
  if (back.ambiguous) return { ambiguous: back.ambiguous };

  const file = join(paths.tasksDir, String(record.file).replace(/^tasks\//, ""));
  const raw = readFileSync(file, "utf8");
  const before = extractMeta(splitFrontmatter(raw).frontmatter);
  const specs = buildFieldSpecs(config);
  let text = setFrontmatterField(raw, "status", back.status, fieldSpec("status", specs));
  text = setFrontmatterField(text, "updated", todayStamp(now));
  writeFileSync(file, text, "utf8");
  const after = extractMeta(splitFrontmatter(text).frontmatter);
  // The REASON is the decision's own sentence: what lifted the block is what
  // was decided, and a row saying "unblocked" would lose it.
  recordEdit(root, {
    taskId: id, before, after, actor, ts: decision.ts, source: "decide", reason: decision.to,
  });
  return { from: record.status, to: back.status, question: blockedOn, source: back.from };
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
  // WHETHER THE RECOMMENDATION WAS TAKEN is printed, not left to be worked out:
  // it is the one thing about a picked answer that the option's text does not
  // already say.
  if (result.chosen) {
    const followed = result.chosen.recommend
      ? (result.chosen.n === result.chosen.recommend
          ? " — the one recommended"
          : " — the recommendation was " + result.chosen.recommend)
      : "";
    out.push("  chose option " + result.chosen.n + " of " + result.chosen.of + followed);
  }
  out.push(
    "  open questions left: " +
      (result.open.length ? String(result.open.length) : paint.ok("0"))
  );
  if (result.lifted && result.lifted.to) {
    out.push(
      "  " + paint.ok(MARK.ok) + " the block is lifted — " +
        result.lifted.from + " " + MARK.arrow + " " + result.lifted.to +
        (result.lifted.source === "history" ? " (where it came from)" : " (the only status it could go back to)")
    );
  } else if (result.lifted && result.lifted.ambiguous) {
    out.push(
      "  " + paint.warn(MARK.warn) + " the question is answered and the status was NOT changed: " +
        "this backlog has " + result.lifted.ambiguous.length + " statuses it could go back to"
    );
  }
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
      chose: result.decision.chose || null,
    },
    // `null` when the answer was typed rather than picked. The menu that was on
    // offer travels with it, so a consumer can show what was NOT chosen without
    // going back to the question's own event.
    chosen: result.chosen
      ? { n: result.chosen.n, of: result.chosen.of, recommend: result.chosen.recommend }
      : null,
    openQuestions: result.open.map((e) => ({
      id: e.id, ts: e.ts, text: e.to, actor: e.actor,
      options: e.options || [], recommend: e.recommend || null,
    })),
    // `null` when nothing was blocked on this answer — a consumer must be able
    // to tell "the queue is moving again" from "it never stopped".
    lifted: result.lifted && result.lifted.to
      ? { from: result.lifted.from, to: result.lifted.to, question: result.lifted.question }
      : null,
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
    choose: plan.choose,
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
