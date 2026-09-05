/**
 * THE DOCUMENTED HAND-EDIT PATH SIGNS TASKS IT DID NOT CREATE (TL-180).
 *
 * `branchling instructions task-execution` prints one route after an edit made
 * by hand: `history --actor <ns:name> --source manual`. In a fresh worktree that
 * route wrote `__created__` entries, under the caller's name, for tasks somebody
 * else had created in another checkout. Measured on 2026-09-03 against TL-173
 * and TL-177; the log is append-only, so the false authorship would have been
 * permanent had the files been committed.
 *
 * WHY THE FRESH WORKTREE IS NOT ALREADY COVERED BY THE SEED. `reconcile` seeds
 * when there is NO snapshot, and since TL-185 that seed covers the whole tree.
 * But `recordEdit` — the route EVERY writing command takes — also creates the
 * snapshot when it finds none, holding the ONE task it just wrote:
 *
 *     const snap = loadSnapshot(backlogDir) || { version: 1, tasks: {} };
 *     snap.tasks[taskId] = pickTracked(after);
 *
 * So `branchling next` (or `take`, or `handoff`) in a new worktree leaves a
 * snapshot of one task out of two hundred, and the seed condition is never
 * reached again. Every other task in the tree is now "missing from the
 * snapshot", and for the ones whose log did not travel with them — an untracked
 * `history/*.jsonl`, which is exactly how the incident was set up — the empty
 * log reads as "this task was created here".
 *
 * Measured in THIS worktree while the task was being written: `next` and
 * `handoff` had left `.snapshot.json` holding 3 tasks out of 223.
 *
 * THE FIXTURES ARE OWN-MADE. Nothing here reads this repository's backlog: the
 * ids, the vocabulary and the snapshot state are all established below, because
 * a test that took them from the tree would be asserting another project's data
 * (AGENTS.md, "Tests").
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { FIELD_CREATED, hasSnapshot, metaFromText, readHistory, reconcile, recordEdit } from "../history.mjs";
import { isolateHome } from "./_repo.mjs";

// The actor resolution chain reads the user layer; a machine carrying its own
// `actor:` would otherwise decide what these assertions are about.
isolateHome("history-manual");

const CALLER = "agent:spec";

function taskFile(over = {}) {
  const f = Object.assign(
    { id: "BL-900", title: "The task this tree is working on", type: "code", labels: "[]",
      board: "main", epic: '""', priority: "P2", status: "pending", owner: '""', estimate: "2h",
      confidence: "high", created: "2026-09-02", updated: "2026-09-02" },
    over
  );
  return [
    "---",
    ...Object.keys(f).map((k) => k + ": " + f[k]),
    "blocked_by: []",
    "blocks: []",
    "---",
    "",
    "## Goal",
    "",
    "The body.",
    "",
  ].join("\n");
}

/**
 * A WORKTREE AS IT REALLY ARRIVES: `tasks/` complete from the branch,
 * `history/.snapshot.json` absent because it is computed and gitignored, and
 * `BL-901`'s log missing because it was never committed in the checkout that
 * created it.
 *
 * `_template.md` is the marker `resolveBacklogDir()` looks for, so the CLI can
 * be pointed at the same fixture the in-process tests use.
 */
