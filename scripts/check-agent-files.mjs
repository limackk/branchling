#!/usr/bin/env node
/**
 * Guard: Codex and Claude discover one set of instructions and skills (TL-274).
 *
 * `AGENTS.md` and `.agents/skills/` are the sources. `CLAUDE.md` imports the
 * former, while `.claude/skills/` contains links to the latter. The hook files
 * remain host adapters, but they must invoke the same repository scripts.
 *
 * Tests: `node --test scripts/tests/agent-file-parity.test.mjs`
 */

import {
  existsSync, lstatSync, readFileSync, readdirSync, realpathSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK, color, errColor } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function readJson(path, problems) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) {
    problems.push(path + ": cannot read JSON: " + e.message);
    return null;
  }
}

function hookCommands(config) {
  const events = config?.hooks || {};
  return Object.values(events).flatMap((groups) => groups || [])
    .flatMap((group) => group.hooks || [])
    .filter((hook) => hook.type === "command")
    .map((hook) => String(hook.command || ""));
}

function sharedCommand(command) {
  const at = command.indexOf("scripts/");
  return at < 0 ? command : command.slice(at).replace(/["']/g, "").replace(/\s+/g, " ").trim();
}

export function auditAgentFiles(root = ROOT) {
  const problems = [];
  const agentsFile = join(root, "AGENTS.md");
  const claudeFile = join(root, "CLAUDE.md");
  if (!existsSync(agentsFile) || !readFileSync(agentsFile, "utf8").trim()) {
    problems.push("AGENTS.md: missing or empty shared instruction source");
  }
  if (!existsSync(claudeFile) || readFileSync(claudeFile, "utf8").trim() !== "@AGENTS.md") {
    problems.push("CLAUDE.md: expected the single import `@AGENTS.md`");
  }

  const canonical = join(root, ".agents", "skills");
  const claude = join(root, ".claude", "skills");
  const names = existsSync(canonical)
    ? readdirSync(canonical).filter((name) => !name.startsWith("."))
    : [];
  if (!names.length) problems.push(".agents/skills: no canonical skills found");

  for (const name of names) {
    const source = join(canonical, name);
    if (!existsSync(join(source, "SKILL.md"))) {
      problems.push(".agents/skills/" + name + ": missing SKILL.md");
      continue;
    }
    const link = join(claude, name);
    if (!existsSync(link)) {
      problems.push(".claude/skills/" + name + ": missing link to canonical skill");
      continue;
    }
    if (!lstatSync(link).isSymbolicLink()) {
      problems.push(".claude/skills/" + name + ": a second copy exists instead of a symlink");
      continue;
    }
    if (realpathSync(link) !== realpathSync(source)) {
      problems.push(".claude/skills/" + name + ": symlink points outside .agents/skills");
    }
  }

  const claudeNames = existsSync(claude)
    ? readdirSync(claude).filter((name) => !name.startsWith("."))
    : [];
  for (const name of claudeNames) {
    if (!names.includes(name)) problems.push(".claude/skills/" + name + ": no canonical skill exists");
  }

  const claudeHooks = readJson(join(root, ".claude", "settings.json"), problems);
  const codexHooks = readJson(join(root, ".codex", "hooks.json"), problems);
  const claudeCommands = hookCommands(claudeHooks).map(sharedCommand);
  const codexCommands = hookCommands(codexHooks).map(sharedCommand);
  if (!claudeCommands.length || !codexCommands.length) {
    problems.push("agent hooks: both adapters must invoke at least one command");
  } else if (JSON.stringify(claudeCommands) !== JSON.stringify(codexCommands)) {
    problems.push("agent hooks: Claude and Codex invoke different repository scripts");
  }
  if (hookCommands(codexHooks).some((command) => command.includes("CLAUDE_PROJECT_DIR"))) {
    problems.push(".codex/hooks.json: Claude-only environment variable used by Codex");
  }

  return { ok: problems.length === 0, problems, skills: names.length, hooks: codexCommands.length };
}

export function main(root = ROOT) {
  const result = auditAgentFiles(root);
  if (result.ok) {
    console.log(color.ok(MARK.ok) + " agent files: AGENTS.md + Claude import + " +
      result.skills + " shared skills + " + result.hooks + " hook commands");
    return 0;
  }
  console.error(errColor.err(MARK.err) + " agent files: shared sources disagree");
  for (const problem of result.problems) console.error("  " + problem);
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
