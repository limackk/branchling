/** README profile onboarding stays runnable without a provider account (TL-293). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-onboarding");
const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000, env });
}

function task(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((file) => file.startsWith(id + "-")));
}

test("README generalist and mixed-profile commands work in an isolated home", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-onboarding-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"), OPENAI_API_KEY: "test-only" };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const adapter = join(root, "adapter");
    writeFileSync(adapter, "#!/bin/sh\nprintf 'worked\\n'\n", "utf8");
    chmodSync(adapter, 0o755);
    assert.equal(cli(["profile", "create", "generalist", "--adapter", adapter, "--model", "current-model", "--effort", "high", "--prompt", "Implement from evidence."], env, repo).status, 0);
    assert.equal(cli(["profile", "check", "generalist"], env, repo).status, 0);
    const generalist = cli(["run", "--dir", backlog, "--profile", "generalist", "--dry-run", "--json"], env, repo);
    assert.equal(generalist.status, 0, generalist.stdout + generalist.stderr);
    assert.equal(JSON.parse(generalist.stdout).dryRun, true);

    writeFileSync(join(backlog, "config.yaml"), readFileSync(join(backlog, "config.yaml"), "utf8") + "\nroles: [review]\n", "utf8");
    const created = cli(["new", "--dir", backlog, "--title", "Review this change"], env, repo);
    const id = created.stdout.match(/[A-Z]+-\d+/)[0];
    writeFileSync(task(backlog, id), readFileSync(task(backlog, id), "utf8").replace(/^role: .*$/m, "role: review"), "utf8");
    assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);
    assert.equal(cli(["profile", "create", "reviewer", "--adapter", adapter, "--model", "api-model", "--effort", "medium", "--prompt", "Review from evidence.", "--secret-env", "OPENAI_API_KEY"], env, repo).status, 0);
    assert.equal(cli(["profile", "check", "reviewer"], env, repo).status, 0);
    const fleet = cli(["run", "--dir", backlog, "--profile", "generalist", "--profile-for", "review=reviewer", "--dry-run", "--json"], env, repo);
    assert.equal(fleet.status, 0, fleet.stdout + fleet.stderr);
    assert.deepEqual(JSON.parse(fleet.stdout).profileFor, { review: "reviewer" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
