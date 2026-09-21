/**
 * A whole-tree migration racing an ordinary writer (TL-228).
 *
 * WHAT THIS FILE MEASURES. `migrate-prefix` and `renumber` end the same way:
 * after every file has been rewritten and renamed they load
 * `history/.snapshot.json`, repoint its keys from the old ids to the new ones
 * and write it back. That is a read-modify-write of ONE file that every other
 * writing route also performs, and until TL-228 the migrations performed it
 * with nothing coordinating them. A writer whose own read-modify-write
 * straddles the migration therefore saves a snapshot keyed by the OLD ids over
 * the repointed one, and the next reconcile compares remembered `OLD-*` against
 * present `NEW-*` and records the whole backlog as deleted and created again —
 * one tombstone per task, in an append-only log, which is the exact failure
 * `applyIdMigrations` was introduced to prevent (TL-111).
 *
 * WHY THE HOLDER IS A CHILD PROCESS. The contention is between OS processes
 * over one file; simulating it inside one process would test the simulation.
 * `withMutex` is reentrant within a process by design, so a same-process
 * "collision" could not even occur.
 *
 * WHY THE HOLDER PAUSES INSIDE THE SECTION, AND WHY THAT IS NOT CHEATING. The
 * defect's window is the migration's load → save tail, a few milliseconds
 * against a migration lasting hundreds. Started merely "at the same time" the
 * two would miss each other in most runs, and a guard that is red one run in
 * three tells the next hand nothing about whether their fix worked — the same
 * reasoning that put a barrier in `concurrent-attribution.test.mjs`, one step
 * further. The pause changes the TIMING, not the mechanism: the holder loads
 * and saves the snapshot through the tool's own `loadSnapshot`/`saveSnapshot`,
 * which is precisely the pair `recordEdit` runs, and it holds the documented
 * section while it does so. The defect is present at any degree of overlap;
 * the pause is what makes the overlap observable instead of lucky.
 *
 * WHY THE FIELD CHANGE IS RECORDED BEFORE THE RACE STARTS. The acceptance
 * criterion asks for two things at once: a snapshot keyed by the new ids AND
 * the writer's change in the log. An append to `history/<ID>.jsonl` made while
 * the migration is renaming that very file is a SECOND race, over a different
 * resource, which this task does not settle and must not quietly appear to.
 * The change is therefore recorded through the documented route first, and the
 * migration then carries that log file across with everything else.
 *
 * HOW THE OVERLAP IS ESTABLISHED RATHER THAN ASSUMED. A race test that passes
 * because the race never happened is a zero sample. The holder reports the
 * wall-clock instants at which it entered and left the section, and the parent
 * polls the tasks directory for the first filename carrying the new prefix.
 * That instant is asserted to fall strictly inside the held window, which
 * proves the migration was rewriting the tree while the section was held. It is
 * evidence that holds in BOTH worlds — before the fix the migration runs
 * straight through, after it the migration waits at its snapshot step, and in
 * either case the renames happen inside the window.
 *
 * THE POSITIVE CONTROLS ARE THE POINT (AGENTS.md). Two of them:
 *   1. The identical fixture and the identical assertions, performed with the
 *      section released BEFORE the migration starts, must be green — otherwise
 *      a red race would not distinguish "they collided" from "the assertion was
 *      unsatisfiable".
 *   2. The section NAME is duplicated between `history.mjs` (privately) and
 *      `snapshot-mutex.mjs`, and a drift between them would switch exclusion
 *      off while every test above stayed green, because they would all be using
 *      the same, wrong name. The LAST test holds the section computed here and
 *      measures that a real `history --file` run is blocked by it.
 *
 * NOTHING HERE ASSERTS ANOTHER PROJECT'S VALUES. The fixture is built by
 * `init`, the old prefix is read back from its own `config.yaml`, and the new
 * one is invented by this file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";
import { withSnapshotMutex } from "../snapshot-mutex.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

isolateHome("migration-snapshot-race");
plainOutput();

/** The prefix the fixture is migrated ONTO, and the first number `renumber` is
 *  asked for. Both invented here, so no project's vocabulary is asserted. */
