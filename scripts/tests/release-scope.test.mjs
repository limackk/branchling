/**
 * A release's planned scope is compared with what shipped (TL-505).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because the claim
 * is about what the task files PLAN and what git HOLDS, together:
 *
 *   1. `deploy status --release <name>` reports both directions: planned tasks
 *      not yet in the last stage (a task with no commit among them), and tasks
 *      the next promotion carries that the release did not plan. Planned tasks
 *      still open and planned tasks dropped are listed; shipped ones counted.
 *   2. An undeclared release fails — on the command, in `new`, in `query`, and
 *      in the tree (`check --vocabulary`) — and so does a malformed `releases:`.
 *      Each refusal has a positive control: the declared value passes.
 *   3. The gate: an open task of the top priority planned for a release is a
 *      `planned-blocker-open` gap against the LAST stage of its targets — under
 *      `report` it is printed and exits 0, under `require` it exits 1, and the
 *      same task at a lower priority, or closed, is no gap.
 *
 * The fixture backlogs are created by `init` with the generic prefix, and every
 * vocabulary value (priorities, archived statuses) is read back from the
 * fixture's own config.yaml rather than assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { GAP_NAMES } from "../release-gaps.mjs";
import { checkReleaseFlag, parseStatusArgs } from "../release-status.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-scope");

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

/** A list key of the fixture's config.yaml, read back rather than assumed. */
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
  const dir = mkdtempSync(join(tmpdir(), "branchling-release-scope-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  if (extraConfig) appendFileSync(join(dir, "backlog", "config.yaml"), extraConfig);
  commit(dir, "the backlog", {});
  return dir;
}

const RELEASES = "\nreleases: [r1, r2]\n";
const TARGETS = `
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: test }
      - { name: production, ref: prod }
`;

/**
 * The shared fixture, planned for `r1` unless said otherwise:
 *
 *   shipped     done, in test and production              → counted as shipped
 *   staged      done, in test only                        → planned, not shipped
 *   unstarted   open, top priority, no commit             → not shipped, still open
 *   dropped     closed in the second archived status      → dropped
 *   rider       no release, in test only                  → unplanned
 *   other       planned for r2, on the trunk only         → unplanned
 *   history     no release, in production                 → not listed anywhere
 */
function scopeRepo() {
  const dir = backlogRepo(RELEASES + TARGETS);
  const top = configList(dir, "priorities")[0];
  const [done, cancelled] = configList(dir, "archived_statuses");
  const ids = {
    shipped: newTask(dir, "Task shipped", "--release", "r1"),
    staged: newTask(dir, "Task staged", "--release", "r1"),
    unstarted: newTask(dir, "Task unstarted", "--release", "r1", "--priority", top),
    dropped: newTask(dir, "Task dropped", "--release", "r1"),
    rider: newTask(dir, "Task rider"),
    other: newTask(dir, "Task other", "--release", "r2"),
    history: newTask(dir, "Task history"),
  };
  for (const name of ["shipped", "staged", "rider", "history", "other"]) setField(dir, ids[name], "status", done);
  setField(dir, ids.dropped, "status", cancelled);
  commit(dir, "the tasks", {});
  commit(dir, ids.history + " long shipped", { "src/h.js": "h\n" });
  commit(dir, ids.shipped + " ships", { "src/a.js": "a\n" });
  git(dir, ["branch", "prod"]);
  commit(dir, ids.staged + " reaches test", { "src/b.js": "b\n" });
  commit(dir, ids.rider + " rides along", { "src/c.js": "c\n" });
  git(dir, ["branch", "test"]);
  commit(dir, ids.other + " merged for the next release", { "src/d.js": "d\n" });
  return { dir, ids, top, done, cancelled };
}

function scopeJson(dir, ...args) {
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json", "--release", "r1", ...args]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-status");
  return parsed.release;
}

const ids = (part) => part.tasks.map((t) => t.id);

// ── 1. Both directions ──────────────────────────────────────────────────

