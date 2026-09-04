/**
 * A branch already merged into this HEAD holds no second opinion (TL-235).
 *
 * WHAT WENT WRONG. The scan read every local ref and reported the task at the
 * state that ref committed. A branch merged into `main` still carries the task
 * as it was BEFORE the merge, so the scan called that a disagreement — with
 * nothing. The consequence is not a noisy badge in the viewer, which is how this
 * was first filed: `next` refuses to hand out a candidate that is "in another
 * state on another branch", so on 2026-09-04 a wave holding exactly one open
 * task produced an empty queue, having skipped it over two branches merged that
 * same morning. Refs accumulate; every later run would have been worse.
 *
 * THE POSITIVE CONTROL IS THE UNMERGED BRANCH. A test that only proved silence
 * would pass for a scanner that reports nothing at all, which is the failure
 * mode this whole mechanism exists to avoid.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mergedRefs, scanTaskStates } from "../branch-scan.mjs";
import { isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("elsewhere-merged");
plainOutput();

const TASK_FILE = /^TASK-\d+-.*\.md$/;

function git(cwd, ...args) {
  return execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" });
}

function writeTask(repo, status) {
  const dir = join(repo, "backlog", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "TASK-1-x.md"),
    "---\nid: TASK-1\ntitle: \"x\"\nstatus: " + status + "\nowner: \"\"\n---\n", "utf8");
}

/**
 * A repository whose `main` holds the task as `pending`, plus two branches that
 * moved it to `in_progress`: one merged back, one left alone.
 */
function repository() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-merged-refs-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeTask(repo, "pending");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "seed");

  // The merged branch first, and `main` is put back to `pending` AFTER the
  // merge — so both branches end up holding `in_progress` against a `pending`
  // HEAD, and only ancestry tells the two apart. Branching the second one from
  // the merge commit instead would leave it with nothing to commit.
  git(repo, "checkout", "-q", "-b", "merged-branch");
  writeTask(repo, "in_progress");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "merged-branch");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-edit", "merged-branch");

  writeTask(repo, "pending");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "back to pending");

  git(repo, "checkout", "-q", "-b", "live-branch");
  writeTask(repo, "in_progress");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "live-branch");
  git(repo, "checkout", "-q", "main");

  return { dir, repo };
}

function scan(repo) {
  return scanTaskStates({
    repoRoot: repo, backlogRel: "backlog", taskFile: TASK_FILE, self: repo,
  });
}

test("`mergedRefs` names the merged branch and not the live one", () => {
  const { dir, repo } = repository();
  try {
    const merged = mergedRefs(repo);
    assert.ok(merged.has("refs/heads/merged-branch"),
      "the merged branch was not recognised as merged — full ref names, as `refActivity` uses");
    assert.ok(!merged.has("refs/heads/live-branch"), "a branch that was never merged was called merged");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the scan reports the live branch and stays silent about the merged one", () => {
  const { dir, repo } = repository();
  try {
    const seen = scan(repo);
    const refs = [];
    for (const list of (seen.byId || new Map()).values()) {
      for (const o of list) refs.push(String(o.ref || o.source || ""));
    }
    const named = refs.join(" ");
    // THE POSITIVE CONTROL, first: without it a scanner that saw nothing would
    // pass the assertion below.
    assert.match(named, /live-branch/,
      "the unmerged branch was not reported — this scan sees nothing, so it proves nothing");
    assert.doesNotMatch(named, /merged-branch/,
      "a branch whose commits are ancestors of HEAD was reported as a disagreement");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
