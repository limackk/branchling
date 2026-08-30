/**
 * `worktrail check --vocabulary` (TL-56).
 *
 * WHAT THIS IS DEFENDING. The writing path enforced the vocabularies and the
 * reading path did not, so a tree could — and did — drift wholesale outside
 * `types:` while every guard stayed green. The asymmetry is the defect; these
 * tests hold both halves of it closed.
 *
 * THE POSITIVE CONTROL IS THE POINT. A vocabulary guard passes trivially on a
 * tree whose values all came from the vocabulary, which is every freshly created
 * backlog. So each "stays quiet" case here is paired with a case in which the
 * guard MUST go red, and the red one is the assertion with evidential force.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditVocabulary } from "../task-fields.mjs";
import { filesCarrying, report } from "../check-backlog-vocabulary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000 });
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-vocab-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
}

function taskFiles(dir) {
  return readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));
}

/** Rewrites one frontmatter field of one task, the way a hand edit would. */
function setField(dir, file, key, value) {
  const path = join(dir, "tasks", file);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + key + ":.*$", "m"), key + ": " + value);
  assert.notEqual(next, text, "field `" + key + "` not found in " + file);
  writeFileSync(path, next);
}

function vocabulary(dir) {
  return run(dir, ["check", "--dir", ".", "--vocabulary"]);
}

// ── The guard stays quiet when it should ──────────────────────────────────

test("a tree written by the tool passes, and says how much it read", () => {
  const dir = repo();
  newTask(dir, "First");
  newTask(dir, "Second");

  const r = vocabulary(dir);
  assert.equal(r.status, 0, r.stderr);
  // Not just "green": the count is what separates a tree in order from a guard
  // that read nothing. Without it this test would pass on an empty directory.
  assert.match(r.stdout, /2 task\(s\) checked/);
});

// ── The positive control: it MUST go red ──────────────────────────────────

test("a value outside the vocabulary fails the read path, not only the write path", () => {
  const dir = repo();
  newTask(dir, "Ordinary work");
  const [file] = taskFiles(dir);

  // The write path already refuses this value...
  const written = run(dir, ["new", "--dir", ".", "--title", "Probe", "--type", "sasquatch"]);
  assert.notEqual(written.status, 0, "`new --type sasquatch` was accepted");

  // ...and until TL-56 the same value sitting in the tree passed in silence.
  setField(dir, file, "type", "sasquatch");
  const r = vocabulary(dir);
  assert.equal(r.status, 1, "a divergent `type` did not fail check --vocabulary");
  assert.match(r.stderr, /`type`/);
  assert.match(r.stderr, /sasquatch/);
});

test("the message names the field, the value, the count and the file", () => {
  const dir = repo();
  newTask(dir, "First");
  newTask(dir, "Second");
  const files = taskFiles(dir);
  for (const f of files) setField(dir, f, "type", "sasquatch");

  const r = vocabulary(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /sasquatch ×2 in 2 file\(s\)/);
  // Naming the count without naming a file leaves the reader grepping the tree.
  for (const f of files) assert.ok(r.stderr.includes(f), "the message does not name " + f);
});

test("a divergence in `status` fails too — the guard is not about `type`", () => {
  const dir = repo();
  newTask(dir, "First");
  const [file] = taskFiles(dir);
  setField(dir, file, "status", "marinating");

  const r = vocabulary(dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /`status`/);
  assert.match(r.stderr, /marinating/);
});

// ── Which fields are judged, and which deliberately are not ───────────────

test("`owner` and `estimate` are suggestions, so a fresh value is not a divergence", () => {
  const dir = repo();
  newTask(dir, "First");
  const [file] = taskFiles(dir);
  setField(dir, file, "owner", "somebody-new");
  setField(dir, file, "estimate", "4h");

  const r = vocabulary(dir);
  assert.equal(r.status, 0, "an open dictionary was reported as a divergence:\n" + r.stderr);
});

