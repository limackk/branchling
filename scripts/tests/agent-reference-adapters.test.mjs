/** The shipped adapters are executable examples, not branches in the core (TL-301). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { agentProfilesPath } from "../home.mjs";
import { isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-reference-adapters");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const CLAUDE = join(REPO_ROOT, "examples", "agent-adapters", "claude-code.mjs");
const AIDER = join(REPO_ROOT, "examples", "agent-adapters", "aider-api.mjs");

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000, env });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((file) => file.startsWith(id + "-")));
}

function addTask(backlog, env, cwd, title, role) {
  const created = cli(["new", "--dir", backlog, "--title", title], env, cwd);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const path = taskFile(backlog, id);
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/^role: .*$/m, role ? "role: " + role : "")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: example\n    bash: "true"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: example]"), "utf8");
  return id;
}

function fakeHarness(path, witness) {
  writeFileSync(path, ["#!/bin/sh", "printf '%s\\n' \"$*\" >> " + JSON.stringify(witness), "printf 'worked\\n'"].join("\n") + "\n", "utf8");
  chmodSync(path, 0o755);
}

test("reference adapters pass conformance and route generalist and review profiles", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-reference-adapters-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const bin = join(root, "bin");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"), PATH: bin + ":" + process.env.PATH, OPENAI_API_KEY: "test-only-secret" };
  try {
    const subscription = cli(["conformance", "--adapter", CLAUDE], env, root);
    assert.equal(subscription.status, 0, subscription.stdout + subscription.stderr);
    const api = cli(["conformance", "--adapter", AIDER], env, root);
    assert.equal(api.status, 0, api.stdout + api.stderr);

    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    writeFileSync(join(backlog, "config.yaml"), readFileSync(join(backlog, "config.yaml"), "utf8") + "\nroles: [review]\n", "utf8");
    mkdirSync(join(backlog, "roles"));
    writeFileSync(join(backlog, "roles", "review.md"), "Review from evidence.\n", "utf8");
    addTask(backlog, env, repo, "Generalist work", "");
    addTask(backlog, env, repo, "Review work", "review");
    const build = cli(["build", "--dir", backlog], env, repo);
    assert.equal(build.status, 0, build.stdout + build.stderr);

    const subscriptionSeen = join(root, "claude-arguments.txt");
    const apiSeen = join(root, "aider-arguments.txt");
    mkdirSync(bin);
    fakeHarness(join(bin, "claude"), subscriptionSeen);
    fakeHarness(join(bin, "aider"), apiSeen);
    assert.equal(cli(["profile", "create", "developer", "--adapter", CLAUDE, "--model", "subscription-model", "--effort", "high", "--prompt", "Implement from evidence."], env, repo).status, 0);
    assert.equal(cli(["profile", "create", "reviewer", "--adapter", AIDER, "--model", "api-model", "--effort", "medium", "--prompt", "Review from evidence.", "--secret-env", "OPENAI_API_KEY"], env, repo).status, 0);

    const result = cli(["run", "--dir", backlog, "--actor", "agent:references", "--profile", "developer", "--profile-for", "review=reviewer"], env, repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /2 closed/);
    assert.match(readFileSync(subscriptionSeen, "utf8"), /--model subscription-model --effort high/);
    assert.match(readFileSync(apiSeen, "utf8"), /--message[\s\S]*--model api-model --reasoning-effort medium/);
    assert.equal(readFileSync(agentProfilesPath(env), "utf8").includes("test-only-secret"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference documentation keeps model choice and credentials with the user", () => {
  const guide = readFileSync(join(REPO_ROOT, "examples", "agent-adapters", "README.md"), "utf8");
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  assert.match(guide, /<a current Claude model alias>/);
  assert.match(guide, /<a model specification accepted by Aider>/);
  assert.match(guide, /--secret-env OPENAI_API_KEY/);
  assert.doesNotMatch(guide, /sk-[A-Za-z0-9_-]{16,}/);
  assert.match(readme, /Copyable reference adapters ship with the package/);
});
