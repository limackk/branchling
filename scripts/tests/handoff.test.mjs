/**
 * `handoff` — passing a task to another role, with the reason and a trace (TL-99).
 *
 * WHAT IS ACTUALLY AT RISK, and why each case is paired with a control:
 *
 *   1. A HANDOFF THAT LOSES THE QUESTION. The point of the command is that the
 *      reason survives the session that had it. So the assertions are not "the
 *      command exited zero" but "the `__comment__` row is on disk, carries the
 *      sentence and the actor, and reaches the page".
 *   2. A REFUSAL THAT ALREADY WROTE. Every gate here — no reason, a role outside
 *      the vocabulary, a backlog that declares none — is checked against the FILE
 *      and the HISTORY afterwards, because a refusal issued after the write costs
 *      more than no gate at all: the change is made and the sentence that was its
 *      price is not.
 *   3. A TASK THAT LEAVES THE QUEUE FOR GOOD. Handing a task on is only worth
 *      anything if somebody can be given it afterwards, so the queue re-entry is
 *      tested through `next` rather than by reading the frontmatter back.
 *
 * WHAT IS DELIBERATELY NOT HERE. `next --role <r>` — handing the task to the
 * TARGET role specifically — is TL-98, which owns the dispatcher's side of
 * roles by explicit decision. What this file proves is the half that exists: the
 * task goes back into the queue and `next` hands it out again.
 *
 * The roles are a FIXTURE's, never this repository's: `roles:` is a project's
 * vocabulary, and asserting one project's job titles would make the test a copy
 * of somebody's config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_COMMENT, historyEntryKind } from "../task-fields.mjs";
import { appendEntries, eventId, readHistory } from "../history.mjs";
import { requeueStatus } from "../handoff-task.mjs";
import { SCRIPTS_DIR, alignTemplate, isolateHome } from "./_repo.mjs";
// The suite must not read the DEVELOPER's preferences: since TL-157 the actor
// chain reads the user layer, so a machine with `actor:` in its own config file
// would otherwise see every default-actor assertion below fail.
isolateHome("handoff");


const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** A private state directory per repository, so a lock from one case cannot
 *  reach another — the locks live OUTSIDE the backlog on purpose (TL-87). */
function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

