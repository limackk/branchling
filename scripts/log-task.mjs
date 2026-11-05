#!/usr/bin/env node
/**
 * log-task.mjs — a task's recorded exchanges, read back (TL-256).
 *
 * WHAT WAS MISSING. `history` RECORDS and nothing read. `query`, `stats` and
 * `next` answer from the task FILES, and a task file carries only the CURRENT
 * value of a field — never the reason it got there, which is the whole point of
 * moving the "why" out of `## Log` and into `backlog/history/<ID>.jsonl`
 * (TL-105). So the only way to see what a task had already decided was
 * `cat backlog/history/<ID>.jsonl`: the bulk read the context-economy rule
 * exists to prevent, and one whose cost grows with the number of events rather
 * than with the size of the answer.
 *
 * WHY A FOLD AND NOT A PRETTIER DUMP. The append-only log is written one entry
 * per FIELD, which is right for a log — each field's transition is a fact with
 * its own id, and nothing may ever be rewritten. It is wrong for a reader. One
 * handoff writes four entries — `status`, `owner`, `role` and a `__comment__` —
 * and the SAME reason, often a paragraph, is stored verbatim on all four.
 * Measured on TL-167: five handoffs inside nineteen records, so a session
 * reading the file to find one answer paid for the same paragraph four times
 * over. Printing those nineteen rows in a nicer typeface would not have moved
 * the number this task is about. So the unit of the ANSWER is the EXCHANGE —
 * one write, one actor, one reason — with the fields that moved listed beside
 * it and the reason printed once.
 *
 * HOW AN EXCHANGE IS RECOGNISED. Consecutive entries agreeing on `ts`, `actor`,
 * `source`, `session`, `role` and `reason` came from one write. CONSECUTIVE and
 * not "grouped by key" on purpose: grouping would let two writes that happen to
 * agree on all six collapse across the events between them, which would rewrite
 * the order of a conversation — and order is the only thing a log has.
 *
 * WHAT IS NOT REPEATED. A `__comment__` or `__decision__` whose text is exactly
 * the exchange's reason is the reason again; it keeps its id, because that id is
 * what `decide --resolves` has to name, and its text comes back `null`, which
 * the contract reads as "the reason above, verbatim".
 *
 * NOTHING HERE WRITES. A read of an append-only log is a read; the log is still
 * never rewritten, and a `reason` a person wrote is still their sentence.
 *
 * Tests: `node --test scripts/tests/log-read.test.mjs`
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { findTaskFile } from "./done-task.mjs";
import { historyPath, readHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { explain, modifiedFiles, repoRoot, touches } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  FIELD_BODY, FIELD_COMMENT, FIELD_DECISION, REASON_SENTINELS,
  describeBodyChange, extractMeta, historyEntryKind, isPseudoField, isQuestion, openQuestions, splitFrontmatter,
} from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { decisionsOf } from "./decisions.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMAND = N + " log";

// ──────────────────────────────────────────────────────────────────────────
// The fold — pure, so it can be exercised without a directory
// ──────────────────────────────────────────────────────────────────────────

/** The six fields that identify ONE write. See the header. */
const SAME_WRITE = ["ts", "actor", "source", "session", "role", "reason"];

function sameWrite(a, b) {
  return SAME_WRITE.every((k) => String(a[k] || "") === String(b[k] || ""));
}

/** Which kind of message an entry carries, for a reader that has to tell a
 *  question from an answer without parsing punctuation. */
function messageKind(entry) {
  if (entry.field === FIELD_DECISION) return "decision";
  return isQuestion(entry) ? "question" : "comment";
}

/**
 * The exchanges of one task's history, newest LAST — the order the log has.
 * PURE.
 *
 * @param {object[]} entries what `readHistory` returned
 * @returns {Array<{ts: string, actor: string, source: string, session: string|null,
 *   role: string|null, reason: string|null, reserved: boolean,
 *   changes: Array<{field: string, from: string, to: string}>,
 *   events: string[], messages: Array<{id: string, kind: string, text: string|null}>}>}
 */