function freshWorktree() {
  const dir = mkdtempSync(join(tmpdir(), "backlog-history-manual-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "tasks", "BL-900-mine.md"), taskFile(), "utf8");
  writeFileSync(
    join(dir, "tasks", "BL-901-somebody-elses.md"),
    taskFile({ id: "BL-901", title: "Created yesterday in the main checkout" }),
    "utf8"
  );
  writeFileSync(join(dir, "_template.md"), "---\nid: BL-NNN\n---\n", "utf8");
  assert.equal(hasSnapshot(dir), false, "a fresh worktree has no snapshot — that is the premise");
  return dir;
}

/**
 * What `branchling next` does on its way into the tree: it writes ONE task and
 * records that write. This is the step that creates the partial snapshot; it is
 * spelled out here rather than invoked through the CLI so the test names the
 * mechanism it is about.
 */
function takeTheTask(dir, id = "BL-900") {
  const file = join(dir, "tasks", id === "BL-900" ? "BL-900-mine.md" : "BL-901-somebody-elses.md");
  const before = metaFromText(taskFile({ id }));
  const text = taskFile({ id, status: "in_progress", owner: CALLER });
  writeFileSync(file, text, "utf8");
  recordEdit(dir, { taskId: id, before, after: metaFromText(text), actor: CALLER, source: "next" });
  return file;
}

// ── The seed ──────────────────────────────────────────────────────────────

test("a task the snapshot has never seen is not signed by whoever runs `history`", () => {
  const dir = freshWorktree();
  takeTheTask(dir);                       // the snapshot now holds BL-900 and nothing else
  assert.deepEqual(readHistory(dir, "BL-901"), [], "the premise: BL-901's log did not travel with it");

  reconcile(dir, { actor: CALLER, source: "manual", reason: "edited by hand" });

  const log = readHistory(dir, "BL-901");
  assert.deepEqual(
    log.filter((e) => e.actor === CALLER),
    [],
    "BL-901 was created in another checkout, the day before, by somebody else — this run may " +
      "not put its own name on that event. The log is append-only: the entry it writes here " +
      "cannot be taken back."
  );
  rmSync(dir, { recursive: true, force: true });
});

test("and specifically: no `__created__` for it, whoever it names", () => {
  const dir = freshWorktree();
  takeTheTask(dir);
  const { entries } = reconcile(dir, { actor: CALLER, source: "manual", reason: "edited by hand" });
  assert.deepEqual(
    entries.filter((e) => e.task === "BL-901" && e.field === FIELD_CREATED),
    [],
    "a first pass over a task the snapshot has never seen is a SEED — a reference point, not an event"
  );
  rmSync(dir, { recursive: true, force: true });
});

// ── The positive controls ─────────────────────────────────────────────────
//
// A guard that passes on a zero sample is green with no evidentiary force
// (AGENTS.md). Both tests above would pass against a `reconcile` that recorded
// NOTHING AT ALL, and against a fixture whose files never reached the function.
// These two say what must still happen.

test("POSITIVE CONTROL: a change to a task the snapshot DOES know is still the caller's", () => {
  const dir = freshWorktree();
  const file = takeTheTask(dir);
  writeFileSync(file, taskFile({ status: "in_progress", owner: CALLER, priority: "P1" }), "utf8");

  const { entries } = reconcile(dir, { actor: CALLER, source: "manual", reason: "edited by hand" });

  const priority = entries.filter((e) => e.task === "BL-900" && e.field === "priority");
  assert.equal(priority.length, 1, "the hand edit reached the log — the fixture is not a zero sample");
  assert.equal(priority[0].actor, CALLER, "safety must not be bought by recording nothing");
  assert.equal(priority[0].from, "P2");
  assert.equal(priority[0].to, "P1");
  rmSync(dir, { recursive: true, force: true });
});

test("POSITIVE CONTROL: a task created AFTER the tree has a reference point IS a creation", () => {
  const dir = freshWorktree();
  reconcile(dir, { actor: CALLER, source: "manual" });          // a full pass: the snapshot covers the tree
  writeFileSync(join(dir, "tasks", "BL-902-really-new.md"), taskFile({ id: "BL-902", title: "Really new" }), "utf8");

  const { entries } = reconcile(dir, { actor: CALLER, source: "manual", reason: "edited by hand" });

  const created = entries.filter((e) => e.task === "BL-902" && e.field === FIELD_CREATED);
  assert.equal(created.length, 1, "a task that appeared in a tree the snapshot had covered was created here");
  assert.equal(created[0].actor, CALLER, "and this caller is the one who created it");
  rmSync(dir, { recursive: true, force: true });
});

// ── What the command SAYS ─────────────────────────────────────────────────

const RECORDER = join(dirname(fileURLToPath(import.meta.url)), "..", "history-record.mjs");

function runRecorder(dir, args) {
  return spawnSync(process.execPath, [RECORDER, "--dir", dir].concat(args || []), { encoding: "utf8" });
}

test("CLI: the run reports what it took as a reference point, and claims no creation", () => {
  const dir = freshWorktree();
  takeTheTask(dir);

  const r = runRecorder(dir, ["--actor", CALLER, "--source", "manual", "--reason", "edited by hand"]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.stdout || "";

  assert.ok(!/__created__/.test(out), "it must not report having recorded a creation:\n" + out);
  assert.ok(!/no changes to record/.test(out),
    "silence is indistinguishable from `everything is recorded`, which is what made the\n" +
      "defect invisible on 2026-09-03:\n" + out);
  assert.match(out, /seed|reference point/i,
    "the count of tasks taken as a reference point belongs in the output:\n" + out);
  assert.match(out, /\b1\b/, "and it is a count, not an adjective:\n" + out);
  assert.deepEqual(readHistory(dir, "BL-901").filter((e) => e.actor === CALLER), [],
    "and the output has to agree with the file");
  rmSync(dir, { recursive: true, force: true });
});

test("POSITIVE CONTROL: the same command still reports a real change", () => {
  const dir = freshWorktree();
  const file = takeTheTask(dir);
  reconcile(dir, { actor: CALLER, source: "manual" });          // the whole tree has a reference point
  writeFileSync(file, taskFile({ status: "done", owner: CALLER }), "utf8");

  const r = runRecorder(dir, ["--actor", CALLER, "--source", "manual", "--reason", "edited by hand"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /BL-900/, "the fixture reaches the command — this is not a zero sample");
  assert.match(r.stdout, /status/, "and the change it made is named");
  assert.equal(existsSync(join(dir, "history", "BL-900.jsonl")), true);
  rmSync(dir, { recursive: true, force: true });
});
