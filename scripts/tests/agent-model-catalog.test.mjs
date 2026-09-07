/** Model catalogues are opt-in adapter facts, never guesses in the core (TL-341). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV, agentProfilesPath } from "../home.mjs";
import { modelCatalog, setupProfileConversation } from "../agent-profiles.mjs";
import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("agent-model-catalog");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const OLLAMA = join(REPO_ROOT, "examples", "agent-adapters", "ollama.mjs");
const CODEX = join(REPO_ROOT, "examples", "agent-adapters", "codex-cli.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-model-catalog-"));
  const bin = join(root, "bin");
  const ollama = join(bin, "ollama");
  mkdirSync(bin, { recursive: true });
  writeFileSync(ollama, "#!/bin/sh\nif [ \"$1\" = list ]; then printf '%s\\n' '{\"name\":\"qwen2.5-coder:7b\"}' '{\"name\":\"small\"}'; else printf 'ollama 1.0\\n'; fi\n", "utf8");
  chmodSync(ollama, 0o755);
  return { root, env: { ...process.env, NO_COLOR: "1", PATH: bin + ":" + process.env.PATH, [HOME_ENV]: join(root, "home") } };
}
function transcript(answers) {
  return { io: { ask: async () => answers.length ? answers.shift() : null, write: () => {} } };
}

test("Ollama lists only installed names and refuses a selected name that is absent", () => {
  const fx = fixture();
  const listed = modelCatalog({ adapter: OLLAMA, model: "qwen2.5-coder:7b" }, fx.env);
  assert.deepEqual(listed.models, ["qwen2.5-coder:7b", "small"]);
  assert.equal(listed.ok, true);
  const missing = modelCatalog({ adapter: OLLAMA, model: "not-pulled" }, fx.env);
  assert.equal(missing.ok, false);
  assert.equal(missing.state, "selected-model-missing");
});

test("Codex reports that account-specific aliases cannot be verified", () => {
  const result = modelCatalog({ adapter: CODEX, model: "account-alias" }, fixture().env);
  assert.equal(result.ok, true);
  assert.equal(result.state, "not-verifiable");
  assert.match(result.detail, /cannot list account-specific model aliases/);
});

test("the explicit profile models command emits bounded JSON without secrets", () => {
  const fx = fixture();
  const create = spawnSync(process.execPath, [CLI, "profile", "create", "local", "--adapter", OLLAMA, "--model", "qwen2.5-coder:7b", "--prompt", "Work.", "--secret-env", "TEST_ONLY_SECRET"], { env: { ...fx.env, TEST_ONLY_SECRET: "sk-this-must-not-appear" }, encoding: "utf8" });
  assert.equal(create.status, 0, create.stderr);
  const catalog = spawnSync(process.execPath, [CLI, "profile", "models", "local", "--json"], { env: { ...fx.env, TEST_ONLY_SECRET: "sk-this-must-not-appear" }, encoding: "utf8" });
  assert.equal(catalog.status, 0, catalog.stderr);
  assert.deepEqual(JSON.parse(catalog.stdout).models, ["qwen2.5-coder:7b", "small"]);
  assert.doesNotMatch(catalog.stdout + catalog.stderr, /sk-this-must-not-appear/);
});

test("Ollama discovery is an explicit setup choice and writes the selected local model", async () => {
  const fx = fixture();
  const result = await setupProfileConversation(transcript(["local", "1", "4", "", "Work.", "2", "1", "", "", "1"]).io, fx.env);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(readFileSync(agentProfilesPath(fx.env), "utf8"), /model: "qwen2\.5-coder:7b"/);
});
