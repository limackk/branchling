/**
 * A prefix migration is a RENAME for the history, not a deletion plus a
 * creation (TL-111).
 *
 * WHAT WENT WRONG, MEASURED. The BL→TL migration of this repository produced 42
 * files `history/BL-*.jsonl`, each holding a single `__deleted__` record, plus a
 * full set of `__created__` records on the new ids — all stamped with one
 * reconcile run. The history said the whole backlog had been deleted and founded
 * again on the same day. `migrate-prefix` renamed the tasks, the ids, the
 * dependencies and the logs, and left `history/.snapshot.json` — the "last seen
 * frontmatter, keyed by task id" — pointing at ids that no longer existed.
 *
 * WHY THAT IS NOT COSMETIC. `history/*.jsonl` is versioned and merges by union,
 * so the tombstones travel into the repository and stay there. Anything computed
 * from the log afterwards — a task's age, the pace of a board — reads the
 * migration day as the day every task was born.
 *
 * WHAT IS PINNED HERE, in the order the defect is felt:
 *   1. the migrating clone: reconcile after a migration writes NOTHING;
 *   2. the clone next door: its snapshot still holds the old ids, and it repoints
 *      them from the versioned migration record rather than guessing;
 *   3. the guard against over-eager repointing: a clone that has the record but
 *      NOT the renamed tree must be left alone;
 *   4. `--dry-run` names the snapshot and the record, because a migration that
 *      says nothing about them is the one that produced the tombstones.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("migrate-prefix-history");

import {
  FIELD_CREATED,
  FIELD_DELETED,
  MIGRATIONS_FILE,
  SNAPSHOT_FILE,
  applyIdMigrations,
  loadSnapshot,
  readMigrations,
  reconcile,
} from "../history.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args, opts) {
  const r = spawnSync(process.execPath, [CLI, ...args], Object.assign({ encoding: "utf8" }, opts || {}));
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * A backlog under `prefix` with `count` tasks, its history seeded so that the
 * snapshot is a real reference point rather than a first run — reconcile does
 * not invent history when there is no snapshot, and a test starting from that
 * state could not see the defect at all.
 */
function backlog({ prefix = "BL", count = 2 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-migr-hist-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: X-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), `task_id_prefix: ${prefix}\n`, "utf8");
  for (let n = 1; n <= count; n++) {
    const id = `${prefix}-${n}`;
    writeFileSync(
      join(dir, "tasks", `${id}-x.md`),
      [
        "---", `id: ${id}`, `title: "T${n}"`, "type: task", "labels: []", "board: main",
        'epic: ""', "priority: P1", "status: pending", "owner: unassigned",
        "estimate: 2h", "confidence: high", "created: 2026-08-01", "updated: 2026-08-01",
        "blocked_by: []", "blocks: []", "---", "", "## Cel", "", "x", "",
      ].join("\n"),
      "utf8",
    );
  }
  // Seeding writes the reference point and no entries — the state every working
  // clone is in before anybody migrates anything.
  const seeded = reconcile(dir, { actor: "local:test", source: "test" });
  assert.equal(seeded.seeded, true, "the fixture did not start from a seeded snapshot");
  return dir;
}

