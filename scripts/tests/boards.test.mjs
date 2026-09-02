/**
 * Regression net for the `board` partition of the backlog.
 *
 * The invariant under test: every task belongs to exactly ONE board taken from
 * the closed registry in `boards.yaml`, and the generated per-board views are a
 * true partition of the task set — no task lost, none counted twice.
 *
 * Why this matters more than the `epic` field it sits above: `epic` is free
 * text (144 distinct values today, spelling variants included), so nothing can
 * fail on a typo there. A board is a routing decision — an agent picks the
 * board when the user does not name one — and a typo'd slug would silently
 * create a third board nobody reads. Hence: unknown slug is an error, not a
 * warning.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BACKLOG_DIR, isolateHome, SCRIPTS_DIR as SCRIPTS, TASKS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("boards");

import { loadConfig } from "../config.mjs";
import { taskIdPatterns } from "../task-id.mjs";

// This backlog's prefix, not a literal (TL-44) — tests walking the REAL tree
// otherwise fall silent after a renumbering and say "0 tasks" instead of failing.
const REPO_PREFIX = loadConfig(BACKLOG_DIR, { strict: false }).taskIdPrefix;
const REPO_TASK_FILE = taskIdPatterns(REPO_PREFIX).file;

const BUILD = join(SCRIPTS, "build-backlog.mjs");
const SUGGEST = join(SCRIPTS, "suggest-board.mjs");

const REGISTRY = `default: main
boards:
  - slug: main
    name: "Main"
    description: "Everything that ships the product."
  - slug: backlog-project
    name: "Backlog Project"
    description: "Improvements to the backlog/ module itself."
    paths:
      - "backlog/scripts/**"
      - "backlog/README.md"
`;

/** Minimal backlog tree: tasks/ + boards.yaml, ready for `build-backlog --root`. */
function withBacklog(build) {
  const dir = mkdtempSync(join(tmpdir(), "origin-boards-"));
  try {
    mkdirSync(join(dir, "tasks"));
    writeFileSync(join(dir, "boards.yaml"), REGISTRY);
    build(dir);
    // spawnSync, not execFileSync: the generator's warnings go to stderr even on
    // exit 0, and an assertion reading stdout alone would let a missing warning through.
    const proc = spawnSync("node", [BUILD, "--root", dir], { encoding: "utf8" });
    const code = proc.status;
    const out = `${proc.stdout || ""}${proc.stderr || ""}`;
    // We read BEFORE cleaning the directory up — a `read` returning a path instead
    // of content would give "the file was not created" for every file, valid ones included.
    const cache = new Map();
    const read = (rel) => {
      if (!cache.has(rel)) {
        try {
          cache.set(rel, readFileSync(join(dir, rel), "utf8"));
        } catch {
          cache.set(rel, null);
        }
      }
      return cache.get(rel);
    };
    for (const rel of [
      "FOCUS.yaml",
      "INDEX.yaml",
      "boards/main/FOCUS.yaml",
      "boards/main/INDEX.yaml",
      "boards/backlog-project/FOCUS.yaml",
      "boards/backlog-project/INDEX.yaml",
      "NOW.yaml",
      "boards/main/NOW.yaml",
      "boards/backlog-project/NOW.yaml",
    ]) read(rel);
    return { code, out, read };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function task(dir, filename, fields = {}) {
  const f = { id: filename.match(/^(BL-\d+)/)[1], title: "T", status: "pending", priority: "P1", ...fields };
  const lines = Object.entries(f).map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : v}`);
  writeFileSync(join(dir, "tasks", filename), `---\n${lines.join("\n")}\n---\n\n## Cel\n`);
}

test("per-board views are a partition: each task lands in its own board only", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", { board: "main", status: "in_progress" });
    task(d, "BL-101-beta.md", { board: "backlog-project", status: "in_progress" });
  });
  assert.equal(r.code, 0, r.out);

  const mainNow = r.read("boards/main/NOW.yaml");
  const bpNow = r.read("boards/backlog-project/NOW.yaml");
  assert.ok(mainNow, "boards/main/NOW.yaml nie powstal");
  assert.ok(bpNow, "boards/backlog-project/NOW.yaml nie powstal");
  assert.match(mainNow, /BL-100/);
  assert.doesNotMatch(mainNow, /BL-101/);
  assert.match(bpNow, /BL-101/);
  assert.doesNotMatch(bpNow, /BL-100/);
});

