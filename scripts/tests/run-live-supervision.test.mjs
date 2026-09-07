/** A supervisor exposes liveness and output before its worker exits (TL-358). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startAttemptRecord, startRunRecord, readExecutionRecord } from "../execution-records.mjs";
import { superviseAgent } from "../run-loop.mjs";

test("output and liveness are observable while a worker is still alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-live-supervision-"));
  const backlog = join(root, "backlog"); const logPath = join(root, "agent.log");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(root, "state") };
  try {
    mkdirSync(backlog);
    const run = startRunRecord({ root: backlog, actor: "agent:watch", delegation: "provider", env });
    const record = startAttemptRecord({ root: backlog, run, task: { id: "TL-1", profile: null, delegation: "provider" }, attempt: 1, env });
    const pending = superviseAgent("printf 'alive\\n'; sleep 1.2", { raw: true, cwd: root, root: backlog, record,
      env, input: "", timeout: 5, logPath, profile: null, recordEnv: env });
    await new Promise((resolve) => setTimeout(resolve, 1050));
    const live = readExecutionRecord(backlog, record.id, env);
    assert.match(readFileSync(logPath, "utf8"), /alive/);
    assert.equal(live.phase, "running");
    assert.ok(live.lastLivenessAt);
    assert.ok(live.lastOutputAt);
    await pending;
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an adapter that exits silently settles supervision", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-silent-exit-"));
  const backlog = join(root, "backlog"); const logPath = join(root, "agent.log");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(root, "state") };
  try {
    mkdirSync(backlog);
    const run = startRunRecord({ root: backlog, actor: "agent:watch", delegation: "provider", env });
    const record = startAttemptRecord({ root: backlog, run, task: { id: "TL-1", profile: null, delegation: "provider" }, attempt: 1, env });
    const result = await Promise.race([
      superviseAgent("true", { raw: true, cwd: root, root: backlog, record, env, input: "", timeout: 5, logPath, profile: null, recordEnv: env }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("supervisor did not settle")), 1000)),
    ]);
    assert.equal(result.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
