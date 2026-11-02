/**
 * A promotion with a gap in its traceability fails the check (TL-503).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because every gap
 * is a claim about what git holds:
 *
 *   1. POSITIVE CONTROL: one fixture carrying every gap, and each is
 *      reported with the commit or task that proves it.
 *   2. A clean fixture reports nothing — and the same code path reported every
 *      gap kind a moment earlier, so the silence has evidential force.
 *   3. Commits older than the first one naming a task id are not judged.
 *   4. A hotfix cherry-picked back onto the trunk is no longer a gap (patch
 *      identity), and `--env` narrows the stage-bound gaps to one stage.
 *   5. The mode: `report` exits 0 with the gaps printed, `require` exits 1,
 *      an accepted gap stops blocking, an unknown gap name or mode fails the
 *      configuration, and an unresolved ref blocks under `require` — the
 *      trunk included: one that does not resolve in a repository with
 *      commits is `trunk-unresolved`, never "nothing deployed yet".
 *   6. The command surface: `check --release`, `--env`, `--trunk`, `--json`,
 *      and the refusals of `--env`/`--trunk` without `--release`.
 *   7. `defaultTrunk()`: the remote default branch, else `HEAD`.
 *
 * Task ids use the foreign prefix `PROJ` in the library fixtures, so
 * `renumber` never mistakes them for references into this repository.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { parseConfigYaml } from "../config.mjs";
import { defaultTrunk } from "../environments.mjs";
import { GAP_NAMES, gateVerdict, releaseGaps } from "../release-gaps.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-gaps");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-gaps-" + counter++ + "-"));
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

const TARGETS = `deploy_targets:
  - name: app
    paths: [src/]
    stages:
      - { name: staging, ref: staging }
      - name: production
        refs: [prod-eu, prod-us]
`;

function config(extra = {}) {
  const parsed = parseConfigYaml(TARGETS);
  assert.deepEqual(parsed.problems, []);
  return {
    taskIdPrefix: "PROJ",
    deployTargets: parsed.values.deploy_targets,
    archivedStatuses: ["done", "cancelled"],
    priorities: ["P0", "P1"],
    // PROJ-8 is planned for `r1`, the only release and therefore the current
    // one (TL-515): only the current release's blockers are judged.
    releases: ["r1"],
    releaseGateAccept: [],
    ...extra,
  };
}

const TRUNK = { spec: "main", source: "flag" };

/**
 * Every gap at once. Layout of `main`, oldest first:
 *
 *   c0  no id, before adoption          → not judged
 *   c1  PROJ-1                          clean
 *   c2  no id                           → untracked-commit
 *   c3  PROJ-2 (in progress)            → open-task-deployed
 *   c4  PROJ-99 (no task file)          → unknown-task-id
 *   c5  PROJ-3, docs only               → untargeted-commit      ← staging, prod-us
 *   c6  PROJ-5                          → partial-task (eu holds it, us does not)
 *   c7  PROJ-4 part one                 → stage-only-commit vs staging ← prod-eu
 *   c8  PROJ-4 part two                 → PROJ-4 partial-task in prod-eu
 *
 * plus a hotfix PROJ-6 on prod-eu only (stage-only-commit, missing from the
 * trunk) and PROJ-7 done on an unmerged branch (done-not-on-trunk), plus
 * PROJ-8, open at the top priority and planned for a release with no commit
 * yet (planned-blocker-open, TL-505).
 */
function everyGap() {
  const dir = repo();
  const c = {};
  c.c0 = commit(dir, "initial import", { "src/zero.js": "0\n" });
  c.c1 = commit(dir, "PROJ-1 the first", { "src/a.js": "a\n" });
  c.c2 = commit(dir, "a change nobody filed", { "src/b.js": "b\n" });
  c.c3 = commit(dir, "PROJ-2 unfinished", { "src/c.js": "c\n" });
  c.c4 = commit(dir, "PROJ-99 a ghost", { "src/d.js": "d\n" });
  c.c5 = commit(dir, "PROJ-3 documentation", { "docs/x.md": "x\n" });
  git(dir, "branch", "staging");
  git(dir, "branch", "prod-us");
  c.c6 = commit(dir, "PROJ-5 one region", { "src/g.js": "g\n" });
  c.c7 = commit(dir, "PROJ-4 part one", { "src/e.js": "e\n" });
  git(dir, "branch", "prod-eu");
  c.c8 = commit(dir, "PROJ-4 part two", { "src/f.js": "f\n" });
  git(dir, "checkout", "-q", "prod-eu");
  c.hotfix = commit(dir, "PROJ-6 hotfix", { "src/h.js": "h\n" });
  git(dir, "checkout", "-q", "-b", "feature", "main");
  c.unmerged = commit(dir, "PROJ-7 finished and never merged", { "src/i.js": "i\n" });
  git(dir, "checkout", "-q", "main");
  return { dir, c };
}

