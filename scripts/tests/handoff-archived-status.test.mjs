/**
 * `handoff --status <archived>` is a refusal, not a usage error (TL-635).
 *
 * WHY. TL-559 and TL-574 drew one line for `handoff`: a value a person typed
 * into a correctly built call is a refusal (exit 1, an envelope under
 * `--json`), and exit 2 is kept for a call built wrong. An archived `--status`
 * was still on the wrong side — exit 2, a sentence on stderr and an empty
 * stdout — so a consumer could not tell "you may not close a task this way"
 * from its own malformed call. The status IS declared, so `unknown-value`
 * would misname it; the refusal has a kind of its own, `archived-status`, and
 * names the statuses a handoff may set.
 *
 * WHAT IS AT RISK, and the control for each:
 *   - A REFUSAL THAT ALREADY WROTE: the task file and its history are compared
 *     byte for byte before and after.
 *   - A `declared` LIST THAT LEAKS A CLOSING STATUS: the fixture declares TWO
 *     archived statuses, so a filter that drops only the first one fails.
 *   - A GREEN ON A ZERO SAMPLE: the positive control hands a task in progress
 *     back with a status from `declared` and expects it applied, and the
 *     wrongly built calls are shown to stay exit 2.
 *
 * EVERY VOCABULARY IS THE FIXTURE'S OWN — never this repository's statuses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { alignTemplate, isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("handoff-archived-status");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const STATUSES = ["open", "working", "review", "shipped", "dropped"];
const ARCHIVED = ["shipped", "dropped"];
const OPEN = STATUSES.filter((s) => ARCHIVED.indexOf(s) < 0);

const OWN_VOCABULARY = [
  "statuses: [" + STATUSES.join(", ") + "]",
  "archived_statuses: [" + ARCHIVED.join(", ") + "]",
  "dashboard_open_statuses: [open, working, review]",
  "reason_required_statuses: [" + ARCHIVED.join(", ") + "]",
  "in_progress_status: working",
  "roles: [archivist, stonemason]",
].join("\n");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-handoff-archived-"));
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

/** The task file and its history log, as one comparable snapshot. */
function snapshot(dir, id) {
  const history = join(dir, "history", id + ".jsonl");
  return {
    task: readFileSync(taskFile(dir), "utf8"),
    history: existsSync(history) ? readFileSync(history, "utf8") : null,
  };
}

const statusOf = (text) => (text.match(/^status: *(\S+)/m) || [])[1];

test("an archived --status answers exit 1 and an archived-status envelope naming what a handoff may set, and writes nothing", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason"]).status, 0);
  const before = snapshot(dir, id);

  for (const archived of ARCHIVED) {
    const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:mason", "--to-role", "archivist",
      "--reason", "A shortcut.", "--status", archived, "--json"]);
    assert.equal(r.status, 1, "`--status " + archived + "` exited " + r.status + ": " + r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.kind, "task-handoff");
    assert.equal(env.ok, false);
    assert.equal(env.id, id);
    assert.equal(env.refusalKind, "archived-status",
      "a declared status was given a kind other than archived-status: " + env.refusalKind);
    assert.deepEqual(env.rejected, { field: "status", value: archived });
    assert.deepEqual(env.declared, OPEN, "`declared` is not the statuses a handoff may set");
    assert.match(env.refusal, new RegExp("`" + archived + "` is an archived status"));
    assert.ok(env.details.some((d) => d.includes(OPEN.join(", "))),
      "the details do not name the statuses a handoff may set: " + JSON.stringify(env.details));
  }

  assert.deepEqual(snapshot(dir, id), before, "a refused handoff wrote to the task or its history");

  // Without --json: exit 1, the sentence and the allowed statuses on stderr, stdout empty.
  const text = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:mason", "--to-role", "archivist",
    "--reason", "A shortcut.", "--status", "shipped"]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /`shipped` is an archived status/);
  assert.match(text.stderr, new RegExp(OPEN.join(", ")));
  assert.deepEqual(snapshot(dir, id), before, "a refused handoff wrote to the task or its history");
});

test("POSITIVE CONTROL: a status from `declared` is applied, and a wrongly built call stays exit 2", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason"]).status, 0);
  assert.equal(statusOf(readFileSync(taskFile(dir), "utf8")), "working");

  const usage = [
    [["--to-role", "archivist", "--status", "shipped"], "a missing --reason"],
    [["--to-role", "archivist", "--reason", "x", "--status", "shipped", "--frobnicate"], "an unknown flag"],
    [["--to-role", "archivist", "--reason", "x", "--status"], "a missing value"],
  ];
  for (const [args, what] of usage) {
    const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:mason", "--json"].concat(args));
    assert.equal(r.status, 2, what + " exited " + r.status + ": " + r.stdout + r.stderr);
    assert.equal(r.stdout, "", what + " printed an answer on stdout");
  }

  const ok = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:mason", "--to-role", "archivist",
    "--reason", "Ready for review.", "--status", "review", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.deepEqual([env.status.from, env.status.to], ["working", "review"]);
  assert.equal(statusOf(readFileSync(taskFile(dir), "utf8")), "review");
});
