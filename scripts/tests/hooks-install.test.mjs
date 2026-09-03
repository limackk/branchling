/**
 * A gate that installs itself, and the three traps that make it a decision
 * (TL-46).
 *
 * The guards already ship with every installation; what had no answer is WHEN
 * they run. Writing into a stranger's `.git/` is not a given, and each of these
 * has already caught somebody:
 *
 *   1. OVERWRITING SOMEONE ELSE'S HOOK. Repositories carry their own
 *      `pre-commit` — husky, lefthook, pre-commit.com — and forcing our way in
 *      erases a gate they were relying on.
 *   2. `core.hooksPath` ALREADY SET, or a WORKTREE. Then `.git/hooks/` is not
 *      what git reads, and a file written there does not work AND does not say
 *      so. The worst of the three, because the user believes they have a gate.
 *   3. NO WAY BACK. An install with no uninstall is one somebody removes by
 *      hand, learning distrust on the way.
 *
 * THE POSITIVE CONTROL IS THE LAST TEST and it is the only one that proves
 * anything about the GATE rather than about a file: with the hook installed, a
 * commit carrying a real defect must fail. Without it, every assertion here is
 * satisfied by a command that writes a file nobody runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOOK_NAME, hookBlock, hooksTarget, withoutBlock } from "../hooks-command.mjs";
import { BLOCK_OPEN } from "../git-rules.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("hooks-install");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}
function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
}

/** A git repository with a backlog in it. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-hooks-"));
  assert.equal(git(dir, "init", "-q", ".").status, 0);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  return dir;
}

const hookPath = (dir) => hooksTarget(dir).path;

// ── print writes nothing ──────────────────────────────────────────────────

test("print shows the block and writes nothing", () => {
  const dir = repo();
  const r = run(dir, ["hooks", "print"]);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(BLOCK_OPEN));
  assert.ok(r.stdout.includes("check || exit 1"));
  assert.equal(existsSync(hookPath(dir)), false, "print must not touch anybody's .git/");
  assert.match(r.stdout, /Nothing was written/);
});

test("print works outside a repository and says why, instead of a stack trace", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-hooks-bare-"));
  const r = run(dir, ["hooks", "print"]);
  assert.equal(r.status, 0, "print has something to say even with no repository");
  assert.match(r.stdout, /not a git repository/);
});

test("install outside a repository is a readable refusal, not a crash", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-hooks-bare2-"));
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a git repository/);
  assert.equal(/at .*\.mjs:\d+/.test(r.stderr), false, "a stack trace is not an error message");
});

// ── an existing hook is never overwritten ─────────────────────────────────

test("an existing pre-commit is REFUSED and left byte for byte", () => {
  const dir = repo();
  const path = hookPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  const theirs = "#!/bin/sh\n# husky\nnpm test\n";
  writeFileSync(path, theirs, "utf8");

  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(path, "utf8"), theirs, "somebody else's gate was modified");
  assert.match(r.stderr, /already a pre-commit hook/);
  assert.ok(r.stderr.includes(BLOCK_OPEN), "refusing without printing the block leaves the user stuck");
});

test("uninstall refuses to touch a hook that is not ours", () => {
  const dir = repo();
  const path = hookPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/bin/sh\nnpm test\n", "utf8");
  const r = run(dir, ["hooks", "uninstall"]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(path, "utf8"), "#!/bin/sh\nnpm test\n");
});

// ── the path comes from git ───────────────────────────────────────────────

test("core.hooksPath is honoured — nothing is written where git does not look", () => {
  const dir = repo();
  const elsewhere = join(dir, "my-hooks");
  mkdirSync(elsewhere, { recursive: true });
  assert.equal(git(dir, "config", "core.hooksPath", "my-hooks").status, 0);

  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(elsewhere, HOOK_NAME)), "the hook went somewhere git never reads");
  assert.equal(existsSync(join(dir, ".git", "hooks", HOOK_NAME)), false,
    "writing to .git/hooks/ with core.hooksPath set is the trap: it looks installed and never runs");
  assert.match(r.stdout, /core\.hooksPath/, "the user has to be told whose directory this is");
});

test("inside a worktree the hook goes to the COMMON directory git actually reads", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "x\n", "utf8");
  git(dir, "add", "-A");
  assert.equal(git(dir, "commit", "-qm", "base").status, 0);
  const tree = join(dir, "..", "branchling-hooks-wt-" + Date.now());
  assert.equal(git(dir, "worktree", "add", "-q", "-b", "side", tree).status, 0);

  const target = hooksTarget(tree);
  assert.ok(target.ok);
  // `realpathSync` on both sides: on macOS the temporary directory is reached
  // through a symlink, and git answers with the resolved path.
  assert.equal(realpathSync(target.dir), realpathSync(join(dir, ".git", "hooks")),
    "a hook under .git/worktrees/<name>/hooks is never run — that is trap 2 from another direction");
});

// ── uninstall restores the previous state ─────────────────────────────────

test("install then uninstall leaves no file behind", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  assert.equal(existsSync(hookPath(dir)), true);
  const r = run(dir, ["hooks", "uninstall"]);
  assert.equal(r.status, 0);
  assert.equal(existsSync(hookPath(dir)), false,
    "an empty executable pre-commit is a gate that always passes");
});

test("uninstall leaves the REST of a shared file byte for byte", () => {
  const before = "#!/bin/sh\n# theirs, above\nnpm test\n";
  const merged = before + hookBlock() + "\n# theirs, below\n";
  const stripped = withoutBlock(merged);
  assert.equal(stripped.removed, true);
  assert.equal(stripped.text, before + "# theirs, below\n");
});

test("installing twice is idempotent and says so", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  const bytes = readFileSync(hookPath(dir), "utf8");
  const again = run(dir, ["hooks", "install"]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /already installed/);
  assert.equal(readFileSync(hookPath(dir), "utf8"), bytes);
});

test("uninstalling what was never installed is an answer, not an error", () => {
  const dir = repo();
  const r = run(dir, ["hooks", "uninstall"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing installed here/);
});

// ── usage ─────────────────────────────────────────────────────────────────

test("an unknown subcommand and an unknown flag are both usage errors", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "frobnicate"]).status, 2);
  assert.equal(run(dir, ["hooks"]).status, 2);
  assert.equal(run(dir, ["hooks", "print", "--nonsense"]).status, 2);
});

// ── THE POSITIVE CONTROL ──────────────────────────────────────────────────

test("POSITIVE CONTROL: with the hook installed, a commit with a real defect FAILS", () => {
  // Every test above is satisfied by a command that writes a file nobody runs.
  // This is the only one that exercises the GATE: two tasks given the same id,
  // which `check --id-collisions` is exactly for.
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);

  // The hook calls the installed binary by name, which does not exist in a
  // test; point it at this checkout instead. The BLOCK is what is being tested,
  // not how a shell finds the command.
  const path = hookPath(dir);
  writeFileSync(path, readFileSync(path, "utf8")
    .replace(/^branchling check \|\| exit 1$/m,
      process.execPath + " " + CLI + " check --id-collisions --dir " + join(dir, "backlog") + " || exit 1"), "utf8");
  chmodSync(path, 0o755);

  // `TASK-`, because that is the prefix a fresh `init` writes into config.yaml.
  // Ids under any other prefix are not tasks to this backlog, and the guard
  // would pass over them — proving nothing.
  writeFileSync(join(dir, "backlog", "tasks", "TASK-1-first.md"),
    "---\nid: TASK-1\ntitle: \"First\"\nstatus: pending\n---\n", "utf8");
  writeFileSync(join(dir, "backlog", "tasks", "TASK-1-second.md"),
    "---\nid: TASK-1\ntitle: \"Second\"\nstatus: pending\n---\n", "utf8");
  git(dir, "add", "-A");
  const commit = git(dir, "commit", "-m", "two tasks with one id");
  assert.notEqual(commit.status, 0,
    "the commit went through — the hook was written but the gate does not run:\n" + commit.stdout + commit.stderr);
  assert.match(commit.stdout + commit.stderr, /TASK-1/);
});
