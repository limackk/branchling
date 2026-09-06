/** A named generalist profile serves the same queue as the legacy scalar hand (TL-292). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("run-generalist-profile");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
function run(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 120_000, env,
  });
}
function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}
function field(backlog, id, name) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(new RegExp("^" + name + ":\\s*(.*)$", "m")) || [])[1];
}

test("one named profile serves roleless and roleful agent work, but not human work", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-generalist-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const home = join(root, "home");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: home, BACKLOG_STATE_DIR: join(root, "state") };
  try {
    assert.equal(run(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const config = join(backlog, "config.yaml");
    writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [developer, reviewer]\n", "utf8");

    const add = (title, role, executor = "") => {
      const created = run(["new", "--dir", backlog, "--title", title], env, repo);
      assert.equal(created.status, 0, created.stderr);
      const id = created.stdout.match(/[A-Z]+-\d+/)[0];
      const file = taskFile(backlog, id);
      const text = readFileSync(file, "utf8")
        .replace(/^role: .*$/m, "role: " + JSON.stringify(role))
        .replace(/^executor: .*$/m, "executor: " + JSON.stringify(executor))
        .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-runs\n    bash: "test -f ' + id + '.done"\n---')
        .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]");
      writeFileSync(file, text, "utf8");
      return id;
    };
    const developer = add("Developer work", "developer");
    const reviewer = add("Review work", "reviewer");
    const roleless = add("General work", "");
    const human = add("Human decision", "", "human");
    assert.equal(run(["build", "--dir", backlog], env, repo).status, 0);

    const rolesSeen = join(root, "roles.txt");
    const adapter = join(root, "generalist-adapter");
    writeFileSync(adapter, [
      "#!/bin/sh",
      "input=$(cat)",
      "printf '%s\\n' \"$BRANCHLING_ROLE\" >> " + JSON.stringify(rolesSeen),
      "id=$(printf '%s' \"$input\" | sed -n 's/^id: //p' | head -n 1)",
      "touch \"$id.done\"",
    ].join("\n") + "\n", "utf8");
    chmodSync(adapter, 0o755);
    const profile = run(["profile", "create", "generalist", "--adapter", adapter,
      "--model", "model-x", "--effort", "careful", "--prompt", "Complete the task from evidence."], env, repo);
    assert.equal(profile.status, 0, profile.stderr);

    const result = run(["run", "--dir", backlog, "--actor", "agent:generalist", "--profile", "generalist", "--max-attempts", "1", "--json"], env, repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(field(backlog, developer, "status"), "done");
    assert.equal(field(backlog, reviewer, "status"), "done");
    assert.equal(field(backlog, roleless, "status"), "done");
    assert.equal(field(backlog, human, "status"), "pending", "an agent profile was given human-only work");
    assert.deepEqual(readFileSync(rolesSeen, "utf8").replace(/\n$/, "").split("\n").sort(), ["", "developer", "reviewer"],
      "the generalist did not receive every eligible role exactly once");
    assert.deepEqual(JSON.parse(result.stdout).waitingForExecutor, [{ executor: "human", count: 1, ids: [human] }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