test("planned-but-undeployed and deployed-but-unplanned tasks are both reported", () => {
  const { dir, ids: t } = scopeRepo();
  const scope = scopeJson(dir);
  assert.equal(scope.name, "r1");
  assert.equal(scope.planned, 4);
  assert.equal(scope.shipped.count, 1);
  assert.deepEqual(ids(scope.notShipped), [t.staged, t.unstarted]);
  assert.deepEqual(ids(scope.open), [t.unstarted]);
  assert.deepEqual(ids(scope.unplanned), [t.rider, t.other]);
  assert.deepEqual(ids(scope.dropped), [t.dropped]);

  const staged = scope.notShipped.tasks.find((x) => x.id === t.staged);
  assert.deepEqual(staged.standing, [{ target: "web", at: "test", waitingFor: "production", state: "absent" }]);
  const unstarted = scope.notShipped.tasks.find((x) => x.id === t.unstarted);
  assert.equal(unstarted.note, "no-commits");
  assert.equal(unstarted.commits, 0);
  const other = scope.unplanned.tasks.find((x) => x.id === t.other);
  assert.equal(other.release, "r2");
  assert.deepEqual(other.standing, [{ target: "web", at: null, waitingFor: "test", state: "absent" }]);

  // The positive control on the other release: what was unplanned for r1 is
  // planned for r2, and r1's planned work is unplanned there.
  const r2 = JSON.parse(run(dir, ["deploy", "status", "--dir", "backlog", "--json", "--release", "r2"]).stdout).release;
  assert.deepEqual(ids(r2.notShipped), [t.other]);
  assert.deepEqual(ids(r2.unplanned), [t.staged, t.rider]);

  // Promoting production ships the planned work, and the rider stops being
  // carried by anything.
  git(dir, ["branch", "-f", "prod", "test"]);
  const after = scopeJson(dir);
  assert.equal(after.shipped.count, 2);
  assert.deepEqual(ids(after.notShipped), [t.unstarted]);
  assert.deepEqual(ids(after.unplanned), [t.other]);
});

test("the text answer names every list, where each task stands, and counts what shipped", () => {
  const { dir, ids: t } = scopeRepo();
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^trunk {2}HEAD [0-9a-f]{12}/m);
  assert.match(r.stdout, /release r1 {2}4 planned · 1 shipped \(counted, not listed\) · 1 dropped/);
  assert.match(r.stdout, /planned, not shipped +2$/m);
  assert.match(r.stdout, new RegExp(t.staged + " +Task staged .*web: in test, waiting for production"));
  assert.match(r.stdout, new RegExp(t.unstarted + " +Task unstarted .*no commit on the trunk names it"));
  assert.match(r.stdout, /unplanned, carried by the next promotion +2$/m);
  assert.match(r.stdout, new RegExp(t.other + " +Task other .*planned for r2 · web: on the trunk, waiting for test"));
  assert.match(r.stdout, /planned, then dropped +1$/m);
  // The pipeline is replaced by the comparison, not printed beside it.
  assert.doesNotMatch(r.stdout, /closed, not on the trunk/);
});

test("--count keeps the counts, --target narrows, and an unresolved last stage is unknown", () => {
  const { dir, ids: t } = scopeRepo();
  const counted = scopeJson(dir, "--count");
  assert.deepEqual([counted.notShipped.count, counted.unplanned.count, counted.notShipped.tasks.length], [2, 2, 0]);
  assert.equal(scopeJson(dir, "--target", "web").notShipped.count, 2);

  git(dir, ["branch", "-D", "prod"]);
  const scope = scopeJson(dir);
  const staged = scope.notShipped.tasks.find((x) => x.id === t.staged);
  assert.equal(staged.note, "unknown");
  assert.equal(staged.standing[0].state, "unknown");
  // Unknown is never shipped: the task that was in production is not counted.
  assert.equal(scope.shipped.count, 0);
});

// ── 2. An undeclared release fails everywhere ───────────────────────────

