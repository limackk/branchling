/**
 * `deploy status` — what waits for which environment (TL-502).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because the claim
 * is about what git and the task files say together:
 *
 *   1. Each bucket holds exactly the tasks between two adjacent steps: closed
 *      but not on the trunk, on the trunk but not in the first stage, in each
 *      stage but not the next; the last stage is counted, not listed.
 *   2. A stage of two parallel refs places a task as reached only when both
 *      hold it, and otherwise names the ref that does.
 *   3. An empty bucket prints as zero; an unresolvable ref prints as unknown,
 *      never as zero.
 *   4. `--json` carries the same buckets; `--target`, `--env` and `--count`
 *      narrow them, and an undeclared name fails.
 *   5. The trunk is the remote's default branch when the clone has one, so a
 *      task closed on a feature branch reads as off the trunk from that branch.
 *   6. An annotated tag supplies the deploy time; otherwise the newest commit.
 *
 * The fixture backlogs are created by `init` with the generic prefix, so no id
 * here refers into this repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { TRUNK_SOURCE_TEXT, defaultTrunk } from "../environments.mjs";
import { parseStatusArgs, releasePipeline, resolveFilter } from "../release-status.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-status");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function git(dir, args, env = {}) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function commit(dir, message, files, env = {}) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content, "utf8");
  }
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", message], env);
  return git(dir, ["rev-parse", "HEAD"]);
}

function backlogRepo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-release-status-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  commit(dir, "the backlog", {});
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

/** Closes a task on disk. The fixture's archived statuses come from its own
 *  config.yaml, read back rather than assumed. */
function close(dir, id) {
  const config = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  const archived = config.match(/^archived_statuses:\s*\[([^\]]*)\]/m)[1].split(",")[0].trim();
  const tasks = join(dir, "backlog", "tasks");
  const file = join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status:\s*\S+/m, "status: " + archived), "utf8");
  return archived;
}

function statusJson(dir, ...args) {
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-status");
  return parsed;
}

/** `label → [ids]` for one target, compact enough to assert in one line. */
function buckets(report, target) {
  const t = report.targets.find((x) => x.target === target);
  const out = {};
  for (const b of t.buckets) out[b.label] = b.listed ? b.tasks.map((x) => x.id) : b.count;
  return out;
}

/**
 * The shared fixture:
 *   shipped   in test, production-eu and production-us   → reached
 *   halfway   in test and production-eu only             → waiting for production
 *   merged    on the trunk only                          → waiting for test
 *   branched  closed, committed only on a feature branch → closed, not on the trunk
 *   silent    closed, named by no commit                 → unplaced
 *   docs      touches only docs/                         → the docs target, reached
 */
function pipelineRepo() {
  const dir = backlogRepo();
  const ids = {};
  for (const name of ["shipped", "halfway", "merged", "branched", "silent", "docs"]) ids[name] = newTask(dir, "Task " + name);
  commit(dir, "the tasks", {});
  commit(dir, ids.shipped + " ships everywhere", { "src/a.js": "a\n" });
  commit(dir, ids.docs + " documents it", { "docs/a.md": "a\n" });
  git(dir, ["branch", "published"]);
  git(dir, ["branch", "prod-us"]);
  commit(dir, ids.halfway + " reaches one region", { "src/b.js": "b\n" });
  git(dir, ["update-ref", "refs/deploys/web/production-eu", "HEAD"]);
  git(dir, ["branch", "test"]);
  commit(dir, ids.merged + " merged, not deployed", { "src/c.js": "c\n" });
  git(dir, ["checkout", "-q", "-b", "feature"]);
  commit(dir, ids.branched + " never merged", { "src/d.js": "d\n" });
  git(dir, ["checkout", "-q", "main"]);
  close(dir, ids.branched);
  close(dir, ids.silent);
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: test }
      - name: production
        refs: [refs/deploys/web/production-eu, prod-us]
  - name: docs
    paths: [docs/]
    stages:
      - { name: published, ref: published }