test("root NOW/INDEX stay global — the boards do not narrow the default read", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", { board: "main", status: "in_progress" });
    task(d, "BL-101-beta.md", { board: "backlog-project", status: "in_progress" });
  });
  const now = r.read("NOW.yaml");
  assert.match(now, /BL-100/);
  assert.match(now, /BL-101/);
  const index = r.read("INDEX.yaml");
  assert.match(index, /by_board:/);
  assert.match(index, /backlog-project: 1/);
});

test("a task with no board field falls back to the registry default, loudly", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", { status: "in_progress" });
  });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /BL-100-alpha\.md/);
  assert.match(r.out, /board/i);
  assert.match(r.read("boards/main/NOW.yaml"), /BL-100/);
});

test("an unknown board slug fails the build instead of creating a phantom board", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", { board: "backlog_project" });
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /backlog_project/);
  assert.match(r.out, /BL-100-alpha\.md/);
});

test("suggest-board routes by the paths a task touches, not by the word 'backlog'", () => {
  const dir = mkdtempSync(join(tmpdir(), "origin-suggest-"));
  try {
    writeFileSync(join(dir, "boards.yaml"), REGISTRY);
    const t = (name, body) => {
      const p = join(dir, name);
      writeFileSync(p, body);
      return p;
    };
    // Touches the module itself → backlog-project.
    const own = t(
      "BL-200-x.md",
      `---\nid: BL-200\ntitle: "Sorting the tables"\nrelated_docs:\n  - backlog/README.md\n---\n\n1. Change \`backlog/scripts/build-viewer.mjs\`\n`,
    );
    // Merely follows the agent protocol ("regeneruj backlog") → main.
    const other = t(
      "BL-201-y.md",
      `---\nid: BL-201\ntitle: "The day-plan screen"\nrelated_docs:\n  - docs/architecture/daily-plan.md\n---\n\n1. Fix the widget, then regenerate the backlog.\n`,
    );
    const run = (file) =>
      execFileSync("node", [SUGGEST, file, "--registry", join(dir, "boards.yaml")], { encoding: "utf8" });
    assert.match(run(own), /^backlog-project\b/m);
    assert.match(run(other), /^main\b/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the real backlog tree: every task carries a board from the registry", () => {
  const registry = readFileSync(join(BACKLOG_DIR, "boards.yaml"), "utf8");
  const slugs = new Set([...registry.matchAll(/^\s*-\s*slug:\s*(\S+)/gm)].map((m) => m[1]));
  // It used to be: "at least 2 boards". That was a property of the REGISTRY of the
  // repository this module was extracted from, not of the tool — a project with one
  // board is valid. What stays is the condition without which the rest of the test
  // would be empty: the registry has to PARSE into something (BL-1448).
  assert.ok(slugs.size >= 1, "boards.yaml did not parse into a single slug");

  const tasksDir = TASKS_DIR;
  const seen = [];
  const bad = [];
  for (const f of readdirSync(tasksDir).filter((n) => REPO_TASK_FILE.test(n))) {
    seen.push(f);
    const m = readFileSync(join(tasksDir, f), "utf8").match(/^board:\s*(.+?)\s*$/m);
    const slug = m ? m[1].replace(/^["']|["']$/g, "") : null;
    if (!slug || !slugs.has(slug)) bad.push(`${f}: ${slug ?? "no board field"}`);
  }
  assert.deepEqual(bad, [], `tasks with no valid board:\n${bad.slice(0, 10).join("\n")}`);
  // A positive control: an empty tasks directory would pass the above without a
  // single check. A green "zero bad ones" has to mean "I checked and it was fine".
  assert.ok(seen.length > 0, "I read NOT ONE task — a test with no evidential force");
});

// ─── Viewer ───────────────────────────────────────────────────────────────
// A board in the viewer has to be a SCOPE, not another filter beside Epic. The
// difference is measurable: a filter narrows the list of cards, but the dashboard
// counts from the full set, so throughput and queue would show the sum of the
// boards under the heading of one. So we test the contract that follows from it:
// the data carry the board, the HTML injects the registry and narrows the SOURCE
// (ALL_TASKS → TASKS), not just the view.
import { computeStats, buildHtml, readTasks } from "../build-viewer.mjs";

test("viewer: computeStats counts by_board", () => {
  const stats = computeStats([
    { id: "BL-1", board: "main", labels: [], status: "pending", priority: "P1", type: "code", epic: "" },
    { id: "BL-2", board: "backlog-project", labels: [], status: "done", priority: "P2", type: "code", epic: "" },
    { id: "BL-3", board: "main", labels: [], status: "pending", priority: "P1", type: "code", epic: "" },
  ]);
  assert.deepEqual(stats.by_board, { main: 2, "backlog-project": 1 });
});

test("viewer: readTasks carries the board through from the frontmatter", () => {
  const tasks = readTasks();
  assert.ok(tasks.length > 0);
  assert.ok(tasks.every((t) => typeof t.board === "string" && t.board.length > 0),
    "every task in the tree should have a board");
  // It used to be: `some(t => t.board === "backlog-project")` — a slug existing in
  // one particular project's registry. The tool's contract is that the board COMES
  // THROUGH from the frontmatter, not that it has some particular value (BL-1448).
  // Any task from the tree, found by the SHAPE of its name — a name written out
  // pinned the number and the prefix at once (TL-44).
  const someFile = readdirSync(TASKS_DIR).filter((n) => REPO_TASK_FILE.test(n)).sort()[0];
  assert.ok(someFile, "no tasks in the tree — a test with no evidential force");
  const fromFile = readFileSync(join(TASKS_DIR, someFile), "utf8")
    .match(/^board:\s*(.+?)\s*$/m)[1];
  const loaded = tasks.find((t) => t.id === someFile.match(taskIdPatterns(REPO_PREFIX).fileId)[1]);
  assert.equal(loaded && loaded.board, fromFile,
    "the board from the file did not reach readTasks — that is the path, not the mere presence of the field");
});

test("viewer: the HTML injects the board registry and narrows the SOURCE, not just the view", () => {
  const tasks = [
    { id: "BL-1", title: "A", board: "main", labels: [], blocked_by: [], blocks: [], related_docs: [], epic: "", status: "pending", priority: "P1", type: "code", bodyHtml: "" },
  ];
  const html = buildHtml(tasks, computeStats(tasks));
  assert.match(html, /BOARDS\s*=/, "the board registry did not reach the HTML");
  // It used to be: the literal "backlog-project". The registry is project DATA, so
  // the test asks for THIS repository's slugs instead of knowing them from memory (BL-1448).
  const slugs = [...readFileSync(join(BACKLOG_DIR, "boards.yaml"), "utf8")
    .matchAll(/^\s*-\s*slug:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(slugs.length > 0, "the registry did not parse — there is nothing to look for in the HTML");
  for (const slug of slugs) {
    assert.ok(html.includes(slug), `the board slug "${slug}" did not reach the HTML`);
  }
  assert.match(html, /ALL_TASKS/, "no separation of the full set from the scoped view");
  assert.match(html, /boardScope|scopeBoard/, "no scope control in the header");
});

// ─── Guard pre-commit ─────────────────────────────────────────────────────
// Why a SEPARATE guard, when build-backlog.mjs already fails on an unknown slug:
// the generator runs when somebody calls it. A commit with a broken `board:` can be
// made without running it once — and then the views are broken for the next person
// who does run it. The same class the id identity guard closed: a detector nothing
// can fail is a warning, not a protection.
//
// The scope differs from the id guard's, and that is deliberate: an id collision is
// a property of the SET (it has to see the whole tree), while a board is a property
// of a SINGLE file. So the hook checks the staged files — somebody else's
// uncommitted task in the same tree has no right to fail my commit.
const BOARD_GUARD = join(SCRIPTS, "check-backlog-boards.mjs");

function runGuard(args, cwd) {
  const r = spawnSync("node", [BOARD_GUARD, ...args], { encoding: "utf8", cwd });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  // A missing script also exits 1 — an assertion on the code alone would then pass
  // with zero evidential force. A precedent from the same session: the "duplicate
  // slug" case was green before the guard existed at all.
  assert.doesNotMatch(out, /Cannot find module|MODULE_NOT_FOUND/, "guard nie istnieje:\n" + out);
  return { code: r.status, out };
}

/** A tree with a registry plus tasks; returns the directory for the caller to clean up. */
function boardTree(files, registry = REGISTRY) {
  const dir = mkdtempSync(join(tmpdir(), "origin-board-guard-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "boards.yaml"), registry);
  for (const [name, fm] of Object.entries(files)) {
    writeFileSync(join(dir, "tasks", name), `---\n${fm}\n---\n\n## Cel\n`);
  }
  return dir;
}

test("guard: a staged task with no board field fails and is named", () => {
  const dir = boardTree({ "BL-100-a.md": 'id: BL-100\ntitle: "T"\nstatus: pending' });
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), join(dir, "tasks", "BL-100-a.md")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /BL-100-a\.md/);
    assert.match(r.out, /board/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: a staged task with a slug outside the registry fails and shows the allowed ones", () => {
  const dir = boardTree({ "BL-100-a.md": 'id: BL-100\ntitle: "T"\nboard: backlog_project\nstatus: pending' });
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), join(dir, "tasks", "BL-100-a.md")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /backlog_project/);
    assert.match(r.out, /backlog-project/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: a valid staged task passes, and somebody else's broken file beside it does not fail it", () => {
  const dir = boardTree({
    "BL-100-a.md": 'id: BL-100\ntitle: "T"\nboard: main\nstatus: pending',
    "BL-101-foreign.md": 'id: BL-101\ntitle: "WIP of another session"\nstatus: pending',
  });
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), join(dir, "tasks", "BL-100-a.md")]);
    assert.equal(r.code, 0, r.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: a change to the registry forces the WHOLE tree to be checked — an orphaned task fails", () => {
  // A board removed from boards.yaml leaves tasks pointing at a slug that no longer
  // exists. None of them is in that commit, so a check over the staged files alone
  // would wave through the change that breaks eight other tasks.
  const dir = boardTree({
    "BL-100-a.md": 'id: BL-100\ntitle: "T"\nboard: backlog-project\nstatus: pending',
  }, 'default: main\nboards:\n  - slug: main\n    name: "Main"\n');
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), "--all", join(dir, "tasks")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /BL-100-a\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: a duplicate slug in the registry fails", () => {
  const dir = boardTree({}, 'default: main\nboards:\n  - slug: main\n    name: "A"\n  - slug: main\n    name: "B"\n');
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), "--all", join(dir, "tasks")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /duplicate/i);
    assert.match(r.out, /main/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: a `default` pointing at a non-existent board fails", () => {
  const dir = boardTree({}, 'default: produkt\nboards:\n  - slug: main\n    name: "Main"\n');
  try {
    const r = runGuard(["--registry", join(dir, "boards.yaml"), "--all", join(dir, "tasks")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /default/i);
    assert.match(r.out, /produkt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guard: the real tree passes", () => {
  const r = runGuard(["--all", TASKS_DIR]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /✓/);
});

// REMOVED (BL-1448): "guard: it is declared in the pre-commit manifest".
//
// The test read the `.githooks/pre-commit` of the REPOSITORY this module was
// extracted from and checked that the guard stood in its GUARD_MANIFEST. It is not
// merely unportable — it is PERMANENTLY out of date: that manifest's contract is
// "the guard is a TRACKED file in this repo", and an installed dependency cannot
// satisfy it, so the consumer deliberately removed both guards from the manifest
// (BL-1446). There is nothing left to enforce — neither here nor there.
//
// What we therefore do NOT have: the sentence "somebody calls this guard". That is
// a property of the CONSUMER and only they can enforce it; the tool can at most
// fail when it is missing — which is what the shim on that side does.

// ─── INDEX: an index, not a mirror ────────────────────────────────────────
// INDEX.yaml used to mirror the WHOLE frontmatter: on a real backlog that measured
// 149 KB. All those fields already stand in the task file, which is the single
// source of truth — the index is there to let you CHOOSE a task, not to describe it.
//
// The contract: one line per task, only the fields work is chosen by. `epic` does
// NOT belong on the row, because it stands in the group header — paying for it once
// per task was pure redundancy. Nor does `blocks`: it is the inverse of `blocked_by`
// and can be derived from the same file.
test("INDEX: one task is one line, with the fields work is chosen by", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", {
      board: "main", epic: "Sound Player", priority: "P0", status: "blocked",
      type: "code", owner: "claude", estimate: "2h", confidence: "high",
      created: "2026-08-01", updated: "2026-08-29",
    });
  });
  assert.equal(r.code, 0, r.out);
  const index = r.read("INDEX.yaml");
  const row = index.split("\n").find((l) => l.includes("BL-100"));
  assert.ok(row, "I did not find the task row:\n" + index);

  // Everything work is chosen by — on one line.
  for (const needle of ["id: BL-100", "priority: P0", "status: blocked", "board: main"]) {
    assert.ok(row.includes(needle), `the row does not carry \`${needle}\`: ${row}`);
  }
  // The rest of the frontmatter is NOT — that is what the task file is for.
  for (const gone of ["owner:", "estimate:", "confidence:", "created:", "updated:", "type:"]) {
    assert.ok(!row.includes(gone), `the row still mirrors \`${gone}\`: ${row}`);
  }
  // The epic only in the group header, not on every row.
  assert.match(index, /# ─── EPIC: Sound Player/);
  assert.ok(!row.includes("epic:"), "epic repeated on the row: " + row);
});

test("INDEX: a row is valid YAML (the index has to stay machine-readable)", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-alpha.md", { board: "main", priority: "P1", status: "pending",
      title: 'A title with a colon: and "quotes"' });
  });
  const row = r.read("INDEX.yaml").split("\n").find((l) => l.includes("BL-100")).trim();
  assert.match(row, /^- \{.*\}$/, "the row is not a flow mapping: " + row);
  // Full keys, not abbreviations — the index has to be readable with no legend.
  assert.match(row, /\bpriority:/);
  assert.match(row, /\bstatus:/);
  // A quotation mark in the title must not break the row.
  assert.ok(row.endsWith("}"), "the row was cut short by quoting: " + row);
});

