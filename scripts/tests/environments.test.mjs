/**
 * Which environment a task has reached, computed from git (TL-501).
 *
 * WHAT HAS TO BE PROVED, each against a real fixture repository because the
 * claim is about what git says, not about a parser:
 *
 *   1. Full, partial and absent per target and stage, for a branch per
 *      environment, release tags resolved by VERSION sort, two targets selected
 *      by paths, and a stage of two parallel refs of which only one holds the
 *      task.
 *   2. A squash merge and a merge commit give the same answer as a linear
 *      history; a cherry-picked hotfix counts by patch identity, not by SHA.
 *   3. A rollback — a ref moved back — removes a task from a stage.
 *   4. An unresolvable ref is UNKNOWN, never empty.
 *   5. The `deploy_targets:` shape fails on every malformed form, with a
 *      positive control that a correct one loads.
 *   6. `query --env` / `--not-env` / `--json` carry the answer, and an
 *      undeclared stage fails.
 *
 * Task ids use the foreign prefix `PROJ` so `renumber` never mistakes them for
 * references into this repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseConfigYaml } from "../config.mjs";
import { pathInTarget, readDeployTargets } from "../deploy-targets.mjs";
import {
  deploymentState, describeTaskDeployment, explain, parseCherry, parseStageSelector,
  stageMatches, taskDeployment,
} from "../environments.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("environments");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-env-" + counter++ + "-"));
  git(dir, "init", "-q", "-b", "main", ".");
  return dir;
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

/** Targets from config.yaml text, through the real reader and validator. */
function targets(yaml) {
  const parsed = parseConfigYaml(yaml);
  assert.deepEqual(parsed.problems, []);
  return parsed.values.deploy_targets;
}

function state(dir, yaml) {
  return deploymentState({ root: dir, prefix: "PROJ", targets: targets(yaml) });
}

/** `target/stage → state` for one task, compact enough to assert in one line. */
function stages(st, id) {
  const out = {};
  for (const t of taskDeployment(st, id).targets) {
    for (const s of t.stages) out[t.target + "/" + s.stage] = s.state;
  }
  return out;
}

const BRANCHES = `deploy_targets:
  - name: app
    stages:
      - { name: test, ref: main }
      - { name: production, ref: production }
`;

// ── 1. Layouts ───────────────────────────────────────────────────────────

test("a branch per environment: full where the branch holds the task, absent where it does not", () => {
  const dir = repo();
  commit(dir, "PROJ-1 the first thing", { "a.txt": "a\n" });
  git(dir, "branch", "production");
  commit(dir, "PROJ-2 the second thing", { "b.txt": "b\n" });

  const st = state(dir, BRANCHES);
  assert.equal(st.reason, "ok");
  assert.deepEqual(stages(st, "PROJ-1"), { "app/test": "full", "app/production": "full" });
  assert.deepEqual(stages(st, "PROJ-2"), { "app/test": "full", "app/production": "absent" });
  assert.equal(taskDeployment(st, "PROJ-1").targets[0].reached, "production");
  assert.equal(taskDeployment(st, "PROJ-2").targets[0].reached, "test");
  // Every resolved ref is named with its SHA: the answer is only as fresh as it.
  const prod = st.refs.find((r) => r.stage === "production");
  assert.equal(prod.sha, git(dir, "rev-parse", "production"));
});

test("release tags: a glob resolves to the newest tag by VERSION sort, not by name or date", () => {
  const dir = repo();
  const first = commit(dir, "PROJ-1 first", { "a.txt": "a\n" });
  commit(dir, "PROJ-2 second", { "b.txt": "b\n" });
  // Alphabetically `v1.2` sorts after `v1.10`, and it is also the newer tag by
  // date. Version sort says `v1.10` is the release — which holds only PROJ-1.
  git(dir, "tag", "v1.10", first);
  git(dir, "tag", "v1.2", "HEAD");

  const st = state(dir, `deploy_targets:
  - name: lib
    stages:
      - { name: tagged, ref: "refs/tags/v*" }
`);
  assert.equal(st.refs[0].ref, "refs/tags/v1.10");
  assert.deepEqual(stages(st, "PROJ-1"), { "lib/tagged": "full" });
  assert.deepEqual(stages(st, "PROJ-2"), { "lib/tagged": "absent" });
});

