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
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMIT_MESSAGE_HOOK_NAME, HOOK_NAME, hookBlock, hooksTarget, inspect, installedBlock, replaceBlock, unclosedBlockLines, unclosedSpan, withoutBlock } from "../hooks-command.mjs";
import { BLOCK_OPEN } from "../git-rules.mjs";
import { isolateHome, plainOutput, posixPath } from "./_repo.mjs";
import { followRepair } from "./_follow-repair.mjs";
import { canonicalPath } from "../canonical-path.mjs";

isolateHome("hooks-install");
// The assertions read the rendered lines, so the colour decision is taken out
// of the environment the suite happened to start in.
plainOutput();

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}
function git(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });
}

/** A git repository with a backlog in it. */
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-hooks-"));
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
  const dir = fixtureDir(join(tmpdir(), "branchling-hooks-bare-"));
  const r = run(dir, ["hooks", "print"]);
  assert.equal(r.status, 0, "print has something to say even with no repository");
  assert.match(r.stdout, /not a git repository/);
});

test("install outside a repository is a readable refusal, not a crash", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-hooks-bare2-"));
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
  assert.match(r.stderr, /→ branchling hooks print$/m);
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

test("a core.hooksPath that does not exist yet is created, nested directories included", () => {
  const dir = repo();
  assert.equal(git(dir, "config", "core.hooksPath", "nested/hooks").status, 0);
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(join(dir, "nested", "hooks", HOOK_NAME)));
});

test("inside a worktree the hook goes to the COMMON directory git actually reads", () => {
  const dir = repo();
  writeFileSync(join(dir, "a.txt"), "x\n", "utf8");
  git(dir, "add", "-A");
  assert.equal(git(dir, "commit", "-qm", "base").status, 0);
  // Inside a fixture of its own: a sibling of `dir` named by hand is a
  // directory nothing removes (TL-575).
  const tree = join(fixtureDir(join(tmpdir(), "branchling-hooks-wt-")), "tree");
  assert.equal(git(dir, "worktree", "add", "-q", "-b", "side", tree).status, 0);

  const target = hooksTarget(tree);
  assert.ok(target.ok);
  // `canonicalPath` on both sides: on macOS the temporary directory is reached
  // through a symlink, on Windows through an 8.3 short name, and git answers
  // with the resolved path.
  assert.equal(canonicalPath(target.dir), canonicalPath(join(dir, ".git", "hooks")),
    "a hook under .git/worktrees/<name>/hooks is never run — that is trap 2 from another direction");
});

// ── uninstall restores the previous state ─────────────────────────────────

test("a first install writes executable hooks and says what it installed", () => {
  const dir = repo();
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\S+ pre-commit installed — /m);
  assert.match(r.stdout, /^\S+ commit-msg installed — /m);
  assert.ok(r.stdout.includes("\n  `branchling hooks uninstall` removes exactly these lines."));
  if (process.platform !== "win32") {
    assert.notEqual(statSync(hookPath(dir)).mode & 0o111, 0, "a hook git cannot execute is no gate");
  }
  const again = fixtureDir(join(tmpdir(), "branchling-hooks-json-"));
  assert.equal(git(again, "init", "-q", ".").status, 0);
  const json = JSON.parse(run(again, ["hooks", "install", "--json"]).stdout);
  assert.equal(json.installed, true);
  assert.deepEqual(json.hooks.map((h) => [h.hook, h.installed, h.updated]),
    [["pre-commit", true, false], ["commit-msg", true, false]]);
});

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
  assert.deepEqual(withoutBlock(before), { text: before, removed: false });
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

// ── a stale block of our own is replaced (TL-588) ─────────────────────────

test("inspect says whether our block is the one this release writes", () => {
  const dir = repo();
  const target = hooksTarget(dir);
  assert.deepEqual(inspect(target), { state: "absent", text: null });
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  assert.deepEqual([inspect(target).state, inspect(target).current], ["ours", true]);
  writeFileSync(target.path, readFileSync(target.path, "utf8").replace("check || exit 1", "check --old || exit 1"), "utf8");
  assert.deepEqual([inspect(target).state, inspect(target).current], ["ours", false]);
  // Each hook is compared with ITS OWN block: the pre-commit text in commit-msg is stale.
  const msg = hooksTarget(dir, COMMIT_MESSAGE_HOOK_NAME);
  assert.equal(inspect(msg).current, true);
  writeFileSync(msg.path, "#!/bin/sh\n" + hookBlock(HOOK_NAME) + "\n", "utf8");
  assert.equal(inspect(msg).current, false);
});

