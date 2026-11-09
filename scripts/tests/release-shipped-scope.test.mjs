/**
 * The scope report covers releases that have shipped (TL-516).
 *
 * WHAT HAS TO BE PROVED, against a real fixture repository with two tagged
 * releases and one in progress:
 *
 *   1. A release whose entry in `releases:` names a ref that resolves lists the
 *      unplanned tasks it carried and the planned tasks the ref does not hold;
 *      planned tasks it holds are counted as shipped.
 *   2. The range starts at the previous release's ref: what the first release
 *      carried is not reported again by the second, and the first begins at
 *      the root.
 *   3. A release without a ref behaves exactly as before (TL-505): it is judged
 *      against the pipeline and has no shipped lists.
 *   4. A ref that does not resolve reads as unknown, never as an empty release
 *      — and an unresolvable beginning leaves only the range unknown.
 *   5. The current release (TL-515) treats a release with a ref as shipped only
 *      when the ref holds every planned task; re-planning the missing ones lets
 *      it go — the positive control.
 *   6. Both shapes of entry are accepted in one list by every reader of the
 *      names (`new`, `query`, `check --vocabulary`, the viewer's facet), and a
 *      malformed entry — a pattern, an unknown key, no name, a bad slug, a
 *      duplicate across shapes — fails the configuration.
 *
 * Every vocabulary value is read back from the fixture's own config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig } from "../config.mjs";
import { readReleases } from "../release-entries.mjs";
import { rangeLogArgs } from "../release-shipped.mjs";
import { releaseFacetOptions } from "../viewer-release.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-shipped-scope");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function commit(dir, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content, "utf8");
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "--allow-empty", "-m", message]);
}

function configList(dir, key) {
  const text = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  return text.match(new RegExp("^" + key + ":\\s*\\[([^\\]]*)\\]", "m"))[1].split(",").map((s) => s.trim());
}

function taskFile(dir, id) {
  const tasks = join(dir, "backlog", "tasks");
  return join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
}

function setField(dir, id, key, value) {
  const file = taskFile(dir, id);
  writeFileSync(file, readFileSync(file, "utf8").replace(new RegExp("^" + key + ":.*$", "m"), key + ": " + value), "utf8");
}

function newTask(dir, title, ...flags) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title, ...flags]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

function backlogRepo(extraConfig = "") {
  const dir = fixtureDir(join(tmpdir(), "branchling-shipped-scope-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  if (extraConfig) appendFileSync(join(dir, "backlog", "config.yaml"), extraConfig);
  commit(dir, "the backlog", {});
  return dir;
}

// Two shipped releases marked by tags, one still in progress — both shapes of
// entry in one list.
const RELEASES = "\nreleases: [{ name: r1, ref: v1 }, { name: r2, ref: v2 }, r3]\n";
const TARGETS = `
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: test }
      - { name: production, ref: prod }
`;

/**
 *   a  r1, done, before v1                   → r1 shipped
 *   b  r1, done, no commit at all             → r1 planned, not shipped (no commits)
 *   c  none, done, before v1                  → r1 shipped unplanned
 *   e  r1, done, after v1, before v2          → r1 not shipped (absent); r2 shipped unplanned
 *   d  r2, done, after v1, before v2          → r2 shipped
 *   g  none, done, after v1, before v2        → r2 shipped unplanned
 *   h  r2, dropped                            → r2 dropped
 *   f  r3, done, after v2, in test only       → r3 (no ref) not shipped, by the pipeline
 */
function shippedRepo() {
  const dir = backlogRepo(RELEASES + TARGETS);
  const [done, cancelled] = configList(dir, "archived_statuses");
  const t = {
    a: newTask(dir, "Task a", "--release", "r1"),
    b: newTask(dir, "Task b", "--release", "r1"),
    c: newTask(dir, "Task c"),
    e: newTask(dir, "Task e", "--release", "r1"),
    d: newTask(dir, "Task d", "--release", "r2"),
    g: newTask(dir, "Task g"),
    h: newTask(dir, "Task h", "--release", "r2"),
    f: newTask(dir, "Task f", "--release", "r3"),
  };
  for (const k of ["a", "b", "c", "e", "d", "g", "f"]) setField(dir, t[k], "status", done);
  setField(dir, t.h, "status", cancelled);
  commit(dir, "the tasks", {});
  commit(dir, t.a + " ships in r1", { "src/a.js": "a\n" });
  commit(dir, t.c + " rides along in r1", { "src/c.js": "c\n" });
  git(dir, ["tag", "v1"]);
  commit(dir, t.e + " lands late", { "src/e.js": "e\n" });
  commit(dir, t.d + " ships in r2", { "src/d.js": "d\n" });
  commit(dir, t.g + " rides along in r2", { "src/g.js": "g\n" });
  git(dir, ["tag", "-a", "v2", "-m", "r2"]);
  git(dir, ["branch", "prod"]);
  commit(dir, t.f + " for the next release", { "src/f.js": "f\n" });
  git(dir, ["branch", "test"]);
  return { dir, t, done, cancelled };
}

