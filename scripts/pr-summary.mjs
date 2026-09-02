#!/usr/bin/env node
/**
 * `pr-summary` — what this branch did to the BACKLOG, for a reviewer (TL-89).
 *
 * WHAT IT IS FOR. A pull request shows the code diff. It does not show which
 * tasks the branch touched, which statuses moved, or who moved them — and that
 * is the half of the change a reviewer cannot reconstruct from the diff. Only a
 * tool whose tasks travel with the branch can answer it without integrating
 * with somebody else's tracker (Law 1), which is why this command exists here
 * and not as a service.
 *
 * WHERE THE INTELLIGENCE LIVES. All of it here, none of it in the CI job. The
 * GitHub Action in `examples/` is checkout, run, comment — a script over a
 * stable output rather than a plugin (Law 4), so the same command works
 * unchanged in GitLab CI, in a hook, or in a terminal. `--json` exists for the
 * same reason.
 *
 * THE TWO SOURCES, and both are git rather than a view:
 *
 *   which tasks    `git diff --name-only <base>...HEAD -- <tasks dir>`. A
 *                  computed view would answer for whatever was last rebuilt,
 *                  which on CI is nothing at all.
 *   what happened  the lines ADDED to `history/*.jsonl` in the same range. The
 *                  log is append-only, so an added line is exactly an event this
 *                  branch created — no timestamp arithmetic, no guessing which
 *                  entries are new.
 *
 * WHAT IT REFUSES TO INVENT. A section with no data does not appear as zeros:
 * no engaged-time measurement means no time section, and `--cost` on a backlog
 * that records no tokens says so rather than printing a nought. The cost
 * information is opt-in because the comment lands somewhere public and token
 * counts, model names and amounts are facts about the author's spend and stack,
 * not about the change.
 *
 * Exit: 0 = summarised (including "no tasks") · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/pr-summary.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { readAllActivity } from "./activity.mjs";
import { engagedReport } from "./cluster.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { actorParts } from "./task-fields.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { failure } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const FLAGS = ["--base", "--cost", "--json", "--dir"];

export const USAGE = [
  `${N} pr-summary [--base <ref>] [--cost] [--json] [--dir <path>]`,
  "",
  "  Markdown on stdout: the tasks this branch touched, the status transitions it",
  "  made, and who made them. Written to be pasted or posted as a pull-request",
  "  comment — the reviewer sees the backlog diff beside the code diff.",
  "",
  "  --base <ref>  what to compare against; default `main`. The range is",
  "                `<base>...HEAD`, so it is what THIS branch did, not what",
  "                happened on the base meanwhile",
  "  --cost        include token counts, model names and amounts. OFF by default:",
  "                the comment lands somewhere public, and those are facts about",
  "                the author's spend and stack rather than about the change",
  "  --json        the same summary for a program",
  "",
  "  It talks to nothing. The CI job is checkout, run, comment — see",
  "  examples/pr-summary.yml. A branch that touched no task says so outright",
  "  rather than producing an empty comment.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parsePrSummaryArgs(args) {
  let base = "main";
  let cost = false;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--cost") { cost = true; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--base") {
      base = args[++i];
      if (!base) throw new Error("`--base` with no ref");
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    throw new Error("unexpected argument: " + a + "\nthe branch is the one you are on; `--base` says what to compare it against");
  }
  return { base, cost, json };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading the range — PURE parsers, so a test needs no repository
// ──────────────────────────────────────────────────────────────────────────

/**
 * The tasks a range touched, out of `git diff --name-status`.
 *
 * TWO THINGS COME FROM GIT AND NOT FROM THE HISTORY LOG, deliberately. The id
 * comes from the FILENAME, because a task DELETED on this branch has no file
 * left to open and leaving it out would hide the change a reviewer most needs
 * to see. And whether the task was OPENED here comes from git's `A`, not from a
 * `__created__` entry — `new` writes no history entry at all, so a summary that
 * waited for one would silently miss every task somebody opened while working.
 *
 * @returns {Array<{id: string, change: "added"|"removed"|"changed"}>}
 */
