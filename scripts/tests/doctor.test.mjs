/**
 * `worktrail doctor` (TL-62).
 *
 * EVERY ROW HAS ITS OWN POSITIVE CONTROL. A diagnosis that is green on a healthy
 * tree prints nothing but ticks is green with no evidential force — and this is a
 * whose entire value lies in being able to say "no". So for each check there is a
 * scenario here in which it MUST go red, next to a scenario in which it has to
 * stay quiet.
 *
 * THE SECOND ASSERTION, EASY TO MISS: `doctor` fixes nothing. A command that
 * "while it is here" corrects somebody's configuration stops being a diagnosis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("doctor");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000 });
}

function repo(initArgs) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-doctor-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", "."].concat(initArgs || [])).status, 0);
  return dir;
}

/** The diagnosis rows keyed by `id` — the assertions have to ask about the CHECK, not about the layout of the text. */
function rows(dir) {
  const r = run(dir, ["doctor", "--json"]);
  const parsed = JSON.parse(r.stdout);
  const byId = {};
  for (const c of parsed.checks) byId[c.id] = c;
  return { status: r.status, ok: parsed.ok, next: parsed.next, byId, raw: parsed };
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
}

// ── A healthy tree ────────────────────────────────────────────────────────

test("a fresh backlog passes in full", () => {
  const dir = repo();
  const d = rows(dir);
  assert.equal(d.status, 0, "doctor fails on a freshly created backlog");
  assert.equal(d.ok, true);
  const errors = d.raw.checks.filter((c) => c.status === "error");
  assert.deepEqual(errors, [], "errors on a clean tree: " + JSON.stringify(errors));
});

test("an empty backlog points at `new`, a non-empty one at the viewer", () => {
  const dir = repo(["--no-example"]);
  assert.match(rows(dir).next, /new --title/);
  newTask(dir, "Cokolwiek");
  assert.doesNotMatch(rows(dir).next, /new --title/);
});

// ── A positive control for every row ──────────────────────────────────────

test("a broken configuration: the `config` row is red, the rest honestly unchecked", () => {
  const dir = repo();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a]\n", "utf8");
  const d = rows(dir);
  assert.equal(d.status, 1);
  assert.equal(d.byId.config.status, "error");
  assert.match(d.byId.config.detail, /statusess/);
  // Counting under a vocabulary we do not know would answer a different question.
  assert.equal(d.byId.vocabulary.status, "info");
  assert.match(d.byId.vocabulary.detail, /not checked/);
});

test("a value outside the vocabulary: the `vocabulary` row goes red and names the field", () => {
  const dir = repo();
  newTask(dir, "A task");
  const f = join(dir, "tasks", readdirSync(join(dir, "tasks"))[0]);
  writeFileSync(f, readFileSync(f, "utf8").replace(/^status: .*$/m, "status: wymyslony"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.vocabulary.status, "error");
  assert.match(d.byId.vocabulary.detail, /`status`/);
  assert.match(d.byId.vocabulary.detail, /wymyslony/);
  assert.equal(d.status, 1);
});

test("a prefix mismatch: the `prefix` row is red and names migrate-prefix", () => {
  const dir = repo();
  newTask(dir, "A task");
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^task_id_prefix: .*$/m, "task_id_prefix: INNY"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.prefix.status, "error");
  assert.match(d.byId.prefix.fix, /migrate-prefix --to INNY/);
});

test("views that are not ignored: the `git-ignore` row is red", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-doctor-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  run(dir, ["init", "--dir", ".", "--no-gitignore"]);

  const d = rows(dir);
  assert.equal(d.byId["git-ignore"].status, "error");
  assert.match(d.byId["git-ignore"].detail, /INDEX\.yaml/);
  assert.equal(d.status, 1);
});

test("a view already tracked: a separate row with `git rm --cached`", () => {
  const dir = repo();
  writeFileSync(join(dir, "INDEX.yaml"), "tasks: []\n", "utf8");
  spawnSync("git", ["add", "-f", "INDEX.yaml"], { cwd: dir });
  spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "x"], { cwd: dir });

  const d = rows(dir);
  assert.equal(d.byId["git-tracked"].status, "error");
  assert.match(d.byId["git-tracked"].fix, /git rm --cached/);
});

test("a failing guard: the `guards` row is red", () => {
  const dir = repo();
  newTask(dir, "A task");
  const f = join(dir, "tasks", readdirSync(join(dir, "tasks"))[0]);
  // The pattern allows a comment at the end of the line: the template has one, and
  // a test about a DANGLING REFERENCE should not fail because a field's
  // explanation changed.
  writeFileSync(f, readFileSync(f, "utf8").replace(/^blocked_by: \[\].*$/m, "blocked_by: [TASK-999]"), "utf8");

  const d = rows(dir);
  assert.equal(d.byId.guards.status, "error");
  assert.equal(d.status, 1);
});

test("the absence of a git repository is information, not an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-doctor-nogit-"));
  run(dir, ["init", "--dir", "."]);
  const d = rows(dir);
  assert.equal(d.byId["git-repo"].status, "info");
  assert.equal(d.status, 0, "the absence of git must not fail — a backlog outside a repository is a supported state");
});

// ── A diagnosis stays a diagnosis ─────────────────────────────────────────

test("doctor changes NOTHING", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-doctor-"));
  spawnSync("git", ["init", "-q", "."], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n", "utf8");
  run(dir, ["init", "--dir", ".", "--no-gitignore"]);

  const snapshot = () =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name + ":" + readFileSync(join(dir, e.name), "utf8").length)
      .sort();

  const before = snapshot();
  run(dir, ["doctor"]);
  const after = snapshot();

  assert.deepEqual(after, before, "doctor appended to or created files — that is no longer a diagnosis");
  assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), "node_modules/\n");
});

// ── The surface of the command ────────────────────────────────────────────

test("--json is pure JSON and nothing besides", () => {
  const dir = repo();
  const r = run(dir, ["doctor", "--json"]);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.equal(r.stderr, "", "diagnostics on stdout next to the JSON break every consumer at once");
});

test("with no backlog: it points at `init`, exits non-zero, with no stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-doctor-empty-"));
  const r = run(dir, ["doctor"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /init --dir/);
  assert.doesNotMatch(r.stderr + r.stdout, /^\s+at .+:\d+:\d+\)?$/m);
});

test("an unknown flag fails with code 2", () => {
  const dir = repo();
  assert.equal(run(dir, ["doctor", "--jsno"]).status, 2);
});

test("--help exits zero and writes to stdout", () => {
  const dir = repo();
  const r = run(dir, ["doctor", "--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /doctor/);
  assert.equal(r.stderr, "");
});
