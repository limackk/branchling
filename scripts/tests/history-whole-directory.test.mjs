/**
 * `history` over the WHOLE directory: record every change it absorbs (TL-185).
 *
 * THE DEFECT, MEASURED. On 2026-09-03 in the worktree
 * `claude/autonomous-flow-tasks-35273f`, nine task files had `executor:` set by
 * hand and TL-183 went from P2 to P1. `history --actor agent:claude --source
 * manual --reason "…"` was then run over the whole directory. Afterwards the
 * snapshot held the new values and NO `.jsonl` had gained a line. The command
 * exited green and said nothing about either.
 *
 * WHAT ACTUALLY CAUSED IT, and it is two defects that only bite together:
 *
 * 1. A SEED NARROWED BY `--file`. `reconcile()` used `only` to decide both which
 *    tasks may produce entries AND which tasks get a reference point. The
 *    post-edit hook always passes `--file`, and `.snapshot.json` is gitignored,
 *    so EVERY fresh worktree starts without one: the first hook run wrote a
 *    snapshot holding one task out of 194.
 * 2. A TASK ABSENT FROM THE SNAPSHOT WAS ABSORBED ON TRUST. With no `before`,
 *    the branch asked one question — is this a creation? — and if the task had
 *    history it wrote nothing and moved the snapshot on. The other 193 tasks
 *    were in exactly that state, so every hand edit to any of them disappeared.
 *
 * WHY THE TESTS ASSERT THE LOG AND THE SNAPSHOT, NOT THE OUTPUT. A fix that
 * only reordered the report would leave the recording defect in place, and the
 * report was never the promise: the log is the evidence layer that the audit,
 * the PR comment and an actor's record all read. The output is asserted in one
 * test at the end, and only for the thing the incident report singles out —
 * that the run said nothing at all.
 *
 * THE POSITIVE CONTROL. Several of these fixtures would pass against a
 * reconcile that recorded NOTHING, so each one that expects silence is paired
 * with a case that expects a written entry from the same shape of tree.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_CREATED, appendEntries, loadSnapshot, readHistory, reconcile, saveSnapshot } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// The suite must not read the DEVELOPER's preferences: the actor chain reads the
// user layer, so a machine with `actor:` in its own config would see the
// attribution assertions below fail for a reason that is not this task's.
isolateHome("history-whole-directory");

const TRASH = [];
process.on("exit", () => {
  for (const dir of TRASH) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover fixture is not a failure */ } }
});

function taskText(over = {}) {
  const f = Object.assign(
    { id: "BL-900", title: "Do the thing", type: "code", labels: "[]", board: "main",
      epic: '""', priority: "P2", status: "pending", owner: "unassigned", estimate: "2h",
      confidence: "high", executor: '""', created: "2026-08-01", updated: "2026-08-01" },
    over
  );
  return ["---", ...Object.keys(f).map((k) => k + ": " + f[k]), "blocked_by: []", "blocks: []",
    "---", "", "## Goal", "", "The body.", ""].join("\n");
}

/** A backlog with `tasks/` and enough beside it to be recognised as one. */
function sandbox(tasks = {}) {
  const dir = mkdtempSync(join(tmpdir(), "backlog-wholedir-"));
  TRASH.push(dir);
  mkdirSync(join(dir, "tasks"));
  // `looksLikeBacklogDir` wants one of boards/config/template; nothing here
  // reads its contents, so an empty file is the honest minimum.
  writeFileSync(join(dir, "config.yaml"), "", "utf8");
  for (const [name, text] of Object.entries(tasks)) writeFileSync(join(dir, "tasks", name), text, "utf8");
  return dir;
}

function writeTask(dir, name, over) {
  writeFileSync(join(dir, "tasks", name), taskText(over), "utf8");
}

function logEntry(over) {
  return Object.assign(
    { id: "01J000000000000000000000AA", ts: "2026-08-30T18:30:00.000Z", task: "BL-900",
      field: "status", from: "pending", to: "in_progress", actor: "agent:claude",
      source: "hook", reason: "moved it" },
    over
  );
}

const fields = (entries, task) => entries.filter((e) => e.task === task).map((e) => e.field);

// ── 1. The seed must cover the tree, not the file that triggered it ────────

test("a `--file` run with no snapshot seeds the WHOLE tree", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900" });
  writeTask(dir, "BL-901-two.md", { id: "BL-901" });
  writeTask(dir, "BL-902-three.md", { id: "BL-902" });

  const res = reconcile(dir, { actor: "agent:claude", source: "hook", only: ["BL-900"] });

  assert.equal(res.seeded, true);
  assert.equal(res.entries.length, 0, "a seed invents no history");
  assert.deepEqual(
    Object.keys(loadSnapshot(dir).tasks).sort(), ["BL-900", "BL-901", "BL-902"],
    "the reference point covers every task, or the ones it missed are blind spots"
  );
});

