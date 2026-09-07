import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { startRunRecord, updateRunRecord } from "../execution-records.mjs";
import { SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
function cli(args, env, cwd) { return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", env }); }
test("local run controls expose identity, bounded wait and refuse stale supervisors", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-run-control-")); const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(root, "state") };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0); const run = startRunRecord({ root: backlog, actor: "agent:test", delegation: "provider", env });
    updateRunRecord(backlog, run, { supervisor: { pid: 999999, script: "run-loop.mjs" } }, env);
    const list = cli(["runs", "list", "--dir", backlog, "--json"], env, root); assert.equal(list.status, 0, list.stdout + list.stderr); assert.equal(JSON.parse(list.stdout).runs[0].id, run.id);
    const show = cli(["runs", "show", run.id, "--dir", backlog, "--json"], env, root); assert.equal(show.status, 0); const shown = JSON.parse(show.stdout).run; assert.equal(shown.id, run.id); assert.equal(shown.phase, "interrupted"); assert.equal(shown.outcome, "supervisor-exited"); assert.match(shown.finishedAt, /^\d{4}-\d{2}-\d{2}T/);
    const cancel = cli(["runs", "cancel", run.id, "--dir", backlog, "--json"], env, root); assert.equal(cancel.status, 0); assert.equal(JSON.parse(cancel.stdout).run.phase, "interrupted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a bounded wait reports timeout without changing a live run", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-run-wait-")); const backlog = join(root, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(root, "state") };
  const worker = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)", "run-loop.mjs"], { detached: true, stdio: "ignore" });
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const run = startRunRecord({ root: backlog, actor: "agent:test", delegation: "provider", env });
    updateRunRecord(backlog, run, { phase: "running", supervisor: { pid: worker.pid, script: "run-loop.mjs" } }, env);
    const waited = cli(["runs", "wait", run.id, "--timeout", "0.1", "--dir", backlog, "--json"], env, root);
    assert.equal(waited.status, 0, waited.stderr); const answer = JSON.parse(waited.stdout);
    assert.equal(answer.timedOut, true); assert.equal(answer.run.phase, "running");
  } finally { try { process.kill(-worker.pid, "SIGTERM"); } catch {} rmSync(root, { recursive: true, force: true }); }
});
