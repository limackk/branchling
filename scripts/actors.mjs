#!/usr/bin/env node
/**
 * `actors` — an actor's record, computed from the log (TL-150).
 *
 * WHAT IT ADDS UP. `history/<ID>.jsonl` already records who moved which task
 * where, so "how much of what this actor closed came back" is an aggregation
 * and not a number anybody has to keep. Nothing new is written and nothing new
 * is kept (law 2): delete the report and it computes again from the same log.
 *
 * FOUR RULES, EACH OF WHICH IS A WAY THE TABLE WOULD OTHERWISE LIE:
 *
 *   1. **It does not re-derive rework.** `audit` (TL-90) decides what a
 *      reopening is and charges it to whoever CLOSED the task, not to whoever
 *      noticed. This calls `reopenedAfterClosing` and `reworkRates` rather than
 *      folding the log a second time — two folds would eventually disagree
 *      about the same week, and a reader would have nothing to tell them which
 *      of the two is lying.
 *   2. **A namespace is the identity, a nickname is not.** `local:anna` is a
 *      declaration and `user:anna` is an authentication; folding them is the
 *      lie the namespace rule exists to prevent. An actor with no namespace at
 *      all is the shape the log had before TL-21 and becomes ONE row, labelled
 *      `legacy`. `unknown` keeps its own row: "nobody had namespaces yet" and
 *      "we do not know who did this" are different claims.
 *   3. **A rate needs a denominator that is stated.** Below `min_report_n`
 *      closings a row carries its count and no rate at all — `null`, because
 *      `0` reads as "everything came back" and `1` as "nothing did", and "too
 *      few to say" is not an answer about quality. The rate printed here is the
 *      share that STUCK, which is one minus the rework rate `audit` prints.
 *   4. **A routing is not a refusal.** `handoff` writes the same block whether
 *      an actor said "this does not fit a session of mine" or "this fits, and
 *      the next stage is another hand's" — the difference is whether the role
 *      changed (TL-271). Only the first counts among the handbacks; counting
 *      the second would report a working two-hand pipeline as an actor who
 *      keeps giving work back.
 *
 * THE POLICY IS OPT-IN AND DISJOINT FROM SELECTION ORDER. A project may declare
 * that work above a stated priority is not handed to an actor whose record is
 * below a stated threshold. That is a filter on ELIGIBILITY: it removes
 * candidates and never reorders the survivors, because the order is the
 * dispatcher's and is tested there. Declared in the project layer only (law 3)
 * — a person who raised their own threshold would see a different queue in
 * the same repository. The default is no policy, and then this command is a report.
 *
 * Exit: 0 = reported, 2 = the invocation was wrong. It is not a gate.
 *
 * Tests: `node --test scripts/tests/actor-record.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { reopenedAfterClosing, reworkRates } from "./audit.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { FIELD_COMMENT, readAllHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const FLAGS = ["--since", "--json", "--dir"];

/**
 * The one row every entry written before namespaces existed lands in. A word
 * rather than a namespace: it names an era of the log rather than a way of
 * being identified, so it can never be confused with `local:`, `agent:` or
 * `user:`.
 */
export const LEGACY_ACTOR = "legacy";

export const USAGE = [
  `${N} actors [--since <YYYY-MM-DD>] [--json] [--dir <path>]`,
  "",
  "  Per actor, from the history log alone: how much they closed, how much of it",
  "  stuck on the first attempt, how much came back, and how often they handed a",
  "  task back rather than working it.",
  "",
  "    closings     transitions into a closed status, charged to whoever made them",
  "    first pass   closings that were never reopened afterwards",
  "    reopened     closings that came back, taken from `audit` rather than counted",
  "                 a second time",
  "    handed back  handoffs that did NOT change the role. One that did is a",
  "                 routing to the next stage, not a refusal (TL-271)",
  "",
  "  --since <date>  count only what the log recorded on or after this day. An",
  "                  actor with no closing left inside the window has no row at",
  "                  all: a row of zeroes states a record they do not have here",
  "  --json          the same rows for a program",
  "",
  "  A NAMESPACE IS THE IDENTITY. `local:anna` and `user:anna` are two rows: one",
  "  is a declaration, the other an authentication. An entry with no namespace at",
  "  all predates them and lands in `legacy`; `unknown` keeps its own row, because",
  "  a change the tool observed is not an old change.",
  "",
  "  A bucket with fewer than `min_report_n` closings reports its count and NO",
  "  rate. THIS IS NOT A JUDGEMENT OF ANYBODY'S WORK: it exists to find a process",
  "  that keeps producing rework, and a number about a named actor is read as a",
  "  number about a person unless it says otherwise.",
  "",
  "  exit: 0 reported, 2 the invocation was wrong. It is a report, not a gate.",
].join("\n");

