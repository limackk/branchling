/**
 * `decide` — a decision recorded as an event (TL-114).
 *
 * WHAT IS ACTUALLY AT RISK:
 *
 *   1. A DECISION THAT LOSES ITS CONTENT. The point of the event is that the
 *      sentence outlives the session, so the assertions read the row back off
 *      disk rather than trusting an exit code.
 *   2. A POINTER THAT ANSWERS NOTHING. `--resolves` naming an event outside this
 *      task's history would leave a question open forever while the log claims
 *      it was settled. It is checked against the FILE after the refusal, because
 *      a gate that fires after the write is worse than no gate.
 *   3. AN "OPEN QUESTION" THAT IS NEITHER. `openQuestions` is the whole
 *      definition of "waiting for a decision" that the panel (TL-115) and the
 *      graph (TL-116) will read, so it is tested with a POSITIVE CONTROL: the
 *      unanswered question is found in the same fixture where the answered one
 *      has gone. A function returning `[]` always would otherwise pass.
 *
 * The vocabulary and the roles are the fixture's own, never this repository's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_COMMENT, FIELD_DECISION, historyEntryKind } from "../task-fields.mjs";
import { openQuestions } from "../history.mjs";
import { parseDecideArgs } from "../decide-task.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("decide");


const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

/** The roles are the FIXTURE's, never this repository's: `roles:` is a
 *  project's vocabulary, and asserting one project's job titles would make the
 *  test a copy of somebody's config.yaml. */
const ROLES = "roles: [archivist, stonemason]";

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-decide-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + ROLES + "\n", "utf8");
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/[A-Z]+-\d+/);
  assert.ok(m, "the id of the new task is not in the output: " + r.stdout);
  return m[0];
}

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const decisions = (dir, id) => history(dir, id).filter((e) => e.field === FIELD_DECISION);

/** A question in the log, put there the way it really arrives: a handoff. */
function askViaHandoff(dir, id, question) {
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:worker"]).status, 0);
  const r = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", question, "--actor", "agent:worker"]);
  assert.equal(r.status, 0, r.stderr);
  const comment = history(dir, id).find((e) => e.field === FIELD_COMMENT && e.to === question);
  assert.ok(comment, "the handoff left no comment to answer");
  return comment;
}

// ── The pair: a question asked, then answered ─────────────────────────────

test("a handoff's question is answered by a decision that points at it", () => {
  const dir = repo();
  const id = newTask(dir, "Which of the two shapes do we build");
  const question = "two shapes are possible here and the choice is a product one";
  const comment = askViaHandoff(dir, id, question);

  assert.equal(openQuestions(history(dir, id)).length, 1);

  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "shape B, because it needs no second file", "--resolves", comment.id, "--actor", "local:kamil"]);
  assert.equal(r.status, 0, r.stderr);

  const rows = decisions(dir, id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to, "shape B, because it needs no second file");
  assert.equal(rows[0].resolves, comment.id);
  assert.equal(rows[0].actor, "local:kamil");
  assert.equal(rows[0].source, "decide");
  assert.match(rows[0].id, /^[0-9A-HJKMNP-TV-Z]{26}$/);

  // The pair closes: nothing is left waiting on this task.
  assert.deepEqual(openQuestions(history(dir, id)), []);
});

test("positive control: an unanswered question stays open in the same log", () => {
  const dir = repo();
  const id = newTask(dir, "Two questions, one answer");
  const first = askViaHandoff(dir, id, "question one, which gets an answer");
  const second = askViaHandoff(dir, id, "question two, which does not");

  assert.equal(run(dir, ["decide", id, "--dir", ".", "--reason", "answering the first", "--resolves", first.id, "--actor", "local:kamil"]).status, 0);

  const open = openQuestions(history(dir, id));
  assert.deepEqual(open.map((e) => e.id), [second.id]);
});

test("a decision may stand on its own — nobody has to have asked", () => {
  const dir = repo();
  const id = newTask(dir, "Decided unprompted");
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "we keep the current shape", "--actor", "local:kamil"]);
  assert.equal(r.status, 0, r.stderr);
  const rows = decisions(dir, id);
  assert.equal(rows.length, 1);
  assert.equal("resolves" in rows[0], false, "an absent pointer must not be written as an empty key");
});

test("two identical decisions at different times are two events, not one", () => {
  const dir = repo();
  const id = newTask(dir, "Said twice");
  for (let i = 0; i < 2; i++) {
    assert.equal(run(dir, ["decide", id, "--dir", ".", "--reason", "the same sentence", "--actor", "local:kamil"]).status, 0);
  }
  const rows = decisions(dir, id);
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});

// ── The gates, each checked against the file afterwards ───────────────────

test("no --reason: exit 2, and nothing is written", () => {
  const dir = repo();
  const id = newTask(dir, "Undecided");
  const r = run(dir, ["decide", id, "--dir", ".", "--actor", "local:kamil"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--reason/);
  assert.deepEqual(decisions(dir, id), []);
});

test("a reserved reason is refused like an empty one", () => {
  const dir = repo();
  const id = newTask(dir, "Sentinel");
  for (const word of ["unknown", "proven"]) {
    const r = run(dir, ["decide", id, "--dir", ".", "--reason", word, "--actor", "local:kamil"]);
    assert.equal(r.status, 2, "`" + word + "` was accepted");
  }
  assert.deepEqual(decisions(dir, id), []);
});

test("--resolves with an id that is in no history at all fails before the write", () => {
  const dir = repo();
  const id = newTask(dir, "Pointing nowhere");
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "answering thin air", "--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--actor", "local:kamil"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /names no event/);
  assert.deepEqual(decisions(dir, id), []);
});

