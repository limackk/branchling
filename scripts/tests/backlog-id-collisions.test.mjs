/**
 * Regression net for `check-backlog-id-collisions.mjs`.
 *
 * The invariant under test: a BL number identifies exactly ONE task file, and a
 * task's frontmatter `id` agrees with the number in its filename. Both halves
 * matter — a renumber that touches only one of them leaves the tree looking
 * clean to a reader while every cross-reference silently points at the wrong
 * task.
 *
 * Class of bug (2026-08-09): four live collisions (BL-262, BL-607, BL-860,
 * BL-703) plus two more that parallel branches were about to introduce. The
 * generator printed a warning and exited 0, so nothing ever failed on them and
 * they survived for months. These tests exist so the guard cannot regress back
 * into advertising a protection it does not enforce.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { TASKS_DIR } from "./_repo.mjs";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "check-backlog-id-collisions.mjs",
);

/** Writes a minimal task file; `id` omitted means "no id field at all". */
function task(dir, filename, { id, title = "T" } = {}) {
  const idLine = id === undefined ? "" : `id: ${id}\n`;
  writeFileSync(
    join(dir, filename),
    `---\n${idLine}title: "${title}"\nstatus: pending\n---\n\n## Cel\n`,
  );
}

function withTasks(build) {
  const dir = mkdtempSync(join(tmpdir(), "origin-backlog-guard-"));
  try {
    build(dir);
    try {
      const stdout = execFileSync("node", [SCRIPT, dir], { encoding: "utf8" });
      return { code: 0, out: stdout };
    } catch (err) {
      return { code: err.status, out: `${err.stdout || ""}${err.stderr || ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a tree where every BL number is used once passes", () => {
  const r = withTasks((d) => {
    task(d, "BL-100-alpha.md", { id: "BL-100" });
    task(d, "BL-101-beta.md", { id: "BL-101" });
  });
  assert.equal(r.code, 0, r.out);
});

test("two task files sharing one BL number fail, and both are named", () => {
  const r = withTasks((d) => {
    task(d, "BL-262-expert-sos.md", { id: "BL-262" });
    task(d, "BL-262-feeding-dialog.md", { id: "BL-262" });
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /BL-262/);
  assert.match(r.out, /BL-262-expert-sos\.md/);
  assert.match(r.out, /BL-262-feeding-dialog\.md/);
});

test("a half-finished renumber (filename moved, frontmatter left behind) fails", () => {
  const r = withTasks((d) => {
    task(d, "BL-900-feeding-dialog.md", { id: "BL-262" });
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /BL-900-feeding-dialog\.md/);
  assert.match(r.out, /BL-262/);
});

test("a half-finished renumber the other way round (frontmatter moved) fails", () => {
  const r = withTasks((d) => {
    task(d, "BL-262-feeding-dialog.md", { id: "BL-900" });
  });
  assert.equal(r.code, 1, r.out);
});

test("a task with no id field fails rather than being silently derived", () => {
  const r = withTasks((d) => {
    task(d, "BL-300-gamma.md", {});
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /BL-300-gamma\.md/);
});

test("non-task files in the directory are ignored", () => {
  const r = withTasks((d) => {
    task(d, "BL-100-alpha.md", { id: "BL-100" });
    writeFileSync(join(d, "_template.md"), "---\nid: BL-NNN\n---\n");
    writeFileSync(join(d, "README.md"), "not a task\n");
  });
  assert.equal(r.code, 0, r.out);
});

test("the real backlog/tasks tree is clean", () => {
  const out = execFileSync("node", [SCRIPT, TASKS_DIR], { encoding: "utf8" });
  assert.match(out, /✓/);
  // Positive control: on an empty tasks/ the guard also prints ✓. A green run
  // has to mean "I looked and it was clean", not "there was nothing to look at".
  assert.doesNotMatch(out, /\b0 task/, "guard judged zero tasks: " + out);
});