// --------------------------------------------------------------------------
// Arguments - PURE
// --------------------------------------------------------------------------

export function parseActorsArgs(args) {
  let since = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { json = true; continue; }
    if (a === "--since") {
      since = args[++i];
      if (!since) throw new Error("`--since` with no date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
        throw new Error("`--since " + since + "` is not a date\nthe shape is YYYY-MM-DD, the same one `created:` uses");
      }
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    throw new Error("unexpected argument: " + a + "\nevery criterion is a flag");
  }
  return { since, json };
}

// --------------------------------------------------------------------------
// The record - PURE
// --------------------------------------------------------------------------

/** The day an entry was written; the log carries a full timestamp, `--since` a day. */
const day = (e) => String((e && e.ts) || "").slice(0, 10);

/** The log, with every entry older than the window dropped. */
function narrow(history, since) {
  const out = {};
  for (const id of Object.keys(history || {})) {
    const kept = (history[id] || []).filter((e) => day(e) >= since);
    if (kept.length) out[id] = kept;
  }
  return out;
}

/**
 * The row an actor belongs in.
 *
 * `unknown` is tested FIRST: it is the reserved sentinel for a change the tool
 * observed rather than made, and it carries no namespace, so a plain "does it
 * have one" test would sweep it into `legacy` and lose the distinction.
 */
export function actorRow(actor) {
  const raw = String(actor || "").trim();
  if (!raw || raw === "unknown") return "unknown";
  return raw.indexOf(":") > 0 ? raw : LEGACY_ACTOR;
}

/**
 * How many times each actor handed a task back rather than working it.
 *
 * One handoff is a BLOCK of entries written under `source: "handoff"` at one
 * timestamp: the field changes, then the comment. The block is the unit,
 * because counting entries would count a single handoff three times over, and
 * whether it changed the role is read off that same block (TL-271).
 */
