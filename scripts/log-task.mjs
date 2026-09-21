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
import { backlogPaths, resolveBacklogDirOrExit } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  FIELD_COMMENT, FIELD_DECISION, REASON_SENTINELS,
  extractMeta, historyEntryKind, isPseudoField, isQuestion, openQuestions, splitFrontmatter,
} from "./task-fields.mjs";
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
      current.messages.push({
        id: String(e.id || ""),
        kind: messageKind(e),
        // `null` says: the reason above, verbatim. The id stays, because that
        // is what an answer points at.
        text: text && text === reason ? null : text,
      });
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
function headline(x) {
  let moved = x.changes.map(describeChange)
    .concat(x.events)
    .concat(x.messages.filter((m) => m.text || m.kind !== "comment").map((m) => m.kind));
  // Unless the comment is ALL there was. An exchange that moved no field is a
  // message and nothing else, and a row saying `—` above a paragraph would be
  // hiding the one thing that happened.
  if (!moved.length) moved = x.messages.map((m) => m.kind);
  return [
    "  ",
    color.dim(whenever(x.ts)),
    color.id(x.actor),
    x.source || "",
    moved.join("  " + MARK.bullet + " ") || "—",
  ];
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
    if (x.reason && !x.reserved) {
      for (const line of x.reason.split("\n")) out.push("      " + line);
    }
    for (const m of x.messages) {
      // A comment that only repeats the reason has already been printed; its id
      // is in `--json` for whoever needs to point at it.
      if (!m.text && m.kind === "comment") continue;
      out.push("      " + color.dim("[" + m.kind + " " + m.id + "]"));
      for (const line of (m.text || "").split("\n")) if (line) out.push("      " + line);
    }
  });
  if (model.limit && matched > model.exchanges.length) {
    out.push("");
    out.push("  " + color.dim("earlier exchanges: " + (matched - model.exchanges.length) +
      " — drop `--limit` to read them"));
  }
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The command
// ──────────────────────────────────────────────────────────────────────────

const KNOWN_WITH_VALUE = ["--dir", "--limit"];
const KNOWN_BARE = ["--json", "--decisions"];

export function parseLogArgs(argv) {
  const rest = [...argv];
  let id = null;
  let dir = null;
  let limit = null;
  let json = false;
  let decisions = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) {
      if (id) throw new Error("more than one task id: " + id + " and " + a);
      id = a;
      continue;
    }
    if (a === "--json") { json = true; continue; }
    if (a === "--decisions") { decisions = true; continue; }
    if (KNOWN_WITH_VALUE.indexOf(a) !== -1) {
      const value = rest[++i];
      if (value === undefined) throw new Error(a + " needs a value");
      if (a === "--dir") dir = value;
      else {
        limit = Number(value);
        if (!Number.isInteger(limit) || limit < 1) {
          throw new Error("--limit takes a whole number of exchanges, not `" + value + "`");
        }
      }
      continue;
    }
    throw new Error("unknown flag: " + a +
      "\navailable: --limit <n> --decisions --json --dir <path>");
  }
  if (!id) throw new Error("no task id\nusage: " + N + " log <ID> [--limit <n>] [--decisions] [--json]");
  return { id, dir, limit, json, decisions };
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

  const root = resolveBacklogDirOrExit({ dir: plan.dir || undefined, moduleDir: __dirname }, COMMAND).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

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
      printJson("task-log", {
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
  process.exit(run(process.argv.slice(2)));
}
