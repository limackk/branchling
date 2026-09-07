/** Worker capabilities constrain inherited Branchling CLI access (TL-356). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { PRODUCT_NAME } from "../product.mjs";
import { createWorkerScope, releaseWorkerScope, WORKER_SCOPE_ENV } from "../worker-scope.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("worker-scope");
const CLI = join(SCRIPTS_DIR, "cli.mjs");
const PREFIX = PRODUCT_NAME.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000, env });
}
function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}
function status(backlog, id) { return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: (\w+)/m) || [])[1]; }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-worker-scope-"));
  const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(root, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
  const add = (title) => {
    const made = cli(["new", "--dir", backlog, "--title", title], env, root);
    assert.equal(made.status, 0, made.stderr);
    return made.stdout.match(/[A-Z]+-\d+/)[0];
  };
  return { root, backlog, env, add };
}

test("a presented worker capability cannot claim another task or nest a run", () => {
  const fx = fixture();
  const first = fx.add("Assigned task");
  const second = fx.add("Other task");
  const scope = createWorkerScope({ root: fx.backlog, taskId: first, actor: "agent:worker", runId: "run-1", env: fx.env });
  const env = { ...fx.env, [WORKER_SCOPE_ENV]: scope, [PREFIX + "_TASK"]: second };
  try {
    const take = cli(["take", second, "--dir", fx.backlog, "--actor", "agent:worker"], env, fx.root);
    assert.equal(take.status, 1, take.stdout + take.stderr);
    assert.match(take.stderr, /cannot own the queue/);
    const nested = cli(["run", "--dir", fx.backlog, "--agent", "true"], env, fx.root);
    assert.equal(nested.status, 1, nested.stdout + nested.stderr);
    assert.match(nested.stderr, /cannot own the queue/);
    assert.equal(status(fx.backlog, second), "pending");
  } finally {
    releaseWorkerScope(scope, fx.env);
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("a forged task environment without a local capability grants no authority", () => {
  const fx = fixture();
  const id = fx.add("Forged authority");
  try {
    const forged = cli(["take", id, "--dir", fx.backlog, "--actor", "agent:worker"],
      { ...fx.env, [WORKER_SCOPE_ENV]: "0".repeat(48) + "." + "1".repeat(48), [PREFIX + "_TASK"]: id }, fx.root);
    assert.equal(forged.status, 1, forged.stdout + forged.stderr);
    assert.match(forged.stderr, /scope is missing or invalid/);
    assert.equal(status(fx.backlog, id), "pending");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});

test("an ordinary terminal has no worker restriction", () => {
  const fx = fixture();
  const id = fx.add("Terminal authority");
  try {
    const take = cli(["take", id, "--dir", fx.backlog, "--actor", "agent:terminal"], fx.env, fx.root);
    assert.equal(take.status, 0, take.stdout + take.stderr);
    assert.equal(status(fx.backlog, id), "in_progress");
  } finally { rmSync(fx.root, { recursive: true, force: true }); }
});
