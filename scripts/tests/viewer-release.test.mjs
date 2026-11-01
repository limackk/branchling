/**
 * The viewer's Release view — tasks by deployment stage (TL-504).
 *
 * WHAT HAS TO BE PROVED, against real fixture repositories, because the claim
 * is about what git and the task files say together:
 *
 *   1. Each fixture task sits in the column of the last step it fully reached:
 *      closed but not merged, the trunk, or a stage — the last stage listed,
 *      not merely counted, because the page narrows it by filters.
 *   2. A task held by only one of two parallel refs carries a PARTIAL marker
 *      naming the ref that holds it; so does a task only some of whose commits
 *      a stage holds. A task fully deployed carries none (positive control).
 *   3. The gap panel lists what `check --release` reports, split into what the
 *      gate would act on and what configuration accepts.
 *   4. The resolved SHA of every ref, the trunk's included, and the build time
 *      travel with the data; an unresolvable ref is unknown, never empty.
 *   5. The board and the filters narrow the cards; the link carries them.
 *   6. A project with no `deploy_targets` reads nothing and shows no tab.
 *
 * The fixture backlogs are created by `init` with the generic prefix, so no id
 * here refers into this repository's backlog.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { buildHtml, computeStats, readTasks } from "../build-viewer.mjs";
import { loadConfig } from "../config.mjs";
import { releaseViewData } from "../release-view.mjs";
import {
  CLOSED_COLUMN, RELEASE_FOLD_AT, TRUNK_COLUMN, encodeReleaseHash, isReleaseHash,
  releaseAgeLabel, releaseMarker, releaseViewModel, renderRelease,
} from "../viewer-release.mjs";
import { parseTasksHash } from "../viewer-url.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-release");

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
  return git(dir, ["rev-parse", "HEAD"]);
}

function backlogRepo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-viewer-release-" + counter++ + "-"));
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

/** Sets a frontmatter field on disk. Values come from the fixture's own
 *  config.yaml, read back rather than assumed. */
function setField(dir, id, field, value) {
  const tasks = join(dir, "backlog", "tasks");
  const file = join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
  const re = new RegExp("^" + field + ":.*$", "m");
  writeFileSync(file, readFileSync(file, "utf8").replace(re, field + ": " + value), "utf8");
}

function archivedStatus(dir) {
  const config = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  return config.match(/^archived_statuses:\s*\[([^\]]*)\]/m)[1].split(",")[0].trim();
}

/**
 * The fixture:
 *   shipped   in test, production-eu and prod-us        → production
 *   halfway   in test and production-eu only            → test, PARTIAL (one of two refs)
 *   split     two commits, only the first in test       → trunk, PARTIAL (1 of 2 commits)
 *   merged    on the trunk only                         → trunk
 *   branched  closed, committed only on a feature branch → closed, not merged
 *   docs      touches only docs/                        → the docs target, published
 */
