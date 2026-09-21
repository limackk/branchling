/**
 * A hand can ask whose failure it is looking at (TL-276).
 *
 * WHAT WAS BROKEN. A two-hand pipeline commits red on purpose — the `spec`
 * hand's deliverable IS a failing test — and every contract in the repository
 * then runs the whole suite and reports that red as the next hand's own. Two
 * hands measured it in different waves, and both answered the question the same
 * dangerous way: copying a production file out of the tree, restoring the HEAD
 * version to get a baseline, copying it back. One of them was a single command
 * away from committing the wrong version.
 *
 * WHAT IS PROVED HERE. `red` answers the question in one call, and answers it
 * from the commits rather than from a declared list — so there is nothing to
 * keep in step and nothing that can go quietly stale.
 *
 * WHAT IS PROVED JUST AS DELIBERATELY: that the mechanism SUPPRESSES NOTHING.
 * The whole temptation of a known-red list is to stop running the test, and a
 * test that stops running stops proving. So the end-to-end case asserts that
 * every failing file comes back — the ones belonging elsewhere included — and
 * that the exit code does not reproduce the suite's verdict, because a command
 * that failed on somebody else's red would be the original defect again under a
 * new name.
 *
 * THE POSITIVE CONTROLS ARE NOT DECORATION. Every assertion below would pass
 * against a parser that returns nothing and an attribution that answers `null`
 * to everything, which is exactly what a zero sample looks like. Each half is
 * therefore paired with a case that MUST come out differently.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFailures, redOwners, verdictFor } from "../red-owners.mjs";
import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("known-red");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

/**
 * A `node --test` report in BOTH shapes the runner emits, because the caller's
 * suite command is the caller's: TAP states the file as `location:` inside the
 * failure's YAML block, the spec reporter as the `test at` line above it, and
 * `--test` has defaulted to spec since Node 22 whether or not it is writing to
 * a terminal. Written out here rather than produced by running a suite — a test
 * that starts a test runner to get its fixture measures the runner's version as
 * much as this code.
 */
const TAP = [
  "TAP version 13",
  "# Subtest: it holds",
  "ok 1 - it holds",
  "# Subtest: it does not hold",
  "not ok 2 - it does not hold",
  "  ---",
  "  duration_ms: 0.68",
  "  location: 'tests/alpha.test.mjs:12:1'",
  "  error: 'Expected values to be strictly equal'",
  "  ...",
  "# Subtest: fine",
  "ok 3 - fine",
  "# Subtest: also broken",
  "not ok 4 - also broken # some directive",
  "  ---",
  "  location: 'tests/gamma.test.mjs:7:1'",
  "  ...",
  "1..4",
].join("\n");

const SPEC = [
  "✔ it holds (1.2ms)",
  "✖ it does not hold (0.6ms)",
  "✔ fine (0.3ms)",
  "✖ also broken (0.2ms)",
  "ℹ tests 4",
  "ℹ pass 2",
  "ℹ fail 2",
  "",
  "✖ failing tests:",
  "",
  "test at tests/alpha.test.mjs:12:1",
  "✖ it does not hold (0.6ms)",
  "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal",
  "",
  "test at tests/gamma.test.mjs:7:1",
  "✖ also broken (0.2ms)",
].join("\n");

// ── The parse ─────────────────────────────────────────────────────────────

test("the file comes from the failure's own location, in either reporter", () => {
  for (const [label, report] of [["tap", TAP], ["spec", SPEC]]) {
    const files = parseFailures(report);
    assert.deepEqual(files.map((f) => f.name), ["tests/alpha.test.mjs", "tests/gamma.test.mjs"],
      label + ": the failing files were not read from the report");
    assert.deepEqual(files[0].failures, ["it does not hold"], label);
    assert.deepEqual(files[1].failures, ["also broken"], label);
  }
});

test("the NESTING is not what names the file — the flattened report is read too", () => {
  // The reading this replaces: a top-level `not ok` names a file, an indented
  // one names a case inside it. `node --test a b` flattens both files into one
  // numbering, so every failure sits at column zero and the file is nowhere in
  // the structure. A parser built on the nesting attributes both failures here
  // to one file and says so with a straight face.
  const files = parseFailures(TAP);
  assert.equal(files.length, 2, "two files' failures collapsed into one");
  assert.notEqual(files[0].name, files[1].name);
});

