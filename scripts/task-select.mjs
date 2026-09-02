#!/usr/bin/env node
/**
 * Selecting tasks: which ones match, and in what order (TL-87).
 *
 * WHY IT WAS EXTRACTED. `query` has answered "which tasks match these criteria"
 * since BL-1385, and `next` asks the SAME question — it just takes the first
 * answer and reserves it instead of printing the list. A second copy of the
 * filters would mean `query --status pending --priority P1` and `next --priority
 * P1` could disagree about the same tree, and the one that disagreed would be
 * the one nobody looks at: the dispatcher hands the task straight to an agent,
 * so a wrong answer there is discovered as work done on the wrong thing.
 *
 * WHAT STAYS OUT. Argument parsing, output shape and exit codes belong to the
 * commands — this module reads the tree and answers about it. The rule "is this
 * candidate executable" (its blockers closed) also stays out: that is `next`'s
 * question, and `query --status pending` is deliberately allowed to show a task
 * nobody can start yet.
 *
 * PURE apart from `readTaskRecords`, which is the one function that touches the
 * disk — so a filter can be tested without a tree.
 *
 * Tests: `node --test scripts/tests/next.test.mjs`
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { extractMeta } from "./task-fields.mjs";

/** The sort orders a caller may ask for. Exported so the CLI can list them in
 *  an error message instead of keeping its own copy of the names. */
export const SORT_KEYS = ["priority", "id", "id-desc"];

/** The filter axes. AND between axes, OR inside one. */
export const FILTER_AXES = [
  "status", "priority", "board", "label", "epic", "owner", "type", "role", "blockedBy",
];

/**
 * The subset of the frontmatter that work is chosen by.
 *
 * The PARSER is the shared one: a private copy here used to return
 * `epic: "\"   # free text — …"` for a task straight out of `new`, because it
 * stripped quotes but not the comment beside the field (TL-70).
 *
 * @returns {object|null} null when the file carries no frontmatter at all
 */
export function parseTaskRecord(raw, file) {
  // The block is located here rather than by `splitFrontmatter()` because that
  // one demands a body after the closing `---`, and a task file that is nothing
  // but frontmatter is still a task this selection has to see.
  const m = String(raw).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const meta = extractMeta(m[1]);
  // A missing field is "" here, not null: the filters compare strings and
  // `--owner ""` is a question nobody asks.
  const str = (v) => (v == null ? "" : v);
  return {
    id: str(meta.id),
    title: str(meta.title),
    status: str(meta.status),
    priority: str(meta.priority),
    board: str(meta.board),
    epic: str(meta.epic),
    owner: str(meta.owner),
    // WHO MAY take it, as opposed to `owner` — who holds it now (TL-97).
    role: str(meta.role),
    // WHICH SPECIES may take it (TL-113) — a different axis from `role`, which
    // is a competence. Empty means anybody.
    executor: str(meta.executor),
    type: str(meta.type),
    labels: meta.labels,
    blocked_by: meta.blocked_by,
    // The day the task was created. Read here because the time report needs the
    // start of a lead time (TL-27), and a report re-parsing the files a second
    // time would be a second answer to "what does this task say".
    created: str(meta.created),
    // The last day a command wrote to this file. Read here because a dispatcher
    // has to tell a claim that is being worked from one nobody came back to
    // (TL-104) — and because it is the only evidence of that in the tree.
    updated: str(meta.updated),
    // What a task says has to be read before it is started. Read here because
    // `docs-drift` asks the inverse question — which tasks name THIS document
    // (TL-100) — and that answer has to come from the same parse as every other
    // field, not from a second walk over the tree.
    related_docs: meta.related_docs,
    file: `tasks/${file}`,
    // What OTHER branches and worktrees say this task's status is, when they
    // disagree with the line above (TL-73). Filled in by the caller from
    // `branch-scan.mjs`; empty here, because this function parses ONE file and
    // must stay usable without a repository.
    elsewhere: [],
  };
}

/**
 * Every task in the tree, in filename order.
 *
 * @param {string} tasksDir
 * @param {RegExp} taskFile which filenames count as tasks — from the
 *        CONFIGURATION (`config.taskId.file`), never a constant here.
 */