function pipelineRepo(extraConfig = "") {
  const dir = backlogRepo();
  const ids = {};
  for (const name of ["shipped", "halfway", "split", "merged", "branched", "docs"]) ids[name] = newTask(dir, "Task " + name);
  commit(dir, "the tasks", {});
  commit(dir, ids.shipped + " ships everywhere", { "src/a.js": "a\n" });
  commit(dir, ids.docs + " documents it", { "docs/a.md": "a\n" });
  git(dir, ["branch", "published"]);
  git(dir, ["branch", "prod-us"]);
  commit(dir, ids.halfway + " reaches one region", { "src/b.js": "b\n" });
  git(dir, ["update-ref", "refs/deploys/web/production-eu", "HEAD"]);
  commit(dir, ids.split + " first half", { "src/s1.js": "1\n" });
  git(dir, ["branch", "test"]);
  commit(dir, ids.split + " second half", { "src/s2.js": "2\n" });
  commit(dir, ids.merged + " merged, not deployed", { "src/c.js": "c\n" });
  git(dir, ["checkout", "-q", "-b", "feature"]);
  commit(dir, ids.branched + " never merged", { "src/d.js": "d\n" });
  git(dir, ["checkout", "-q", "main"]);
  setField(dir, ids.branched, "status", archivedStatus(dir));
  setField(dir, ids.halfway, "epic", "\"Regions\"");
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
${extraConfig}`);
  return { dir, ids, backlog: join(dir, "backlog") };
}

function dataFor(backlog, now) {
  const config = loadConfig(backlog);
  assert.deepEqual(config.problems || [], []);
  return releaseViewData({ root: backlog, config, tasks: readTasks(backlog, config), now });
}

/** `column key → [ids]` for one lane. */
function columns(data, target) {
  const lane = data.lanes.find((l) => l.target === target);
  return Object.fromEntries(lane.columns.map((c) => [c.key, c.cards.map((x) => x.id)]));
}

function card(data, target, id) {
  for (const col of data.lanes.find((l) => l.target === target).columns) {
    const c = col.cards.find((x) => x.id === id);
    if (c) return c;
  }
  return null;
}

// ── 1. Placement ─────────────────────────────────────────────────────────

test("each fixture task sits in the column of the last step it fully reached", () => {
  const { backlog, ids } = pipelineRepo();
  const data = dataFor(backlog);
  assert.equal(data.available, true, data.explanation);
  assert.deepEqual(columns(data, "web"), {
    [CLOSED_COLUMN]: [ids.branched],
    [TRUNK_COLUMN]: [ids.split, ids.merged],
    test: [ids.halfway],
    production: [ids.shipped],
  });
  assert.deepEqual(columns(data, "docs"), {
    [CLOSED_COLUMN]: [],
    [TRUNK_COLUMN]: [],
    published: [ids.docs],
  });
  // The columns are in promotion order, whatever the object key order says.
  assert.deepEqual(data.lanes[0].columns.map((c) => c.key), [CLOSED_COLUMN, TRUNK_COLUMN, "test", "production"]);
});

// ── 2. The PARTIAL marker ────────────────────────────────────────────────

test("a task held by one of two parallel refs is PARTIAL and names the ref that holds it", () => {
  const { backlog, ids, dir } = pipelineRepo();
  const m = releaseMarker(card(dataFor(backlog), "web", ids.halfway));
  assert.equal(m.kind, "partial");
  assert.equal(m.stage, "production");
  assert.deepEqual(m.holders, ["refs/deploys/web/production-eu"]);
  assert.deepEqual(m.missing, ["prod-us"]);
  assert.match(m.text, /held by refs\/deploys\/web\/production-eu; missing from prod-us/);
  // Positive control: once the second region has it, it is in production
  // with no marker at all.
  git(dir, ["branch", "-f", "prod-us", "refs/deploys/web/production-eu"]);
  const after = dataFor(backlog);
  assert.ok(columns(after, "web").production.includes(ids.halfway));
  assert.equal(releaseMarker(card(after, "web", ids.halfway)), null);
});

test("a task only some of whose commits a stage holds is PARTIAL, and a fully placed one is not", () => {
  const { backlog, ids } = pipelineRepo();
  const data = dataFor(backlog);
  const m = releaseMarker(card(data, "web", ids.split));
  assert.equal(m.kind, "partial");
  assert.equal(m.stage, "test");
  assert.match(m.text, /1 of 2 commits/);
  for (const id of [ids.merged, ids.shipped, ids.branched]) assert.equal(releaseMarker(card(data, "web", id)), null, id);
  // The marker reaches the HTML a reader sees, on that card and no other.
  const html = renderRelease(releaseViewModel(data, { tasks: readTasks(backlog), now: Date.now() }));
  assert.equal((html.match(/<strong>PARTIAL<\/strong>/g) || []).length, 2);
  assert.match(html, new RegExp('data-release-card="' + ids.split + '"><div[^]*?PARTIAL'));
});

// ── 3. The gap panel ─────────────────────────────────────────────────────

test("the gap panel lists what check --release reports, and accepted gaps apart", () => {
  const { backlog, ids } = pipelineRepo();
  const data = dataFor(backlog);
  assert.equal(data.gaps.mode, "report");
  const names = data.gaps.items.map((g) => g.gap + " " + g.subject);
  assert.ok(names.includes("partial-task " + ids.halfway), names.join("\n"));
  assert.ok(names.includes("partial-task " + ids.split), names.join("\n"));
  assert.ok(names.includes("open-task-deployed " + ids.shipped), names.join("\n"));
  // The same findings the command prints: the panel is not a second detector.
  const cli = JSON.parse(spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", backlog, "--json"], {
    encoding: "utf8", cwd: dirname(backlog),
  }).stdout);
  assert.deepEqual(data.gaps.items.map((g) => g.gap + " " + g.subject), cli.gaps.map((g) => g.gap + " " + g.subject));

  const model = releaseViewModel(data, { tasks: readTasks(backlog) });
  assert.equal(model.gaps.accepted.length, 0);
  assert.equal(model.gaps.blocking.length, data.gaps.items.length);
  assert.match(renderRelease(model), /reports these and does not fail/);
});

test("a gap accepted in configuration is listed apart, and require says the gate fails", () => {
  const { backlog } = pipelineRepo("release_gate: require\nrelease_gate_accept: [open-task-deployed]\n");
  const model = releaseViewModel(dataFor(backlog), { tasks: readTasks(backlog) });
  assert.ok(model.gaps.accepted.length > 0);
  assert.ok(model.gaps.accepted.every((g) => g.gap === "open-task-deployed"));
  assert.ok(model.gaps.blocking.every((g) => g.gap !== "open-task-deployed"));
  assert.equal(model.gaps.fails, true);
  assert.match(renderRelease(model), /The release gate fails on these \(release_gate: require\)/);
});

// ── 4. SHAs, build time, unknown refs ────────────────────────────────────

test("the resolved SHA of every ref and of the trunk, and the build time, travel with the view", () => {
  const { backlog, dir } = pipelineRepo();
  const now = Date.parse("2026-11-01T12:00:00Z");
  const data = dataFor(backlog, now);
  assert.equal(data.builtAt, "2026-11-01T12:00:00.000Z");
  assert.equal(data.trunk.sha, git(dir, ["rev-parse", "HEAD"]));
  const specs = data.refs.map((r) => r.spec);
  assert.deepEqual(specs, ["test", "refs/deploys/web/production-eu", "prod-us", "published"]);
  for (const r of data.refs) assert.equal(r.sha, git(dir, ["rev-parse", r.spec]), r.spec);
  // Every stage column names its refs with the SHA it read.
  const prod = data.lanes[0].columns.find((c) => c.key === "production");
  assert.deepEqual(prod.refs.map((r) => [r.spec, r.sha]), [
    ["refs/deploys/web/production-eu", git(dir, ["rev-parse", "refs/deploys/web/production-eu"])],
    ["prod-us", git(dir, ["rev-parse", "prod-us"])],
  ]);
  const model = releaseViewModel(data, { tasks: readTasks(backlog), now: now + 3 * 3_600_000 });
  assert.equal(model.age, "3 hours ago");
  const html = renderRelease(model);
  assert.match(html, /Built 2026-11-01T12:00:00.000Z \(3 hours ago\)/);
  assert.ok(html.includes(git(dir, ["rev-parse", "prod-us"]).slice(0, 12)));
});

test("an unresolvable ref is unknown, never an empty stage", () => {
  const dir = backlogRepo();
  const id = newTask(dir, "Somewhere");
  commit(dir, id + " lands", { "src/a.js": "a\n" });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: refs/deploys/web/missing }
      - { name: production, ref: refs/deploys/web/also-missing }
`);
  const data = dataFor(join(dir, "backlog"));
  const cols = data.lanes[0].columns;
  assert.equal(cols.find((c) => c.key === TRUNK_COLUMN).unknown, true);
  assert.equal(cols.find((c) => c.key === "production").unknown, true);
  assert.equal(cols.find((c) => c.key === "test").refs[0].sha, null);
  const m = releaseMarker(card(data, "web", id));
  assert.equal(m.kind, "unknown");
  assert.match(renderRelease(releaseViewModel(data, { tasks: readTasks(join(dir, "backlog")) })), /unknown — refs\/deploys\/web\/missing does not resolve/);
});

