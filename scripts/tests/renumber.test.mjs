/**
 * Renumbering is a rename for the history and a REWRITE for the prose (TL-135).
 *
 * WHY THIS IS A DIFFERENT TEST FILE FROM THE PREFIX MIGRATION. The two commands
 * share machinery and differ on the one thing that makes them dangerous. After a
 * prefix migration, an id left behind in prose points at nothing — a reader hits
 * a dead end and knows something moved. After a renumber, the same id still
 * exists and names a DIFFERENT task: the reader is not stopped, they are misled.
 * So the assertions here are about what happens to text, and about the two
 * places where a rewrite must NOT reach.
 *
 * THE FIXTURE NUMBERS ARE DELIBERATELY FAR FROM ANY REAL ONES (9xxx). This file
 * is itself inside a backlog that this command renumbers, and ids that looked
 * like the repository's own were rewritten by a real run — the fixture then
 * asserted against numbers nobody chose.
 *
 * WHAT IS PINNED, in the order the defect would be felt:
 *   1. the map is contiguous, ordered by the OLD number, and lands on the tasks;
 *   2. prose in task bodies and in `--also` files follows the map;
 *   3. an id the map does not know is LEFT ALONE and reported — the positive
 *      control, because a rewrite that quietly renamed unknown ids would pass
 *      every other assertion here;
 *   4. `history/*.jsonl` moves by filename and `task` field, and its prose does
 *      not move, because the log is append-only;
 *   5. overlapping id spaces (1303 → 1 while 1 exists) do not eat a task;
 *   6. reconcile after a renumber records NOTHING — the tombstone defect of
 *      TL-111, which a second kind of migration record could reintroduce.
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
isolateHome("renumber");

import { FIELD_CREATED, FIELD_DELETED, MIGRATIONS_FILE, applyIdMigrations, readMigrations, reconcile } from "../history.mjs";
import { EXAMPLE_MARKER, planRenumber, rewriteIds, rewriteHistoryFile } from "../renumber.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

/**
 * A backlog whose numbers start high and have a gap — the shape this command
 * exists for. `bodies` maps an id to the prose put in its body.
 */
function backlog({ prefix = "TL", numbers = [9301, 9305, 9310], bodies = {}, seed = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-renumber-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: X-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), `task_id_prefix: ${prefix}\n`, "utf8");
  numbers.forEach((n, i) => {
    const id = `${prefix}-${n}`;
    const blockedBy = i === 0 ? [] : [`${prefix}-${numbers[0]}`];
    writeFileSync(
      join(dir, "tasks", `${id}-slug.md`),
      [
        "---", `id: ${id}`, `title: "T${n}"`, "type: task", "labels: []", "board: main",
        'epic: ""', "priority: P1", "status: pending", "owner: unassigned",
        "estimate: 2h", "created: 2026-08-01", "updated: 2026-08-01",
        `blocked_by: [${blockedBy.join(", ")}]`, "blocks: []", "---", "",
        "## Cel", "", bodies[id] || "x", "",
      ].join("\n"),
      "utf8",
    );
  });
  if (seed) {
    // Seeding writes the reference point and no entries — the state every
    // working clone is in before anybody migrates anything.
    const seeded = reconcile(dir, { actor: "local:test", source: "test" });
    assert.equal(seeded.seeded, true, "the fixture did not start from a seeded snapshot");
  }
  // A log per task, written directly: seeding deliberately records nothing, and
  // a fixture with no logs could not see the defect this file is about.
  mkdirSync(join(dir, "history"), { recursive: true });
  for (const n of numbers) {
    const id = `${prefix}-${n}`;
    writeFileSync(
      join(dir, "history", `${id}.jsonl`),
      JSON.stringify({ id: `E${n}`, ts: "2026-08-01T00:00:00.000Z", task: id, field: "status", from: "pending", to: "in_progress", actor: "local:test", source: "test", reason: "unknown" }) + "\n",
      "utf8",
    );
  }
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

const taskNames = (dir) => readdirSync(join(dir, "tasks")).sort();
const read = (dir, ...p) => readFileSync(join(dir, ...p), "utf8");

// ── The map ───────────────────────────────────────────────────────────────

test("the map is contiguous and ordered by the OLD number, not by filename", () => {
  withBacklog({ numbers: [9310, 9301, 9305] }, (dir) => {
    const plan = planRenumber(dir, "TL", { start: 9100 });
    assert.deepEqual(
      [...plan.idMap],
      [["TL-9301", "TL-9100"], ["TL-9305", "TL-9101"], ["TL-9310", "TL-9102"]],
    );
  });
});

test("--start moves the whole range, it does not restart it", () => {
  withBacklog({ numbers: [9301, 9305] }, (dir) => {
    const plan = planRenumber(dir, "TL", { start: 9400 });
    assert.deepEqual([...plan.idMap.values()], ["TL-9400", "TL-9401"]);
  });
});

