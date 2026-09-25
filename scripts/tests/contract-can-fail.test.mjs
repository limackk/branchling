/**
 * A green closing is distinguishable from one whose test executed no file the
 * task changed (TL-443). The pair is intentionally identical except for the
 * test importing the changed module: without that positive control a detector
 * that accused every closing would satisfy the negative half.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CAPABLE, INCAPABLE, UNDETERMINED, contractCapability } from "../contract-capability.mjs";
import { isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("contract-can-fail");
plainOutput();

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
let counter = 0;

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", env: {
      ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state"),
    },
  });
}

function git(dir, args) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function fixture({ importsChangedFile = false, policy = "report" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-contract-capability-" + counter++ + "-"));
  const initialized = run(["init", "--dir", dir, "--no-example"], dir);
  assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  const config = join(dir, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8")
    .replace(/^contract_capability:.*$/m, "contract_capability: " + policy), "utf8");
  writeFileSync(join(dir, "feature.mjs"), "export const answer = 1;\n", "utf8");
  writeFileSync(join(dir, "proof.test.mjs"), [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    importsChangedFile ? 'import { answer } from "./feature.mjs";' : "",
    'test("the fixture is green", () => assert.equal(' + (importsChangedFile ? "answer" : "1") + ', 1));',
    "",
  ].filter(Boolean).join("\n"), "utf8");
  writeFileSync(join(dir, "tasks", "TASK-1-capability.md"), [
    "---", "id: TASK-1", 'title: "Capability fixture"', "type: task", "labels: []", "board: main",
    'epic: ""', "priority: P1", "status: in_progress", "owner: agent:test", 'role: ""', 'executor: ""',
    "estimate: 2h", "confidence: medium", "created: 2026-09-25", "updated: 2026-09-25",
    "blocked_by: []", "blocks: []", "related_docs: []", "verification:",
    '  - id: proof\n    bash: "node --test proof.test.mjs"', "---", "", "## Goal", "", "Change the feature.", "",
    "## Acceptance criteria", "", "- [ ] The feature changed [proof: proof]", "",
  ].join("\n"), "utf8");
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", "TASK-0 fixture baseline"]);
  writeFileSync(join(dir, "feature.mjs"), "export const answer = 2 - 1;\n", "utf8");
  return dir;
}

function close(dir) {
  return run(["done", "TASK-1", "--actor", "agent:test", "--dir", dir], dir);
}

test("a closing that executes none of its changed files is recorded and audited", () => {
  const dir = fixture();
  try {
    const done = close(dir);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /run executed no file this task changed/);
    const history = readFileSync(join(dir, "history", "TASK-1.jsonl"), "utf8")
      .trim().split("\n").map(JSON.parse);
    const closing = history.find((entry) => entry.field === "status" && entry.to === "done");
    assert.equal(closing.contractCapability.verdict, INCAPABLE);

    const audit = run(["audit", "--dir", dir], dir);
    assert.equal(audit.status, 1, audit.stdout + audit.stderr);
    assert.match(audit.stdout, /closing contract executed no changed file/);
    assert.match(audit.stdout, /TASK-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the same closing is not reported when its test executes the changed file", () => {
  const dir = fixture({ importsChangedFile: true });
  try {
    const done = close(dir);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /run executed a file this task changed/);
    const audit = run(["audit", "--dir", dir], dir);
    assert.doesNotMatch(audit.stdout, /TASK-1.*Capability fixture/);
    assert.doesNotMatch(audit.stdout, /closing contract executed no changed file\s+\(1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("foreign and partially observed contracts are undetermined, never incapable", () => {
  assert.equal(contractCapability([{ coverageObserved: false }], ["feature.mjs"]).verdict, UNDETERMINED);
  assert.equal(contractCapability([
    { coverageObserved: true, executedFiles: [] },
    { coverageObserved: false },
  ], ["feature.mjs"]).verdict, UNDETERMINED);
  assert.equal(contractCapability([
    { coverageObserved: true, executedFiles: ["feature.mjs"] },
    { coverageObserved: false },
  ], ["feature.mjs"]).verdict, CAPABLE);
});

test("requiring the signal is an explicit policy and leaves the task open", () => {
  const dir = fixture({ policy: "require" });
  try {
    const done = close(dir);
    assert.equal(done.status, 1, done.stdout + done.stderr);
    assert.match(done.stderr, /contract_capability: require/);
    assert.match(readFileSync(join(dir, "tasks", "TASK-1-capability.md"), "utf8"), /^status: in_progress$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
