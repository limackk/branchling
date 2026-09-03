/**
 * The post-edit hook reconciles the tree the EDITED FILE lives in (TL-195).
 *
 * THE DEFECT. `scripts/regen-hook.mjs` already knows the answer: it resolves the
 * edited file's own backlog root with `backlogForTaskPath()` and spawns
 * `build-backlog.mjs --dir <that root>`. The `history-record.mjs` spawn on the
 * next lines passes `--file` and `--actor` and NO `--dir`, so that process falls
 * back to the rest of the chain in `resolveBacklogDir()` — `BACKLOG_DIR`, then
 * discovery upwards from cwd. The two agree only while the session's cwd sits in
 * the same checkout as the file, which is the ordinary case and the reason
 * nothing has failed yet.
 *
 * WHY THIS IS MEASURED THROUGH THE REAL PROCESS. The bug is not in a function's
 * body but in an argument list — a spawn that declines to pass on a root it
 * already computed. An in-process call to `reconcile()` would have to be handed
 * a directory by the test and could never express the omission. So each case
 * runs `regen-hook` as the editor runs it: JSON on stdin, and a cwd chosen to
 * disagree with the file.
 *
 * WHAT IT ASSERTS, AND WHY BOTH HALVES. The tree that owns the file must gain
 * the entry, and the tree the cwd points at must gain nothing — including no
 * advance of its snapshot. A wrong tree is not merely a missing record: the
 * reconcile that ran there consumed that tree's pending change, so the entry is
 * lost from BOTH sides. The hook runs with `stdio: ignore`, so neither half
 * leaves a trace anybody would read.
 *
 * THE POSITIVE CONTROL. Every case here would also be green against a hook that
 * recorded no history at all, in any tree, for any reason — an empty
 * `history/` satisfies "the wrong tree gained nothing" perfectly. The first test
 * therefore fires the same hook over the same fixture with the cwd INSIDE the
 * file's own tree and demands a written entry. If that one is red, the fixture
 * cannot produce history and the silence of the others proves nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSnapshot, readHistory, reconcile } from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// The actor chain reads the user layer, so a developer with `actor:` in their
// own configuration would change what these entries are attributed to.
isolateHome("hook-target-tree");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const TASK_ID = "BL-900";
const TASK_FILE = "BL-900-do-the-thing.md";

const TRASH = [];
process.on("exit", () => {
  for (const dir of TRASH) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* a leftover fixture is not a failure */ }
  }
});

function taskText(status) {
  return ["---", "id: " + TASK_ID, 'title: "Do the thing"', "type: task", "labels: []",
    "board: main", 'epic: ""', "priority: P2", "status: " + status, "owner: unassigned",
    "estimate: 2h", "confidence: high", 'executor: ""', "created: 2026-08-01",
    "updated: 2026-08-01", "blocked_by: []", "blocks: []", "---", "", "## Goal", "",
    "The body.", ""].join("\n");
}

/**
 * A backlog tree holding `BL-900` at `pending`, WITH a reference point.
 *
 * The snapshot is seeded here rather than left to the run under test: a tree
 * with no snapshot only gets one on the first reconcile and writes no entries
 * at all (TL-185), which would make every case below silent for a reason that
 * has nothing to do with the tree it chose.
 */
function sandbox(label) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  TRASH.push(dir);
  mkdirSync(join(dir, "tasks"));
  // `looksLikeBacklogDir` wants one of boards/config/template beside `tasks/`;
  // the vocabulary is this project's DATA, so the fixture states its own.
  writeFileSync(join(dir, "config.yaml"), "", "utf8");
  writeFileSync(
    join(dir, "boards.yaml"),
    'default: main\nboards:\n  - slug: main\n    name: "Main"\n',
    "utf8"
  );
  writeFileSync(join(dir, "tasks", TASK_FILE), taskText("pending"), "utf8");
  reconcile(dir, { actor: "agent:claude", source: "manual" });
  return dir;
}

