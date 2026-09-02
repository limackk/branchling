/**
 * Whose tree does a guard judge? (TL-163)
 *
 * THE DEFECT, REPRODUCED RATHER THAN INFERRED. `check --language` and
 * `check --product-name` read THIS INSTALLATION's source — they take no `--dir`
 * and the guard table says why. What was never drawn from that is the
 * consequence: pointed at somebody else's backlog they still ran, so the
 * verdict of `check --dir <anywhere>` depended on what the TOOL's checkout
 * happened to contain at that moment.
 *
 * The measurement, on 2026-09-02: with one unrelated file holding a Polish
 * sentence sitting in this repository's `scripts/`, `doctor --dir <a fresh
 * fixture>` exited 1 — and exited 0 again the moment the file was removed.
 * Dozens of tests spawn `check` or `doctor` against a temporary fixture, so
 * every one of them was re-reading the developer's working tree. A suite run
 * during an edit and one run after it were measuring different trees, which is
 * exactly the intermittent red TL-163 was opened for. "Parallel load" was a
 * red herring: 144 concurrent `doctor` runs against one fixture never failed.
 *
 * WHAT THIS FILE PINS DOWN: the scope rule itself, and the fact that a guard
 * which does not run SAYS SO. A skipped guard reported as silence is the same
 * class of defect as a zero-result typo — it reads exactly like a pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { insideInstallation } from "../cli.mjs";
import { REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-guard-scope-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  return dir;
}

// ── the rule ──────────────────────────────────────────────────────────────

test("a backlog inside this checkout belongs to it; one in a temp directory does not", () => {
  assert.equal(insideInstallation(join(REPO_ROOT, "backlog")), true);
  // The co-located layout: the root IS the backlog. A rule that only knew the
  // nested one would switch both guards off for every co-located consumer.
  assert.equal(insideInstallation(REPO_ROOT), true);
  assert.equal(insideInstallation(mkdtempSync(join(tmpdir(), "elsewhere-"))), false);
  // A sibling whose path merely STARTS with the root's is not inside it.
  assert.equal(insideInstallation(REPO_ROOT + "-other"), false);
});

// ── the effect ────────────────────────────────────────────────────────────

test("pointed at another backlog, the two installation guards do not run — and say so", () => {
  const r = run(["check", "--dir", fixture(), "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(r.stdout);
  for (const name of ["language", "product-name"]) {
    const guard = doc.guards.find((g) => g.name === name);
    assert.ok(guard, name + " is not in the run at all");
    assert.equal(guard.skipped, true, name + " ran against a backlog it does not judge");
    assert.match(guard.output, /not run/);
  }
  assert.deepEqual(doc.failed, []);
});

test("POSITIVE CONTROL: run against its own backlog, both guards really run", () => {
  // Without this the assertion above would be satisfied by a build in which the
  // two guards never run at all — which is the failure mode it exists to
  // prevent, not a version of passing.
  const r = run(["check", "--dir", join(REPO_ROOT, "backlog"), "--json"]);
  const doc = JSON.parse(r.stdout);
  for (const name of ["language", "product-name"]) {
    const guard = doc.guards.find((g) => g.name === name);
    assert.notEqual(guard.skipped, true, name + " was skipped for this repository's OWN backlog");
    assert.match(guard.output, /lines across/, name + " produced no reading of its own");
  }
});

test("the skip is visible in the plain output too, not only in the JSON", () => {
  const r = run(["check", "--dir", fixture()]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /language: not run/);
  assert.match(r.stdout, /product-name: not run/);
});

test("a fixture's doctor is unaffected by this repository's own source", () => {
  // The end-to-end statement: this is the call the flaky tests were making.
  const r = run(["doctor", "--dir", fixture()]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /backlog guards/);
});