test("deploy status refuses an undeclared release, a backlog with none, and --env beside it", () => {
  const { dir } = scopeRepo();
  // An undeclared NAME is a refusal (1), contradicting or malformed flags a
  // usage error (2) — TL-533.
  for (const [args, message, exit] of [
    [["--release", "r9"], /`r9` is not a declared release \(declared: r1, r2\)/, 1],
    [["--release", "r1", "--env", "test"], /compares the plan with the LAST stage/, 2],
    [["--release"], /with no value/, 2],
  ]) {
    const r = run(dir, ["deploy", "status", "--dir", "backlog", ...args]);
    assert.equal(r.status, exit, args.join(" "));
    assert.match(r.stderr, message);
  }
  const none = backlogRepo(TARGETS);
  const r = run(none, ["deploy", "status", "--dir", "backlog", "--release", "r1"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /declares no `releases`/);
  assert.equal(checkReleaseFlag({ release: "r1", env: null }, ["r1"]).ok, true);
  assert.equal(parseStatusArgs(["--release", "r1"]).release, "r1");
});

test("new writes a declared release and refuses any other, even into a template without the line", () => {
  const dir = backlogRepo(RELEASES);
  const id = newTask(dir, "Planned", "--release", "r2");
  assert.match(readFileSync(taskFile(dir, id), "utf8"), /^release: r2$/m);

  const bad = run(dir, ["new", "--dir", "backlog", "--title", "Typo", "--release", "r9"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /`r9` is not a release this project plans/);
  assert.match(bad.stderr, /allowed: r1 \| r2/);

  // A template from before the field: the value is inserted, not dropped.
  const template = join(dir, "backlog", "_template.md");
  writeFileSync(template, readFileSync(template, "utf8").replace(/^release:.*\n/m, ""), "utf8");
  const old = newTask(dir, "From an old template", "--release", "r1");
  const text = readFileSync(taskFile(dir, old), "utf8");
  assert.match(text, /^epic:.*\nrelease: r1$/m);

  const none = backlogRepo();
  const refused = run(none, ["new", "--dir", "backlog", "--title", "Nowhere", "--release", "r1"]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /plans no releases/);
});

test("query filters by release, asks for the unplanned with an empty value, and refuses an undeclared one", () => {
  const { dir, ids: t } = scopeRepo();
  const listed = (args) => {
    const r = run(dir, ["query", "--dir", "backlog", "--status", configList(dir, "statuses").join(","), "--json", ...args]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).tasks.map((x) => x.id).sort();
  };
  assert.deepEqual(listed(["--release", "r1"]), [t.shipped, t.staged, t.unstarted, t.dropped].sort());
  assert.deepEqual(listed(["--release", "r2"]), [t.other]);
  assert.deepEqual(listed(["--release", ""]), [t.rider, t.history].sort());
  const text = run(dir, ["query", "--dir", "backlog", "--release", "r1"]);
  assert.match(text.stdout, new RegExp("id: " + t.unstarted + ",.*release: r1"));

  const bad = run(dir, ["query", "--dir", "backlog", "--release", "r9"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /`r9` is not an allowed value for the field `release`/);
  // Closed even when empty: a backlog that declares none refuses any value.
  const none = backlogRepo();
  assert.equal(run(none, ["query", "--dir", "backlog", "--release", "r1"]).status, 2);
});

test("a release outside `releases:` fails the vocabulary check; a declared one passes", () => {
  const dir = backlogRepo(RELEASES);
  const id = newTask(dir, "Planned", "--release", "r1");
  assert.equal(run(dir, ["check", "--dir", "backlog", "--vocabulary"]).status, 0);
  setField(dir, id, "release", "r9");
  const r = run(dir, ["check", "--dir", "backlog", "--vocabulary"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /r9/);
});

test("a malformed or duplicated `releases:` entry fails the configuration", () => {
  for (const [line, message] of [
    ["releases: [R1]", /`releases` contains `R1`/],
    ["releases: [r1, r1]", /duplicate release `r1`/],
  ]) {
    const dir = backlogRepo("\n" + line + "\n");
    const r = run(dir, ["query", "--dir", "backlog"]);
    assert.notEqual(r.status, 0, line);
    assert.match(r.stderr, message);
  }
  // The positive control: the same backlog with a well-formed list loads.
  assert.equal(run(backlogRepo(RELEASES), ["query", "--dir", "backlog"]).status, 0);
});

// ── 3. The gate ──────────────────────────────────────────────────────────

function gateJson(dir, ...args) {
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", "backlog", "--trunk", "main", "--json", ...args], {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, result: JSON.parse(r.stdout), stderr: r.stderr };
}

const blockers = (result) => result.gaps.filter((g) => g.gap === "planned-blocker-open");

test("an open top-priority task planned for a release blocks the last stage of its targets", () => {
  const { dir, ids: t, top, done } = scopeRepo();
  assert.ok(GAP_NAMES.includes("planned-blocker-open"));
  const report = gateJson(dir);
  assert.equal(report.status, 0, report.stderr);
  assert.deepEqual(blockers(report.result).map((g) => [g.subject, g.where]), [[t.unstarted, ["web/production"]]]);
  assert.match(blockers(report.result)[0].detail, new RegExp("`" + top + "` task planned for the current release `r1`"));
  // Only the last stage: judging `test` alone finds no blocker.
  assert.deepEqual(blockers(gateJson(dir, "--env", "web/test").result), []);

  // Under `require`, with every OTHER gap accepted, the blocker alone fails it.
  const others = GAP_NAMES.filter((g) => g !== "planned-blocker-open");
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nrelease_gate: require\nrelease_gate_accept: [" + others.join(", ") + "]\n");
  const strict = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(strict.status, 1, strict.stdout + strict.stderr);
  assert.match(strict.stdout, new RegExp("planned-blocker-open +" + t.unstarted));

  // The positive control in both directions: a lower priority is no blocker,
  // and neither is the top-priority task once closed.
  const lower = configList(dir, "priorities")[1];
  setField(dir, t.unstarted, "priority", lower);
  assert.equal(run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]).status, 0);
  setField(dir, t.unstarted, "priority", top);
  assert.equal(run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]).status, 1);
  setField(dir, t.unstarted, "status", done);
  assert.equal(run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]).status, 0);
});

test("a planned blocker with commits is held to the targets it touched", () => {
  const dir = backlogRepo(RELEASES + TARGETS + `  - name: docs
    paths: [docs/]
    stages:
      - { name: published, ref: published }
`);
  const top = configList(dir, "priorities")[0];
  const id = newTask(dir, "Docs only", "--release", "r1", "--priority", top);
  commit(dir, "the task", {});
  commit(dir, id + " starts", { "docs/a.md": "a\n" });
  for (const b of ["test", "prod", "published"]) git(dir, ["branch", b]);
  assert.deepEqual(blockers(gateJson(dir).result).map((g) => g.where), [["docs/published"]]);
});
