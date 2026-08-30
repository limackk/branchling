/**
 * A comment beside a field is a comment, in EVERY reader (TL-70).
 *
 * The defect that produced this file: `_template.md` annotates eight fields
 * with a trailing `# …`, and `epic: ""` is the one whose default value is a
 * quoted empty string. Six readers of a frontmatter line existed; one stripped
 * the comment and five stripped only the quotes, so a task straight out of
 * `worktrail new` reported
 *
 *     epic: "\"                           # free text — the group this task …"
 *
 * in `query`, in `--json`, in INDEX.yaml and in the viewer. Visible in the
 * first minute of using the tool, before the user had done anything.
 *
 * WHY THE SAMPLE IS THE TEMPLATE'S OWN COMMENTS and not an invented `a: b # c`:
 * the bug was never about whether a parser CAN strip a comment. It was about
 * which readers were asked to. So the fixture is the line the tool writes for
 * itself, and every reader is asked about the same one.
 *
 * WHY THERE IS A POSITIVE CONTROL: `stripComment()` has been correct since
 * BL-1396, so an assertion on it alone would have been green throughout the
 * defect. `PRE_FIX_READ` is the expression the five broken readers actually
 * used; the control proves this fixture would have caught them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractMeta, stripComment, unquote } from "../task-fields.mjs";
import { parseBoardsYaml } from "../config.mjs";
import { auditRefs } from "../check-backlog-refs.mjs";
import { SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** The template's annotations, verbatim in shape: value, whitespace, comment. */
const COMMENTED = [
  "id: BL-100                         # prefix from `task_id_prefix` in config.yaml",
  'title: "Read the frontmatter"      # imperative, short',
  "type: task",
  "labels: [pre-launch]               # a free vocabulary",
  "board: main                        # a CLOSED vocabulary (boards.yaml)",
  'epic: ""                           # free text — the group this task counts towards',
  "priority: P1",
  "status: pending",
  "owner: unassigned",
  "estimate: 2h",
  "confidence: medium                 # how much you trust the estimate",
  "created: 2026-09-01",
  "updated: 2026-09-01                # set to today on every status change",
  "blocked_by: []                     # ids of tasks that MUST be closed first",
  "blocks: [BL-101]                   # ids this task will unblock",
].join("\n");