test("--resolves naming an event from ANOTHER task fails: the pair is per task", () => {
  const dir = repo();
  const asked = newTask(dir, "The task that was asked");
  const other = newTask(dir, "The task that was not");
  const comment = askViaHandoff(dir, asked, "the question belongs to this one");

  const r = run(dir, ["decide", other, "--dir", ".", "--reason", "answering somebody else's question", "--resolves", comment.id, "--actor", "local:kamil"]);
  assert.equal(r.status, 1);
  assert.deepEqual(decisions(dir, other), []);
  // The question it really belongs to is untouched.
  assert.equal(openQuestions(history(dir, asked)).length, 1);
});

test("--resolves that is not an event id at all is a usage error, not a refusal", () => {
  const dir = repo();
  const id = newTask(dir, "Malformed pointer");
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "…", "--resolves", "not-an-ulid", "--actor", "local:kamil"]);
  assert.equal(r.status, 2);
  assert.deepEqual(decisions(dir, id), []);
});

test("an unknown task is exit 2; an unknown flag is exit 2", () => {
  const dir = repo();
  assert.equal(run(dir, ["decide", "ZZ-999", "--dir", ".", "--reason", "x", "--actor", "local:kamil"]).status, 2);
  const id = newTask(dir, "Flags");
  assert.equal(run(dir, ["decide", id, "--dir", ".", "--reason", "x", "--nope"]).status, 2);
  assert.deepEqual(decisions(dir, id), []);
});

test("an actor with no namespace is refused before anything is written", () => {
  const dir = repo();
  const id = newTask(dir, "Anonymous");
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "decided by nobody in particular", "--actor", "kamil"]);
  assert.equal(r.status, 2);
  assert.deepEqual(decisions(dir, id), []);
});

// ── What the shape has to keep ────────────────────────────────────────────

test("the task file is not touched: a decision is an event, not a field", () => {
  const dir = repo();
  const id = newTask(dir, "Untouched");
  const file = join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-")));
  const before = readFileSync(file, "utf8");
  assert.equal(run(dir, ["decide", id, "--dir", ".", "--reason", "recorded and nothing else", "--actor", "local:kamil"]).status, 0);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("a decision reads as a message, so the viewer prints its content", () => {
  assert.equal(historyEntryKind({ field: FIELD_DECISION, from: "", to: "we do B" }), "message");
});

test("--json carries the decision and what is still unanswered", () => {
  const dir = repo();
  const id = newTask(dir, "For a program");
  askViaHandoff(dir, id, "the one that stays open");
  const answered = askViaHandoff(dir, id, "the one that gets answered");
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "answered", "--resolves", answered.id, "--actor", "agent:worker", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.decision.resolves, answered.id);
  assert.equal(out.decision.actor, "agent:worker");
  assert.equal(out.openQuestions.length, 1);
  assert.equal(out.openQuestions[0].text, "the one that stays open");
});

test("a closed task still takes a decision — the record is why, not what is next", () => {
  const dir = repo();
  const id = newTask(dir, "Already finished");
  // A contract the template did not write, because `done` refuses a placeholder
  // — the guard is not what this case is about.
  const file = join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^verification:[\s\S]*?(?=^---$)/m, 'verification:\n  - bash: "true"\n    id: the-name\n'), "utf8");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "local:kamil"]).status, 0);
  assert.equal(run(dir, ["done", id, "--dir", "."]).status, 0);
  const r = run(dir, ["decide", id, "--dir", ".", "--reason", "why it was done that way, asked afterwards", "--actor", "local:kamil"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(decisions(dir, id).length, 1);
});

test("the viewer's history axis carries the decision and names the pair", () => {
  const dir = repo();
  const id = newTask(dir, "Read on the page");
  const comment = askViaHandoff(dir, id, "the question the page has to show");
  assert.equal(run(dir, ["decide", id, "--dir", ".", "--reason", "the answer the page has to show", "--resolves", comment.id, "--actor", "local:kamil"]).status, 0);
  assert.equal(run(dir, ["viewer", "--dir", "."]).status, 0);
  const html = readFileSync(join(dir, "viewer.html"), "utf8");
  // ONLY the data is asserted here. The label and the "answers" marker are in
  // the template unconditionally, so matching them would pass for a page that
  // never renders a decision — the assertion that looks strongest is the empty
  // one. What varies with this fixture is the embedded history: the decision's
  // text and the pointer back at the question have to reach the page, and the
  // shared `historyEntryKind` above is what decides how they are drawn.
  assert.match(html, /the answer the page has to show/);
  assert.match(html, new RegExp('"resolves":"' + comment.id + '"'));
});

// ── The argument parser, without a subprocess ─────────────────────────────

test("the parser refuses two ids, and keeps every flag it is given", () => {
  assert.throws(() => parseDecideArgs(["A-1", "A-2", "--reason", "x"]), /one decision belongs to one task/);
  const plan = parseDecideArgs(["A-1", "--reason", "x", "--resolves", "01ARZ3NDEKTSV4RRFFQ69G5FAV", "--actor", "local:k", "--json"]);
  assert.equal(plan.id, "A-1");
  assert.equal(plan.json, true);
  assert.equal(plan.resolves, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
});

test("a flag with no value is a usage error, not a silently empty value", () => {
  assert.throws(() => parseDecideArgs(["A-1", "--reason"]), /with no value/);
});