const NEW_PREFIX = "ZZQ";
const RENUMBER_START = 101;

/**
 * THE TWO CALL SITES, MEASURED SEPARATELY. `migrate-prefix` and `renumber`
 * carry the same three snapshot calls, and one of them fixed while the other
 * was not would be a guard that reports on half the defect. Each descriptor
 * says how to run its migration, what each task's id becomes, and how the tree
 * shows that the rename pass has landed.
 */
const MIGRATIONS = [
  {
    label: "migrate-prefix",
    args: (backlog) => ["migrate-prefix", "--dir", backlog, "--to", NEW_PREFIX, "--actor", "agent:migration"],
    newId: (f, id) => NEW_PREFIX + "-" + numberOf(id),
    landed: (f, names) => names.some((n) => n.startsWith(NEW_PREFIX + "-")),
  },
  {
    label: "renumber",
    args: (backlog) => ["renumber", "--dir", backlog, "--start", String(RENUMBER_START), "--actor", "agent:migration"],
    newId: (f, id) => f.from + "-" + (RENUMBER_START + numberOf(id) - 1),
    landed: (f, names) => names.some((n) => {
      const m = n.match(new RegExp("^" + f.from + "-(\\d+)-"));
      return m && Number(m[1]) >= RENUMBER_START;
    }),
  },
];

function numberOf(id) {
  return Number(id.split("-")[1]);
}

/** How many tasks the fixture holds. Enough that the rename pass is not
 *  instantaneous, few enough that the migration finishes well inside the hold. */
const TASKS = 8;

/** How long the holder stays inside the section. It must exceed the migration's
 *  whole run and stay under `MUTEX_WAIT_MS` (10s), so that the fixed migration
 *  WAITS and completes rather than giving up. */
const HOLD_MS = 3000;

let counter = 0;

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 120_000, env });
}

function prefixOf(backlog) {
  const line = readFileSync(join(backlog, "config.yaml"), "utf8").match(/^task_id_prefix:\s*(\S+)/m);
  assert.ok(line, "the fixture's own configuration must name its id prefix");
  return line[1];
}

function taskFileFor(backlog, id) {
  const dir = join(backlog, "tasks");
  const name = readdirSync(dir).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "the fixture did not keep a file for " + id);
  return join(dir, name);
}

function snapshotKeys(backlog) {
  const file = join(backlog, "history", ".snapshot.json");
  assert.ok(existsSync(file), "the fixture must end with a snapshot; without one nothing was measured");
  return Object.keys(JSON.parse(readFileSync(file, "utf8")).tasks || {});
}

/**
 * A backlog with a reference point already established and one recorded change.
 *
 * THE SEED AND THE RECORDED CHANGE ARE PART OF THE FIXTURE, not of the race. A
 * tree with no snapshot has no reference point to lose, so the whole question
 * would be vacuous.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-migration-race-" + (counter++) + "-"));
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  delete env.BACKLOG_SESSION;
  delete env.BACKLOG_TASK;

  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (let i = 0; i < TASKS; i++) {
    const created = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1)], env);
    assert.equal(created.status, 0, created.stderr);
    const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    assert.ok(id, "the fixture did not learn the new task's identifier: " + created.stdout);
    ids.push(id);
  }
  const seeded = run(["history", "--dir", backlog, "--actor", "local:seed"], env);
  assert.equal(seeded.status, 0, seeded.stderr);
  assert.match(seeded.stdout, /reference point/,
    "the fixture must start from an established reference point, or the race proves nothing");

  // The writer's change, recorded through the documented route, BEFORE any
  // migration exists to collide with its log file.
  const subject = ids[Math.floor(TASKS / 2)];
  const file = taskFileFor(backlog, subject);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/^estimate: .*$/m, "estimate: 9h"), "utf8");
  const recorded = run(["history", "--dir", backlog, "--file", file, "--actor", "agent:writer",
    "--source", "manual", "--reason", "the writer's own change, made before the migration starts"], env);
  assert.equal(recorded.status, 0, recorded.stderr);

  return { dir, backlog, state, env, ids, subject, from: prefixOf(backlog) };
}

/** The child that holds the snapshot section across a measurable pause,
 *  performing the two halves of the read-modify-write `recordEdit` performs. */
