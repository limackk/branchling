import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("run-detach");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", env });
}

test("detached JSON start uses the public run envelope", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-run-detach-"));
  const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(root, "state") };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const started = cli(["run", "--agent", "true", "--max-tasks", "1", "--detach", "--dir", backlog, "--json"], env, root);
    assert.equal(started.status, 0, started.stderr);
    const answer = JSON.parse(started.stdout);
    assert.equal(answer.schemaVersion, 1);
    assert.equal(answer.kind, "run");
    assert.equal(answer.alive, true);
    assert.equal(answer.run.phase, "starting");
    assert.match(answer.run.id, /^run-/);
    const cancelled = cli(["runs", "cancel", answer.run.id, "--dir", backlog, "--json"], env, root);
    assert.equal(cancelled.status, 0, cancelled.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
