/**
 * `role:` — WHO MAY take a task (TL-97).
 *
 * THE THREE WORDS THIS FIELD IS EASY TO CONFUSE WITH, and the reason the tests
 * below check them apart:
 *
 *   role   who MAY take the task    frontmatter
 *   owner  who holds it NOW         frontmatter
 *   actor  who wrote the change     history
 *
 * WHAT IS ACTUALLY AT RISK. An optional field whose vocabulary lives in the
 * configuration has two silent failure modes, and both produce a value that
 * LOOKS like a requirement while no dispatcher can ever satisfy it: a typo
 * inside a declared vocabulary, and any value at all in a backlog that never
 * declared one. Neither shows up as an empty screen — the task simply stops
 * being offered to anybody. So each case here is paired with a positive control
 * in which the guard MUST go red; a guard that only ever passes on tidy trees is
 * green without evidential force.
 *
 * WHAT IS DELIBERATELY NOT HERE. The dispatcher gate — `next` refusing to hand
 * an out-of-role task to an agent — is TL-98. This task's decision is that
 * `take` NEVER blocks: an explicit human instruction outranks a hint in a file,
 * and what the field buys is the recorded trace, tested at the bottom.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULTS, loadConfig } from "../config.mjs";
import { FIELD_ROLE_OVERRIDE, buildFieldSpecs, extractMeta, normalizeValue, TRACKED_FIELDS } from "../task-fields.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("task-role");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000 });
}

/** A fresh co-located backlog. `--dir .` everywhere, so nothing depends on cwd
 *  discovery finding the right tree. */
function repo(configLines) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-role-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  if (configLines) {
    const p = join(dir, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\n" + configLines + "\n", "utf8");
  }
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/[A-Z]+-\d+/);
  assert.ok(m, "the id of the new task is not in the output: " + r.stdout);
  return m[0];
}

function taskFile(dir, id) {
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "no file for " + id);
  return join(dir, "tasks", name);
}

/** Writes one frontmatter field by hand — the way an editor would. */
function setField(dir, id, key, value) {
  const path = taskFile(dir, id);
  const text = readFileSync(path, "utf8");
  const line = key + ": " + value;
  const next = new RegExp("^" + key + ":.*$", "m").test(text)
    ? text.replace(new RegExp("^" + key + ":.*$", "m"), line)
    : text.replace(/^status:.*$/m, (s) => s + "\n" + line);
  assert.notEqual(next, text, "field `" + key + "` unchanged in " + id);
  writeFileSync(path, next, "utf8");
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  return readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
}

// ── The vocabulary lives in the configuration, not in the code ────────────

test("DEFAULTS declare no roles, and a foreign vocabulary arrives whole", () => {
  // The genericity gate, in the spirit of the DEFAULTS one: the code knows the
  // SHAPE of the field and nothing about anybody's job titles. An empty default
  // is the load-bearing half — it is what makes "this project does not use
  // roles" the out-of-the-box answer rather than an open text field.
  assert.deepEqual(DEFAULTS.roles, []);

  const spec = buildFieldSpecs({ roles: ["stonemason", "archivist"] }).find((f) => f.key === "role");
  assert.deepEqual(spec.options, ["stonemason", "archivist"]);
  assert.equal(spec.dictionary, "roles");

  // No role name of any kind can be sitting in the shape: whatever the field
  // offers has to have come from the argument above.
  const shapes = JSON.stringify(buildFieldSpecs({}));
  for (const word of ["stonemason", "archivist", "analyst", "developer", "reviewer"]) {
    assert.equal(shapes.includes(word), false, "the field shape carries the role `" + word + "`");
  }
});

test("an empty vocabulary does NOT turn the field into free text", () => {
  // Every other enum with no vocabulary degrades to text — a field with no
  // values to offer cannot be an enum. Here the empty vocabulary is an ANSWER,
  // and text is exactly the phantom-role hole this field exists to close.
  const spec = buildFieldSpecs({}).find((f) => f.key === "role");
  assert.equal(spec.kind, "enum");
  assert.equal(spec.allowEmpty, true);
  assert.equal(spec.dictionaryRequired, true);
});

test("a role slug of the wrong shape, or twice, fails the configuration", () => {
  const dir = repo('roles: ["Data Analyst", archivist, archivist]');
  assert.throws(() => loadConfig(dir), (e) => {
    assert.match(e.message, /Data Analyst/);
    assert.match(e.message, /duplicate role `archivist`/);
    return true;
  });
});

// ── The build gate, with its positive control ─────────────────────────────

test("a role from the vocabulary builds green", () => {
  const dir = repo("roles: [archivist, stonemason]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archivist");

  const r = run(dir, ["build", "--dir", "."]);
  assert.equal(r.status, 0, r.stderr);
});

test("positive control: a role outside the vocabulary fails the build, naming the file and the value", () => {
  const dir = repo("roles: [archivist, stonemason]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archvist");

  const r = run(dir, ["build", "--dir", "."]);
  assert.notEqual(r.status, 0, "a phantom role built green: " + r.stdout);
  assert.match(r.stderr, /archvist/, "the message does not name the value");
  assert.match(r.stderr, new RegExp(id), "the message does not name the file");
  assert.match(r.stderr, /archivist, stonemason/, "the message does not say what is allowed");
});

test("positive control: a role with no `roles:` declared fails, and says where to declare it", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archivist");

  const r = run(dir, ["build", "--dir", "."]);
  assert.notEqual(r.status, 0, "a role passed in a backlog that declares none: " + r.stdout);
  assert.match(r.stderr, /archivist/);
  assert.match(r.stderr, new RegExp(id));
  assert.match(r.stderr, /`roles:` is not declared in config.yaml/);
});