test("inspect says whether our block closes, which is whether install can replace it (TL-600)", () => {
  const dir = repo();
  const target = hooksTarget(dir);
  assert.equal(inspect(target).closed, undefined, "an absent hook has no block to close");
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  assert.deepEqual([inspect(target).current, inspect(target).closed], [true, true]);
  writeFileSync(target.path, readFileSync(target.path, "utf8").replace("check || exit 1", "check --old || exit 1"), "utf8");
  assert.deepEqual([inspect(target).current, inspect(target).closed], [false, true], "stale but closed: install replaces it");
  writeFileSync(target.path, "#!/bin/sh\n" + hookBlock().split("\n").slice(0, -1).join("\n") + "\nnpm test\n", "utf8");
  assert.deepEqual([inspect(target).state, inspect(target).current, inspect(target).closed], ["ours", false, false]);
  assert.equal(run(dir, ["hooks", "install"]).status, 1, "the premise: what is not closed, install refuses");
});

test("installedBlock reads an indented or CRLF block as the text it carries", () => {
  const block = hookBlock();
  assert.equal(installedBlock("#!/bin/sh\n" + block + "\n"), block);
  assert.equal(installedBlock(block), block, "a block on the first line is still a block");
  assert.equal(installedBlock("x\r\n" + block.split("\n").map((l) => "  " + l).join("\r\n") + "\r\ny\r\n"), block);
  assert.equal(installedBlock("#!/bin/sh\n" + block.split("\n").slice(0, -1).join("\n") + "\n"), null,
    "an opening marker with no closing one is no block");
  assert.equal(installedBlock("#!/bin/sh\nnpm test\n"), null);
});

test("replaceBlock swaps only the lines between the markers", () => {
  const old = hookBlock().replace("check || exit 1", "check --old || exit 1");
  const above = "#!/bin/sh\n# theirs, above\nnpm test\n";
  const below = "\n# theirs, below\n";
  const r = replaceBlock(above + old + below, hookBlock());
  assert.equal(r.replaced, true);
  assert.equal(r.text, above + hookBlock() + below);
  const unclosed = above + old.split("\n").slice(0, -1).join("\n") + below;
  assert.deepEqual(replaceBlock(unclosed, hookBlock()), { text: unclosed, replaced: false });
  assert.deepEqual(replaceBlock(above, hookBlock()), { text: above, replaced: false });
});

// A stale block keeps the shape it was pasted in (TL-601). `installedBlock`
// recognises an indented or CRLF block, so writing its successor flush-left
// with LF would leave mixed endings in a CRLF file.
const STALE = hookBlock().replace("check || exit 1", "check --old || exit 1");
const shaped = (block, indent, eol) => block.split("\n").map((l) => indent + l).join(eol);

test("replaceBlock writes a CRLF block back in CRLF, the rest byte for byte", () => {
  const above = "#!/bin/sh\r\n# theirs, above\r\nnpm test\r\n";
  const below = "\r\n# theirs, below\r\n";
  const r = replaceBlock(above + shaped(STALE, "", "\r\n") + below, hookBlock());
  assert.equal(r.replaced, true);
  assert.equal(r.text, above + shaped(hookBlock(), "", "\r\n") + below);
  assert.equal(/[^\r]\n/.test(r.text), false, "a lone LF in a CRLF file is a mixed ending");
  assert.equal(installedBlock(r.text), hookBlock(), "the replacement is read back as current");
});