// ── 5. Filters and the link ──────────────────────────────────────────────

test("the board and filters narrow the cards, and say how many they hid", () => {
  const { backlog, ids } = pipelineRepo();
  const data = dataFor(backlog);
  const tasks = readTasks(backlog);
  const visible = new Set(tasks.filter((t) => t.epic === "Regions").map((t) => t.id));
  assert.deepEqual([...visible], [ids.halfway]);
  const model = releaseViewModel(data, { tasks, visible });
  const web = Object.fromEntries(model.lanes[0].columns.map((c) => [c.key, c.cards.map((x) => x.id)]));
  assert.deepEqual(web, { [CLOSED_COLUMN]: [], [TRUNK_COLUMN]: [], test: [ids.halfway], production: [] });
  assert.equal(model.lanes[0].columns.find((c) => c.key === TRUNK_COLUMN).hidden, 2);
  assert.match(renderRelease(model), /Narrowed by the board and the filters above\./);
  // A search carried by a link narrows invisibly unless the view names it.
  const searched = releaseViewModel(data, { tasks, visible, search: "half" });
  assert.match(renderRelease(searched), /and by the search \u201chalf\u201d/);
  // Not narrowed: every card, with its title from the task file.
  const all = releaseViewModel(data, { tasks, visible: null });
  assert.equal(all.lanes[0].columns.find((c) => c.key === "test").cards[0].title, "Task halfway");
});

