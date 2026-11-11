/**
 * `release --status <s>` refuses an undeclared or an archived status as a
 * refusal, not a usage error (TL-675).
 *
 * WHY. TL-559, TL-574 and TL-635 drew one line for `handoff`: a value a person
 * typed into a correctly built call is a refusal (exit 1, an envelope with
 * `rejected` and `declared` under `--json`), and exit 2 is kept for a call
 * built wrong. `release` shares `handoff`'s write path but validated
 * `--status` on its own and answered both cases with exit 2 and
 * `refusalKind: "usage"`, so a consumer could not tell a typed value from its
 * own malformed call on one of the two commands.
 *
 * WHAT IS AT RISK, and the control for each:
 *   - A REFUSAL THAT ALREADY WROTE: the task file and its history are compared
 *     byte for byte before and after.
 *   - TWO CASES COLLAPSED INTO ONE KIND: an undeclared and an archived status
 *     are asserted separately, each with its own `declared` list.
 *   - A `declared` LIST THAT LEAKS A CLOSING STATUS: the fixture declares TWO
 *     archived statuses, so a filter that drops only the first one fails.
 *   - A GREEN ON A ZERO SAMPLE: the positive control releases a task in
 *     progress with a status from `declared` and expects it applied, and the
 *     wrongly built calls are shown to stay exit 2 with `usage`.
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

isolateHome("release-status-refusal");

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
].join("\n");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-release-status-refusal-"));
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

function taken() {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason"]).status, 0);
  assert.equal(statusOf(readFileSync(taskFile(dir), "utf8")), "working");
  return { dir, id };
}

function release(dir, id, extra) {
  return run(dir, ["release", id, "--dir", ".", "--actor", "agent:mason"].concat(extra));
}

test("an undeclared --status answers exit 1 and an unknown-value envelope naming `statuses:`, and writes nothing", () => {
  const { dir, id } = taken();
  const before = snapshot(dir, id);

  const r = release(dir, id, ["--reason", "Out of time.", "--status", "limbo", "--json"]);
  assert.equal(r.status, 1, "an undeclared status exited " + r.status + ": " + r.stdout + r.stderr);
  const env = JSON.parse(r.stdout);
  assert.equal(env.kind, "task-release");
  assert.equal(env.ok, false);
  assert.equal(env.refusalKind, "unknown-value", "an undeclared status was given kind " + env.refusalKind);
  assert.deepEqual(env.rejected, { field: "status", value: "limbo" });
  assert.deepEqual(env.declared, STATUSES);
  assert.match(env.refusal, /unknown status `limbo`/);
  assert.equal(env.actorSource, "flag", "the actor was resolved before the refusal and must be reported");
  assert.deepEqual(env.details, ["`statuses` in config.yaml holds: " + STATUSES.join(", ")]);

  const text = release(dir, id, ["--reason", "Out of time.", "--status", "limbo"]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /unknown status `limbo`/);
  assert.match(text.stderr, new RegExp(STATUSES.join(", ")));

  assert.deepEqual(snapshot(dir, id), before, "a refused release wrote to the task or its history");
});

test("an archived --status answers exit 1 and an archived-status envelope naming what a release may set, and writes nothing", () => {
  const { dir, id } = taken();
  const before = snapshot(dir, id);

  for (const archived of ARCHIVED) {
    const r = release(dir, id, ["--reason", "A shortcut.", "--status", archived, "--json"]);
    assert.equal(r.status, 1, "`--status " + archived + "` exited " + r.status + ": " + r.stdout + r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.kind, "task-release");
    assert.equal(env.ok, false);
    assert.equal(env.refusalKind, "archived-status",
      "a declared status was given a kind other than archived-status: " + env.refusalKind);
    assert.deepEqual(env.rejected, { field: "status", value: archived });
    assert.deepEqual(env.declared, OPEN, "`declared` is not the statuses a release may set");
    assert.match(env.refusal, new RegExp("`" + archived + "` is an archived status"));
    assert.equal(env.details.length, 3, JSON.stringify(env.details));
    assert.match(env.details[0], /^A release puts a task back in the queue; closing one is `\S+ done`, which$/);
    assert.equal(env.details[1], "runs its verification first.");
    assert.equal(env.details[2], "a release may set: " + OPEN.join(", "),
      "the details do not name the statuses a release may set: " + JSON.stringify(env.details));
  }

  const text = release(dir, id, ["--reason", "A shortcut.", "--status", "shipped"]);
  assert.equal(text.status, 1, text.stderr);
  assert.equal(text.stdout, "");
  assert.match(text.stderr, /`shipped` is an archived status/);
  assert.match(text.stderr, new RegExp(OPEN.join(", ")));

  assert.deepEqual(snapshot(dir, id), before, "a refused release wrote to the task or its history");
});

test("POSITIVE CONTROL: a status from `declared` is applied, and a wrongly built call stays exit 2 with usage", () => {
  const { dir, id } = taken();

  const usage = [
    [["--status", "shipped"], "a missing --reason"],
    [["--reason", "x", "--status", "shipped", "--frobnicate"], "an unknown flag"],
    [["--reason", "x", "--status"], "a missing value"],
  ];
  for (const [args, what] of usage) {
    const r = release(dir, id, ["--json"].concat(args));
    assert.equal(r.status, 2, what + " exited " + r.status + ": " + r.stdout + r.stderr);
    const env = JSON.parse(r.stdout);
    assert.equal(env.refusalKind, "usage", what + " was given kind " + env.refusalKind);
    assert.equal(env.rejected, null, what + " carried a `rejected` value");
  }

  const ok = release(dir, id, ["--reason", "Ready for review.", "--status", "review", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.status, "review");
  assert.equal(statusOf(readFileSync(taskFile(dir), "utf8")), "review");

  // The FIRST declared status is a value like any other: a check written as
  // `<= 0` instead of `< 0` would refuse it.
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason"]).status, 0);
  const first = release(dir, id, ["--reason", "Back to the start.", "--status", STATUSES[0], "--json"]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(statusOf(readFileSync(taskFile(dir), "utf8")), STATUSES[0]);

  // No `--status` at all is not an undeclared one: the history decides.
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason"]).status, 0);
  const bare = release(dir, id, ["--reason", "Out of time.", "--json"]);
  assert.equal(bare.status, 0, bare.stdout + bare.stderr);
  assert.equal(JSON.parse(bare.stdout).ok, true);
});
