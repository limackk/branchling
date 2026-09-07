/** Guided setup remains a terminal convenience over the ordinary profile store (TL-313). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { agentProfilesPath, HOME_ENV } from "../home.mjs";
import { parseAgentProfiles, setupFleetConversation, setupProfileConversation } from "../agent-profiles.mjs";
import { SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let sequence = 0;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-setup-" + sequence++ + "-"));
  return { root, env: { ...process.env, NO_COLOR: "1", [HOME_ENV]: join(root, "home") } };
}

function transcript(answers) {
  const out = [];
  return {
    out,
    io: {
      ask: async () => answers.length ? answers.shift() : null,
      write: (text) => out.push(text),
    },
  };
}

test("a confirmed guided transcript writes one ordinary profile only at its final confirmation", async () => {
  const fx = fixture();
  const t = transcript(["generalist", "1", "/opt/agent", "Work from evidence.", "model-x", "high", "TOKEN", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  const text = readFileSync(agentProfilesPath(fx.env), "utf8");
  assert.deepEqual(parseAgentProfiles(text, agentProfilesPath(fx.env)).problems, []);
  assert.match(text, /name: generalist/);
  assert.match(text, /secret_env: "TOKEN"/);
  assert.match(t.out.join(""), /Profile summary/);
  assert.match(t.out.join(""), /reusable local recipe/);
  assert.match(t.out.join(""), /Choose how Branchling will start this agent/);
  assert.match(t.out.join(""), /Use an executable already installed/);
});

test("cancel, EOF and invalid values leave the store byte-for-byte unchanged", async () => {
  const fx = fixture();
  const path = agentProfilesPath(fx.env);
  // The directory is intentionally made by this fixture rather than by a read.
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(fx.root, "home", "config"), { recursive: true });
  writeFileSync(path, "profiles:\n", "utf8");
  const before = readFileSync(path, "utf8");
  for (const answers of [
    ["cancel"],
    ["generalist", "1", "/opt/agent", "Work", "", "", "", "3"],
    ["Not A Slug", "1", "/opt/agent", "Work", "", "", "", "1"],
    [],
  ]) {
    const result = await setupProfileConversation(transcript(answers).io, fx.env);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path, "utf8"), before);
  }
});

test("back revisits a field before the one shared write", async () => {
  const fx = fixture();
  const t = transcript(["generalist", "1", "/opt/agent", "Work", "model-old", "back", "model-new", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(readFileSync(agentProfilesPath(fx.env), "utf8").includes('model: "model-new"'));
});

test("a shipped reference is copied locally without downloading or launching it", async () => {
  const fx = fixture();
  const destination = join(fx.root, "adapters", "claude.mjs");
  const t = transcript(["generalist", "2", "1", destination, "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(destination), true);
  assert.match(readFileSync(destination, "utf8"), /Claude Code/);
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a fleet interview writes one ordinary local launch and cancellation writes neither store", async () => {
  const fx = fixture();
  const adapter = join(fx.root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n", "utf8");
  const profile = await setupProfileConversation(transcript(["developer", "1", adapter, "Work", "", "", "", "1"]).io, fx.env);
  assert.equal(profile.ok, true);
  const backlog = join(fx.root, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env: fx.env }).status, 0);
  const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev]\n", "utf8");
  const beforeProfiles = readFileSync(agentProfilesPath(fx.env), "utf8");
  const cancelled = await setupFleetConversation(transcript(["cancel"]).io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(cancelled.ok, false);
  assert.equal(readFileSync(agentProfilesPath(fx.env), "utf8"), beforeProfiles);
  const created = await setupFleetConversation(transcript(["team", "developer", "", "1"]).io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.launch.profile_for, "dev=developer");
});

test("the process refuses interactive setup in a pipe and refuses JSON", () => {
  const fx = fixture();
  const piped = spawnSync(process.execPath, [CLI, "profile", "setup"], { encoding: "utf8", env: fx.env });
  assert.equal(piped.status, 2);
  assert.match(piped.stderr, /needs a terminal/);
  assert.equal(existsSync(agentProfilesPath(fx.env)), false);
  const json = spawnSync(process.execPath, [CLI, "profile", "setup", "--json"], { encoding: "utf8", env: fx.env });
  assert.equal(json.status, 2);
  assert.match(json.stderr, /interactive and takes no names or flags/);
});

test("guided setup help is readable without opening an interactive session", () => {
  const fx = fixture();
  const help = spawnSync(process.execPath, [CLI, "profile", "setup", "--help"], { encoding: "utf8", env: fx.env });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /creates one local agent profile/);
  assert.match(help.stdout, /Arrow keys and Enter/);
});