const TASKS = [
  { id: "PROJ-1", status: "done" },
  { id: "PROJ-2", status: "in_progress" },
  { id: "PROJ-3", status: "done" },
  { id: "PROJ-4", status: "done" },
  { id: "PROJ-5", status: "done" },
  { id: "PROJ-6", status: "done" },
  { id: "PROJ-7", status: "done" },
  { id: "PROJ-8", status: "pending", priority: "P0", release: "r1" },
];

function byGap(result) {
  const out = {};
  for (const g of result.gaps) (out[g.gap] = out[g.gap] || []).push(g);
  return out;
}

// ── 1. The positive control ─────────────────────────────────────────────

test("every gap is detected, each with the commit or task that proves it", () => {
  const { dir, c } = everyGap();
  const result = releaseGaps({ root: dir, config: config(), tasks: TASKS, trunk: TRUNK });
  assert.equal(result.reason, "ok");
  const gaps = byGap(result);
  assert.deepEqual(Object.keys(gaps).sort(), [...GAP_NAMES].sort(), JSON.stringify(result.gaps, null, 2));

  assert.deepEqual(gaps["untracked-commit"].map((g) => g.subject), [c.c2]);
  assert.deepEqual(gaps["untracked-commit"][0].where.sort(),
    ["app/production (prod-eu)", "app/production (prod-us)", "app/staging"]);
  assert.deepEqual(gaps["open-task-deployed"].map((g) => g.subject), ["PROJ-2"]);
  assert.deepEqual(gaps["open-task-deployed"][0].commits, [c.c3]);
  assert.deepEqual(gaps["unknown-task-id"].map((g) => [g.subject, g.commits]), [["PROJ-99", [c.c4]]]);
  assert.deepEqual(gaps["untargeted-commit"].map((g) => g.subject), [c.c5]);

  const partial = Object.fromEntries(gaps["partial-task"].map((g) => [g.subject, g]));
  assert.deepEqual(Object.keys(partial).sort(), ["PROJ-4", "PROJ-5"]);
  assert.deepEqual(partial["PROJ-4"].where, ["app/production (prod-eu)"]);
  assert.deepEqual(partial["PROJ-4"].commits, [c.c8]);
  // A task in one region and missing from the other names the region missing it.
  assert.deepEqual(partial["PROJ-5"].where, ["app/production (prod-us)"]);

  const stageOnly = Object.fromEntries(gaps["stage-only-commit"].map((g) => [g.subject, g.detail]));
  assert.match(stageOnly[c.hotfix], /missing from the trunk/);
  assert.match(stageOnly[c.c6], /earlier stage app\/staging/);
  assert.match(stageOnly[c.c7], /earlier stage app\/staging/);

  // The hotfix's task is done and no trunk commit names it either: the same
  // revert risk, seen from the task's side.
  assert.deepEqual(gaps["done-not-on-trunk"].map((g) => [g.subject, g.commits]),
    [["PROJ-6", [c.hotfix]], ["PROJ-7", [c.unmerged]]]);

  // No commit yet, so it holds back the last stage of every target.
  assert.deepEqual(gaps["planned-blocker-open"].map((g) => [g.subject, g.where]), [["PROJ-8", ["app/production"]]]);

  // The adoption boundary: the import before the first id is not judged.
  assert.equal(result.excludedBeforeAdoption, 1);
  assert.ok(!result.gaps.some((g) => g.commits.indexOf(c.c0) >= 0));
  // Every ref read is named with its SHA.
  assert.equal(result.refs.find((r) => r.spec === "prod-eu").sha, git(dir, "rev-parse", "prod-eu"));
});

// ── 2. The clean fixture ────────────────────────────────────────────────

