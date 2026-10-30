/**
 * `closing_contract` — the project's entries `done` runs for every task
 * (TL-493).
 *
 * WHAT HAS TO BE PROVED. A module's own tests can be green while a guard of the
 * whole repository fails after the merge, so a project states that guard once,
 * in `config.yaml`, and `done` appends it to the task's own contract. Three
 * things carry the weight here:
 *
 *   1. The project entries RUN, and after the task's own — proved by an entry
 *      that only passes when the task's entry has already left its mark.
 *   2. A FAILING project entry blocks the closing. Without this positive
 *      control, "the entries run" is indistinguishable from "the entries are
 *      printed and ignored".
 *   3. An id the two contracts share is refused before anything runs, because
 *      a `[proof: id]` naming it would be ambiguous.
 *
 * Fixtures live in temporary directories, with a configuration written here:
 * no value is read from this repository's own `config.yaml`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("done-closing-contract");

import { ConfigError, loadConfig, parseConfigYaml } from "../config.mjs";
import { withClosingContract } from "../done-task.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function task(verification, criteria = ["- [ ] The task's own check passes. [proof: own]"]) {
  return [
    "---", "id: TASK-1", 'title: "T"', "type: task", "labels: []", "board: main", 'epic: ""',
    "priority: P1", "status: pending", "owner: unassigned", "estimate: 2h", "confidence: high",
    "created: 2026-09-01", "updated: 2026-09-01", "blocked_by: []", "blocks: []",
    "verification:", ...verification, "---", "", "## Acceptance criteria", "", ...criteria, "",
  ].join("\n");
}

const OWN = ["  - id: own", '    bash: "touch own-ran"'];

function withBacklog(config, verification, fn) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-closing-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), 'task_id_prefix: "TASK"\n' + config, "utf8");
  writeFileSync(join(dir, "tasks", "TASK-1-x.md"), task(verification), "utf8");
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function done(dir) {
  const r = spawnSync(process.execPath, [CLI, "done", "TASK-1", "--dir", dir], { encoding: "utf8", input: "" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const statusOf = (dir) => (readFileSync(join(dir, "tasks", "TASK-1-x.md"), "utf8").match(/^status: (.+)$/m) || [])[1];

// ──────────────────────────────────────────────────────────────────────────
// The key
// ──────────────────────────────────────────────────────────────────────────

test("closing_contract is read in the shape of a task's verification entries", () => {
  const { values, problems } = parseConfigYaml([
    "closing_contract:",
    "  - id: repo-guard",
    '    bash: "node -e 0"   # a trailing comment',
    "  # a comment between entries",
    '  - manual: "a person looked at it"',
    "labels: []",
  ].join("\n"));
  assert.deepEqual(problems, []);
  assert.deepEqual(values.closing_contract, [
    { id: "repo-guard", bash: "node -e 0", manual: null },
    { id: null, bash: null, manual: "a person looked at it" },
  ]);
  assert.deepEqual(values.labels, [], "the key after the block was swallowed by it");
});

test("a malformed closing_contract entry fails the configuration, as an unknown key does", () => {
  const { problems } = parseConfigYaml('closing_contract:\n  - id: x\n    shell: "true"\n');
  assert.ok(problems.some((p) => /closing_contract: unknown key `shell`/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /neither `bash:` nor `manual:`/.test(p)), problems.join("\n"));
  const inline = parseConfigYaml("closing_contract: true\n").problems;
  assert.ok(inline.some((p) => /closing_contract: expecting a block list/.test(p)), inline.join("\n"));

  const dir = mkdtempSync(join(tmpdir(), "branchling-closing-cfg-"));
  try {
    writeFileSync(join(dir, "config.yaml"), 'closing_contract:\n  - id: x\n    shell: "true"\n', "utf8");
    assert.throws(() => loadConfig(dir), ConfigError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no closing_contract adds nothing", () => {
  const merged = withClosingContract([{ id: "own", bash: "true", manual: null }], []);
  assert.deepEqual(merged.entries.map((e) => e.id), ["own"]);
  assert.deepEqual(merged.collisions, []);
});

// ──────────────────────────────────────────────────────────────────────────
// `done`
// ──────────────────────────────────────────────────────────────────────────

test("done runs the project's entries AFTER the task's own, and closes when both pass", () => {
  // The project entry passes only if the task's entry already ran: the order
  // is observed, not inferred from the output.
  const config = 'closing_contract:\n  - id: repo-guard\n    bash: "test -f own-ran && touch guard-ran"\n';
  withBacklog(config, OWN, (dir) => {
    const r = done(dir);
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(dir, "guard-ran")), "the project entry did not run");
    assert.match(r.out, /2 verification entries/);
    assert.match(r.out, /closing_contract {2}repo-guard/, "the project entry is not named as one");
    assert.equal(statusOf(dir), "done");
  });
});

test("POSITIVE CONTROL: a failing closing_contract entry blocks done and leaves the file untouched", () => {
  const config = 'closing_contract:\n  - id: repo-guard\n    bash: "exit 3"\n';
  withBacklog(config, OWN, (dir) => {
    const r = done(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /verification failed \(exit 3\)/);
    assert.ok(existsSync(join(dir, "own-ran")), "the task's own entry did not run first");
    assert.equal(statusOf(dir), "pending", "a task closed past a failing project entry");
  });
});

test("an id shared by the task and the closing_contract is refused before anything runs", () => {
  const config = 'closing_contract:\n  - id: own\n    bash: "touch guard-ran"\n';
  withBacklog(config, OWN, (dir) => {
    const r = done(dir);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /also an id in the project's `closing_contract`/);
    assert.match(r.out, /`id: own`/);
    assert.ok(!existsSync(join(dir, "own-ran")), "the task's entry ran although the contract was refused");
    assert.ok(!existsSync(join(dir, "guard-ran")), "the project entry ran although the contract was refused");
    assert.equal(statusOf(dir), "pending");
  });
});

test("a closing_contract does not stand in for a task with no contract of its own", () => {
  const config = 'closing_contract:\n  - id: repo-guard\n    bash: "true"\n';
  withBacklog(config, [], (dir) => {
    const r = done(dir);
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /no closing contract/);
    assert.equal(statusOf(dir), "pending");
  });
});