export function changedTasks(nameStatus, prefix) {
  const pat = taskIdPatterns(prefix);
  const byId = new Map();
  for (const raw of String(nameStatus || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    // `A\tpath`, `M\tpath`, `D\tpath`, and for a rename `R100\told\tnew`.
    const parts = line.split("\t");
    const code = parts[0][0];
    const path = parts[parts.length - 1];
    const name = path.split("/").pop();
    if (!name) continue;
    const m = name.match(pat.fileId);
    if (!m || !pat.file.test(name)) continue;
    const change = code === "A" ? "added" : code === "D" ? "removed" : "changed";
    // A rename shows the NEW path; the id is the same either way, and a task
    // renamed and edited in one range is one row, not two.
    if (!byId.has(m[1]) || byId.get(m[1]) === "changed") byId.set(m[1], change);
  }
  return [...byId.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, change]) => ({ id, change }));
}

/**
 * The history entries this branch ADDED.
 *
 * `git diff --unified=0` over the log directory, and every `+` line that parses
 * as JSON is an event. This works because the log is append-only: an added line
 * cannot be an edit of an older one, so "added in this range" and "happened on
 * this branch" are the same set. Comparing timestamps instead would need a
 * clock everybody agrees on, which a distributed history does not have.
 */
export function addedHistoryEntries(diff) {
  const byTask = new Map();
  for (const line of String(diff || "").split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    let entry;
    try { entry = JSON.parse(line.slice(1)); } catch { continue; }
    if (!entry || !entry.task) continue;
    if (!byTask.has(entry.task)) byTask.set(entry.task, []);
    byTask.get(entry.task).push(entry);
  }
  for (const list of byTask.values()) list.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return byTask;
}

/**
 * Who made the changes, counted by NAMESPACE rather than by name.
 *
 * The question a reviewer is asking is "how much of this did a person decide",
 * and the namespace is the only part of an actor that answers it: `agent:` is
 * automated, `local:` is declared and unverified, `user:` is authenticated.
 * Counting by name would put two of somebody's machines in different columns
 * and tell nobody anything.
 */
export function actorShare(entries) {
  const byNamespace = new Map();
  for (const e of entries || []) {
    const ns = actorParts(e.actor).namespace || "unknown";
    byNamespace.set(ns, (byNamespace.get(ns) || 0) + 1);
  }
  return [...byNamespace.entries()].sort((a, b) => b[1] - a[1]).map(([namespace, count]) => ({ namespace, count }));
}

/**
 * One task's story on this branch. PURE.
 *
 * @param {"added"|"removed"|"changed"} change what git says happened to the FILE
 */
export function summarizeTask(id, entries, task, change = "changed") {
  const list = entries || [];
  return {
    id,
    title: (task && task.title) || null,
    status: (task && task.status) || null,
    estimate: (task && task.estimate) || null,
    // A task the branch opened is a different fact from one it moved, and a
    // reviewer reads the two differently. Taken from git rather than from a
    // `__created__` entry, which `new` does not write.
    created: change === "added" || list.some((e) => e.field === "__created__"),
    deleted: change === "removed" || list.some((e) => e.field === "__deleted__"),
    transitions: list
      .filter((e) => e.field === "status")
      .map((e) => ({
        from: e.from || "", to: e.to || "", actor: e.actor || "",
        reason: e.reason || "", source: e.source || "",
      })),
    // A `manual:` entry somebody vouched for is the one part of a closing
    // contract a machine did not check, so it is named rather than counted.
    vouched: list.filter((e) => e.field === "__verified__").map((e) => ({ command: e.to || "", actor: e.actor || "" })),
    changes: list.length,
    actors: actorShare(list),
  };
}

/**
 * The engaged time this backlog has measured for these tasks, or `null`.
 *
 * `null` and not zero: nothing measured and nothing worked are different
 * answers, and a zero in a pull request comment reads as the second.
 */
