/**
 * `doctor` reports the agent-facing setup — the instructions pointer, the
 * packaged skill and the git gates (TL-475).
 *
 * Each piece is optional, so none of these rows may ever be an error: the
 * assertions check the status AND that the exit code stays 0. Every absent
 * state has a positive control where the same row is green, so a row that
 * always printed one answer would fail here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLAUDE_IMPORT_LINE, NUDGE_CLOSE, NUDGE_OPEN_PREFIX, NUDGE_VERSION } from "../instructions.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("doctor-agent-setup");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 120_000 });
}

function repo(files = {}, ...initFlags) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-doctor-agent-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body, "utf8");
  const r = run(dir, ["init", "--dir", "backlog", "--no-example", ...initFlags]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return dir;
}

function rows(dir) {
  const r = run(dir, ["doctor", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, "an optional piece of setup failed doctor: " + r.stdout + r.stderr);
  const byId = {};
  for (const c of JSON.parse(r.stdout).checks) byId[c.id] = c;
  return byId;
}

test("a repository with no agent file at all is warned, with the command that writes one", () => {
  const row = rows(repo({}, "--no-nudge"))["agent-pointer"];
  assert.equal(row.status, "warn");
  assert.match(row.fix, /instructions --update-nudge/);
});

test("a pointer from an older release is reported as stale", () => {
  const dir = repo();
  const path = join(dir, "AGENTS.md");
  writeFileSync(path, readFileSync(path, "utf8").replace(NUDGE_OPEN_PREFIX + " v" + NUDGE_VERSION, NUDGE_OPEN_PREFIX + " v0"), "utf8");
  const row = rows(dir)["agent-pointer"];
  assert.equal(row.status, "warn");
  assert.match(row.detail, /v0/);
});

test("a pointer only in AGENTS.md is named as invisible to Claude Code, without failing", () => {
  const dir = repo({ "AGENTS.md": "# Theirs\n" });
  const row = rows(dir)["agent-pointer"];
  assert.equal(row.status, "info");
  assert.ok(row.fix.includes(CLAUDE_IMPORT_LINE), "the remedy does not name the import line");
});

test("positive control: init from nothing leaves the pointer green", () => {
  const row = rows(repo())["agent-pointer"];
  assert.equal(row.status, "ok", JSON.stringify(row));
});

test("positive control: a pointer written into CLAUDE.md itself is green", () => {
  const dir = repo({ "CLAUDE.md": "# Theirs\n" });
  assert.ok(readFileSync(join(dir, "CLAUDE.md"), "utf8").includes(NUDGE_CLOSE));
  assert.equal(rows(dir)["agent-pointer"].status, "ok");
});

test("the packaged skill: absent names `skills install`, installed is green", () => {
  const absent = rows(repo())["agent-skill"];
  assert.equal(absent.status, "info");
  assert.match(absent.fix, /skills install/);
  assert.equal(rows(repo({}, "--skills"))["agent-skill"].status, "ok");
});

test("the git gates: absent names `hooks print`, installed is green", () => {
  const dir = repo();
  const absent = rows(dir)["git-hooks"];
  assert.equal(absent.status, "info");
  assert.match(absent.fix, /hooks print/);
  const installed = run(dir, ["hooks", "install", "--dir", "backlog"]);
  assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  assert.equal(rows(dir)["git-hooks"].status, "ok");
});
