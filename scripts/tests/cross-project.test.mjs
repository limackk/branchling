/**
 * One question asked of every registered backlog (TL-36).
 *
 * WHAT THIS HAS TO RULE OUT, and each of them is a way the answer looks right
 * while being wrong:
 *
 *   1. A ROW WITHOUT ITS PROJECT. Task numbers are unique WITHIN a project, so
 *      three backlogs holding a `TL-1` is the normal case. "TL-1 in_progress"
 *      means nothing across projects, and rows that merged or overwrote each
 *      other would still count.
 *   2. A SILENT SKIP. A registry entry whose directory moved must be reported
 *      IN THE RESULT — including in `--json`, where a consumer would otherwise
 *      count an incomplete set as complete and read "you moved the repository"
 *      as "that project has no tasks".
 *   3. THE VIEW BECOMING A DEPENDENCY. Deleting the registry may cost this flag
 *      and nothing else (law 2): every command inside a repository is found by
 *      walking upwards, and that answer must never be contradicted by a file.
 *   4. A LOOSENED CLI CONTRACT. An unknown flag still fails, and a filter value
 *      no project has heard of still fails — while one that only the SECOND
 *      project knows must be allowed, or the cross-project pass would refuse
 *      queries that are perfectly meaningful.
 *
 * The fixtures are built here, so the suite says the same thing on a machine
 * with one registered project and on one with fifty.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { HOME_ENV, registryPath } from "../home.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("cross-project");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

/** Every run in this file gets its OWN registry, so one test's projects cannot
 *  reach another's — and none of them can reach the machine's. */
function withHome() {
  return mkdtempSync(join(tmpdir(), "branchling-xp-home-"));
}

function run(args, home, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || tmpdir(), encoding: "utf8", timeout: 60_000,
    env: { ...process.env, [HOME_ENV]: home },
  });
}

/** A backlog with one task, registered under `name`. */
function project(home, name, title) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-xp-" + name + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"], home).status, 0);
  const made = run(["new", "--dir", dir, "--title", title], home);
  assert.equal(made.status, 0, made.stderr);
  assert.equal(run(["project", "add", dir, "--name", name], home).status, 0);
  return { dir, id: (made.stdout.match(/([A-Z]+-\d+)/) || [])[1] };
}

function json(result) {
  assert.equal(result.stderr.includes("✗"), false, result.stderr);
  return JSON.parse(result.stdout);
}

// ── the identity is the pair ──────────────────────────────────────────────

test("every row names its project, and two projects sharing a number keep both rows", () => {
  const home = withHome();
  const a = project(home, "alpha", "Work in alpha");
  const b = project(home, "beta", "Work in beta");
  assert.equal(a.id, b.id, "the fixtures are meant to collide — both backlogs start at the same number");

  const out = json(run(["query", "--all-projects", "--json"], home));
  const rows = out.tasks.filter((t) => t.id === a.id);
  assert.equal(rows.length, 2, "a collision that merged or overwrote rows would still look like an answer");
  assert.deepEqual(rows.map((t) => t.project).sort(), ["alpha", "beta"]);
  assert.deepEqual(rows.map((t) => t.title).sort(), ["Work in alpha", "Work in beta"]);
  assert.equal(out.tasks.every((t) => t.project), true, "a row without its project is unusable across projects");
});

test("the text output prints the project first, before the id", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  const out = run(["query", "--all-projects"], home);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /\{project: alpha, id: [A-Z]+-\d+/);
});

// ── an unavailable project is part of the answer ──────────────────────────

test("a project whose directory is gone is REPORTED and the pass continues", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  const doomed = project(home, "gone", "Work that will vanish");
  rmSync(doomed.dir, { recursive: true, force: true });

  const out = json(run(["query", "--all-projects", "--json"], home));
  assert.equal(out.tasks.length, 1, "one project failing must not take the others' rows with it");
  assert.equal(out.unavailable.length, 1);
  assert.equal(out.unavailable[0].project, "gone");
  assert.match(out.unavailable[0].why, /does not exist/);
  assert.deepEqual(out.projects, { registered: 2, answered: 1 });

  const text = run(["query", "--all-projects"], home);
  assert.match(text.stdout, /project gone did not answer/);
});

test("a directory that is no longer a backlog is reported differently from one that is gone", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  const hollow = project(home, "hollow", "Work about to be hollowed out");
  rmSync(join(hollow.dir, "tasks"), { recursive: true, force: true });

  const out = json(run(["query", "--all-projects", "--json"], home));
  assert.equal(out.unavailable.length, 1);
  assert.match(out.unavailable[0].why, /no longer a backlog/,
    "`moved away` and `emptied out` have different fixes, so they get different sentences");
});

test("`unavailable` and `projects` are declared even when nothing is wrong", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  const all = json(run(["query", "--all-projects", "--json"], home));
  assert.deepEqual(all.unavailable, []);
  assert.deepEqual(all.projects, { registered: 1, answered: 1 });

  // And in a single-project answer, where they say "nobody looked".
  const one = json(run(["query", "--json", "--dir", "."], home, project(home, "solo", "Solo work").dir));
  assert.deepEqual(one.unavailable, []);
  assert.equal(one.projects, null, "a key that appears only under a flag is a contract nobody can build against");
});

