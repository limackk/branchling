/**
 * Two spellings of one directory compare equal, and a missing one still has a
 * spelling (TL-463).
 *
 * The case that motivated it — an 8.3 short name on Windows — cannot be built
 * on a POSIX machine, so this holds the contract on the case every platform
 * has: a symbolic link. The Windows half is measured by the Windows CI job,
 * where `os.tmpdir()` is itself a short name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { canonicalPath } from "../canonical-path.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("canonical-path");

test("a directory and a link to it have one spelling", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-canonical-"));
  try {
    const real = join(dir, "real");
    mkdirSync(real);
    try {
      symlinkSync(real, join(dir, "link"), "junction");
    } catch (e) {
      t.skip("this machine cannot create a link here: " + e.code);
      return;
    }
    assert.equal(canonicalPath(join(dir, "link")), canonicalPath(real));
    assert.equal(canonicalPath(real + "/../real"), canonicalPath(real));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a path that does not exist keeps its resolved spelling instead of failing", () => {
  const missing = join(tmpdir(), "branchling-canonical-missing-" + process.pid, "x");
  assert.equal(canonicalPath(missing), resolve(missing));
});