function handbacks(history) {
  const counts = new Map();
  for (const id of Object.keys(history || {})) {
    const blocks = new Map();
    for (const e of history[id] || []) {
      if (!e || e.source !== "handoff") continue;
      const key = String(e.actor || "") + " " + String(e.ts || "");
      if (!blocks.has(key)) blocks.set(key, { actor: e.actor, stated: false, routed: false });
      const block = blocks.get(key);
      if (e.field === FIELD_COMMENT) block.stated = true;
      if (e.field === "role" && String(e.from || "") !== String(e.to || "")) block.routed = true;
    }
    for (const block of blocks.values()) {
      // A block with no comment states no judgement, and a block that moved the
      // role is a routing. Neither of them counts among the handbacks.
      if (!block.stated || block.routed) continue;
      const key = actorRow(block.actor);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Every actor the log records a closing for, with their record. PURE.
 *
 * THE ROWS ARE THE ACTORS WHO CLOSED. An actor with no closing in the window gets no
 * row even when the log holds other entries for them there: every column below
 * is about work that was declared finished, and a row of zeroes would state a
 * record that has been earned neither way.
 *
 * @param {{history: object, config: object, since?: string|null}} input
 * @returns {{rows: object[], since: string|null, minReportN: number}}
 */
export function actorRecords({ history, config, since = null }) {
  const windowed = since ? narrow(history, since) : (history || {});
  const minN = config.minReportN;
  const { byActor } = reopenedAfterClosing(windowed, { archived: config.archivedStatuses || [] });
  const backs = handbacks(windowed);

  // `audit`'s own table, folded onto the rows this report keys by. The counts
  // come from there; only the folding and the share that stuck are worked out
  // here.
  const merged = new Map();
  for (const audited of reworkRates(byActor, minN)) {
    const key = actorRow(audited.actor);
    if (!merged.has(key)) merged.set(key, { actor: key, closings: 0, reopened: 0 });
    const row = merged.get(key);
    row.closings += audited.closings;
    row.reopened += audited.reopens;
  }

  const rows = [...merged.values()]
    .map((row) => {
      const enough = row.closings >= minN;
      const firstPass = row.closings - row.reopened;
      return {
        ...row,
        firstPass,
        handbacks: backs.get(row.actor) || 0,
        // The share that STUCK. `audit` reports the share that came back, and
        // printing the two the same way round would be the easiest way there is
        // to misread a table about people.
        rate: enough ? Math.round((firstPass / row.closings) * 1000) / 1000 : null,
        enough,
      };
    })
    // Sorted by closings, then by actor: a table whose order depends on the
    // order of readdir() is a table two machines disagree about.
    .sort((a, b) => b.closings - a.closings || a.actor.localeCompare(b.actor));

  return { rows, since: since || null, minReportN: minN };
}

// --------------------------------------------------------------------------
// The policy - PURE
// --------------------------------------------------------------------------

const percent = (r) => Math.round(r * 100) + "%";

/**
 * The queue, minus what this actor's record withholds from them. PURE.
 *
 * IT ONLY REMOVES. What comes back is the queue with entries filtered out, the
 * same objects in the same order, because eligibility and ordering are
 * different decisions and the second one belongs to the dispatcher.
 *
 * FOUR WAYS IN WHICH NOTHING IS WITHHELD, each a rule rather than a shortcut: no
 * policy declared; an actor the log has never seen, because silence is not
 * evidence of a bad record and otherwise no first task above the priority would
 * ever be handed out; a record too small for the report to state a rate for,
 * which is too small to take work away from somebody on; and a record at or
 * above the threshold.
 *
 * @param {object[]} queue the candidates, in the dispatcher's order
 * @param {{row: object|null, policy: object, minReportN: number}} opts
 * @returns {{candidates: object[], withheld: Array<{id: string, priority: string, reason: string}>}}
 */
export function applyActorPolicy(queue, { row, policy, minReportN }) {
  const tasks = queue || [];
  const named = new Set((policy && policy.priorities) || []);
  const bar = Number((policy && policy.minFirstPass) || 0);
  if (!named.size || !(bar > 0)) return { candidates: tasks, withheld: [] };
  if (!row || !row.enough || typeof row.rate !== "number") return { candidates: tasks, withheld: [] };
  if (row.closings < minReportN) return { candidates: tasks, withheld: [] };
  if (row.rate >= bar) return { candidates: tasks, withheld: [] };

  const candidates = [];
  const withheld = [];
  for (const t of tasks) {
    const priority = String(t.priority || "");
    if (!named.has(priority)) { candidates.push(t); continue; }
    withheld.push({
      id: t.id,
      priority,
      // A withholding nobody can read the reason for is indistinguishable from
      // an empty queue, which is the one thing a dispatcher may never look like.
      reason: row.actor + ": " + percent(row.rate) + " first pass over " + row.closings +
        " closing(s), below the " + percent(bar) + " this project asks for at priority `" +
        priority + "`",
    });
  }
  return { candidates, withheld };
}

// --------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------

export function render(report) {
  const window = report.since ? "since " + report.since : "the whole log";
  const out = [heading(N + " actors: " + report.rows.length + " actor(s), from " + window)];
  out.push("");
  if (!report.rows.length) {
    out.push("  " + color.dim("no closing is recorded in this log, so there is no record to compute yet"));
  } else {
    out.push(table([["   ", "actor", "closings", "first pass", "reopened", "handed back"]].concat(
      report.rows.map((r) => [
        "   ",
        r.actor,
        String(r.closings),
        r.enough ? percent(r.rate) : "n=" + r.closings + ", too few",
        String(r.reopened),
        String(r.handbacks),
      ])
    )));
  }
  out.push("");
  out.push("  " + color.dim(
    "A rate is stated only from " + report.minReportN + " closings upwards; below that the count stands alone."
  ));
  out.push("  " + color.dim(MARK.bullet + " Read from the history log. Not a judgement of anybody's work."));
  return out.join("\n");
}

// --------------------------------------------------------------------------
// The run
// --------------------------------------------------------------------------

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseActorsArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " actors", head, rest, [`${N} actors --help`]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " actors", e.message, [], [`${N} actors --dir <path>`]));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const report = actorRecords({ history: readAllHistory(root), config, since: opts.since });

  if (opts.json) {
    printJson("actors", {
      since: report.since,
      minReportN: report.minReportN,
      rows: report.rows,
      policy: config.actorPolicy,
    });
    return 0;
  }
  console.log(render(report));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("actors.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
