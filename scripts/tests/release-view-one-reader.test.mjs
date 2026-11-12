/**
 * The viewer's Release view and `check --release` read task records through
 * one reader (TL-552).
 *
 * THE DEFECT THIS GUARDS. The viewer used to hand `releaseGaps()` its own task
 * objects, parsed by `readTasks()` in build-viewer.mjs, through `gapTaskOf()` —
 * a shim restating, field by field, the defaults `readTaskRecords()` gives the
 * gate. A field the shim forgot made the panel blind to a gap the gate reported
 * on the same commit (TL-519), and nothing failed to say so. Both now call
 * `releaseTaskRecords()` in release-gaps.mjs.
 *
 * THE FIXTURE carries a task whose frontmatter LACKS `priority:`, `release:`
 * and `target:` — the shape on which the two parsers disagreed (a missing
 * field is `undefined` from `extractMeta()` and `""` from `readTaskRecords()`)
 * — and a planned top-priority task, so the comparison is between two
 * non-empty answers, not two silences.
 *
 * THE LANES READ THERE TOO (TL-573). The Release view's lanes come from
 * `computeStatus()` in release-status.mjs, which also answers `deploy status`,
 * and which used to read the tree with `readTaskMetas()`. That parse demands a
 * line break after the closing `---`, so a task file that is frontmatter and
 * nothing else was a task the gate judged and the lanes did not know: `deploy
 * status` called it "no task file", and a target in another repository listed
 * it in neither lane while the gate counted it. The second fixture carries that
 * file beside a task lacking `priority:`, `release:` and `target:`.
 *
 * Run: node --test scripts/tests/release-view-one-reader.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire, syncBuiltinESMExports } from "node:module";

import { loadConfig } from "../config.mjs";
import { releaseTaskRecords } from "../release-gaps.mjs";
import { releaseViewData } from "../release-view.mjs";
import { computeStatus } from "../release-status.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { SCRIPTS_DIR, isolateHome, scriptSource } from "./_repo.mjs";

isolateHome("release-view-one-reader");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

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

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

function taskFile(dir, id) {
  const tasks = join(dir, "backlog", "tasks");
  return join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
}

function setField(dir, id, field, value) {
  const file = taskFile(dir, id);
  writeFileSync(file, readFileSync(file, "utf8").replace(new RegExp("^" + field + ":.*$", "m"), field + ": " + value), "utf8");
}

function dropField(dir, id, field) {
  const file = taskFile(dir, id);
  const before = readFileSync(file, "utf8");
  const after = before.replace(new RegExp("^" + field + ":.*\\r?\\n", "m"), "");
  assert.notEqual(after, before, "the fixture's task carried no `" + field + ":` to remove");
  writeFileSync(file, after, "utf8");
}

/** The top of `priorities:` in the fixture's own config.yaml, read back. */
function topPriority(dir) {
  const config = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  return config.match(/^priorities:\s*\[([^\]]*)\]/m)[1].split(",")[0].trim();
}

function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-one-reader-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  commit(dir, "the backlog", {});
  const ids = { planned: newTask(dir, "Planned for the release"), bare: newTask(dir, "Frontmatter without optional fields") };
  setField(dir, ids.planned, "release", "r1");
  setField(dir, ids.planned, "priority", topPriority(dir));
  for (const field of ["priority", "release", "target"]) dropField(dir, ids.bare, field);
  commit(dir, "the tasks", {});
  commit(dir, ids.bare + " deployed while open", { "src/b.js": "b\n" });
  git(dir, ["branch", "production"]);
  commit(dir, ids.planned + " on the trunk", { "src/a.js": "a\n" });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
