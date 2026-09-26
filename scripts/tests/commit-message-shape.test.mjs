/**
 * A commit body has bytes, not the shell text that was meant to make it.
 *
 * The focused cases exercise the command against message files, because that
 * is exactly what Git gives a `commit-msg` hook. The last case installs the
 * hook and asks Git to make both commits: a generated hook that never runs
 * would satisfy every direct command assertion and protect no history.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { literalParagraphBreaks } from "../commit-message.mjs";
import { COMMIT_MESSAGE_HOOK_NAME, hooksTarget } from "../hooks-command.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("commit-message-shape");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function git(cwd, ...args) {
  return spawnSync("git", args, {
    cwd, encoding: "utf8", timeout: 30_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

function message(text) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-commit-message-"));
  const path = join(dir, "message");
  writeFileSync(path, text, "utf8");
  return { dir, path };
}

test("a literal backslash-n paragraph separator is rejected", () => {
  const { path } = message("Title\n\nFirst\\n\\nSecond\n");
  assert.deepEqual(literalParagraphBreaks(readFileSync(path, "utf8")), [12]);

  const r = run(["commit-message", path]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /literal \\n\\n paragraph separators/);
});

test("real paragraph breaks pass unchanged", () => {
  const { path } = message("Title\n\nFirst\n\nSecond\n");
  assert.deepEqual(literalParagraphBreaks(readFileSync(path, "utf8")), []);

  const r = run(["commit-message", path]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stderr, "");
});

test("POSITIVE CONTROL: the installed commit-msg hook blocks a literal separator", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-commit-message-hook-"));
  assert.equal(git(dir, "init", "-q", ".").status, 0);
  assert.equal(run(["init", "--dir", "backlog", "--no-example"], dir).status, 0);
  assert.equal(run(["hooks", "install"], dir).status, 0);

  const hooks = hooksTarget(dir, COMMIT_MESSAGE_HOOK_NAME);
  assert.ok(hooks.ok, "the fixture did not resolve Git's commit-msg hook path");
  const hook = readFileSync(hooks.path, "utf8")
    .replace(/^branchling check \|\| exit 1$/m,
      process.execPath + " " + CLI + " check --dir " + join(dir, "backlog") + " || exit 1")
    .replace(/^branchling commit-message "\$1" \|\| exit 1$/m,
      process.execPath + " " + CLI + " commit-message \"$1\" || exit 1");
  writeFileSync(hooks.path, hook, "utf8");
  chmodSync(hooks.path, 0o755);

  writeFileSync(join(dir, "proof.txt"), "x\n", "utf8");
  assert.equal(git(dir, "add", "proof.txt").status, 0);
  const bad = git(dir, "commit", "-m", "Title", "-m", "First\\n\\nSecond");
  assert.notEqual(bad.status, 0, "the literal separator reached history — the hook did not run");
  assert.match(bad.stdout + bad.stderr, /literal \\n\\n paragraph separators/);

  const good = git(dir, "commit", "-m", "Title", "-m", "First", "-m", "Second");
  assert.equal(good.status, 0, good.stdout + good.stderr);
});
