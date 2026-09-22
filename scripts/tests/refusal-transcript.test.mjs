/**
 * A refusal transcript says which layer every line came from (TL-275).
 *
 * THE DEFECT THIS HOLDS SHUT. `done` pastes the failing entry's captured output
 * to stderr immediately before its own refusal. A verification entry is usually
 * a test suite, and a test that runs this CLI and asserts it refuses captures
 * this tool's `✗` and prints it inside the runner's stream. Unframed, those
 * lines sit in the same column, in the same alphabet and with the same wording
 * as the refusal that follows them — so a reader who has only the transcript
 * concludes that a guard is broken against the repository they are closing a
 * task in, when what they are looking at is that guard's positive control. It
 * happened twice, six waves apart, to two sessions that had not seen each other.
 *
 * WHAT IS ASSERTED. Provenance per line: behind the gutter is the command's
 * output, without it is the refusal. The positive control asserts the same
 * predicate against the UNFRAMED transcript, so a regression that dropped the
 * frame would fail here rather than leave a test passing on the old output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("refusal-transcript");
// Assert against plain text, not against the observer's terminal (TL-238).
plainOutput();

import { TRANSCRIPT_GUTTER, transcriptBlock } from "../done-task.mjs";
import { MARK } from "../ui.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** The frame's own three or four lines — everything else in the block is either
 *  behind the gutter or does not belong to the transcript at all. */
const isFrame = (l) => l.startsWith("── ") || l.startsWith("   ") || l === "";

/**
 * THE PREDICATE THE WHOLE FILE TURNS ON. A reader is handed `text` and knows
 * what `captured` said; can they tell, line by line, that those lines are the
 * command's output rather than the refusal's own? Only if every one of them
 * reaches the reader behind the gutter and none of them reaches it bare.
 *
 * It is deliberately NOT "a line starting with `✗` is the refusal": that is the
 * assumption the defect was made of — a nested run's refusal starts with `✗` in
 * column one too, which is exactly why two sessions misread it.
 */
function capturedLinesAreMarked(text, captured) {
  const rows = text.split("\n");
  return captured
    .split("\n")
    .filter((l) => l.length)
    .every((line) => {
      const hits = rows.filter((r) => r.endsWith(line));
      return hits.length > 0 && hits.every((r) => r.startsWith(TRANSCRIPT_GUTTER));
    });
}

/** No line INSIDE the frame carries the error mark without the gutter — the
 *  frame's own header must not undo what the frame is for. */
function frameRegionIsClean(text) {
  const rows = text.split("\n");
  const start = rows.findIndex((l) => l.startsWith("── transcript of "));
  const end = rows.findIndex((l) => l.startsWith("── end of transcript"));
  if (start < 0 || end < 0) return false;
  return rows
    .slice(start, end + 1)
    .every((l) => l.indexOf(MARK.err) < 0 || l.startsWith(TRANSCRIPT_GUTTER));
}

// ──────────────────────────────────────────────────────────────────────────
// The frame itself
// ──────────────────────────────────────────────────────────────────────────

// What a suite prints when one of its tests asserts that this tool refuses: the
// runner's own failure mark and, captured from a nested run, this tool's.
const CAPTURED = [
  "✖ backlog: id collisions (12ms)",
  MARK.err + " backlog: task identity is violated",
  "  BL-262  BL-262-expert-sos.md",
  "✖ failing tests:",
].join("\n");

test("every captured line is behind the gutter, and the frame names the command", () => {
  const block = transcriptBlock(CAPTURED, { command: "node --test scripts/tests/x.test.mjs", exitCode: 1 });
  const rows = block.split("\n").filter((l) => l.length);
  for (const row of rows) {
    if (isFrame(row)) continue;
    assert.ok(row.startsWith(TRANSCRIPT_GUTTER), "a captured line reached the reader unframed: " + row);
  }
  assert.match(block, /transcript of `node --test scripts\/tests\/x\.test\.mjs` \(exit 1\)/);
  assert.match(block, /4 lines/);
  assert.ok(capturedLinesAreMarked(block, CAPTURED));
  assert.ok(frameRegionIsClean(block));
});

test("POSITIVE CONTROL: the unframed transcript fails the same predicate", () => {
  // This is the output the command produced before TL-275 framed it. If the
  // predicate above were satisfiable without the frame it would be proving
  // nothing, so the same function is run against the raw text and must say no.
  assert.equal(capturedLinesAreMarked(CAPTURED, CAPTURED), false);
  assert.equal(frameRegionIsClean(CAPTURED), false);
});