test("a clean promotion reports no gap", () => {
  const dir = repo();
  commit(dir, "PROJ-1 the first", { "src/a.js": "a\n" });
  commit(dir, "PROJ-2 the second", { "src/b.js": "b\n" });
  for (const b of ["staging", "prod-eu", "prod-us"]) git(dir, "branch", b);
  commit(dir, "PROJ-3 waiting on the trunk", { "src/c.js": "c\n" });
  const tasks = [{ id: "PROJ-1", status: "done" }, { id: "PROJ-2", status: "done" }, { id: "PROJ-3", status: "done" }];
  const result = releaseGaps({ root: dir, config: config(), tasks, trunk: TRUNK });
  assert.equal(result.reason, "ok");
  assert.deepEqual(result.gaps, []);
  assert.equal(result.refs.length, 3);
  assert.equal(gateVerdict(result, "require").exit, 0);
});

// ── 4. Patch identity and --env ─────────────────────────────────────────

test("a hotfix cherry-picked back onto the trunk is no longer a stage-only commit", () => {
  const { dir, c } = everyGap();
  git(dir, "cherry-pick", c.hotfix);
  const result = releaseGaps({ root: dir, config: config(), tasks: TASKS, trunk: TRUNK });
  assert.ok(!result.gaps.some((g) => g.gap === "stage-only-commit" && g.subject === c.hotfix));
  // The positive half: the same fixture still reports the other stage-only commits.
  assert.ok(result.gaps.some((g) => g.gap === "stage-only-commit" && g.subject === c.c7));
});

test("--env narrows the stage-bound gaps to one stage; done-not-on-trunk is about the trunk and stays", () => {
  const { dir } = everyGap();
  const result = releaseGaps({
    root: dir, config: config(), tasks: TASKS, trunk: TRUNK, selector: { target: null, stage: "staging" },
  });
  const kinds = new Set(result.gaps.map((g) => g.gap));
  assert.ok(!kinds.has("partial-task"));
  assert.ok(!kinds.has("stage-only-commit"));
  assert.ok(kinds.has("untracked-commit"));
  assert.ok(kinds.has("done-not-on-trunk"));
  assert.deepEqual(result.refs.map((r) => r.spec), ["staging"]);
  for (const g of result.gaps) for (const w of g.where) assert.ok(!/production/.test(w), w);
});

// ── 5. Mode, accepted gaps, unknown refs ────────────────────────────────

test("report never blocks; require blocks on any gap not accepted; accepted gaps stay visible", () => {
  const { dir } = everyGap();
  const all = releaseGaps({ root: dir, config: config(), tasks: TASKS, trunk: TRUNK });
  assert.equal(gateVerdict(all, "report").exit, 0);
  assert.equal(gateVerdict(all, "require").exit, 1);

  const most = releaseGaps({
    root: dir, config: config({ releaseGateAccept: GAP_NAMES.filter((g) => g !== "partial-task") }), tasks: TASKS, trunk: TRUNK,
  });
  const verdict = gateVerdict(most, "require");
  assert.equal(verdict.exit, 1);
  assert.deepEqual([...new Set(verdict.blocking.map((g) => g.gap))], ["partial-task"]);
  assert.ok(most.gaps.some((g) => g.accepted));

  const every = releaseGaps({ root: dir, config: config({ releaseGateAccept: [...GAP_NAMES] }), tasks: TASKS, trunk: TRUNK });
  assert.equal(gateVerdict(every, "require").exit, 0);
  assert.equal(every.gaps.length, all.gaps.length);
});

test("an unresolved stage ref is unknown, and blocks under require", () => {
  const dir = repo();
  commit(dir, "PROJ-1 the first", { "src/a.js": "a\n" });
  git(dir, "branch", "staging");
  git(dir, "branch", "prod-eu");
  const result = releaseGaps({ root: dir, config: config(), tasks: [{ id: "PROJ-1", status: "done" }], trunk: TRUNK });
  assert.deepEqual(result.unknownRefs.map((r) => r.spec), ["prod-us"]);
  assert.deepEqual(result.gaps, []);
  assert.equal(gateVerdict(result, "report").exit, 0);
  assert.equal(gateVerdict(result, "require").exit, 1);
});

