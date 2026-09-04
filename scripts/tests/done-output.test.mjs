/**
 * What a closing costs the session that ran it (TL-221).
 *
 * `done` used to stream the stdout of every verification entry, PASSING ones
 * included, and offered no way to ask for less: on this repository that was
 * 1698 lines of `✔` before the two lines a closer needed. The rule the tool
 * applies to the backlog — a command costs what its answer is worth — is
 * applied here to the tool's own closing gate.
 *
 * The assertions are on the SIZE of what a green close prints, not only on its
 * last line: a test that checked for `closed` alone would stay green while the
 * transcript grew back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("done-output");

import { suppressedNote } from "../done-task.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

// A command that prints a known number of lines and then passes or fails —
// the size is the fixture, and `seq` is the same on every platform.
const NOISY_PASS = "seq 1 300";
const NOISY_FAIL = "seq 1 300; echo the-failing-line >&2; exit 1";

function task(verification) {
  return [
    "---",
    "id: TASK-1",
    'title: "T"',
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
    "blocked_by: []",
    "blocks: []",
    "verification:",
    ...verification,
    "---",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] A. [proof: noisy]",
    "",
  ].join("\n");
}

function withBacklog(verification, fn) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-done-output-"));
  try {
    mkdirSync(join(dir, "tasks"));
    writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
    writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
    writeFileSync(join(dir, "config.yaml"), 'task_id_prefix: "TASK"\n', "utf8");
    writeFileSync(join(dir, "tasks", "TASK-1-x.md"), task(verification), "utf8");
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function done(dir, args) {
  const r = spawnSync(process.execPath, [CLI, "done", "TASK-1", ...args, "--dir", dir], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const lines = (s) => s.split("\n").filter((l) => l.length).length;
const statusOf = (dir) => (readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8").match(/^status: (.+)$/m) || [])[1];

test("a green close does not print the passing entry's output, and says how much it withheld", () => {
  withBacklog(["  - id: noisy", `    bash: "${NOISY_PASS}"`], (dir) => {
    const r = done(dir, []);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(statusOf(dir), "done");
    assert.doesNotMatch(r.stdout, /^150$/m, "a line of the passing transcript reached the terminal");
    assert.match(r.stdout, /passed \(\d+ ms, 300 lines not shown\)/);
    // The whole close, verdict and all, is a screen — not a transcript.
    assert.ok(lines(r.stdout + r.stderr) < 20, "a green close printed " + lines(r.stdout + r.stderr) + " lines");
  });
});

test("POSITIVE CONTROL: --verbose streams the same transcript the default withholds", () => {
  withBacklog(["  - id: noisy", `    bash: "${NOISY_PASS}"`], (dir) => {
    const r = done(dir, ["--verbose"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^150$/m, "--verbose did not stream the transcript");
    assert.doesNotMatch(r.stdout, /not shown/, "a streamed entry claims lines were withheld");
  });
});

test("a FAILING entry's output is printed whole, and the task is not touched", () => {
  withBacklog(["  - id: noisy", `    bash: "${NOISY_FAIL}"`], (dir) => {
    const r = done(dir, []);
    assert.equal(r.code, 1);
    assert.equal(statusOf(dir), "pending");
    assert.match(r.stderr, /^1$/m);
    assert.match(r.stderr, /^300$/m, "the failing transcript was truncated");
    assert.match(r.stderr, /the-failing-line/);
    assert.match(r.stderr, /verification failed/);
    // The verdict comes AFTER the transcript, so it is the last thing on screen.
    assert.ok(r.stderr.indexOf("the-failing-line") < r.stderr.indexOf("verification failed"));
  });
});

test("--json is unchanged: the envelope carries every entry and no prose", () => {
  withBacklog(["  - id: noisy", `    bash: "${NOISY_PASS}"`], (dir) => {
    const r = done(dir, ["--json"]);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].ok, true);
    assert.doesNotMatch(r.stdout, /not shown/);
  });
});

test("--help names --verbose, and an unknown flag still fails", () => {
  const help = spawnSync(process.execPath, [CLI, "done", "--help"], { encoding: "utf8" });
  assert.match(help.stdout + help.stderr, /--verbose/);
  withBacklog(["  - id: noisy", '    bash: "true"'], (dir) => {
    const r = done(dir, ["--quiet"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown flag: --quiet/);
    assert.equal(statusOf(dir), "pending");
  });
});

test("suppressedNote counts non-empty lines and is silent for a silent or streamed command", () => {
  assert.equal(suppressedNote(null), "");
  assert.equal(suppressedNote(""), "");
  assert.equal(suppressedNote("\n\n"), "");
  assert.equal(suppressedNote("one\n"), ", 1 line not shown");
  assert.equal(suppressedNote("a\nb\nc"), ", 3 lines not shown");
});
