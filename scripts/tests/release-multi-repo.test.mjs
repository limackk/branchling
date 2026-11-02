/**
 * Tasks implemented in another repository are unobservable, not undeployed
 * (TL-507).
 *
 * WHAT HAS TO BE PROVED, against two real fixture repositories — the one that
 * holds the backlog and an `api` target, and a frontend repository whose
 * commits name the backlog's task ids:
 *
 *   1. The false gap exists without the declaration. With the frontend
 *      repository fetched as a remote, a done frontend task reads as
 *      `done-not-on-trunk`, and an open top-priority frontend task planned for
 *      a release holds back the `api` target's last stage. This is the
 *      positive control: without it, the green result of (2) could be a gate
 *      that judges nothing.
 *   2. With `repository:` and `labels:` declared, neither is reported; the
 *      gate names the target and how many tasks it holds instead, and tasks
 *      that are NOT the frontend's are still reported in the same run.
 *   3. `deploy status` names the frontend's tasks in a lane of one
 *      `unobservable` bucket, keeps them out of the "named by no commit" note,
 *      and `--release` lists a planned one as unobservable rather than as not
 *      shipped. The viewer's Release view draws the same lane.
 *   4. The declaration's shape: `paths`, `stages`, a missing `labels`, a
 *      malformed `repository` and `labels` on an ordinary target all fail,
 *      each beside a valid declaration that passes.
 *   5. `query` (TL-512): `--json` names a frontend task's target as
 *      unobservable on the task's own `deploy`, an unlabelled task carries
 *      `[]`, and `--env` / `--not-env` hold out — and name — the tasks whose
 *      answer the frontend's half would decide, while a selector naming a
 *      target of this repository is unaffected. Each beside the reading
 *      without the declaration.
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

import { externalTargetsOf, observedTargets, pathInTarget, readDeployTargets } from "../deploy-targets.mjs";
import { stageMatches } from "../environments.mjs";
import { loadConfig } from "../config.mjs";
import { releaseViewData } from "../release-view.mjs";
import { releaseViewModel, renderRelease, UNOBSERVABLE_COLUMN } from "../viewer-release.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("release-multi-repo");

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

function setConfig(dir, extra) {
  const file = join(dir, "backlog", "config.yaml");
  const base = readFileSync(file, "utf8").split("\n# --- fixture ---\n")[0];
  writeFileSync(file, base + "\n# --- fixture ---\n" + extra, "utf8");
}

const API = `
deploy_targets:
  - name: api
    paths: [src/]
    stages:
      - { name: test, ref: test }
      - { name: production, ref: prod }
`;

const FRONTEND = `  - name: frontend
    repository: acme-frontend
    labels: [frontend]
`;

/**
 * Two repositories. The backlog repository holds `api` (`src/`) and every
 * task file; the frontend repository holds only commits naming the frontend
 * tasks, and is fetched into the backlog repository as the remote `frontend`
 * — which is what makes the false gap observable at all.
 *
 *   shipped    done, api, in production                   → counted
 *   fe-done    done, label frontend, commits in frontend   → unobservable
 *   fe-open    open, top priority, r1, label frontend      → unobservable
 *   fe-cancel  cancelled, label frontend                   → not listed anywhere
 *   unstarted  open, top priority, r1, no label, no commit → still a blocker
 *   stranded   done, no label, commits on a branch only    → still done-not-on-trunk
 */