export function engagedFor(root, ids, env = process.env) {
  let rows;
  try { rows = readAllActivity(root, env); } catch { return null; }
  const wanted = {};
  for (const id of ids) if (rows[id] && rows[id].length) wanted[id] = rows[id];
  if (!Object.keys(wanted).length) return null;
  const report = engagedReport(wanted);
  if (!report.tasks.length) return null;
  return report;
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────

/** GitHub renders a pipe inside a table cell as a column break. */
const cell = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/**
 * The sources that mean the tool SAW a change rather than made it: `external`
 * is what reconciliation writes, `manual` is `history --source manual`, `boot`
 * is the first snapshot. Everything else is a command, and there `unknown`
 * means "nobody stated a reason" — a different sentence entirely.
 *
 * Listed rather than inverted, and the fallback is deliberately the milder
 * reading: a source this list has not heard of is reported as an unstated
 * reason, never as a change made behind the tool's back.
 */
const OBSERVED_SOURCES = ["external", "manual", "boot"];

export function transitionLine(t) {
  const arrow = "`" + (t.from || "(new)") + "` → `" + (t.to || "(none)") + "`";
  const who = t.actor ? " — " + cell(t.actor) : "";
  // `proven` and `unknown` are the tool's OWN words, not anybody's sentence:
  // printed raw they read as a reason somebody gave. They are spelled out, and
  // `unknown` is spelled out two different ways depending on the source.
  const why = t.reason === "proven" ? " — verification passed"
    : t.reason === "unknown"
      ? (OBSERVED_SOURCES.indexOf(t.source) >= 0 ? " — changed outside the tool" : " — no reason stated")
      : t.reason ? " — " + cell(t.reason) : "";
  return "- " + arrow + who + why;
}

/**
 * The comment. PURE — a test asserts the text without a repository.
 *
 * Deliberately narrow markdown: headings, a table, bullet lists and inline
 * code. No HTML, no nested tables, no collapsible blocks — a comment that
 * renders differently in a GitLab merge request or in a terminal pager is a
 * comment that has to be checked in three places.
 */
export function renderMarkdown(model) {
  const out = [];
  out.push("## " + N + " — the backlog on this branch");
  out.push("");

  if (!model.scanned) {
    out.push("_" + model.reason + "_");
    return out.join("\n") + "\n";
  }
  if (!model.tasks.length) {
    // Said outright rather than left as an empty comment: a reviewer must be
    // able to tell "no task changed" from "the job did not run".
    out.push("No task changed between `" + model.base + "` and this branch.");
    return out.join("\n") + "\n";
  }

  out.push("| Task | Status | Moved | Changes | Who |");
  out.push("|---|---|---|---|---|");
  for (const t of model.tasks) {
    const moved = t.transitions.length
      ? t.transitions.map((x) => (x.from || "(new)") + " → " + (x.to || "(none)")).join(", ")
      : "—";
    const who = t.actors.map((a) => a.namespace + " " + a.count).join(", ") || "—";
    out.push("| `" + t.id + "` " + cell(t.title || "") + " | " + cell(t.status || "—") +
      " | " + cell(moved) + " | " + t.changes + " | " + cell(who) + " |");
  }
  out.push("");

  for (const t of model.tasks) {
    if (!t.transitions.length && !t.vouched.length && !t.created && !t.deleted) continue;
    out.push("### `" + t.id + "` " + cell(t.title || ""));
    if (t.created) out.push("- opened on this branch");
    if (t.deleted) out.push("- **removed** on this branch");
    for (const tr of t.transitions) out.push(transitionLine(tr));
    for (const v of t.vouched) {
      out.push("- vouched for by " + cell(v.actor) + ": `" + cell(v.command) + "` — a person stood behind this, no command checked it");
    }
    out.push("");
  }

  if (model.engaged) {
    out.push("### Measured effort");
    out.push("");
    out.push("| Task | Estimate | Engaged |");
    out.push("|---|---|---|");
    for (const row of model.engaged.tasks) {
      const task = model.tasks.find((t) => t.id === row.task);
      out.push("| `" + row.task + "` | " + cell((task && task.estimate) || "—") + " | " + row.minutes + " min |");
    }
    out.push("");
    if (model.engaged.unknownRatio > 0.3) {
      out.push("_" + Math.round(model.engaged.unknownRatio * 100) +
        "% of that time could not be attributed to a task, so read it as an upper bound._");
      out.push("");
    }
  }

  if (model.cost) {
    // `--cost` was asked for and there is nothing to answer with. Saying so is
    // the point: a silent omission is indistinguishable from a zero cost.
    out.push("### Cost");
    out.push("");
    out.push("_" + model.cost.reason + "_");
    out.push("");
  }

  out.push("<sub>" + N + " pr-summary · read from the task files and the history log on this branch</sub>");
  return out.join("\n") + "\n";
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

function git(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 128 * 1024 * 1024 });
}