test("two targets selected by paths: a task belongs to the targets its commits touched", () => {
  const dir = repo();
  commit(dir, "PROJ-3 backend only", { "backend/x.js": "x\n" });
  commit(dir, "PROJ-4 app only", { "app/y.js": "y\n" });
  git(dir, "branch", "production");
  git(dir, "tag", "mobile-v1");
  commit(dir, "PROJ-5 both halves", { "backend/z.js": "z\n", "app/z.js": "z\n" });
  commit(dir, "PROJ-6 neither", { "README.md": "r\n" });

  const st = state(dir, `deploy_targets:
  - name: backend
    paths: [backend/]
    stages:
      - { name: production, ref: production }
  - name: mobile
    paths: [app/]
    stages:
      - { name: tagged, ref: "refs/tags/mobile-v*" }
`);
  assert.deepEqual(stages(st, "PROJ-3"), { "backend/production": "full" });
  assert.deepEqual(stages(st, "PROJ-4"), { "mobile/tagged": "full" });
  assert.deepEqual(stages(st, "PROJ-5"), { "backend/production": "absent", "mobile/tagged": "absent" });
  // A commit outside every target is named as such, not attributed to one.
  assert.deepEqual(taskDeployment(st, "PROJ-6").targets, []);
  assert.equal(taskDeployment(st, "PROJ-6").untargeted.length, 1);
  assert.match(describeTaskDeployment(taskDeployment(st, "PROJ-6"))[0], /touch no deploy target/);
});

test("parallel refs: a stage is reached only in every ref, and the answer names which hold it", () => {
  const dir = repo();
  commit(dir, "PROJ-1 the change", { "a.txt": "a\n" });
  git(dir, "branch", "prod-us", "HEAD");
  git(dir, "update-ref", "refs/deploys/app/production-eu", "HEAD");
  commit(dir, "PROJ-2 later", { "b.txt": "b\n" });
  git(dir, "update-ref", "refs/deploys/app/production-eu", "HEAD");

  const st = state(dir, `deploy_targets:
  - name: app
    stages:
      - name: production
        refs: [refs/deploys/app/production-eu, prod-us]
`);
  const p2 = taskDeployment(st, "PROJ-2").targets[0].stages[0];
  assert.equal(p2.state, "partial");
  assert.deepEqual(p2.holding, ["refs/deploys/app/production-eu"]);
  assert.deepEqual(p2.refs.map((r) => r.state), ["full", "absent"]);
  assert.equal(stageMatches(taskDeployment(st, "PROJ-2"), { target: null, stage: "production" }), "not-full");
  assert.match(describeTaskDeployment(taskDeployment(st, "PROJ-2"))[0], /production partial \(refs\/deploys\/app\/production-eu\)/);
  // The positive control: in both, it is full.
  assert.deepEqual(stages(st, "PROJ-1"), { "app/production": "full" });
  assert.equal(stageMatches(taskDeployment(st, "PROJ-1"), { target: null, stage: "production" }), "full");
});

// ── 2. Merges and cherry-picks ────────────────────────────────────────────

test("a squash merge counts the squashed commit; the branch commits it replaced are ignored", () => {
  const dir = repo();
  commit(dir, "PROJ-1 base", { "a.txt": "a\n" });
  git(dir, "checkout", "-q", "-b", "feature");
  commit(dir, "PROJ-7 work in progress", { "f.txt": "1\n" });
  commit(dir, "PROJ-7 more work", { "f.txt": "2\n" });
  git(dir, "checkout", "-q", "main");
  git(dir, "merge", "-q", "--squash", "feature");
  git(dir, "commit", "-q", "-m", "PROJ-7 the feature");
  const squash = git(dir, "rev-parse", "HEAD");
  git(dir, "branch", "production");

  const st = state(dir, BRANCHES);
  assert.deepEqual(taskDeployment(st, "PROJ-7").commits, [squash]);
  assert.deepEqual(stages(st, "PROJ-7"), { "app/test": "full", "app/production": "full" });
});