`);
  return { dir, ids };
}

// ── 1–3. The buckets ──────────────────────────────────────────────────────

test("each bucket holds exactly the tasks between two adjacent steps, and the last is counted", () => {
  const { dir, ids } = pipelineRepo();
  const report = statusJson(dir);
  assert.deepEqual(buckets(report, "web"), {
    "closed, not on the trunk": [ids.branched],
    "on the trunk, waiting for test": [ids.merged],
    "in test, waiting for production": [ids.halfway],
    "in production": 1,
  });
  // The empty bucket is present and zero, not omitted.
  assert.deepEqual(buckets(report, "docs"), {
    "closed, not on the trunk": [],
    "on the trunk, waiting for published": [],
    "in published": 1,
  });
  const reached = report.targets[0].buckets.find((b) => b.kind === "reached");
  assert.equal(reached.listed, false);
  assert.deepEqual(reached.tasks, []);
  // A closed task no commit names cannot be given a target, and is counted.
  assert.deepEqual(report.unplaced, { count: 1, ids: [ids.silent] });
  // Every ref read is named with its SHA.
  assert.equal(report.scan.refs.find((r) => r.spec === "prod-us").sha, git(dir, ["rev-parse", "prod-us"]));
  assert.equal(report.trunk.source, "head");
});

test("a parallel stage places a task only when every ref holds it, and names the ref that does", () => {
  const { dir, ids } = pipelineRepo();
  const report = statusJson(dir);
  const waiting = report.targets[0].buckets.find((b) => b.stage === "production" && b.kind === "waiting");
  const row = waiting.tasks.find((t) => t.id === ids.halfway);
  assert.equal(row.state, "partial");
  assert.deepEqual(row.holding, ["refs/deploys/web/production-eu"]);
  assert.deepEqual(row.refs.map((r) => [r.spec, r.state]), [["refs/deploys/web/production-eu", "full"], ["prod-us", "absent"]]);
  // The positive control: once the second region has it, it leaves the bucket.
  git(dir, ["branch", "-f", "prod-us", "refs/deploys/web/production-eu"]);
  assert.deepEqual(buckets(statusJson(dir), "web")["in test, waiting for production"], []);
  assert.equal(buckets(statusJson(dir), "web")["in production"], 2);
});

test("the text answer carries the same buckets, prints zero, and names the trunk and every ref", () => {
  const { dir, ids } = pipelineRepo();
  const r = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^trunk {2}HEAD [0-9a-f]{12} {2}\(HEAD/m);
  assert.match(r.stdout, /web\/production +prod-us +[0-9a-f]{12}/);
  assert.match(r.stdout, /on the trunk, waiting for published +0$/m);
  assert.match(r.stdout, /in production +1 +\(counted, not listed\)/);
  assert.match(r.stdout, new RegExp(ids.halfway + " +Task halfway .*partial \\(held by refs/deploys/web/production-eu\\)"));
  assert.match(r.stdout, new RegExp(ids.branched + " +Task branched +\\S+ \\d{4}-\\d{2}-\\d{2} · waiting 0d"));
  assert.match(r.stdout, /1 closed task\(s\) are named by no commit/);
});

test("an unresolvable ref makes its bucket and every later one unknown, never zero", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Somewhere");
  commit(dir, id + " lands", { "a.js": "a\n" });
  git(dir, ["branch", "test"]);
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    stages:
      - { name: test, ref: test }
      - { name: production, ref: origin/production }
`);
  const report = statusJson(dir);
  const [, onTrunk, inTest, reached] = report.targets[0].buckets;
  assert.equal(onTrunk.unknown, false);
  assert.equal(inTest.unknown, true);
  assert.deepEqual(inTest.unknownRefs, ["origin/production"]);
  assert.deepEqual(inTest.tasks.map((t) => [t.id, t.state]), [[id, "unknown"]]);
  assert.equal(reached.unknown, true);
  const text = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.match(text.stdout, /in test, waiting for production +\? unknown — origin\/production does not resolve/);
  assert.match(text.stdout, /in production +\? unknown/);
});

