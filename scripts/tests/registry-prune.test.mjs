/**
 * Forgetting the registry entries that are dead — and only those (TL-176).
 *
 * WHY THIS EXISTS AT ALL. Measured on 2026-09-03: 1239 registered projects, 347
 * of them unavailable, nearly all temporary directories left by test runs made
 * before `isolateHome()` covered the registry. The leak is closed; nothing ever
 * cleaned up what it left. The cost that matters is not the length of the list —
 * it is that TL-36's report of a project that REALLY is missing is worth nothing
 * at the bottom of 347 that are not.
 *
 * WHAT EACH GROUP RULES OUT.
 *   1. PRUNING SOMETHING ALIVE. The whole point is a removal nobody has to
 *      check, so a live entry surviving is asserted every time, not implied by
 *      a count.
 *   2. THE TWO DEAD KINDS COLLAPSING INTO ONE. A directory that is GONE can only
 *      be forgotten; one that EXISTS and is no longer a backlog is somebody's
 *      checkout mid-surgery, and forgetting it throws away the only record that
 *      it was ever a project. Default behaviour must differ, or the flag means
 *      nothing.
 *   3. A DRY RUN THAT IS NOT DRY. There is no undo, so `--dry-run` is compared
 *      on the file's BYTES, not on an exit code.
 *   4. A COUNT INSTEAD OF NAMES. What is removed is named, because the entry is
 *      the only record that a directory was ever a project.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_ENV, registryPath } from "../home.mjs";
import { classifyRegistry, readRegistry } from "../registry.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("registry-prune");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(args, home) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: tmpdir(), encoding: "utf8", timeout: 60_000,
    env: { ...process.env, [HOME_ENV]: home },
  });
}

/** A home with three registered projects: one live, one whose directory is
 *  gone, and one that still exists but is no longer a backlog. */
function threeKinds() {
  const home = mkdtempSync(join(tmpdir(), "branchling-prune-home-"));
  const made = {};
  for (const name of ["live", "gone", "hollow"]) {
    const dir = mkdtempSync(join(tmpdir(), "branchling-prune-" + name + "-"));
    assert.equal(run(["init", "--dir", dir, "--no-example"], home).status, 0);
    assert.equal(run(["project", "add", dir, "--name", name], home).status, 0);
    made[name] = dir;
  }
  rmSync(made.gone, { recursive: true, force: true });
  rmSync(join(made.hollow, "tasks"), { recursive: true, force: true });
  return { home, ...made };
}

const names = (rows) => rows.map((p) => p.name).sort();

// ── the classification ────────────────────────────────────────────────────

test("the three kinds are told apart before anything is removed", () => {
  const { home } = threeKinds();
  const { live, gone, hollow } = classifyRegistry(readRegistry({ ...process.env, [HOME_ENV]: home }));
  assert.deepEqual(names(live), ["live"]);
  assert.deepEqual(names(gone), ["gone"]);
  assert.deepEqual(names(hollow), ["hollow"]);
});

// ── prune ─────────────────────────────────────────────────────────────────

test("prune removes the directory that is gone and leaves the other two", () => {
  const { home } = threeKinds();
  const r = run(["project", "prune", "--json"], home);
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.deepEqual(names(result.removed), ["gone"]);
  assert.equal(result.kept, 2);

  const after = readRegistry({ ...process.env, [HOME_ENV]: home });
  assert.deepEqual(names(after.projects.concat(after.missing)), ["hollow", "live"],
    "a live entry lost to a prune is the failure this command must never have");
});

test("a directory that exists but is no longer a backlog needs the flag", () => {
  const { home } = threeKinds();
  assert.equal(run(["project", "prune"], home).status, 0);
  const second = JSON.parse(run(["project", "prune", "--all-unavailable", "--json"], home).stdout);
  assert.deepEqual(names(second.removed), ["hollow"],
    "the directory is still there — forgetting it throws away the only record that it was a project");
  assert.equal(second.kept, 1);
});

test("--dry-run changes the file not at all", () => {
  const { home } = threeKinds();
  const file = registryPath({ ...process.env, [HOME_ENV]: home });
  const before = readFileSync(file, "utf8");
  const r = run(["project", "prune", "--dry-run"], home);
  assert.equal(r.status, 0);
  assert.equal(readFileSync(file, "utf8"), before, "there is no undo, so a dry run is compared on bytes");
  assert.match(r.stdout, /nothing was changed/);
  assert.match(r.stdout, /gone/, "a dry run that does not name what it would take is not a preview");
});

test("what is removed is NAMED, not counted", () => {
  const { home, gone } = threeKinds();
  const r = run(["project", "prune"], home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /gone/);
  assert.ok(r.stdout.includes(gone), "the path is the identity, so the path is what is printed");
});

test("pruning a registry with nothing dead in it says so and changes nothing", () => {
  const { home } = threeKinds();
  run(["project", "prune", "--all-unavailable"], home);
  const file = registryPath({ ...process.env, [HOME_ENV]: home });
  const before = readFileSync(file, "utf8");
  const r = run(["project", "prune"], home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /still there/);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("pruning with no registry at all is an answer, not an error", () => {
  const home = mkdtempSync(join(tmpdir(), "branchling-prune-empty-"));
  const r = run(["project", "prune"], home);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to forget/);
});

// ── list ──────────────────────────────────────────────────────────────────

test("list separates the two kinds of dead entry and says how many", () => {
  const { home } = threeKinds();
  const out = run(["project", "list"], home);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /1 registered director(y|ies) does not exist any more/);
  assert.match(out.stdout, /1 registered directory exists but is no longer a backlog/);
  assert.match(out.stdout, /project prune/, "the report has to say what to do about it");
});

// ── doctor ────────────────────────────────────────────────────────────────

test("doctor reports a registry with dead entries — as a warning, never an error", () => {
  const { home, live } = threeKinds();
  const r = run(["doctor", "--dir", live, "--json"], home);
  const rows = JSON.parse(r.stdout).checks;
  const row = rows.find((c) => c.id === "registry");
  assert.ok(row, "doctor is where somebody looks when something feels wrong");
  assert.equal(row.status, "warn",
    "the registry is a convenience — a dead entry elsewhere must not fail THIS backlog's doctor");
  assert.match(row.detail, /2 unavailable/);
  assert.notEqual(r.status, 2);
});