test("a trunk that does not resolve is unresolved, not an empty repository, and blocks under require", () => {
  const dir = repo();
  commit(dir, "PROJ-1 the first", { "src/a.js": "a\n" });
  for (const b of ["staging", "prod-eu", "prod-us"]) git(dir, "branch", b);
  const tasks = [{ id: "PROJ-1", status: "done" }];

  // Positive control: the same fixture with a trunk that resolves is judged.
  const good = releaseGaps({ root: dir, config: config(), tasks, trunk: TRUNK });
  assert.equal(good.scanned, true);
  assert.equal(gateVerdict(good, "require").exit, 0);

  for (const trunk of [{ spec: "origin/mian", source: "flag" }, { spec: "refs/remotes/origin/main", source: "remote-default" }]) {
    const bad = releaseGaps({ root: dir, config: config(), tasks, trunk });
    assert.equal(bad.scanned, false, trunk.source);
    assert.equal(bad.reason, "trunk-unresolved", trunk.source);
    assert.equal(gateVerdict(bad, "report").exit, 0);
    assert.equal(gateVerdict(bad, "require").exit, 1);
  }

  // Only a repository with no commit at all, and a trunk not chosen by hand,
  // is "nothing can have been deployed".
  const empty = repo();
  const none = releaseGaps({ root: empty, config: config(), tasks: [], trunk: { spec: "HEAD", source: "head" } });
  assert.equal(none.reason, "no-trunk");
  assert.equal(gateVerdict(none, "require").exit, 0);
  const named = releaseGaps({ root: empty, config: config(), tasks: [], trunk: { spec: "main", source: "flag" } });
  assert.equal(named.reason, "trunk-unresolved");
});

// ── 7. The trunk ────────────────────────────────────────────────────────

test("defaultTrunk is the remote's default branch, else HEAD", () => {
  const upstream = repo();
  commit(upstream, "PROJ-1 the first", { "a.txt": "a\n" });
  assert.deepEqual(defaultTrunk(upstream), { spec: "HEAD", source: "head" });
  assert.deepEqual(defaultTrunk(null), { spec: "HEAD", source: "head" });

  const clone = mkdtempSync(join(tmpdir(), "branchling-gaps-clone-"));
  execFileSync("git", ["clone", "-q", upstream, clone]);
  assert.deepEqual(defaultTrunk(clone), { spec: "refs/remotes/origin/main", source: "remote-default" });
});

// ── 6. The command surface ──────────────────────────────────────────────

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z][A-Za-z0-9]*-\d+/)[0];
}

function setStatus(dir, id, status) {
  const tasks = join(dir, "backlog", "tasks");
  const file = readdirSync(tasks).find((f) => f.startsWith(id + "-"));
  const path = join(tasks, file);
  writeFileSync(path, readFileSync(path, "utf8").replace(/^status: \S+/m, "status: " + status), "utf8");
}

