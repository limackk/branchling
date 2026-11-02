/**
 * `show <ID>` — the facts computed about one task (TL-509).
 *
 * WHAT HAS TO BE PROVED, each against a real fixture repository, because every
 * section is a claim about git and about other branches, not about a parser:
 *
 *   1. Deployment: per target and stage in text and JSON, with the trunk and
 *      every ref read and its SHA; a ref that does not resolve is `unknown`;
 *      a task no commit names says so; a target in another repository is
 *      `unobservable`; a project with no `deploy_targets` says nobody computed
 *      it (`deploy: null`).
 *   2. Elsewhere: a task whose status differs on another branch names that
 *      branch and status, and one that agrees names nothing — with the scan
 *      stated, so an empty list is not "nobody looked".
 *   3. Blockers: an open and a closed blocker, each with its status, and the
 *      verdict "still blocked"; with only closed ones, "not blocked".
 *   4. The surface: an unknown id exits 1 (a full envelope under --json), an
 *      unknown flag exits 2, and the body of the task file is never printed.
 *
 * The vocabulary — which status is closed, which is open — is read from the
 * fixture's own config.yaml, never typed here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig } from "../config.mjs";

import { SCRIPTS_DIR, isolateHome, isolateState } from "./_repo.mjs";

isolateHome("show");
isolateState("show");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, ...args) {
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
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

function backlogRepo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-show-" + counter++ + "-"));
  git(dir, "init", "-q", "-b", "main", ".");
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the backlog");
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

function taskFile(dir, id) {
  const name = readdirSync(join(dir, "backlog", "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "no file for " + id);
  return join(dir, "backlog", "tasks", name);
}

/** Rewrite one frontmatter line of a task file in the working tree. */
function setField(dir, id, field, value) {
  const path = taskFile(dir, id);
  const text = readFileSync(path, "utf8");
  const re = new RegExp("^" + field + ":.*$", "m");
  assert.match(text, re, field + " is not a line of " + id);
  writeFileSync(path, text.replace(re, field + ": " + value), "utf8");
}

function show(dir, ...args) {
  return run(dir, ["show", "--dir", "backlog", ...args]);
}

function showJson(dir, id) {
  const r = show(dir, id, "--json");
  assert.equal(r.status, 0, r.stderr);
  const json = JSON.parse(r.stdout);
  assert.equal(json.kind, "task-show");
  return json;
}

/**
 * One repository holding every case: a task in test and not in production, a
 * task no commit names, a ref that does not resolve, a target in another
 * repository, a branch that disagrees about a status, and blockers both open
 * and closed.
 */
