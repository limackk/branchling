/**
 * `take --take-over` — the route the refusals advertise (TL-284).
 *
 * WHAT WAS WRONG. Both `take` and `handoff` refused somebody else's task with
 * "take it over deliberately", and `take` even named the way: by editing the
 * file. Following that to the letter did not work. The owner field is only the
 * FIRST gate; `handoff` then read the reservation and refused again on
 * `held.actor !== actor`, so the hand edit moved the refusal from one line of
 * the message to the next. Measured on 2026-09-05 handing TL-150 from one agent
 * to another.
 *
 * WHAT IS UNDER TEST, and why each case is paired with a control:
 *
 *   1. THE ROUTE IS RUN VERBATIM. The assertions are not "the flag exists" but
 *      "the command printed in the refusal, run as printed, ends with the task
 *      handed off" — a message promising a route is worth exactly as much as
 *      the route, and that is the thing that was false.
 *   2. BOTH GATES, NOT ONE. The case that matters is the one the task measured:
 *      `owner:` already naming the taker while the lock names somebody else.
 *      A takeover that only crossed the owner field would pass a naive test and
 *      leave the defect exactly where it was.
 *   3. THE RESERVATION IS HANDED OVER, NOT DROPPED. The lockfile is read back
 *      afterwards: a takeover that deleted it would leave the task reservable
 *      by a third session while this one works, which is the failure TL-87
 *      exists to prevent.
 *   4. THE NEW ROUTE NARROWS SOMETHING. Without the flag an actor holding
 *      neither the owner field nor the reservation is still refused by both
 *      commands, and without a reason the takeover itself is refused before
 *      anything is written.
 *
 * The roles are a FIXTURE's, never this repository's — `roles:` is a project's
 * vocabulary, and asserting one project's job titles would make the test a copy
 * of somebody's config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_TAKEOVER } from "../task-fields.mjs";
import { SCRIPTS_DIR, alignTemplate, isolateHome } from "./_repo.mjs";

// The suite must not read the DEVELOPER's preferences: the actor chain reads
// the user layer, so a machine with `actor:` in its own config file would see
// every default-actor assertion below fail.
isolateHome("takeover");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** A private state directory per repository, so a lock from one case cannot
 *  reach another — the locks live OUTSIDE the backlog on purpose (TL-87). */
function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

const ROLES = "roles: [archivist, stonemason]";

/** A fresh co-located backlog that declares two roles to hand between. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-takeover-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + ROLES + "\n", "utf8");
  // A fixture that extends the vocabulary leaves `init`'s template offering the
  // default one — the drift `new` refuses since TL-69.
  alignTemplate(dir);
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

/** One frontmatter value, without the template's trailing comment. */
function field(text, key) {
  const line = (text.match(new RegExp("^" + key + ": *(.*)$", "m")) || [])[1];
  return line === undefined ? undefined : line.replace(/\s+#.*$/, "").trim();
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** The lock record for one task, or null — read from the state directory this
 *  fixture handed to every child process. */
function lock(dir, id) {
  const root = join(dir, ".state", "locks");
  if (!existsSync(root)) return null;
  for (const key of readdirSync(root)) {
    const path = join(root, key, id + ".lock");
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  }
  return null;
}

/**
 * The command a refusal offers, lifted out of the message and run as printed.
 *
 * This is the whole point of the file: a route that exists is one a reader can
 * copy. Rebuilding the invocation from what the test knows would prove the
 * FLAG works and leave the message free to advertise anything at all.
 */
function offeredCommand(text) {
  const m = text.match(/branchling take [^\n`]*--take-over[^\n`]*/);
  assert.ok(m, "the refusal offers no takeover command:\n" + text);
  return m[0];
}

/** Split a printed command line into arguments, honouring "…" around a reason. */
function argsOf(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2]);
  assert.equal(out.shift(), "branchling");
  return out;
}

// ── The measured exchange, end to end ─────────────────────────────────────

test("the route both refusals advertise, run as printed, ends in a handed-off task", () => {
  const dir = repo();
  const id = newTask(dir, "A task one agent holds and another must hand on");

  assert.equal(run(dir, ["take", id, "--actor", "agent:fleet"]).status, 0);

  // Gate one, from `handoff`: the owner field.
  const refusedHandoff = run(dir, [
    "handoff", id, "--to-role", "stonemason", "--actor", "agent:spec", "--reason", "the spec hand carries it on",
  ]);
  assert.equal(refusedHandoff.status, 1, refusedHandoff.stdout);
  assert.match(refusedHandoff.stderr, /owner: agent:fleet/);

  // Gate one, from `take`. The old message named a file edit; the whole defect
  // was that following it reached gate two, so the words must be gone.
  const refusedTake = run(dir, ["take", id, "--actor", "agent:spec"]);
  assert.equal(refusedTake.status, 1, refusedTake.stdout);
  assert.doesNotMatch(refusedTake.stderr, /editing the file/,
    "the refusal still advertises the route that was measured not to work");

  // Both messages offer the SAME command, and it is the one that is run.
  const offered = offeredCommand(refusedTake.stderr);
  offeredCommand(refusedHandoff.stderr);

  const taken = run(dir, argsOf(offered).concat(["--actor", "agent:spec"]));
  assert.equal(taken.status, 0, taken.stderr);

  // Gate two is crossed as well: the handoff that refused a moment ago works.
  const handed = run(dir, [
    "handoff", id, "--to-role", "stonemason", "--actor", "agent:spec", "--reason", "the spec hand carries it on",
  ]);
  assert.equal(handed.status, 0, handed.stderr);
  assert.equal(field(read(dir, id), "role"), "stonemason");
});

