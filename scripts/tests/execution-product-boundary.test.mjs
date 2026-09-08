/** The execution command composes one foreground task without owning Git topology. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS, resolveCommand } from "../cli.mjs";
import { parseRunArgs } from "../run-loop.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("execution-product-boundary");

const CLI = new URL("../cli.mjs", import.meta.url).pathname;

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, env: { ...process.env, NO_COLOR: "1", ...env }, encoding: "utf8", timeout: 120_000,
  });
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

test("only foreground execution ships, and it leaves the caller's Git topology unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-execution-boundary-"));
  try {
    const repo = join(root, "repository");
    const backlog = join(repo, "backlog");
    const state = join(root, "state");
    mkdirSync(repo, { recursive: true });
    git(["init", "-q"], repo);
    git(["config", "user.email", "test@example.invalid"], repo);
    git(["config", "user.name", "Execution test"], repo);
    writeFileSync(join(repo, "README.md"), "fixture\n");
    git(["add", "README.md"], repo);
    git(["commit", "-qm", "initial"], repo);
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], { BACKLOG_STATE_DIR: state }, repo).status, 0);
    const created = cli(["new", "--dir", backlog, "--title", "Foreground execution"], { BACKLOG_STATE_DIR: state }, repo);
    assert.equal(created.status, 0, created.stderr);
    const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const task = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((name) => name.startsWith(id + "-")));
    writeFileSync(task, readFileSync(task, "utf8")
      .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: evidence\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: evidence]"));
    assert.equal(cli(["build", "--dir", backlog], { BACKLOG_STATE_DIR: state }, repo).status, 0);
    const agent = join(root, "agent.sh");
    writeFileSync(agent, '#!/bin/sh\nid=$(sed -n "s/^id: //p" | head -1)\ntouch "$id.done"\n');
    chmodSync(agent, 0o755);
    const before = { branch: git(["branch", "--show-current"], repo), trees: git(["worktree", "list", "--porcelain"], repo) };
    const ran = cli(["run", "--dir", backlog, "--actor", "agent:test", "--agent", agent, "--max-tasks", "1", "--json"], { BACKLOG_STATE_DIR: state }, repo);
    assert.equal(ran.status, 0, ran.stdout + ran.stderr);
    assert.equal(JSON.parse(ran.stdout).tasks[0].outcome, "closed");
    assert.deepEqual({ branch: git(["branch", "--show-current"], repo), trees: git(["worktree", "list", "--porcelain"], repo) }, before);
    assert.equal(Object.hasOwn(COMMANDS, "watch"), false);
    assert.equal(Object.hasOwn(COMMANDS, "runs"), false);
    assert.throws(() => resolveCommand(["watch"]));
    assert.throws(() => parseRunArgs(["--detach"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