function fixture() {
  const dir = backlogRepo();
  const config = loadConfig(join(dir, "backlog"));
  const closed = config.archivedStatuses[0];
  const open = config.activeStatuses[0];
  const other = config.activeStatuses.find((s) => s !== open);
  assert.ok(closed && open && other, "the fixture vocabulary needs two open statuses and a closed one");

  const shipped = newTask(dir, "Shipped already");
  const waiting = newTask(dir, "Waiting for production");
  const never = newTask(dir, "Never committed");
  const away = newTask(dir, "Implemented in the mobile repository");
  const blocker = newTask(dir, "A blocker still open");
  setField(dir, shipped, "status", closed);
  setField(dir, away, "target", "[mobile]");
  setField(dir, waiting, "blocked_by", "[" + blocker + ", " + shipped + "]");
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    paths: [src/]
    stages:
      - { name: test, ref: main }
      - name: production
        refs: [production, refs/deploys/app/production-us]
  - name: mobile
    repository: mobile-app
`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the tasks and the targets");

  commit(dir, shipped + " it ships", { "src/a.js": "a\n" });
  git(dir, "branch", "production");
  commit(dir, waiting + " it waits", { "src/b.js": "b\n" });

  // Another branch says something different about `waiting`. It carries a
  // commit of its own, because a branch merged into HEAD is no second opinion.
  git(dir, "checkout", "-q", "-b", "feature");
  setField(dir, waiting, "status", other);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "elsewhere, it moved");
  git(dir, "checkout", "-q", "main");

  return { dir, config, closed, open, other, shipped, waiting, never, away, blocker };
}

const FX = fixture();

// ── 1. Deployment ──────────────────────────────────────────────────────────

test("one task's deployment state per target and stage is printed in text and JSON, with every ref read and its SHA", () => {
  const { dir, waiting, shipped } = FX;
  const json = showJson(dir, waiting);
  const d = json.deploy;
  assert.equal(d.scanned, true);
  assert.equal(d.trunk.spec, "HEAD");
  assert.equal(d.trunk.source, "head");
  assert.equal(d.trunk.sha, git(dir, "rev-parse", "HEAD"));
  assert.equal(d.commits, 1);
  assert.deepEqual(d.targets.map((t) => t.target), ["app"]);
  assert.deepEqual(d.targets[0].stages.map((s) => [s.stage, s.state]), [["test", "full"], ["production", "unknown"]]);
  const prod = d.refs.find((r) => r.spec === "production");
  assert.equal(prod.sha, git(dir, "rev-parse", "production"));

  // POSITIVE CONTROL for "full": the task the production branch holds is
  // absent nowhere it is resolvable.
  const shippedJson = showJson(dir, shipped);
  const stage = shippedJson.deploy.targets[0].stages.find((s) => s.stage === "production");
  assert.deepEqual(stage.refs.find((r) => r.spec === "production").state, "full");

  const text = show(dir, waiting);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^deploy$/m);
  assert.match(text.stdout, /trunk\s+HEAD [0-9a-f]{12}/);
  assert.match(text.stdout, /app\s+test full, production unknown/);
  assert.match(text.stdout, new RegExp("app/production  production  " + git(dir, "rev-parse", "production").slice(0, 12)));
});

test("a ref that does not resolve reads as unknown, never as empty", () => {
  const { dir, waiting } = FX;
  const json = showJson(dir, waiting);
  const ref = json.deploy.refs.find((r) => r.spec === "refs/deploys/app/production-us");
  assert.equal(ref.sha, null);
  assert.equal(ref.status, "unknown");
  const stage = json.deploy.targets[0].stages.find((s) => s.stage === "production");
  assert.equal(stage.state, "unknown");
  assert.equal(stage.refs.find((r) => r.spec === "refs/deploys/app/production-us").state, "unknown");
  assert.match(show(dir, waiting).stdout, /refs\/deploys\/app\/production-us\s+unknown — /);
});

test("a task with no commits says so, rather than reading as deployed nowhere", () => {
  const { dir, never } = FX;
  const json = showJson(dir, never);
  assert.equal(json.deploy.commits, 0);
  assert.deepEqual(json.deploy.targets, []);
  assert.deepEqual(json.deploy.unobservable, []);
  assert.match(show(dir, never).stdout, /no commit on the trunk names this task/);
});

test("a task of a target in another repository is unobservable, named with that repository", () => {
  const { dir, away, never } = FX;
  const json = showJson(dir, away);
  assert.deepEqual(json.deploy.unobservable, [{ target: "mobile", repository: "mobile-app" }]);
  assert.match(show(dir, away).stdout, /mobile\s+unobservable — deployed from `mobile-app`/);
  // POSITIVE CONTROL: a task naming no target is not claimed by that target.
  assert.doesNotMatch(show(dir, never).stdout, /unobservable/);
});

test("without deploy_targets the JSON says nobody computed it, and the text says why", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Anything");
  const json = showJson(dir, id);
  assert.equal(json.deploy, null);
  assert.match(show(dir, id).stdout, /declares no `deploy_targets`/);
});

// ── 2. Other branches and worktrees ────────────────────────────────────────

test("a task with a different status on another branch names that branch and status", () => {
  const { dir, waiting, shipped, other } = FX;
  const json = showJson(dir, waiting);
  assert.equal(json.scan.scanned, true);
  assert.ok(json.scan.branches.includes("feature"), JSON.stringify(json.scan));
  assert.deepEqual(json.elsewhere.map((o) => [o.source, o.status]), [["feature", other]]);
  assert.match(show(dir, waiting).stdout, new RegExp("^elsewhere\\n  feature: " + other + "$", "m"));

  // POSITIVE CONTROL: a task every branch agrees about names nothing, and the
  // text says the scan ran rather than leaving the section blank.
  const agrees = showJson(dir, shipped);
  assert.deepEqual(agrees.elsewhere, []);
  assert.equal(agrees.scan.scanned, true);
  assert.match(show(dir, shipped).stdout, /no other branch or worktree disagrees/);
});

// ── 3. Blockers ────────────────────────────────────────────────────────────

test("an open and a closed blocker are each named with their status, and the task is still blocked", () => {
  const { dir, waiting, blocker, shipped, closed, open } = FX;
  const json = showJson(dir, waiting);
  assert.equal(json.blocked, true);
  assert.deepEqual(
    json.blockers.map((b) => [b.id, b.status, b.resolved]),
    [[blocker, open, false], [shipped, closed, true]],
  );
  const text = show(dir, waiting).stdout;
  assert.match(text, /blockers  still blocked — 1 of 2 open/);
  assert.match(text, new RegExp("✗\\s+" + blocker + "\\s+" + open + "\\s+A blocker still open"));
  assert.match(text, new RegExp("✓\\s+" + shipped + "\\s+" + closed + "\\s+Shipped already"));
});

test("with every blocker closed the task is not blocked, and a dangling id still blocks", () => {
  const { dir, closed, shipped } = FX;
  const id = newTask(dir, "Waits on closed work");
  setField(dir, id, "blocked_by", "[" + shipped + "]");
  const json = showJson(dir, id);
  assert.equal(json.blocked, false);
  assert.deepEqual(json.blockers.map((b) => [b.id, b.status, b.resolved]), [[shipped, closed, true]]);
  assert.match(show(dir, id).stdout, /blockers  not blocked/);

  // A blocker id that names no task is unresolved, as `next` treats it.
  const prefix = shipped.replace(/-\d+$/, "");
  setField(dir, id, "blocked_by", "[" + prefix + "-9999]");
  const dangling = showJson(dir, id);
  assert.equal(dangling.blocked, true);
  assert.deepEqual(dangling.blockers.map((b) => [b.found, b.resolved]), [[false, false]]);
  assert.match(show(dir, id).stdout, /no such task in this tree/);

  const none = newTask(dir, "Waits on nothing");
  assert.equal(showJson(dir, none).blocked, false);
  assert.match(show(dir, none).stdout, /blockers  none/);
});

// ── 4. The surface ─────────────────────────────────────────────────────────

test("an unknown id fails with exit 1, in text and in a complete envelope", () => {
  const { dir, shipped } = FX;
  const missing = shipped.replace(/-\d+$/, "") + "-9999";
  const text = show(dir, missing);
  assert.equal(text.status, 1);
  assert.match(text.stderr, /there is no task/);
  const r = show(dir, missing, "--json");
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, false);
  assert.equal(json.refusalKind, "no-such-task");
  assert.deepEqual(json.blockers, []);
});

test("an unknown flag and a missing id are usage errors", () => {
  const { dir, waiting } = FX;
  const flag = show(dir, waiting, "--deploy");
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /unknown flag: --deploy/);
  assert.equal(show(dir).status, 2);
  assert.equal(show(dir, waiting, waiting).status, 2);
});

test("the task's body is not reprinted — only the one-line header and the computed sections", () => {
  const { dir, waiting } = FX;
  const out = show(dir, waiting).stdout;
  assert.match(out.split("\n")[0], new RegExp("^" + waiting + "  Waiting for production  "));
  assert.doesNotMatch(out, /## Goal|## Acceptance criteria|verification:/);
});