test("replaceBlock keeps the indentation of the opening marker, the rest byte for byte", () => {
  const above = "#!/bin/sh\nif true; then\n";
  const below = "\nfi\n";
  for (const indent of ["  ", "\t", " \t "]) {
    const r = replaceBlock(above + shaped(STALE, indent, "\n") + below, hookBlock());
    assert.equal(r.text, above + shaped(hookBlock(), indent, "\n") + below, JSON.stringify(indent));
  }
  // Both at once, and an LF block stays LF: the CR is read, not assumed.
  const both = replaceBlock("x\r\n" + shaped(STALE, "    ", "\r\n") + "\r\ny\r\n", hookBlock());
  assert.equal(both.text, "x\r\n" + shaped(hookBlock(), "    ", "\r\n") + "\r\ny\r\n");
  assert.equal(replaceBlock("x\n" + STALE + "\ny\n", hookBlock()).text, "x\n" + hookBlock() + "\ny\n");
});

test("replaceBlock gives the closing marker its own ending, so a file with no final newline gains no byte", () => {
  // The last line of a file has no CR to keep; giving it the opening marker's
  // would add a byte after the block.
  const above = "#!/bin/sh\r\n";
  assert.equal(replaceBlock(above + shaped(STALE, "  ", "\r\n"), hookBlock()).text,
    above + shaped(hookBlock(), "  ", "\r\n"));
});

test("install rewrites a stale CRLF, indented block in its own shape and is then current", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  const path = hookPath(dir);
  const above = "#!/bin/sh\r\nif true; then\r\n";
  const below = "\r\nfi\r\n";
  writeFileSync(path, above + shaped(STALE, "  ", "\r\n") + below, "utf8");

  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\S+ pre-commit updated — /m);
  const after = readFileSync(path, "utf8");
  assert.equal(after, above + shaped(hookBlock(), "  ", "\r\n") + below);
  const again = run(dir, ["hooks", "install"]);
  assert.match(again.stdout, /already installed — .*pre-commit/);
  assert.equal(readFileSync(path, "utf8"), after);
});

test("install replaces a stale block of its own and leaves the rest of the file byte for byte", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  const path = hookPath(dir);
  const above = "#!/bin/sh\n# theirs, above\nnpm test\n";
  const below = "\n# theirs, below\n";
  writeFileSync(path, above + hookBlock().replace("check || exit 1", "check --old || exit 1") + below, "utf8");
  const msgPath = hooksTarget(dir, COMMIT_MESSAGE_HOOK_NAME).path;
  const msgBytes = readFileSync(msgPath, "utf8");

  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path, "utf8"), above + hookBlock() + below);
  assert.equal(readFileSync(msgPath, "utf8"), msgBytes, "a current block is not rewritten");
  assert.match(r.stdout, /^\S+ pre-commit updated — /m);
  assert.match(r.stdout, /already installed — .*commit-msg/);

  writeFileSync(path, above + hookBlock().replace("check || exit 1", "check --old || exit 1") + below, "utf8");
  const json = JSON.parse(run(dir, ["hooks", "install", "--json"]).stdout);
  assert.deepEqual(json.hooks.map((h) => [h.hook, h.installed, h.updated]),
    [["pre-commit", false, true], ["commit-msg", false, false]]);
});

test("install refuses a block that never closes, and touches nothing", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  const path = hookPath(dir);
  const broken = "#!/bin/sh\n" + hookBlock().split("\n").slice(0, -1).join("\n") + "\nnpm test\n";
  writeFileSync(path, broken, "utf8");
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /branchling hooks install: the pre-commit hook opens our block and never closes it/);
  assert.ok(r.stderr.includes("It was not touched. Put this in place of lines 2–5 (`" + BLOCK_OPEN +
    "` through its gate line); the lines after it are yours and stay:"), r.stderr);
  assert.match(r.stderr, /→ branchling hooks print$/m);
  for (const line of hookBlock().split("\n")) {
    assert.ok(r.stderr.includes(line), "refusing without the block leaves the user stuck: " + line);
  }
  assert.equal(readFileSync(path, "utf8"), broken);
});

/** The opening marker quoted inside a line of the user's, not standing on one. */
const QUOTED_MARKER = "#!/bin/sh\necho \"" + BLOCK_OPEN + "\"\nnpm test\n";