function twoRepos() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-multi-repo-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), "\nreleases: [r1]\n");
  setConfig(dir, API);
  commit(dir, "the backlog", {});
  const top = configList(dir, "priorities")[0];
  const [done, cancelled] = configList(dir, "archived_statuses");
  const ids = {
    shipped: newTask(dir, "Api shipped"),
    feDone: newTask(dir, "Frontend done"),
    feOpen: newTask(dir, "Frontend open", "--release", "r1", "--priority", top),
    feCancel: newTask(dir, "Frontend cancelled"),
    unstarted: newTask(dir, "Api unstarted", "--release", "r1", "--priority", top),
    stranded: newTask(dir, "Api stranded"),
  };
  for (const name of ["shipped", "feDone", "stranded"]) setField(dir, ids[name], "status", done);
  setField(dir, ids.feCancel, "status", cancelled);
  for (const name of ["feDone", "feOpen", "feCancel"]) setField(dir, ids[name], "labels", "[frontend]");
  commit(dir, "the tasks", {});
  commit(dir, ids.shipped + " api change", { "src/a.js": "a\n" });
  git(dir, ["branch", "test"]);
  git(dir, ["branch", "prod"]);
  git(dir, ["checkout", "-q", "-b", "side"]);
  commit(dir, ids.stranded + " never merged", { "src/s.js": "s\n" });
  git(dir, ["checkout", "-q", "main"]);

  const fe = mkdtempSync(join(tmpdir(), "branchling-multi-repo-frontend-" + counter++ + "-"));
  git(fe, ["init", "-q", "-b", "main", "."]);
  commit(fe, ids.feDone + " the frontend half", { "app/view.ts": "v\n" });
  commit(fe, ids.feOpen + " started in the frontend", { "app/form.ts": "f\n" });
  git(dir, ["remote", "add", "frontend", fe]);
  git(dir, ["fetch", "-q", "frontend"]);
  return { dir, fe, ids, top, done, cancelled };
}

function gate(dir, ...args) {
  const r = run(dir, ["check", "--release", "--dir", "backlog", "--json", ...args]);
  const guard = JSON.parse(r.stdout).guards.find((g) => g.name === "release");
  return { status: r.status, report: guard.report, stderr: r.stderr };
}

function subjects(report, gap) {
  return report.gaps.filter((g) => g.gap === gap).map((g) => g.subject);
}

function statusJson(dir, ...args) {
  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "release-status");
  return parsed;
}

const fx = twoRepos();

test("without the declaration, the frontend's tasks are false gaps (positive control)", () => {
  setConfig(fx.dir, API);
  const { report } = gate(fx.dir);
  assert.equal(report.scanned, true);
  assert.ok(subjects(report, "done-not-on-trunk").includes(fx.ids.feDone),
    "the frontend's commits, fetched as a remote, read as a done task never merged");
  assert.ok(subjects(report, "planned-blocker-open").includes(fx.ids.feOpen),
    "an open frontend task holds back the api target's last stage");
  assert.deepEqual(report.unobservable, []);
});

test("with `repository:` declared, no gap detector reports the frontend's tasks", () => {
  setConfig(fx.dir, API + FRONTEND);
  const { report } = gate(fx.dir);
  assert.equal(report.scanned, true);
  const all = report.gaps.map((g) => g.subject);
  for (const id of [fx.ids.feDone, fx.ids.feOpen, fx.ids.feCancel]) {
    assert.ok(!all.includes(id), id + " is reported: " + JSON.stringify(report.gaps.filter((g) => g.subject === id)));
  }
  // Tasks that are not the frontend's are still judged in the same run.
  assert.ok(subjects(report, "done-not-on-trunk").includes(fx.ids.stranded));
  const blocker = report.gaps.find((g) => g.gap === "planned-blocker-open" && g.subject === fx.ids.unstarted);
  assert.ok(blocker, "a task with no commit and no label still blocks");
  assert.deepEqual(blocker.where, ["api/production"], "and only the targets of this repository");
  assert.deepEqual(report.unobservable, [{ target: "frontend", repository: "acme-frontend", count: 3 }]);
  assert.ok(!report.refs.some((r) => r.target === "frontend"), "no ref of the frontend is resolved here");
});