/** @returns {{scanned: boolean, reason: string, base: string, tasks: object[], engaged: object|null, cost: object|null}} */
export function buildSummary({ root, config, base, cost, run = git }) {
  const repo = repoRoot(root);
  const empty = { scanned: false, base, tasks: [], engaged: null, cost: null };
  if (!repo) {
    return { ...empty, reason: "not a git repository — a branch summary has no range to read" };
  }
  const paths = backlogPaths(root);
  const tasksRel = relative(repo, paths.tasksDir) || ".";
  const historyRel = relative(repo, paths.historyDir) || ".";

  const range = base + "...HEAD";
  const names = run(repo, ["diff", "--name-status", range, "--", tasksRel]);
  if (names.status !== 0) {
    return {
      ...empty,
      reason: "`git diff " + range + "` failed — is `" + base + "` a ref this clone has? " +
        "On CI a shallow checkout often does not.",
    };
  }
  const changed = changedTasks(names.stdout, config.taskIdPrefix);
  const ids = changed.map((c) => c.id);

  const diff = run(repo, ["diff", "--unified=0", range, "--", historyRel]);
  const byTask = diff.status === 0 ? addedHistoryEntries(diff.stdout) : new Map();

  const current = new Map();
  for (const id of ids) {
    const file = findTaskFile(paths.tasksDir, id, config);
    current.set(id, file ? readTaskHead(file) : null);
  }

  const tasks = changed.map((c) => summarizeTask(c.id, byTask.get(c.id), current.get(c.id), c.change));
  return {
    scanned: true,
    reason: "ok",
    base,
    tasks,
    engaged: engagedFor(root, ids),
    // The section exists only when it was ASKED for; its content is whatever
    // the backlog actually recorded, which today is nothing anywhere.
    cost: cost
      ? { reason: "this backlog records no token counts, so there is no cost to report", tokens: null, amount: null, model: null }
      : null,
  };
}

/** The file a task id names, or `null` — a task DELETED on this branch has none,
 *  and that is a state to report rather than an error. */
function findTaskFile(tasksDir, id, config) {
  const pat = taskIdPatterns(config.taskIdPrefix);
  let names;
  try { names = readdirSync(tasksDir); } catch { return null; }
  const name = names.find((f) => pat.file.test(f) && f.startsWith(id + "-"));
  return name ? join(tasksDir, name) : null;
}

/** Title, status and estimate out of one task file, without a YAML parser —
 *  the same three lines every other reader takes this way. */
function readTaskHead(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return null; }
  const get = (key) => {
    const m = text.match(new RegExp("^" + key + ":\\s*(.+?)\\s*$", "m"));
    return m ? m[1].replace(/\s+#.*$/, "").replace(/^"|"$/g, "") : null;
  };
  return { title: get("title"), status: get("status"), estimate: get("estimate") };
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parsePrSummaryArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " pr-summary", head, rest, [`${N} pr-summary --help`]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " pr-summary", e.message, [], [`${N} pr-summary --dir <path>`]));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const model = buildSummary({ root, config, base: opts.base, cost: opts.cost });

  if (opts.json) {
    printJson("pr-summary", {
      base: model.base,
      scanned: model.scanned,
      reason: model.reason,
      tasks: model.tasks,
      engaged: model.engaged,
      cost: model.cost,
    });
    return 0;
  }
  process.stdout.write(renderMarkdown(model));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("pr-summary.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