export function foldExchanges(entries) {
  const out = [];
  for (const e of entries || []) {
    if (!e || !e.field) continue;
    const reason = String(e.reason || "");
    let current = out.length ? out[out.length - 1] : null;
    if (!current || !sameWrite(current.__key, e)) {
      current = {
        __key: e,
        ts: String(e.ts || ""),
        actor: String(e.actor || ""),
        source: String(e.source || ""),
        session: e.session ? String(e.session) : null,
        role: e.role ? String(e.role) : null,
        reason: reason || null,
        // A sentinel is a machine's answer, not somebody's sentence, and a
        // reader deciding whether to quote it must not have to know the two
        // words by heart.
        reserved: REASON_SENTINELS.indexOf(reason) !== -1,
        changes: [],
        events: [],
        messages: [],
      };
      out.push(current);
    }
    const kind = historyEntryKind(e);
    if (e.field === FIELD_COMMENT || e.field === FIELD_DECISION) {
      const text = String(e.to || "");
      const message = {
        id: String(e.id || ""),
        kind: messageKind(e),
        // `null` says: the reason above, verbatim. The id stays, because that
        // is what an answer points at.
        text: text && text === reason ? null : text,
      };
      // A path grant belongs to the handoff event, not to the field rows it
      // happened to move. Keep it beside that message so both log renderings
      // expose the structured record without parsing the reason.
      if (Array.isArray(e.files) && e.files.length) message.files = e.files.slice();
      // A question carries the menu its asker offered (TL-536), as `ask --json`
      // and `resume --json` already do: a reader offering the choices must not
      // have to open the raw log to find them.
      if (message.kind === "question") {
        message.options = Array.isArray(e.options) ? e.options.map(String) : [];
        message.recommend = Number.isInteger(e.recommend) ? e.recommend : null;
      }
      current.messages.push(message);
    } else if (e.field === FIELD_BODY) {
      // A body rewrite (TL-523) is shown by its size, never by its text, and
      // not as a field transition: two 71-character hashes with an arrow
      // between them say nothing a reader can use.
      current.events.push(describeBodyChange(e, MARK.arrow));
    } else if (isPseudoField(e.field) && kind !== "transition") {
      current.events.push(String(e.field).replace(/^__|__$/g, "") +
        (e.to ? ": " + String(e.to) : ""));
    } else {
      current.changes.push({
        field: String(e.field).replace(/^__|__$/g, ""),
        from: String(e.from || ""),
        to: String(e.to || ""),
      });
    }
  }
  for (const x of out) delete x.__key;
  return out;
}

/**
 * The exchanges that SETTLED something, plus the ones still waiting to be
 * settled. PURE (TL-396).
 *
 * WHY THIS LIVES ON `log` AND NOT ON `decide`. `decide --help` advertised
 * `decide <ID> [--json]` as "the decision and what remains unanswered, for a
 * program", and the command refused it: with no `--reason` it has nothing to
 * record, which is a usage error, not a request to read. Making the absence of
 * a flag select a READING mode is worse than the `history --show` that TL-256
 * already rejected — a `--reason` dropped by a shell would stop refusing and
 * start printing, exit 0, with nothing written. So the promise is kept on the
 * command that reads.
 *
 * WHAT IS KEPT, and why both halves. A `__decision__` is the answer; a
 * `__comment__` asked as a question and pointed at by nothing is the part that
 * is still open — "what remains unanswered" is not a separate report, it is the
 * same list seen before its other half arrives. An ANSWERED question is left
 * out: its text is in the decision that resolves it, and the full log is one
 * flag away.
 *
 * @param {object[]} exchanges what `foldExchanges` returned
 * @param {object[]} entries the raw history — `openQuestions` needs the pairs
 */
export function onlyDecisions(exchanges, entries) {
  const open = new Set(openQuestions(entries).map((e) => String(e.id || "")));
  return (exchanges || []).filter((x) =>
    (x.messages || []).some((m) => m.kind === "decision" || (m.kind === "question" && open.has(m.id))));
}

/**
 * The keys every ledger record is answered with, in this order (TL-562). A
 * record written before one of them existed answers it as `null`, so a program
 * never has to tell "no value" from "an older line".
 */
export const LEDGER_KEYS = ["id", "ts", "field", "from", "to", "actor", "source", "reason"];

/**
 * One ledger record as `--records` answers it. PURE.
 *
 * NOTHING IS DROPPED OR RENAMED. The point of the mode is the keys no fold
 * renders — `contractCapability` on a closing transition, `vouch` on a
 * `__verified__` entry, `refusal` on an `__unverified__` one, and whatever a
 * later writer adds — so every key the line carries comes back with its value,
 * after the common ones.
 */