/** A fresh co-located backlog with the given extra configuration lines. */
function repo(configLines) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-handoff-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  if (configLines) {
    const p = join(dir, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\n" + configLines + "\n", "utf8");
    // A fixture that replaces the vocabulary leaves `init`'s template offering
    // the default one — the drift `new` refuses since TL-69. Corrected here the
    // way the refusal tells a user to correct it.
    alignTemplate(dir);
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

const read = (dir, id) => readFileSync(taskFile(dir, id), "utf8");

/** One frontmatter value, without the template's trailing comment — the writer
 *  keeps those on purpose, so a test reading the raw line would compare against
 *  a paragraph of documentation. */
function field(text, key) {
  const line = (text.match(new RegExp("^" + key + ": *(.*)$", "m")) || [])[1];
  return line === undefined ? undefined : line.replace(/\s+#.*$/, "").trim();
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** Every lockfile this repository's state directory holds. */
function locks(dir) {
  const root = join(dir, ".state");
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith(".lock")) out.push(e.name);
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

const ROLES = "roles: [archivist, stonemason]";

// ── The whole exchange, in one pass ───────────────────────────────────────

test("a handoff moves the role, clears the owner, requeues, releases and records", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"]).status, 0);
  assert.equal(locks(dir).length, 1, "the take left no reservation to release");
  const taken = read(dir, id);
  assert.equal(field(taken, "owner"), "agent:claude");
  const inProgress = field(taken, "status");

  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Naming the deeds is an archivist's call, not mine."]);
  assert.equal(r.status, 0, r.stderr);

  const text = read(dir, id);
  assert.equal(field(text, "role"), "archivist", "the task does not ask for the new role");
  assert.equal(field(text, "owner"), '""', "the owner still names the session that handed it on");
  assert.notEqual(field(text, "status"), inProgress, "the task is still in progress after being put down");
  assert.equal(locks(dir).length, 0, "the reservation outlived the handoff");

  const entries = history(dir, id);
  const comment = entries.filter((e) => e.field === FIELD_COMMENT);
  assert.equal(comment.length, 1, "no `" + FIELD_COMMENT + "` entry — the question did not survive the session");
  assert.match(comment[0].to, /archivist's call/, "the comment does not carry what was said");
  assert.equal(comment[0].actor, "agent:claude");
  assert.equal(comment[0].source, "handoff");
  assert.ok(comment[0].id, "the comment has no id — nothing can point at it later");

  // The role change answers on its own, without the reader having to find the
  // comment: one act, one reason, copied onto every row it moved (TL-105).
  const role = entries.filter((e) => e.field === "role");
  assert.equal(role.length, 1);
  assert.match(role[0].reason, /archivist's call/);

  // TL-105 abolished `## Log`. The original task asked for a line there, and
  // writing one would be the second copy of what the history already holds.
  assert.equal(text.includes("## Log"), false, "the handoff wrote prose into the task file");
});

test("the handed-off task goes back into the queue — `next` hands it out again", () => {
  // The task leaving one session has to become available to another, or the
  // command is an elaborate way of abandoning work. (`next --role <r>`, handing
  // it to the TARGET role specifically, is TL-98.)
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"]).status, 0);
  assert.equal(run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Out of my mandate."]).status, 0);

  const r = run(dir, ["next", "--dir", ".", "--actor", "local:analyst"]);
  assert.equal(r.status, 0, "nothing to take — the handoff put the task out of reach: " + r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(id), "`next` handed out something else");
  assert.equal(field(read(dir, id), "owner"), "local:analyst");
});

test("a task in a status this backlog protects keeps it — the handoff is not a status change", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id).replace(/^status: .*$/m, "status: blocked");
  writeFileSync(taskFile(dir, id), before, "utf8");

  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me",
    "--to-role", "stonemason", "--reason", "The wall is the mason's problem."]);
  assert.equal(r.status, 0, r.stderr);
  const text = read(dir, id);
  assert.equal(field(text, "status"), "blocked",
    "`blocked` was entered by a decision with a reason — the handoff undid it");
  assert.equal(field(text, "role"), "stonemason");
});

test("a task nobody reserved can still be handed on", () => {
  // Taking a task by hand is a real route (an editor, a merge), and a handoff
  // that only worked after `take` would be unusable exactly there.
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(locks(dir).length, 0);
  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me",
    "--to-role", "archivist", "--reason", "Never mine to begin with."]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(field(read(dir, id), "role"), "archivist");
});

test("`--to-owner` hands it to a named person", () => {
  const dir = repo(ROLES + "\nowners: [unassigned, mira]");
  const id = newTask(dir, "Sort the deeds");
  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me",
    "--to-owner", "mira", "--reason", "Mira wrote the original schedule."]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(field(read(dir, id), "owner"), "mira");
});

// ── Every refusal, checked against the disk ───────────────────────────────

/** Asserts that a refusal changed nothing: same file, same history. */
function refusedCleanly(dir, id, r, code) {
  assert.equal(r.status, code, "expected exit " + code + ", got " + r.status + ": " + r.stdout + r.stderr);
  return { text: read(dir, id), entries: history(dir, id) };
}

test("without `--reason` it fails with exit 2 and writes nothing", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id);
  const beforeEntries = history(dir, id).length;

  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist"]);
  const after = refusedCleanly(dir, id, r, 2);
  assert.match(r.stderr, /--reason/);
  assert.equal(after.text, before, "the file was written before the refusal");
  assert.equal(after.entries.length, beforeEntries, "a history entry survived the refusal");

  // Positive control: the same call WITH a reason goes through, so the assertions
  // above are about the missing flag and not about a command that never works.
  assert.equal(run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist",
    "--reason", "A stated one."]).status, 0);
  assert.notEqual(read(dir, id), before);
});

test("a reserved reason is refused — a machine's answer may not be typed by hand", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id);
  for (const sentinel of ["unknown", "proven", "   "]) {
    const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", sentinel]);
    assert.equal(r.status, 2, "`--reason " + sentinel + "` was accepted");
    assert.equal(read(dir, id), before);
  }
});

test("neither `--to-role` nor `--to-owner` is a usage error, not a quiet no-op", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id);
  const r = run(dir, ["handoff", id, "--dir", ".", "--reason", "Putting it down."]);
  assert.equal(r.status, 2);
  assert.equal(read(dir, id), before, "the owner was cleared for a handoff with no receiver");
});