test("a merge commit gives the same answer: the branch commits count, the merge itself does not", () => {
  const dir = repo();
  commit(dir, "PROJ-1 base", { "a.txt": "a\n" });
  git(dir, "checkout", "-q", "-b", "feature");
  const work = commit(dir, "PROJ-8 the work", { "f.txt": "1\n" });
  git(dir, "checkout", "-q", "main");
  commit(dir, "PROJ-1 meanwhile", { "a.txt": "b\n" });
  git(dir, "merge", "-q", "--no-ff", "-m", "Merge PROJ-8", "feature");
  git(dir, "branch", "production");

  const st = state(dir, BRANCHES);
  assert.deepEqual(taskDeployment(st, "PROJ-8").commits, [work]);
  assert.deepEqual(stages(st, "PROJ-8"), { "app/test": "full", "app/production": "full" });
});

test("a cherry-picked hotfix is in production by patch identity, not by SHA", () => {
  const dir = repo();
  commit(dir, "PROJ-1 base", { "a.txt": "a\n" });
  git(dir, "branch", "production");
  // Trunk work the hotfix lands after, so the pick has a different parent.
  commit(dir, "PROJ-1 trunk moves on", { "a.txt": "b\n" });
  const fix = commit(dir, "PROJ-9 the hotfix", { "fix.txt": "fixed\n" });
  commit(dir, "PROJ-10 not released", { "later.txt": "l\n" });
  git(dir, "checkout", "-q", "production");
  git(dir, "cherry-pick", fix);
  git(dir, "checkout", "-q", "main");
  assert.notEqual(git(dir, "rev-parse", "production"), fix, "the fixture must give the pick a SHA of its own");

  const st = state(dir, BRANCHES);
  assert.deepEqual(stages(st, "PROJ-9"), { "app/test": "full", "app/production": "full" });
  // The negative control: the commit that was NOT picked is absent.
  assert.deepEqual(stages(st, "PROJ-10"), { "app/test": "full", "app/production": "absent" });
});

test("a task with some commits in a stage and later ones outside it is partial", () => {
  const dir = repo();
  commit(dir, "PROJ-11 first half", { "a.txt": "a\n" });
  git(dir, "branch", "production");
  commit(dir, "PROJ-11 second half", { "b.txt": "b\n" });

  const st = state(dir, BRANCHES);
  assert.deepEqual(stages(st, "PROJ-11"), { "app/test": "full", "app/production": "partial" });
  const ref = taskDeployment(st, "PROJ-11").targets[0].stages[1].refs[0];
  assert.deepEqual([ref.held, ref.of], [1, 2]);
  assert.equal(stageMatches(taskDeployment(st, "PROJ-11"), { target: null, stage: "production" }), "not-full");
});

// ── 3. Rollback ───────────────────────────────────────────────────────────

test("a rollback — the ref moved back — removes the task from the stage", () => {
  const dir = repo();
  const before = commit(dir, "PROJ-1 base", { "a.txt": "a\n" });
  commit(dir, "PROJ-12 shipped, then rolled back", { "b.txt": "b\n" });
  git(dir, "branch", "production");
  assert.deepEqual(stages(state(dir, BRANCHES), "PROJ-12")["app/production"], "full");

  git(dir, "branch", "-f", "production", before);
  assert.deepEqual(stages(state(dir, BRANCHES), "PROJ-12")["app/production"], "absent");
});

// ── 4. Unknown and empty ──────────────────────────────────────────────────

test("an unresolvable ref is unknown, never empty", () => {
  const dir = repo();
  commit(dir, "PROJ-1 base", { "a.txt": "a\n" });
  const st = state(dir, `deploy_targets:
  - name: app
    stages:
      - { name: test, ref: main }
      - { name: production, ref: origin/production }
      - { name: tagged, ref: "refs/tags/app-v*" }
`);
  assert.deepEqual(stages(st, "PROJ-1"), { "app/test": "full", "app/production": "unknown", "app/tagged": "unknown" });
  assert.deepEqual(st.unknownRefs.map((r) => r.spec), ["origin/production", "refs/tags/app-v*"]);
  assert.equal(stageMatches(taskDeployment(st, "PROJ-1"), { target: null, stage: "production" }), "unknown");
  assert.equal(taskDeployment(st, "PROJ-1").targets[0].reached, "test");
});