test("the gate's text names what it did not look at", () => {
  setConfig(fx.dir, API + FRONTEND);
  const r = run(fx.dir, ["check", "--release", "--dir", "backlog"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /frontend: deployed from the repository `acme-frontend`, which this one cannot observe — 3 task\(s\)/);
});

test("deploy status names the frontend's tasks as unobservable, in their own lane", () => {
  setConfig(fx.dir, API + FRONTEND);
  const data = statusJson(fx.dir);
  const lane = data.targets.find((t) => t.target === "frontend");
  assert.ok(lane, "the frontend has a lane");
  assert.equal(lane.repository, "acme-frontend");
  assert.deepEqual(lane.buckets.map((b) => b.kind), ["unobservable"]);
  const ids = lane.buckets[0].tasks.map((t) => t.id).sort();
  assert.deepEqual(ids, [fx.ids.feDone, fx.ids.feOpen].sort(), "the cancelled one has nothing to deploy");
  assert.equal(data.targets.find((t) => t.target === "api").repository, null);
  // The closed frontend task is not "named by no commit"; the stranded api one
  // is placed off the trunk, so nothing else is unplaced either.
  assert.ok(!data.unplaced.ids.includes(fx.ids.feDone));
  for (const t of data.targets.find((x) => x.target === "api").buckets.flatMap((b) => b.tasks)) {
    assert.ok(![fx.ids.feDone, fx.ids.feOpen].includes(t.id), t.id + " is in an api bucket");
  }

  const text = run(fx.dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /frontend {2}deployed from the repository `acme-frontend`/);
  assert.match(text.stdout, /unobservable here {2}2/);
});

test("--release lists a planned frontend task as unobservable, not as not shipped", () => {
  setConfig(fx.dir, API + FRONTEND);
  const scope = statusJson(fx.dir, "--release", "r1").release;
  assert.deepEqual(scope.unobservable.tasks.map((t) => t.id), [fx.ids.feOpen]);
  assert.equal(scope.unobservable.tasks[0].note, "unobservable");
  const notShipped = scope.notShipped.tasks.map((t) => t.id);
  assert.ok(!notShipped.includes(fx.ids.feOpen));
  assert.ok(notShipped.includes(fx.ids.unstarted), "positive control: an unlabelled task with no commit is still not shipped");

  // Without the declaration the same task reads as not shipped — the reading
  // this task exists to replace.
  setConfig(fx.dir, API);
  const before = statusJson(fx.dir, "--release", "r1").release;
  assert.ok(before.notShipped.tasks.some((t) => t.id === fx.ids.feOpen && t.note === "no-commits"));
  assert.equal(before.unobservable.count, 0);
});

test("a target in another repository has no stage to select or record", () => {
  setConfig(fx.dir, API + FRONTEND);
  const env = run(fx.dir, ["deploy", "status", "--dir", "backlog", "--target", "frontend", "--env", "production"]);
  assert.equal(env.status, 2);
  assert.match(env.stderr, /deployed from the repository `acme-frontend`/);
  const q = run(fx.dir, ["query", "--dir", "backlog", "--env", "frontend/production"]);
  assert.equal(q.status, 2, q.stdout);
  const rec = run(fx.dir, ["deploy", "record", "--dir", "backlog", "--target", "frontend", "--stage", "production", "HEAD", "--reason", "shipped"]);
  assert.notEqual(rec.status, 0);
  assert.match(rec.stderr, /acme-frontend/);
  // Positive control: the api target's stage is still selectable.
  assert.equal(run(fx.dir, ["deploy", "status", "--dir", "backlog", "--env", "api/production"]).status, 0);
});

test("the viewer's Release view draws the frontend as one unobservable column", () => {
  setConfig(fx.dir, API + FRONTEND);
  const root = join(fx.dir, "backlog");
  const config = loadConfig(root);
  const tasks = [fx.ids.feDone, fx.ids.feOpen, fx.ids.unstarted].map((id) => ({ id, status: "x", labels: [] }));
  const data = releaseViewData({ root, config, tasks });
  assert.equal(data.available, true, data.explanation);
  const lane = data.lanes.find((l) => l.target === "frontend");
  assert.equal(lane.repository, "acme-frontend");
  assert.deepEqual(lane.columns.map((c) => c.key), [UNOBSERVABLE_COLUMN]);
  assert.deepEqual(lane.columns[0].cards.map((c) => c.id).sort(), [fx.ids.feDone, fx.ids.feOpen].sort());
  assert.ok(!data.gaps.items.some((g) => g.subject === fx.ids.feDone), "the panel reports no gap on its account");
  const html = renderRelease(releaseViewModel(data, { tasks }));
  assert.match(html, /data-release-repository="acme-frontend"/);
  assert.match(html, /Unobservable here/);
  assert.match(html, /unobservable — never undeployed/);
});

test("a project whose every target lives elsewhere still names its tasks", () => {
  setConfig(fx.dir, "\ndeploy_targets:\n" + FRONTEND);
  const data = statusJson(fx.dir);
  assert.equal(data.scan.scanned, false);
  assert.equal(data.scan.reason, "only-external-targets");
  assert.deepEqual(data.targets.map((t) => t.target), ["frontend"]);
  assert.equal(data.targets[0].buckets[0].count, 2);
  const text = run(fx.dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /every deploy target declares `repository:`/);
  assert.match(text.stdout, /unobservable here {2}2/);
  const { status, report } = gate(fx.dir);
  assert.equal(status, 0);
  assert.equal(report.reason, "only-external-targets");
  assert.deepEqual(report.gaps, []);
  assert.equal(report.unobservable[0].count, 3);
});

// ─── the declaration's shape ────────────────────────────────────────────────

function shape(yaml) {
  const lines = yaml.split("\n").filter((l) => l.trim());
  return readDeployTargets("", lines);
}

test("a valid declaration passes and normalises (positive control)", () => {
  const r = shape(`
  - name: api
    stages:
      - { name: production, ref: prod }
  - name: frontend
    repository: acme-frontend
    labels: [frontend, web-ui]
`);
  assert.deepEqual(r.problems, []);
  const fe = r.targets.find((t) => t.name === "frontend");
  assert.equal(fe.repository, "acme-frontend");
  assert.deepEqual([...fe.labels], ["frontend", "web-ui"]);
  assert.deepEqual([...fe.stages], []);
  assert.equal(r.targets.find((t) => t.name === "api").repository, null);
  assert.deepEqual(observedTargets(r.targets).map((t) => t.name), ["api"]);
  assert.equal(pathInTarget(fe, "app/view.ts"), false, "no paths must not read as the whole repository");
  assert.deepEqual(externalTargetsOf(r.targets, { labels: ["web-ui"] }).map((t) => t.name), ["frontend"]);
  assert.deepEqual(externalTargetsOf(r.targets, { labels: ["other"] }), []);
});

for (const [name, yaml, pattern] of [
  ["paths", "    paths: [app/]\n", /`paths` cannot be declared on a target in another repository/],
  ["stages", "    stages:\n      - { name: production, ref: prod }\n", /`stages` cannot be declared on a target in another repository/],
]) {
  test("a target in another repository refuses `" + name + "`", () => {
    const r = shape("  - name: frontend\n    repository: acme-frontend\n    labels: [frontend]\n" + yaml);
    assert.ok(r.problems.some((p) => pattern.test(p)), r.problems.join("\n"));
  });
}

test("a target in another repository needs labels, and a repository name without a slash", () => {
  const noLabels = shape("  - name: frontend\n    repository: acme-frontend\n");
  assert.ok(noLabels.problems.some((p) => /needs `labels`/.test(p)), noLabels.problems.join("\n"));
  const empty = shape("  - name: frontend\n    repository: acme-frontend\n    labels: []\n");
  assert.ok(empty.problems.some((p) => /`labels` — expecting a non-empty list/.test(p)), empty.problems.join("\n"));
  const slash = shape("  - name: frontend\n    repository: acme/frontend\n    labels: [frontend]\n");
  assert.ok(slash.problems.some((p) => /`repository` = `acme\/frontend`/.test(p)), slash.problems.join("\n"));
  const local = shape("  - name: api\n    labels: [api]\n    stages:\n      - { name: production, ref: prod }\n");
  assert.ok(local.problems.some((p) => /`labels` selects tasks only for a target in another repository/.test(p)), local.problems.join("\n"));
  const typo = shape("  - name: frontend\n    repositry: acme-frontend\n    labels: [frontend]\n");
  assert.ok(typo.problems.some((p) => /unknown key `repositry`/.test(p)), typo.problems.join("\n"));
});

test("under a closed label vocabulary, a target's label outside it fails the configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-multi-repo-labels-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const file = join(dir, "backlog", "config.yaml");
  const text = readFileSync(file, "utf8")
    .replace(/^labels:.*$/m, "labels: [frontend]")
    .replace(/^labels_closed:.*$/m, "labels_closed: true");
  writeFileSync(file, text + "\ndeploy_targets:\n  - name: frontend\n    repository: acme-frontend\n    labels: [frontned]\n", "utf8");
  const bad = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /selects the label `frontned`, which is outside the closed `labels` vocabulary/);
  // Positive control: the declared label passes.
  writeFileSync(file, text + "\ndeploy_targets:\n  - name: frontend\n    repository: acme-frontend\n    labels: [frontend]\n", "utf8");
  const good = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(good.status, 0, good.stderr);
});

