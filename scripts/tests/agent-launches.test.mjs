/** Named launches compose ordinary local profiles before a run can claim work (TL-315). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { HOME_ENV, agentLaunchesPath } from "../home.mjs";
import { resolveAgentLaunch } from "../agent-launches.mjs";
import { SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
function cli(args, env, cwd) { return spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: "utf8", timeout: 30_000 }); }

test("a launch is local, maps repeated roles, and run resolves it before any claim", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-launch-"));
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state") };
  try {
    const adapter = join(root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n"); chmodSync(adapter, 0o755);
    for (const name of ["developer", "reviewer"]) assert.equal(cli(["profile", "create", name, "--adapter", adapter, "--prompt", "Work."], env, root).status, 0);
    const made = cli(["launch", "create", "team", "--profile", "developer", "--profile-for", "dev=developer", "--profile-for", "review=reviewer", "--json"], env, root);
    assert.equal(made.status, 0, made.stderr);
    assert.equal(readFileSync(agentLaunchesPath(env), "utf8").includes("review=reviewer"), true);
    assert.equal(readFileSync(agentLaunchesPath(env), "utf8").includes(root), false, "launch data does not name a repository");
    const resolved = resolveAgentLaunch("team", env);
    assert.deepEqual(resolved.launch.profileFor, { dev: "developer", review: "reviewer" });
    const backlog = join(root, "backlog"); assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev, review]\n");
    const dry = cli(["run", "--dir", backlog, "--actor", "agent:test", "--launch", "team", "--dry-run", "--json"], env, root);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(dry.stdout).profileFor.review, "reviewer");
    const bad = cli(["launch", "create", "broken", "--profile", "missing"], env, root);
    assert.equal(bad.status, 0);
    const refused = cli(["run", "--dir", backlog, "--actor", "agent:test", "--launch", "broken", "--dry-run"], env, root);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /missing profile/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
