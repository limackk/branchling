/**
 * A handoff is ONE transaction: the task file and its history move together, or
 * neither moves (TL-351).
 *
 * WHAT WENT WRONG. `handoffTask()` rewrote the frontmatter — status, owner,
 * role — and only then asked `recordEdit()` to persist the history. When that
 * write failed, the command exited non-zero with the task file already changed
 * and no matching events on disk. The two halves of the same truth disagreed,
 * and a retry could not repair it: the file already said `pending`, so the
 * transition out of the in-progress status no longer existed anywhere to be
 * recorded.
 *
 * HOW THE FAILURE IS FORCED, AND WHY NOT WITH PERMISSIONS. The reported
 * incident was an `EPERM` from a restricted state directory, but a test that
 * chmods a directory proves something about one machine's user account — it can
 * pass for the wrong reason under `root`, and on a filesystem that ignores the
 * mode bits it cannot fail at all. The fixture here takes the state directory's
 * NAME instead: `BACKLOG_STATE_DIR` points at a regular FILE, so the mutex
 * directory that every history write creates first (`withMutex`, lock.mjs)
 * cannot be created, whoever is running the suite. The class of failure is the
 * one the incident named — history persistence refuses before a single event is
 * appended — and it is reproducible on any machine.
 *
 * THE POSITIVE CONTROL IS NOT DECORATION. A command that had been made to
 * refuse unconditionally would satisfy every assertion about the failing path.
 * The last test is what says the transaction still COMMITS: matching status,
 * owner, role and comment events beside the frontmatter change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_COMMENT } from "../task-fields.mjs";
import { SCRIPTS_DIR, alignTemplate, isolateHome } from "./_repo.mjs";

isolateHome("handoff-atomicity");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** The state directory a working command gets: its own, inside the fixture. */
const STATE = (dir) => join(dir, ".state");

/** The state directory a DOOMED command gets: a path that is a regular file, so
 *  the mutex directory under it cannot be created. Nothing about this depends
 *  on who is running the suite. */
const BROKEN_STATE = (dir) => join(dir, ".state-is-a-file");

function run(dir, args, stateDir) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd: dir, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: stateDir || STATE(dir) },
  });
}

const ROLES = "roles: [archivist, stonemason]";

/** A fresh co-located backlog with a role vocabulary of its own — `roles:` is a
 *  project's word list, never this repository's. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-handoff-atomic-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + ROLES + "\n", "utf8");
  alignTemplate(dir);
  writeFileSync(BROKEN_STATE(dir), "not a directory\n", "utf8");
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

const read = (dir, id) => readFileSync(taskFile(dir, id), "utf8");

function field(text, key) {
  const line = (text.match(new RegExp("^" + key + ": *(.*)$", "m")) || [])[1];
  return line === undefined ? undefined : line.replace(/\s+#.*$/, "").trim();
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** A taken task, ready to be handed on. Returns the id and the two states a
 *  failed handoff must leave exactly as they are. */
function taken(dir, title) {
  const id = newTask(dir, title);
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"]).status, 0);
  return { id, text: read(dir, id), entries: history(dir, id) };
}

test("a history write that fails leaves the task file and the log untouched", () => {
  const dir = repo();
  const before = taken(dir, "Sort the deeds");

  const r = run(dir, ["handoff", before.id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Naming the deeds is an archivist's call, not mine."],
  BROKEN_STATE(dir));

  assert.notEqual(r.status, 0, "the handoff reported success although no event could be written");
  assert.equal(read(dir, before.id), before.text,
    "the frontmatter moved while the history did not — the split truth TL-351 is about");
  assert.deepEqual(history(dir, before.id), before.entries,
    "a partial history was appended by a command that then failed");
});

test("after the failed write, the retry records the whole transition from the original state", () => {
  const dir = repo();
  const before = taken(dir, "Sort the deeds");
  const inProgress = field(before.text, "status");

  assert.notEqual(run(dir, ["handoff", before.id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Out of my mandate."], BROKEN_STATE(dir)).status, 0);

  // No repair between the two runs: the second command is the first one typed
  // again. That is the whole point — the caller of the incident had to restore
  // the last recorded frontmatter by hand before this could work.
  const retry = run(dir, ["handoff", before.id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Out of my mandate."]);
  assert.equal(retry.status, 0, retry.stderr);

  const status = history(dir, before.id).filter((e) => e.field === "status" && e.source === "handoff");
  assert.equal(status.length, 1, "the handoff recorded no status transition, or more than one");
  assert.equal(status[0].from, inProgress,
    "the transition was recorded from the wrong starting point — the first run had already moved the file");
  assert.equal(status[0].to, field(read(dir, before.id), "status"));
});

test("a handoff that succeeds writes status, owner, role and a comment beside the change", () => {
  const dir = repo();
  const before = taken(dir, "Sort the deeds");
  const inProgress = field(before.text, "status");

  const r = run(dir, ["handoff", before.id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "An archivist's call, not mine."]);
  assert.equal(r.status, 0, r.stderr);

  const text = read(dir, before.id);
  assert.equal(field(text, "role"), "archivist");
  assert.equal(field(text, "owner"), '""');
  assert.notEqual(field(text, "status"), inProgress);

  const written = history(dir, before.id).filter((e) => e.source === "handoff");
  const byField = (f) => written.filter((e) => e.field === f);
  assert.equal(byField("role").length, 1, "the role change reached the frontmatter and not the log");
  assert.equal(byField("role")[0].to, field(text, "role"));
  assert.equal(byField("owner").length, 1, "the cleared owner reached the frontmatter and not the log");
  assert.equal(byField("owner")[0].from, "agent:claude");
  assert.equal(byField("status").length, 1);
  assert.equal(byField("status")[0].to, field(text, "status"));
  assert.equal(byField(FIELD_COMMENT).length, 1, "the question did not survive the session");
  assert.match(byField(FIELD_COMMENT)[0].to, /archivist's call/);
});
