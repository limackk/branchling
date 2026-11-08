/**
 * `new` names an open task whose title it nearly repeats (TL-649).
 *
 * WHAT IS AT RISK. Two sessions filed the same defect under two titles that
 * differed by one word, both stayed open, and the second was found only by
 * reading the whole open list — after a loop had spent a claim, a review and a
 * merge on it. `new` compared the title with nothing.
 *
 * WHAT IS ASKED, end to end through the CLI on a throwaway backlog: a title one
 * word away from an open task's names that task, in the text form on stderr
 * and in `nearDuplicates` under `--json`, and the task is STILL created — the
 * check must never refuse. The controls: an unrelated title names nothing (an
 * assertion that a note appears would pass on a note that always fires), and a
 * closed task with the same near title is not named, because the scope is the
 * open tasks. The threshold is pinned by PAIRS on both sides of it, not by
 * reading the constant back: a pair at exactly 0.7 must be named ("at or
 * above"), and pairs at 0.67 and 0.69 must not, so moving the threshold out of
 * (0.69, 0.7], or turning `>=` into `>`, fails here. The note also reaches the
 * text form and the envelope of the one refusal that comes after the write
 * (plan-refused).
 *
 * No value of this repository's own configuration is asserted: the closed
 * status is read from the fixture's `archived_statuses`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { nearDuplicateNote, nearDuplicateTitles, titleSimilarity, titleWords } from "../new-task.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("new-duplicate-note");
// Two tests assert an EMPTY stderr; a colour pair left in the environment
// makes Node print its own warning there (TL-434).
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const OPEN_TITLE = "The consumer guide no longer says new has no --json";
const ONE_WORD_AWAY = "The consumer contract no longer says new has no --json";

function run(cwd, args) {
  const env = { ...process.env, BACKLOG_STATE_DIR: join(cwd, ".state") };
  delete env.BACKLOG_ACTOR;
  delete env.BACKLOG_DIR;
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env, input: "" });
}

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
}

function create(dir, title, extra = []) {
  return run(dir, ["new", "--dir", "backlog", "--title", title, "--actor", "agent:test"].concat(extra));
}

/** A git repository holding a backlog with one open task titled OPEN_TITLE. */
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-new-duplicate-note-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  const r = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  const first = create(dir, OPEN_TITLE, ["--json"]);
  assert.equal(first.status, 0, first.stderr);
  return { dir, openId: JSON.parse(first.stdout).id };
}

function taskFiles(dir) {
  return readdirSync(join(dir, "backlog", "tasks")).filter((f) => f.endsWith(".md")).sort();
}

test("a title one word away from an open task names it, and the task is still created", () => {
  const { dir, openId } = repo();
  const before = taskFiles(dir).length;
  const r = create(dir, ONE_WORD_AWAY);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(taskFiles(dir).length, before + 1, "the note refused the task");
  assert.match(r.stderr, /nearly repeats an open task/);
  assert.ok(r.stderr.includes(openId + "  " + OPEN_TITLE), "the open task is not named: " + r.stderr);
  assert.ok(!r.stdout.includes(openId), "the note reached stdout: " + r.stdout);
});

test("under --json the note is `nearDuplicates` in the task-new envelope, and stderr stays empty", () => {
  const { dir, openId } = repo();
  const r = create(dir, ONE_WORD_AWAY, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "task-new");
  assert.equal(doc.ok, true);
  assert.ok(taskFiles(dir).some((f) => f.startsWith(doc.id + "-")), "the reported task was not written");
  assert.deepEqual(doc.nearDuplicates, [{ id: openId, title: OPEN_TITLE, similarity: 0.8 }]);
});

/**
 * A backlog where the next `new --wave first` writes its task and then has the
 * plan refused: the next number is already scheduled in another wave, and the
 * plan does not schedule one id twice.
 */
function planRefusedRepo() {
  const { dir, openId } = repo();
  const m = openId.match(/^(.*-)(\d+)$/);
  assert.ok(m, "the fixture's task has no numbered id: " + openId);
  const nextId = m[1] + (Number(m[2]) + 1);
  writeFileSync(join(dir, "backlog", "plan.yaml"), [
    "updated: 2026-01-01",
    'rationale: "a fixture"',
    "waves:",
    '  - name: "first"',
    "    tasks: [" + openId + "]",
    '  - name: "second"',
    "    tasks: [" + nextId + "]",
    "",
  ].join("\n"), "utf8");
  return { dir, openId };
}