test("INDEX: blocked_by stays (it drives the order), blocks goes (it is the inverse)", () => {
  // The fixture is written out explicitly: both lists MUST be in the source,
  // otherwise a test about their presence/absence passes with no evidential force.
  const r = withBacklog((d) => {
    writeFileSync(
      join(d, "tasks", "BL-100-alpha.md"),
      '---\nid: BL-100\ntitle: "A"\nboard: main\npriority: P1\nstatus: blocked\n' +
        "blocked_by: [BL-101]\nblocks: [BL-102]\n---\n\n## Cel\n",
    );
  });
  const index = r.read("INDEX.yaml");
  assert.match(index, /blocked_by: \[BL-101\]/, "blocked_by disappeared — and it drives the order of work");
  assert.ok(!/\bblocks: \[/.test(index), "the INDEX still carries `blocks:` (a duplicate of other tasks' blocked_by)");
});

/**
 * The views have been generated and NOT versioned since BL-1404, so a fresh clone
 * and a new worktree do not have them. The ratchets below measure the REAL tree, so
 * they have to build it first — a silent skip on a missing file would look like
 * zerowej mocy dowodowej.
 */
function ensureRealViews() {
  const build = join(SCRIPTS, "build-backlog.mjs");
  const r = spawnSync(process.execPath, [build, "--dir", BACKLOG_DIR], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("build-backlog.mjs did not pass: " + (r.stderr || r.stdout));
}

test("INDEX: the real tree fits the cost PER ROW (a ratchet on the read cost)", () => {
  // It used to be an absolute threshold of 75,000 B, computed from that project's
  // 337 tasks. Carried over here it was GREEN WITH ZERO EVIDENTIAL FORCE — a small
  // backlog will not approach it even if every row mirrored the whole frontmatter.
  //
  // So we measure the invariant that actually matters: what ONE row costs. The
  // defect this ratchet was created for was 149 KB / 337 ≈ 442 B per task (the whole
  // frontmatter mirrored). Today it is ~155-170 B, independently of the size of the
  // repository. A threshold of 250 B catches a return to mirroring with room to
  // spare and does not measure how many tasks anybody has (BL-1448).
  //
  // The header is counted separately, because it is constant: spread over 14 rows it
  // raises the average by ~90 B, over 353 by ~4 B. Counted into the average it would
  // be measuring the size of the repository, not the shape of the index.
  ensureRealViews();
  const text = readFileSync(join(BACKLOG_DIR, "INDEX.yaml"), "utf8");
  const rows = text.split("\n").filter((l) => new RegExp("^\\s*- \\{id: " + REPO_PREFIX + "-").test(l));
  assert.ok(rows.length > 0, "I found NOT ONE index row — a ratchet with no sample");

  const perRow = rows.reduce((n, l) => n + l.length + 1, 0) / rows.length;
  assert.ok(
    perRow < 250,
    `INDEX.yaml costs ${Math.round(perRow)} B per row (threshold 250, ${rows.length} rows) — ` +
      "the index is describing again instead of pointing"
  );
});

// ─── NOW.yaml — "what now" computed, not declared ─────────────────────────
// It replaces a `focus` field and a FOCUS.yaml. The reason is measurable, not
// aesthetic: at 55 entries the flag had stopped discriminating (10 untouched for
// months, 11 on tasks already `done`, and 93 active P0/P1 sitting OUTSIDE it), so
// the file was answering "what did somebody declare once", not "what are we doing
// now". A value derived from status and priority cannot rot, because there is
// nothing to fail to clear.
test("NOW: the sections follow from status and priority, not from a declaration", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-in-progress.md", { board: "main", status: "in_progress", priority: "P2" });
    task(d, "BL-101-blocked.md", { board: "main", status: "blocked", priority: "P1" });
    task(d, "BL-102-krytyczny.md", { board: "main", status: "pending", priority: "P0" });
    task(d, "BL-103-zwykly.md", { board: "main", status: "pending", priority: "P2" });
    task(d, "BL-104-zrobiony.md", { board: "main", status: "done", priority: "P0" });
  });
  assert.equal(r.code, 0, r.out);
  const now = r.read("NOW.yaml");
  assert.ok(now, "NOW.yaml was not created");

  const section = (name) => {
    const m = now.match(new RegExp(`^${name}:\\n([\\s\\S]*?)(?=^\\w|$)`, "m"));
    return m ? m[1] : "";
  };
  assert.match(section("in_progress"), /BL-100/);
  assert.match(section("blocked"), /BL-101/);
  assert.match(section("next"), /BL-102/);
  // An ordinary pending and a closed task are not "now" — otherwise NOW is a second INDEX.
  assert.ok(!now.includes("BL-103"), "a pending P2 entered NOW");
  assert.ok(!now.includes("BL-104"), "a done task entered NOW");
});

