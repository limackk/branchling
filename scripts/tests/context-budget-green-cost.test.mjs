/**
 * Green gates have a context cost too (TL-249). The positive control is a
 * closed task whose one verification command prints many successful lines: a
 * fixed or empty transcript would make the new `done` row look measured while
 * proving nothing about its source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { contextBudget, tokensFromChars } from "../context-budget.mjs";
import { WORKER_SCOPE_ENV } from "../worker-scope.mjs";
import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("context-budget-green-cost");

const CLI = join(REPO_ROOT, "scripts", "cli.mjs");
let serial = 0;

function fixture(lines) {
  const repo = mkdtempSync(join(tmpdir(), "branchling-green-cost-" + serial++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], {
    encoding: "utf8", env: { ...process.env, [WORKER_SCOPE_ENV]: "" },
  });
  assert.equal(init.status, 0, init.stderr);
  const config = loadConfig(dir);
  const id = config.taskIdPrefix + "-1";
  const file = id + "-green-contract.md";
  writeFileSync(join(dir, "tasks", file), [
    "---",
    "id: " + id,
    'title: "Green contract"',
    "type: task",
    "labels: []",
    "board: main",
    'epic: ""',
    "priority: P1",
    "status: done",
    "owner: unassigned",
    "role: \"\"",
    "executor: \"\"",
    "estimate: 2h",
    "confidence: high",
    "created: 2026-09-01",
    "updated: 2026-09-01",
    "blocked_by: []",
    "blocks: []",
    "related_docs: []",
    "verification_placeholder: []",
    "---",
  ].join("\n").replace("verification_placeholder: []", [
    "verification:",
    "  - id: green",
    `    bash: \"yes x | head -n ${lines}\"`,
  ].join("\n")) + "\n\n## Acceptance criteria\n\n- [x] Green output. [proof: green]\n", "utf8");
  return { repo, dir, file };
}

function runner(dir) {
  return (args) => {
    const r = spawnSync(process.execPath, [CLI, ...args, "--dir", dir], {
      encoding: "utf8", timeout: 120_000,
      env: { ...process.env, NO_COLOR: "1", [WORKER_SCOPE_ENV]: "" },
    });
    assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
    return String(r.stdout || "");
  };
}

function budgetOf(dir) {
  return contextBudget({ root: dir, config: loadConfig(dir), run: runner(dir) });
}

const rowOf = (budget, id) => budget.rows.find((row) => row.id === id);

test("green done and check rows price their real output without changing the backlog", () => {
  const small = fixture(8);
  const large = fixture(80);
  try {
    const before = readFileSync(join(large.dir, "tasks", large.file), "utf8");
    const smallDone = rowOf(budgetOf(small.dir), "done");
    const largeBudget = budgetOf(large.dir);
    const largeDone = rowOf(largeBudget, "done");
    const check = rowOf(largeBudget, "check");

    assert.ok(smallDone && largeDone, "a closed task with a green contract must price `done`");
    assert.ok(largeDone.tokens > smallDone.tokens,
      "more green contract output must cost more than a fixed done row");
    assert.equal(check.tokens, tokensFromChars(runner(large.dir)(["check"]).length),
      "the check row must be the full output of `check`, not an estimate copied into the table");
    assert.deepEqual(largeBudget.rows.map((row) => row.tokens),
      [...largeBudget.rows].map((row) => row.tokens).sort((a, b) => a - b),
      "the new rows must stay in the table's cheapest-to-most-expensive order");
    assert.equal(readFileSync(join(large.dir, "tasks", large.file), "utf8"), before,
      "measuring a green done changed the closed task");
  } finally {
    rmSync(small.repo, { recursive: true, force: true });
    rmSync(large.repo, { recursive: true, force: true });
  }
});

test("stats --context --json carries the measured green rows", () => {
  const fx = fixture(12);
  try {
    const r = spawnSync(process.execPath, [CLI, "stats", "--context", "--json", "--dir", fx.dir], {
      encoding: "utf8", timeout: 120_000,
      env: { ...process.env, NO_COLOR: "1", [WORKER_SCOPE_ENV]: "" },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.ok(out.context.rows.some((row) => row.id === "done"));
    assert.ok(out.context.rows.some((row) => row.id === "check"));
  } finally {
    rmSync(fx.repo, { recursive: true, force: true });
  }
});
