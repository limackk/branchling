/**
 * Task id prefix is CONFIGURATION, not code (BL-1452).
 *
 * BL-1400 moved one project's vocabulary — statuses, labels, boards — out of
 * the code and into config.yaml under "code knows the SHAPE, config knows the
 * VALUES". The id prefix was the last value that stayed behind: the shape is
 * "prefix + number", and `BL` is a value, belonging to somebody else's project.
 *
 * THE DANGEROUS PART IS NOT THE PREFIX, IT IS THE MISMATCH. A backlog whose
 * files are `BL-*.md` under a config that says `TASK` would simply see zero
 * tasks — `build` would write empty views over real data and report success.
 * That is data loss wearing a green tick, so the mismatch has to be LOUD. Half
 * of this file exists for that one case.
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
isolateHome("id-prefix");

import { DEFAULTS } from "../config.mjs";
import {
  ANY_TASK_FILE_ID,
  DEFAULT_TASK_ID_PREFIX,
  detectPrefixMismatch,
  inferPrefix,
  taskIdPatterns,
} from "../task-id.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(args, opts) {
  const r = spawnSync(process.execPath, [CLI, ...args], Object.assign({ encoding: "utf8" }, opts || {}));
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function backlog({ prefix, ids = [], extra = "" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-prefix-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: X-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  if (prefix) writeFileSync(join(dir, "config.yaml"), `task_id_prefix: ${prefix}\n${extra}`, "utf8");
  else if (extra) writeFileSync(join(dir, "config.yaml"), extra, "utf8");
  for (const spec of ids) {
    const { id, blocked_by = [], blocks = [], status = "pending" } = typeof spec === "string" ? { id: spec } : spec;
    writeFileSync(
      join(dir, "tasks", `${id}-x.md`),
      [
        "---", `id: ${id}`, 'title: "T"', "type: task", "labels: []", "board: main",
        'epic: ""', "priority: P1", `status: ${status}`, "owner: unassigned",
        "estimate: 2h", "confidence: high", "created: 2026-08-01", "updated: 2026-08-01",
        `blocked_by: [${blocked_by.join(", ")}]`, `blocks: [${blocks.join(", ")}]`,
        "---", "", "## Cel", "", "x", "",
      ].join("\n"),
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

// ── Kontrakt konfiguracji ─────────────────────────────────────────────────

test("the default prefix is GENERIC — not `BL`", () => {
  assert.equal(DEFAULTS.task_id_prefix, DEFAULT_TASK_ID_PREFIX);
  assert.notEqual(DEFAULTS.task_id_prefix, "BL", "the default carries another project's prefix");
  assert.match(DEFAULTS.task_id_prefix, /^[A-Z][A-Z0-9]*$/);
});

test("the patterns are built FROM THE PREFIX, not concatenated at each call site", () => {
  const p = taskIdPatterns("ZZ");
  assert.ok(p.id.test("ZZ-12"));
  assert.ok(!p.id.test("BL-12"), "the pattern let a foreign prefix through");
  assert.ok(p.file.test("ZZ-12-cokolwiek.md"));
  assert.ok(!p.file.test("ZZ-abc.md"));
  assert.equal("ZZ-12-x.md".match(p.fileId)[1], "ZZ-12");
});

test("a prefix containing a regex metacharacter does not break the pattern", () => {
  // `A.B` as a prefix must not match `AxB` — the dot has to be escaped.
  const p = taskIdPatterns("A.B");
  assert.ok(p.id.test("A.B-1"));
  assert.ok(!p.id.test("AxB-1"), "the dot behaved as a metacharacter");
});

// ── A full cycle on a foreign prefix ──────────────────────────────────────

test("a backlog with the TASK prefix passes new → build → check → next-id → query", () => {
  withBacklog({ prefix: "TASK", ids: ["TASK-1", "TASK-2"] }, (dir) => {
    const build = cli(["build", "--dir", dir]);
    assert.equal(build.code, 0, build.out);
    assert.match(build.out, /2 task/, "the generator did not see the tasks: " + build.out);

    const check = cli(["check", "--dir", dir]);
    assert.equal(check.code, 0, check.out);

    const next = cli(["next-id", "--dir", dir]);
    assert.equal(next.code, 0, next.out);
    assert.match(next.out, /\b3\b/, "next-id did not count from the right pattern: " + next.out);

    const q = cli(["query", "--dir", dir, "--count"]);
    assert.equal(q.code, 0, q.out);
    assert.match(q.out, /2/);

    const made = cli(["new", "--dir", dir, "--title", "New"]);
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /TASK-3/, "the new task got a foreign prefix: " + made.out);
    assert.ok(
      readdirSync(join(dir, "tasks")).some((f) => f.startsWith("TASK-3-")),
      "the new task's file does not carry the configured prefix",
    );
  });
});

test("`init` creates a backlog that works straight away on the default prefix", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "worktrail-init-")), "bl");
  try {
    const init = cli(["init", "--dir", dir]);
    assert.equal(init.code, 0, init.out);
    const made = cli(["new", "--dir", dir, "--title", "First"]);
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, new RegExp(DEFAULT_TASK_ID_PREFIX + "-\\d"), made.out);
    assert.equal(cli(["build", "--dir", dir]).code, 0);
    assert.equal(cli(["check", "--dir", dir]).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("next-id does NOT count tasks with a foreign prefix", () => {
  // A tree with two prefixes: without this test a "max+1" over a bare `\d+` would
  // give 100, and the number 100 belongs to somebody else's namespace.
  withBacklog({ prefix: "TASK", ids: ["TASK-4", "BL-99"] }, (dir) => {
    const next = cli(["next-id", "--dir", dir]);
    assert.equal(next.code, 0, next.out);
    assert.match(next.out, /\b5\b/, "next-id counted a foreign prefix: " + next.out);
  });
});

// ── A mismatch between the configuration and the tree: THE MOST IMPORTANT PART ──

test("BL-* files under a TASK configuration FAIL instead of giving an empty view", () => {
  // This is the data-loss variant that wears a success face: `build` would write
  // empty INDEX/NOW/archive OVER REAL DATA and print a tick.
  withBacklog({ prefix: "TASK", ids: ["BL-1", "BL-2"] }, (dir) => {
    const build = cli(["build", "--dir", dir]);
    assert.notEqual(build.code, 0, "the generator passed over the mismatch: " + build.out);
    assert.match(build.out, /TASK/, "the message does not say which prefix it expected");
    assert.match(build.out, /BL/, "the message does not say what it found");
    assert.ok(
      !existsSync(join(dir, "INDEX.yaml")),
      "the generator WROTE an empty view despite the mismatch — this is that data loss",
    );
  });
});

test("the prefix is the part BEFORE the first number, even when the slug has digits", () => {
  // Found by a positive control on a real tree: a greedy pattern read the prefix of
  // `BL-1417-close-flag-validation-in-5-commands.md` as the prefix
  // `BL-1417-close-flag-validation-in` as the prefix, because there is another
  // `-5-` further along. The mismatch message then printed junk instead of a name.
  const m = detectPrefixMismatch(["BL-1417-domknij-walidacje-flag-w-5-komendach.md"], "ZZ");
  assert.equal(m.ok, false);
  assert.deepEqual(m.found, ["BL"]);
  assert.equal(inferPrefix(["BL-1417-a-w-5-b.md", "BL-2-c.md"]), "BL");

  // The same greediness sat in extracting the id from a filename and REALLY
  // created a file `history/BL-1417-close-flag-validation-in-5.jsonl` before this
  // test existed. The proof was on disk, not in a test.
  const f = "BL-1417-domknij-walidacje-flag-w-5-komendach-worktrail.md";
  assert.equal(f.match(ANY_TASK_FILE_ID)[1], "BL-1417");
});

test("an empty backlog is NOT a mismatch — having no tasks is a legal state", () => {
  // A negative control for the test above: if the guard reacted to "zero tasks",
  // a fresh `init` would be unusable.
  withBacklog({ prefix: "TASK" }, (dir) => {
    const build = cli(["build", "--dir", dir]);
    assert.equal(build.code, 0, "an empty backlog treated as a mismatch: " + build.out);
  });
});

// ── Migracja ──────────────────────────────────────────────────────────────

test("the migration renumbers the tasks, the history AND blocked_by/blocks", () => {
  withBacklog(
    { prefix: "BL", ids: [{ id: "BL-1", blocks: ["BL-2"] }, { id: "BL-2", blocked_by: ["BL-1"] }] },
    (dir) => {
      mkdirSync(join(dir, "history"));
      writeFileSync(
        join(dir, "history", "BL-1.jsonl"),
        JSON.stringify({ id: "01X", ts: "2026-08-01T00:00:00.000Z", task: "BL-1", field: "status", from: "", to: "pending", actor: "unknown", source: "external" }) + "\n",
        "utf8",
      );

      const r = cli(["migrate-prefix", "--dir", dir, "--to", "ZZ"]);
      assert.equal(r.code, 0, r.out);

      const files = readdirSync(join(dir, "tasks"));
      assert.ok(files.includes("ZZ-1-x.md"), "the task file was not renamed: " + files.join(", "));
      assert.ok(!files.some((f) => f.startsWith("BL-")), "a file with the old prefix was left behind");

      const one = readFileSync(join(dir, "tasks", "ZZ-1-x.md"), "utf8");
      assert.match(one, /^id: ZZ-1$/m, "the frontmatter `id` was not repointed");
      assert.match(one, /^blocks: \[ZZ-2\]$/m, "`blocks` was not repointed");
      const two = readFileSync(join(dir, "tasks", "ZZ-2-x.md"), "utf8");
      assert.match(two, /^blocked_by: \[ZZ-1\]$/m, "`blocked_by` was not repointed");

      assert.ok(existsSync(join(dir, "history", "ZZ-1.jsonl")), "the history log did not follow the task");
      assert.ok(!existsSync(join(dir, "history", "BL-1.jsonl")), "a log under the old name was left behind");
      const log = readFileSync(join(dir, "history", "ZZ-1.jsonl"), "utf8");
      assert.match(log, /"task":"ZZ-1"/, "the `task` field in the log was not repointed");

      assert.match(readFileSync(join(dir, "config.yaml"), "utf8"), /task_id_prefix:\s*ZZ/);

      // The most important part: after the migration the tool can see its own tasks.
      const build = cli(["build", "--dir", dir]);
      assert.equal(build.code, 0, build.out);
      assert.match(build.out, /2 task/, build.out);
      assert.equal(cli(["check", "--dir", dir]).code, 0);
    },
  );
});

test("the migration is ATOMIC in effect: a name collision stops it BEFORE writing", () => {
  // The target `ZZ-1-x.md` already exists. A half-finished migration would be worse
  // than none — it would leave a tree that neither the old nor the new prefix sees.
  withBacklog({ prefix: "BL", ids: ["BL-1"] }, (dir) => {
    writeFileSync(join(dir, "tasks", "ZZ-1-x.md"), "---\nid: ZZ-1\n---\n", "utf8");
    const r = cli(["migrate-prefix", "--dir", dir, "--to", "ZZ"]);
    assert.notEqual(r.code, 0, "the migration walked onto an existing file: " + r.out);
    assert.ok(existsSync(join(dir, "tasks", "BL-1-x.md")), "the source disappeared despite the error");
  });
});

test("`migrate-prefix --dry-run` touches NOTHING, but says what it would do", () => {
  withBacklog({ prefix: "BL", ids: ["BL-1"] }, (dir) => {
    const r = cli(["migrate-prefix", "--dir", dir, "--to", "ZZ", "--dry-run"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /BL-1.*ZZ-1/s, "the dry run did not show the plan: " + r.out);
    assert.ok(existsSync(join(dir, "tasks", "BL-1-x.md")), "the dry run touched the files");
    assert.match(readFileSync(join(dir, "config.yaml"), "utf8"), /task_id_prefix:\s*BL/);
  });
});
