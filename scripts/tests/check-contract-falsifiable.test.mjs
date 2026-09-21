/**
 * `check --proofs` names an OPEN task whose contract already passes (TL-260).
 *
 * WHY THE FIXTURE IS TL-143'S ORIGINAL CONTRACT. That task arrived with
 * `! grep -qE '<accented letters>' <template>` over a file its own acceptance
 * criteria forbade it to touch, and which had been English for days. Run before
 * any work it exited 0, and nothing in the tool said so: `check --proofs` looked
 * only at closings it had proved, `done` would have accepted it, and the only
 * thing that caught it was a rule in a charter outside the repository. A fixture
 * of `true` would test the same code path, but it would not show WHICH shape of
 * command this guard exists for — the one that reads a real file and can never
 * be made to fail by the work described beside it.
 *
 * THE PAIR THAT GIVES IT FORCE. The same backlog with a contract that FAILS
 * against the tree, which must not be named: a guard that named every open task
 * would pass the first half of this file and say nothing true.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { greenFromBirth } from "../check-backlog-proofs.mjs";

import { isolateHome } from "./_repo.mjs";

// The home is isolated for the whole file: `node --test` runs each file in its
// own process, so one call covers every case in it and no case reads the
// developer's own configuration.
isolateHome("contract-falsifiable");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;

/**
 * A backlog holding ONE task in a queue status, whose contract is `entry`.
 *
 * The task file is written directly rather than through `new`, because what is
 * under test is what the guard makes of a contract that is already on disk.
 */
function backlog(entry, { status = "pending" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-falsifiable-" + counter++ + "-"));
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);

  writeFileSync(join(dir, "tasks", "TASK-1-an-open-task.md"), [
    "---", "id: TASK-1", 'title: "An open task"', "type: task", "labels: []", "board: main",
    'epic: ""', "priority: P1", "status: " + status, 'owner: ""', "estimate: 2h",
    "created: 2026-09-04", "updated: 2026-09-04", "blocked_by: []", "blocks: []",
    "verification:", entry, "---", "", "## Goal", "", "Work nobody has started.", "",
  ].join("\n"), "utf8");
  return dir;
}

/** A file written in English, exactly as TL-143's template already was. */
function englishFile(dir) {
  const path = join(dir, "template-fixture.md");
  writeFileSync(path, "# A task\n\nWritten in English, and was before the work started.\n", "utf8");
  return path;
}

function check(dir, args = []) {
  const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--dir", dir, ...args],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function withBacklog(entry, opts, fn) {
  const dir = backlog(entry, opts);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an open task whose whole contract already passes is named", () => {
  const dir = backlog('  - id: template-still-english\n    bash: "PLACEHOLDER"');
  try {
    const file = englishFile(dir);
    // TL-143's contract, verbatim in shape: a NEGATED grep over a file that is
    // already English. It exits 0 today, it exited 0 the day the task was
    // written, and no work the task described could have changed that.
    // The letters are BUILT rather than typed, so this source file stays ASCII
    // while the command that reaches the shell carries the real characters —
    // written out, they would be the only non-English glyphs in the repository.
    const accented = String.fromCharCode(0x105, 0x107, 0x119, 0x142, 0x144, 0xf3, 0x15b, 0x17a, 0x17c);
    const contract = "! grep -qE '[" + accented + "]' " + file;
    writeFileSync(join(dir, "tasks", "TASK-1-an-open-task.md"), [
      "---", "id: TASK-1", 'title: "An open task"', "type: task", "labels: []", "board: main",
      'epic: ""', "priority: P1", "status: pending", 'owner: ""', "estimate: 2h",
      "created: 2026-09-04", "updated: 2026-09-04", "blocked_by: []", "blocks: []",
      "verification:", "  - id: template-still-english", '    bash: "' + contract + '"',
      "---", "", "## Goal", "", "Work nobody has started.", "",
    ].join("\n"), "utf8");

    const r = check(dir);
    assert.match(r.out, /TASK-1/,
      "the guard has to name the task, not merely count it: " + r.out);
    assert.match(r.out, /already passes/,
      "and say WHY it is named — a contract green before the work: " + r.out);
    assert.equal(r.code, 0,
      "the finding reports; it does not fail the run (see the decision on TL-260)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an open task whose contract fails against the tree is not named", () => {
  withBacklog('  - id: work-still-ahead\n    bash: "false"', {}, (dir) => {
    const r = check(dir);
    assert.doesNotMatch(r.out, /already passes/,
      "a contract that can fail is sound, and a guard naming it would be noise: " + r.out);
    assert.match(r.out, /1 open contract\(s\) can still fail/,
      "and the run has to say it looked — a finding of none needs its sample size: " + r.out);
    assert.equal(r.code, 0, r.out);
  });
});

test("a contract waiting on a person is not read as green", () => {
  withBacklog('  - id: seen\n    manual: "somebody looked at the page"', {}, (dir) => {
    const r = check(dir);
    assert.doesNotMatch(r.out, /already passes/,
      "nobody has vouched, so nothing passed — reporting it would invent a verdict: " + r.out);
  });
});

test("`greenFromBirth` needs a command that ran, and every one of them", () => {
  assert.equal(greenFromBirth([{ kind: "bash", ok: true }]), true);
  assert.equal(greenFromBirth([{ kind: "bash", ok: true }, { kind: "bash", ok: false }]), false,
    "one failing entry makes the whole contract falsifiable");
  assert.equal(greenFromBirth([{ kind: "manual", ok: null }]), false,
    "a manual entry was not run and cannot be counted as passing");
  assert.equal(greenFromBirth([{ kind: "bash", ok: true }, { kind: "manual", ok: null }]), false,
    "nor when a person's signature is still owed beside a passing command");
  assert.equal(greenFromBirth([]), false,
    "an empty result is a zero sample, and a zero sample proves nothing");
});