test("POSITIVE CONTROL: an all-green report yields nothing, so the parse is reading", () => {
  // Without this every assertion above is satisfied by a function that returns
  // the empty list for any input at all.
  const green = TAP.split("\n").map((l) => l.replace(/^(\s*)not ok/, "$1ok")).join("\n");
  assert.deepEqual(parseFailures(green), []);
  assert.deepEqual(parseFailures(SPEC.slice(0, SPEC.indexOf("✖ failing tests:"))), []);
  assert.equal(parseFailures("").length, 0);
});

test("a failure whose block names no file does not adopt the next one's", () => {
  const orphaned = [
    "not ok 1 - a failure with no location",
    "  ---",
    "  ...",
    "not ok 2 - it does not hold",
    "  ---",
    "  location: 'tests/alpha.test.mjs:12:1'",
    "  ...",
  ].join("\n");
  const files = parseFailures(orphaned);
  assert.deepEqual(files.map((f) => f.name), ["tests/alpha.test.mjs"]);
  assert.deepEqual(files[0].failures, ["it does not hold"],
    "a failure from another block was filed under this file");
});

// ── The verdict ───────────────────────────────────────────────────────────

test("a file this tree has edited is YOURS, whatever the commits say", () => {
  // The working tree outranks the history on purpose: an uncommitted change is
  // nobody else's, and a hand told "not yours" about a file it just edited
  // would go looking for the wrong author.
  const row = { tasks: [P + "-9"], lastTask: P + "-9", uncommitted: true };
  assert.equal(verdictFor(row, P + "-1"), "yours");
});

test("an untouched file last committed by another task is ELSEWHERE", () => {
  const row = { tasks: [P + "-9"], lastTask: P + "-9", uncommitted: false };
  assert.equal(verdictFor(row, P + "-1"), "elsewhere");
  assert.equal(verdictFor(row, P + "-9"), "yours");
});

test("no task in any commit is UNATTRIBUTED, never guessed", () => {
  const row = { tasks: [], lastTask: null, uncommitted: false };
  assert.equal(verdictFor(row, P + "-1"), "unattributed");
  assert.equal(verdictFor(row, null), "unattributed",
    "without --mine the tool still must not invent an owner");
});

test("without --mine nothing is called ELSEWHERE — that word is a claim about the reader", () => {
  const row = { tasks: [P + "-9"], lastTask: P + "-9", uncommitted: false };
  assert.equal(verdictFor(row, null), "attributed");
});

// ── End to end, against real commits ──────────────────────────────────────

/**
 * A disposable repository whose commit titles carry task ids — the convention
 * this project already requires, and the only link between a file and a task.
 *
 * `titled: false` builds the same tree with ids REMOVED from the titles, which
 * is the control: the attribution has to collapse to `unattributed` rather than
 * keep answering from somewhere else.
 */
function repoWithHistory({ titled = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "known-red-"));
  const backlog = join(root, "backlog");
  const init = spawnSync(process.execPath, [join(SCRIPTS, "init-backlog.mjs"), "--dir", backlog],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(init.status, 0, init.stderr);

  const git = (...args) => execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");

  mkdirSync(join(root, "tests"), { recursive: true });
  const commit = (id, file, body, title) => {
    writeFileSync(join(root, "tests", file), body, "utf8");
    git("add", "-A");
    git("commit", "-qm", (titled ? id + " " : "") + title);
  };
  commit(P + "-1", "alpha.test.mjs", "// red on purpose\n", "the alpha contract is stated and unmet");
  commit(P + "-2", "beta.test.mjs", "// green\n", "the beta contract holds");
  commit(P + "-3", "gamma.test.mjs", "// red on purpose\n", "the gamma contract is stated and unmet");
  return { root, backlog };
}

