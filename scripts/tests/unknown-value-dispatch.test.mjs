/**
 * The dispatcher refuses an undeclared value as `unknown-value`, as `query`
 * does (TL-574).
 *
 * WHY. TL-559 made `query` and `handoff --to-role` answer a value outside the
 * backlog's vocabulary with exit 1 and, under `--json`, an envelope naming the
 * rejected field and value and what is declared. `next`, `run` and `handoff
 * --status/--to-owner` still answered exit 2 with a sentence on stderr and an
 * empty stdout — the answer a wrongly built call gets. A consumer that could
 * tell a person's typed value from its own malformed call on `query` could not
 * on `next`, the dispatcher, where a typo matters most. This file proves the
 * three paths draw the same line, and that exit 2 still means a call built
 * wrong.
 *
 * EVERY VOCABULARY IS THE FIXTURE'S OWN. The statuses, roles and owners are
 * declared here; the priorities and boards are read back from the fixture's
 * own `vocabulary --json`, never written as this repository's values.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { alignTemplate, isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("unknown-value-dispatch");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const STATUSES = ["open", "working", "shipped"];
const ROLES = ["archivist", "stonemason"];
const OWNERS = ["unassigned", "mason"];

const OWN_VOCABULARY = [
  "statuses: [" + STATUSES.join(", ") + "]",
  "archived_statuses: [shipped]",
  "dashboard_open_statuses: [open, working]",
  "reason_required_statuses: [shipped]",
  "in_progress_status: working",
  "roles: [" + ROLES.join(", ") + "]",
  "owners: [" + OWNERS.join(", ") + "]",
].join("\n");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-unknown-value-dispatch-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + OWN_VOCABULARY + "\n", "utf8");
  alignTemplate(dir);
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

/** The fixture's one task file; each case creates exactly one task. */
function taskFile(dir) {
  const r = run(dir, ["query", "--dir", ".", "--files"]);
  assert.equal(r.status, 0, r.stderr);
  const files = r.stdout.trim().split("\n").filter(Boolean);
  assert.equal(files.length, 1, "expected one task file, got: " + r.stdout);
  return join(dir, files[0]);
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
  assert.ok(env.details.length > 0, "the refusal named nothing in details");
  return env;
}

/** A wrongly built call: exit 2 and nothing on stdout. */
function assertUsageError(r, label) {
  assert.equal(r.status, 2, label + ": " + r.stdout + r.stderr);
  assert.equal(r.stdout, "", label + " printed an answer for a malformed call");
}

// ── next ──────────────────────────────────────────────────────────────────

test("next: a --priority, --board, --status or --role outside the vocabulary is an unknown-value, and nothing is claimed", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  const file = taskFile(dir);
  const before = readFileSync(file, "utf8");
  const vocab = vocabulary(dir);
  assert.ok(vocab.priorities.length, "the fixture declares no priorities; the case would measure nothing");
  assert.ok(vocab.boards.length, "the fixture declares no boards; the case would measure nothing");

  const base = ["next", "--dir", ".", "--actor", "agent:test", "--json"];
  assertUnknownValue(run(dir, [...base, "--priority", "P9"]), "task-take", "priority", "P9", vocab.priorities);
  assertUnknownValue(run(dir, [...base, "--board", "nowhere"]), "task-take", "board", "nowhere", vocab.boards.map((b) => b.slug));
  assertUnknownValue(run(dir, [...base, "--status", "opne"]), "task-take", "status", "opne", STATUSES);
  const role = assertUnknownValue(run(dir, [...base, "--role", "carpenter"]), "task-take", "role", "carpenter", ROLES);
  assert.equal(role.taken, false);
  assert.equal(role.actorSource, "flag");

  assert.equal(readFileSync(file, "utf8"), before, "a refused next claimed the task");
});

test("next: several rejected values are each named in details; rejected is the first", () => {
  const dir = repo();
  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:test", "--status", "opne", "--priority", "P9", "--json"]);
  const env = assertUnknownValue(r, "task-take", "status", "opne", STATUSES);
  assert.equal(env.details.length, 2);
  assert.match(env.details[1], /`P9`.*`priority`/);
});

