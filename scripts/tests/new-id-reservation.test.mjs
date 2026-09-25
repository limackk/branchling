/**
 * `new` reserves an identifier across worktrees before either caller writes it
 * (TL-402).
 *
 * The fixture puts two real CLI processes in two worktrees of one clone. A git
 * shim holds both scans at `for-each-ref`, after each scanner has already read
 * every worktree. Without the repository-scoped mutex both processes therefore
 * compute the same maximum and write that number under different slugs. With
 * the mutex, the second process cannot scan until the first task file exists.
 *
 * Both successful files and their creation histories are asserted as a
 * positive control: uniqueness over a process that never wrote anything would
 * be green with no evidentiary force.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { FIELD_CREATED } from "../history.mjs";
import { lockScope } from "../lock.mjs";
import { taskIdPatterns } from "../task-id.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

isolateHome("new-id-reservation");

function run(command, args, opts = {}) {
  return spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    env: opts.env || process.env,
    timeout: 30_000,
  });
}

function mustRun(command, args, opts = {}) {
  const result = run(command, args, opts);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function writeGitBarrier(binDir) {
  const path = join(binDir, "git");
  writeFileSync(path, [
    "#!/usr/bin/env node",
    'const { spawnSync } = require("node:child_process");',
    'const { existsSync, mkdirSync, readdirSync, writeFileSync } = require("node:fs");',
    'const { join } = require("node:path");',
    "const args = process.argv.slice(2);",
    'if (args[0] === "for-each-ref" && !args.includes("--merged")) {',
    "  const dir = process.env.BRANCHLING_TEST_GIT_BARRIER;",
    "  mkdirSync(dir, { recursive: true });",
    '  const marker = join(dir, String(process.ppid) + ".ready");',
    '  if (!existsSync(marker)) writeFileSync(marker, "ready\\n", "utf8");',
    "  const deadline = Date.now() + 750;",
    '  while (readdirSync(dir).filter((name) => name.endsWith(".ready")).length < 2 && Date.now() < deadline) {',
    "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);",
    "  }",
    "}",
    "const env = { ...process.env, PATH: process.env.BRANCHLING_TEST_REAL_PATH };",
    'const result = spawnSync("git", args, { env, stdio: "inherit" });',
    "process.exit(result.status == null ? 1 : result.status);",
    "",
  ].join("\n"), "utf8");
  chmodSync(path, 0o755);
  return path;
}

function startNew(cwd, backlog, title, env) {
  return spawn(process.execPath, [CLI, "new", "--dir", backlog, "--title", title], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resultOf(child) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  });
}

function createdTask(backlog, title, pattern) {
  const files = readdirSync(join(backlog, "tasks")).filter((file) => pattern.file.test(file));
  const file = files.find((name) => readFileSync(join(backlog, "tasks", name), "utf8")
    .includes('title: "' + title + '"'));
  assert.ok(file, "the positive control did not find the task titled " + title);
  return { file, id: basename(file).match(pattern.fileId)[1] };
}

test("two concurrent new calls in separate worktrees reserve different ids", async () => {
  const fixture = mkdtempSync(join(tmpdir(), "branchling-new-id-reservation-"));
  const main = join(fixture, "main");
  const sibling = join(fixture, "sibling");
  const bin = join(fixture, "bin");
  const barrier = join(fixture, "barrier");
  mkdirSync(main);
  mkdirSync(bin);

  try {
    mustRun("git", ["init"], { cwd: main });
    mustRun(process.execPath, [CLI, "init", "--dir", join(main, "backlog")], { cwd: main });
    mustRun("git", ["add", "."], { cwd: main });
    mustRun("git", ["commit", "-m", "fixture"], { cwd: main });
    mustRun("git", ["worktree", "add", "-b", "sibling", sibling], { cwd: main });

    writeGitBarrier(bin);
    const env = {
      ...process.env,
      BACKLOG_STATE_DIR: join(fixture, "state"),
      BRANCHLING_TEST_GIT_BARRIER: barrier,
      BRANCHLING_TEST_REAL_PATH: process.env.PATH,
      PATH: bin + ":" + process.env.PATH,
      NO_COLOR: "1",
    };

    const left = startNew(main, join(main, "backlog"), "Left reservation", env);
    const right = startNew(sibling, join(sibling, "backlog"), "Right reservation", env);
    const [leftResult, rightResult] = await Promise.all([resultOf(left), resultOf(right)]);
    assert.equal(leftResult.status, 0, leftResult.stderr);
    assert.equal(rightResult.status, 0, rightResult.stderr);

    const prefix = readFileSync(join(main, "backlog", "config.yaml"), "utf8")
      .match(/^task_id_prefix:\s*([^\s#]+)/m)[1];
    const pattern = taskIdPatterns(prefix);
    const leftTask = createdTask(join(main, "backlog"), "Left reservation", pattern);
    const rightTask = createdTask(join(sibling, "backlog"), "Right reservation", pattern);
    assert.notEqual(leftTask.id, rightTask.id, "both worktrees were handed one id");

    for (const [backlog, task] of [
      [join(main, "backlog"), leftTask],
      [join(sibling, "backlog"), rightTask],
    ]) {
      const events = readFileSync(join(backlog, "history", task.id + ".jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(events.filter((event) => event.field === FIELD_CREATED).length, 1,
        task.id + " does not have exactly one creation event");
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("an abandoned reservation does not permanently burn its number", () => {
  const fixture = mkdtempSync(join(tmpdir(), "branchling-new-id-recovery-"));
  const repo = join(fixture, "repo");
  const backlog = join(repo, "backlog");
  const state = join(fixture, "state");
  mkdirSync(repo);

  try {
    mustRun("git", ["init"], { cwd: repo });
    mustRun(process.execPath, [CLI, "init", "--dir", backlog], { cwd: repo });
    mustRun("git", ["add", "."], { cwd: repo });
    mustRun("git", ["commit", "-m", "fixture"], { cwd: repo });

    const section = lockScope(backlog).origin + "\0new-task-id";
    const mutexDir = join(state, "mutex");
    const mutexPath = join(mutexDir,
      createHash("sha256").update(section).digest("hex").slice(0, 16) + ".mutex");
    mkdirSync(mutexDir, { recursive: true });
    writeFileSync(mutexPath, JSON.stringify({
      section, token: "abandoned", pid: 1, host: "gone", ts: "2000-01-01T00:00:00.000Z",
    }) + "\n", "utf8");

    const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
    const created = run(process.execPath,
      [CLI, "new", "--dir", backlog, "--title", "Recovered number"], { cwd: repo, env });
    assert.equal(created.status, 0, created.stderr);
    assert.equal(existsSync(mutexPath), false, "the stale reservation survived a successful write");

    const prefix = readFileSync(join(backlog, "config.yaml"), "utf8")
      .match(/^task_id_prefix:\s*([^\s#]+)/m)[1];
    const task = createdTask(backlog, "Recovered number", taskIdPatterns(prefix));
    assert.equal(task.id, prefix + "-2", "the abandoned reservation burned a number");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
