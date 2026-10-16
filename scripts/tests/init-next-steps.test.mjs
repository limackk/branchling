/**
 * `init` names the optional setup steps it did not take (TL-476).
 *
 * The skill and the git gates are opt-in because they write into `.claude/` and
 * `.git/hooks/`, which belong to the repository's owner. Opt-in is only a
 * choice if somebody is told the option exists, so the closing lines name each
 * step that is still missing — and stop naming it once it is done, which is the
 * positive control here: a line printed unconditionally would fail the second
 * half of each test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PRODUCT_NAME } from "../product.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("init-next-steps");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return r.stdout;
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-init-next-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  return dir;
}

const SKILLS = PRODUCT_NAME + " skills install";
const HOOKS = PRODUCT_NAME + " hooks print";

test("a default init names both skipped steps", () => {
  const out = run(repo(), ["init", "--dir", "backlog", "--no-example"]);
  assert.ok(out.includes(SKILLS), "the skill step went unmentioned:\n" + out);
  assert.ok(out.includes(HOOKS), "the git gates went unmentioned:\n" + out);
});

test("init --skills does not suggest the step it has just taken", () => {
  const out = run(repo(), ["init", "--dir", "backlog", "--no-example", "--skills"]);
  assert.ok(!out.includes(SKILLS), "the installed skill is still suggested:\n" + out);
  assert.ok(out.includes(HOOKS));
});

test("installed git gates are no longer suggested", () => {
  const dir = repo();
  run(dir, ["init", "--dir", "backlog", "--no-example", "--skills"]);
  run(dir, ["hooks", "install", "--dir", "backlog"]);
  const again = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.ok(!again.includes(HOOKS), "installed gates are still suggested:\n" + again);
  assert.ok(!again.includes("optional:"), "an empty optional section was printed:\n" + again);
});

test("outside a git repository the gates are not suggested", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-init-next-nogit-"));
  const out = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.ok(!out.includes(HOOKS), "a hook was suggested where git cannot run one:\n" + out);
});