// ── 4. Narrowing ──────────────────────────────────────────────────────────

test("--target, --env and --count narrow the answer, and an undeclared name fails", () => {
  const { dir, ids } = pipelineRepo();
  assert.deepEqual(statusJson(dir, "--target", "docs").targets.map((t) => t.target), ["docs"]);

  const env = statusJson(dir, "--env", "production");
  assert.deepEqual(env.targets.map((t) => [t.target, t.buckets.map((b) => b.label)]), [
    ["web", ["in test, waiting for production"]],
  ]);
  assert.deepEqual(env.targets[0].buckets[0].tasks.map((t) => t.id), [ids.halfway]);
  assert.deepEqual(statusJson(dir, "--env", "web/test").targets[0].buckets[0].tasks.map((t) => t.id), [ids.merged]);

  const counted = statusJson(dir, "--count");
  assert.deepEqual(counted.targets[0].buckets.map((b) => [b.count, b.tasks.length]), [[1, 0], [1, 0], [1, 0], [1, 0]]);
  const text = run(dir, ["deploy", "status", "--dir", "backlog", "--count"]);
  assert.doesNotMatch(text.stdout, new RegExp(ids.merged));

  // An undeclared NAME is a refusal (1), contradicting or malformed flags a
  // usage error (2) — TL-533.
  for (const [args, message, exit] of [
    [["--target", "mobile"], /not a declared deploy target/, 1],
    [["--env", "staging"], /not a declared stage/, 1],
    [["--target", "docs", "--env", "web/test"], /names target `web`/, 2],
    [["--target", "docs", "--env", "test"], /declares no stage `test`/, 1],
    [["--frobnicate"], /unknown flag: --frobnicate/, 2],
    [["--env"], /with no value/, 2],
  ]) {
    const r = run(dir, ["deploy", "status", "--dir", "backlog", ...args]);
    assert.equal(r.status, exit, args.join(" "));
    assert.match(r.stderr, message);
  }
});

test("without deploy_targets the command says why the answer is empty, and exits 0", () => {
  const dir = backlogRepo();
  const r = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /declares no `deploy_targets`/);
  const json = statusJson(dir);
  assert.equal(json.scan.reason, "no-targets");
  assert.deepEqual(json.targets, []);
});

test("release <ID> still releases: moving the subcommands to deploy left the write path alone", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Held");
  assert.equal(run(dir, ["take", id, "--dir", "backlog", "--actor", "agent:a"]).status, 0);
  const r = run(dir, ["release", id, "--dir", "backlog", "--actor", "agent:a", "--reason", "put down", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).kind, "task-release");
});

// ── 5. The trunk ──────────────────────────────────────────────────────────

