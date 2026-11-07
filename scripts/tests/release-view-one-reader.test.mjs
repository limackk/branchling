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
 * Run: node --test scripts/tests/release-view-one-reader.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { loadConfig } from "../config.mjs";
import { releaseTaskRecords } from "../release-gaps.mjs";
import { releaseViewData } from "../release-view.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

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
  for (const name of ["release-view.mjs", "check-release-gaps.mjs"]) {
    const src = readFileSync(join(SCRIPTS_DIR, name), "utf8");
    assert.match(src, /\breleaseTaskRecords\(/, name + " does not read through releaseTaskRecords()");
    assert.doesNotMatch(src, /\b(readTaskRecords|parseTaskRecord|extractMeta|readTaskMetas)\b/, name + " carries a reader of its own");
    assert.doesNotMatch(src, /\bgapTaskOf\b/, name);
  }
});