test("a `--file` run WITH a snapshot still records only the named task", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900" });
  writeTask(dir, "BL-901-two.md", { id: "BL-901" });
  reconcile(dir, { actor: "agent:claude", source: "hook" });          // the reference point

  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress" });
  writeTask(dir, "BL-901-two.md", { id: "BL-901", status: "in_progress" });
  const res = reconcile(dir, { actor: "agent:claude", source: "hook", only: ["BL-900"] });

  // The seed widened; the FILTER did not. BL-901 keeps its old reference point,
  // so the next full run still sees its change.
  assert.deepEqual(res.entries.map((e) => e.task), ["BL-900"]);
  assert.equal(loadSnapshot(dir).tasks["BL-901"].status, "pending");
  assert.deepEqual(fields(readHistory(dir, "BL-901"), "BL-901"), []);

  const after = reconcile(dir, { actor: "agent:claude", source: "manual" });
  assert.deepEqual(after.entries.map((e) => e.task + ":" + e.field), ["BL-901:status"]);
});

// ── 2. A task absent from the snapshot: the measured defect ───────────────

test("a task absent from the snapshot has its change RECORDED, not absorbed", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress" });
  // The state a narrowed seed leaves behind: a task with history, and no key in
  // the snapshot. The log knows the field's last value.
  appendEntries(dir, "BL-900", [logEntry({ field: "status", from: "pending", to: "in_progress" })]);
  saveSnapshot(dir, { version: 1, tasks: {} });

  // The hand edit, exactly the shape of the nine `executor:` edits.
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "blocked" });
  const res = reconcile(dir, { actor: "agent:claude", source: "manual", reason: "parked it" });

  const written = readHistory(dir, "BL-900").filter((e) => e.field === "status");
  assert.equal(written.length, 2, "the edit reached the log");
  assert.equal(written[1].from, "in_progress", "`from` is what the log last saw, not an invention");
  assert.equal(written[1].to, "blocked");
  assert.equal(written[1].actor, "agent:claude");
  assert.equal(written[1].reason, "parked it");
  assert.equal(res.entries.length, 1);
  // And only now may the snapshot say it has seen it.
  assert.equal(loadSnapshot(dir).tasks["BL-900"].status, "blocked");
});

test("a task absent from the snapshot whose log AGREES records nothing", () => {
  // The case the branch was built for: a task that arrived by a pull or a merge
  // brings its own log, so its values are already accounted for. This is the
  // silence that must survive the fix — and the test above is its control.
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress" });
  appendEntries(dir, "BL-900", [logEntry({ field: "status", from: "pending", to: "in_progress" })]);
  saveSnapshot(dir, { version: 1, tasks: {} });

  const res = reconcile(dir, { actor: "agent:claude", source: "manual" });

  assert.deepEqual(res.entries, [], "a pulled task is not re-recorded as somebody else's");
  assert.equal(readHistory(dir, "BL-900").length, 1);
  assert.equal(loadSnapshot(dir).tasks["BL-900"].status, "in_progress");
});

test("a task absent from the snapshot with an EMPTY log is still a creation", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900" });
  saveSnapshot(dir, { version: 1, tasks: {} });

  const res = reconcile(dir, { actor: "agent:claude", source: "manual" });

  assert.deepEqual(res.entries.map((e) => e.field), [FIELD_CREATED]);
  assert.deepEqual(res.adopted, [], "a creation accounts for the whole task");
});

// ── 3. What the log cannot vouch for is NAMED, never swallowed ────────────

test("a field the log has never mentioned is reported as adopted", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress", estimate: "2h" });
  appendEntries(dir, "BL-900", [logEntry({ field: "status", from: "pending", to: "in_progress" })]);
  saveSnapshot(dir, { version: 1, tasks: {} });

  // `estimate` has never been logged, so there is no earlier value to write as
  // `from`. Inventing one would put a fabricated change in an append-only log.
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress", estimate: "9h" });
  const res = reconcile(dir, { actor: "agent:claude", source: "manual" });

  assert.deepEqual(res.entries, [], "nothing is fabricated");
  assert.deepEqual(res.adopted, ["BL-900"], "and nothing is absorbed in silence either");
});

test("`dryRun` reports what it would adopt and writes nothing", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress" });
  appendEntries(dir, "BL-900", [logEntry({ field: "status", from: "pending", to: "in_progress" })]);
  saveSnapshot(dir, { version: 1, tasks: {} });
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "blocked" });

  const res = reconcile(dir, { actor: "agent:claude", source: "manual", dryRun: true });

  assert.equal(res.entries.length, 1);
  assert.deepEqual(Object.keys(loadSnapshot(dir).tasks), [], "a diagnosis moves no reference point");
  assert.equal(readHistory(dir, "BL-900").length, 1, "and writes no entry");
});

// ── 4. The order: the log first, the snapshot after ───────────────────────

