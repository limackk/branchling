/**
 * A failed immutable append must roll the computed snapshot back. The append is
 * the final persistence step, so no later snapshot write can fail after a
 * durable row and tempt a caller to restore the task beneath truthful history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { historyPath, loadSnapshot, recordEdit } from "../history.mjs";
import { isolateHome, isolateState } from "./_repo.mjs";

isolateHome("viewer-write-atomicity");
isolateState("viewer-write-atomicity");

test("an append failure restores the snapshot and writes no false transition", () => {
  const dir = mkdtempSync(join(tmpdir(), "viewer-write-atomicity-"));
  const backlog = join(dir, "backlog");
  const id = "TASK-1";
  mkdirSync(join(backlog, "tasks"), { recursive: true });
  writeFileSync(join(backlog, "tasks", "TASK-1-work.md"), "---\nid: TASK-1\nstatus: pending\n---\n", "utf8");
  try {
    recordEdit(backlog, {
      taskId: id,
      before: { id, status: "" },
      after: { id, status: "pending" },
      actor: "local:owner",
      source: "viewer",
    });
    const snapshotBefore = loadSnapshot(backlog);
    const log = historyPath(backlog, id);
    const saved = log + ".saved";
    renameSync(log, saved);
    mkdirSync(log);

    assert.throws(() => recordEdit(backlog, {
      taskId: id,
      before: { id, status: "pending" },
      after: { id, status: "done" },
      actor: "local:owner",
      source: "viewer",
    }));
    assert.deepEqual(loadSnapshot(backlog), snapshotBefore,
      "the failed append advanced the snapshot past durable history");
    assert.equal(readFileSync(saved, "utf8").trim().split("\n").length, 1,
      "the failed transition reached immutable history");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the immutable append is the final persistence operation in recordEdit", () => {
  const source = readFileSync(new URL("../history.mjs", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("export function recordEdit"), source.indexOf("export function reconcile"));
  const append = block.lastIndexOf("appendEntries(backlogDir, taskId, entries)");
  assert.ok(append > block.lastIndexOf("saveSnapshot(backlogDir, snap)"));
  const failureHandler = block.indexOf("} catch (error)", append);
  assert.ok(failureHandler > append, "the immutable append has no recovery boundary");
  assert.equal(block.slice(append, failureHandler).includes("saveSnapshot"), false,
    "a fallible snapshot write follows the immutable history append");
});