function scopeJson(dir, release, ...args) {
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json", "--release", release, ...args]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-status");
  return parsed.release;
}

const ids = (part) => part.tasks.map((x) => x.id);

// ── 1 and 2. What a shipped release carried, from the previous ref ─────────

test("a release with a resolving ref lists what it shipped unplanned and what it planned but lacks", () => {
  const { dir, t } = shippedRepo();
  const r1 = scopeJson(dir, "r1");
  assert.equal(r1.shippedAt.ref, "v1");
  assert.equal(r1.shippedAt.status, "resolved");
  assert.equal(r1.shippedAt.sha, git(dir, ["rev-parse", "v1^{commit}"]));
  assert.equal(r1.shippedAt.since, null, "the first release with a ref begins at the root");
  assert.equal(r1.planned, 3);
  assert.equal(r1.shipped.count, 1);
  assert.deepEqual(ids(r1.notShipped), [t.b, t.e]);
  assert.equal(r1.notShipped.tasks.find((x) => x.id === t.b).note, "no-commits");
  assert.deepEqual(r1.notShipped.tasks.find((x) => x.id === t.e).standing,
    [{ release: "r1", ref: "v1", state: "absent", held: 0, of: 1 }]);
  assert.deepEqual(ids(r1.shippedUnplanned), [t.c]);
  assert.equal(r1.unplanned, null, "a shipped release is not what the next promotion carries");

  const r2 = scopeJson(dir, "r2");
  assert.deepEqual(r2.shippedAt.since, {
    release: "r1", ref: "v1", sha: git(dir, ["rev-parse", "v1^{commit}"]), status: "resolved", why: null,
  });
  assert.equal(r2.shipped.count, 1);
  assert.deepEqual(ids(r2.notShipped), []);
  assert.deepEqual(ids(r2.dropped), [t.h]);
  // The range starts at v1: `c` went out with r1 and is not reported again,
  // while `e`, planned for r1 and carried by r2, is.
  assert.deepEqual(ids(r2.shippedUnplanned), [t.e, t.g].sort((x, y) => x.localeCompare(y, undefined, { numeric: true })));
  assert.equal(r2.shippedUnplanned.tasks.find((x) => x.id === t.e).release, "r1");

  const counted = scopeJson(dir, "r2", "--count");
  assert.deepEqual([counted.shippedUnplanned.count, counted.shippedUnplanned.tasks.length], [2, 0]);
});

test("the text answer names the ref, where the release began, and the shipped-unplanned list", () => {
  const { dir, t } = shippedRepo();
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r2"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}shipped at v2 [0-9a-f]{12}, since r1 at v1 [0-9a-f]{12}$/m);
  assert.match(r.stdout, /^ {2}shipped, unplanned +2$/m);
  assert.match(r.stdout, new RegExp(t.e + " +Task e .*planned for r1 · in v2"));
  assert.doesNotMatch(r.stdout, /carried by the next promotion/);

  const first = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1"]);
  assert.match(first.stdout, /shipped at v1 [0-9a-f]{12}, since the root/);
  assert.match(first.stdout, new RegExp(t.e + " +Task e .*not in v1"));
});

// ── 3. Without a ref, nothing changes ─────────────────────────────────────

test("a release without a ref is judged against the pipeline, as before", () => {
  const { dir, t } = shippedRepo();
  const r3 = scopeJson(dir, "r3");
  assert.equal(r3.shippedAt, null);
  assert.equal(r3.shippedUnplanned, null);
  assert.deepEqual(ids(r3.notShipped), [t.f]);
  assert.deepEqual(r3.notShipped.tasks[0].standing, [{ target: "web", at: "test", waitingFor: "production", state: "absent" }]);
  assert.deepEqual(ids(r3.unplanned), []);
  // The positive control on the pipeline: promoting production ships it.
  git(dir, ["branch", "-f", "prod", "test"]);
  assert.equal(scopeJson(dir, "r3").shipped.count, 1);
});

// ── 4. Unknown is never empty ─────────────────────────────────────────────

test("an unresolvable ref reads as unknown, and an unresolvable beginning leaves only the range unknown", () => {
  const { dir, t } = shippedRepo();
  git(dir, ["tag", "-d", "v1"]);
  const r1 = scopeJson(dir, "r1");
  assert.equal(r1.shippedAt.status, "unknown");
  assert.equal(r1.shipped.count, 0);
  assert.deepEqual(r1.notShipped.tasks.map((x) => x.note), ["release-ref-unknown", "release-ref-unknown", "release-ref-unknown"]);
  assert.deepEqual(r1.shippedUnplanned, { count: null, unknown: true, tasks: [] });

  const r2 = scopeJson(dir, "r2");
  assert.equal(r2.shippedAt.status, "resolved");
  assert.equal(r2.shippedAt.since.status, "unknown");
  assert.equal(r2.shippedAt.rangeKnown, false);
  assert.equal(r2.shippedUnplanned.count, null);
  // The planned half reads only the end, so it is still judged.
  assert.equal(r2.shipped.count, 1);

  const text = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1"]);
  assert.match(text.stdout, /shipped at v1 — unknown: the ref does not resolve to a commit/);
  assert.match(text.stdout, /^ {2}shipped, unplanned +\? unknown$/m);
  assert.match(text.stdout, new RegExp(t.a + " .*unknown — the release's ref does not resolve"));
});

