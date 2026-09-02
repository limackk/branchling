/**
 * Two branches, two tasks, one aggregate directory — and no conflict (TL-29).
 *
 * WHAT THIS DEFENDS. §5.2 of docs/backlog-time-tracking.md (a real path —
 * product-name: allow) split the measured-time aggregate PER TASK instead of
 * writing one `rollup.json`, and the whole justification for paying that cost is
 * a merge that does not conflict. An assertion that `rollupPath()` contains the
 * task id would only check that we wrote the split — not that git agrees it
 * bought anything.
 *
 * SO IT MERGES FOR REAL, with `git merge-tree`, and it carries its own POSITIVE
 * CONTROL: the same two branches writing one SHARED aggregate file must
 * conflict. Without that half the test would pass just as well against a merge
 * that never notices anything, which is the failure mode a green guard hides
 * best.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { rollupFor } from "../activity-retention.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("rollup-merge");

function vcs(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

/** `git merge-tree` exits non-zero on a conflict and 0 on a clean merge, so the
 *  answer is the exit status rather than anything parsed out of the output. */
function merges(root, left, right) {
  try {
    vcs(root, "merge-tree", "--write-tree", left, right);
    return true;
  } catch {
    return false;
  }
}

function write(root, rel, text) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, "utf8");
}

/**
 * Two branches off one base, each recording measured time for its OWN task.
 * `path` decides where an aggregate goes — that is the only difference between
 * the test and its control.
 */
function twoBranches(root, pathFor) {
  vcs(root, "init", "-q", "-b", "main");
  write(root, pathFor("TL-1", "base"), JSON.stringify({ minutes: 0 }) + "\n");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "base");

  vcs(root, "checkout", "-q", "-b", "left");
  write(root, pathFor("TL-1", "left"), JSON.stringify({ minutes: 42, sessions: 2 }) + "\n");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "left measures TL-1");

  vcs(root, "checkout", "-q", "main");
  vcs(root, "checkout", "-q", "-b", "right");
  write(root, pathFor("TL-2", "right"), JSON.stringify({ minutes: 17, sessions: 1 }) + "\n");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "right measures TL-2");
}

test("aggregates split per task let two branches merge cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "worktrail-rollup-split-"));
  try {
    twoBranches(root, (task) => join("backlog", "activity", "rollup", task + ".json"));
    assert.equal(merges(root, "left", "right"), true,
      "two branches touching different tasks must not conflict — that is the whole reason the aggregate is per task");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: one shared aggregate file conflicts on the same two branches", () => {
  const root = mkdtempSync(join(tmpdir(), "worktrail-rollup-shared-"));
  try {
    twoBranches(root, () => join("backlog", "activity", "rollup.json"));
    assert.equal(merges(root, "left", "right"), false,
      "if this merges, the test above proves nothing: the check cannot see a conflict at all");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the aggregate carries the five fields §9 allows out of the machine, and no sixth", () => {
  const rows = [
    { ts: "2026-09-02T09:00:00.000Z", kind: "tool", session: "s1", attribution: "focus" },
    { ts: "2026-09-02T09:05:00.000Z", kind: "tool", session: "s1", attribution: "focus" },
  ];
  assert.deepEqual(Object.keys(rollupFor(rows)).sort(),
    ["first", "last", "minutes", "sessions", "unknown_ratio"]);
});