export function ledgerRecord(entry) {
  const out = {};
  for (const key of LEDGER_KEYS) out[key] = entry && entry[key] !== undefined ? entry[key] : null;
  for (const [key, value] of Object.entries(entry || {})) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────

/** `2026-09-04T13:21:03.816Z` → `2026-09-04 13:21` — to the minute, because a
 *  millisecond is an implementation detail of the id, not of the exchange. */
function whenever(ts) {
  const m = String(ts || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? m[1] + " " + m[2] : String(ts || "");
}

function describeChange(c) {
  if (!c.from) return c.field + " " + MARK.arrow + " " + (c.to || "(empty)");
  if (!c.to) return c.field + ": " + c.from + " " + MARK.arrow + " (empty)";
  return c.field + ": " + c.from + " " + MARK.arrow + " " + c.to;
}

/**
 * One exchange's headline cells, for the aligned table.
 *
 * A `comment` carrying nothing but the reason is left OFF the row: the reason
 * is printed under it, and naming the entry as well would put the same fact on
 * the screen twice — the defect this command exists to remove. A question or a
 * decision stays, because it has an id somebody has to be able to name.
 */
function exchangeActions(x) {
  let moved = x.changes.map(describeChange)
    .concat(x.events)
    .concat(x.messages.filter((m) => m.text || m.kind !== "comment" || (m.files || []).length).map((m) => m.kind));
  // Unless the comment is ALL there was. An exchange that moved no field is a
  // message and nothing else, and a row saying `—` above a paragraph would be
  // hiding the one thing that happened.
  if (!moved.length) moved = x.messages.map((m) => m.kind);
  return moved.join("  " + MARK.bullet + " ") || "—";
}

function headline(x) {
  return [
    "  ",
    color.dim(whenever(x.ts)),
    color.id(x.actor),
    x.source || "",
    exchangeActions(x),
  ];
}

function renderExchangeDetails(out, x) {
  if (x.reason && !x.reserved) {
    for (const line of x.reason.split("\n")) out.push("      " + line);
  }
  for (const m of x.messages) {
    if (!m.text && m.kind === "comment" && !(m.files || []).length) continue;
    out.push("      " + color.dim("[" + m.kind + " " + m.id + "]"));
    for (const line of (m.text || "").split("\n")) if (line) out.push("      " + line);
    for (const file of m.files || []) out.push("      may change: " + color.id(file));
  }
}

export function renderLog(model) {
  const out = [heading(model.id + (model.title ? " — " + model.title : ""))];
  if (!model.records) {
    out.push("  " + model.id + " has no recorded history — nothing has been written to " +
      model.path + " yet.");
    return out.join("\n");
  }
  const matched = Number.isInteger(model.matched) ? model.matched : model.total;
  out.push("  " + color.dim(
    model.records + " record(s) folded into " + model.total + " exchange(s)" +
    (model.decisions
      ? ", " + matched + " carrying a decision or an open question"
      : "") +
    (model.limit && matched > model.exchanges.length
      ? ", the newest " + model.exchanges.length + " shown"
      : "") +
    " — " + model.path
  ));
  out.push("");
  // NOTHING DECIDED IS AN ANSWER, and it has to be said rather than shown as an
  // empty screen: a reader who cannot tell "no decisions" from "the filter
  // broke" has to go and read the whole log to find out, which is the cost this
  // command exists to remove.
  if (model.decisions && !model.exchanges.length) {
    out.push("  " + model.id + " has recorded no decision and carries no open question.");
    return out.join("\n");
  }
  // The headlines are aligned against EACH OTHER, so the times, the actors and
  // the sources form columns a reader can scan down. That means one `table`
  // call over every row, cut back into lines afterwards — a table per row would
  // align each row with itself and nothing else.
  const rows = table(model.exchanges.map(headline)).split("\n");
  model.exchanges.forEach((x, i) => {
    out.push(rows[i]);
    // THE REASON, ONCE. It is the sentence the whole command exists to hand
    // back, so it is on its own line under the row that names what moved, and
    // it is printed once however many fields carried it.
    renderExchangeDetails(out, x);
  });
  if (model.limit && matched > model.exchanges.length) {
    out.push("");
    out.push("  " + color.dim("earlier exchanges: " + (matched - model.exchanges.length) +
      " — drop `--limit` to read them"));
  }
  return out.join("\n");
}

/** One value on one line, cut where it would push the row off a terminal. */
function oneLine(value, max = 60) {
  // A list field records its value as an array; `String([])` is the empty
  // string, which would print a transition from nothing.
  const shown = Array.isArray(value) ? "[" + value.join(", ") + "]"
    : value !== null && typeof value === "object" ? JSON.stringify(value)
    : value;
  const text = String(shown === null || shown === undefined ? "" : shown).replace(/\s*\n\s*/g, " ");
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * The ledger, record by record (TL-562). Unlike `renderLog` this does NOT fold:
 * it is the mode a reader asks for when the fold is what is in the way, so every
 * record has its own row, named by its id. The keys beyond the common ones are
 * NAMED here and given whole by `--json` — a verdict object printed inline
 * would bury the rows it belongs to.
 */
export function renderLedger(model) {
  const out = [heading(model.id + (model.title ? " — " + model.title : ""))];
  if (!model.total) {
    out.push("  " + model.id + " has no recorded history — nothing has been written to " +
      model.path + " yet.");
    return out.join("\n");
  }
  out.push("  " + color.dim(
    model.total + " record(s)" +
    (model.omitted ? ", the newest " + model.records.length + " shown" : "") +
    " — " + model.path
  ));
  out.push("");
  const rows = table(model.records.map((r) => [
    "  ", color.dim(whenever(r.ts)), color.id(String(r.id || "(no id)")), color.id(String(r.actor || "")),
    String(r.source || ""),
    String(r.field || "") + ": " + (oneLine(r.from) ? oneLine(r.from) + " " + MARK.arrow + " " : "") + (oneLine(r.to) || "(empty)"),
  ])).split("\n");
  model.records.forEach((r, i) => {
    out.push(rows[i]);
    if (r.reason) out.push("      reason: " + oneLine(r.reason, 160));
    const extra = Object.keys(r).filter((k) => LEDGER_KEYS.indexOf(k) === -1 && k !== "task");
    if (extra.length) out.push("      " + color.dim("also: " + extra.join(", ")));
  });
  if (model.omitted) {
    out.push("");
    out.push("  " + color.dim("earlier records: " + model.omitted + " — drop `--limit` to read them"));
  }
  return out.join("\n");
}

/** Decisions carried by every task whose commits touched one file or directory. */
export function renderAreaLog(model) {
  const out = [heading("decisions for " + model.modifiedFile.path)];
  const whyEmpty = explain(model.modifiedFile.reason);
  if (whyEmpty) {
    out.push("  " + whyEmpty + ".");
    return out.join("\n");
  }
  out.push("  " + color.dim(
    model.tasks.length + " task(s) touched this area; " + model.matched +
    " decision or open question exchange(s) found" +
    (model.limit && model.matched > model.exchanges.length
      ? ", the newest " + model.exchanges.length + " shown"
      : "")
  ));
  if (!model.exchanges.length) {
    out.push("");
    out.push("  No decision or open question is recorded for a task that touched this area.");
    return out.join("\n");
  }
  out.push("");
  const rows = table(model.exchanges.map((x) => [
    "  ", color.dim(whenever(x.ts)), color.id(x.task.id), color.id(x.actor),
    x.source || "", exchangeActions(x),
  ])).split("\n");
  model.exchanges.forEach((x, i) => {
    out.push(rows[i]);
    renderExchangeDetails(out, x);
  });
  if (model.limit && model.matched > model.exchanges.length) {
    out.push("");
    out.push("  " + color.dim("earlier exchanges: " + (model.matched - model.exchanges.length) +
      " — drop `--limit` to read them"));
  }
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

const KNOWN_WITH_VALUE = ["--limit", "--modified-file"];
const KNOWN_BARE = ["--json", "--decisions", "--open-questions", "--records"];

export function parseLogArgs(argv) {
  const taken = takeDirFlag(argv, { missing: "--dir needs a value" });
  const rest = taken.argv;
  let id = null;
  let dir = taken.dir;
  let limit = null;
  let json = false;
  let decisions = false;
  let modifiedFile = null;
  let openQuestionsWanted = false;
  let recordsWanted = false;
  let literal = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!literal && a === "--") { literal = true; continue; }
    if (literal || !a.startsWith("--")) {
      if (id) throw new Error("more than one task id: " + id + " and " + a);
      id = a;
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--decisions") { decisions = true; continue; }
    if (a === "--open-questions") { openQuestionsWanted = true; continue; }
    if (a === "--records") { recordsWanted = true; continue; }
    if (KNOWN_WITH_VALUE.indexOf(a) !== -1) {
      const value = rest[++i];
      if (value === undefined) throw new Error(a + " needs a value");
      if (a === "--modified-file") modifiedFile = value;
      else {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit takes a whole number of " + (rest.indexOf("--records") !== -1 ? "records" : "exchanges") +
            ", not `" + value + "`");
        }
      }
      continue;
    }
    throw new Error("unknown flag: " + a +
      "\navailable: --limit <n> --decisions --records --modified-file <path> --open-questions --json --dir <path>");
  }
  // The backlog-wide listing is its own question (TL-536): a task id, an area
  // or a slice would each narrow it to a different one, so none is accepted.
  if (openQuestionsWanted) {
    if (id || modifiedFile || decisions || recordsWanted || limit !== null) {
      throw new Error("`--open-questions` lists every open question in the backlog, and takes no task id, " +
        "--modified-file, --decisions, --records or --limit");
    }
    return { id: null, dir, limit: null, json, decisions: false, modifiedFile: null, openQuestions: true, records: false };
  }
  // The raw ledger is one task's records unfolded (TL-562). A filter that
  // keeps only decisions, or an area spanning several tasks, would each make it
  // a different answer that still looked like the whole ledger.
  if (recordsWanted) {
    if (decisions || modifiedFile) {
      throw new Error("`--records` returns every record of one task, and takes neither --decisions nor --modified-file");
    }
    if (!id) throw new Error("no task id\nusage: " + N + " log <ID> --records [--limit <n>] [--json]");
    return { id, dir, limit, json, decisions: false, modifiedFile: null, openQuestions: false, records: true };
  }
  if (id && modifiedFile) throw new Error("a task id and `--modified-file` select two different scopes");
  if (!id && !modifiedFile) throw new Error("no task id or modified file\nusage: " + N + " log <ID> [--limit <n>] [--decisions] [--json]");
  if (modifiedFile !== null && !modifiedFile) throw new Error("`--modified-file` needs a non-empty path");
  if (modifiedFile && !decisions) {
    throw new Error("`--modified-file` reads decisions by area and requires `--decisions`");
  }
  return { id, dir, limit, json, decisions, modifiedFile, openQuestions: false, records: false };
}

/**
 * Every question still waiting on a person, across the ACTIVE tasks, oldest
 * first (TL-536). An archived task's unanswered question is waiting on nobody:
 * the work it was asked about has ended.
 *
 * One call instead of `query` plus one `log --decisions` per task — the screen
 * a person opens to answer questions must not slow down as the backlog grows.
 */
export function openQuestionsAcross(root, config) {
  const archived = new Set(config.archivedStatuses || []);
  const questions = [];
  for (const task of readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file)) {
    if (archived.has(task.status)) continue;
    for (const q of decisionsOf(readHistory(root, task.id))) {
      if (q.answered) continue;
      questions.push({
        task: task.id, title: task.title || null, status: task.status || null,
        priority: task.priority || null,
        event: q.id, question: q.question, askedBy: q.askedBy, askedAt: q.askedAt,
        options: q.options, recommend: q.recommend,
      });
    }
  }
  questions.sort((a, b) => a.askedAt.localeCompare(b.askedAt) || a.task.localeCompare(b.task));
  return { root, total: questions.length, questions };
}

