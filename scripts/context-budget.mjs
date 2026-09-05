#!/usr/bin/env node
/**
 * What an answer from this backlog COSTS a session, measured (TL-106).
 *
 * THE PROBLEM THIS IS THE ANSWER TO. The architecture is already right: nothing
 * of the backlog enters an agent's context until it reaches for it. But two
 * things break that, and until this module neither was written down anywhere:
 *
 *   1. **Looking for work scales linearly; the work does not.** The full
 *      pending list costs a fixed number of tokens per task. At forty tasks
 *      nobody notices; at four hundred, asking "what now" costs several times
 *      what doing the task costs.
 *   2. **The naive path is one keystroke away.** Reading `tasks/*.md` in bulk,
 *      or a broad grep over them, spends most of a context window before any
 *      work starts. A generated view is the same trap with a second edge: it is
 *      a snapshot of the last build, so it answers STALE — the reader pays a
 *      lot to be told something that may no longer be true.
 *
 * WHY THE NUMBERS ARE MEASURED AND NOT WRITTEN DOWN. A table of hardcoded costs
 * is correct on the day it is typed and teaches a falsehood ever after — the
 * same class of defect as a README describing somebody else's project. Every row
 * below is produced by RUNNING the command and measuring the answer, or by
 * measuring the files on disk. The table cannot go stale, because there is
 * nothing in it to go stale.
 *
 * TOKENS ARE AN ESTIMATE AND THE REPORT SAYS SO. Four characters per token is
 * the ratio for English prose across the common tokenizers; a real count needs
 * a specific model's tokenizer, which is a dependency this tool will not take on
 * to produce a number whose whole purpose is to be compared with another number
 * in the same column. The comparison is what carries: a path costing fifty times
 * another is fifty times more expensive under any tokenizer.
 *
 * ONE SOURCE FOR THE RULE. `CONTEXT_RULE` below is the text; `CLAUDE.md`, the
 * `context-budget` topic of `instructions` and the skill all draw on it rather
 * than restating it. Two documents saying the same thing are not redundancy,
 * they are two documents that will disagree.
 *
 * Tests: `node --test scripts/tests/context-budget.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { queueStatuses } from "./next-task.mjs";
import { backlogPaths } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, heading, table } from "./ui.mjs";

/**
 * The window every share in the report is a share OF.
 *
 * Named rather than assumed, because it is the one number here that is not
 * measured: context windows differ per model and change per release. It is a
 * REFERENCE, and the report prints it beside every percentage so a reader on a
 * different model can divide by their own.
 */
export const REFERENCE_WINDOW = 200_000;

/**
 * Above this share of the reference window, asking "what should I work on"
 * costs more than an ordinary session's whole answer, and `doctor` says so.
 *
 * Five per cent — 10,000 tokens — is not a hunch: an ordinary single-task
 * session on this tool costs roughly six thousand tokens end to end, so a
 * listing past this point has become the most expensive thing in the session,
 * and it is the part that buys the least. It is a constant rather than a
 * configuration key because it is a fact about how these models are used, not a
 * vocabulary of anybody's project.
 */
export const FULL_LIST_WARN_SHARE = 0.05;

/**
 * The rule, in the form it appears everywhere it appears.
 *
 * Kept SHORT deliberately: it rides along in every session that loads the
 * project's agent file, so every sentence is paid for on every run.
 */
export const CONTEXT_RULE = [
  `**Ask the backlog a question; do not read it.** \`${N} query\`, \`stats\``,
  "and `next` answer from the task files and cost what the answer is worth.",
  "Reading `tasks/*.md` in bulk, or grepping across them, spends most of a",
  "context window before any work starts.",
  "",
  "**A generated view is disqualified twice**: `INDEX.yaml` and the boards cost",
  "several times what `stats` costs AND answer from the last `build`, so a status",
  "changed a minute ago is invisible there — and the stale answer reads exactly",
  "like a real one.",
  "",
  "**Looking for work must not scale with the backlog.** Prefer `next` (one task,",
  "constant cost), then `--count` and `stats`; ask for the full list only with a",
  `filter narrow enough to act on. \`${N} stats --context\` prints what each`,
  "of those costs in THIS tree.",
];
// ──────────────────────────────────────────────────────────────────────────
// Measuring
// ──────────────────────────────────────────────────────────────────────────

/** Tokens, estimated at four characters each — see the header. PURE. */
export function estimateTokens(text) {
  return tokensFromChars(String(text == null ? "" : text).length);
}

