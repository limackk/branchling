/**
 * A hand edit that has not reached the history is REPORTED (TL-162).
 *
 * THE LOOSE END. TL-84 made editing a task file by hand a supported path.
 * Measured afterwards: nothing reconciles except `history --source manual` —
 * not `build`, not `query`, not `stats`, not `check`. Between the edit and
 * somebody remembering that command the change is invisible on the history
 * axis, and nothing said so.
 *
 * WHAT THIS FILE HAS TO RULE OUT, in order of how badly each would hurt:
 *
 *   1. A DIAGNOSIS THAT WRITES. `doctor` fixes nothing by design. A row that
 *      reconciled would sign somebody else's edit with whoever ran it, which is
 *      TL-130's defect, and would move the snapshot forward so the person about
 *      to claim the change finds nothing to claim.
 *   2. A ROW THAT IS ALWAYS GREEN. Every case here has its counterpart: an
 *      untouched tree and the SAME tree with one field changed by hand.
 *   3. A ROW THAT FAILS. An unrecorded change is the normal state while
 *      somebody is working; an error would make `doctor` red for as long as
 *      anybody is editing, and a red that means nothing is trained out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SNAPSHOT_FILE, reconcile } from "../history.mjs";
import { diagnose } from "../doctor.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("unrecorded-drift");


const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

/** A backlog with one task, and a history that has already seen it. */
function settled() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-unrecorded-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  assert.equal(run(dir, ["new", "--dir", ".", "--title", "A task to edit"]).status, 0);
  // Two runs: the first only writes the reference point — we do not invent
  // history for changes nobody was watching — the second records the creation.
  run(dir, ["history", "--dir", ".", "--actor", "local:setup", "--source", "manual"]);
  run(dir, ["history", "--dir", ".", "--actor", "local:setup", "--source", "manual"]);
  return dir;
}

function taskFile(dir) {
  const tasks = join(dir, "tasks");
  return join(tasks, readdirSync(tasks).find((f) => f.endsWith(".md")));
}

function row(dir) {
  return diagnose(dir).find((r) => r.id === "unrecorded");
}

// ── the row ───────────────────────────────────────────────────────────────

test("an untouched tree gives an ok row, and the same tree edited gives a warning", () => {
  // The positive control and the finding in one case, because separately
  // either could pass for the wrong reason.
  const dir = settled();
  const before = row(dir);
  assert.ok(before, "doctor carries no `unrecorded` row at all");
  assert.equal(before.status, "ok", before.detail);

  const file = taskFile(dir);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P0"), "utf8");

  const after = row(dir);
  assert.equal(after.status, "warn", after.detail);
  assert.match(after.detail, /1 change/);
});

test("the row WARNS and never fails — an edit in flight is a normal state", () => {
  const dir = settled();
  const file = taskFile(dir);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P0"), "utf8");

  const rows = diagnose(dir);
  assert.equal(rows.find((r) => r.id === "unrecorded").status, "warn");
  assert.equal(rows.some((r) => r.status === "error"), false,
    "an unrecorded change turned doctor red");

  // And the command agrees with the function: exit 0 with warnings.
  const r = run(dir, ["doctor", "--dir", "."]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /changes not in the log/);
});

test("the row names the command that resolves it, with the actor placeholder", () => {
  // Nobody can act on "there are changes" without being told which command
  // records them, and the actor is the one part the tool must not fill in.
  const dir = settled();
  const file = taskFile(dir);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P0"), "utf8");
  assert.match(row(dir).fix, /history --actor <ns:name> --source manual/);
});

test("a tree with no reference point yet says so, rather than counting to zero", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-unrecorded-fresh-"));
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  assert.equal(existsSync(join(dir, "history", SNAPSHOT_FILE)), false,
    "the fixture already has a snapshot — the case is not the one being tested");
  assert.equal(row(dir).status, "info");
});

// ── it must not write ─────────────────────────────────────────────────────

test("running doctor records NOTHING — not the log, not the reference point", () => {
  const dir = settled();
  const file = taskFile(dir);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P0"), "utf8");

  const historyDir = join(dir, "history");
  const before = readdirSync(historyDir).sort()
    .map((f) => [f, readFileSync(join(historyDir, f), "utf8")]);

  diagnose(dir);
  diagnose(dir);

  const after = readdirSync(historyDir).sort()
    .map((f) => [f, readFileSync(join(historyDir, f), "utf8")]);
  assert.deepEqual(after, before, "doctor appended to the history or moved the snapshot");

  // The consequence that matters: the change is still there to be claimed by
  // the person who made it, under their own name.
  const claimed = run(dir, ["history", "--dir", ".", "--actor", "local:me", "--source", "manual"]);
  assert.equal(claimed.status, 0, claimed.stderr);
  assert.match(readFileSync(join(historyDir, readdirSync(historyDir).find((f) => f.endsWith(".jsonl"))), "utf8"),
    /local:me/);
});

test("reconcile --dryRun returns the same entries a real run would write", () => {
  // The row is only as good as the diff behind it. If the dry mode answered a
  // different question, every case above would be measuring the wrong thing.
  const dir = settled();
  const file = taskFile(dir);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P0"), "utf8");

  const dry = reconcile(dir, { dryRun: true, actor: "local:me" });
  assert.equal(dry.dryRun, true);
  const real = reconcile(dir, { actor: "local:me" });
  assert.deepEqual(
    dry.entries.map((e) => [e.task, e.field, e.from, e.to]),
    real.entries.map((e) => [e.task, e.field, e.from, e.to])
  );

  // And after the real run the row goes quiet — the control that the row is
  // reading the same state the command changes.
  assert.equal(row(dir).status, "ok");
});