test("the trunk is the remote's default branch, so a feature branch's closed task reads as off it", () => {
  const { dir, ids } = pipelineRepo();
  git(dir, ["update-ref", "refs/remotes/origin/main", "main"]);
  git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  assert.deepEqual(defaultTrunk(dir), { spec: "refs/remotes/origin/main", source: "remote-default" });
  git(dir, ["checkout", "-q", "feature"]);
  const report = statusJson(dir);
  assert.equal(report.trunk.source, "remote-default");
  assert.equal(report.trunk.sha, git(dir, ["rev-parse", "main"]));
  assert.deepEqual(buckets(report, "web")["closed, not on the trunk"], [ids.branched]);
  const text = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.match(text.stdout, /^trunk {2}refs\/remotes\/origin\/main [0-9a-f]{12} {2}\(the remote's default branch\)/m);
  // The positive control: with no origin/HEAD the fallback is HEAD — and on
  // this branch HEAD holds the task, so it is no longer off the trunk.
  git(dir, ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
  assert.deepEqual(defaultTrunk(dir), { spec: "HEAD", source: "head" });
  assert.deepEqual(buckets(statusJson(dir), "web")["closed, not on the trunk"], []);
});

test("deploy status words the trunk's source from the one shared map, for both sources", () => {
  const { dir } = pipelineRepo();
  const line = (source) => new RegExp("^trunk {2}\\S+ [0-9a-f]{12} {2}\\(" + escapeRe(TRUNK_SOURCE_TEXT[source]) + "\\)$", "m");
  assert.match(run(dir, ["deploy", "status", "--dir", "backlog"]).stdout, line("head"));
  git(dir, ["update-ref", "refs/remotes/origin/main", "main"]);
  git(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  assert.match(run(dir, ["deploy", "status", "--dir", "backlog"]).stdout, line("remote-default"));
});

/**
 * TL-518. Three readers once kept a private copy of this wording and one had
 * already drifted (the viewer's lacked its backticks). The scan is the guard;
 * environments.mjs, which must match, is its positive control — a pattern that
 * matched nothing anywhere would pass on every tree.
 */
test("no script but environments.mjs defines the wording of the trunk's source", () => {
  const signatures = [/this clone has no/, /["']the remote's default branch["']/];
  const owners = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".mjs"))
    .filter((f) => signatures.some((re) => re.test(readFileSync(join(SCRIPTS_DIR, f), "utf8"))));
  assert.deepEqual(owners, ["environments.mjs"]);
  const source = readFileSync(join(SCRIPTS_DIR, "environments.mjs"), "utf8");
  for (const re of signatures) assert.match(source, re);
  for (const text of Object.values(TRUNK_SOURCE_TEXT)) assert.ok(source.includes(text), text);
});

// ── 6. How long it has waited ─────────────────────────────────────────────

test("the wait runs from the newest commit, or from an annotated tag's date when the stage is one", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Tagged");
  const old = "2026-01-01T00:00:00Z";
  commit(dir, id + " written long ago", { "a.js": "a\n" }, { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: lib
    stages:
      - { name: tagged, ref: "refs/tags/v*" }
      - { name: published, ref: published }
`);
  const day = 86_400_000;
  const expect = (iso) => Math.floor((Date.now() - Date.parse(iso)) / day);
  // No tag yet: waiting for `tagged`, measured from the commit.
  const first = statusJson(dir).targets[0].buckets[1].tasks[0];
  assert.equal(first.id, id);
  assert.equal(first.waitedDays, expect(old));
  // An annotated tag dated later: now in `tagged`, waiting from the tag.
  const tagged = "2026-06-01T00:00:00Z";
  git(dir, ["tag", "-a", "v1.0", "-m", "release"], { GIT_COMMITTER_DATE: tagged });
  const second = statusJson(dir).targets[0].buckets[2];
  assert.equal(second.label, "in tagged, waiting for published");
  assert.equal(second.tasks[0].waitedDays, expect(tagged));
  assert.equal(second.tasks[0].since, new Date(tagged).toISOString());
});

// ── Pure parts ────────────────────────────────────────────────────────────

test("pure: flags, filters, and a pipeline with no tasks still has every bucket at zero", () => {
  assert.deepEqual(parseStatusArgs(["--count", "--target", "web"]), { target: "web", env: null, release: null, count: true, json: false });
  assert.throws(() => parseStatusArgs(["web"]), /unexpected argument/);
  const targets = [{ name: "web", paths: [], stages: [{ name: "test", refs: ["test"] }, { name: "prod", refs: ["prod"] }] }];
  assert.deepEqual(resolveFilter({ target: null, env: "web/prod" }, targets), { ok: true, target: "web", stage: "prod" });
  assert.equal(resolveFilter({ target: "app", env: null }, targets).ok, false);
  const out = releasePipeline({
    state: { refs: [], byTask: new Map() }, targets, tasks: new Map(), commitTimes: new Map(),
    tagTimes: new Map(), offTrunk: [], now: Date.now(),
  });
  assert.deepEqual(out[0].buckets.map((b) => [b.label, b.count]), [
    ["closed, not on the trunk", 0], ["on the trunk, waiting for test", 0],
    ["in test, waiting for prod", 0], ["in prod", 0],
  ]);
});
