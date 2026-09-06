/**
 * Concurrent `new` commands reserve identifiers as one atomic operation
 * (TL-295).
 *
 * These are real CLI processes, not calls to `createTask()` in one JavaScript
 * process. The defect exists between OS processes: each could finish the
 * repository scan before any of the others wrote its differently named file,
 * leaving several files and creation records that all claimed one identifier.
 *
 * The first case is also the positive control: every child must create a real
 * task and a real `__created__` event. Uniqueness over an empty sample would say
 * nothing. The second case proves the mutex is released through an exception;
 * otherwise the next process waits for a fresh lock until it fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_CREATED } from "../history.mjs";
import { taskIdPatterns } from "../task-id.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const WORKERS = 8;

isolateHome("new-task-concurrency");

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env,
  });
}

function fixture(label) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-new-race-" + label + "-"));
  const backlog = join(dir, "backlog");
  const env = {
    ...process.env,
    BACKLOG_STATE_DIR: join(dir, "state"),
    NO_COLOR: "1",
  };
  const initialized = run(["init", "--dir", backlog, "--no-example"], env);
  assert.equal(initialized.status, 0, initialized.stderr);
  return { dir, backlog, env };
}

function startTogether(backlog, env) {
  const at = Date.now() + 1000;
  const children = [];
  for (let i = 0; i < WORKERS; i++) {
    const script = [
      "while (Date.now() < Number(process.argv[1])) {}",
      "const { spawnSync } = await import('node:child_process');",
      "const r = spawnSync(process.execPath, process.argv.slice(2), { encoding: 'utf8', env: process.env });",
      "process.stdout.write(r.stdout || '');",
      "process.stderr.write(r.stderr || '');",
      "process.exit(r.status == null ? 1 : r.status);",
    ].join("\n");
    children.push(spawn(process.execPath, [
      "--input-type=module", "--eval", script, String(at), CLI, "new",
      "--dir", backlog, "--title", "Concurrent task " + (i + 1),
    ], { env, stdio: ["ignore", "pipe", "pipe"] }));
  }
  return Promise.all(children.map((child) => new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (status) => resolve({ status, stdout, stderr }));
  })));
}

test("concurrent new processes create unique task files and creation histories", async () => {
  const { dir, backlog, env } = fixture("success");
  try {
    const results = await startTogether(backlog, env);
    for (const result of results) assert.equal(result.status, 0, result.stderr);

    const prefix = readFileSync(join(backlog, "config.yaml"), "utf8")
      .match(/^task_id_prefix:\s*([^\s#]+)/m)[1];
    const pattern = taskIdPatterns(prefix);
    const files = readdirSync(join(backlog, "tasks")).filter((file) => pattern.file.test(file));
    assert.equal(files.length, WORKERS, "the positive control did not create every task");

    const ids = files.map((file) => file.match(pattern.fileId)[1]);
    assert.equal(new Set(ids).size, WORKERS, "more than one task file claims the same id");

    for (const [index, file] of files.entries()) {
      const id = ids[index];
      assert.match(readFileSync(join(backlog, "tasks", file), "utf8"),
        new RegExp("^id: " + id + "$", "m"));
      const events = readFileSync(join(backlog, "history", id + ".jsonl"), "utf8")
        .trim().split("\n").map((line) => JSON.parse(line));
      assert.equal(events.filter((event) => event.field === FIELD_CREATED).length, 1,
        id + " does not have exactly one creation event");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed creation releases the number-allocation mutex", () => {
  const { dir, backlog, env } = fixture("failure");
  try {
    const template = join(backlog, "_template.md");
    const original = readFileSync(template, "utf8");
    writeFileSync(template, original.replace(/^status: .*$/m, "status: impossible"), "utf8");
    const failed = run(["new", "--dir", backlog, "--title", "Must fail"], env);
    assert.notEqual(failed.status, 0, "the fixture did not fail inside task creation");

    writeFileSync(template, original, "utf8");
    const recovered = run(["new", "--dir", backlog, "--title", "After failure"], env);
    assert.equal(recovered.status, 0, recovered.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