function cliFixture() {
  const dir = repo();
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the backlog");
  const shipped = newTask(dir, "Shipped already");
  setStatus(dir, shipped, "done");
  commit(dir, shipped + " it ships", { "src/a.js": "a\n" });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: app
    stages:
      - { name: test, ref: main }
      - { name: production, ref: production }
`);
  return { dir, shipped };
}

test("check --release: report prints the gaps and exits 0, require exits 1, accepting them exits 0", () => {
  const { dir } = cliFixture();
  const untracked = commit(dir, "a change nobody filed", { "src/b.js": "b\n" });
  git(dir, "branch", "production");

  const report = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(report.status, 0, report.stderr);
  assert.match(report.stdout, /trunk: main [0-9a-f]{12} \(named by --trunk\)/);
  assert.match(report.stdout, new RegExp("untracked-commit  " + untracked.slice(0, 12)));
  assert.match(report.stdout, /release_gate: report/);

  appendFileSync(join(dir, "backlog", "config.yaml"), "\nrelease_gate: require\n");
  const required = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(required.status, 1, required.stdout);
  assert.match(required.stdout, /refuses the promotion/);

  appendFileSync(join(dir, "backlog", "config.yaml"), "release_gate_accept: [untracked-commit]\n");
  const accepted = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(accepted.status, 0, accepted.stdout);
  assert.match(accepted.stdout, /untracked-commit \(accepted\)/);

  const json = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main", "--json"]);
  assert.equal(json.status, 0, json.stderr);
  const doc = JSON.parse(json.stdout);
  const guard = doc.guards.find((g) => g.name === "release");
  assert.equal(guard.report.mode, "require");
  assert.deepEqual(guard.report.gaps.map((g) => [g.gap, g.subject, g.accepted]), [["untracked-commit", untracked, true]]);
  assert.equal(guard.report.trunk.spec, "main");
  assert.match(guard.output, /1 gap\(s\), 1 accepted/);
});

test("check --release with a --trunk naming nothing fails under require and names the trunk", () => {
  const { dir } = cliFixture();
  git(dir, "branch", "production");
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nrelease_gate: require\n");

  // Positive control: the same fixture with a trunk that resolves is judged and passes.
  const good = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "main"]);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /0 gap\(s\)/);

  const bad = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "origin/mian"]);
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /the trunk `origin\/mian` does not resolve to a commit/);
  assert.match(bad.stdout, /check the `--trunk` value/);
  assert.match(bad.stdout, /refuses the promotion/);
  assert.doesNotMatch(bad.stdout, /no commits yet/);

  const json = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "origin/mian", "--json"]);
  assert.equal(json.status, 1, json.stdout);
  const guard = JSON.parse(json.stdout).guards.find((g) => g.name === "release");
  assert.equal(guard.report.reason, "trunk-unresolved");
  assert.equal(guard.report.ok, false);
});

test("check --release on a clean fixture passes under require, and the default trunk is named", () => {
  const { dir } = cliFixture();
  git(dir, "branch", "production");
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nrelease_gate: require\n");
  const r = run(dir, ["check", "--dir", "backlog", "--release"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /trunk: HEAD [0-9a-f]{12} \(HEAD — this clone has no `origin\/HEAD`, so pass --trunk in CI\)/);
  assert.match(r.stdout, /0 gap\(s\)/);
});

test("check --release with no deploy_targets names the trunk's real SHA, never `unresolved`", () => {
  // No `deploy_targets`: `deploymentState()` returns before it reads the trunk,
  // and the header used to print a trunk that resolves as `unresolved`.
  const dir = repo();
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the backlog");
  const head = commit(dir, "a change", { "src/a.js": "a\n" });

  for (const args of [[], ["--trunk", "main"]]) {
    const r = run(dir, ["check", "--dir", "backlog", "--release", ...args]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp("trunk: \\S+ " + head.slice(0, 12) + " \\("), args.join(" "));
    assert.doesNotMatch(r.stdout, /unresolved/, args.join(" "));
    assert.match(r.stdout, /declares no `deploy_targets`/);
  }
  const json = run(dir, ["check", "--dir", "backlog", "--release", "--json"]);
  const guard = JSON.parse(json.stdout).guards.find((g) => g.name === "release");
  assert.equal(guard.report.reason, "no-targets");
  assert.equal(guard.report.trunk.sha, head);

  // Positive control: a trunk that really does not resolve still says so.
  const bad = run(dir, ["check", "--dir", "backlog", "--release", "--trunk", "origin/mian"]);
  assert.match(bad.stdout, /trunk: origin\/mian unresolved/);
});

test("check --release --env judges one stage; an undeclared stage fails as a usage error", () => {
  const { dir } = cliFixture();
  git(dir, "branch", "production");
  const open = newTask(dir, "Still open");
  commit(dir, open + " landed on the trunk", { "src/c.js": "c\n" });

  const test1 = run(dir, ["check", "--dir", "backlog", "--release", "--env", "test", "--trunk", "main"]);
  assert.equal(test1.status, 0);
  assert.match(test1.stdout, new RegExp("open-task-deployed  " + open));
  const prod = run(dir, ["check", "--dir", "backlog", "--release", "--env", "app/production", "--trunk", "main"]);
  assert.equal(prod.status, 0);
  assert.doesNotMatch(prod.stdout, /open-task-deployed/);

  const bad = run(dir, ["check", "--dir", "backlog", "--release", "--env", "prod"]);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /not a declared stage/);
});

test("--env and --trunk without --release are refused, and a bare check does not run the release gate", () => {
  const { dir } = cliFixture();
  for (const args of [["--env", "test"], ["--trunk", "main"]]) {
    const r = run(dir, ["check", "--dir", "backlog", ...args]);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.stderr, /with no `--release`/);
  }
  const bare = run(dir, ["check", "--dir", "backlog", "--json"]);
  const doc = JSON.parse(bare.stdout);
  assert.ok(doc.guards.length > 0);
  assert.ok(!doc.guards.some((g) => g.name === "release"));
});

test("an unknown gap name or mode in config.yaml fails the configuration", () => {
  for (const line of ["release_gate_accept: [untracked-comit]", "release_gate: block"]) {
    const { dir } = cliFixture();
    appendFileSync(join(dir, "backlog", "config.yaml"), "\n" + line + "\n");
    const r = run(dir, ["check", "--dir", "backlog", "--release"]);
    assert.equal(r.status, 1, line);
    assert.match(r.stderr, /release_gate/);
  }
  // The positive control: the right spelling loads.
  const { dir } = cliFixture();
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nrelease_gate_accept: [untracked-commit]\nrelease_gate: require\n");
  git(dir, "branch", "production");
  assert.equal(run(dir, ["check", "--dir", "backlog", "--release"]).status, 0);
});