test("a plan refused after the write still names the near task in the text form", () => {
  const { dir, openId } = planRefusedRepo();
  const before = taskFiles(dir).length;
  const r = create(dir, ONE_WORD_AWAY, ["--wave", "first"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /the task was written and the plan was NOT/);
  assert.equal(taskFiles(dir).length, before + 1, "the task was not written, so this is not the refusal after the write");
  assert.match(r.stderr, /nearly repeats an open task/);
  assert.ok(r.stderr.includes(openId + "  " + OPEN_TITLE), "the open task is not named: " + r.stderr);
});

test("a plan refused after the write still carries `nearDuplicates` under --json", () => {
  const { dir, openId } = planRefusedRepo();
  const r = create(dir, ONE_WORD_AWAY, ["--wave", "first", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.kind, "task-new");
  assert.equal(doc.refusalKind, "plan-refused");
  assert.ok(doc.id, "the refusal after the write does not name the written task");
  assert.deepEqual(doc.nearDuplicates, [{ id: openId, title: OPEN_TITLE, similarity: 0.8 }]);
});

test("control: an unrelated title names nothing, in either form", () => {
  const { dir } = repo();
  const text = create(dir, "Fit the viewer connection bar on a phone-width screen");
  assert.equal(text.status, 0, text.stderr);
  // Empty, not merely free of the wording: a note that prints a stray line
  // when nothing is close is a note that always fires.
  assert.equal(text.stderr, "");
  const json = create(dir, "Record the deploy of a release in another repository", ["--json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout).nearDuplicates, []);
});

test("a closed task with the near title is not named: the scope is the open tasks", () => {
  const { dir, openId } = repo();
  const config = loadConfig(join(dir, "backlog"));
  const closed = config.archivedStatuses[0];
  assert.ok(closed, "the fixture declares no archived status");
  const file = join(dir, "backlog", "tasks", taskFiles(dir).find((f) => f.startsWith(openId + "-")));
  const text = readFileSync(file, "utf8");
  const rewritten = text.replace(/^status: .*$/m, "status: " + closed);
  assert.notEqual(rewritten, text, "the fixture task has no status line to close");
  writeFileSync(file, rewritten);
  const r = create(dir, ONE_WORD_AWAY, ["--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).nearDuplicates, []);
});

/** Is `other` named when a task titled `title` is created beside it? */
function named(title, other) {
  return nearDuplicateTitles(title, [{ id: "PROJ-1", title: other, status: "pending" }], { archivedStatuses: [] }).length === 1;
}

test("the measure: word sets, folded, compared against the documented threshold", () => {
  assert.deepEqual([...titleWords("Café --JSON, json")].sort(), ["cafe", "json"]);
  assert.equal(titleSimilarity(OPEN_TITLE, OPEN_TITLE), 1);
  assert.equal(titleSimilarity("", OPEN_TITLE), 0);
  assert.equal(titleSimilarity("", ""), 0, "two empty titles are not a match, and not NaN");
  assert.equal(titleSimilarity(OPEN_TITLE, ONE_WORD_AWAY), 0.8);
  // Replacing one word of a six-word title is the shortest change that is named;
  // two words of it, or one of a four-word title, is not.
  assert.ok(named("a b c d e f", "a b c d e x"), "one word of six (0.71) is not named");
  assert.ok(!named("a b c d e f", "a b c d x y"), "two words of six (0.5) are named");
  assert.ok(!named("a b c d", "a b c x"), "one word of four (0.6) is named");
});

test("the threshold, pinned by pairs on both sides: exactly 0.7 is named, 0.69 and 0.67 are not", () => {
  // 7 shared words over a union of 10.
  assert.equal(titleSimilarity("a b c d e f g h", "a b c d e f g x y"), 0.7);
  assert.ok(named("a b c d e f g h", "a b c d e f g x y"), "a pair at exactly the threshold is not named");
  // 9 over 13 = 0.692, and 4 over 6 = 0.667.
  assert.ok(titleSimilarity("a b c d e f g h i j", "a b c d e f g h i x y z") < 0.7);
  assert.ok(!named("a b c d e f g h i j", "a b c d e f g h i x y z"), "a pair at 0.69 is named");
  assert.ok(!named("a b c d e", "a b c d f"), "a pair at 0.67 is named");
});

test("equal similarity is ordered by id, whatever order the tasks were read in", () => {
  const metas = [
    { id: "PROJ-2", title: "a b c d e y", status: "pending" },
    { id: "PROJ-1", title: "a b c d e x", status: "pending" },
  ];
  assert.deepEqual(nearDuplicateTitles("a b c d e f", metas, { archivedStatuses: [] }).map((d) => [d.id, d.similarity]),
    [["PROJ-1", 0.71], ["PROJ-2", 0.71]]);
});

test("ranking and scope: most similar first, closed tasks and tasks with no id left out", () => {
  const config = { archivedStatuses: ["done"] };
  const metas = [
    { title: "a b c d e f", status: "pending" },
    { id: "PROJ-2", title: "a b c d e x", status: "pending" },
    { id: "PROJ-1", title: "a b c d e f", status: "pending" },
    { id: "PROJ-3", title: "a b c d e f", status: "done" },
    { id: "PROJ-4", title: "unrelated words entirely", status: "pending" },
  ];
  assert.deepEqual(nearDuplicateTitles("a b c d e f", metas, config).map((d) => [d.id, d.similarity]),
    [["PROJ-1", 1], ["PROJ-2", 0.71]]);
});

test("the note's lines: a header that agrees in number, then one line per task", () => {
  const strip = (lines) => lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ""));
  assert.deepEqual(nearDuplicateNote([]), []);
  assert.deepEqual(strip(nearDuplicateNote([{ id: "PROJ-1", title: "a b c d e x", similarity: 0.8 }])), [
    "! the title nearly repeats an open task — the task was created; check it is not the same work:",
    "    PROJ-1  a b c d e x  (similarity 0.80)",
  ]);
  const two = strip(nearDuplicateNote([
    { id: "PROJ-1", title: "a b c d e f", similarity: 1 },
    { id: "PROJ-2", title: "a b c d e x", similarity: 0.71 },
  ]));
  assert.equal(two[0], "! the title nearly repeats open tasks — the task was created; check it is not the same work:");
  assert.deepEqual(two.slice(1), ["    PROJ-1  a b c d e f  (similarity 1.00)", "    PROJ-2  a b c d e x  (similarity 0.71)"]);
});