// ── the view is never a dependency ────────────────────────────────────────

test("deleting the registry costs `--all-projects` and nothing else", () => {
  const home = withHome();
  const a = project(home, "alpha", "Work in alpha");
  // The registry's path is asked of the code, not guessed: a test that deleted
  // the wrong file would prove that deleting nothing costs nothing.
  const registry = registryPath({ ...process.env, [HOME_ENV]: home });
  assert.ok(readFileSync(registry, "utf8").includes("alpha"), "the fixture never registered anything");
  rmSync(registry, { force: true });

  const inside = run(["query", "--dir", ".", "--json"], home, a.dir);
  assert.equal(inside.status, 0, "a command inside a repository must not need the registry:\n" + inside.stderr);
  assert.equal(JSON.parse(inside.stdout).tasks.length, 1);

  const across = run(["query", "--all-projects", "--json"], home);
  assert.equal(across.status, 0, "an empty registry is an ANSWER, not an error");
  const out = JSON.parse(across.stdout);
  assert.deepEqual(out.tasks, []);
  assert.deepEqual(out.projects, { registered: 0, answered: 0 });
});

// ── the CLI contract is not loosened ──────────────────────────────────────

test("every filter axis still works across projects", () => {
  const home = withHome();
  const a = project(home, "alpha", "Work in alpha");
  project(home, "beta", "Work in beta");
  const config = join(a.dir, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8").replace(/^types: .*$/m, "types: [task, bug]"), "utf8");
  const file = join(a.dir, "tasks", readdirSync(join(a.dir, "tasks"))[0]);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/^priority: .*$/m, "priority: P0")
    .replace(/^type: .*$/m, "type: bug"), "utf8");

  const only = (args) => json(run(["query", "--all-projects", "--json", ...args], home)).tasks;
  assert.deepEqual(only(["--priority", "P0"]).map((t) => t.project), ["alpha"]);
  assert.deepEqual(only(["--type", "bug"]).map((t) => t.project), ["alpha"]);
  assert.deepEqual(only(["--text", "beta"]).map((t) => t.project), ["beta"]);
  assert.deepEqual(only(["--status", "pending"]).map((t) => t.project).sort(), ["alpha", "beta"]);
  assert.deepEqual(only(["--board", "main"]).map((t) => t.project).sort(), ["alpha", "beta"]);
  assert.equal(run(["query", "--all-projects", "--count"], home).stdout.trim(), "2");
});

test("an unknown flag still fails, and so does a value no project has heard of", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  assert.equal(run(["query", "--all-projects", "--nonsense"], home).status, 2);
  const bad = run(["query", "--all-projects", "--status", "in-progress"], home);
  assert.equal(bad.status, 2, "zero matches from a typo read exactly like an answer");
  assert.match(bad.stderr, /not an allowed value/);
});

test("a value only the SECOND project knows is allowed — the rule is the intersection", () => {
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  const b = project(home, "beta", "Work in beta");
  const config = join(b.dir, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8")
    .replace(/^types: .*$/m, "types: [task, code, bug, spike]"), "utf8");

  const out = run(["query", "--all-projects", "--type", "spike", "--json"], home);
  assert.equal(out.status, 0,
    "judging against one project's vocabulary would refuse a query meaningful in the other");
  assert.deepEqual(JSON.parse(out.stdout).tasks, []);
});

test("the pass stores nothing: the home directory is byte-for-byte what it was", () => {
  // LAW 2, asserted rather than asserted about. A cache written here would be a
  // second source of truth, and the symptom of one is invisible until it goes
  // stale — so what is checked is that NOTHING new appears, not that a
  // particular file is absent.
  const home = withHome();
  project(home, "alpha", "Work in alpha");
  project(home, "beta", "Work in beta");
  const before = readdirSync(home).sort();
  const registryBefore = readFileSync(registryPath({ ...process.env, [HOME_ENV]: home }), "utf8");

  assert.equal(run(["query", "--all-projects", "--json"], home).status, 0);
  assert.equal(run(["query", "--all-projects", "--count"], home).status, 0);

  assert.deepEqual(readdirSync(home).sort(), before, "the cross-project pass left something behind");
  assert.equal(readFileSync(registryPath({ ...process.env, [HOME_ENV]: home }), "utf8"), registryBefore,
    "reading the registry must not rewrite it");
});

test("--all-projects cannot be combined with a flag naming ONE backlog", () => {
  const home = withHome();
  const a = project(home, "alpha", "Work in alpha");
  for (const conflicting of [["--dir", a.dir], ["--tasks", join(a.dir, "tasks")]]) {
    const r = run(["query", "--all-projects", ...conflicting], home);
    assert.equal(r.status, 2, "two answers and no way to pick between them must be refused, not resolved silently");
    assert.match(r.stderr, /cannot be combined/);
  }
});