// ── 5. The current release ────────────────────────────────────────────────

test("a release with a ref is shipped for the current release only when its ref holds every planned task", () => {
  const { dir, t } = shippedRepo();
  // r1's ref lacks `b` and `e`, so r1 is still current, although r2 went out.
  assert.equal(scopeJson(dir, "r2").current, "r1");
  const gate = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.match(gate.stdout, /current release: r1/);

  // Re-planned for the release in progress, they no longer hold r1, and r2's
  // ref holds everything r2 planned: the current release is r3.
  setField(dir, t.b, "release", "r3");
  setField(dir, t.e, "release", "r3");
  assert.equal(scopeJson(dir, "r1").current, "r3");

  // An unknown ref is never shipped: deleting v2 makes r2 current again.
  git(dir, ["tag", "-d", "v2"]);
  assert.equal(scopeJson(dir, "r1").current, "r2");
});

// ── 6. Both shapes, every reader ───────────────────────────────────────────

test("every reader of the release names accepts both shapes of entry", () => {
  const { dir, t } = shippedRepo();
  const config = loadConfig(join(dir, "backlog"));
  assert.deepEqual(config.releases, ["r1", "r2", "r3"]);
  assert.deepEqual(config.releaseEntries.map((e) => [e.name, e.ref]), [["r1", "v1"], ["r2", "v2"], ["r3", null]]);
  assert.deepEqual(releaseFacetOptions(config.releases).slice(0, 3).map((o) => o.value), ["r1", "r2", "r3"]);

  const id = newTask(dir, "Planned for a shipped release", "--release", "r1");
  assert.match(readFileSync(taskFile(dir, id), "utf8"), /^release: r1$/m);
  const refused = run(dir, ["new", "--dir", "backlog", "--title", "Typo", "--release", "v1"]);
  assert.equal(refused.status, 1, "the ref is not a release name (an unknown value exits 1 since TL-630)");
  assert.match(refused.stderr, /allowed: r1 \| r2 \| r3/);

  const q = run(dir, ["query", "--dir", "backlog", "--status", configList(dir, "statuses").join(","), "--json", "--release", "r2"]);
  assert.equal(q.status, 0, q.stderr);
  assert.deepEqual(JSON.parse(q.stdout).tasks.map((x) => x.id).sort(), [t.d, t.h].sort());

  assert.equal(run(dir, ["check", "--dir", "backlog", "--vocabulary"]).status, 0);
  setField(dir, id, "release", "v1");
  assert.equal(run(dir, ["check", "--dir", "backlog", "--vocabulary"]).status, 1);
});

test("the block form of the list is read like the flow form", () => {
  const dir = backlogRepo("\nreleases:\n  - name: r1\n    ref: v1\n  - { name: r2, ref: refs/tags/v2 }\n  - r3\n");
  const config = loadConfig(join(dir, "backlog"));
  assert.deepEqual(config.releaseEntries.map((e) => [e.name, e.ref]), [["r1", "v1"], ["r2", "refs/tags/v2"], ["r3", null]]);
  // The plain list, as every project wrote it before, still reads as names.
  assert.deepEqual(readReleases("[1.0, 1.1]", []).entries, [{ name: "1.0", ref: null }, { name: "1.1", ref: null }]);
  assert.deepEqual(readReleases("", []).entries, []);
});

test("a malformed release entry fails the configuration", () => {
  for (const [line, message] of [
    ["releases: [{ name: r1, ref: \"refs/tags/v*\" }]", /`ref: refs\/tags\/v\*` is a pattern/],
    ["releases: [{ name: r1, tag: v1 }]", /unknown key `tag`/],
    ["releases: [{ ref: v1 }]", /`name` is required/],
    ["releases: [{ name: r1, ref: \"\" }]", /`ref` must be a ref name or tag/],
    ["releases: [{ name: R1, ref: v1 }]", /`releases` contains `R1`/],
    ["releases: [r1, { name: r1, ref: v1 }]", /duplicate release `r1`/],
  ]) {
    const dir = backlogRepo("\n" + line + "\n");
    const r = run(dir, ["query", "--dir", "backlog"]);
    assert.notEqual(r.status, 0, line);
    assert.match(r.stderr, message, line);
  }
  // The positive control: the same backlog with well-formed entries loads.
  assert.equal(run(backlogRepo(RELEASES), ["query", "--dir", "backlog"]).status, 0);
});

test("the range of a later release excludes patches the previous one already carried", () => {
  assert.deepEqual(rangeLogArgs(null, "b").slice(-2), ["b", "--"]);
  const args = rangeLogArgs("a", "b");
  assert.ok(args.includes("--cherry-pick") && args.includes("--right-only"));
  assert.ok(args.includes("a...b"));
});