test("a failed append leaves the snapshot where it was", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900" });
  reconcile(dir, { actor: "agent:claude", source: "manual" });        // the reference point
  assert.equal(loadSnapshot(dir).tasks["BL-900"].status, "pending");

  // A directory where the `.jsonl` belongs: the append throws. Any failure
  // between the two writes would do; this one is reproducible on every machine.
  mkdirSync(join(dir, "history", "BL-900.jsonl"));
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress" });

  assert.throws(() => reconcile(dir, { actor: "agent:claude", source: "manual" }));
  // A lost reference point is rebuilt by the next run; a lost entry is not
  // rebuilt by anything. So this is the direction the failure has to fall.
  assert.equal(
    loadSnapshot(dir).tasks["BL-900"].status, "pending",
    "the snapshot must not claim to have seen a change no log records"
  );
});

// ── 5. One run says everything it knows ───────────────────────────────────

test("one run reports what it recorded AND what it adopted", () => {
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress", estimate: "2h" });
  writeTask(dir, "BL-901-two.md", { id: "BL-901", status: "in_progress" });
  appendEntries(dir, "BL-900", [logEntry({ task: "BL-900", field: "status", to: "in_progress" })]);
  appendEntries(dir, "BL-901", [logEntry({ task: "BL-901", field: "status", to: "in_progress" })]);
  saveSnapshot(dir, { version: 1, tasks: {} });

  writeTask(dir, "BL-900-one.md", { id: "BL-900", status: "in_progress", estimate: "9h" });
  writeTask(dir, "BL-901-two.md", { id: "BL-901", status: "blocked" });

  const run = spawnSync(process.execPath, [
    join(SCRIPTS_DIR, "history-record.mjs"), "--dir", dir,
    "--actor", "agent:claude", "--source", "manual", "--reason", "a batch of my own edits",
  ], { encoding: "utf8", env: process.env });

  assert.equal(run.status, 0, run.stderr);
  // The incident's complaint in one line: the run reported NEITHER.
  assert.match(run.stdout, /recorded 1 change\(s\)/, "what it wrote");
  assert.match(run.stdout, /BL-901 · status/);
  // BOTH tasks are adopted, including the one an entry was written for: the log
  // vouches for `status` alone, so every other field of BL-901 is still taken on
  // the file's word. Naming only the tasks nothing was recorded for would say
  // the rest were fully accounted for, which is the claim that cannot be made.
  assert.match(run.stdout, /2 task\(s\) had no reference point/, "what it took on trust");
  assert.match(run.stdout, /^ {2}BL-900$/m);
  assert.match(run.stdout, /^ {2}BL-901$/m);
  assert.doesNotMatch(run.stdout, /no changes to record/, "which was never true here");
});

test("a tree with nothing pending still says so", () => {
  // The control for the test above: the sentence it forbids must still be
  // reachable, or the assertion is proving that the string was deleted.
  const dir = sandbox();
  writeTask(dir, "BL-900-one.md", { id: "BL-900" });
  reconcile(dir, { actor: "agent:claude", source: "manual" });

  const run = spawnSync(process.execPath, [
    join(SCRIPTS_DIR, "history-record.mjs"), "--dir", dir, "--actor", "agent:claude",
  ], { encoding: "utf8", env: process.env });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no changes to record/);
});

// ── 6. The whole chain, as it happened ────────────────────────────────────

test("the 2026-09-03 sequence: hook seed, hand edits, then `history`", () => {
  const dir = sandbox();
  for (const n of [900, 901, 902]) {
    writeTask(dir, "BL-" + n + "-t.md", { id: "BL-" + n, status: "in_progress" });
    appendEntries(dir, "BL-" + n, [logEntry({ task: "BL-" + n, field: "status", to: "in_progress" })]);
  }
  assert.equal(existsSync(join(dir, "history", ".snapshot.json")), false, "a fresh worktree has none");

  // 1. the post-edit hook fires for ONE file and seeds.
  reconcile(dir, { actor: "agent:claude", source: "hook", only: ["BL-900"] });
  // 2. the other tasks are edited by hand.
  writeTask(dir, "BL-901-t.md", { id: "BL-901", status: "blocked" });
  writeTask(dir, "BL-902-t.md", { id: "BL-902", status: "done" });
  // 3. the operator records the batch.
  const res = reconcile(dir, { actor: "agent:claude", source: "manual", reason: "my batch" });

  assert.deepEqual(
    res.entries.map((e) => e.task + ":" + e.to).sort(), ["BL-901:blocked", "BL-902:done"],
    "every change the snapshot absorbed is in the log"
  );
  for (const [id, status] of [["BL-901", "blocked"], ["BL-902", "done"]]) {
    const last = readHistory(dir, id).filter((e) => e.field === "status").pop();
    assert.equal(last.to, status);
    assert.equal(last.actor, "agent:claude");
    assert.equal(last.reason, "my batch");
  }
  assert.deepEqual(res.adopted, [], "the seed covered the tree, so nothing was taken on trust");
});
