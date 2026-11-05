/**
 * A filter value or a role outside the backlog's vocabulary is a refusal
 * envelope, not a usage error (TL-559).
 *
 * WHY. `query --status nope --json` and `handoff <ID> --to-role nope --json`
 * used to exit 2 with a sentence on stderr and nothing on stdout — the answer a
 * wrongly built call gets. A consumer that put a person's typed value into a
 * correct call could not tell the two apart, so it had to guess. `set` drew
 * that line in TL-543 with `refusalKind: "unknown-value"`; this file proves
 * `query` and `handoff` draw the same one: exit 1, the rejected field and
 * value, and the values the field does accept.
 *
 * EVERY VOCABULARY IS THE FIXTURE'S OWN. The statuses and roles are declared
 * here; the priorities and boards are read back from the fixture's own
 * `vocabulary --json`, never written as this repository's values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { alignTemplate, isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("unknown-filter-value");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const OWN_VOCABULARY = [
  "statuses: [open, working, shipped]",
  "archived_statuses: [shipped]",
  "dashboard_open_statuses: [open, working]",
  "reason_required_statuses: [shipped]",
  "in_progress_status: working",
  "roles: [archivist, stonemason]",
].join("\n");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function repo(configLines) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-unknown-value-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  if (configLines) {
    const p = join(dir, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\n" + configLines + "\n", "utf8");
    alignTemplate(dir);
  }
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

function vocabulary(dir) {
  const r = run(dir, ["vocabulary", "--dir", ".", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** The refusal's contract, asserted the same way for every command. */
function assertUnknownValue(r, kind, field, value, declared) {
  assert.equal(r.status, 1, "expected exit 1, got " + r.status + ": " + r.stdout + r.stderr);
  const env = JSON.parse(r.stdout);
  assert.equal(env.kind, kind);
  assert.equal(env.ok, false);
  assert.equal(env.refusalKind, "unknown-value");
  assert.deepEqual(env.rejected, { field, value });
  assert.deepEqual(env.declared, declared);
  assert.match(env.refusal, new RegExp(value));
  return env;
}

// ── query ─────────────────────────────────────────────────────────────────

test("query --status outside the vocabulary answers an unknown-value envelope", () => {
  const dir = repo(OWN_VOCABULARY);
  const r = run(dir, ["query", "--dir", ".", "--status", "opne", "--json"]);
  assertUnknownValue(r, "task-list", "status", "opne", ["open", "working", "shipped"]);
});

test("query --priority and --board outside the vocabulary answer the same envelope", () => {
  const dir = repo(OWN_VOCABULARY);
  const vocab = vocabulary(dir);
  assert.ok(vocab.priorities.length, "the fixture declares no priorities; the case would measure nothing");
  assert.ok(vocab.boards.length, "the fixture declares no boards; the case would measure nothing");

  const p = run(dir, ["query", "--dir", ".", "--priority", "P9", "--json"]);
  assertUnknownValue(p, "task-list", "priority", "P9", vocab.priorities);

  const b = run(dir, ["query", "--dir", ".", "--board", "nowhere", "--json"]);
  assertUnknownValue(b, "task-list", "board", "nowhere", vocab.boards.map((x) => x.slug));
});

test("several rejected values are each named in details; rejected is the first", () => {
  const dir = repo(OWN_VOCABULARY);
  const r = run(dir, ["query", "--dir", ".", "--status", "opne", "--priority", "P9", "--json"]);
  const env = assertUnknownValue(r, "task-list", "status", "opne", ["open", "working", "shipped"]);
  assert.equal(env.details.length, 2);
  assert.match(env.details[1], /`P9`.*`priority`/);
});

test("without --json the refusal is still exit 1, with the sentence on stderr and nothing on stdout", () => {
  const dir = repo(OWN_VOCABULARY);
  const r = run(dir, ["query", "--dir", ".", "--status", "opne"]);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /`opne` is not an allowed value for the field `status`/);
  assert.match(r.stderr, /open \| working \| shipped/);
});

test("POSITIVE CONTROL: a declared value answers ok: true, and a wrongly built call stays exit 2", () => {
  const dir = repo(OWN_VOCABULARY);
  const id = newTask(dir, "Something open");
  const ok = run(dir, ["query", "--dir", ".", "--status", "open", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.refusalKind, null);
  assert.deepEqual(env.tasks.map((t) => t.id), [id]);

  // The other half of the split: an unknown flag and a missing value are the
  // caller's own malformed invocation — exit 2 and an empty stdout.
  for (const args of [["--stauts", "open"], ["--status"]]) {
    const bad = run(dir, ["query", "--dir", ".", "--json", ...args]);
    assert.equal(bad.status, 2, args.join(" ") + ": " + bad.stderr);
    assert.equal(bad.stdout, "");
  }
});

// ── handoff ───────────────────────────────────────────────────────────────

test("handoff --to-role outside `roles:` answers an unknown-value envelope and writes nothing", () => {
  const dir = repo(OWN_VOCABULARY);
  const id = newTask(dir, "Sort the deeds");
  const file = run(dir, ["query", "--dir", ".", "--files"]).stdout.trim();
  const before = readFileSync(join(dir, file), "utf8");

  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archvist", "--reason", "A typo.", "--json"]);
  const env = assertUnknownValue(r, "task-handoff", "role", "archvist", ["archivist", "stonemason"]);
  assert.equal(env.id, id);
  assert.equal(readFileSync(join(dir, file), "utf8"), before, "the task was written by a refused handoff");

  // The same refusal without --json: exit 1, the sentence on stderr.
  const text = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archvist", "--reason", "A typo."]);
  assert.equal(text.status, 1);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /unknown role `archvist`/);
});

test("a backlog that declares no roles refuses any role with declared: []", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "Anybody?", "--json"]);
  assertUnknownValue(r, "task-handoff", "role", "archivist", []);
});

test("POSITIVE CONTROL: a declared role hands off, and a handoff without --reason stays exit 2", () => {
  const dir = repo(OWN_VOCABULARY);
  const id = newTask(dir, "Sort the deeds");
  const bad = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--json"]);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);

  const ok = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "Theirs.", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.role.to, "archivist");
});