/** The edit the hook is supposed to be reacting to. */
function setStatus(dir, status) {
  writeFileSync(join(dir, "tasks", TASK_FILE), taskText(status), "utf8");
}

/** `regen-hook` exactly as an editor fires it: the payload on stdin. */
function hook(file, opts = {}) {
  return spawnSync(process.execPath, [CLI, "regen-hook"], Object.assign(
    {
      encoding: "utf8",
      input: JSON.stringify({ tool_input: { file_path: file } }),
      env: Object.assign({}, process.env, opts.env || {}),
    },
    { cwd: opts.cwd }
  ));
}

const statusEntries = (dir) => readHistory(dir, TASK_ID).filter((e) => e.field === "status");
const snapshotStatus = (dir) => {
  const snap = loadSnapshot(dir);
  return snap && snap.tasks[TASK_ID] ? snap.tasks[TASK_ID].status : null;
};

/** Everything the wrong tree must NOT have: no entry, and no advanced snapshot. */
function assertUntouched(dir, what) {
  assert.deepEqual(
    statusEntries(dir).map((e) => e.from + " → " + e.to), [],
    what + " gained a history entry about a file it was never asked about"
  );
  assert.equal(
    snapshotStatus(dir), "pending",
    what + " had its snapshot advanced, so its own pending change is now unrecordable"
  );
}

// ── The positive control ──────────────────────────────────────────────────

test("the hook records the edit when the cwd IS inside the file's tree", () => {
  // The ordinary case, and the reason nothing has failed yet. It is here to
  // prove the fixture can produce a history entry at all: without it, the
  // silence the cases below demand of the wrong tree would be worthless.
  const own = sandbox("own");
  setStatus(own, "in_progress");

  const r = hook(join(own, "tasks", TASK_FILE), { cwd: own });
  assert.equal(r.status, 0, r.stderr);

  assert.deepEqual(
    statusEntries(own).map((e) => e.from + " → " + e.to), ["pending → in_progress"],
    "the hook recorded nothing in the tree it was standing in — the fixture proves nothing"
  );
});

// ── The defect: a cwd in another worktree ─────────────────────────────────

test("an edit in tree A is recorded in A, with the cwd standing in tree B", () => {
  const a = sandbox("tree-a");
  const b = sandbox("tree-b");
  setStatus(a, "in_progress");
  // B carries a pending change of its own, so a reconcile that lands there has
  // something to write: the wrong tree is caught doing the work, not merely
  // failing to be silent.
  setStatus(b, "blocked");

  const r = hook(join(a, "tasks", TASK_FILE), { cwd: b });
  assert.equal(r.status, 0, r.stderr);

  assert.deepEqual(
    statusEntries(a).map((e) => e.from + " → " + e.to), ["pending → in_progress"],
    "the edited file's own tree has no record of the edit the hook fired for"
  );
  assertUntouched(b, "the cwd's tree");
});

test("an edit in tree A is recorded in A, with BACKLOG_DIR naming tree B", () => {
  // The same omission through the second link of the chain. `--dir` is the only
  // source that outranks the environment, so a hook that passes the root it
  // computed is the only thing that can survive a `BACKLOG_DIR` set to a third
  // tree — a shell export nobody remembers making.
  const a = sandbox("env-a");
  const b = sandbox("env-b");
  setStatus(a, "in_progress");
  setStatus(b, "blocked");

  const r = hook(join(a, "tasks", TASK_FILE), { cwd: a, env: { BACKLOG_DIR: b } });
  assert.equal(r.status, 0, r.stderr);

  assert.deepEqual(
    statusEntries(a).map((e) => e.from + " → " + e.to), ["pending → in_progress"],
    "BACKLOG_DIR overrode a root the hook had already resolved from the file"
  );
  assertUntouched(b, "the tree named by BACKLOG_DIR");
});