test("a long column is folded, and a short one is not", () => {
  const cards = Array.from({ length: RELEASE_FOLD_AT + 1 }, (_, i) => ({ id: "X-" + i, next: null }));
  const data = {
    available: true, builtAt: new Date().toISOString(), trunk: null, refs: [], unplaced: { count: 0, ids: [] }, gaps: null,
    lanes: [{ target: "t", columns: [
      { key: "a", stage: "a", refs: [], unknown: false, unknownRefs: [], cards },
      { key: "b", stage: "b", refs: [], unknown: false, unknownRefs: [], cards: cards.slice(0, 1) },
    ] }],
  };
  const model = releaseViewModel(data, {});
  assert.deepEqual(model.lanes[0].columns.map((c) => c.folded), [true, false]);
  assert.match(renderRelease(model), new RegExp("Show all " + (RELEASE_FOLD_AT + 1)));
});

test("the link carries the board, the filters and the search, and reads back with the tasks parser", () => {
  const hash = encodeReleaseHash({ board: "main", filters: [{ param: "epic", values: ["Regions"] }, { param: "status", values: [] }], search: "half" });
  assert.equal(hash, "release?board=main&epic=Regions&q=half");
  const [route, query] = hash.split("?");
  assert.equal(isReleaseHash(route), true);
  assert.equal(isReleaseHash("tasks"), false);
  const back = parseTasksHash(query, ["epic", "status"]);
  assert.deepEqual(back.filters, { epic: ["Regions"], status: [] });
  assert.equal(back.board, "main");
  assert.equal(back.search, "half");
});

test("the age label names the largest whole unit", () => {
  assert.equal(releaseAgeLabel(10_000), "less than a minute ago");
  assert.equal(releaseAgeLabel(60_000), "1 minute ago");
  assert.equal(releaseAgeLabel(5 * 3_600_000), "5 hours ago");
  assert.equal(releaseAgeLabel(3 * 86_400_000), "3 days ago");
});

// ── 6. The page ──────────────────────────────────────────────────────────