test("a marker quoted inside a line is not our block: install refuses it as foreign and touches nothing", () => {
  const dir = repo();
  const path = hookPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, QUOTED_MARKER, "utf8");
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /, "a refusal, not a stack trace");
  assert.match(r.stderr, /branchling hooks install: there is already a pre-commit hook here/);
  assert.equal(readFileSync(path, "utf8"), QUOTED_MARKER);
  assert.equal(inspect(hooksTarget(dir)).state, "foreign", "ownership is read from a marker LINE, as the block is");

  const u = run(dir, ["hooks", "uninstall"]);
  assert.equal(u.status, 1, "uninstall must not report removing a block that was never there");
  assert.match(u.stderr, /the pre-commit hook here is not ours/);
  assert.equal(readFileSync(path, "utf8"), QUOTED_MARKER);

  // Positive control: the marker standing on a line of its own, even the
  // first line of the file, is ours.
  writeFileSync(path, hookBlock().split("\n").slice(0, -1).join("\n") + "\nnpm test\n", "utf8");
  assert.equal(inspect(hooksTarget(dir)).state, "ours");
});

test("following the repair for an unclosed block keeps the user's lines after it (TL-609)", () => {
  const dir = repo();
  assert.equal(run(dir, ["hooks", "install"]).status, 0);
  const path = hookPath(dir);
  const theirs = "\n# theirs, after the block\nnpm test || exit 1\n./scripts/lint.sh\n";
  const broken = "#!/bin/sh\nnpm run pre\n" + STALE.split("\n").slice(0, -1).join("\n") + theirs;
  writeFileSync(path, broken, "utf8");
  const r = run(dir, ["hooks", "install"]);
  assert.equal(r.status, 1, "the premise: install refuses an unclosed block");
  assert.equal(readFileSync(path, "utf8"), broken);

  writeFileSync(path, followRepair(broken, r.stderr, hookBlock()), "utf8");
  const repaired = readFileSync(path, "utf8");
  assert.equal(repaired, "#!/bin/sh\nnpm run pre\n" + hookBlock() + theirs,
    "every line of the user's, before and after the block, survives the repair");
  assert.equal(inspect(hooksTarget(dir)).current, true, "the repaired block is the current one");
  assert.equal(run(dir, ["hooks", "install"]).status, 0, "once repaired, install no longer refuses");
});

test("the unclosed span stops at the gate, and short of a line it does not recognise", () => {
  const open = hookBlock().split("\n").slice(0, -1);
  assert.deepEqual(unclosedBlockLines("#!/bin/sh\n" + open.join("\n") + "\nnpm test\n"), { first: 2, last: 5, gate: true });
  assert.deepEqual(unclosedBlockLines(["  " + open[0], ...open.slice(1, 3), "npm test"].join("\r\n")),
    { first: 1, last: 3, gate: false }, "no gate: the span ends at the last comment, never on the user's line");
  assert.deepEqual(unclosedBlockLines(open[0] + "\nnpm test"), { first: 1, last: 1, gate: false });
  assert.deepEqual(unclosedBlockLines(open.map((l) => "  " + l).join("\r\n") + "\r\nnpm test\r\n"),
    { first: 1, last: 4, gate: true }, "an indented CRLF paste is read by trimmed line, its gate included");
  assert.deepEqual(unclosedBlockLines(open.slice(0, 3).join("\n")), { first: 1, last: 3, gate: false },
    "comments running to the end of the file end the span there");
  assert.deepEqual(unclosedBlockLines(open.slice(0, 3).join("\n") + "\nnpm test || exit 1 # theirs\n"),
    { first: 1, last: 3, gate: false }, "a line that only CONTAINS `|| exit 1` is not the gate");
  assert.equal(unclosedBlockLines(hookBlock()), null, "a closed block is not unclosed");
  assert.equal(unclosedBlockLines("#!/bin/sh\nnpm test\n"), null);
  assert.equal(unclosedSpan({ first: 2, last: 5, gate: true }), "lines 2–5 (`" + BLOCK_OPEN + "` through its gate line)");
  assert.equal(unclosedSpan({ first: 1, last: 3, gate: false }), "lines 1–3 (`" + BLOCK_OPEN + "` and the comments under it)");
  assert.equal(unclosedSpan({ first: 4, last: 4, gate: false }), "line 4 (`" + BLOCK_OPEN + "`)");
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
      [process.execPath, CLI].map(posixPath).join(" ") + " check --id-collisions --dir " +
        posixPath(join(dir, "backlog")) + " || exit 1"), "utf8");
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