test("next: without --json the refusal is exit 1, the sentence on stderr and nothing on stdout", () => {
  const dir = repo();
  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:test", "--priority", "P9"]);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /`P9` is not an allowed value for the field `priority`/);
});

test("next POSITIVE CONTROL: a declared value hands the task out, and a wrongly built call stays exit 2", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  for (const args of [["--prioritty", "P1"], ["--priority"]]) {
    assertUsageError(run(dir, ["next", "--dir", ".", "--actor", "agent:test", "--json", ...args]), "next " + args.join(" "));
  }
  const ok = run(dir, ["next", "--dir", ".", "--actor", "agent:test", "--status", "open", "--role", "archivist", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.id, id);
  assert.equal(env.refusalKind, null);
});

// ── run ───────────────────────────────────────────────────────────────────

test("run: a --board or --priority outside the vocabulary is an unknown-value in the run envelope", () => {
  const dir = repo();
  newTask(dir, "Work for a loop");
  const vocab = vocabulary(dir);
  assert.ok(vocab.boards.length, "the fixture declares no boards; the case would measure nothing");

  const b = assertUnknownValue(run(dir, ["run", "--dir", ".", "--board", "nowhere", "--dry-run", "--json"]),
    "run", "board", "nowhere", vocab.boards.map((x) => x.slug));
  assert.equal(b.dryRun, true);
  assertUnknownValue(run(dir, ["run", "--dir", ".", "--priority", "P9", "--dry-run", "--json"]),
    "run", "priority", "P9", vocab.priorities);

  const text = run(dir, ["run", "--dir", ".", "--board", "nowhere", "--dry-run"]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /`nowhere` is not an allowed value for the field `board`/);
});

test("run POSITIVE CONTROL: a declared value answers ok: true, and a wrongly built call stays exit 2", () => {
  const dir = repo();
  const id = newTask(dir, "Work for a loop");
  const board = vocabulary(dir).boards[0].slug;
  const ok = run(dir, ["run", "--dir", ".", "--board", board, "--dry-run", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.refusalKind, null);
  assert.deepEqual(env.order.map((t) => t.id), [id]);

  for (const args of [["--bord", board], ["--board"]]) {
    assertUsageError(run(dir, ["run", "--dir", ".", "--dry-run", "--json", ...args]), "run " + args.join(" "));
  }
});

// ── handoff ───────────────────────────────────────────────────────────────

test("handoff: a --to-owner outside `owners:` or a --status outside `statuses:` is an unknown-value, and nothing is written", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  const file = taskFile(dir);
  const before = readFileSync(file, "utf8");

  const owner = assertUnknownValue(
    run(dir, ["handoff", id, "--dir", ".", "--to-owner", "masn", "--reason", "A typo.", "--json"]),
    "task-handoff", "owner", "masn", OWNERS);
  assert.equal(owner.id, id);

  const status = assertUnknownValue(
    run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--status", "opne", "--reason", "A typo.", "--json"]),
    "task-handoff", "status", "opne", STATUSES);
  assert.equal(status.id, id);

  assert.equal(readFileSync(file, "utf8"), before, "the task was written by a refused handoff");

  // Without --json: exit 1, the sentence on stderr, nothing on stdout.
  const text = run(dir, ["handoff", id, "--dir", ".", "--to-owner", "masn", "--reason", "A typo."]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /`masn` is not an allowed value for the field `owner`/);
});

test("handoff POSITIVE CONTROL: a declared owner hands off, and a wrongly built call stays exit 2", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  assertUsageError(run(dir, ["handoff", id, "--dir", ".", "--to-owner", "mason", "--json"]), "handoff without --reason");
  assertUsageError(run(dir, ["handoff", id, "--dir", ".", "--to-owner", "mason", "--reason", "x", "--frobnicate", "--json"]),
    "handoff with an unknown flag");

  const ok = run(dir, ["handoff", id, "--dir", ".", "--to-owner", "mason", "--reason", "Theirs.", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.owner.to, "mason");
});