// ─── query (TL-512) ─────────────────────────────────────────────────────────

/**
 * Its own fixture, so the counts the tests above assert are not moved: the
 * two repositories of `twoRepos()`, plus two tasks split across both — each
 * labelled `frontend` AND named by an api commit here.
 *
 *   splitShipped  done, frontend, api commit in production  → unobservable for `production`
 *   splitWaiting  done, frontend, api commit not deployed   → not in production, whatever the frontend holds
 */
function queryRepos() {
  const base = twoRepos();
  const { dir, done } = base;
  const ids = {
    ...base.ids,
    splitShipped: newTask(dir, "Split shipped"),
    splitWaiting: newTask(dir, "Split waiting"),
  };
  for (const name of ["splitShipped", "splitWaiting"]) {
    setField(dir, ids[name], "status", done);
    setField(dir, ids[name], "labels", "[frontend]");
  }
  commit(dir, "the split tasks", {});
  commit(dir, ids.splitShipped + " api half", { "src/b.js": "b\n" });
  git(dir, ["branch", "-f", "test"]);
  git(dir, ["branch", "-f", "prod"]);
  commit(dir, ids.splitWaiting + " api half", { "src/c.js": "c\n" });
  return { ...base, ids };
}

const qx = queryRepos();

function queryJson(dir, ...args) {
  const r = run(dir, ["query", "--dir", "backlog", "--json", ...args]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.kind, "task-list");
  return parsed;
}

