/**
 * The instructions pointer reaches Claude Code in a repository set up from
 * nothing (TL-474).
 *
 * Claude Code loads CLAUDE.md and not AGENTS.md, so a fresh repository given
 * AGENTS.md alone had a pointer every other agent could read and Claude Code
 * could not. What Claude Code reads is CLAUDE.md with its `@file` imports
 * expanded; `claudeSees` below is exactly that, one level deep, so the assertion
 * is about what the session receives rather than about which files exist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PRODUCT_NAME } from "../product.mjs";
import { CLAUDE_IMPORT_LINE, NUDGE_CLOSE } from "../instructions.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("init-agent-pointer");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function repo(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-agent-pointer-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, "utf8");
  return dir;
}

function init(dir, ...flags) {
  const r = spawnSync(process.execPath, [CLI, "init", "--dir", join(dir, "backlog"), "--no-example", ...flags],
    { cwd: dir, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r;
}

function read(dir, name) {
  const p = join(dir, name);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** CLAUDE.md with each `@file` line replaced by that file, as Claude Code loads it. */
function claudeSees(dir) {
  const own = read(dir, "CLAUDE.md");
  if (own === null) return "";
  return own.split("\n").map((l) => (l.startsWith("@") ? read(dir, l.slice(1).trim()) || "" : l)).join("\n");
}

const POINTER = PRODUCT_NAME + " instructions overview";
const count = (text) => text.split(NUDGE_CLOSE).length - 1;

test("from nothing, Claude Code is shown the pointer exactly once", () => {
  const dir = repo();
  const r = init(dir);
  assert.equal(count(read(dir, "AGENTS.md")), 1, "the editor-neutral file carries no pointer");
  assert.equal(read(dir, "CLAUDE.md"), CLAUDE_IMPORT_LINE + "\n", "CLAUDE.md is more than the import bridge");
  assert.ok(claudeSees(dir).includes(POINTER), "Claude Code loads nothing naming the command");
  assert.equal(count(claudeSees(dir)), 1, "Claude Code reads the pointer twice");
  assert.match(r.stdout, /CLAUDE\.md: created/, "a file written into their repository went unreported");
});

test("an existing CLAUDE.md is appended to, and AGENTS.md is not invented", () => {
  const dir = repo({ "CLAUDE.md": "# Theirs\n" });
  init(dir);
  assert.ok(read(dir, "CLAUDE.md").startsWith("# Theirs\n"), "their file was rewritten");
  assert.equal(count(read(dir, "CLAUDE.md")), 1);
  assert.equal(read(dir, "AGENTS.md"), null, "a second agent file was invented");
});

test("an existing AGENTS.md alone is appended to, and CLAUDE.md is not invented", () => {
  const dir = repo({ "AGENTS.md": "# Theirs\n" });
  init(dir);
  assert.ok(read(dir, "AGENTS.md").startsWith("# Theirs\n"), "their file was rewritten");
  assert.equal(count(read(dir, "AGENTS.md")), 1);
  assert.equal(read(dir, "CLAUDE.md"), null, "their choice of agent file was overruled");
});

test("a CLAUDE.md importing AGENTS.md gets no second copy of the pointer", () => {
  const dir = repo({ "CLAUDE.md": CLAUDE_IMPORT_LINE + "\n", "AGENTS.md": "# Theirs\n" });
  init(dir);
  assert.equal(read(dir, "CLAUDE.md"), CLAUDE_IMPORT_LINE + "\n", "the importing file was appended to");
  assert.equal(count(claudeSees(dir)), 1, "Claude Code reads the pointer twice");
});

test("`--no-nudge` from nothing creates neither file", () => {
  const dir = repo();
  init(dir, "--no-nudge");
  assert.equal(read(dir, "CLAUDE.md"), null);
  assert.equal(read(dir, "AGENTS.md"), null);
});