test("NOW: the `focus` field has gone from the schema and from every view", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "in_progress", priority: "P1" });
  });
  assert.ok(!r.read("INDEX.yaml").includes("focus"), "INDEX still carries focus");
  assert.ok(!r.read("NOW.yaml").includes("focus:"), "NOW carries a focus field");
  assert.equal(r.read("FOCUS.yaml"), null, "FOCUS.yaml is still generated — two sources of \"what now\"");
});

test("NOW: too much parallel work is NAMED, not cut off by a cap", () => {
  // A cap would hide the truth ("12 things started" is a fact, not a defect of the
  // view). The header is there to say it — the one thing the file can do with a WIP
  // leak that it must not mask.
  const r = withBacklog((d) => {
    for (let i = 0; i < 12; i++) {
      task(d, `BL-2${String(i).padStart(2, "0")}-x.md`, { board: "main", status: "in_progress", priority: "P2" });
    }
  });
  const now = r.read("NOW.yaml");
  assert.match(now, /12/);
  assert.match(now, /in parallel|at once|WIP/i, "the header says nothing about 12 parallel jobs");
  assert.equal((now.match(/id: BL-2/g) || []).length, 12, "the rows were cut off by a cap");
});

test("NOW: it is created per board too", () => {
  const r = withBacklog((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "in_progress", priority: "P1" });
    task(d, "BL-101-b.md", { board: "backlog-project", status: "in_progress", priority: "P1" });
  });
  assert.match(r.read("boards/main/NOW.yaml"), /BL-100/);
  assert.ok(!r.read("boards/main/NOW.yaml").includes("BL-101"));
  assert.match(r.read("boards/backlog-project/NOW.yaml"), /BL-101/);
});

