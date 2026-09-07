/** Guided setup remains a terminal convenience over the ordinary profile store (TL-313). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { agentProfilesPath, HOME_ENV, homePaths } from "../home.mjs";
import { clackTextAnswer, parseAgentProfiles, setupFailureMessage, setupFleetConversation, setupModes, setupProfileConversation, setupTextOptions } from "../agent-profiles.mjs";
import { projectAgentLaunchesPath } from "../agent-launches.mjs";
import { PRODUCT_NAME as N } from "../product.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("agent-profile-setup");

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

test("an accepted empty Clack text result reaches setup as a defaultable value", () => {
  assert.equal(clackTextAnswer(undefined), "");
  assert.equal(clackTextAnswer("chosen"), "chosen");
  assert.equal(clackTextAnswer("cancelled", (value) => value === "cancelled"), null);
});

test("guided text questions render an accepted blank as empty, not undefined", () => {
  assert.deepEqual(setupTextOptions("Reasoning effort: "), {
    message: "Reasoning effort",
    placeholder: "",
  });
});

test("a confirmed guided transcript writes one ordinary profile only at its final confirmation", async () => {
  const fx = fixture();
  const t = transcript(["generalist", "2", "/opt/agent", "Work from evidence.", "model-x", "high", "TOKEN", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  const text = readFileSync(agentProfilesPath(fx.env), "utf8");
  assert.deepEqual(parseAgentProfiles(text, agentProfilesPath(fx.env)).problems, []);
  assert.match(text, /name: generalist/);
  assert.match(text, /secret_env: "TOKEN"/);
  assert.match(t.out.join(""), /Profile summary/);
  assert.match(t.out.join(""), /reusable local recipe/);
  assert.ok(t.out.join("").includes("Choose how " + N + " will start this agent"));
  assert.ok(t.out.join("").includes("Use my own " + N + " adapter"));
  assert.match(t.out.join(""), /This is not `claude` and not a model name/);
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
    ["generalist", "2", "/opt/agent", "Work", "", "", "", "3"],
    ["Not A Slug", "2", "/opt/agent", "Work", "", "", "", "1"],
    [],
  ]) {
    const result = await setupProfileConversation(transcript(answers).io, fx.env);
    assert.equal(result.ok, false);
    assert.equal(readFileSync(path, "utf8"), before);
  }
});

test("back revisits a field before the one shared write", async () => {
  const fx = fixture();
  const t = transcript(["generalist", "2", "/opt/agent", "Work", "model-old", "back", "model-new", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(readFileSync(agentProfilesPath(fx.env), "utf8").includes('model: "model-new"'));
});

test("back from adapter source revisits the profile identity before writing", async () => {
  const fx = fixture();
  const t = transcript(["first", "3", "second", "2", "/opt/agent", "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), /name: second/);
});

test("a shipped reference accepts its user-owned recommended destination without downloading or launching it", async () => {
  const fx = fixture();
  const destination = join(homePaths(fx.env).config, "adapters", "claude-code.mjs");
  const t = transcript(["generalist", "1", "1", "", "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(destination), true);
  assert.match(readFileSync(destination, "utf8"), /Claude Code/);
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(t.out.join(""), /Recommended:/);
  assert.match(t.out.join(""), /provide another path/);
});

test("a supplied adapter destination overrides the recommendation", async () => {
  const fx = fixture();
  const destination = join(fx.root, "adapters", "claude.mjs");
  const t = transcript(["generalist", "1", "1", destination, "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(existsSync(destination), true);
  assert.equal(existsSync(join(homePaths(fx.env).config, "adapters", "claude-code.mjs")), false);
});

test("the recommended copied path and generalist prompt both accept Enter", async () => {
  const fx = fixture();
  const t = transcript(["generalist", "1", "1", "", "", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  const text = readFileSync(agentProfilesPath(fx.env), "utf8");
  assert.match(text, /prompt: "Implement the task with evidence\."/);
  assert.match(t.out.join(""), new RegExp("Copy a shipped reference adapter[\\s\\S]*Use my own " + N + " adapter"));
});

test("an Ollama reference names and requires its local model", async () => {
  const fx = fixture();
  const t = transcript(["local", "1", "4", "", "", "1", "", "qwen2.5-coder:7b", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), /model: "qwen2\.5-coder:7b"/);
  assert.match(t.out.join(""), /Ollama needs a pulled model name/);
  assert.match(t.out.join(""), /A model identifier is required/);
});

test("back returns from a reference destination to the adapter list without writing", async () => {
  const fx = fixture();
  const t = transcript(["agent", "1", "1", "back", "2", "", "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), /aider-api\.mjs/);
});

test("back from the reference list permits choosing a custom adapter", async () => {
  const fx = fixture();
  const t = transcript(["agent", "1", "back", "2", "/opt/custom-adapter", "Work", "", "", "", "1"]);
  const result = await setupProfileConversation(t.io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), /custom-adapter/);
});

test("a fleet interview writes one ordinary local launch and cancellation writes neither store", async () => {
  const fx = fixture();
  const adapter = join(fx.root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n", "utf8");
  const profile = await setupProfileConversation(transcript(["developer", "2", adapter, "Work", "", "", "", "1"]).io, fx.env);
  assert.equal(profile.ok, true);
  const backlog = join(fx.root, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env: fx.env }).status, 0);
  const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev]\n", "utf8");
  const beforeProfiles = readFileSync(agentProfilesPath(fx.env), "utf8");
  const cancelled = await setupFleetConversation(transcript(["cancel"]).io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(cancelled.ok, false);
  assert.equal(readFileSync(agentProfilesPath(fx.env), "utf8"), beforeProfiles);
  const fleet = transcript(["team", "1", "1", "1", "1", "1"]);
  const created = await setupFleetConversation(fleet.io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.launch.profile, "developer");
  assert.equal(created.launch.profile_for, "dev=developer");
  assert.match(fleet.out.join(""), /scope: this Git project/);
  assert.match(fleet.out.join(""), /Select one or more roles by their numbers/);
  assert.match(fleet.out.join(""), /all other work: developer/);
});

test("an invalid typed fleet role selection fails before its project launch is written", async () => {
  const fx = fixture();
  const adapter = join(fx.root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n", "utf8");
  assert.equal((await setupProfileConversation(transcript(["developer", "2", adapter, "Work", "", "", "", "1"]).io, fx.env)).ok, true);
  const backlog = join(fx.root, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env: fx.env }).status, 0);
  const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [dev]\n", "utf8");
  const result = await setupFleetConversation(transcript(["bad-team", "1", "1", "missing", "cancel"]).io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(result.ok, false);
  assert.equal(existsSync(projectAgentLaunchesPath(backlog, fx.env)), false);
});

test("a fleet selects only intended roles through the typed multiple-choice fallback", async () => {
  const fx = fixture();
  const adapter = join(fx.root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n", "utf8");
  for (const name of ["generalist", "developer", "reviewer"]) {
    assert.equal((await setupProfileConversation(transcript([name, "2", adapter, "Work", "", "", "", "1"]).io, fx.env)).ok, true);
  }
  const backlog = join(fx.root, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env: fx.env }).status, 0);
  const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [docs, spec, dev, review]\n", "utf8");
  const fleet = transcript(["delivery-team", "1", "1", "3,4", "2", "3", "1"]);
  const created = await setupFleetConversation(fleet.io, fx.env, { resolveBacklog: () => ({ root: backlog }) });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.launch.profile, "generalist");
  assert.equal(created.launch.profile_for, "dev=developer,review=reviewer");
  const output = fleet.out.join("");
  assert.doesNotMatch(output, /repository role `docs`/);
  assert.doesNotMatch(output, /repository role `spec`/);
  assert.match(output, /all other work: generalist/);
  assert.match(output, /role overrides: dev=developer, review=reviewer/);
});

test("a first general profile becomes the visible fleet fallback and Clack receives a role set", async () => {
  const fx = fixture();
  const adapter = join(fx.root, "adapter"); writeFileSync(adapter, "#!/bin/sh\nexit 0\n", "utf8");
  for (const name of ["generalist", "developer"]) {
    assert.equal((await setupProfileConversation(transcript([name, "2", adapter, "Work", "", "", "", "1"]).io, fx.env)).ok, true);
  }
  const backlog = join(fx.root, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env: fx.env }).status, 0);
  const config = join(backlog, "config.yaml"); writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [docs, dev]\n", "utf8");
  const fleet = transcript(["delivery-team", "1", "2", "1"]);
  let roleOptions = null;
  fleet.io.chooseMany = async (question, options) => {
    assert.match(question, /Which repository roles should this fleet override/);
    roleOptions = options;
    return { ok: true, values: ["dev"] };
  };
  const created = await setupFleetConversation(fleet.io, fx.env, { resolveBacklog: () => ({ root: backlog }), defaultGeneralist: "generalist" });
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.deepEqual(roleOptions.map((option) => option.value), ["docs", "dev"]);
  assert.equal(created.launch.profile, "generalist");
  assert.equal(created.launch.profile_for, "dev=developer");
  assert.match(fleet.out.join(""), /not selected below will use general profile `generalist`/);
  assert.doesNotMatch(fleet.out.join(""), /Which profile should handle all other work/);
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

test("fleet prerequisites name the missing thing and the next command", () => {
  const roles = setupFailureMessage({ kind: "no-roles", problems: ["this backlog declares no roles"] });
  assert.match(roles.problem, /no roles/);
  assert.match(roles.next, /roles:/);
  const profiles = setupFailureMessage({ kind: "no-profiles", problems: ["create one profile first"] });
  assert.match(profiles.problem, /profile/i);
  assert.match(profiles.next, /profile setup/);
});

test("first setup offers general work before specialist fleet routing", () => {
  assert.deepEqual(setupModes([]).map((mode) => mode.value), ["1"]);
  assert.deepEqual(setupModes([{ name: "generalist" }]).map((mode) => mode.value), ["1", "2"]);
});
