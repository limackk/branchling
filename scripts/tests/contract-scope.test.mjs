/**
 * A run spends a task's failure budget only on failures attributable to that
 * task (TL-242).
 *
 * THE BASELINE IS PART OF THE CONTRACT. A whole-suite entry can already be red
 * when a task is claimed because another task's specification deliberately
 * left its proof failing. If this task's own entry passes and the suite still
 * reports only that pre-existing failure after the hand works, retrying the
 * hand cannot change the relevant fact: the red belongs to the tree it took.
 * The run must name that ending, keep the claim, and spend no second attempt.
 *
 * THE POSITIVE CONTROL INTRODUCES AN OWN FAILURE. It starts from the identical
 * foreign-red tree, then the hand turns this task's targeted entry from green
 * to red. That task still exhausts its configured attempts and is parked with
 * a reason naming the entry. Without this control, an implementation that
 * excuses every red suite would satisfy the regression case.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("contract-scope");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...env },
    ...opts,
  });
}

function shellScript(path, body) {
  writeFileSync(path, "#!/bin/sh\nset -eu\n" + body + "\n", "utf8");
  chmodSync(path, 0o755);
  return path;
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks"))
    .find((name) => name.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function runHistory(backlog, id) {
  const path = join(backlog, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean)
    .map((line) => JSON.parse(line)).filter((entry) => entry.source === "run");
}

function invocationCount(path) {
  return existsSync(path) ? Number(readFileSync(path, "utf8").trim()) : 0;
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-contract-scope-"));
  const repo = join(dir, "repo");
  const backlog = join(repo, "backlog");
  const tests = join(repo, "contract-tests");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  mkdirSync(tests, { recursive: true });

  let r = cli(["init", "--dir", backlog, "--no-example"], env, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  r = cli(["new", "--dir", backlog, "--title", "Scoped contract", "--priority", "P1"], env, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  assert.ok(id, "the fixture did not create a task id");

  const ownTest = join(tests, "current.test.cjs");
  writeFileSync(ownTest,
    'const test = require("node:test");\n' +
    'const assert = require("node:assert/strict");\n' +
    'test("this task", () => assert.equal(1, 1));\n', "utf8");
  writeFileSync(join(tests, "foreign.test.cjs"),
    'const test = require("node:test");\n' +
    'const assert = require("node:assert/strict");\n' +
    'test("foreign deliberate red", () => assert.fail("foreign proof is still red"));\n', "utf8");

  const file = taskFile(backlog, id);
  const raw = readFileSync(file, "utf8");
  writeFileSync(file, raw
    .replace(/verification:[\s\S]*?\n---/, [
      "verification:",
      "  - id: own-entry",
      '    bash: "node --test contract-tests/current.test.cjs"',
      "  - id: suite-green",
      '    bash: "node --test contract-tests/*.test.cjs"',
      "---",
    ].join("\n"))
    .replace(/\[proof:[^\]]*\]/g, "[proof: own-entry]"), "utf8");
  r = cli(["build", "--dir", backlog], env, { cwd: repo });
  assert.equal(r.status, 0, r.stderr);

  return { dir, repo, backlog, tests, ownTest, env, id };
}

test("a neighbour's baseline-red suite does not spend this task's attempts or park it", () => {
  const fx = fixture();
  const count = join(fx.dir, "foreign-count");
  try {
    const agent = shellScript(join(fx.dir, "foreign-agent.sh"), [
      'cat >/dev/null',
      'n=$(cat "' + count + '" 2>/dev/null || echo 0)',
      'n=$((n + 1))',
      'printf "%s\\n" "$n" > "' + count + '"',
      'printf "current task work complete\\n"',
    ].join("\n"));

    const r = cli(["run", "--dir", fx.backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--max-tasks", "1", "--json"], fx.env, { cwd: fx.repo });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);

    assert.equal(invocationCount(count), 1,
      "the pre-existing foreign red consumed another attempt from this task");
    assert.equal(statusOf(fx.backlog, fx.id), "in_progress",
      "the run parked or released a task whose own contract entry passed");
    assert.equal(runHistory(fx.backlog, fx.id).filter((entry) => entry.field === "status").length, 0,
      "the run recorded a status change for a failure already present at claim time");
    assert.notEqual(report.tasks[0].outcome, "exhausted");
    assert.match(JSON.stringify(report.tasks[0]), /foreign|pre-existing|already.red|baseline/i,
      "the structured report does not distinguish the foreign baseline red from this task's failure");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a newly failing own entry still exhausts and parks the task", () => {
  const fx = fixture();
  const count = join(fx.dir, "own-count");
  try {
    const agent = shellScript(join(fx.dir, "own-agent.sh"), [
      'cat >/dev/null',
      'n=$(cat "' + count + '" 2>/dev/null || echo 0)',
      'n=$((n + 1))',
      'printf "%s\\n" "$n" > "' + count + '"',
      'printf \'const test = require("node:test");\\nconst assert = require("node:assert/strict");\\ntest("this task", () => assert.fail("own proof broke"));\\n\' > "' + fx.ownTest + '"',
      'printf "current task changed\\n"',
    ].join("\n"));

    const r = cli(["run", "--dir", fx.backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--max-tasks", "1", "--json"], fx.env, { cwd: fx.repo });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);

    assert.equal(invocationCount(count), 2, "the task did not spend its configured attempts");
    assert.equal(statusOf(fx.backlog, fx.id), "blocked", "the task-owned failure was not parked");
    assert.equal(report.tasks[0].outcome, "exhausted");
    const parked = runHistory(fx.backlog, fx.id)
      .filter((entry) => entry.field === "status" && entry.to === "blocked").pop();
    assert.ok(parked, "the run did not record why it parked the task");
    assert.match(parked.reason, /own-entry/,
      "the permanent reason blames attempts without naming the task-owned entry");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