test("filenames, `id:` and `blocked_by` all land on the new number", () => {
  withBacklog({ numbers: [9301, 9305] }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100", "--actor", "local:test"]);
    assert.equal(r.code, 0, r.out);

    assert.deepEqual(taskNames(dir), ["TL-9100-slug.md", "TL-9101-slug.md"]);
    const second = read(dir, "tasks", "TL-9101-slug.md");
    assert.match(second, /^id: TL-9101$/m);
    assert.match(second, /^blocked_by: \[TL-9100\]$/m, "a dependency kept pointing at the old number");
  });
});

test("an already contiguous backlog is a no-op that says so", () => {
  withBacklog({ numbers: [9100, 9101, 9102] }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /nothing to do/);
    assert.deepEqual(taskNames(dir), ["TL-9100-slug.md", "TL-9101-slug.md", "TL-9102-slug.md"]);
  });
});

// ── Prose ─────────────────────────────────────────────────────────────────

test("prose in a task body follows the map — this is where it differs from migrate-prefix", () => {
  withBacklog({ numbers: [9301, 9305], bodies: { "TL-9305": "As decided in TL-9301, see backlog/tasks/TL-9301-slug.md." } }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    const body = read(dir, "tasks", "TL-9101-slug.md");
    assert.match(body, /As decided in TL-9100,/);
    assert.match(body, /backlog\/tasks\/TL-9100-slug\.md/, "the id inside a path did not move");
  });
});

test("--also rewrites a file outside the backlog", () => {
  withBacklog({ numbers: [9301, 9305] }, (dir) => {
    const doc = join(dir, "..", `renumber-doc-${process.pid}.md`);
    writeFileSync(doc, "TL-9305 is the interesting one.\n", "utf8");
    try {
      const r = cli(["renumber", "--dir", dir, "--start", "9100", "--also", doc]);
      assert.equal(r.code, 0, r.out);
      assert.equal(readFileSync(doc, "utf8"), "TL-9101 is the interesting one.\n");
    } finally {
      rmSync(doc, { force: true });
    }
  });
});

// ── An example is not a reference (TL-136) ────────────────────────────────

/** The sentence the real run destroyed: an id in the role of an EXAMPLE. */
const EXAMPLE_LINE = "TL-9305 becomes TL-9100 only because of where it sat in one ordering.";

test("an id marked as an example survives the rewrite that surrounds it", () => {
  withBacklog({
    numbers: [9301, 9305],
    bodies: { "TL-9301": `${EXAMPLE_LINE} // ${EXAMPLE_MARKER}\nBut the real reference in TL-9305 moves.` },
  }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    const body = read(dir, "tasks", "TL-9100-slug.md");
    assert.match(body, new RegExp(EXAMPLE_LINE.replace(/[.]/g, "\\.")), "the marked example was rewritten anyway");
    // The other half of the same file: the marker covers ONE line, not the file.
    assert.match(body, /the real reference in TL-9101 moves/, "the marker leaked onto the next line");
    assert.match(r.out, new RegExp(EXAMPLE_MARKER), "the exemption was honoured silently");
  });
});

test("POSITIVE CONTROL: without the marker that same sentence is destroyed", () => {
  // Without this the test above passes just as well against a rewrite that
  // never touched the body at all — which is the failure mode of every
  // "the text is still there" assertion.
  withBacklog({ numbers: [9301, 9305], bodies: { "TL-9301": EXAMPLE_LINE } }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    const body = read(dir, "tasks", "TL-9100-slug.md");
    assert.match(body, /TL-9101 becomes TL-9100/, "the fixture no longer demonstrates the defect");
    assert.doesNotMatch(body, new RegExp(EXAMPLE_LINE.replace(/[.]/g, "\\.")));
  });
});

test("the convention is printed by the command, not only agreed in a task", () => {
  // Criterion of TL-136: the next author of such a comment has to be able to
  // find this without reading the task that introduced it. `--help` is where
  // they look, and the module header is what a reader of the code sees.
  const help = cli(["renumber", "--help"]);
  assert.equal(help.code, 0, help.out);
  assert.match(help.out, new RegExp(EXAMPLE_MARKER), "`--help` does not name the marker");
  assert.match(help.out, /example/i);

  const header = readFileSync(join(SCRIPTS_DIR, "renumber.mjs"), "utf8").split("*/")[0];
  assert.match(header, new RegExp(EXAMPLE_MARKER), "the module header still promises a rewrite with no exception");
});

test("POSITIVE CONTROL: an id the map does not know is left alone and reported", () => {
  withBacklog({ numbers: [9301, 9305], bodies: { "TL-9301": "Compare with TL-9999, which is not in this backlog." } }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    assert.match(read(dir, "tasks", "TL-9100-slug.md"), /TL-9999/, "an unknown id was rewritten");
    assert.match(r.out, /TL-9999/, "an unknown id was rewritten silently, or not mentioned at all");
  });
});