test("a takeover crosses the reservation even when the owner field already names the taker", () => {
  const dir = repo();
  const id = newTask(dir, "A task whose owner was edited by hand");

  assert.equal(run(dir, ["take", id, "--actor", "agent:fleet"]).status, 0);
  // Exactly the state the hand reached on 2026-09-05: `owner:` corrected by
  // hand, the reservation untouched. The old code refused here with nothing
  // left to edit.
  const file = taskFile(dir, id);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^owner: .*$/m, "owner: agent:spec"), "utf8");
  assert.equal(lock(dir, id).actor, "agent:fleet");

  const refused = run(dir, [
    "handoff", id, "--to-role", "stonemason", "--actor", "agent:spec", "--reason", "carrying it on",
  ]);
  assert.equal(refused.status, 1, refused.stdout);
  assert.match(refused.stderr, /held by agent:fleet/);

  const taken = run(dir, [
    "take", id, "--take-over", "--actor", "agent:spec", "--reason", "the charter names the spec hand",
  ]);
  assert.equal(taken.status, 0, taken.stderr);

  // HANDED OVER, NOT DELETED. A takeover that dropped the lockfile would leave
  // the task free for a third session while this one works on it.
  assert.equal(lock(dir, id).actor, "agent:spec");

  // The frontmatter shows no owner change here, so the seizure is a fact only
  // the event carries — which is why it is an event.
  const events = history(dir, id).filter((e) => e.field === FIELD_TAKEOVER);
  assert.equal(events.length, 1, JSON.stringify(history(dir, id), null, 2));
  assert.equal(events[0].from, "agent:fleet");
  assert.equal(events[0].to, "agent:spec");
  assert.equal(events[0].actor, "agent:spec");
  assert.match(events[0].reason, /charter names the spec hand/);
});

test("a takeover names both actors in the event when the owner field changes too", () => {
  const dir = repo();
  const id = newTask(dir, "A task taken over from its owner");

  assert.equal(run(dir, ["take", id, "--actor", "agent:fleet"]).status, 0);
  const taken = run(dir, [
    "take", id, "--take-over", "--actor", "agent:spec", "--reason", "the fleet hand cannot finish it",
  ]);
  assert.equal(taken.status, 0, taken.stderr);
  assert.equal(field(read(dir, id), "owner"), "agent:spec");

  const events = history(dir, id).filter((e) => e.field === FIELD_TAKEOVER);
  assert.equal(events.length, 1);
  assert.equal(events[0].from, "agent:fleet");
  assert.equal(events[0].to, "agent:spec");

  // The takeover is announced on the way out as well, not only in the log.
  assert.match(taken.stdout + taken.stderr, /agent:fleet/);
});

// ── The controls ──────────────────────────────────────────────────────────

test("a takeover without a reason is refused before anything is written", () => {
  const dir = repo();
  const id = newTask(dir, "A task nobody may take silently");
  assert.equal(run(dir, ["take", id, "--actor", "agent:fleet"]).status, 0);

  const refused = run(dir, ["take", id, "--take-over", "--actor", "agent:spec"]);
  assert.equal(refused.status, 2, refused.stdout);
  assert.match(refused.stderr, /--reason/);

  assert.equal(field(read(dir, id), "owner"), "agent:fleet");
  assert.equal(lock(dir, id).actor, "agent:fleet");
  assert.equal(history(dir, id).filter((e) => e.field === FIELD_TAKEOVER).length, 0);
});

test("without the flag an actor holding neither the field nor the reservation is refused", () => {
  const dir = repo();
  const id = newTask(dir, "A task held by somebody else");
  assert.equal(run(dir, ["take", id, "--actor", "agent:fleet"]).status, 0);

  const take = run(dir, ["take", id, "--actor", "agent:other", "--reason", "I would like it"]);
  assert.equal(take.status, 1, take.stdout);

  const handoff = run(dir, [
    "handoff", id, "--to-role", "stonemason", "--actor", "agent:other", "--reason", "I would like it",
  ]);
  assert.equal(handoff.status, 1, handoff.stdout);

  assert.equal(field(read(dir, id), "owner"), "agent:fleet");
  assert.equal(lock(dir, id).actor, "agent:fleet");
  assert.equal(history(dir, id).filter((e) => e.field === FIELD_TAKEOVER).length, 0);
});

test("a task nobody holds is taken without an event — the flag asserts nothing it did not cross", () => {
  const dir = repo();
  const id = newTask(dir, "A task in the queue");

  const taken = run(dir, ["take", id, "--take-over", "--actor", "agent:spec", "--reason", "nothing to cross"]);
  assert.equal(taken.status, 0, taken.stderr);
  assert.equal(history(dir, id).filter((e) => e.field === FIELD_TAKEOVER).length, 0,
    "a takeover event was written for a claim that never existed");
});
