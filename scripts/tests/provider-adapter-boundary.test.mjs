/** TL-382: execution owns one provider-neutral, user-owned adapter boundary. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV, agentProfilesPath } from "../home.mjs";
import { isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("provider-adapter-boundary");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function command(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 120_000, env,
  });
}

function taskPath(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((file) => file.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskPath(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function adapter(root, name, kind, witness) {
  const executable = join(root, name);
  const body = kind === "api"
    ? [
      "payload=$(cat)",
      "id=$(printf '%s' \"$payload\" | sed -n 's/^id: //p' | head -n 1)",
      "printf 'api|%s|%s|%s|%s\\n' \"$BRANCHLING_PROFILE\" \"$BRANCHLING_MODEL\" \"$BRANCHLING_EFFORT\" \"$BRANCHLING_TASK\" >> " + JSON.stringify(witness),
      "touch \"$id.done\"",
    ]
    : [
      "task=$(cat)",
      "id=$(printf '%s' \"$task\" | sed -n 's/^id: //p' | head -n 1)",
      "printf 'cli|%s|%s|%s|%s\\n' \"$BRANCHLING_PROFILE\" \"$BRANCHLING_MODEL\" \"$BRANCHLING_EFFORT\" \"$BRANCHLING_TASK\" >> " + JSON.stringify(witness),
      "touch \"$id.done\"",
    ];
  writeFileSync(executable, "#!/bin/sh\n" + body.join("\n") + "\n", "utf8");
  chmodSync(executable, 0o755);
  return executable;
}

function fixture(title = "Provider-neutral task") {
  const root = mkdtempSync(join(tmpdir(), "branchling-provider-boundary-"));
  const repo = join(root, "repository");
  const backlog = join(repo, "backlog");
  const home = join(root, "home");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: home, BACKLOG_STATE_DIR: join(root, "state") };
  assert.equal(command(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
  const created = command(["new", "--dir", backlog, "--title", title], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const path = taskPath(backlog, id);
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: adapter-done\n    bash: "test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: adapter-done]"), "utf8");
  assert.equal(command(["build", "--dir", backlog], env, repo).status, 0);
  return { root, repo, backlog, home, env, id };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("a CLI wrapper and an API harness close work through the same user-owned profile contract", () => {
  const first = fixture("CLI adapter work");
  const second = fixture("API harness work");
  try {
    const cliWitness = join(first.root, "cli-received.txt");
    const apiWitness = join(second.root, "api-received.txt");
    const cliAdapter = adapter(first.root, "local-cli-adapter", "cli", cliWitness);
    const apiAdapter = adapter(second.root, "local-api-harness", "api", apiWitness);

    const cliProfile = command(["profile", "create", "local-cli", "--adapter", cliAdapter,
      "--model", "local-cli-model", "--effort", "careful", "--prompt", "Implement from task evidence."], first.env, first.repo);
    const apiProfile = command(["profile", "create", "local-api", "--adapter", apiAdapter,
      "--model", "api-harness-model", "--effort", "deliberate", "--prompt", "Submit the task to the local harness."], second.env, second.repo);
    assert.equal(cliProfile.status, 0, cliProfile.stderr);
    assert.equal(apiProfile.status, 0, apiProfile.stderr);
    assert.equal(command(["profile", "check", "local-cli"], first.env, first.repo).status, 0);
    assert.equal(command(["profile", "check", "local-api"], second.env, second.repo).status, 0);

    const cliRun = command(["run", "--dir", first.backlog, "--actor", "agent:cli", "--profile", "local-cli", "--max-attempts", "1"], first.env, first.repo);
    const apiRun = command(["run", "--dir", second.backlog, "--actor", "agent:api", "--profile", "local-api", "--max-attempts", "1"], second.env, second.repo);
    assert.equal(cliRun.status, 0, cliRun.stdout + cliRun.stderr);
    assert.equal(apiRun.status, 0, apiRun.stdout + apiRun.stderr);
    assert.equal(statusOf(first.backlog, first.id), "done");
    assert.equal(statusOf(second.backlog, second.id), "done");
    assert.match(readFileSync(cliWitness, "utf8"), new RegExp("cli\\|local-cli\\|local-cli-model\\|careful\\|" + first.id));
    assert.match(readFileSync(apiWitness, "utf8"), new RegExp("api\\|local-api\\|api-harness-model\\|deliberate\\|" + second.id));

    for (const [fx, adapterPath, model] of [[first, cliAdapter, "local-cli-model"], [second, apiAdapter, "api-harness-model"]]) {
      const projectData = readFileSync(taskPath(fx.backlog, fx.id), "utf8") + readFileSync(join(fx.backlog, "config.yaml"), "utf8");
      assert.equal(projectData.includes(adapterPath), false, "repository data selected a local adapter");
      assert.equal(projectData.includes(model), false, "repository data selected a provider model");
      assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), new RegExp(model), "profile values did not stay local");
    }
  } finally {
    cleanup(first.root);
    cleanup(second.root);
  }
});

test("an unavailable executable or absent declared secret fails before a task is claimed", () => {
  const missingExecutable = fixture("Missing executable");
  const missingSecret = fixture("Missing secret");
  try {
    assert.equal(command(["profile", "create", "gone", "--adapter", join(missingExecutable.root, "not-installed"),
      "--prompt", "Do not start."], missingExecutable.env, missingExecutable.repo).status, 0);
    assert.equal(command(["profile", "create", "secret", "--adapter", process.execPath,
      "--secret-env", "ABSENT_PROVIDER_TOKEN", "--prompt", "Do not start."], missingSecret.env, missingSecret.repo).status, 0);

    const unavailable = command(["run", "--dir", missingExecutable.backlog, "--profile", "gone"], missingExecutable.env, missingExecutable.repo);
    const secret = command(["run", "--dir", missingSecret.backlog, "--profile", "secret"], missingSecret.env, missingSecret.repo);
    assert.equal(unavailable.status, 1, unavailable.stdout + unavailable.stderr);
    assert.equal(secret.status, 1, secret.stdout + secret.stderr);
    assert.equal(statusOf(missingExecutable.backlog, missingExecutable.id), "pending");
    assert.equal(statusOf(missingSecret.backlog, missingSecret.id), "pending");
  } finally {
    cleanup(missingExecutable.root);
    cleanup(missingSecret.root);
  }
});

test("the core ships neither provider adapters nor their setup, discovery or launch lifecycle", () => {
  const profiles = readFileSync(join(SCRIPTS_DIR, "agent-profiles.mjs"), "utf8");
  const runner = readFileSync(join(SCRIPTS_DIR, "run-loop.mjs"), "utf8");
  const cli = readFileSync(join(SCRIPTS_DIR, "cli.mjs"), "utf8");
  const manifest = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
  const lock = readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8");

  assert.doesNotMatch(profiles, /@clack\/prompts|referenceAdapter|modelCatalog|setupProfile|setupFleet|createAgentLaunch|MODEL_CATALOG/);
  assert.doesNotMatch(runner, /agent-launches|--launch/);
  assert.doesNotMatch(cli, /agent-launches|\blaunch\b|profile setup|profile models/);
  assert.doesNotMatch(manifest + lock, /@clack\/prompts/);
  assert.equal(existsSync(join(REPO_ROOT, "examples", "agent-adapters")), false, "provider adapters still ship with the repository");
});