test("each failing file is attributed to the task whose commit last touched it", () => {
  const { root } = repoWithHistory();
  const report = redOwners({
    text: TAP, root, cwd: root, prefix: P, mine: P + "-3",
  });

  const byPath = new Map(report.files.map((f) => [f.path, f]));
  assert.deepEqual([...byPath.keys()].sort(), ["tests/alpha.test.mjs", "tests/gamma.test.mjs"]);
  assert.equal(byPath.get("tests/alpha.test.mjs").lastTask, P + "-1");
  assert.equal(byPath.get("tests/alpha.test.mjs").verdict, "elsewhere");
  assert.equal(byPath.get("tests/gamma.test.mjs").lastTask, P + "-3");
  assert.equal(byPath.get("tests/gamma.test.mjs").verdict, "yours");
  assert.deepEqual(report.tally, { failed: 2, yours: 1, elsewhere: 1, unattributed: 0 });
});

test("POSITIVE CONTROL: with no task id in any commit title, every row is unattributed", () => {
  // The same tree, the same report, one convention removed. Without this the
  // test above would pass against an attribution that reads the filename, the
  // task order, or anything else that happens to correlate on this fixture.
  const { root } = repoWithHistory({ titled: false });
  const report = redOwners({ text: TAP, root, cwd: root, prefix: P, mine: P + "-3" });
  assert.deepEqual(report.files.map((f) => f.lastTask), [null, null]);
  assert.deepEqual(report.files.map((f) => f.verdict), ["unattributed", "unattributed"]);
  assert.equal(report.tally.elsewhere, 0);
});

test("NOTHING IS SUPPRESSED: every failing file is reported, including another task's", () => {
  // The binding half of TL-276. A mechanism that answered "not yours" by
  // dropping the row would satisfy every attribution assertion above and would
  // be the defect the task forbids.
  const { root } = repoWithHistory();
  const report = redOwners({ text: TAP, root, cwd: root, prefix: P, mine: P + "-3" });
  assert.equal(report.files.length, parseFailures(TAP).length,
    "a failing file was dropped from the answer");
  assert.ok(report.files.some((f) => f.verdict === "elsewhere"),
    "the fixture no longer contains somebody else's red, so this proves nothing");
});

test("an empty report is told apart from a report nobody gave", () => {
  // The two are the same empty list and call for opposite decisions: one means
  // the suite is green, the other means nobody looked.
  const { root } = repoWithHistory();
  const green = redOwners({ text: "TAP version 13\n1..0\n", root, cwd: root, prefix: P });
  assert.equal(green.ran, true);
  assert.deepEqual(green.files, []);

  const nothing = redOwners({ text: null, root, cwd: root, prefix: P });
  assert.equal(nothing.ran, false);
  assert.equal(nothing.reason, "no-report");
});

// ── The command ───────────────────────────────────────────────────────────

test("`red` answers in one call, and its exit code is not the suite's verdict", () => {
  const { root, backlog } = repoWithHistory();
  const tap = join(root, "run.txt");
  writeFileSync(tap, TAP, "utf8");

  const r = spawnSync(process.execPath,
    [CLI, "red", "--report", tap, "--mine", P + "-3", "--json", "--dir", backlog],
    { encoding: "utf8", timeout: 120_000, cwd: root });
  assert.equal(r.status, 0,
    "a red suite is an ANSWER — the exit code must not repeat the suite's failure: " + r.stderr);

  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "red-owners");
  assert.equal(answer.tally.failed, 2);
  assert.equal(answer.tally.elsewhere, 1);
  assert.equal(answer.files.find((f) => f.path === "tests/alpha.test.mjs").lastTask, P + "-1");
});

test("an unknown flag fails with exit 2 and names what it accepts", () => {
  const { backlog } = repoWithHistory();
  const r = spawnSync(process.execPath, [CLI, "red", "--frobnicate", "--dir", backlog],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /--command/);
});

test("two reports at once are refused rather than silently ranked", () => {
  const { backlog } = repoWithHistory();
  const r = spawnSync(process.execPath,
    [CLI, "red", "--command", "true", "--report", "-", "--dir", backlog],
    { encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 2, r.stdout);
});