test("the header counts the lines carrying this tool's own mark", () => {
  const block = transcriptBlock(CAPTURED, { command: "true", exitCode: 1 });
  assert.match(block, /1 of them is \S+ refusing inside that command/);
  const two = transcriptBlock(CAPTURED + "\n" + MARK.err + " backlog: a second one", { command: "true", exitCode: 1 });
  assert.match(two, /2 of them are \S+ refusing inside that command/);
  // A transcript with nothing of ours in it does not invent the sentence.
  assert.doesNotMatch(transcriptBlock("plain\noutput", { command: "true", exitCode: 1 }), /refusing inside that command/);
});

test("the line count is stated twice, so a truncated relay is detectable", () => {
  const block = transcriptBlock(CAPTURED, { command: "true", exitCode: 1 });
  assert.match(block, /· 4 lines ──/);
  assert.match(block, /end of transcript · 4 lines written/);
  const gutters = block.split("\n").filter((l) => l.startsWith(TRANSCRIPT_GUTTER)).length;
  assert.equal(gutters, 4, "the frame claims a count the frame does not contain");
});

test("an empty transcript is framed without claiming a line", () => {
  const block = transcriptBlock("", { command: "true", exitCode: 1 });
  assert.match(block, /0 lines/);
  assert.equal(block.split("\n").filter((l) => l.startsWith(TRANSCRIPT_GUTTER)).length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// A real refusal, with a real nested run inside it
// ──────────────────────────────────────────────────────────────────────────

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
    "- [ ] A. [proof: nested]",
    "",
  ].join("\n");
}

function withBacklog(verification, fn) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-refusal-transcript-"));
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

// A verification entry that makes THIS tool refuse inside the contract — the
// shape of the defect, with no test runner needed to produce it. Its `✗` is
// genuinely this tool's, captured from a nested run, exactly as a suite would
// have captured it.
const NESTED_REFUSAL = "'" + process.execPath + "' '" + CLI + "' frobnicate; exit 1";

function done(dir, args) {
  const r = spawnSync(process.execPath, [CLI, "done", "TASK-1", ...args, "--dir", dir], {
    encoding: "utf8",
    input: "",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

const statusOf = (dir) => (readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8").match(/^status: (.+)$/m) || [])[1];

test("a nested refusal captured by the contract is not read as a failure of this run", () => {
  withBacklog(["  - id: nested", `    bash: "${NESTED_REFUSAL.replace(/"/g, '\\"')}"`], (dir) => {
    const r = done(dir, []);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(statusOf(dir), "pending", "a refused close touched the task file");

    // The nested tool's line is in the transcript, and it is behind the gutter.
    const nested = r.stderr.split("\n").filter((l) => l.indexOf("unknown command: frobnicate") >= 0);
    assert.equal(nested.length, 1, "the nested refusal is not in the transcript: " + r.stderr);
    assert.ok(nested[0].startsWith(TRANSCRIPT_GUTTER), "the nested refusal reached the reader unframed");

    // This command's own refusal is NOT behind it — that is the whole boundary.
    const verdict = r.stderr.split("\n").filter((l) => l.indexOf("verification failed") >= 0);
    assert.equal(verdict.length, 1);
    assert.ok(!verdict[0].startsWith(TRANSCRIPT_GUTTER), "the verdict was framed as if it were captured output");

    // The sample is the nested line as the nested tool wrote it — the gutter
    // stripped back off, so the predicate is asked the reader's question and not
    // a question the frame already answered for it.
    assert.ok(
      capturedLinesAreMarked(r.stderr, nested[0].slice(TRANSCRIPT_GUTTER.length)),
      "a captured line names no layer:\n" + r.stderr
    );
    assert.ok(frameRegionIsClean(r.stderr), "an unguttered `✗` sits inside the frame:\n" + r.stderr);
  });
});

test("a genuine refusal still reads as one, and still comes last", () => {
  withBacklog(["  - id: nested", '    bash: "echo the-failing-line >&2; exit 3"'], (dir) => {
    const r = done(dir, []);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /verification failed \(exit 3\)/);
    assert.match(r.stderr, /its status is still `pending`/);
    assert.match(r.stderr, new RegExp("^\\" + TRANSCRIPT_GUTTER.trim() + " the-failing-line$", "m"));
    assert.ok(
      r.stderr.indexOf("end of transcript") < r.stderr.indexOf("verification failed"),
      "the verdict is no longer the last thing on screen"
    );
  });
});
