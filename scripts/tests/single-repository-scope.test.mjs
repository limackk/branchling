/** The core product answers about one resolved backlog, never a portfolio. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { COMMANDS, resolveCommand } from "../cli.mjs";
import { resolveBacklogDir } from "../paths.mjs";
import { BACKLOG_DIR, REPO_ROOT, SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("single-repository-scope");
plainOutput();

test("portfolio commands and flags are refused", () => {
  assert.ok(!Object.hasOwn(COMMANDS, "project"));
  assert.throws(() => resolveCommand(["project"]), /unknown command/);

  const result = spawnSync(process.execPath, [SCRIPTS_DIR + "/cli.mjs", "query", "--all-projects"], {
    cwd: REPO_ROOT, encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown flag: --all-projects/);
});

test("explicit, environment, and discovery each resolve one backlog", () => {
  const explicit = resolveBacklogDir({ dir: BACKLOG_DIR, cwd: REPO_ROOT, moduleDir: SCRIPTS_DIR });
  assert.equal(explicit.root, BACKLOG_DIR);
  assert.equal(explicit.source, "explicit");

  const byEnv = resolveBacklogDir({ env: BACKLOG_DIR, cwd: REPO_ROOT, moduleDir: SCRIPTS_DIR });
  assert.equal(byEnv.root, BACKLOG_DIR);
  assert.equal(byEnv.source, "env");

  const discovered = resolveBacklogDir({ cwd: SCRIPTS_DIR, moduleDir: SCRIPTS_DIR });
  assert.equal(discovered.root, BACKLOG_DIR);
  assert.equal(discovered.source, "discovery");
});