function withBacklog(opts, fn) {
  const dir = backlog(opts);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every lifecycle record in the whole history directory, whatever the id. */
function tombstones(dir) {
  const historyDir = join(dir, "history");
  if (!existsSync(historyDir)) return [];
  const out = [];
  for (const file of readdirSync(historyDir)) {
    if (!file.endsWith(".jsonl") || file === MIGRATIONS_FILE) continue;
    for (const line of readFileSync(join(historyDir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.field === FIELD_CREATED || e.field === FIELD_DELETED) out.push({ file, ...e });
    }
  }
  return out;
}

// ── The migrating clone ───────────────────────────────────────────────────

test("after a migration, reconcile records NOT ONE deletion or creation", () => {
  withBacklog({ prefix: "BL", count: 3 }, (dir) => {
    const r = cli(["migrate-prefix", "--dir", dir, "--to", "TL", "--actor", "local:test"]);
    assert.equal(r.code, 0, r.out);

    const after = reconcile(dir, { actor: "local:test", source: "boot" });
    assert.deepEqual(
      after.entries.map((e) => `${e.task} ${e.field}`),
      [],
      "reconcile wrote history for a migration that changed no field",
    );
    assert.deepEqual(tombstones(dir), [], "the migration left tombstones in the log");
  });
});

test("after a migration no history file, and no snapshot key, stays on the old prefix", () => {
  withBacklog({ prefix: "BL", count: 3 }, (dir) => {
    // A history log per task, so there is something that CAN be left behind.
    reconcile(dir, { actor: "local:test", source: "test" });
    writeFileSync(join(dir, "tasks", "BL-1-x.md"),
      readFileSync(join(dir, "tasks", "BL-1-x.md"), "utf8").replace("status: pending", "status: in_progress"), "utf8");
    reconcile(dir, { actor: "local:test", source: "test" });
    assert.ok(existsSync(join(dir, "history", "BL-1.jsonl")), "the fixture has no history to migrate");

    assert.equal(cli(["migrate-prefix", "--dir", dir, "--to", "TL"]).code, 0);

    const left = readdirSync(join(dir, "history")).filter((f) => f.startsWith("BL-"));
    assert.deepEqual(left, [], "history files under the old prefix: " + left.join(", "));

    const snap = loadSnapshot(dir);
    const keys = Object.keys(snap.tasks).sort();
    assert.deepEqual(keys, ["TL-1", "TL-2", "TL-3"], "the snapshot keeps the old ids: " + keys.join(", "));
  });
});

test("the migration is recorded as a versioned fact, with its actor", () => {
  withBacklog({ prefix: "BL", count: 1 }, (dir) => {
    assert.equal(cli(["migrate-prefix", "--dir", dir, "--to", "TL", "--actor", "local:kamil"]).code, 0);

    const records = readMigrations(dir);
    assert.equal(records.length, 1, "no record of the migration: " + JSON.stringify(records));
    assert.equal(records[0].kind, "prefix");
    assert.equal(records[0].from, "BL");
    assert.equal(records[0].to, "TL");
    assert.equal(records[0].actor, "local:kamil");
    assert.match(records[0].ts, /^\d{4}-\d{2}-\d{2}T/);

    // The record is DATA in the repository, not a view: it lives beside the logs
    // it explains, under the same `merge=union` rule.
    assert.ok(existsSync(join(dir, "history", MIGRATIONS_FILE)));
  });
});

test("an actor without a namespace is refused BEFORE anything is renamed", () => {
  withBacklog({ prefix: "BL", count: 1 }, (dir) => {
    const r = cli(["migrate-prefix", "--dir", dir, "--to", "TL", "--actor", "kamil"]);
    assert.equal(r.code, 2, r.out);
    assert.ok(existsSync(join(dir, "tasks", "BL-1-x.md")), "the tree was renamed despite the refusal");
    assert.ok(!existsSync(join(dir, "history", MIGRATIONS_FILE)), "a refused run still recorded a migration");
  });
});

// ── The clone next door ───────────────────────────────────────────────────

test("a clone that pulls the migrated tree repoints its OWN snapshot from the record", () => {
  // The snapshot is gitignored, so this clone never received the migrating
  // clone's copy: it has its own, still keyed by `BL-*`. What it DID receive is
  // the tree and the record. Without the record it would produce exactly the 42
  // tombstones this task was opened for.
  withBacklog({ prefix: "BL", count: 3 }, (dir) => {
    const before = loadSnapshot(dir);
    assert.deepEqual(Object.keys(before.tasks).sort(), ["BL-1", "BL-2", "BL-3"]);

    assert.equal(cli(["migrate-prefix", "--dir", dir, "--to", "TL"]).code, 0);

    // Put the stale snapshot back — this is what the other clone holds.
    writeFileSync(join(dir, "history", SNAPSHOT_FILE), JSON.stringify(before), "utf8");

    const r = reconcile(dir, { actor: "local:other", source: "boot" });
    assert.deepEqual(r.entries.map((e) => `${e.task} ${e.field}`), [],
      "the other clone wrote history for somebody else's rename");
    assert.deepEqual(tombstones(dir), []);
    assert.deepEqual(Object.keys(loadSnapshot(dir).tasks).sort(), ["TL-1", "TL-2", "TL-3"]);
  });
});

test("POSITIVE CONTROL: without the record the same clone DOES write tombstones", () => {
  // The guard above has to be able to fail. If reconcile started silencing
  // deletions for some other reason, every assertion in this file would stay
  // green while the defect returned — so the unfixed situation is measured here
  // deliberately: a migrated tree, a stale snapshot, and no record to read.
  withBacklog({ prefix: "BL", count: 3 }, (dir) => {
    const before = loadSnapshot(dir);
    assert.equal(cli(["migrate-prefix", "--dir", dir, "--to", "TL"]).code, 0);
    writeFileSync(join(dir, "history", SNAPSHOT_FILE), JSON.stringify(before), "utf8");
    rmSync(join(dir, "history", MIGRATIONS_FILE));

    const r = reconcile(dir, { actor: "local:other", source: "boot" });
    const deleted = r.entries.filter((e) => e.field === FIELD_DELETED);
    const created = r.entries.filter((e) => e.field === FIELD_CREATED);
    assert.equal(deleted.length, 3, "the measurement is wrong: this state SHOULD produce tombstones");
    assert.equal(created.length, 3);
  });
});

test("a clone holding the record but NOT the renamed tree is left alone", () => {
  // The record and the renamed tasks travel in one commit, but a checkout of an
  // older revision — or a migration killed halfway — separates them. Repointing
  // the key here would MANUFACTURE the pair the record exists to prevent.
  const snapshot = { version: 1, tasks: { "BL-1": { title: "T1" }, "BL-2": { title: "T2" } } };
  const moved = applyIdMigrations(snapshot, [{ kind: "prefix", from: "BL", to: "TL" }], new Set(["BL-1", "BL-2"]));
  assert.equal(moved, 0);
  assert.deepEqual(Object.keys(snapshot.tasks).sort(), ["BL-1", "BL-2"]);

  // Half renamed: only the task that actually moved has its key moved with it.
  const half = { version: 1, tasks: { "BL-1": { title: "T1" }, "BL-2": { title: "T2" } } };
  applyIdMigrations(half, [{ kind: "prefix", from: "BL", to: "TL" }], new Set(["TL-1", "BL-2"]));
  assert.deepEqual(Object.keys(half.tasks).sort(), ["BL-2", "TL-1"]);
});

test("repointing is idempotent — a second pass over the same record changes nothing", () => {
  const snapshot = { version: 1, tasks: { "BL-1": { title: "T1" } } };
  const record = [{ kind: "prefix", from: "BL", to: "TL" }];
  const present = new Set(["TL-1"]);
  assert.equal(applyIdMigrations(snapshot, record, present), 1);
  assert.equal(applyIdMigrations(snapshot, record, present), 0);
  assert.deepEqual(snapshot.tasks, { "TL-1": { title: "T1" } });
});

test("a prefix with a regex metacharacter does not widen the match", () => {
  // `A.B` must not repoint `AxB-1`. The prefix comes from config.yaml, which is
  // user input, and the patterns are built in task-id.mjs for exactly this reason.
  const snapshot = { version: 1, tasks: { "AxB-1": { title: "T" } } };
  const moved = applyIdMigrations(snapshot, [{ kind: "prefix", from: "A.B", to: "TL" }], new Set(["TL-1"]));
  assert.equal(moved, 0);
  assert.deepEqual(Object.keys(snapshot.tasks), ["AxB-1"]);
});

// ── What the run says before it runs ──────────────────────────────────────

test("`--dry-run` names the snapshot and the record among what will change", () => {
  withBacklog({ prefix: "BL", count: 2 }, (dir) => {
    const r = cli(["migrate-prefix", "--dir", dir, "--to", "TL", "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(SNAPSHOT_FILE.replace(".", "\\.")), "the dry run says nothing about the snapshot: " + r.out);
    assert.match(r.out, /2 key\(s\) repointed/, r.out);
    assert.match(r.out, new RegExp(MIGRATIONS_FILE.replace(".", "\\.")), "the dry run says nothing about the record: " + r.out);

    // And it is a DRY run: neither file was touched.
    assert.ok(!existsSync(join(dir, "history", MIGRATIONS_FILE)));
    assert.deepEqual(Object.keys(loadSnapshot(dir).tasks).sort(), ["BL-1", "BL-2"]);
  });
});