export function readTaskRecords(tasksDir, taskFile) {
  return readdirSync(tasksDir)
    .filter((f) => taskFile.test(f))
    .map((f) => parseTaskRecord(readFileSync(join(tasksDir, f), "utf8"), f))
    .filter(Boolean);
}

/** `--priority P0,P1` → ["P0", "P1"]; an empty value → null ("no filter"). */
export function splitList(value) {
  return value ? String(value).split(",").map((x) => x.trim()).filter(Boolean) : null;
}

const anyOf = (values, actual) =>
  values.some((v) => v.toLowerCase() === String(actual || "").toLowerCase());

/** Every status this task is seen to have — the local one plus whatever the
 *  other branches say (TL-73). `--status in_progress` asked from `main` has to
 *  find a task another branch has already started; matching the local value
 *  alone is the one-checkout answer the scan exists to replace. */
const allStatuses = (t) => [t.status].concat((t.elsewhere || []).map((e) => e.status));

/**
 * @param {object[]} tasks
 * @param {object} f the axes from `splitList` (null = the axis is not filtered),
 *        plus `text` — a substring of "id title".
 * @param {Set<string>} archived which statuses count as closed; they are dropped
 *        UNLESS `--status` was given explicitly. In a backlog of any age most
 *        tasks are closed and would flood every answer.
 */
export function filterTasks(tasks, f, archived) {
  const closed = archived || new Set();
  return tasks.filter((t) => {
    // The ARCHIVED test stays on the local value alone. "Is this closed" is a
    // question about this tree's copy; letting another branch's `done` hide a
    // task from the default listing would be exactly the silent resolution this
    // module refuses to make.
    if (!f.status && closed.has(t.status)) return false;
    if (f.status && !allStatuses(t).some((s) => anyOf(f.status, s))) return false;
    if (f.priority && !anyOf(f.priority, t.priority)) return false;
    if (f.board && !anyOf(f.board, t.board)) return false;
    if (f.owner && !anyOf(f.owner, t.owner)) return false;
    if (f.type && !anyOf(f.type, t.type)) return false;
    // `role` is the ONE axis where the empty value is a question somebody asks:
    // "what is open to anybody". `[""]` is therefore a filter, not an absent one
    // — see how query.mjs builds it, which is why it cannot come from splitList.
    if (f.role && !anyOf(f.role, t.role)) return false;
    // Same treatment as `role`: `--executor ""` asks "what is open to either",
    // so the flag being present is what decides, not its value.
    if (f.executor && !anyOf(f.executor, t.executor)) return false;
    if (f.label && !f.label.some((l) => t.labels.includes(l))) return false;
    if (f.epic && !f.epic.some((e) => String(t.epic || "").toLowerCase().includes(e.toLowerCase()))) return false;
    if (f.blockedBy && !f.blockedBy.some((b) => t.blocked_by.includes(b))) return false;
    if (f.text && !(t.id + " " + t.title).toLowerCase().includes(String(f.text).toLowerCase())) return false;
    return true;
  });
}

/**
 * Sorts IN PLACE and returns the same array.
 *
 * The priority order is the order in `config.yaml` (`priorities`), not a table
 * of P0..P3 written here: a project may call them `now`/`later`, and a code
 * constant would sort somebody else's backlog by a scale it does not use.
 *
 * @param {string} key one of SORT_KEYS
 * @param {{priorities?: string[], taskIdPrefix?: string}} config
 */
export function sortTasks(tasks, key, config) {
  const cfg = config || {};
  const order = cfg.priorities || [];
  const rank = (p) => {
    const i = order.indexOf(p);
    return i < 0 ? order.length : i;
  };
  // The task number without the PROJECT prefix (TL-44). A hardcoded `^BL-`
  // gave 0 for every id under a different prefix, so `--sort id` arranged the
  // list in an order nobody asked for — and had no way of noticing.
  const idNum = new RegExp("^" + (cfg.taskIdPrefix || "") + "-");
  const num = (id) => Number(String(id || "").replace(idNum, "")) || 0;
  const sorters = {
    priority: (a, b) => rank(a.priority) - rank(b.priority) || num(a.id) - num(b.id),
    id: (a, b) => num(a.id) - num(b.id),
    "id-desc": (a, b) => num(b.id) - num(a.id),
  };
  if (!sorters[key]) throw new Error("unknown sort order: " + key);
  return tasks.sort(sorters[key]);
}