/** What the five broken readers did: quotes off, comment left on. */
const PRE_FIX_READ = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return m ? m[1].replace(/^["']|["']$/g, "") : null;
};

// ── The shared parser ─────────────────────────────────────────────────────

test("a comment after the value is dropped; a # INSIDE the quotes is not", () => {
  assert.equal(unquote(stripComment('"x" # c')), "x");
  assert.equal(unquote(stripComment('"x # c"')), "x # c");
  assert.equal(unquote(stripComment("x # c")), "x");
  assert.equal(unquote(stripComment("x#c")), "x#c", "a # with no space before it is part of the value");
  assert.equal(stripComment("# the whole line"), "", "a full-line comment is a comment too");
});

test("positive control: the pre-fix expression fails on this very fixture", () => {
  // If this ever passes, the fixture has stopped exercising the defect and
  // every assertion below is green without evidentiary power.
  assert.notEqual(PRE_FIX_READ(COMMENTED, "epic"), "", "the fixture no longer reproduces TL-70");
  assert.match(PRE_FIX_READ(COMMENTED, "epic"), /free text/);
  assert.match(PRE_FIX_READ(COMMENTED, "board"), /CLOSED vocabulary/);
  assert.match(PRE_FIX_READ(COMMENTED, "id"), /task_id_prefix/);
});

test("extractMeta reads the value, not the annotation next to it", () => {
  const m = extractMeta(COMMENTED);
  assert.equal(m.id, "BL-100");
  assert.equal(m.title, "Read the frontmatter");
  assert.equal(m.board, "main");
  assert.equal(m.epic, "");
  assert.equal(m.confidence, "medium");
  assert.equal(m.updated, "2026-09-01");
  assert.deepEqual(m.labels, ["pre-launch"]);
  assert.deepEqual(m.blocked_by, []);
  assert.deepEqual(m.blocks, ["BL-101"]);
});

test("a comment on a block-list item is a comment", () => {
  const m = extractMeta("related_docs:\n  - docs/a.md   # why this one\n  - docs/b.md\n");
  assert.deepEqual(m.related_docs, ["docs/a.md", "docs/b.md"]);
});

test("parseBoardsYaml: a comment does not enter a slug, a name or a path", () => {
  const parsed = parseBoardsYaml(
    [
      "default: main        # the fallback board",
      "ignore_paths:",
      "  - node_modules/    # never routed",
      "boards:",
      "  - slug: main       # the default",
      '    name: "Main"     # shown in the viewer',
      "    paths:",
      "      - scripts/     # the tool's code",
    ].join("\n"),
  );
  assert.equal(parsed.default, "main");
  assert.deepEqual(parsed.ignorePaths, ["node_modules/"]);
  assert.equal(parsed.boards.length, 1);
  assert.equal(parsed.boards[0].slug, "main");
  assert.equal(parsed.boards[0].name, "Main");
  assert.deepEqual(parsed.boards[0].paths, ["scripts/"]);
});

// ── The guards ────────────────────────────────────────────────────────────

test("the refs guard SEES a blocked_by that has a comment beside it", () => {
  // The worst shape of this defect: the guard's pattern was anchored after the
  // `]`, so a commented `blocked_by:` did not read as a wrong value — it read
  // as NO FIELD. A dangling reference beside a comment was reported as clean.
  const files = { "BL-100-x.md": "---\n" + COMMENTED + "\n---\n\nbody\n" };
  const result = auditRefs(
    "/tasks",
    "BL",
    (p) => files[p.split("/").pop()],
    () => Object.keys(files),
  );
  const dangling = JSON.stringify(result);
  assert.match(dangling, /BL-101/, "the guard did not even look at `blocks:` beside a comment: " + dangling);
});

// ── End to end: a fresh backlog, as a stranger meets it ───────────────────

function freshBacklog(fn) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-comments-"));
  try {
    const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir], { encoding: "utf8" });
    assert.equal(init.status, 0, "init failed: " + init.stdout + init.stderr);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("init → new → query: the first task of a fresh backlog has an EMPTY epic", () => {
  freshBacklog((dir) => {
    const made = spawnSync(process.execPath, [CLI, "new", "--dir", dir, "--title", "Check the parser"], { encoding: "utf8" });
    assert.equal(made.status, 0, "new failed: " + made.stdout + made.stderr);

    // The template really does annotate that line — otherwise this test is
    // measuring a backlog where the defect could not occur.
    const template = readFileSync(join(dir, "_template.md"), "utf8");
    assert.match(template, /^epic: ""\s+#/m, "the template no longer comments `epic:` — this test proves nothing");

    const q = spawnSync(process.execPath, [CLI, "query", "--dir", dir, "--json"], { encoding: "utf8" });
    assert.equal(q.status, 0, "query failed: " + q.stdout + q.stderr);
    for (const t of JSON.parse(q.stdout).tasks) {
      assert.equal(t.epic, "", `epic carries the comment for ${t.id}`);
      assert.equal(t.board, "main", `board carries the comment for ${t.id}`);
    }
  });
});

test("build: the comment does not travel into INDEX.yaml either", () => {
  freshBacklog((dir) => {
    const built = spawnSync(process.execPath, [CLI, "build", "--dir", dir], { encoding: "utf8" });
    assert.equal(built.status, 0, "build failed: " + built.stdout + built.stderr);
    const index = readFileSync(join(dir, "INDEX.yaml"), "utf8");
    assert.doesNotMatch(index, /free text — the group/, "INDEX.yaml carries the template's comment as data");
    assert.doesNotMatch(index, /CLOSED vocabulary/, "INDEX.yaml carries the template's comment as data");
  });
});

function commentedTask(dir, name, { id, board = "main" }) {
  const fm = COMMENTED
    .replace(/^id: BL-100/m, `id: ${id}`)
    .replace(/^board: main/m, `board: ${board}`)
    .replace(/^blocks:.*$/m, "blocks: []");
  writeFileSync(join(dir, "tasks", name), "---\n" + fm + "\n---\n\n## Goal\n\nx\n", "utf8");
}

function check(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, "check", "--dir", dir, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("the board guard reads the SLUG, not the slug glued to its comment", () => {
  freshBacklog((dir) => {
    commentedTask(dir, "TASK-100-a.md", { id: "TASK-100" });
    const ok = check(dir, ["--boards"]);
    assert.equal(ok.code, 0, "a board annotated the way the template annotates was rejected:\n" + ok.out);

    // The control: a board that really is unknown must still fail, and the
    // message must name the SLUG. Pre-fix this failed too — but naming
    // `nosuch                     # a CLOSED vocabulary (boards.yaml)`, which
    // is the tool blaming the user for its own parser.
    commentedTask(dir, "TASK-101-b.md", { id: "TASK-101", board: "nosuch" });
    const bad = check(dir, ["--boards"]);
    assert.notEqual(bad.code, 0, "an unknown board went through:\n" + bad.out);
    assert.match(bad.out, /nosuch/);
    assert.doesNotMatch(bad.out, /CLOSED vocabulary/, "the guard reported the comment as the board:\n" + bad.out);
  });
});

test("the id-collision guard SEES an id shared by an annotated and a bare task", () => {
  // The fixture is deliberately ASYMMETRIC. Two files that both carry the same
  // comment collide even on the pre-fix code, because both ids were mangled the
  // same way — a symmetric fixture is green without evidentiary power. One file
  // annotated and one bare is the real shape: a task written by hand from the
  // template beside one whose `id:` line a tool has rewritten.
  freshBacklog((dir) => {
    commentedTask(dir, "TASK-100-a.md", { id: "TASK-100" });
    writeFileSync(
      join(dir, "tasks", "TASK-100-b.md"),
      "---\n" + COMMENTED.replace(/^id: BL-100.*$/m, "id: TASK-100").replace(/^blocks:.*$/m, "blocks: []") + "\n---\n\n## Goal\n\nx\n",
      "utf8",
    );
    const r = check(dir, ["--id-collisions"]);
    assert.notEqual(r.code, 0, "a duplicated id went through because one of the two carried a comment:\n" + r.out);
    assert.match(r.out, /TASK-100/);
    assert.doesNotMatch(r.out, /task_id_prefix/, "the guard reported the comment as part of the id:\n" + r.out);
  });
});

test("migrate-prefix renumbers an id and its references even beside a comment", () => {
  // The quietest form of this defect. Pre-fix, `id:` missed in the map and
  // `blocked_by:` did not match at all, so a migration renamed the FILE and
  // left the frontmatter on the old prefix — a backlog that no longer refers
  // to itself, reported as a success.
  freshBacklog((dir) => {
    writeFileSync(
      join(dir, "tasks", "TASK-100-a.md"),
      [
        "---",
        "id: TASK-100                       # prefix from `task_id_prefix` in config.yaml",
        'title: "A"',
        "type: task",
        "labels: []",
        "board: main",
        'epic: ""',
        "priority: P1",
        "status: pending",
        "owner: unassigned",
        "estimate: 2h",
        "confidence: high",
        "created: 2026-09-01",
        "updated: 2026-09-01",
        "blocked_by: [TASK-1]               # ids of tasks that MUST be closed first",
        "blocks: []",
        "---",
        "",
        "## Goal",
        "",
        "x",
        "",
      ].join("\n"),
      "utf8",
    );
    const r = spawnSync(process.execPath, [CLI, "migrate-prefix", "--dir", dir, "--to", "NEW"], { encoding: "utf8" });
    assert.equal(r.status, 0, "migrate-prefix failed: " + r.stdout + r.stderr);

    const moved = readFileSync(join(dir, "tasks", "NEW-100-a.md"), "utf8");
    assert.match(moved, /^id: NEW-100\b/m, "the file was renamed but its id was not:\n" + moved);
    assert.match(moved, /^blocked_by: \[NEW-1\]/m, "a commented blocked_by kept the old prefix:\n" + moved);
    assert.match(moved, /task_id_prefix/, "the migration ate the comment it was supposed to leave alone");
    assert.match(moved, /MUST be closed first/, "the migration ate the comment it was supposed to leave alone");
  });
});