test("an empty answer says which empty it is", () => {
  assert.equal(deploymentState({ root: "/x", prefix: "PROJ", targets: [] }).reason, "no-targets");
  assert.equal(deploymentState({ root: null, prefix: "PROJ", targets: targets(BRANCHES) }).reason, "no-git");

  const empty = repo();
  assert.equal(state(empty, BRANCHES).reason, "no-trunk");

  const noIds = repo();
  commit(noIds, "just some work", { "a.txt": "a\n" });
  const st = state(noIds, BRANCHES);
  assert.equal(st.reason, "no-task-ids-in-commits");
  // A task with no commits has an EMPTY entry, not a missing one.
  assert.deepEqual(taskDeployment(st, "PROJ-1"), { id: "PROJ-1", commits: [], targets: [], untargeted: [] });
  for (const r of ["no-targets", "no-git", "no-trunk", "git-failed", "no-task-ids-in-commits"]) {
    assert.ok(explain(r), r + " has no explanation");
  }
  assert.equal(explain("ok"), null);
});

test("another project's ids are not read — the prefix comes from the caller", () => {
  const dir = repo();
  commit(dir, "OTHER-1 somebody else's convention", { "a.txt": "a\n" });
  assert.equal(state(dir, BRANCHES).byTask.size, 0);
  const st = deploymentState({ root: dir, prefix: "OTHER", targets: targets(BRANCHES) });
  assert.equal(st.byTask.size, 1);
});

test("`git cherry` output: `+` is missing, `-` is held by patch identity", () => {
  const missing = parseCherry("+ " + "a".repeat(40) + "\n- " + "b".repeat(40) + "\n");
  assert.deepEqual([...missing], ["a".repeat(40)]);
});

// ── 5. The configuration shape ────────────────────────────────────────────

test("a well-formed deploy_targets loads, with both stage spellings normalised (positive control)", () => {
  const t = targets(`deploy_targets:
  - name: web   # a comment
    paths:
      - web/
      - api/
    stages:
      - { name: test, ref: origin/main }
      - name: production
        refs: [refs/deploys/web/eu, refs/deploys/web/us]
`);
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].paths, ["web/", "api/"]);
  assert.deepEqual(t[0].stages.map((s) => [s.name, s.refs, s.parallel]), [
    ["test", ["origin/main"], false],
    ["production", ["refs/deploys/web/eu", "refs/deploys/web/us"], true],
  ]);
});

test("every malformed form of deploy_targets fails", () => {
  const cases = [
    ["deploy_targets: []", /non-empty list of targets/],
    // `recorded` is a key since TL-506; a misspelling of it still fails.
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: refs/deploys/a/s, recoded: true }", /unknown key `recoded`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: x, recorded: true }", /a recorded stage needs a full ref name/],
    ["deploy_targets:\n  - name: a\n    path: [x/]\n    stages:\n      - { name: s, ref: x }", /unknown key `path`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: x, refs: [y] }", /exactly one of `ref`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s }", /exactly one of `ref`/],
    ["deploy_targets:\n  - name: a\n    stages: []", /`stages`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: x }\n  - name: a\n    stages:\n      - { name: s, ref: x }", /duplicate target name `a`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: x }\n      - { name: s, ref: y }", /duplicate stage name `s`/],
    ["deploy_targets:\n  - name: a/b\n    stages:\n      - { name: s, ref: x }", /`name` = `a\/b`/],
    ["deploy_targets:\n  - name: a\n    stages:\n      - { name: s, ref: \"v*\" }", /must be a full ref name/],
    ["deploy_targets:\n  - name: a\n    paths: []\n    stages:\n      - { name: s, ref: x }", /`paths`/],
  ];
  for (const [yaml, re] of cases) {
    const problems = parseConfigYaml(yaml + "\n").problems;
    assert.ok(problems.some((p) => re.test(p)), yaml + "\n→ " + JSON.stringify(problems));
  }
});