test("the built page carries the Release tab and its data only when targets are declared", () => {
  const { backlog, ids } = pipelineRepo();
  const config = loadConfig(backlog);
  const tasks = readTasks(backlog, config);
  const html = buildHtml(tasks, computeStats(tasks), config, {});
  assert.match(html, /<button type="button" class="view-tab" data-view="release" id="tabRelease">Release<\/button>/);
  const line = html.split("\n").find((l) => l.startsWith("const RELEASE = "));
  const embedded = JSON.parse(line.slice("const RELEASE = ".length, -1));
  assert.deepEqual(columns(embedded, "web")[TRUNK_COLUMN], [ids.split, ids.merged]);
  // No task text travels in the release data: titles come from ALL_TASKS.
  assert.ok(!line.includes("Task halfway"));
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);

  // The negative half: no `deploy_targets`, no tab a reader can see, no git read.
  const plain = backlogRepo();
  const pconfig = loadConfig(join(plain, "backlog"));
  const ptasks = readTasks(join(plain, "backlog"), pconfig);
  const phtml = buildHtml(ptasks, computeStats(ptasks), pconfig, {});
  assert.match(phtml, /id="tabRelease" hidden>Release</);
  const pdata = releaseViewData({ root: join(plain, "backlog"), config: pconfig, tasks: ptasks });
  assert.equal(pdata.available, false);
  assert.equal(pdata.reason, "no-targets");
  assert.match(renderRelease(releaseViewModel(pdata)), /deploy_targets:/);
});

// ── 7. The empty state ───────────────────────────────────────────────────

const TARGETS_YAML = `
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: test, ref: test }
`;

function escaped(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

test("an empty view with targets declared explains its reason and does not ask to declare them", () => {
  // Targets declared before the first commit: the tab is visible (only
  // `no-targets` hides it), so the page must not ask for what is declared.
  const dir = mkdtempSync(join(tmpdir(), "branchling-viewer-release-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), TARGETS_YAML);
  const backlog = join(dir, "backlog");
  const data = dataFor(backlog);
  assert.equal(data.available, false);
  assert.equal(data.reason, "no-trunk");
  const config = loadConfig(backlog);
  const tasks = readTasks(backlog, config);
  assert.doesNotMatch(buildHtml(tasks, computeStats(tasks), config, {}), /id="tabRelease" hidden/);

  const vm = releaseViewModel(data);
  assert.equal(vm.reason, "no-trunk");
  const html = renderRelease(vm);
  assert.ok(html.includes(escaped(data.explanation)), html);
  assert.doesNotMatch(html, /Declare the deploy targets/);
  assert.doesNotMatch(html, /deploy_targets:/);

  // A reason with nothing the reader can do here: the explanation alone.
  const failed = renderRelease(releaseViewModel({ available: false, reason: "git-failed", explanation: "a git command failed" }));
  assert.match(failed, /a git command failed/);
  assert.doesNotMatch(failed, /Declare the deploy targets/);
  assert.doesNotMatch(failed, /rel-hint/);

  // The stubbed reason the empty state can be handed: a hint of its own.
  const noIds = renderRelease(releaseViewModel({ available: false, reason: "no-task-ids-in-commits", explanation: "no commit names a task id" }));
  assert.match(noIds, /no commit names a task id/);
  assert.match(noIds, /Name the task id in the message of each commit/);
  assert.doesNotMatch(noIds, /Declare the deploy targets/);

  // The positive control: for `no-targets` the hint IS shown.
  const none = renderRelease(releaseViewModel({ available: false, reason: "no-targets", explanation: "no targets" }));
  assert.match(none, /Declare the deploy targets/);
  assert.match(none, /<code>deploy_targets:<\/code>/);
});

test("targets declared and no commit naming a task id: the reason is shown, the declare hint is not", () => {
  const dir = backlogRepo();
  commit(dir, "code with no task id", { "src/a.js": "a\n" });
  git(dir, ["branch", "test"]);
  appendFileSync(join(dir, "backlog", "config.yaml"), TARGETS_YAML);
  const data = dataFor(join(dir, "backlog"));
  assert.equal(data.reason, "no-task-ids-in-commits");
  const html = renderRelease(releaseViewModel(data));
  assert.ok(html.includes(escaped(data.explanation)), html);
  assert.doesNotMatch(html, /Declare the deploy targets/);
});