function holderChild(dir) {
  const file = join(dir, "holder.mjs");
  writeFileSync(file, [
    'import { writeFileSync } from "node:fs";',
    'import { pathToFileURL } from "node:url";',
    'import { join } from "node:path";',
    'const [scripts, backlog, taskId, holdMs, report] = process.argv.slice(2);',
    'const history = await import(pathToFileURL(join(scripts, "history.mjs")).href);',
    'const mutex = await import(pathToFileURL(join(scripts, "snapshot-mutex.mjs")).href);',
    'let entered = 0;',
    'mutex.withSnapshotMutex(backlog, () => {',
    '  entered = Date.now();',
    '  const snap = history.loadSnapshot(backlog);',
    '  if (!snap) { process.stderr.write("no snapshot to hold\\n"); process.exit(1); }',
    '  // Spin, do not sleep: the section has to be demonstrably occupied, and a',
    '  // timer would hand the process back to nothing anybody can observe.',
    '  while (Date.now() - entered < Number(holdMs)) { /* the held window */ }',
    '  snap.tasks[taskId] = { ...snap.tasks[taskId], confidence: "high" };',
    '  history.saveSnapshot(backlog, snap);',
    '});',
    'writeFileSync(report, JSON.stringify({ entered, left: Date.now() }), "utf8");',
  ].join("\n"), "utf8");
  return file;
}

/** Wait until `fn()` is true, or give up; returns the instant it became true. */
function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return Date.now();
    if (Date.now() >= deadline) return null;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
}

function migratedYet(f, migration) {
  return migration.landed(f, readdirSync(join(f.backlog, "tasks")));
}

/** What every case asserts once the dust has settled. */
function assertHealthy(f, migration, note) {
  const keys = snapshotKeys(f.backlog);
  const expected = f.ids.map((id) => migration.newId(f, id));
  const stale = keys.filter((k) => !expected.includes(k));
  assert.deepEqual(stale, [],
    note + "\nthe snapshot still carries keys naming ids the tree no longer holds. The next\n" +
    "reconcile compares these against the tasks actually present and records the whole\n" +
    "backlog as deleted and created again — one tombstone per task, in a log nobody may\n" +
    "rewrite (TL-111).\n" +
    "  snapshot keys: " + JSON.stringify(keys) + "\n" +
    "  ids present:   " + JSON.stringify(expected));
  assert.ok(keys.length >= TASKS, "the snapshot must still cover the tree: " + JSON.stringify(keys));

  const log = join(f.backlog, "history", migration.newId(f, f.subject) + ".jsonl");
  assert.ok(existsSync(log), note + "\nthe writer's log did not travel with the migration: " + log);
  const estimates = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.field === "estimate");
  assert.deepEqual(estimates.map((e) => e.to), ["9h"],
    note + "\nthe writer's own change is not in the log exactly once.");
}

// ── positive control: the same acts, with no overlap ──────────────────────

for (const migration of MIGRATIONS) {
  test("POSITIVE CONTROL: " + migration.label + " after the section is released — the snapshot ends keyed by the new ids", async () => {
    const f = fixture();
    const holder = holderChild(f.dir);
    const report = join(f.dir, "holder.json");

    const code = await new Promise((res) => spawn(process.execPath,
      [holder, SCRIPTS_DIR, f.backlog, f.subject, "200", report],
      { stdio: ["ignore", "inherit", "inherit"], env: f.env }).on("exit", res));
    assert.equal(code, 0, "the holder's own work succeeded");

    const migrated = run(migration.args(f.backlog), f.env);
    assert.equal(migrated.status, 0, migrated.stderr);

    assertHealthy(f, migration, "Performed one after the other, with nothing to collide with, these assertions must\n" +
      "hold — this is the control that gives the race case its force.");
  });
}

// ── the race itself ──────────────────────────────────────────────────────

