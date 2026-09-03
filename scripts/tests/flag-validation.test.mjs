/**
 * Validating unknown flags in five commands (BL-1417).
 *
 * BL-1411 fixed exactly one symptom of one class of defect: the server ignored
 * unknown flags and quietly opened a browser tab. That class lived on in five
 * scripts which the dispatcher merely WRAPS:
 * `next-backlog-id.mjs`, `suggest-board.mjs`, `build-backlog.mjs`,
 * `build-viewer.mjs`, `history-record.mjs`.
 *
 * The most dangerous is `history-record.mjs`: an unknown flag fell into
 * `arg("--file", "")`, did not land, so the script took the "whole directory" path
 * and performed a REAL reconciliation — appending history entries to disk.
 * `branchling history --help` genuinely did that in a real session. Hence a test for
 * ZERO side effect, not only for the exit code.
 *
 * `build-viewer.mjs` has the opposite trap: it is imported as a module by
 * `serve-backlog.mjs` and by the tests (`readTasks()`, `buildHtml()` called WITH
 * NO arguments, on the default `defaultRoot()`). The argv validation CANNOT sit
 * there — otherwise `node --test ...` would kill itself with its own argv (the
 * runner's flags, not the backlog's). The validation goes ONLY into the
 * `invokedDirectly` branch, that is, in a real CLI, never on import.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("flag-validation");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");

function run(script, args, opts) {
  return spawnSync(process.execPath, [join(SCRIPTS, script)].concat(args), {
    encoding: "utf8", timeout: 30_000, ...opts,
  });
}

function freshBacklog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-flags-"));
  const r = run("init-backlog.mjs", ["--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

/**
 * `next-backlog-id.mjs` scans BRANCHES — without a git repository there is
 * nothing to scan and the script correctly ends with "not a single task file
 * found", regardless of flag validation. The tests for this one command need
 * PRAWDZIWEGO repo.
 *
 * The backlog lies in a SUBDIRECTORY of the repository (`repo/backlog/`), not at
 * its root. A backlog AT THE ROOT of a repo (a relative path that is an empty
 * empty) is a separate case, found while writing this test: `BACKLOG_REL`
 * treats an empty string as invalid and quietly substitutes 'backlog', so it
 * script looks for `<root>/backlog/tasks` instead of `<root>/tasks` and finds
 * NOTHING. That is a real scenario for `branchling init --dir .` in a fresh
 * (open source), but that is a SEPARATE defect from flag validation — outside the
 * BL-1417, reported separately.
 */
function gitBacklog() {
  const repoRoot = mkdtempSync(join(tmpdir(), "branchling-flags-repo-"));
  const dir = join(repoRoot, "backlog");
  const r = run("init-backlog.mjs", ["--dir", dir]);
  assert.equal(r.status, 0, r.stderr);
  const vcs = (...args) => execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd: repoRoot, encoding: "utf8" });
  vcs("init", "-q", "-b", "main");
  writeFileSync(join(dir, "tasks", `${P}-3-x.md`), `id: ${P}-3\n`, "utf8");
  vcs("add", "-A");
  vcs("commit", "-qm", "seed");
  return dir;
}

function historyFiles(dir) {
  const histDir = join(dir, "history");
  return existsSync(histDir) ? readdirSync(histDir) : [];
}

// ── next-backlog-id.mjs ───────────────────────────────────────────────────