test("a longer number is a different id, not a prefix of a known one", () => {
  const idMap = new Map([["TL-9301", "TL-9100"]]);
  const res = rewriteIds("TL-9301 and TL-93011 and XTL-9301", idMap, "TL");
  assert.equal(res.text, "TL-9100 and TL-93011 and XTL-9301");
  assert.deepEqual(res.unknown, ["TL-93011"]);
});

// ── The history log ───────────────────────────────────────────────────────

test("a history log follows its task by filename and by `task` field", () => {
  withBacklog({ numbers: [9301, 9305] }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100", "--actor", "local:test"]);
    assert.equal(r.code, 0, r.out);

    const logs = readdirSync(join(dir, "history")).filter((f) => f.endsWith(".jsonl") && f !== MIGRATIONS_FILE).sort();
    assert.deepEqual(logs, ["TL-9100.jsonl", "TL-9101.jsonl"]);
    for (const f of logs) {
      for (const line of read(dir, "history", f).split("\n").filter(Boolean)) {
        assert.equal(JSON.parse(line).task, f.replace(".jsonl", ""));
      }
    }
  });
});

test("prose INSIDE a history record is not rewritten — the log is append-only", () => {
  const idMap = new Map([["TL-9301", "TL-9100"]]);
  const line = JSON.stringify({ task: "TL-9301", field: "status", reason: "blocked by TL-9301" });
  const res = rewriteHistoryFile(line, idMap, "TL");
  const out = JSON.parse(res.text);
  assert.equal(out.task, "TL-9100", "the `task` field must follow the rename");
  assert.equal(out.reason, "blocked by TL-9301", "somebody's stated reason was edited after the fact");
  assert.equal(res.prose, 1, "the untouched mention was not counted for the report");
});

test("the migration record carries the whole map, and the map file is not rewritten by itself", () => {
  withBacklog({ numbers: [9301, 9305] }, (dir) => {
    assert.equal(cli(["renumber", "--dir", dir, "--start", "9100", "--actor", "local:test"]).code, 0);
    const records = readMigrations(dir).filter((m) => m.kind === "renumber");
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].map, { "TL-9301": "TL-9100", "TL-9305": "TL-9101" });
    assert.match(read(dir, "history", MIGRATIONS_FILE), /TL-9301/, "the record stopped speaking in old ids");
  });
});

// ── The two failure modes that would destroy data ─────────────────────────

test("overlapping old and new id spaces do not eat a task", () => {
  // 1 → 1 stays, 1303 → 2: the rename of 1303 lands on a name that is free only
  // because nothing has moved onto it. Done in one pass, in the wrong order,
  // this overwrites a real task.
  withBacklog({ numbers: [9100, 9301, 9305] }, (dir) => {
    const r = cli(["renumber", "--dir", dir, "--start", "9100"]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(taskNames(dir), ["TL-9100-slug.md", "TL-9101-slug.md", "TL-9102-slug.md"]);
    assert.equal(readdirSync(join(dir, "tasks")).length, 3, "a task was lost in the rename");
  });
});

test("after a renumber, reconcile records NOT ONE deletion or creation", () => {
  withBacklog({ numbers: [9301, 9305, 9310] }, (dir) => {
    assert.equal(cli(["renumber", "--dir", dir, "--start", "9100", "--actor", "local:test"]).code, 0);
    const after = reconcile(dir, { actor: "local:test", source: "boot" });
    assert.deepEqual(
      after.entries.filter((e) => e.field === FIELD_CREATED || e.field === FIELD_DELETED).map((e) => `${e.task} ${e.field}`),
      [],
      "the renumber was recorded as the backlog being deleted and founded again",
    );
  });
});

test("a clone holding the record but NOT the renamed tree is left alone", () => {
  // The over-eager repointing guard, for the renumber kind. A clone can hold the
  // log without holding the renamed tasks — one checkout of an older revision is
  // enough. Rewriting its snapshot then MANUFACTURES the tombstone pair the
  // record exists to prevent.
  const record = { kind: "renumber", map: { "TL-9301": "TL-9100" } };
  const stale = { version: 1, tasks: { "TL-9301": {} } };
  assert.equal(applyIdMigrations(stale, [record], new Set(["TL-9301"])), 0, "it repointed a key whose old task is still on disk");
  assert.deepEqual(Object.keys(stale.tasks), ["TL-9301"]);

  const migrated = { version: 1, tasks: { "TL-9301": {} } };
  assert.equal(applyIdMigrations(migrated, [record], new Set(["TL-9100"])), 1);
  assert.deepEqual(Object.keys(migrated.tasks), ["TL-9100"]);
  assert.equal(applyIdMigrations(migrated, [record], new Set(["TL-9100"])), 0, "not idempotent");
});
