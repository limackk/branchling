/**
 * Only the current release's open top-priority tasks block shipping (TL-515).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because "fully
 * shipped" is a claim about what the task files PLAN and what git HOLDS:
 *
 *   1. The current release is the first of `releases:` not fully shipped —
 *      an empty release at the head of the list is skipped, a release whose
 *      planned work reached the last stage is passed, and an OPEN planned task
 *      keeps its release current even when its commits have all shipped.
 *   2. An open top-priority task of a LATER release does not block; one of the
 *      current release does (the positive control, in the same fixture).
 *   3. A last stage that does not resolve keeps a release current: unknown is
 *      never shipped.
 *   4. With every release shipped there is no current release, and no
 *      `planned-blocker-open` gap — while the same fixture reported one a
 *      moment earlier, so the silence has evidential force.
 *   5. `deploy status --release` and `check --release` both name the current
 *      release, in text and in `--json`.
 *   6. A closed task whose commits touch no target's paths does not pin its
 *      release (it touched no target, so it is in all of them vacuously);
 *      the same task open does, and a closed task no trunk commit names does.
 *   7. When deployment was not read, neither command names a current release:
 *      both say it was not judged, which is not the `null` of "all shipped".
 *
 * The fixture backlogs are created by `init` with the generic prefix, and every
 * vocabulary value (priorities, archived statuses) is read back from the
 * fixture's own config.yaml rather than assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describeCurrent, releaseShipped } from "../release-status.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("current-release");

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
  git(dir, ["commit", "-q", "-m", message]);
}

function configList(dir, key) {
  const text = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  return text.match(new RegExp("^" + key + ":\\s*\\[([^\\]]*)\\]", "m"))[1].split(",").map((s) => s.trim());
}

function setField(dir, id, key, value) {
  const tasks = join(dir, "backlog", "tasks");
  const file = join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(new RegExp("^" + key + ":.*$", "m"), key + ": " + value), "utf8");
}

function newTask(dir, title, ...flags) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title, ...flags]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

const CONFIG = `
releases: [r0, r1, r2]
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: test }
      - { name: production, ref: prod }
`;

/**
 * `r0` plans nothing. `r1` plans `shipping` (done, in test only) and `blocker`
 * (open, top priority, no commit). `r2` plans `later` (open, top priority, no
 * commit). So `r1` is current, and only `blocker` blocks.
 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-current-release-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), CONFIG);
  const top = configList(dir, "priorities")[0];
  const [done, dropped] = configList(dir, "archived_statuses");
  const ids = {
    shipping: newTask(dir, "Task shipping", "--release", "r1"),
    blocker: newTask(dir, "Task blocker", "--release", "r1", "--priority", top),
    later: newTask(dir, "Task later", "--release", "r2", "--priority", top),
  };
  setField(dir, ids.shipping, "status", done);
  commit(dir, "the backlog", {});
  git(dir, ["branch", "prod"]);
  commit(dir, ids.shipping + " ships", { "src/a.js": "a\n" });
  git(dir, ["branch", "test"]);
  return { dir, ids, top, done, dropped };
}

function gate(dir) {
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", "backlog", "--trunk", "main", "--json"], {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  return { current: result.currentRelease, blockers: result.gaps.filter((g) => g.gap === "planned-blocker-open").map((g) => g.subject) };
}

function scope(dir, release) {
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json", "--release", release]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).release;
}

test("the current release is the first not fully shipped, and only its open top-priority task blocks", () => {
  const { dir, ids, top, done, dropped } = fixture();
  // `r0` plans nothing and is passed; `r1` still has work outside production.
  const first = gate(dir);
  assert.equal(first.current, "r1");
  // The positive control and the claim in one answer: r1's blocker blocks,
  // r2's identical task does not.
  assert.deepEqual(first.blockers, [ids.blocker]);
  assert.equal(scope(dir, "r1").current, "r1");

  // Ship r1: its blocker dropped, its work promoted. r2 becomes current, and
  // the same open top-priority task that did not block a moment ago now does.
  setField(dir, ids.blocker, "status", dropped);
  git(dir, ["branch", "-f", "prod", "test"]);
  const second = gate(dir);
  assert.equal(second.current, "r2");
  assert.deepEqual(second.blockers, [ids.later]);

  // An open planned task holds its release even when everything it has
  // committed so far is in production: the work is not finished.
  setField(dir, ids.shipping, "status", configList(dir, "statuses")[0]);
  assert.equal(gate(dir).current, "r1");
  setField(dir, ids.shipping, "status", done);
  assert.equal(gate(dir).current, "r2");
  assert.equal(top, configList(dir, "priorities")[0]);
});

test("a last stage that does not resolve keeps a release current", () => {
  const { dir, ids, dropped } = fixture();
  setField(dir, ids.blocker, "status", dropped);
  git(dir, ["branch", "-f", "prod", "test"]);
  // The positive control: with production readable, r1 has shipped.
  assert.equal(gate(dir).current, "r2");

  git(dir, ["branch", "-D", "prod"]);
  const unknown = gate(dir);
  assert.equal(unknown.current, "r1");
  // r1 has no open blocker left, and r2's is a later release: nothing blocks.
  assert.deepEqual(unknown.blockers, []);
  const r1 = scope(dir, "r1");
  assert.equal(r1.current, "r1");
  assert.equal(releaseShipped(r1), false);
  assert.equal(r1.notShipped.tasks[0].note, "unknown");
});

test("with every release shipped there is no current release and no blocker gap", () => {
  const { dir, ids, top, dropped } = fixture();
  setField(dir, ids.blocker, "status", dropped);
  git(dir, ["branch", "-f", "prod", "test"]);
  // The positive control: the same fixture reports a blocker before r2 ships.
  assert.deepEqual(gate(dir).blockers, [ids.later]);

  setField(dir, ids.later, "status", dropped);
  const none = gate(dir);
  assert.equal(none.current, null);
  assert.deepEqual(none.blockers, []);
  assert.equal(releaseShipped(scope(dir, "r2")), true);
  assert.equal(scope(dir, "r2").current, null);
  // A top-priority task that is open and planned keeps a release current, so
  // "no current release" can only be reached with no such task — reopening one
  // brings both the current release and the blocker back.
  setField(dir, ids.later, "status", configList(dir, "statuses")[0]);
  setField(dir, ids.later, "priority", top);
  assert.deepEqual(gate(dir), { current: "r2", blockers: [ids.later] });
});

test("deploy status --release and check --release name the current release in text", () => {
  const { dir, ids, dropped } = fixture();
  const r1 = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1"]);
  assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /^release r1 .*\n {2}the current release — the first in `releases:` not fully shipped$/m);
  const r2 = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r2"]);
  assert.match(r2.stdout, /^ {2}not the current release, which is r1 — /m);

  const check = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /current release: r1 — the first in `releases:` not fully shipped; only its planned tasks can block/);
  assert.match(check.stdout, new RegExp("planned-blocker-open +" + ids.blocker + " — .*planned for the current release `r1`"));

  setField(dir, ids.blocker, "status", dropped);
  setField(dir, ids.later, "status", dropped);
  git(dir, ["branch", "-f", "prod", "test"]);
  const shipped = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.match(shipped.stdout, /no current release — every release in `releases:` has shipped/);
  assert.doesNotMatch(shipped.stdout, /planned-blocker-open/);
  assert.match(describeCurrent({ name: "r2", current: null }), /^no current release/);
});

test("a project that declares no releases is not told about a current release", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-current-release-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), CONFIG.replace(/^releases:.*$/m, ""));
  commit(dir, "the backlog", {});
  for (const b of ["test", "prod"]) git(dir, ["branch", b]);
  const r = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /current release/);
  // The positive control is the declared fixture above, whose report names it.
});

/**
 * `r1` plans `docs` (done, its only commit touches `docs/`, which no target
 * declares); `r2` plans `later` (open, top priority). Every ref holds every
 * commit, so nothing anywhere is waiting for a promotion.
 */
function docsOnlyFixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-current-release-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), CONFIG.replace(/^releases:.*$/m, "releases: [r1, r2]"));
  const top = configList(dir, "priorities")[0];
  const [done] = configList(dir, "archived_statuses");
  const ids = {
    docs: newTask(dir, "Task docs", "--release", "r1"),
    later: newTask(dir, "Task later", "--release", "r2", "--priority", top),
  };
  setField(dir, ids.docs, "status", done);
  commit(dir, "the backlog", {});
  commit(dir, ids.docs + " documents", { "docs/x.md": "x\n" });
  for (const b of ["test", "prod"]) git(dir, ["branch", b]);
  return { dir, ids, top, done };
}

test("a closed task whose commits touch no target does not pin its release; an open one does", () => {
  const { dir, ids, done } = docsOnlyFixture();
  // The claim: r1's only task touched no target, so r1 has shipped vacuously
  // and r2's open top-priority task is the one that blocks.
  assert.deepEqual(gate(dir), { current: "r2", blockers: [ids.later] });
  const r1 = scope(dir, "r1");
  assert.equal(r1.current, "r2");
  assert.equal(releaseShipped(r1), true);
  // TL-505's listing is unchanged: the task is still named, with why.
  assert.deepEqual(r1.notShipped.tasks.map((t) => [t.id, t.note]), [[ids.docs, "no-target"]]);

  // The positive control: the same task, open, holds r1 — and with it, r2's
  // blocker is a later release's and does not block.
  setField(dir, ids.docs, "status", configList(dir, "statuses")[0]);
  assert.deepEqual(gate(dir), { current: "r1", blockers: [] });
  setField(dir, ids.docs, "status", done);
  assert.equal(gate(dir).current, "r2");
});