/** The same estimate, for a length already known — a file's size on disk does
 *  not have to be read to be counted. PURE. */
export function tokensFromChars(chars) {
  return Math.round(Math.max(0, chars || 0) / 4);
}

/** The middle value, or the mean of the middle two. PURE. */
export function median(numbers) {
  const xs = [...numbers].sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/** Run one of our own commands and hand back what it printed. Injectable, so
 *  the arithmetic can be exercised without spawning a process. */
export function commandRunner(cliPath, root) {
  return (args) => {
    const r = spawnSync(process.execPath, [cliPath, ...args, "--dir", root], {
      encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
    });
    return String(r.stdout || "");
  };
}

/** The bytes of every task file, and of the generated index if one is there. */
export function taskFileSizes(tasksDir, taskFilePattern) {
  if (!existsSync(tasksDir)) return [];
  return readdirSync(tasksDir)
    .filter((f) => taskFilePattern.test(f))
    .map((f) => statSync(join(tasksDir, f)).size);
}

/**
 * The cost table for THIS tree. Every row is measured; nothing is assumed.
 *
 * The rows are ordered cheapest first, because that order is itself the
 * argument: the reader sees the answer they should be reaching for before the
 * one they should not.
 */
export function contextBudget({ root, config, run }) {
  const paths = backlogPaths(root);
  const sizes = taskFileSizes(paths.tasksDir, config.taskId.file);
  const queue = queueStatuses(config);
  const queueArgs = queue.length ? ["--status", queue.join(",")] : [];

  const rows = [];
  const add = (id, label, chars, note) => rows.push({
    id, label, tokens: tokensFromChars(chars), note: note || "",
  });

  // NOTHING HERE MAY WRITE. `next` is deliberately absent from the measured
  // rows although it is the cheapest path of all: running it would CLAIM a task,
  // and a diagnostic that reserves work as a side effect of being read is a far
  // worse defect than a missing row. What it costs is the median task file — it
  // hands over one task and nothing else — and the row below says so.
  add("count", `${N} query --count`, run(["query", ...queueArgs, "--count"]).length,
    "a number instead of hundreds of lines");
  add("stats", `${N} stats`, run(["stats"]).length,
    "the whole backlog on one screen");
  add("task", "one task file (median)", median(sizes),
    "what `" + N + " next` hands over, whatever the backlog's size — the only cost here that does not grow");
  add("list", `${N} query` + (queue.length ? " --status " + queue.join(",") : ""),
    run(["query", ...queueArgs]).length,
    "grows with every task added — this is the row that decides whether a large backlog works");

  if (existsSync(paths.indexPath)) {
    add("index", "INDEX.yaml (generated)", statSync(paths.indexPath).size,
      "and it answers from the last `" + N + " build`, so a change made since then is invisible");
  }
  add("tree", "every task file, read in bulk", sizes.reduce((a, b) => a + b, 0),
    "the naive path: a broad grep or a directory read costs this");

  const listTokens = (rows.find((r) => r.id === "list") || {}).tokens || 0;
  return {
    tasks: sizes.length,
    window: REFERENCE_WINDOW,
    rows: rows.map((r) => ({ ...r, share: r.tokens / REFERENCE_WINDOW })),
    // The one judgement in the whole report, and it is stated as a threshold
    // rather than as an opinion.
    listOverBudget: listTokens > REFERENCE_WINDOW * FULL_LIST_WARN_SHARE,
    listTokens,
    warnShare: FULL_LIST_WARN_SHARE,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────

const pct = (share) => (share * 100).toFixed(share < 0.01 ? 2 : 1) + "%";

export function renderBudget(budget) {
  const out = [heading(N + " stats --context — what an answer from this backlog costs")];
  out.push("  " + color.dim(
    "measured by running each command over " + budget.tasks + " task file(s); tokens estimated at " +
    "4 characters each, shares of a " + (budget.window / 1000) + "k window"
  ));
  out.push("");
  out.push(table(budget.rows.map((r) => [
    "  ", r.label, String(r.tokens) + " tok", pct(r.share), color.dim(r.note),
  ])));
  out.push("");
  out.push(budget.listOverBudget
    ? "  " + color.warn(MARK.warn) + " the full list is past " + pct(budget.warnShare) +
      " of the window — ask with `--count`, a filter, or `" + N + " next`"
    : "  " + color.ok(MARK.ok) + " the full list is still under " + pct(budget.warnShare) + " of the window");
  out.push("");
  for (const line of CONTEXT_RULE) out.push("  " + line);
  return out.join("\n");
}
