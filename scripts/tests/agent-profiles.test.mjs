/** Local provider-neutral agent profiles (TL-288). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { HOME_ENV, agentProfilesPath } from "../home.mjs";
import { parseAgentProfiles } from "../agent-profiles.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// The fixtures override this path again per user. The file-level isolation is
// still required: a new helper or an omitted env must never fall back to the
// developer's real profile store.
isolateHome("agent-profiles");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-agent-profiles-" + counter++ + "-"));
  const home = join(root, "home");
  return { root, home, env: { ...process.env, NO_COLOR: "1", [HOME_ENV]: home } };
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 30_000, env });
}

test("two users keep same-named profiles with distinct provider details outside a repository", () => {
  const first = fixture();
  const second = fixture();
  const a = run(["profile", "create", "developer", "--adapter", "claude -p", "--model", "opus", "--effort", "high", "--prompt", "Implement the task."], first.env);
  const b = run(["profile", "create", "developer", "--adapter", "codex exec", "--model", "gpt-5", "--effort", "medium", "--prompt", "Review the task."], second.env);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.notEqual(agentProfilesPath(first.env), agentProfilesPath(second.env));
  assert.equal(existsSync(agentProfilesPath(first.env)), true);

  const shown = run(["profile", "show", "developer", "--json"], first.env);
  assert.equal(shown.status, 0, shown.stderr);
  const json = JSON.parse(shown.stdout);
  assert.equal(json.kind, "agent-profiles");
  assert.equal(json.profile.adapter, "claude -p");
  assert.equal(json.profile.model, "opus");
  assert.equal(json.profile.effort, "high");
  assert.equal(json.profile.prompt, "Implement the task.");
  assert.equal(run(["profile", "show", "developer"], second.env).stdout.includes("codex exec"), true);
});

test("create, list, update and remove are non-interactive, and do not edit user preferences", () => {
  const fx = fixture();
  const config = join(fx.home, "config", "config.yaml");
  mkdirSync(join(fx.home, "config"), { recursive: true });
  writeFileSync(config, "actor: local:me\n", "utf8");
  const before = readFileSync(config, "utf8");

  assert.equal(run(["profile", "create", "review", "--adapter", "codex exec", "--prompt", "Check evidence."], fx.env).status, 0);
  const listed = run(["profile", "list"], fx.env);
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /review/);
  assert.equal(run(["profile", "update", "review", "--model", "gpt-5.2", "--effort", "high"], fx.env).status, 0);
  const updated = run(["profile", "show", "review", "--json"], fx.env);
  assert.equal(JSON.parse(updated.stdout).profile.model, "gpt-5.2");
  assert.equal(run(["profile", "remove", "review"], fx.env).status, 0);
  assert.equal(readFileSync(config, "utf8"), before, "profiles rewrote the existing user preferences");
});

test("unknown fields, duplicate names, bad prompt files and copied credentials are refused with a remedy", () => {
  const fx = fixture();
  const bad = [
    "profiles:",
    "  - name: duplicate",
    "    adapter: 'codex exec'",
    "    prompt: 'one'",
    "    provider: forbidden",
    "  - name: duplicate",
    "    adapter: 'claude -p'",
    "    prompt_file: missing.md",
  ].join("\n") + "\n";
  const parsed = parseAgentProfiles(bad, agentProfilesPath(fx.env));
  assert.ok(parsed.problems.some((p) => /unknown profile field `provider`/.test(p)));
  assert.ok(parsed.problems.some((p) => /duplicate profile `duplicate`/.test(p)));

  mkdirSync(join(fx.home, "config"), { recursive: true });
  writeFileSync(agentProfilesPath(fx.env), bad, "utf8");
  const unreadable = run(["profile", "list"], fx.env);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /cannot read local agent profiles/);
  assert.match(unreadable.stderr, /unknown profile field/);

  writeFileSync(agentProfilesPath(fx.env), "profiles:\n", "utf8");
  const secret = run(["profile", "create", "unsafe", "--adapter", "runner --api_key=actual-secret", "--prompt", "Do work."], fx.env);
  assert.equal(secret.status, 1);
  assert.match(secret.stderr, /credential value/);
  assert.match(secret.stderr, /environment-variable reference/);
  assert.equal(run(["profile", "create", "safe", "--adapter", "runner --api_key=$PROVIDER_KEY", "--prompt", "Do work."], fx.env).status, 0);
});

test("a prompt file is read, while a missing one is refused before the profile is written", () => {
  const fx = fixture();
  const prompt = join(fx.root, "prompt.md");
  writeFileSync(prompt, "Use only the task evidence.\n", "utf8");
  const good = run(["profile", "create", "file-prompt", "--adapter", "kimi", "--prompt-file", prompt], fx.env);
  assert.equal(good.status, 0, good.stderr);
  assert.match(run(["profile", "show", "file-prompt"], fx.env).stdout, /Use only the task evidence/);
  const missing = run(["profile", "create", "missing", "--adapter", "glm", "--prompt-file", join(fx.root, "gone.md")], fx.env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /prompt_file cannot be read/);
});