test("paths select a directory with a trailing slash, a file or directory without one, and never a prefix", () => {
  const { targets: [t] } = readDeployTargets("", ["  - name: a", "    paths: [web/, api, package.json]", "    stages:", "      - { name: s, ref: x }"]);
  assert.equal(pathInTarget(t, "web/index.js"), true);
  assert.equal(pathInTarget(t, "api/x.js"), true);
  assert.equal(pathInTarget(t, "package.json"), true);
  assert.equal(pathInTarget(t, "apis/x.js"), false);
  assert.equal(pathInTarget(t, "website/x.js"), false);
});

test("a stage selector is validated against the declared stages", () => {
  const t = targets(BRANCHES);
  assert.deepEqual(parseStageSelector("production", t), { ok: true, target: null, stage: "production" });
  assert.deepEqual(parseStageSelector("app/test", t), { ok: true, target: "app", stage: "test" });
  assert.equal(parseStageSelector("prod", t).ok, false);
  assert.equal(parseStageSelector("web/test", t).ok, false);
  assert.equal(parseStageSelector("production", []).ok, false);
});

// ── 6. The command surface ────────────────────────────────────────────────

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlogRepo() {
  const dir = repo();
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

test("query --env and --not-env answer from git, and --json carries the stages and the refs read", () => {
  const dir = backlogRepo();
  const shipped = newTask(dir, "Shipped already");
  commit(dir, shipped + " it ships", { "src/a.js": "a\n" });
  git(dir, "branch", "production");
  const waiting = newTask(dir, "Waiting for production");
  commit(dir, waiting + " it waits", { "src/b.js": "b\n" });
  const never = newTask(dir, "Never committed");
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    paths: [src/]
    stages:
      - { name: test, ref: main }
      - { name: production, ref: production }
`);

  const ids = (...args) => {
    const r = run(dir, ["query", "--dir", "backlog", "--status", "pending", "--json", ...args]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(ids("--env", "production").tasks.map((t) => t.id), [shipped]);
  assert.deepEqual(ids("--not-env", "production").tasks.map((t) => t.id), [waiting]);
  assert.deepEqual(ids("--env", "app/test").tasks.map((t) => t.id).sort(), [shipped, waiting].sort());
  // A task with no commits is neither in nor out.
  assert.ok(!ids("--not-env", "test").tasks.some((t) => t.id === never));

  const all = ids();
  const row = all.tasks.find((t) => t.id === waiting);
  assert.deepEqual(row.deploy.targets[0].stages.map((s) => [s.stage, s.state]), [["test", "full"], ["production", "absent"]]);
  assert.equal(all.tasks.find((t) => t.id === never).deploy.commits, 0);
  assert.equal(all.deploy.reason, "ok");
  assert.equal(all.deploy.refs.find((r) => r.stage === "production").sha, git(dir, "rev-parse", "production"));

  const bad = run(dir, ["query", "--dir", "backlog", "--env", "prod"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a declared stage/);

  const count = run(dir, ["query", "--dir", "backlog", "--status", "pending", "--not-env", "production", "--count"]);
  assert.equal(count.stdout.trim(), "1");
});

test("an unresolvable ref is reported by query, and the tasks hanging on it match neither flag", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Somewhere");
  commit(dir, id + " it lands", { "a.js": "a\n" });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    stages:
      - { name: production, ref: origin/production }
`);
  for (const flag of ["--env", "--not-env"]) {
    const r = run(dir, ["query", "--dir", "backlog", "--status", "pending", flag, "production"]);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, new RegExp("id: " + id));
    assert.match(r.stdout, /`origin\/production` is unknown/);
  }
});

test("without deploy_targets the JSON says nobody computed it, and --env fails", () => {
  const dir = backlogRepo();
  newTask(dir, "Anything");
  const json = JSON.parse(run(dir, ["query", "--dir", "backlog", "--json"]).stdout);
  assert.equal(json.deploy, null);
  assert.equal(json.tasks[0].deploy, null);
  const r = run(dir, ["query", "--dir", "backlog", "--env", "production"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /declares no `deploy_targets`/);
});

test("a malformed deploy_targets stops every command, like any other configuration error", () => {
  const dir = backlogRepo();
  appendFileSync(join(dir, "backlog", "config.yaml"), "\ndeploy_targets:\n  - name: app\n    stages:\n      - { name: p, rev: main }\n");
  const r = run(dir, ["query", "--dir", "backlog"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown key `rev`/);
});