releases: [r1]
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: production, ref: production }
`);
  return { dir, ids, backlog: join(dir, "backlog") };
}

test("the viewer's release data and check --release read identical task records from one fixture", () => {
  const { dir, ids, backlog } = fixture();
  const config = loadConfig(backlog);
  assert.deepEqual(config.problems || [], []);

  // The records: the reader both callers use, against the gate's own parse.
  const records = releaseTaskRecords(backlog, config);
  assert.deepEqual(records, readTaskRecords(join(backlog, "tasks"), config.taskId.file));
  assert.deepEqual(records.map((r) => r.id).sort(), [ids.bare, ids.planned].sort());
  const bare = records.find((r) => r.id === ids.bare);
  assert.deepEqual([bare.priority, bare.release, bare.target], ["", "", []]);

  // The answers computed from them: the panel's gaps and the gate's, whole.
  const data = releaseViewData({ root: backlog, config });
  assert.equal(data.available, true, data.explanation);
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", backlog, "--json"], {
    encoding: "utf8", cwd: dir,
  });
  assert.ok(r.stdout, r.stderr);
  const gate = JSON.parse(r.stdout);
  assert.deepEqual(data.gaps.items, gate.gaps);
  assert.equal(data.gaps.currentRelease, gate.currentRelease);
  assert.equal(data.gaps.currentReleaseJudged, gate.currentReleaseJudged);

  // Positive control: both answers name the gaps the fixture was built to have,
  // so agreement is not two empty lists.
  const names = gate.gaps.map((g) => g.gap + " " + g.subject);
  assert.ok(names.includes("open-task-deployed " + ids.bare), names.join("; "));
  assert.ok(names.includes("planned-blocker-open " + ids.planned), names.join("; "));
  assert.equal(gate.currentRelease, "r1");
});

test("a caller's task objects cannot steer the viewer's gap panel", () => {
  // The page's own task objects are no input to the panel any more: handing it
  // objects that contradict the files changes nothing, because the records are
  // read where the gate reads them.
  const { ids, backlog } = fixture();
  const config = loadConfig(backlog);
  const honest = releaseViewData({ root: backlog, config, now: 0 });
  const misled = releaseViewData({
    root: backlog, config, now: 0,
    tasks: [{ id: ids.planned, status: "done", priority: "", release: "" }, { id: ids.bare, status: "done" }],
  });
  assert.ok(honest.gaps.items.length > 0, "the fixture produced no gap to compare");
  assert.deepEqual(misled.gaps, honest.gaps);
});

test("neither caller parses task files on its own", () => {
  // A second reader is what TL-519 was; the shared one lives in release-gaps.mjs.
  for (const name of ["release-view.mjs", "check-release-gaps.mjs", "release-status.mjs"]) {
    const src = scriptSource(name);
    assert.match(src, /\breleaseTaskRecords\(/, name + " does not read through releaseTaskRecords()");
    assert.doesNotMatch(src, /\b(readTaskRecords|parseTaskRecord|extractMeta|readTaskMetas)\b/, name + " carries a reader of its own");
    assert.doesNotMatch(src, /\bgapTaskOf\b/, name);
  }
});

/** The status `new` wrote into a task, read back rather than assumed. */
function statusOf(dir, id) {
  return readFileSync(taskFile(dir, id), "utf8").match(/^status:\s*([^\s#]+)/m)[1];
}

function pipelineFixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-one-pipeline-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  commit(dir, "the backlog", {});
  const ids = { bare: newTask(dir, "Frontmatter without optional fields"), planned: newTask(dir, "Planned for the release") };
  setField(dir, ids.planned, "release", "r1");
  setField(dir, ids.planned, "priority", topPriority(dir));
  for (const field of ["priority", "release", "target"]) dropField(dir, ids.bare, field);
  // Frontmatter and nothing else, with no line break after the closing fence:
  // the shape `readTaskRecords()` reads and `readTaskMetas()` did not.
  ids.terse = ids.planned.replace(/\d+$/, (n) => String(Number(n) + 1));
  const terseStatus = statusOf(dir, ids.bare);
  writeFileSync(join(dir, "backlog", "tasks", ids.terse + "-frontmatter-only.md"),
    "---\nid: " + ids.terse + "\ntitle: \"Frontmatter and nothing else\"\nstatus: " + terseStatus + "\ntarget: [api]\n---", "utf8");
  commit(dir, "the tasks", {});
  git(dir, ["branch", "production"]);
  commit(dir, ids.bare + " on the trunk", { "src/bare.js": "bare\n" });
  commit(dir, ids.planned + " on the trunk", { "src/planned.js": "planned\n" });
  commit(dir, ids.terse + " on the trunk", { "src/terse.js": "terse\n" });
  appendFileSync(join(dir, "backlog", "config.yaml"), `
releases: [r1]
deploy_targets:
  - name: web
    paths: [src/]
    stages:
      - { name: production, ref: production }
  - name: api
    repository: acme-api
