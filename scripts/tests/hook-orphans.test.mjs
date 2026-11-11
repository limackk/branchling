/**
 * A hook test whose git call times out leaves no process behind (TL-665).
 *
 * The fixture is the regression this guards against: a `pre-commit` hook that
 * runs the CLI with no subcommand, which `resolveCommand()` maps to the server
 * — a process that never exits, so the hook never returns and git's timeout
 * fires. `--no-open` and `--port` are flags, not a subcommand: they keep the
 * route to `serve` and only spare the machine a browser tab and a port
 * collision.
 *
 * Every process the hook starts names the fixture directory on its command
 * line (`--dir`), and the hook shell writes its own pid into the fixture, so
 * survivors are found by those two marks and by nothing broader.
 *
 * THE POSITIVE CONTROL runs the same commit through a plain `spawnSync`. If
 * that one left nothing alive either, the contained case would pass without
 * proving anything — the hook might never have run, or might have exited.
 *
 * It is also the test a mutation run selects to judge mutation-contain.mjs
 * (TL-673), by the name on this line: `_git.mjs` runs that file in this test's
 * own process chain, where the active mutant is the one under test. The
 * nested run in `mutation/no-orphan-processes.test.mjs` uses the source
 * tree's copy and judges none of its mutants.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { git } from "./_git.mjs";
import { isolateHome, isolateState, plainOutput, posixPath, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("hook-orphans");
isolateState("hook-orphans");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const POSIX = process.platform !== "win32";
// Long enough for the hook to start the CLI and the server under a loaded
// suite, short enough not to dominate it.
const GIT_TIMEOUT_MS = 6_000;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** A repository whose pre-commit hook starts the server and never returns. */
async function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-hook-orphans-"));
  assert.equal(git(dir, ["init", "-q", "."]).status, 0);
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", "backlog", "--no-example"],
    { cwd: dir, encoding: "utf8", timeout: 60_000 });
  assert.equal(init.status, 0, init.stdout + init.stderr);

  const hook = join(dir, ".git", "hooks", "pre-commit");
  const quote = (s) => "'" + posixPath(s).replace(/'/g, "'\\''") + "'";
  writeFileSync(hook, [
    "#!/bin/sh",
    "echo $$ > " + quote(join(dir, "hook.pid")),
    [process.execPath, CLI].map(quote).join(" ") +
      " --dir " + quote(join(dir, "backlog")) + " --no-open --port " + (await freePort()),
    "",
  ].join("\n"), "utf8");
  chmodSync(hook, 0o755);

  writeFileSync(join(dir, "proof.txt"), "x\n", "utf8");
  assert.equal(git(dir, ["add", "proof.txt"]).status, 0);
  return dir;
}

/** Live processes left by the fixture: the hook shell, and anything naming the directory. */
function survivors(dir) {
  const hookPid = existsSync(join(dir, "hook.pid"))
    ? Number(readFileSync(join(dir, "hook.pid"), "utf8").trim()) : null;
  const ps = spawnSync("ps", ["-A", "-o", "pid=,stat=,args="], { encoding: "utf8" });
  assert.equal(ps.status, 0, "ps could not list processes: " + ps.stderr);
  return ps.stdout.split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .filter(([, , stat]) => !stat.startsWith("Z"))
    .filter(([, pid, , args]) => Number(pid) === hookPid || args.includes(dir))
    .map(([, pid, , args]) => ({ pid: Number(pid), args }));
}

/** Survivors after the kill had a moment to land; an empty list ends the wait early. */
function settledSurvivors(dir, waitMs = 3_000) {
  const deadline = Date.now() + waitMs;
  let left = survivors(dir);
  while (left.length && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    left = survivors(dir);
  }
  return left;
}

function kill(processes) {
  for (const { pid } of processes) {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}

test("a hook test whose git call times out leaves no hook, CLI or server process alive", { skip: !POSIX }, async () => {
  const dir = await fixture();
  const r = git(dir, ["commit", "-qm", "never lands"], { timeout: GIT_TIMEOUT_MS });
  assert.equal(r.error?.code, "ETIMEDOUT", "git returned instead of timing out — the fixture hook did not hang:\n" +
    r.stdout + r.stderr);
  assert.ok(existsSync(join(dir, "hook.pid")), "the hook never ran, so its absence afterwards proves nothing");

  const left = settledSurvivors(dir);
  kill(left);
  assert.deepEqual(left, [], "processes outlived the timed-out git call");
});

test("POSITIVE CONTROL: the same timeout through a plain spawnSync leaves the hook alive", { skip: !POSIX }, async () => {
  const dir = await fixture();
  const r = spawnSync("git", ["commit", "-qm", "never lands"], { cwd: dir, encoding: "utf8", timeout: GIT_TIMEOUT_MS });
  assert.equal(r.error?.code, "ETIMEDOUT", "git returned instead of timing out:\n" + r.stdout + r.stderr);

  const left = survivors(dir);
  try {
    assert.ok(left.length > 0,
      "nothing survived an uncontained timeout — the fixture no longer reproduces the orphan, " +
        "so the contained case above proves nothing");
    assert.ok(left.some((p) => p.args.includes("serve-backlog.mjs")),
      "the hook did not reach the server; survivors were:\n" + left.map((p) => p.args).join("\n"));
  } finally {
    // The control leaves real orphans by design; they die here, not at logout.
    kill(left);
    kill(settledSurvivors(dir, 1_000));
  }
});