test("a closed task no trunk commit names keeps its release current", () => {
  const { dir, ids, done } = docsOnlyFixture();
  const orphan = newTask(dir, "Task orphan", "--release", "r1");
  setField(dir, orphan, "status", done);
  commit(dir, "the backlog again", {});
  for (const b of ["test", "prod"]) git(dir, ["branch", "-f", b, "main"]);
  // Nothing measured that it shipped: r1 stays current, unlike the docs-only
  // task beside it (the control in the same release).
  assert.deepEqual(gate(dir), { current: "r1", blockers: [] });
  const r1 = scope(dir, "r1");
  assert.equal(releaseShipped(r1), false);
  assert.deepEqual(r1.notShipped.tasks.map((t) => [t.id, t.note]), [[ids.docs, "no-target"], [orphan, "no-commits"]]);
  assert.equal(done, configList(dir, "archived_statuses")[0]);
});

test("releaseShipped() refuses a scope computed with counts only", () => {
  const scoped = { open: { count: 0, tasks: [] }, notShipped: { count: 1, tasks: [] } };
  assert.throws(() => releaseShipped(scoped), /without `count`/);
  // The positive control: the same scope with its row is judged.
  assert.equal(releaseShipped({ ...scoped, notShipped: { count: 1, tasks: [{ note: "no-target" }] } }), true);
});

test("when deployment was not read, no release is named current — neither by the report nor by the gate", () => {
  const { dir } = fixture();
  // The positive control: read, r1 is current in both.
  assert.equal(scope(dir, "r2").current, "r1");
  assert.equal(scope(dir, "r2").currentJudged, true);
  assert.equal(gate(dir).current, "r1");

  // Outside git.
  const bare = mkdtempSync(join(tmpdir(), "branchling-current-release-" + counter++ + "-"));
  cpSync(join(dir, "backlog"), join(bare, "backlog"), { recursive: true });
  const unread = scope(bare, "r2");
  assert.equal(unread.current, null);
  assert.equal(unread.currentJudged, false);
  const text = run(bare, ["deploy", "status", "--dir", "backlog", "--release", "r2"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ {2}which release is current was not judged — deployment was not read$/m);
  assert.doesNotMatch(text.stdout, /current release, which is|no current release/);

  // A trunk that does not resolve, inside git: the gate judges nothing.
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", "backlog", "--trunk", "no-such-trunk", "--json"], {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
  const result = JSON.parse(r.stdout);
  assert.equal(result.scanned, false);
  assert.equal(result.currentRelease, null);
  assert.equal(result.currentReleaseJudged, false);
  const plain = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", "backlog", "--trunk", "no-such-trunk"], {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.match(plain.stdout, /which release is current was not judged — deployment was not read/);
  assert.doesNotMatch(plain.stdout, /no current release/);
  // And the judged null is told apart from it.
  assert.equal(describeCurrent({ name: "r2", current: null, currentJudged: true }).startsWith("no current release"), true);
});