`);
  return { dir, ids, backlog: join(dir, "backlog"), terseStatus };
}

test("deploy status places every task as its file says, including frontmatter with nothing after it", () => {
  const { dir, ids, backlog, terseStatus } = pipelineFixture();
  const config = loadConfig(backlog);
  assert.deepEqual(config.problems || [], []);
  const records = new Map(releaseTaskRecords(backlog, config).map((r) => [r.id, r]));
  assert.equal(records.get(ids.terse).status, terseStatus, "the gate's reader does not see the frontmatter-only file");

  const r = run(dir, ["deploy", "status", "--dir", "backlog", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const web = JSON.parse(r.stdout).targets.find((t) => t.target === "web");
  const waiting = web.buckets.find((b) => b.kind === "waiting" && b.stage === "production");
  assert.deepEqual(waiting.tasks.map((t) => t.id), [ids.bare, ids.planned, ids.terse]);
  for (const t of waiting.tasks) {
    const record = records.get(t.id);
    assert.deepEqual([t.title, t.status], [record.title, record.status], t.id + " is not described as its file says");
  }
  assert.equal(web.buckets.find((b) => b.kind === "reached").count, 0);

  const scoped = run(dir, ["deploy", "status", "--dir", "backlog", "--release", "r1", "--json"]);
  assert.equal(scoped.status, 0, scoped.stderr);
  const scope = JSON.parse(scoped.stdout).release;
  assert.deepEqual(scope.notShipped.tasks.map((t) => [t.id, t.priority, t.release]), [[ids.planned, topPriority(dir), "r1"]]);
  const unplanned = new Map(scope.unplanned.tasks.map((t) => [t.id, t]));
  assert.deepEqual([...unplanned.keys()], [ids.bare, ids.terse]);
  // A missing `priority:` stays absent and a missing `release:` stays "planned
  // for none", as the scope said of it before the reader changed.
  assert.deepEqual([unplanned.get(ids.bare).priority, unplanned.get(ids.bare).release], [null, ""]);
  assert.equal(unplanned.get(ids.terse).note, null, "the frontmatter-only task reads as a task with no file");
  assert.equal(unplanned.get(ids.terse).status, terseStatus);
});

test("the Release view's lanes and its gap panel agree about every task the gate reads", () => {
  const { dir, ids, backlog } = pipelineFixture();
  const config = loadConfig(backlog);
  const data = releaseViewData({ root: backlog, config });
  assert.equal(data.available, true, data.explanation);
  const column = (target, key) => data.lanes.find((l) => l.target === target).columns.find((c) => c.key === key);
  assert.deepEqual(column("web", "trunk").cards.map((c) => c.id), [ids.bare, ids.planned, ids.terse]);

  // A target in another repository is answered from `target:` alone, by the
  // lane and by the gate: both have to count the frontmatter-only task.
  const lane = data.lanes.find((l) => l.target === "api");
  const away = lane.columns.flatMap((c) => c.cards.map((card) => card.id));
  assert.deepEqual(away, [ids.terse]);
  const r = spawnSync(process.execPath, [join(SCRIPTS_DIR, "check-release-gaps.mjs"), "--dir", backlog, "--json"], {
    encoding: "utf8", cwd: dir,
  });
  assert.ok(r.stdout, r.stderr);
  const gate = JSON.parse(r.stdout);
  assert.deepEqual(gate.unobservable, [{ target: "api", repository: "acme-api", count: away.length }]);
  assert.deepEqual(data.gaps.items, gate.gaps);
});

test("computeStatus() places the records it is handed, not a second read of the tree", () => {
  const { ids, backlog } = pipelineFixture();
  const config = loadConfig(backlog);
  const records = releaseTaskRecords(backlog, config);
  const filter = { target: "web", stage: null };
  const waitingIn = (report) => report.targets[0].buckets.find((b) => b.kind === "waiting").tasks;

  const read = computeStatus({ root: backlog, config, filter, count: false }).report;
  const handed = computeStatus({ root: backlog, config, filter, count: false, tasks: records }).report;
  assert.deepEqual(waitingIn(handed), waitingIn(read));

  // Positive control: a record left out is a task the computation no longer
  // knows, although the file is still in the tree — so the records handed in
  // are what it judged, and the agreement above is not two reads of the tree.
  const without = computeStatus({ root: backlog, config, filter, count: false, tasks: records.filter((t) => t.id !== ids.bare) }).report;
  const bare = waitingIn(without).find((t) => t.id === ids.bare);
  assert.deepEqual([bare.title, bare.status], [null, null]);
});

test("the pipeline's records come in filename order whatever order the directory lists", () => {
  // `readdirSync` is sorted on POSIX only because libuv sorts it; Windows hands
  // over the filesystem's own order (TL-624). Listing the directory backwards
  // stands in for that filesystem, so the test fails here if the sort goes.
  const { backlog } = pipelineFixture();
  const config = loadConfig(backlog);
  const fs = createRequire(import.meta.url)("node:fs");
  const original = fs.readdirSync;
  let reversed = 0;
  fs.readdirSync = (...args) => {
    const names = original.apply(fs, args);
    if (String(args[0]) !== join(backlog, "tasks")) return names;
    reversed++;
    return names.slice().reverse();
  };
  syncBuiltinESMExports();
  let files;
  try {
    files = releaseTaskRecords(backlog, config).map((r) => r.file);
  } finally {
    fs.readdirSync = original;
    syncBuiltinESMExports();
  }
  // Positive control: the reversed listing was the one read, and it held
  // enough tasks for an order to be wrong.
  assert.equal(reversed, 1);
  assert.ok(files.length >= 3, files.join(", "));
  assert.deepEqual(files, files.slice().sort());
});