test("a task with no role passes everywhere — the field is optional", () => {
  const dir = repo("roles: [archivist]");
  newTask(dir, "Anybody can do this");
  assert.equal(run(dir, ["build", "--dir", "."]).status, 0);
  assert.equal(run(dir, ["check", "--dir", ".", "--vocabulary"]).status, 0);
});

test("`check --vocabulary` asks the same question of the tree as the build", () => {
  const dir = repo("roles: [archivist]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "stonemason");

  const r = run(dir, ["check", "--dir", ".", "--vocabulary"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /stonemason/);
});

// ── Editing: the viewer and the server come from the same specs ───────────

test("the field is editable and its change is tracked — no viewer code of its own", () => {
  // What makes the field editable in the viewer is being in the specs, and what
  // makes an edit reach the history is being in TRACKED_FIELDS. Both are derived
  // from FIELD_SHAPES, so this asserts the derivation rather than a screen.
  assert.ok(buildFieldSpecs({ roles: ["archivist"] }).some((f) => f.key === "role"));
  assert.ok(TRACKED_FIELDS.includes("role"));

  const fields = buildFieldSpecs({ roles: ["archivist"] });
  assert.equal(normalizeValue("role", "archivist", { fields }).ok, true);
  assert.equal(normalizeValue("role", "", { fields }).ok, true);
  const bad = normalizeValue("role", "stonemason", { fields });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /stonemason/);
});

test("a hand edit of `role` is reconciled into the history like any other field", () => {
  const dir = repo("roles: [archivist]");
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["history", "--dir", ".", "--actor", "local:me"]).status, 0);

  setField(dir, id, "role", "archivist");
  const r = run(dir, ["history", "--dir", ".", "--actor", "local:me", "--source", "manual"]);
  assert.equal(r.status, 0, r.stderr);

  const roleEntries = history(dir, id).filter((e) => e.field === "role");
  assert.equal(roleEntries.length, 1, "the role change left no history entry");
  assert.equal(roleEntries[0].to, "archivist");
  assert.equal(roleEntries[0].actor, "local:me");
});

// ── query --role ──────────────────────────────────────────────────────────

test("`--role` filters, and `--role \"\"` asks for the tasks open to anybody", () => {
  const dir = repo("roles: [archivist, stonemason]");
  const withRole = newTask(dir, "Sort the deeds");
  const free = newTask(dir, "Anybody can do this");
  setField(dir, withRole, "role", "archivist");
  assert.equal(run(dir, ["build", "--dir", "."]).status, 0);

  const one = run(dir, ["query", "--dir", ".", "--role", "archivist"]);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, new RegExp(withRole));
  assert.equal(one.stdout.includes(free), false, "a roleless task matched --role archivist");

  const none = run(dir, ["query", "--dir", ".", "--role", ""]);
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, new RegExp(free));
  assert.equal(none.stdout.includes(withRole), false, "a task WITH a role matched --role \"\"");

  // The task with a role must not have disappeared from the unfiltered listing:
  // an optional field that quietly narrows the default view would be worse than
  // no field at all.
  const all = run(dir, ["query", "--dir", "."]);
  assert.match(all.stdout, new RegExp(withRole));
  assert.match(all.stdout, new RegExp(free));

  const other = run(dir, ["query", "--dir", ".", "--role", "stonemason", "--count"]);
  assert.equal(other.stdout.trim(), "0");
});

// ── take: never blocked, always recorded ──────────────────────────────────

test("taking a task outside its role PASSES, and the history says it was out of role", () => {
  const dir = repo("roles: [archivist, stonemason]\nactors: [agent:mason]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archivist");
  assert.equal(run(dir, ["build", "--dir", "."]).status, 0);

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:mason", "--role", "stonemason"]);
  assert.equal(r.status, 0, "the take was blocked — the gate belongs to the dispatcher: " + r.stderr);
  assert.match(readFileSync(taskFile(dir, id), "utf8"), /^status: in_progress$/m);

  const override = history(dir, id).filter((e) => e.field === FIELD_ROLE_OVERRIDE);
  assert.equal(override.length, 1, "an out-of-role take left no trace in the history");
  assert.equal(override[0].from, "archivist", "the entry does not say which role the task asks for");
  assert.equal(override[0].to, "stonemason", "the entry does not say who took it");
  assert.equal(override[0].actor, "agent:mason");
  // Silent is the one thing it must not be: the caller is told at the take too.
  assert.match(r.stdout + r.stderr, /outside its role/);
});

test("taking a task WITHIN its role leaves no override entry", () => {
  const dir = repo("roles: [archivist, stonemason]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archivist");
  assert.equal(run(dir, ["build", "--dir", "."]).status, 0);

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:scribe", "--role", "archivist"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(history(dir, id).filter((e) => e.field === FIELD_ROLE_OVERRIDE).length, 0);
});

test("a `--role` outside the vocabulary is a usage error, not a recorded mismatch", () => {
  // Otherwise a typo would write into the one record kept to answer whether the
  // intended specialist did the work — asserting a mismatch that never existed.
  const dir = repo("roles: [archivist]");
  const id = newTask(dir, "Sort the deeds");
  const r = run(dir, ["take", id, "--dir", ".", "--actor", "local:me", "--role", "archvist"]);
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /archvist/);
});

// ── The frontmatter round trip ────────────────────────────────────────────

test("the field survives being read back out of the file", () => {
  const dir = repo("roles: [archivist]");
  const id = newTask(dir, "Sort the deeds");
  setField(dir, id, "role", "archivist");
  const meta = extractMeta(readFileSync(taskFile(dir, id), "utf8").split("---")[1]);
  assert.equal(meta.role, "archivist");
});
