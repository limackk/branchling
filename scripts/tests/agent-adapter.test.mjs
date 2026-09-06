/** One executable profile adapter contract (TL-289). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV } from "../home.mjs";
import { handFor, parseRunArgs } from "../run-loop.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-adapter");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
function run(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 120_000, env });
}

test("a provider-neutral executable receives the stable profile contract and closes through run", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-adapter-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  const home = join(root, "home");
  const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: home, BACKLOG_STATE_DIR: join(root, "state") };
  try {
    assert.equal(run(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
    const created = run(["new", "--dir", backlog, "--title", "Adapter contract"], env, repo);
    const id = created.stdout.match(/[A-Z]+-\d+/)[0];
    const taskPath = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
    writeFileSync(taskPath, readFileSync(taskPath, "utf8")
      .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: adapter-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: adapter-done]"), "utf8");
    assert.equal(run(["build", "--dir", backlog], env, repo).status, 0);

    const seen = join(root, "received.txt");
    const adapter = join(root, "neutral-runner");
    writeFileSync(adapter, [
      "#!/bin/sh",
      "input=$(cat)",
      "printf '%s\\n' \"$BRANCHLING_PROFILE|$BRANCHLING_PROMPT|$BRANCHLING_MODEL|$BRANCHLING_EFFORT|$BRANCHLING_ACTOR|$BRANCHLING_ROLE|$BRANCHLING_TASK|$BRANCHLING_DIR|$BRANCHLING_REPOSITORY\" > " + JSON.stringify(seen),
      "id=$(printf '%s' \"$input\" | sed -n 's/^id: //p' | head -n 1)",
      "touch \"$id.done\"",
    ].join("\n") + "\n", "utf8");
    chmodSync(adapter, 0o755);
    const profile = run(["profile", "create", "portable", "--adapter", adapter, "--model", "model-x", "--effort", "careful", "--prompt", "Work only from evidence."], env, repo);
    assert.equal(profile.status, 0, profile.stderr);

    // An explicit profile must beat the legacy shell default, otherwise merely
    // having old automation in a shell profile would silently select the wrong hand.
    const result = run(["run", "--dir", backlog, "--actor", "agent:runner", "--profile", "portable"], {
      ...env, BACKLOG_AGENT_COMMAND: "false",
    }, repo);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const received = readFileSync(seen, "utf8");
    assert.match(received, new RegExp("portable\\|Work only from evidence\\.\\|model-x\\|careful\\|agent:runner\\|\\|" + id));
    assert.match(received, new RegExp(backlog.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(received, new RegExp(repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout, /1 closed/);

    const production = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs")).map((f) => readFileSync(join(SCRIPTS_DIR, f), "utf8")).join("\n");
    assert.equal(production.includes("neutral-runner"), false, "the fixture provider leaked into production source");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile role mappings use the same hand selection rules as raw commands", () => {
  const plan = parseRunArgs(["--profile", "general", "--profile-for", "review=reviewer"]);
  assert.deepEqual(handFor(plan, ""), { kind: "profile", name: "general" });
  assert.deepEqual(handFor(plan, "review"), { kind: "profile", name: "reviewer" });
  assert.equal(handFor(plan, "developer"), null);
  assert.throws(
    () => parseRunArgs(["--agent-for", "review=runner", "--profile-for", "review=reviewer"]),
    /two hands named for role/
  );
});
