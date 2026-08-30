/**
 * The generated views are not versioned (BL-1404 step 3).
 *
 * Zmierzona przyczyna: INDEX.yaml i archive/done.yaml to posortowane agregaty
 * of EVERY task, so each branch rewrites the same file. `git merge-tree` on two
 * branches that shared no task at all produced a conflict in INDEX.yaml, and most
 * commits touching tasks/ touched the views as well.
 *
 * Two assertions of different force — both are needed:
 *   1. the mechanism — a temporary repository shows that the aggregate CONFLICTS
 *      when it is tracked, and stops when it is not (a positive control);
 *   2. the state of this repo — the views are ignored AND untracked. `ignored`
 *      alone is not enough: a file once added to the index stays tracked despite
 *      an entry in .gitignore, and that is exactly the state that produced conflicts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { BACKLOG_DIR } from "./_repo.mjs";

const VIEWS = [
  "INDEX.yaml",
  "NOW.yaml",
  "archive/done.yaml",
  "boards/main/INDEX.yaml",
  "boards/main/NOW.yaml",
];

function vcs(cwd, ...args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** An aggregate sorted by id — the shape INDEX.yaml has. */
function aggregate(ids) {
  return ids.slice().sort().map((id) => "  - {id: " + id + ", status: pending}\n").join("");
}

/**
 * Two branches adding DIFFERENT tasks. `trackView` decides whether the aggregate
 * goes into the repository — that is the only difference between the control and
 * the test proper.
 */
function twoBranchesAddingDifferentTasks(root, trackView) {
  vcs(root, "init", "-q", "-b", "main");
  mkdirSync(join(root, "tasks"), { recursive: true });
  const view = join(root, "INDEX.yaml");
  writeFileSync(join(root, "tasks", "BL-1.md"), "id: BL-1\n", "utf8");
  if (trackView) writeFileSync(view, aggregate(["BL-1"]), "utf8");
  else writeFileSync(join(root, ".gitignore"), "INDEX.yaml\n", "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "base");

  vcs(root, "checkout", "-q", "-b", "left");
  writeFileSync(join(root, "tasks", "BL-2.md"), "id: BL-2\n", "utf8");
  if (trackView) writeFileSync(view, aggregate(["BL-1", "BL-2"]), "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "left");

  vcs(root, "checkout", "-q", "main");
  vcs(root, "checkout", "-q", "-b", "right");
  writeFileSync(join(root, "tasks", "BL-3.md"), "id: BL-3\n", "utf8");
  if (trackView) writeFileSync(view, aggregate(["BL-1", "BL-3"]), "utf8");
  vcs(root, "add", "-A");
  vcs(root, "commit", "-qm", "right");
}

/**
 * `merge-tree --write-tree` signals a conflict by its EXIT CODE (1), not by the
 * content — and the messages are translated, so a grep for the word "CONFLICT"
 * would stay silent under a non-English locale. We read the status.
 */
function mergeConflicts(root) {
  try {
    vcs(root, "merge-tree", "--write-tree", "left", "right");
    return false;
  } catch (e) {
    if (e.status === 1) return true;
    throw e;
  }
}

test("positive control: a VERSIONED aggregate conflicts despite disjoint tasks", () => {
  const root = mkdtempSync(join(tmpdir(), "worktrail-views-ctl-"));
  try {
    twoBranchesAddingDifferentTasks(root, true);
    assert.equal(mergeConflicts(root), true, "without this conflict the whole of step 3 would have nothing to fix");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an aggregate outside git: the same two branches merge cleanly", () => {
  const root = mkdtempSync(join(tmpdir(), "worktrail-views-"));
  try {
    twoBranchesAddingDifferentTasks(root, false);
    assert.equal(mergeConflicts(root), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("in THIS repository the views are ignored and untracked", () => {
  for (const rel of VIEWS) {
    // ignorowany…
    const ignored = execFileSync("git", ["check-ignore", rel], {
      cwd: BACKLOG_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    assert.equal(ignored, rel, rel + " has to be covered by .gitignore");
    // …AND untracked. A file once added to the index is not subject to ignoring.
    const tracked = execFileSync("git", ["ls-files", "--", rel], {
      cwd: BACKLOG_DIR, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    assert.equal(tracked, "", rel + " is still tracked — .gitignore alone does not help here");
  }
});
