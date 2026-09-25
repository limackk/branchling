/**
 * A `node --test` contract cannot be green before its named file exists
 * (TL-424). The contracts guard owns this because it already reads every open
 * task's verification entries as executable instructions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { missingNodeTestFile, nodeTestFiles } from "../done-task.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("contract-real-file");

function fixture(label) {
  const root = mkdtempSync(join(tmpdir(), "branchling-" + label + "-"));
  const backlog = join(root, "backlog");
  const made = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "init", "--dir", backlog, "--no-example"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return { root, backlog };
}

function withContract(fx, command) {
  const made = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "new", "--dir", fx.backlog, "--title", "A judged test file"], {
    cwd: fx.root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  const name = readdirSync(join(fx.backlog, "tasks")).find((file) => file.startsWith(id + "-"));
  const file = join(fx.backlog, "tasks", name);
  const raw = readFileSync(file, "utf8");
  writeFileSync(
    file,
    raw.replace(
      /^verification:[\s\S]*?(?=^---$)/m,
      'verification:\n  - id: the-name\n    bash: "' + command + '"\n'
    ),
    "utf8"
  );
  return id;
}

function close(fx, id) {
  return spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), "done", id, "--dir", fx.backlog], {
    cwd: fx.root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

test("POSITIVE CONTROL: a literal node --test file is recognised and missing", () => {
  const entry = { bash: "node --test scripts/tests/not-written.test.mjs" };
  assert.deepEqual(nodeTestFiles(entry), ["scripts/tests/not-written.test.mjs"]);
  assert.equal(missingNodeTestFile([entry], "/definitely-absent").path, "scripts/tests/not-written.test.mjs");
});

test("done fails for a missing node --test file and names its task and entry", () => {
  const fx = fixture("missing-contract-file");
  const id = withContract(fx, "node --test scripts/tests/not-written.test.mjs");
  const r = close(fx, id);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, new RegExp(id + ": a `node --test` file"));
  assert.match(r.stderr, /scripts\/tests\/not-written\.test\.mjs/);
  assert.match(r.stderr, /literal repository-relative/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("a real file passes, and creating a missing file turns the same contract green", () => {
  const fx = fixture("created-contract-file");
  const id = withContract(fx, "node --test proof.test.mjs");

  const before = close(fx, id);
  assert.equal(before.status, 1, before.stdout + before.stderr);

  // With no git repository, `done` deliberately treats the backlog directory
  // as the command root rather than guessing that its parent is a repository.
  writeFileSync(join(fx.backlog, "proof.test.mjs"), "// fixture proof\n", "utf8");
  const after = close(fx, id);
  assert.equal(after.status, 0, after.stdout + after.stderr);
  assert.match(after.stdout, /passed/);
  rmSync(fx.root, { recursive: true, force: true });
});

test("shell expansions and arbitrary commands are outside the narrow file check", () => {
  assert.deepEqual(nodeTestFiles({ bash: "node --test scripts/tests/*.test.mjs" }), []);
  assert.deepEqual(nodeTestFiles({ bash: "npm test scripts/tests/not-written.test.mjs" }), []);
  assert.deepEqual(nodeTestFiles({ bash: "node --test $TEST_FILE" }), []);
});
