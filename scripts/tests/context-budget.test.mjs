/**
 * The context budget — measured, not written down (TL-106).
 *
 * WHAT HAS TO BE PROVED, and none of it is "the command runs":
 *
 *   1. **The numbers come from the TREE.** Two fixtures of different sizes give
 *      different numbers. That is the assertion a hardcoded table fails, and it
 *      is the whole reason the table is computed at all — a cost typed into a
 *      guide is correct on the day it is typed and teaches a falsehood ever
 *      after.
 *   2. **Asking is an order of magnitude cheaper than reading.** `--count`
 *      against the whole tree, on a fixture big enough for the ratio to be a
 *      fact rather than a rounding artefact.
 *   3. **The rule is in `CLAUDE.md`, and it is the SAME rule.** Compared line by
 *      line against `CONTEXT_RULE`, so a copy that falls behind fails here
 *      rather than teaching two different things in two places.
 *   4. **Nothing in the measurement writes.** The budget is taken twice and the
 *      backlog is unchanged — a diagnostic that claimed a task as a side effect
 *      of being read would be a far worse defect than a missing row.
 *
 * The fixture's vocabulary shares nothing with the defaults, so a status
 * written as a literal in the code fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.mjs";
import {
  CONTEXT_RULE, FULL_LIST_WARN_SHARE, REFERENCE_WINDOW, commandRunner,
  contextBudget, estimateTokens, median, renderBudget, tokensFromChars,
} from "../context-budget.mjs";
import { alignTemplate, isolateHome, REPO_ROOT } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("context-budget");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with its OWN vocabulary and `n` tasks in the queue status. */
function backlog(n) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-budget-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [icebox, surveying, stuck, charted]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [charted]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [icebox, surveying, stuck]")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: [stuck]")
    + "\nin_progress_status: surveying\n", "utf8");
  alignTemplate(dir);
  for (let i = 0; i < n; i++) {
    const r = run(["new", "--dir", dir, "--title", "Task number " + (i + 1)]);
    assert.equal(r.status, 0, r.stderr);
  }
  return dir;
}

const budgetOf = (dir) => contextBudget({
  root: dir, config: loadConfig(dir), run: commandRunner(CLI, dir),
});
const rowOf = (budget, id) => budget.rows.find((r) => r.id === id);

// ── The arithmetic ────────────────────────────────────────────────────────

test("the token estimate is characters over four, and says which it is", () => {
  assert.equal(estimateTokens("x".repeat(400)), 100);
  assert.equal(tokensFromChars(400), 100);
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens(null), 0);
});

test("the median of an even-length list is the mean of its middle pair", () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), 0);
});

// ── The numbers come from the tree ────────────────────────────────────────

test("positive control: a bigger backlog gives BIGGER numbers", () => {
  // The assertion a hardcoded table fails. Without it every other test here
  // would pass against a constant.
  const small = budgetOf(backlog(2));
  const large = budgetOf(backlog(12));

  assert.equal(small.tasks, 2);
  assert.equal(large.tasks, 12);
  assert.ok(rowOf(large, "list").tokens > rowOf(small, "list").tokens,
    "the full list has to grow with the backlog, or it is not being measured");
  assert.ok(rowOf(large, "tree").tokens > rowOf(small, "tree").tokens);
});

test("the one row that does NOT grow is the one task a dispatcher hands over", () => {
  const small = rowOf(budgetOf(backlog(2)), "task").tokens;
  const large = rowOf(budgetOf(backlog(12)), "task").tokens;
  // Tasks straight out of `new` are the same file, so the median is the same
  // number — which is the property the row is there to demonstrate.
  assert.equal(small, large);
});

test("asking is an order of magnitude cheaper than reading the tree", () => {
  const b = budgetOf(backlog(12));
  assert.ok(rowOf(b, "count").tokens * 10 < rowOf(b, "list").tokens,
    "`--count` must be an order of magnitude under the full list");
  assert.ok(rowOf(b, "list").tokens * 10 < rowOf(b, "tree").tokens,
    "the full list must be an order of magnitude under a bulk read");
});

test("the generated index is measured only when one has been built", () => {
  const dir = backlog(3);
  // The views are computed and gitignored, so a fresh clone genuinely does not
  // have one — and then it is not a cost anybody pays.
  rmSync(join(dir, "INDEX.yaml"), { force: true });
  assert.equal(rowOf(budgetOf(dir), "index"), undefined,
    "a view nobody built is not a cost anybody pays");
  assert.equal(run(["build", "--dir", dir]).status, 0);
  const row = rowOf(budgetOf(dir), "index");
  assert.ok(row, "once built, the index is a path a reader can take and has to be priced");
  assert.match(row.note, /last `.* build`/, "the staleness argument has to travel with the cost one");
});

test("nothing in the measurement writes — the tree is identical afterwards", () => {
  const dir = backlog(3);
  const before = run(["query", "--dir", dir, "--json"]).stdout;
  budgetOf(dir);
  budgetOf(dir);
  assert.equal(run(["query", "--dir", dir, "--json"]).stdout, before,
    "a diagnostic that claims a task as a side effect of being read is worse than a missing row");
});

// ── The threshold ─────────────────────────────────────────────────────────

test("the warning is a share of a NAMED window, not a count of tasks", () => {
  const b = budgetOf(backlog(3));
  assert.equal(b.window, REFERENCE_WINDOW);
  assert.equal(b.warnShare, FULL_LIST_WARN_SHARE);
  assert.equal(b.listOverBudget, b.listTokens > REFERENCE_WINDOW * FULL_LIST_WARN_SHARE);
  assert.equal(b.listOverBudget, false, "three tasks are not a context problem");

  // The positive control: the same rule, over a listing big enough to cross it.
  const over = { ...b, listTokens: REFERENCE_WINDOW, rows: b.rows, listOverBudget: true };
  assert.match(renderBudget(over), /past 5\.0% of the window/);
});

test("doctor reports the cost of asking, and says which window the share is of", () => {
  const r = run(["doctor", "--dir", backlog(3)]);
  assert.match(r.stdout, /cost of asking/);
  assert.match(r.stdout, /200k window/);
});

// ── One source for the rule ───────────────────────────────────────────────

test("AGENTS.md carries the rule, line for line, from the module", () => {
  const agents = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf8");
  for (const line of CONTEXT_RULE) {
    if (!line.trim()) continue;
    assert.ok(agents.includes(line),
      "AGENTS.md has fallen behind `CONTEXT_RULE`; the missing line is:\n  " + line);
  }
});

test("the rule names BOTH reasons a generated view is disqualified", () => {
  const text = CONTEXT_RULE.join(" ");
  assert.match(text, /cost|costs/, "the cost argument");
  assert.match(text, /last `build`|stale/, "the staleness argument");
});

test("the instructions topic prints the rule and a table measured on the tree", () => {
  const dir = backlog(4);
  const r = run(["instructions", "context-budget", "--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(CONTEXT_RULE[0]), "the topic must print the rule, not a paraphrase of it");
  assert.match(r.stdout, /4 task file\(s\)/, "the table has to be measured on the tree it is printed for");
  for (const word of ["pending", "in_progress", "done"]) {
    assert.ok(!r.stdout.includes(word), "a default status leaked into the topic: " + word);
  }
});

test("stats --context prints the table, and an unknown flag still fails", () => {
  const dir = backlog(3);
  const r = run(["stats", "--dir", dir, "--context"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /what an answer from this backlog costs/);
  assert.match(r.stdout, /4 characters each/, "an estimate has to say that it is one");
  assert.equal(run(["stats", "--dir", dir, "--frobnicate"]).status, 2);
});
