/**
 * `query` names a task that exists only on another branch only when the
 * query's criteria could match it (TL-715).
 *
 * The scan reads such a task's id and its status on each branch, nothing
 * more. `--ids`, `--status` and `--scope` can therefore exclude it; `--text`,
 * `--priority` and the rest cannot judge it either way, so it is counted once
 * on stderr instead of being named under every query. `--ids` listing it
 * names it whatever else is asked.
 *
 * Every exclusion is paired with a run of the same fixture that DOES name the
 * task, so a test cannot pass because the scan stopped seeing it altogether.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";
import { elsewhereOnlyMatching } from "../branch-scan.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("query-elsewhere-filtered");
plainOutput();

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");
const HERE_ID = P + "-1";
const AWAY_ID = P + "-2";
const NOTICE = new RegExp(AWAY_ID + " is not in this tree");
const UNCHECKED = /1 task exists only on another branch and was not checked against/;

function vcs(cwd, args) {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" });
}

function taskText(id, status) {
  return ["---", "id: " + id, 'title: "Filtered elsewhere"', "type: task", "labels: []", "board: main",
    "priority: P1", "status: " + status, "owner: unassigned", "estimate: 2h", "created: 2026-01-01",
    "updated: 2026-01-01", "blocked_by: []", "---", "", "## Goal", "", "Something to be done.", ""].join("\n");
}

/** `main` holds HERE_ID; `feature` alone holds AWAY_ID, `in_progress`. */
function fixture() {
  const repo = fixtureDir(join(tmpdir(), "branchling-elsewhere-filtered-"));
  const backlog = join(repo, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  vcs(repo, ["init", "-q", "-b", "main"]);
  writeFileSync(join(backlog, "tasks", HERE_ID + "-here.md"), taskText(HERE_ID, "pending"), "utf8");
  vcs(repo, ["add", "-A"]);
  vcs(repo, ["commit", "-qm", "seed"]);
  vcs(repo, ["checkout", "-q", "-b", "feature"]);
  const away = join(backlog, "tasks", AWAY_ID + "-away.md");
  writeFileSync(away, taskText(AWAY_ID, "in_progress"), "utf8");
  vcs(repo, ["add", "-A"]);
  vcs(repo, ["commit", "-qm", "away"]);
  vcs(repo, ["checkout", "-q", "main"]);
  rmSync(away, { force: true });
  return { repo, backlog };
}

const F = fixture();
process.on("exit", () => rmSync(F.repo, { recursive: true, force: true }));

function query(args) {
  const r = spawnSync(process.execPath, [CLI, "query", "--dir", F.backlog].concat(args),
    { cwd: F.repo, encoding: "utf8", timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  return { out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

test("POSITIVE CONTROL: an unfiltered query names the elsewhere-only task", () => {
  const r = query([]);
  assert.match(r.out, NOTICE);
  assert.doesNotMatch(r.all, UNCHECKED);
});

test("--ids that does not list it does not name it; --ids that lists it does", () => {
  const other = query(["--ids", HERE_ID]);
  assert.doesNotMatch(other.all, NOTICE);
  assert.doesNotMatch(other.all, UNCHECKED, "an id the list excludes is not 'unchecked', it is excluded");
  assert.match(other.out, new RegExp("id: " + HERE_ID));

  const named = query(["--ids", AWAY_ID]);
  assert.match(named.out, NOTICE);
  // Named by id, it stays named even beside a criterion the scan cannot judge.
  const withText = query(["--ids", AWAY_ID, "--text", "zzzz"]);
  assert.match(withText.out, NOTICE);
  assert.doesNotMatch(withText.all, UNCHECKED);
});

test("--status that no branch gives it does not name it; one that does, does", () => {
  const done = query(["--status", "done"]);
  assert.doesNotMatch(done.all, NOTICE);
  assert.doesNotMatch(done.all, UNCHECKED);
  assert.match(query(["--status", "in_progress"]).out, NOTICE);
});

test("--scope archived does not name a task every branch has open", () => {
  const r = query(["--scope", "archived"]);
  assert.doesNotMatch(r.all, NOTICE);
  assert.match(query(["--scope", "all"]).out, NOTICE);
});

test("a criterion the scan cannot judge counts it once on stderr instead of naming it", () => {
  for (const shape of [[], ["--count"], ["--files"], ["--json"]]) {
    const r = query(["--text", "zzzz"].concat(shape));
    assert.doesNotMatch(r.all, NOTICE, "named under " + (shape[0] || "text"));
    assert.match(r.err, UNCHECKED);
    assert.match(r.err, /against --text \(/);
    assert.equal(r.err.split(UNCHECKED).length - 1, 1, "said more than once");
  }
  const two = query(["--text", "zzzz", "--priority", "P0"]);
  assert.match(two.err, /against --priority, --text \(/);
});

test("--json carries only the elsewhere-only tasks the criteria could match", () => {
  assert.deepEqual(JSON.parse(query(["--json"]).out).elsewhereOnly.map((t) => t.id), [AWAY_ID]);
  assert.deepEqual(JSON.parse(query(["--json", "--status", "done"]).out).elsewhereOnly, []);
  assert.deepEqual(JSON.parse(query(["--json", "--text", "zzzz"]).out).elsewhereOnly, []);
  assert.deepEqual(JSON.parse(query(["--json", "--ids", AWAY_ID, "--text", "zzzz"]).out).elsewhereOnly.map((t) => t.id), [AWAY_ID]);
});

test("elsewhereOnlyMatching, without a repository", () => {
  const list = [
    { id: "Z-1", elsewhere: [{ status: "pending" }] },
    { id: "Z-2", elsewhere: [{ status: "done" }] },
    { id: "Z-3", elsewhere: [{ status: "done" }, { status: "in_progress" }] },
  ];
  const archived = new Set(["done", "cancelled"]);
  const ids = (r) => [r.named.map((t) => t.id), r.unchecked.map((t) => t.id)];
  assert.deepEqual(ids(elsewhereOnlyMatching(list, {})), [["Z-1", "Z-2", "Z-3"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { scope: "active", archived })), [["Z-1", "Z-3"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { scope: "archived", archived })), [["Z-2", "Z-3"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { scope: "all", archived })), [["Z-1", "Z-2", "Z-3"], []]);
  // A status on ANY branch is enough, compared without regard to case.
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { statuses: ["DONE"], archived })), [["Z-2", "Z-3"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { ids: ["Z-2"] })), [["Z-2"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { scope: "active", archived, unevaluable: ["--text"] })), [[], ["Z-1", "Z-3"]]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { ids: ["Z-1", "Z-2"], scope: "active", archived, unevaluable: ["--text"] })),
    [["Z-1"], []]);
  assert.deepEqual(ids(elsewhereOnlyMatching(list, { unevaluable: [] })), [["Z-1", "Z-2", "Z-3"], []]);
});