test("a role outside the vocabulary fails BEFORE anything is written", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id);

  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archvist", "--reason", "A typo."]);
  const after = refusedCleanly(dir, id, r, 2);
  assert.match(r.stderr, /archvist/, "the message does not name the value");
  assert.match(r.stderr, /archivist, stonemason/, "the message does not say what is allowed");
  assert.equal(after.text, before);
  assert.equal(after.entries.filter((e) => e.field === FIELD_COMMENT).length, 0,
    "a comment was written for a handoff that did not happen");
});

test("a backlog that declares no roles says so, and where to declare them", () => {
  const dir = repo();
  const id = newTask(dir, "Sort the deeds");
  const before = read(dir, id);

  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "Anybody?"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /roles:/);
  assert.match(r.stderr, /config\.yaml/);
  assert.equal(read(dir, id), before);
});

test("a task somebody else is holding is not ours to hand on", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "local:mira"]).status, 0);
  const before = read(dir, id);

  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Not mine."]);
  assert.equal(r.status, 1, "a live claim was handed on from under its holder");
  assert.match(r.stderr, /mira/);
  assert.equal(read(dir, id), before);
  assert.equal(locks(dir).length, 1, "somebody else's reservation was released");
});

test("a closed task is refused — there is nobody waiting on it", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  writeFileSync(taskFile(dir, id), read(dir, id).replace(/^status: .*$/m, "status: done"), "utf8");
  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "Too late."]);
  assert.equal(r.status, 1);
  assert.equal(field(read(dir, id), "role"), '""', "a closed task had its role rewritten");
});

test("a task that is not there is a bad argument (2), not a refusal (1)", () => {
  const dir = repo(ROLES);
  const r = run(dir, ["handoff", "ZZ-999", "--dir", ".", "--to-role", "archivist", "--reason", "Who?"]);
  assert.equal(r.status, 2);
});

test("an unknown flag fails instead of being ignored", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "x", "--frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--frobnicate/);
});

// ── Which status a requeued task goes back to ─────────────────────────────

test("the requeue status comes from where the task was TAKEN from", () => {
  // The default vocabulary leaves TWO statuses meaning "waiting for somebody",
  // so a rule that only read the configuration would be ambiguous in the
  // ordinary case. The task's own history is not: `take` recorded the
  // transition it made, and putting the task down undoes exactly that one.
  const config = {
    statuses: ["pending", "in_progress", "blocked", "done"],
    activeStatuses: ["pending", "in_progress", "blocked"],
    archivedStatuses: ["done"], reasonRequiredStatuses: ["done"], inProgressStatus: "in_progress",
  };
  assert.deepEqual(requeueStatus(config, [], "in_progress"), { ambiguous: ["pending", "blocked"] });

  const taken = [{ field: "status", from: "blocked", to: "in_progress" }];
  assert.deepEqual(requeueStatus(config, taken, "in_progress"), { status: "blocked", from: "history" });

  // The LAST such transition, not the first: a task taken, put down and taken
  // again goes back to where the latest take found it.
  const twice = [
    { field: "status", from: "pending", to: "in_progress" },
    { field: "status", from: "in_progress", to: "blocked" },
    { field: "status", from: "blocked", to: "in_progress" },
  ];
  assert.deepEqual(requeueStatus(config, twice, "in_progress"), { status: "blocked", from: "history" });

  // A status renamed out of the vocabulary since is not somewhere a task can be
  // put — the configuration decides, not a value frozen in an old row.
  const stale = [{ field: "status", from: "triage", to: "in_progress" }];
  assert.deepEqual(requeueStatus(config, stale, "in_progress"), { ambiguous: ["pending", "blocked"] });

  // With one candidate the vocabulary answers on its own, history or not.
  const narrow = { ...config, reasonRequiredStatuses: ["blocked", "done"] };
  assert.deepEqual(requeueStatus(narrow, [], "in_progress"), { status: "pending", from: "vocabulary" });
});

test("with two queue statuses the command refuses and names them; `--status` settles it", () => {
  const dir = repo([
    "statuses: [todo, review, doing, shipped, dropped]",
    "archived_statuses: [shipped, dropped]",
    "reason_required_statuses: [dropped]",
    "in_progress_status: doing",
    "dashboard_open_statuses: [todo, review, doing]",
    ROLES,
  ].join("\n"));
  const id = newTask(dir, "Sort the deeds");
  // Set by hand, so nothing in the history says where it was taken FROM — which
  // is the only case in which the vocabulary has to answer on its own.
  writeFileSync(taskFile(dir, id), read(dir, id)
    .replace(/^status: .*$/m, "status: doing")
    .replace(/^owner: .*$/m, "owner: local:me"), "utf8");
  const before = read(dir, id);

  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me",
    "--to-role", "archivist", "--reason", "Which queue?"]);
  assert.equal(r.status, 1, "a status was chosen for a project that never said which one");
  assert.match(r.stderr, /todo, review/, "the refusal does not name the candidates");
  assert.match(r.stderr, /--status/, "the refusal does not say how to settle it");
  assert.equal(read(dir, id), before);

  const ok = run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me", "--to-role", "archivist",
    "--reason", "Back to review.", "--status", "review"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(field(read(dir, id), "status"), "review");
});

