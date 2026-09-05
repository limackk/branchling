/**
 * TL-274: one instruction source, one skill source, two host adapters.
 *
 * The fixture has a positive control: it contains a real skill and two real
 * hook commands. A guard that accidentally scans an empty tree cannot pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { auditAgentFiles } from "../check-agent-files.mjs";
import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("agent-file-parity");

const SKILL_TEXT = [
  "---",
  "name: one",
  "description: One test skill.",
  "---",
  "",
  "# One",
  "",
].join("\n");

function write(path, text) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text, "utf8");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-agent-files-"));
  write(join(root, "AGENTS.md"), "# Shared instructions\n");
  write(join(root, "CLAUDE.md"), "@AGENTS.md\n");
  write(join(root, ".agents", "skills", "one", "SKILL.md"), SKILL_TEXT);
  mkdirSync(join(root, ".claude", "skills"), { recursive: true });
  symlinkSync("../../.agents/skills/one", join(root, ".claude", "skills", "one"), "dir");

  const claudeHooks = {
    hooks: { PostToolUse: [
      { matcher: "*", hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/scripts/activity-hook.sh" }] },
      { matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: "node $CLAUDE_PROJECT_DIR/scripts/cli.mjs regen-hook" }] },
    ] },
  };
  const codexHooks = {
    hooks: { PostToolUse: [
      { matcher: "*", hooks: [{ type: "command", command: "\"$(git rev-parse --show-toplevel)/scripts/activity-hook.sh\"" }] },
      { matcher: "Edit|Write", hooks: [{ type: "command", command: "node \"$(git rev-parse --show-toplevel)/scripts/cli.mjs\" regen-hook" }] },
    ] },
  };
  write(join(root, ".claude", "settings.json"), JSON.stringify(claudeHooks));
  write(join(root, ".codex", "hooks.json"), JSON.stringify(codexHooks));
  return root;
}

test("the repository exposes one instruction source and every skill through a Claude symlink", () => {
  const result = auditAgentFiles(REPO_ROOT);
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.ok(result.skills > 0, "the guard passed without observing a skill");
  assert.ok(result.hooks > 0, "the guard passed without observing a hook command");
});

test("the repository records the shared-source choice as a decision", () => {
  const entries = readFileSync(join(REPO_ROOT, "backlog", "history", "TL-274.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(entries.some((entry) => entry.field === "__decision__" &&
    String(entry.reason || "").includes("AGENTS.md") &&
    String(entry.reason || "").includes(".agents/skills")));
});

test("a complete shared setup passes", () => {
  const result = auditAgentFiles(fixture());
  assert.equal(result.ok, true, result.problems.join("\n"));
  assert.equal(result.skills, 1);
  assert.equal(result.hooks, 2);
});

test("Claude instruction drift fails", () => {
  const root = fixture();
  write(join(root, "CLAUDE.md"), "@AGENTS.md\n\nA private second instruction.\n");
  assert.match(auditAgentFiles(root).problems.join("\n"), /single import/);
});

test("a copied Claude skill fails even when its content agrees", () => {
  const root = fixture();
  const link = join(root, ".claude", "skills", "one");
  rmSync(link);
  write(join(link, "SKILL.md"), SKILL_TEXT);
  assert.match(auditAgentFiles(root).problems.join("\n"), /second copy/);
});

test("an empty canonical skill tree cannot earn a green result", () => {
  const root = fixture();
  rmSync(join(root, ".agents", "skills", "one"), { recursive: true });
  rmSync(join(root, ".claude", "skills", "one"));
  assert.match(auditAgentFiles(root).problems.join("\n"), /no canonical skills/);
});

test("a Claude-only variable or a different hook command fails for Codex", () => {
  const root = fixture();
  const path = join(root, ".codex", "hooks.json");
  write(path, JSON.stringify({ hooks: { PostToolUse: [
    { matcher: "*", hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/scripts/other.sh" }] },
  ] } }));
  const problems = auditAgentFiles(root).problems.join("\n");
  assert.match(problems, /different repository scripts/);
  assert.match(problems, /Claude-only environment variable/);
});
