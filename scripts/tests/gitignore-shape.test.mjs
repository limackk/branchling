/**
 * The repository ignore rule covers BOTH dependency layouts used by a checkout
 * (TL-415): an ordinary directory and a symlink into another worktree.
 *
 * Git's trailing slash is semantic, not cosmetic: `node_modules/` matches only
 * a directory. A linked worktree therefore reported its dependency symlink as
 * untracked even though the same path was quiet in the main checkout. These
 * tests ask git in throwaway repositories instead of interpreting the pattern
 * ourselves, and the positive control proves the old rule exposes the defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("gitignore-shape");

function fixture(ignore) {
  const outer = mkdtempSync(join(tmpdir(), "branchling-node-modules-ignore-"));
  const root = join(outer, "repo");
  mkdirSync(root);
  writeFileSync(join(root, ".gitignore"), ignore, "utf8");
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["add", ".gitignore"], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return { outer, root };
}

function status(root) {
  return execFileSync("git", ["status", "--short"], {
    cwd: root,
    encoding: "utf8",
  });
}

function ignored(root, path) {
  return spawnSync("git", ["check-ignore", "-q", "--", path], {
    cwd: root,
  }).status === 0;
}

test("positive control: the old directory-only rule exposes a dependency symlink", () => {
  const { outer, root } = fixture("node_modules/\n");
  try {
    mkdirSync(join(outer, "dependencies"));
    symlinkSync("../dependencies", join(root, "node_modules"), "dir");

    assert.equal(ignored(root, "node_modules"), false);
    assert.equal(status(root), "?? node_modules\n");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("this repository's rule ignores a dependency symlink", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  const { outer, root } = fixture(ignore);
  try {
    mkdirSync(join(outer, "dependencies"));
    symlinkSync("../dependencies", join(root, "node_modules"), "dir");

    assert.equal(ignored(root, "node_modules"), true);
    assert.equal(status(root), "");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("this repository's rule still ignores an ordinary dependency directory", () => {
  const ignore = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8");
  const { outer, root } = fixture(ignore);
  try {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "probe.js"), "", "utf8");

    assert.equal(ignored(root, "node_modules/probe.js"), true);
    assert.equal(status(root), "");
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});