function rowsById(parsed) {
  return new Map(parsed.tasks.map((t) => [t.id, t]));
}

const FRONTEND_AWAY = [{ target: "frontend", repository: "acme-frontend" }];

test("query --json names a frontend task's target as unobservable; an unlabelled task is unaffected", () => {
  setConfig(qx.dir, API + FRONTEND);
  const rows = rowsById(queryJson(qx.dir, "--status", configList(qx.dir, "statuses").join(",")));
  const fe = rows.get(qx.ids.feDone).deploy;
  assert.deepEqual(fe.unobservable, FRONTEND_AWAY);
  assert.equal(fe.commits, 0, "no commit here names it — and the field says why that is not \"undeployed\"");
  assert.deepEqual(rows.get(qx.ids.feOpen).deploy.unobservable, FRONTEND_AWAY);
  const split = rows.get(qx.ids.splitShipped).deploy;
  assert.deepEqual(split.unobservable, FRONTEND_AWAY);
  assert.deepEqual(split.targets.map((t) => t.target), ["api"], "the half here is still read");
  // Positive control: the unlabelled tasks are read as before, with the key
  // present and empty.
  const shipped = rows.get(qx.ids.shipped).deploy;
  assert.deepEqual(shipped.unobservable, []);
  assert.equal(shipped.targets[0].reached, "production");
  assert.deepEqual(rows.get(qx.ids.unstarted).deploy.unobservable, []);
});

test("without the declaration, a frontend task reads as no commits and no target (positive control)", () => {
  setConfig(qx.dir, API);
  const rows = rowsById(queryJson(qx.dir, "--status", qx.done));
  const fe = rows.get(qx.ids.feDone).deploy;
  assert.deepEqual(fe, { commits: 0, untargeted: 0, unobservable: [], targets: [] });
});