test("NOW: the real tree — the file exists, FOCUS.yaml no longer does", () => {
  ensureRealViews();
  const now = readFileSync(join(BACKLOG_DIR, "NOW.yaml"), "utf8");
  assert.match(now, /^in_progress:/m);
  assert.ok(!existsSync(join(BACKLOG_DIR, "FOCUS.yaml")), "FOCUS.yaml is still in the repo");
  const tasksDir = TASKS_DIR;
  const stale = readdirSync(tasksDir)
    .filter((f) => /^BL-\d+.*\.md$/.test(f))
    .filter((f) => /^focus:/m.test(readFileSync(join(tasksDir, f), "utf8")));
  assert.deepEqual(stale.slice(0, 5), [], `${stale.length} tasks still have a focus field`);
});

// ─── query.mjs — a question instead of reading a file ─────────────────────
// The third step after slimming the INDEX (BL-1385) and NOW.yaml (BL-1386): the
// read cost replaced by a cost matched to the question. "What is blocked in
// Legal compliance" now costs a couple of hundred tokens instead of thousands.
//
// It reads tasks/*.md, NOT the generated INDEX — otherwise it would answer about the
// state before the last rebuild and would falsely confirm that a change did nothing.
const QUERY = join(SCRIPTS, "query.mjs");

