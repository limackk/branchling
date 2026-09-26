/**
 * Process-tree interruption has two genuinely different implementations.
 * POSIX signals a negative process-group id; Windows must call `taskkill /T`.
 * These tests exercise both branches on every development platform so the
 * Windows contract does not depend only on somebody noticing a red hosted run.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { processTreeDetached, stopProcessTree } from "../process-tree.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("process-tree-interrupt");

test("a POSIX child leads a process group and the group receives the signal", () => {
  assert.equal(processTreeDetached("linux"), true);
  assert.equal(processTreeDetached("darwin"), true);

  const calls = [];
  const child = { pid: 417, kill: (signal) => calls.push(["child", signal]) };
  stopProcessTree(child, "SIGTERM", {
    platform: "linux",
    kill: (pid, signal) => calls.push(["group", pid, signal]),
  });
  assert.deepEqual(calls, [["group", -417, "SIGTERM"]]);
});

test("POSIX falls back to the direct child when its group already disappeared", () => {
  const calls = [];
  const child = { pid: 418, kill: (signal) => calls.push(["child", signal]) };
  stopProcessTree(child, "SIGKILL", {
    platform: "darwin",
    kill: () => { throw new Error("no such process group"); },
  });
  assert.deepEqual(calls, [["child", "SIGKILL"]]);
});

test("Windows uses taskkill to stop the complete descendant tree", () => {
  assert.equal(processTreeDetached("win32"), false);
  const calls = [];
  const child = { pid: 419, kill: (signal) => calls.push(["child", signal]) };
  stopProcessTree(child, "SIGTERM", {
    platform: "win32",
    spawnSync: (command, args, options) => {
      calls.push([command, args, options]);
      return { status: 0 };
    },
  });
  assert.deepEqual(calls, [["taskkill", ["/pid", "419", "/t"], { stdio: "ignore" }]]);
});

test("a forced Windows stop adds /f and falls back when taskkill is unavailable", () => {
  const calls = [];
  const child = { pid: 420, kill: (signal) => calls.push(["child", signal]) };
  stopProcessTree(child, "SIGKILL", {
    platform: "win32",
    spawnSync: (command, args) => {
      calls.push([command, args]);
      return { status: 1 };
    },
  });
  assert.deepEqual(calls, [
    ["taskkill", ["/pid", "420", "/t", "/f"]],
    ["child", "SIGKILL"],
  ]);
});

test("a missing child is a no-op on both platform branches", () => {
  let called = false;
  stopProcessTree(null, "SIGTERM", {
    platform: "win32",
    spawnSync: () => { called = true; return { status: 0 }; },
  });
  stopProcessTree({ pid: 0 }, "SIGTERM", {
    platform: "linux",
    kill: () => { called = true; },
  });
  assert.equal(called, false);
});