test("--not-env and --env hold out the tasks the frontend's half would decide, and name them", () => {
  setConfig(qx.dir, API + FRONTEND);
  const held = [{ ...FRONTEND_AWAY[0], tasks: [qx.ids.feDone, qx.ids.splitShipped] }];

  const notEnv = queryJson(qx.dir, "--status", qx.done, "--not-env", "production");
  assert.deepEqual(notEnv.tasks.map((t) => t.id), [qx.ids.splitWaiting],
    "a half here that is not in production settles the answer whatever the frontend holds");
  assert.deepEqual(notEnv.deploy.unobservable, held);

  const env = queryJson(qx.dir, "--status", qx.done, "--env", "production");
  assert.deepEqual(env.tasks.map((t) => t.id), [qx.ids.shipped],
    "a split task in production here is not called deployed: its other half was not looked at");
  assert.deepEqual(env.deploy.unobservable, held);

  // A selector naming a target of this repository asks about that target only.
  const api = queryJson(qx.dir, "--status", qx.done, "--env", "api/production");
  assert.deepEqual(api.tasks.map((t) => t.id).sort(), [qx.ids.shipped, qx.ids.splitShipped].sort());
  assert.deepEqual(api.deploy.unobservable, []);

  // Without a stage filter nothing is held out, and the key is still present.
  assert.deepEqual(queryJson(qx.dir, "--status", qx.done).deploy.unobservable, []);
});

test("the text and --count outputs say why a frontend task is missing", () => {
  setConfig(qx.dir, API + FRONTEND);
  const text = run(qx.dir, ["query", "--dir", "backlog", "--status", qx.done, "--not-env", "production"]);
  assert.equal(text.status, 0, text.stderr);
  const why = "# frontend: unobservable — deployed from `acme-frontend`, which is not read here, so " +
    qx.ids.feDone + ", " + qx.ids.splitShipped + " match neither --env nor --not-env";
  assert.ok(text.stdout.includes(why), text.stdout);
  const count = run(qx.dir, ["query", "--dir", "backlog", "--status", qx.done, "--not-env", "production", "--count"]);
  assert.equal(count.status, 0, count.stderr);
  assert.equal(count.stdout.trim(), "1");
  assert.ok(count.stderr.includes(why), count.stderr);
});

test("without the declaration, --env reads the split task as deployed and names nothing (positive control)", () => {
  setConfig(qx.dir, API);
  const env = queryJson(qx.dir, "--status", qx.done, "--env", "production");
  assert.deepEqual(env.tasks.map((t) => t.id).sort(), [qx.ids.shipped, qx.ids.splitShipped].sort());
  assert.deepEqual(env.deploy.unobservable, []);
  const notEnv = queryJson(qx.dir, "--status", qx.done, "--not-env", "production");
  assert.ok(!notEnv.tasks.some((t) => t.id === qx.ids.feDone), "matched by nothing, and nothing says why");
  const text = run(qx.dir, ["query", "--dir", "backlog", "--status", qx.done, "--not-env", "production"]);
  assert.doesNotMatch(text.stdout, /unobservable/);
});

test("stageMatches: the other repository decides only what this one cannot", () => {
  const away = [{ name: "frontend", repository: "acme-frontend" }];
  const task = (state) => ({ targets: [{ target: "api", stages: [{ stage: "production", state }] }] });
  const any = { target: null, stage: "production" };
  const api = { target: "api", stage: "production" };
  assert.equal(stageMatches(task("full"), any, away), "unobservable");
  assert.equal(stageMatches({ targets: [] }, any, away), "unobservable");
  assert.equal(stageMatches(task("absent"), any, away), "not-full");
  assert.equal(stageMatches(task("unknown"), any, away), "unknown");
  assert.equal(stageMatches(task("full"), api, away), "full");
  // Positive control: with no target elsewhere the answers are the old ones.
  assert.equal(stageMatches(task("full"), any), "full");
  assert.equal(stageMatches({ targets: [] }, any), "none");
});