/** The text form of the listing. PURE. */
export function renderOpenQuestions(model) {
  if (!model.questions.length) return color.ok(MARK.ok) + " no open questions — nothing in this backlog is waiting on an answer";
  const out = [model.questions.length + " open question" + (model.questions.length === 1 ? "" : "s") + ":", ""];
  for (const q of model.questions) {
    out.push("  " + q.task + "  " + (q.title || "") );
    out.push("    " + q.question);
    q.options.forEach((o, i) => out.push("      " + (i + 1) + ". " + o + (q.recommend === i + 1 ? "  (recommended)" : "")));
    out.push("    asked by " + q.askedBy + " at " + whenever(q.askedAt) + " — answer with: " +
      N + " decide " + q.task + " --resolves " + q.event + (q.options.length ? " --choose <n>" : " --reason \"…\""));
    out.push("");
  }
  return out.join("\n").replace(/\n$/, "");
}

function areaLog(root, config, plan) {
  const paths = backlogPaths(root);
  const index = modifiedFiles({ root: repoRoot(root), prefix: config.taskIdPrefix });
  const tasks = readTaskRecords(paths.tasksDir, config.taskId.file)
    .filter((task) => touches(index.byTask.get(task.id) || new Set(), plan.modifiedFile))
    .map((task) => ({ id: task.id, title: task.title || null, file: task.file || null }));
  const exchanges = [];
  let records = 0;
  let total = 0;
  for (const task of tasks) {
    const entries = readHistory(root, task.id);
    const all = foldExchanges(entries);
    const kept = onlyDecisions(all, entries);
    records += entries.length;
    total += all.length;
    for (const exchange of kept) exchanges.push({ ...exchange, task });
  }
  exchanges.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) ||
    String(a.task.id).localeCompare(String(b.task.id)));
  const matched = exchanges.length;
  const shown = plan.limit ? exchanges.slice(Math.max(0, exchanges.length - plan.limit)) : exchanges;
  return {
    ok: true,
    id: null, title: null, file: null, path: null,
    records, total, matched, decisions: true, limit: plan.limit,
    exchanges: shown, tasks,
    modifiedFile: { path: plan.modifiedFile, scanned: index.scanned, reason: index.reason },
  };
}

