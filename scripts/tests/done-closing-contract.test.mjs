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
import { probeTask, withClosingContract } from "../done-task.mjs";
import { renderProbe } from "../probe.mjs";

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

// ──────────────────────────────────────────────────────────────────────────
// The probe and the proofs audit (TL-495)
// ──────────────────────────────────────────────────────────────────────────

const TASK_FILE = (dir) => join(dir, "tasks", "TASK-1-x.md");

function checkProofs(dir) {
  const r = spawnSync(process.execPath, [CLI, "check", "--proofs", "--dir", dir], { encoding: "utf8", input: "" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

// The closing is made under one configuration and audited under another: the
// audit has to read the project contract as it stands NOW, as `done` would.
function setContract(dir, config) {
  writeFileSync(join(dir, "config.yaml"), 'task_id_prefix: "TASK"\n' + config, "utf8");
}

test("the probe runs the project's entries after the task's own and names them as the project's", () => {
  const config = 'closing_contract:\n  - id: repo-guard\n    bash: "test -f own-ran && touch guard-ran"\n';
  withBacklog(config, OWN, (dir) => {
    const probe = probeTask(dir, TASK_FILE(dir));
    assert.deepEqual(probe.problems, []);
    assert.deepEqual(probe.rows.map((r) => [r.id, Boolean(r.project), r.ok]),
      [["own", false, true], ["repo-guard", true, true]]);
    assert.ok(existsSync(join(dir, "guard-ran")), "the project entry did not run after the task's own");
    assert.match(renderProbe(probe), /`repo-guard` \(project `closing_contract`\)/);
  });
});

test("POSITIVE CONTROL: a failing project entry turns the probe red, and the own green half is still said", () => {
  const config = 'closing_contract:\n  - id: repo-guard\n    bash: "exit 3"\n';
  withBacklog(config, OWN, (dir) => {
    const probe = probeTask(dir, TASK_FILE(dir));
    assert.equal(probe.allPassed, false);
    assert.equal(probe.failed, 1);
    assert.deepEqual(probe.rows.map((r) => r.ok), [true, false]);
    assert.match(renderProbe(probe), /Every entry of this task's own passed/);
  });
});

test("the probe refuses a shared id before anything runs, as done does", () => {
  const config = 'closing_contract:\n  - id: own\n    bash: "touch guard-ran"\n';
  withBacklog(config, OWN, (dir) => {
    const probe = probeTask(dir, TASK_FILE(dir));
    assert.deepEqual(probe.rows, []);
    assert.match(probe.problems.join("\n"), /`id: own`: a verification id is also an id in the project's `closing_contract`/);
    assert.ok(!existsSync(join(dir, "own-ran")) && !existsSync(join(dir, "guard-ran")), "an entry ran");
  });
});

test("the probe appends no project entries to a task with no contract of its own", () => {
  withBacklog('closing_contract:\n  - id: repo-guard\n    bash: "touch guard-ran"\n', [], (dir) => {
    const probe = probeTask(dir, TASK_FILE(dir));
    assert.deepEqual(probe.rows, []);
    assert.ok(!existsSync(join(dir, "guard-ran")));
  });
});

test("take --probe hands over the contract done will run, project entries included", () => {
  withBacklog('closing_contract:\n  - id: repo-guard\n    bash: "exit 3"\n', OWN, (dir) => {
    const r = spawnSync(process.execPath, [CLI, "take", "TASK-1", "--probe", "--actor", "agent:test", "--dir", dir],
      { encoding: "utf8", input: "" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 of 2 entries fails now/);
    assert.match(r.stdout, /`repo-guard` \(project `closing_contract`\) — \*\*FAILS \(exit 3\)\*\*/);
  });
});

test("check --proofs re-runs the project's entries with a proven closing, and holds while they pass", () => {
  const passing = 'closing_contract:\n  - id: repo-guard\n    bash: "test -f own-ran && touch guard-ran"\n';
  withBacklog(passing, OWN, (dir) => {
    assert.equal(done(dir).code, 0);
    rmSync(join(dir, "own-ran"));
    rmSync(join(dir, "guard-ran"));
    const r = checkProofs(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /2 verification command\(s\) re-run across 1 proven closing/);
    assert.ok(existsSync(join(dir, "guard-ran")), "the project entry was not re-run after the task's own");
  });
});

test("POSITIVE CONTROL: check --proofs fails a proven closing once a project entry is red", () => {
  withBacklog('closing_contract:\n  - id: repo-guard\n    bash: "true"\n', OWN, (dir) => {
    assert.equal(done(dir).code, 0);
    setContract(dir, 'closing_contract:\n  - id: repo-guard\n    bash: "exit 3"\n');
    const r = checkProofs(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TASK-1 .*`exit 3` exits 3/);
  });
});

test("check --proofs refuses a shared id as done does, and runs nothing for that closing", () => {
  withBacklog('closing_contract:\n  - id: repo-guard\n    bash: "true"\n', OWN, (dir) => {
    assert.equal(done(dir).code, 0);
    rmSync(join(dir, "own-ran"));
    setContract(dir, 'closing_contract:\n  - id: own\n    bash: "touch guard-ran"\n');
    const r = checkProofs(dir);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TASK-1: a verification id is also an id in the project's `closing_contract`: `id: own`/);
    assert.ok(!existsSync(join(dir, "own-ran")) && !existsSync(join(dir, "guard-ran")), "an entry ran");
  });
});

test("check --proofs judges an open task's falsifiability by its own entries, not a red project entry", () => {
  withBacklog('closing_contract:\n  - id: repo-guard\n    bash: "exit 3"\n', OWN, (dir) => {
    const r = checkProofs(dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /1 open task\(s\) whose whole contract already passes/);
  });
});