test("`--status` cannot be used to close a task behind `done`'s back", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist",
    "--reason", "Shortcut.", "--status", "done"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /done/);
});

// ── The comment as an event: written, read back, deduplicated ─────────────

test("a comment survives write and read, and two identical ones stay two", () => {
  // The `__created__` rule collapses repetitions of one event seen by several
  // observers. A comment is the opposite case: saying the same thing twice is
  // two things somebody said, and eating the second would edit a conversation.
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  const rows = [
    { ts: "2026-09-01T10:00:00.000Z", to: "Same words." },
    { ts: "2026-09-02T10:00:00.000Z", to: "Same words." },
  ].map((r) => ({
    id: eventId(new Date(r.ts).getTime()), ts: r.ts, task: id, field: FIELD_COMMENT,
    from: "", to: r.to, actor: "local:me", source: "manual", reason: r.to,
  }));
  appendEntries(dir, id, rows);

  const back = readHistory(dir, id).filter((e) => e.field === FIELD_COMMENT);
  assert.equal(back.length, 2, "one of two comments was deduplicated away");
  assert.equal(back[0].to, "Same words.");

  // …while a row union-merge inserted twice is still one row, by id.
  appendEntries(dir, id, [rows[0]]);
  assert.equal(readHistory(dir, id).filter((e) => e.field === FIELD_COMMENT).length, 2,
    "a duplicated write survived the dedup by id");
});

test("a comment reads as a message, not as a transition", () => {
  // The rule the page renders from. A comment run through the transition branch
  // would print an arrow into the text with an empty struck-through half; run
  // through the event branch it would print the label alone and DROP what was
  // said, which is the failure this whole command exists against.
  assert.equal(historyEntryKind({ field: FIELD_COMMENT, from: "", to: "Whose call is this?" }), "message");
  assert.equal(historyEntryKind({ field: "__verified__", from: "", to: "npm test" }), "event");
  assert.equal(historyEntryKind({ field: "__role_override__", from: "a", to: "b" }), "transition");
  assert.equal(historyEntryKind({ field: "status", from: "pending", to: "doing" }), "transition");
});

test("the comment reaches the viewer, and the page renders it through that rule", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["handoff", id, "--dir", ".", "--actor", "local:me",
    "--to-role", "archivist", "--reason", "Whose call is the naming scheme?"]).status, 0);
  assert.equal(run(dir, ["viewer", "--dir", "."]).status, 0);

  const page = readFileSync(join(dir, "viewer.html"), "utf8");
  assert.ok(page.includes("Whose call is the naming scheme?"),
    "the comment is not in the page's history data — nobody can read it there");
  // A green rule the page never calls is a green test with no evidence in it.
  assert.match(page, /historyEntryKind\(/, "the page does not use the rule the test above checks");
});

// ── The machine-readable answer ───────────────────────────────────────────

test("`--json` says what moved, and names the comment by its id", () => {
  const dir = repo(ROLES);
  const id = newTask(dir, "Sort the deeds");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:claude"]).status, 0);
  const r = run(dir, ["handoff", id, "--dir", ".", "--actor", "agent:claude",
    "--to-role", "archivist", "--reason", "Out of my mandate.", "--json"]);
  assert.equal(r.status, 0, r.stderr);

  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.id, id);
  assert.equal(out.role.to, "archivist");
  assert.equal(out.owner.to, "");
  assert.notEqual(out.status.from, out.status.to);
  assert.equal(out.comment.text, "Out of my mandate.");
  assert.ok(out.comment.id, "the comment has no id in the JSON answer");
  assert.equal(out.released, true);

  // The id in the answer is the id on disk: an answer naming a row nobody can
  // find is worse than one that names none.
  const onDisk = history(dir, id).find((e) => e.id === out.comment.id);
  assert.ok(onDisk, "the comment id in the JSON is not in the history file");
  assert.equal(onDisk.field, FIELD_COMMENT);
});