test("`labels` is judged only once the project closes it", () => {
  const dir = repo();
  newTask(dir, "First");
  const [file] = taskFiles(dir);
  setField(dir, file, "labels", "[unlisted]");

  assert.equal(vocabulary(dir).status, 0, "an open label list failed");

  const configPath = join(dir, "config.yaml");
  writeFileSync(
    configPath,
    readFileSync(configPath, "utf8").replace(/^labels_closed:.*$/m, "labels_closed: true")
  );
  const r = vocabulary(dir);
  assert.equal(r.status, 1, "a closed label list did not fail");
  assert.match(r.stderr, /unlisted/);
});

test("`board` is left to its own guard, so one bad file is not reported twice", () => {
  const dir = repo();
  newTask(dir, "First");
  const [file] = taskFiles(dir);
  setField(dir, file, "board", "unlisted-board");

  const r = vocabulary(dir);
  assert.equal(r.status, 0, "the board guard's job was duplicated here:\n" + r.stderr);
  // The board is still caught — by the guard whose message is about boards.
  assert.notEqual(run(dir, ["check", "--dir", ".", "--boards"]).status, 0);
});

// ── The guard is part of the default run ──────────────────────────────────

test("a plain `check` runs it — a selector-only guard is one nobody runs", () => {
  const dir = repo();
  newTask(dir, "First");
  setField(dir, taskFiles(dir)[0], "type", "sasquatch");

  const r = run(dir, ["check", "--dir", "."]);
  assert.notEqual(r.status, 0, "`check` with no selector passed on a divergent tree");
  assert.match(r.stderr, /sasquatch/);
});

test("`doctor` and `check` speak from the same measurement", () => {
  const dir = repo();
  newTask(dir, "First");
  setField(dir, taskFiles(dir)[0], "type", "sasquatch");

  const d = JSON.parse(run(dir, ["doctor", "--dir", ".", "--json"]).stdout);
  const row = d.checks.find((c) => c.id === "vocabulary");
  assert.equal(row.status, "error", "doctor is quiet where check fails");
  assert.equal(vocabulary(dir).status, 1);
});

// ── The pure parts, without a tree ────────────────────────────────────────

test("filesCarrying pairs a value back to every file holding it", () => {
  const names = ["a.md", "b.md", "c.md"];
  const metas = [{ type: "code" }, { type: "bug" }, { type: "code" }];
  assert.deepEqual(filesCarrying(names, metas, "type", "code"), ["a.md", "c.md"]);
  assert.deepEqual(filesCarrying(names, metas, "type", "manual"), []);
});

test("filesCarrying counts a list field once per file, not once per hit", () => {
  const names = ["a.md"];
  const metas = [{ labels: ["x", "x"] }];
  assert.deepEqual(filesCarrying(names, metas, "labels", "x"), ["a.md"]);
});

test("report prints the count on a clean audit, so green carries evidence", () => {
  const { lines, code } = report([], ["a.md"], [{ type: "task" }]);
  assert.equal(code, 0);
  assert.match(lines.join("\n"), /1 task\(s\) checked/);
});

test("report refuses to pick a side between the config and the tree", () => {
  const divergent = [
    { field: "type", dictionary: "types", allowed: ["task"], found: [{ value: "code", count: 1 }] },
  ];
  const { lines, code } = report(divergent, ["a.md"], [{ type: "code" }]);
  assert.equal(code, 1);
  const text = lines.join("\n");
  // Both repairs are named, because which one is right is a fact about the
  // project and the guard does not know it.
  assert.match(text, /add the value to config\.yaml/);
  assert.match(text, /correct the tasks/);
});

test("auditVocabulary is the single source of the verdict", () => {
  // If a second copy of the rules ever appears in the guard, this drifts apart
  // from what `doctor` reports and neither number can be trusted.
  const config = {
    statuses: ["pending"], archivedStatuses: [], priorities: ["P1"], types: ["task"],
    labels: [], labelsClosed: false, owners: ["unassigned"], estimates: ["2h"],
    taskIdPrefix: "TL",
  };
  const divergent = auditVocabulary([{ type: "code" }], config);
  const fields = divergent.map((d) => d.field);
  assert.ok(fields.includes("type"), "the shared audit did not see the divergence");
});
