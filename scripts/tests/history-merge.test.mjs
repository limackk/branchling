/**
 * Merging the history log (BL-1404, step 2).
 *
 * WHY this file separately: the assertion "`.gitattributes` contains merge=union" is
 * worthless — it checks that we wrote the rule, not that git applies it.
 * gitattributes patterns have non-obvious matching rules (a slash in the middle
 * changes the scope), so the only proof is a REAL merge of two branches.
 *
 * The test builds a temporary repository, puts OUR own
 * `backlog/.gitattributes` into it (not a copy of the rule retyped in the test —
 * that would be measuring itself) and merges two branches appending to one log.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { BACKLOG_DIR } from "./_repo.mjs";

const ATTRIBUTES = join(BACKLOG_DIR, ".gitattributes");
const LOG_REL = join("backlog", "history", "BL-900.jsonl");

function vcs(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function line(id, to) {
  return (
    JSON.stringify({
      id,
      ts: "2026-08-29T10:00:00.000Z",
      task: "BL-900",
      field: "status",
      from: "pending",
      to,
      actor: "claude",
      source: "hook",
    }) + "\n"
  );
}

const ID_BASE = "01J000000000000000000000BA";
const ID_LEFT = "01J000000000000000000000LE";
const ID_RIGHT = "01J000000000000000000000RI";

/**
 * A repository with two branches appending at the end of the same log.
 * `withRule` decides whether our attributes file goes in — that is the only
 * difference between the test proper and the positive control.
 */
function twoBranchesAppending(root, withRule) {
  const log = join(root, LOG_REL);
  vcs(root, "init", "-q", "-b", "main");
  mkdirSync(dirname(log), { recursive: true });
  if (withRule) {
    writeFileSync(join(root, "backlog", ".gitattributes"), readFileSync(ATTRIBUTES, "utf8"), "utf8");
  }
  writeFileSync(log, line(ID_BASE, "in_progress"), "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "base");

  vcs(root, "checkout", "-q", "-b", "left");
  appendFileSync(log, line(ID_LEFT, "blocked"), "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "left");

  vcs(root, "checkout", "-q", "main");
  vcs(root, "checkout", "-q", "-b", "right");
  appendFileSync(log, line(ID_RIGHT, "done"), "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "right");
  return log;
}

test("the backlog's .gitattributes exists and lives IN the backlog directory", () => {
  // In the backlog directory, not in the repository root: gitattributes works per
  // directory, so the rule travels with the backlog into another repository.
  assert.ok(existsSync(ATTRIBUTES), "expecting a .gitattributes in " + BACKLOG_DIR);
  // A positive control: the mere presence of the file does not mean it carries
  // this rule. (That git APPLIES it is proved only by the test below — a real merge.)
  assert.match(readFileSync(ATTRIBUTES, "utf8"), /history\/\*\.jsonl\s+merge=union/,
    ".gitattributes is there, but with no merge=union rule for the history log");
});

test("a REAL merge: two branches appending to the same log do not conflict", () => {
  const root = mkdtempSync(join(tmpdir(), "worktrail-merge-"));
  try {
    const log = twoBranchesAppending(root, true);
    vcs(root, "merge", "-q", "--no-edit", "left");
    const text = readFileSync(log, "utf8");
    assert.ok(!text.includes("<<<<<<<"), "the merge was not meant to leave conflict markers");
    for (const id of [ID_BASE, ID_LEFT, ID_RIGHT]) {
      assert.ok(text.includes(id), "the entry " + id + " was meant to survive the merge");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("positive control: WITHOUT .gitattributes the same merge CONFLICTS", () => {
  // Without this test the green result above could mean "git would have merged it
  // anyway", that is, zero evidential force for the rule.
  const root = mkdtempSync(join(tmpdir(), "worktrail-merge-ctl-"));
  try {
    const log = twoBranchesAppending(root, false);
    assert.throws(() => vcs(root, "merge", "-q", "--no-edit", "left"), /./, "without the rule the merge MUST conflict");
    assert.ok(readFileSync(log, "utf8").includes("<<<<<<<"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
