/**
 * `readTaskRecords()` returns the tasks in filename order whatever order the
 * directory is listed in (TL-643).
 *
 * THE DEFECT THIS GUARDS. The function's doc comment promised filename order,
 * and the code kept whatever `readdirSync` returned. On Linux and macOS that
 * is sorted only because libuv sorts the names it scans; on Windows it is the
 * filesystem's own order, which NTFS collates case-insensitively. Every
 * command that reads the tree through this function — `query`, `next`,
 * `take`, the release pipeline and the rest — inherited the platform's order
 * (the TL-624 class).
 *
 * HOW ANOTHER FILESYSTEM IS STOOD IN FOR. `fs.readdirSync` is replaced and
 * `syncBuiltinESMExports()` carries the replacement into the named import
 * task-select.mjs holds, so the listing the function reads is one this test
 * chose. Each test counts the listings it rewrote: a replacement that never
 * reached the function would leave the platform's sorted order in place and
 * the assertion green with no evidentiary force.
 *
 * Run: node --test scripts/tests/task-records-order.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readTaskRecords } from "../task-select.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("task-records-order");

// A foreign prefix: these are fixture names, not references to this backlog.
const TASK_FILE = /^PROJ-\d+-[A-Za-z-]+\.md$/;

// In code-unit order. `PROJ-10-…` sorts before `PROJ-2-…` and `PROJ-3-Beta`
// before `PROJ-3-alpha`, so neither a numeric nor a case-insensitive order
// reproduces this list by accident.
const NAMES = [
  "PROJ-1-first.md",
  "PROJ-10-tenth.md",
  "PROJ-2-second.md",
  "PROJ-3-Beta.md",
  "PROJ-3-alpha.md",
];

function tasksFixture() {
  const dir = join(fixtureDir(join(tmpdir(), "branchling-records-order-")), "tasks");
  mkdirSync(dir);
  for (const name of NAMES) {
    const id = name.match(/^PROJ-\d+/)[0];
    writeFileSync(join(dir, name), `---\nid: ${id}\ntitle: "${name}"\nstatus: pending\n---\n\nBody.\n`, "utf8");
  }
  // Not a task file under TASK_FILE: the filter still applies after the sort.
  writeFileSync(join(dir, "README.md"), "not a task\n", "utf8");
  return dir;
}

/** Reads the records while `readdirSync` lists `dir` through `reorder`. */
function readListedAs(dir, reorder) {
  const fs = createRequire(import.meta.url)("node:fs");
  const original = fs.readdirSync;
  let rewritten = 0;
  fs.readdirSync = (...args) => {
    const names = original.apply(fs, args);
    if (String(args[0]) !== dir) return names;
    rewritten++;
    return reorder(names.slice());
  };
  syncBuiltinESMExports();
  try {
    return { files: readTaskRecords(dir, TASK_FILE).map((r) => r.file), rewritten };
  } finally {
    fs.readdirSync = original;
    syncBuiltinESMExports();
  }
}

const EXPECTED = NAMES.map((n) => `tasks/${n}`);

test("a directory listed backwards still yields filename order", () => {
  const dir = tasksFixture();
  const { files, rewritten } = readListedAs(dir, (names) => names.sort().reverse());
  assert.equal(rewritten, 1, "the reversed listing was the one read");
  assert.deepEqual(files, EXPECTED);
});

test("a case-insensitive listing, as NTFS collates, still yields code-unit order", () => {
  const dir = tasksFixture();
  const ntfs = (names) => names.sort((a, b) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  // Positive control: that listing really differs from the expected order,
  // so a pass is not the platform's own sorted order coming through.
  assert.notDeepEqual(ntfs(NAMES.slice()).map((n) => `tasks/${n}`), EXPECTED);
  const { files, rewritten } = readListedAs(dir, ntfs);
  assert.equal(rewritten, 1, "the case-insensitive listing was the one read");
  assert.deepEqual(files, EXPECTED);
});
