/** Project-only profiles are private machine configuration, not backlog data (TL-337). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV, agentProfilesPath } from "../home.mjs";
import { createAgentProfile, projectAgentProfilesPath, readAvailableAgentProfiles, resolveAgentProfile, setupProfileConversation } from "../agent-profiles.mjs";
import { createAgentLaunch, resolveAgentLaunch } from "../agent-launches.mjs";

let sequence = 0;
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-project-profile-" + sequence++ + "-"));
  return { root, first: join(root, "first", "backlog"), second: join(root, "second", "backlog"), env: { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home") } };
}
function transcript(answers) {
  return { io: { ask: async () => answers.length ? answers.shift() : null, write: () => {} } };
}

test("a project profile keeps every provider setting out of the repository and another project", () => {
  const fx = fixture();
  const created = createAgentProfile("local-review", {
    adapter: "/opt/local-review", model: "local-model", effort: "high",
    prompt: "Review this repository only.", secret_env: "LOCAL_TOKEN",
  }, fx.env, fx.first);
  assert.equal(created.ok, true, JSON.stringify(created));
  const path = projectAgentProfilesPath(fx.first, fx.env);
  assert.equal(existsSync(path), true);
  assert.equal(path.startsWith(fx.first), false);
  assert.match(readFileSync(path, "utf8"), /local-model/);
  assert.match(readFileSync(path, "utf8"), /LOCAL_TOKEN/);
  assert.equal(resolveAgentProfile("local-review", fx.env, fx.first).ok, true);
  assert.equal(resolveAgentProfile("local-review", fx.env, fx.second).kind, "missing-profile");
});

test("guided project setup copies its adapter beside the project profile store", async () => {
  const fx = fixture();
  const t = transcript(["project-agent", "project", "1", "1", "", "Project work.", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env, { projectRoot: fx.first });
  assert.equal(result.ok, true, JSON.stringify(result));
  const path = projectAgentProfilesPath(fx.first, fx.env);
  assert.equal(existsSync(path), true);
  assert.match(readFileSync(path, "utf8"), /project-agent/);
  assert.equal(existsSync(agentProfilesPath(fx.env)), false);
  assert.equal(existsSync(join(dirname(path), "adapters", "claude-code.mjs")), true);
});

test("global and project names are refused rather than resolved by precedence", () => {
  const fx = fixture();
  assert.equal(createAgentProfile("developer", { adapter: "/opt/global", prompt: "Global work." }, fx.env).ok, true);
  assert.equal(createAgentProfile("developer", { adapter: "/opt/project", prompt: "Project work." }, fx.env, fx.first).ok, false);
  const available = readAvailableAgentProfiles(fx.first, fx.env);
  assert.equal(available.problems.length, 0, available.problems.join("\n"));
});

test("a project fleet is shared by linked worktrees but not another repository", () => {
  const fx = fixture();
  const repo = join(fx.root, "repo"); const worktree = join(fx.root, "worktree");
  assert.equal(spawnSync("git", ["init", repo]).status, 0);
  assert.equal(spawnSync("git", ["-C", repo, "config", "user.email", "test@example.com"]).status, 0);
  assert.equal(spawnSync("git", ["-C", repo, "config", "user.name", "Test"]).status, 0);
  writeFileSync(join(repo, "README.md"), "test\n", "utf8");
  assert.equal(spawnSync("git", ["-C", repo, "add", "README.md"]).status, 0);
  assert.equal(spawnSync("git", ["-C", repo, "-c", "commit.gpgsign=false", "commit", "--no-verify", "-m", "initial"]).status, 0);
  assert.equal(spawnSync("git", ["-C", repo, "worktree", "add", "-b", "scope-test", worktree]).status, 0);
  assert.equal(createAgentProfile("local", { adapter: "/opt/local", prompt: "Project work." }, fx.env, repo).ok, true);
  assert.equal(createAgentLaunch("project-team", "local", {}, fx.env, repo).ok, true);
  assert.equal(resolveAgentLaunch("project-team", fx.env, worktree).ok, true);
  assert.equal(resolveAgentLaunch("project-team", fx.env, fx.second).kind, "missing-launch");
});
