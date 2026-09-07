/** Durable execution records are local, complete and free of adapter secrets (TL-357). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { readExecutionRecord, startAttemptRecord, startRunRecord, updateAttemptRecord, updateRunRecord } from "../execution-records.mjs";
import { lockScope, stateRoot } from "../lock.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("execution-records");

test("a run and distinct attempts remain readable outside the backlog", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-execution-records-"));
  const backlog = join(root, "backlog");
  const env = { BACKLOG_STATE_DIR: join(root, "state") };
  try {
    mkdirSync(backlog);
    const run = startRunRecord({ root: backlog, actor: "agent:fleet", delegation: "branchling", env });
    const first = startAttemptRecord({ root: backlog, run, task: { id: "TL-1", role: "dev", leg: 1,
      profile: { name: "developer", model: "small", effort: "medium", adapter: "/private/secret-wrapper" }, delegation: "branchling", delegationEnforcement: "requested" }, attempt: 1, env });
    const second = startAttemptRecord({ root: backlog, run, task: { id: "TL-1", role: "review", leg: 2,
      profile: null, delegation: "branchling", delegationEnforcement: "requested" }, attempt: 1, env });
    updateAttemptRecord(backlog, first, { phase: "verifying" }, env);
    updateRunRecord(backlog, run, { phase: "finished", outcome: "finished" }, env);
    assert.notEqual(first.id, second.id);
    assert.equal(readExecutionRecord(backlog, first.id, env).phase, "verifying");
    const saved = readExecutionRecord(backlog, run.id, env);
    assert.deepEqual(saved.attempts, [first.id, second.id]);
    const text = JSON.stringify(saved) + JSON.stringify(readExecutionRecord(backlog, first.id, env));
    assert.doesNotMatch(text, /secret-wrapper|private/);
    assert.ok(existsSync(join(stateRoot(env), "executions", lockScope(backlog, { env }).key, run.id + ".json")));
    assert.equal(existsSync(join(backlog, "executions")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a partial record is never returned as a plausible execution", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-execution-partial-"));
  const backlog = join(root, "backlog");
  const env = { BACKLOG_STATE_DIR: join(root, "state") };
  try {
    mkdirSync(backlog);
    const id = "run-partial";
    const dir = join(stateRoot(env), "executions", lockScope(backlog, { env }).key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id + ".json"), '{"version":1,"id":"run-partial"', "utf8");
    assert.equal(readExecutionRecord(backlog, id, env), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