test("next-backlog-id: --explain and --dir still work", () => {
  const dir = gitBacklog();
  try {
    const r = run("next-backlog-id.mjs", ["--dir", dir, "--explain"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^maximum: " + P + "-3", "m"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("next-backlog-id: an unknown flag FAILS BEFORE the branch scan", () => {
  // cwd = outside a repo: if the validation did not act BEFORE the `git
  // rev-parse` attempt, an error would occur anyway — but for the wrong reason
  // ("no task file found"), not because of the unknown flag. We check the
  // message, not just the exit code.
  const dir = gitBacklog();
  try {
    const r = run("next-backlog-id.mjs", ["--dir", dir, "--frobnicate"], { cwd: dir });
    assert.notEqual(r.status, 0, "it computed a number despite an unknown flag");
    assert.match(r.stdout + r.stderr, /--frobnicate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── suggest-board.mjs ─────────────────────────────────────────────────────

test("suggest-board: the file mode and the --paths mode still work", () => {
  const dir = freshBacklog();
  try {
    const task = join(dir, "tasks", "BL-1-x.md");
    writeFileSync(task, "---\nid: BL-1\n---\n", "utf8");
    const byFile = run("suggest-board.mjs", [task]);
    assert.equal(byFile.status, 0, byFile.stderr);
    const byPaths = run("suggest-board.mjs", ["--paths", "cokolwiek.md"]);
    assert.equal(byPaths.status, 0, byPaths.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("suggest-board: a lone unknown flag (no file, no --paths) FAILS", () => {
  const r = run("suggest-board.mjs", ["--frobnicate"]);
  assert.notEqual(r.status, 0);
});

test("suggest-board: an unknown flag BEFORE the positional file FAILS", () => {
  const dir = freshBacklog();
  try {
    const task = join(dir, "tasks", "BL-1-x.md");
    writeFileSync(task, "---\nid: BL-1\n---\n", "utf8");
    const r = run("suggest-board.mjs", ["--frobnicate", task]);
    assert.notEqual(r.status, 0, "a flag before the file was quietly ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("suggest-board: an unknown flag AFTER the positional file is NOT quietly skipped", () => {
  // The opposite order from above: here argv[2] IS a file, so the existing code
  // never looks further — without validation this flag vanishes without a trace.
  const dir = freshBacklog();
  try {
    const task = join(dir, "tasks", "BL-1-x.md");
    writeFileSync(task, "---\nid: BL-1\n---\n", "utf8");
    const r = run("suggest-board.mjs", [task, "--frobnicate"]);
    assert.notEqual(r.status, 0, "a flag after the file was quietly ignored");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("suggest-board: an unknown flag mixed into --paths is NOT quietly skipped", () => {
  const r = run("suggest-board.mjs", ["--paths", "x.md", "--frobnicate"]);
  assert.notEqual(r.status, 0, "a flag inside the --paths list was quietly ignored");
});

test("suggest-board: an unknown flag BEFORE --paths is NOT quietly skipped", () => {
  const r = run("suggest-board.mjs", ["--frobnicate", "--paths", "x.md"]);
  assert.notEqual(r.status, 0, "a flag before --paths was quietly ignored");
});

// ── build-backlog.mjs ─────────────────────────────────────────────────────

test("build-backlog: --dir and --root still build the views", () => {
  const dir = freshBacklog();
  try {
    const r = run("build-backlog.mjs", ["--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "INDEX.yaml")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-backlog: an unknown flag FAILS instead of quietly building the views", () => {
  const dir = freshBacklog();
  try {
    const r = run("build-backlog.mjs", ["--dir", dir, "--frobnicate"]);
    assert.notEqual(r.status, 0, "it built the views despite an unknown flag");
    assert.match(r.stdout + r.stderr, /--frobnicate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── build-viewer.mjs ──────────────────────────────────────────────────────

test("build-viewer: --dir still builds viewer.html", () => {
  const dir = freshBacklog();
  try {
    const r = run("build-viewer.mjs", ["--dir", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(dir, "viewer.html")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-viewer: an unknown flag FAILS instead of quietly building the viewer", () => {
  const dir = freshBacklog();
  try {
    const r = run("build-viewer.mjs", ["--dir", dir, "--frobnicate"]);
    assert.notEqual(r.status, 0, "it built the viewer despite an unknown flag");
    assert.match(r.stdout + r.stderr, /--frobnicate/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build-viewer: IMPORTING it as a module (with no CLI argv) does not blow up on validation", () => {
  // Reproduces exactly what `boards.test.mjs` / `viewer-url.test.mjs` do:
  // readTasks()/buildHtml() called WITH NO arguments under `node --test`, where
  // process.argv carries the test RUNNER's flags, not the backlog's. CLI validation
  // has no business reaching there — otherwise `node --test` would kill its own process.
  const dir = freshBacklog();
  try {
    const script = [
      "import { readTasks, computeStats, buildHtml } from " + JSON.stringify(join(SCRIPTS, "build-viewer.mjs")) + ";",
      "const tasks = readTasks(" + JSON.stringify(dir) + ");",
      "buildHtml(tasks, computeStats(tasks), (await import(" + JSON.stringify(join(SCRIPTS, "config.mjs")) + ")).loadConfig(" + JSON.stringify(dir) + "));",
      "console.log('OK-IMPORTED');",
    ].join("\n");
    const tmp = join(dir, "probe.mjs");
    writeFileSync(tmp, script, "utf8");
    // argv carries something that LOOKS like a backlog CLI flag, so that the test
    // really checks something rather than passing by accident on an empty argv.
    const r = spawnSync(process.execPath, [tmp, "--test-timeout=60000", "--frobnicate-runner-flag"], {
      encoding: "utf8", timeout: 30_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OK-IMPORTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── history-record.mjs — a priority: it has a side effect on disk ─────────

test("history-record: the known flags still work and record history", () => {
  const dir = freshBacklog();
  try {
    writeFileSync(join(dir, "tasks", "BL-1-x.md"),
      "---\nid: BL-1\ntitle: \"X\"\nstatus: pending\nboard: main\n---\n\n## Cel\n\nx\n", "utf8");
    run("history-record.mjs", ["--dir", dir]); // seed snapshotu
    writeFileSync(join(dir, "tasks", "BL-1-x.md"),
      "---\nid: BL-1\ntitle: \"X\"\nstatus: done\nboard: main\n---\n\n## Cel\n\nx\n", "utf8");
    const r = run("history-record.mjs", ["--dir", dir, "--actor", "local:test"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /recorded 1 change/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history-record: an unknown flag FAILS and does NOT touch the disk", () => {
  const dir = freshBacklog();
  try {
    writeFileSync(join(dir, "tasks", "BL-1-x.md"),
      "---\nid: BL-1\ntitle: \"X\"\nstatus: pending\nboard: main\n---\n\n## Cel\n\nx\n", "utf8");
    run("history-record.mjs", ["--dir", dir]); // seed — punkt odniesienia
    writeFileSync(join(dir, "tasks", "BL-1-x.md"),
      "---\nid: BL-1\ntitle: \"X\"\nstatus: done\nboard: main\n---\n\n## Cel\n\nx\n", "utf8");

    const beforeHist = existsSync(join(dir, "history")) ? readdirSync(join(dir, "history")).sort() : [];

    const r = run("history-record.mjs", ["--dir", dir, "--frobnicate"]);
    assert.notEqual(r.status, 0, "reconciliation went through despite an unknown flag");
    assert.match(r.stdout + r.stderr, /--frobnicate/);

    const afterHist = existsSync(join(dir, "history")) ? readdirSync(join(dir, "history")).sort() : [];
    assert.deepEqual(afterHist, beforeHist, "an unknown flag still appended something to backlog/history/");
    // The change in the task file (pending → done) has NO right to reach the log —
    // exactly what happened in a real session through `history --help`.
    const logPath = join(dir, "history", "BL-1.jsonl");
    if (existsSync(logPath)) {
      assert.ok(!readFileSync(logPath, "utf8").includes("\"done\""),
        "the status change reached the history despite the validation error");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("history-record: an unknown flag is rejected BEFORE entering reconciliation", () => {
  // The order matters: the actor validation (BL-1404) already exists and is checked
  // early — the flag validation has to come EQUALLY early, not on the side that has
  // already written something.
  const dir = freshBacklog();
  try {
    const r = run("history-record.mjs", ["--dir", dir, "--frobnicate", "--actor", "local:test"]);
    assert.notEqual(r.status, 0);
    assert.ok(!existsSync(join(dir, "history", ".snapshot.json")),
      "reconciliation managed to create a snapshot despite a bad flag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