for (const migration of MIGRATIONS) {
  test(migration.label + " racing a writer's read-modify-write leaves the snapshot keyed by the new ids", async () => {
    const f = fixture();
    const holder = holderChild(f.dir);
    const report = join(f.dir, "holder.json");

    const holding = new Promise((res) => spawn(process.execPath,
      [holder, SCRIPTS_DIR, f.backlog, f.subject, String(HOLD_MS), report],
      { stdio: ["ignore", "inherit", "inherit"], env: f.env }).on("exit", res));

    // Start the migration only once the section is demonstrably occupied — the
    // mutex file appearing is the observable, not a guess about scheduling.
    const mutexDir = join(f.state, "mutex");
    const held = waitFor(() => existsSync(mutexDir) && readdirSync(mutexDir).length > 0, 10_000);
    assert.ok(held, "the holder never entered the section; nothing was measured");

    const migrating = new Promise((res) => spawn(process.execPath,
      [CLI].concat(migration.args(f.backlog)),
      { stdio: ["ignore", "inherit", "inherit"], env: f.env }).on("exit", res));

    // THE EVIDENCE THAT THE OVERLAP HAPPENED: the instant the migration's rename
    // pass first became visible in the tree.
    const renamedAt = waitFor(() => migratedYet(f, migration), 60_000);

    const [holderCode, migrationCode] = await Promise.all([holding, migrating]);
    assert.equal(holderCode, 0, "the holder's own work succeeded");
    assert.equal(migrationCode, 0, "the migration's own command succeeded — waiting for the section is not failing");

    const window = JSON.parse(readFileSync(report, "utf8"));
    assert.ok(renamedAt, "the migration never renamed anything; there was no race to observe");
    assert.ok(renamedAt > window.entered && renamedAt < window.left,
      "THE OVERLAP DID NOT HAPPEN, so this run proves nothing either way.\n" +
      "  section held: " + window.entered + " … " + window.left + "\n" +
      "  tree renamed: " + renamedAt);

    assertHealthy(f, migration, "A migration and a writer overlapped: the writer was inside the snapshot's\n" +
      "read-modify-write while " + migration.label + " rewrote every id in the tree.");
  });
}

// ── positive control for the section NAME ────────────────────────────────

test("POSITIVE CONTROL: the section the migrations hold is the one an ordinary writer holds", async () => {
  const f = fixture();
  const file = taskFileFor(f.backlog, f.ids[0]);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^estimate: .*$/m, "estimate: 4h"), "utf8");

  // The child must compute its section from `history.mjs`; this process computes
  // its own from `snapshot-mutex.mjs`. If the two names ever drift apart, the
  // child sails through and every other test in this file stays green while
  // exclusion is off.
  const previous = process.env.BACKLOG_STATE_DIR;
  process.env.BACKLOG_STATE_DIR = f.state;
  let child = null;
  let startedAt = 0;
  try {
    // THE BODY IS SYNCHRONOUS ON PURPOSE. `withMutex` releases the section when
    // `fn` RETURNS, and an async body returns a promise at its first `await` —
    // which would hand the section back while the test still believed it held
    // it, and this control would then pass without measuring anything.
    withSnapshotMutex(f.backlog, () => {
      startedAt = Date.now();
      child = new Promise((res) => spawn(process.execPath,
        [CLI, "history", "--dir", f.backlog, "--file", file, "--actor", "agent:writer",
          "--source", "manual", "--reason", "a writer arriving while the section is held"],
        { stdio: ["ignore", "inherit", "inherit"], env: f.env }).on("exit", res));
      const deadline = startedAt + 1500;
      while (Date.now() < deadline) { /* the held window */ }
    });
  } finally {
    if (previous === undefined) delete process.env.BACKLOG_STATE_DIR;
    else process.env.BACKLOG_STATE_DIR = previous;
  }
  assert.equal(await child, 0, "the writer waited for its turn and then succeeded");
  const elapsed = Date.now() - startedAt;

  // One-sided on purpose: a loaded machine can only make this LONGER. The only
  // way it comes back short is exclusion that is not there.
  assert.ok(elapsed >= 1200,
    "a writer started while this process held the snapshot section returned after " + elapsed +
    "ms, so it was not excluded. The name computed by scripts/snapshot-mutex.mjs and the one\n" +
    "computed privately inside scripts/history.mjs no longer name the same section — which\n" +
    "means the migrations now hold a section nobody else respects.");
});