export function run(argv) {
  let plan;
  try {
    plan = parseLogArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(COMMAND, head, rest, [N + " log --help"]));
    return 2;
  }

  const root = resolveBacklogDirOrExit({
    dir: plan.dir || undefined, moduleDir: __dirname,
    jsonKind: plan.json ? (plan.openQuestions ? "open-questions" : plan.records ? "task-ledger" : "task-log") : null,
  }, COMMAND).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  if (plan.openQuestions) {
    const model = openQuestionsAcross(root, config);
    if (plan.json) printJson("open-questions", model);
    else console.log(renderOpenQuestions(model));
    return 0;
  }

  if (plan.modifiedFile) {
    const model = areaLog(root, config, plan);
    if (plan.json) printJson("task-log", model);
    else console.log(renderAreaLog(model));
    return 0;
  }

  const file = findTaskFile(paths.tasksDir, config, plan.id);
  const logFile = historyPath(root, String(plan.id).toUpperCase());
  // A LOG WITHOUT A TASK FILE IS STILL AN ANSWER. The log outlives the file it
  // describes — a deleted or renamed task leaves its record behind, and that is
  // the one case where nothing else in the tool can say what happened. Only
  // when NEITHER exists is there no such task to talk about.
  if (!file && !existsSync(logFile)) {
    const problem = "there is no task " + plan.id + " in " + paths.tasksDir +
      ", and no history under " + relative(root, logFile);
    if (plan.json) {
      printJson(plan.records ? "task-ledger" : "task-log", {
        ok: false, id: plan.id, refusalKind: "no-such-task", refusal: problem, details: [],
      });
    } else {
      console.error(failure(COMMAND, problem, [], [N + " query --text " + plan.id]));
    }
    return 1;
  }

  let title = null;
  let id = String(plan.id).toUpperCase();
  if (file) {
    const meta = extractMeta(splitFrontmatter(readFileSync(file, "utf8")).frontmatter);
    title = meta.title || null;
    id = meta.id || id;
  }

  const entries = readHistory(root, id);
  if (plan.records) {
    // THE NEWEST ARE KEPT, as for exchanges, and the count left behind is part
    // of the answer: a slice must never read as the whole ledger.
    const shown = plan.limit ? entries.slice(Math.max(0, entries.length - plan.limit)) : entries;
    const ledger = {
      ok: true, id, title, file, path: relative(root, logFile),
      total: entries.length, limit: plan.limit, omitted: entries.length - shown.length,
      records: shown.map(ledgerRecord),
    };
    if (plan.json) printJson("task-ledger", ledger);
    else console.log(renderLedger(ledger));
    return 0;
  }
  const all = foldExchanges(entries);
  // THE FILTER RUNS BEFORE THE SLICE. `--limit 3 --decisions` means the three
  // newest DECISIONS; slicing first would hand back three exchanges of which
  // none need be one.
  const kept = plan.decisions ? onlyDecisions(all, entries) : all;
  // THE NEWEST ARE THE ONES KEPT. `--limit` exists for the context budget, and
  // a session asking what was decided is asking about the last thing decided.
  const exchanges = plan.limit ? kept.slice(Math.max(0, kept.length - plan.limit)) : kept;
  const model = {
    id, title, file, path: relative(root, logFile),
    records: entries.length, total: all.length, matched: kept.length,
    exchanges, limit: plan.limit, decisions: plan.decisions,
  };

  if (plan.json) {
    printJson("task-log", {
      ok: true, id, title, file, path: model.path,
      records: model.records, total: model.total, matched: model.matched,
      decisions: plan.decisions, limit: plan.limit, exchanges,
    });
    return 0;
  }
  console.log(renderLog(model));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("log-task.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