function runQuery(args, dir) {
  const r = spawnSync("node", [QUERY, "--tasks", join(dir, "tasks"), ...args], { encoding: "utf8" });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  assert.doesNotMatch(out, /Cannot find module|MODULE_NOT_FOUND/, "query.mjs nie istnieje:\n" + out);
  return { code: r.status, out };
}

function queryTree(build) {
  const dir = mkdtempSync(join(tmpdir(), "origin-query-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "boards.yaml"), REGISTRY);
  build(dir);
  return dir;
}

test("query: filters by status, priority and board (AND between axes)", () => {
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "blocked", priority: "P0" });
    task(d, "BL-101-b.md", { board: "main", status: "pending", priority: "P0" });
    task(d, "BL-102-c.md", { board: "backlog-project", status: "blocked", priority: "P0" });
  });
  try {
    const r = runQuery(["--status", "blocked", "--board", "main"], dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /BL-100/);
    assert.ok(!r.out.includes("BL-101"), "a different status got in");
    assert.ok(!r.out.includes("BL-102"), "a different board got in");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: active only by default; closed ones have to be named explicitly", () => {
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "done", priority: "P1" });
    task(d, "BL-101-b.md", { board: "main", status: "pending", priority: "P1" });
  });
  try {
    assert.ok(!runQuery([], dir).out.includes("BL-100"), "a done task got into the default answer");
    assert.match(runQuery(["--status", "done"], dir).out, /BL-100/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: --limit SAYS how much it cut (a silent cap reads as the complete set)", () => {
  const dir = queryTree((d) => {
    for (let i = 0; i < 5; i++) task(d, `BL-2${i}0-x.md`, { board: "main", status: "pending", priority: "P1" });
  });
  try {
    const r = runQuery(["--limit", "2"], dir);
    assert.equal((r.out.match(/id: BL-/g) || []).length, 2);
    assert.match(r.out, /5/, "it did not say how many the query concerned");
    assert.match(r.out, /limit|showing/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: --files gives paths ready for xargs, --count just the number", () => {
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "pending", priority: "P1" });
  });
  try {
    assert.match(runQuery(["--files"], dir).out.trim(), /tasks\/BL-100-a\.md$/);
    assert.equal(runQuery(["--count"], dir).out.trim(), "1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: a typo in a flag FAILS instead of returning zero results", () => {
  // Zero results caused by a typo are indistinguishable from "there is no such
  // thing" — and they read like an answer. It is the same class as a measurement
  // with no positive control, which is why an unknown flag exits 2.
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "pending", priority: "P1" });
  });
  try {
    const r = runQuery(["--prioryty", "P0"], dir);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /--prioryty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: --json is machine-readable and carries the full selection fields", () => {
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "pending", priority: "P0", epic: "Sound Player" });
  });
  try {
    const parsed = JSON.parse(runQuery(["--json"], dir).out);
    assert.equal(parsed.kind, "task-list", "the answer is not in the shared envelope (TL-72)");
    assert.equal(parsed.tasks.length, 1);
    assert.equal(parsed.tasks[0].id, "BL-100");
    assert.equal(parsed.tasks[0].board, "main");
    assert.equal(parsed.tasks[0].epic, "Sound Player");
    assert.match(parsed.tasks[0].file, /tasks\/BL-100-a\.md$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("query: it reads the tasks, not the generated INDEX — a fresh change is visible", () => {
  const dir = queryTree((d) => {
    task(d, "BL-100-a.md", { board: "main", status: "pending", priority: "P1" });
  });
  try {
    // A change in the task file WITHOUT rebuilding the views.
    writeFileSync(
      join(dir, "tasks", "BL-100-a.md"),
      '---\nid: BL-100\ntitle: "T"\nboard: main\npriority: P1\nstatus: in_progress\n---\n\n## Cel\n',
    );
    assert.match(runQuery(["--status", "in_progress"], dir).out, /BL-100/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
