/**
 * Which files a task changed, and finding tasks by file (TL-75).
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The index is built from COMMIT MESSAGES naming a task id. That decision —
 *      computed rather than stored — is the whole design, so the parser is
 *      tested against text rather than against a repository: a fixture built
 *      from real commits proves the parser only as far as those commits happen
 *      to exercise it.
 *   2. `--modified-file` matches an exact path AND a directory prefix, and the
 *      two do not bleed into each other.
 *   3. The NEGATIVE control: an unrelated file returns nothing. Required by
 *      TL-75 by name, and it is the half with force — every assertion about
 *      matching would also pass for a filter that matches everything.
 *   4. Paths are relative to the REPOSITORY root, not to the backlog directory.
 *      Proved in the layout where the two differ, because in a co-located one
 *      the claim is untestable.
 *   5. An empty answer says WHICH empty it is. A repository with no task ids in
 *      its commits and a query that simply matched nothing are the same zero
 *      rows, and only one of them is an answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { explain, gitLogArgs, modifiedFiles, parseLog, repoRoot, touches } from "../modified-files.mjs";
import { taskIdScanner } from "../task-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);
/** One `git log` record, as the command in `gitLogArgs()` prints it. */
const record = (message, files) => RS + message + US + "\n" + files.join("\n") + "\n";

// ── The parser ────────────────────────────────────────────────────────────

test("a commit naming a task attributes its files to that task", () => {
  const log = record("TL-9 the thing is true now\n\nA body.", ["scripts/a.mjs", "README.md"]);
  const byTask = parseLog(log, taskIdScanner("TL"));
  assert.deepEqual([...byTask.keys()], ["TL-9"]);
  assert.deepEqual([...byTask.get("TL-9")].sort(), ["README.md", "scripts/a.mjs"]);
});

test("a commit naming NO task attributes nothing — silence, not a bucket", () => {
  const byTask = parseLog(record("tidy up", ["scripts/a.mjs"]), taskIdScanner("TL"));
  assert.equal(byTask.size, 0);
});

test("a commit naming two tasks gives the files to both — picking one would be a guess", () => {
  const byTask = parseLog(record("TL-9 done, and TL-10 opened", ["a.mjs"]), taskIdScanner("TL"));
  assert.deepEqual([...byTask.keys()].sort(), ["TL-10", "TL-9"]);
});

test("several commits for one task union their files", () => {
  const log = record("TL-9 first", ["a.mjs"]) + record("TL-9 second", ["a.mjs", "b.mjs"]);
  const byTask = parseLog(log, taskIdScanner("TL"));
  assert.deepEqual([...byTask.get("TL-9")].sort(), ["a.mjs", "b.mjs"]);
});

test("a newline or a quote in the message does not break the record", () => {
  // The delimiters are control characters precisely because a message may hold
  // anything printable; this is the assertion that says so.
  const log = record('TL-9 a "quoted" title\n\nA body\nwith lines\nand a lone " in it', ["a.mjs"]);
  assert.deepEqual([...parseLog(log, taskIdScanner("TL")).get("TL-9")], ["a.mjs"]);
});

test("a commit that touched no files is skipped rather than recorded as empty", () => {
  const byTask = parseLog(RS + "TL-9 an empty commit" + US + "\n", taskIdScanner("TL"));
  assert.equal(byTask.size, 0);
});

test("the prefix comes from the configuration — another project's ids are not read", () => {
  const log = record("BL-9 somebody else's convention", ["a.mjs"]);
  assert.equal(parseLog(log, taskIdScanner("TL")).size, 0);
  assert.equal(parseLog(log, taskIdScanner("BL")).size, 1);
});

// ── Matching ──────────────────────────────────────────────────────────────

test("an exact path matches only itself", () => {
  const paths = new Set(["scripts/cli.mjs", "scripts/client/index.mjs"]);
  assert.equal(touches(paths, "scripts/cli.mjs"), true);
  assert.equal(touches(paths, "scripts/cli"), false, "a partial path must not match as if it were exact");
  assert.equal(touches(paths, "README.md"), false);
});

test("a trailing slash — and only a trailing slash — matches a directory", () => {
  const paths = new Set(["scripts/client/index.mjs"]);
  assert.equal(touches(paths, "scripts/"), true);
  assert.equal(touches(paths, "scripts/client/"), true);
  assert.equal(touches(paths, "docs/"), false);
});

test("an empty query matches nothing rather than everything", () => {
  assert.equal(touches(new Set(["a.mjs"]), ""), false);
});

// ── A real repository, in the layout where backlog root != repo root ──────

/** A repository with the backlog in `backlog/`, so a path relative to the
 *  REPOSITORY root and one relative to the backlog differ — which is the only
 *  layout in which that claim can be tested at all. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-modfiles-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "t@example.test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  return dir;
}

function commit(dir, message, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content, "utf8");
  }
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

test("query finds the task by file, by directory, and by neither", () => {
  const dir = repo();
  // One task per commit, in order: a task's own file is written before its
  // commit, so creating both first would put the second task's file inside the
  // FIRST task's commit and the assertion below would be measuring the fixture.
  const id = newTask(dir, "Make the thing work");
  commit(dir, id + " the thing works now", { "scripts/thing.mjs": "//\n", "docs/thing.md": "x\n" });
  const other = newTask(dir, "Something unrelated");
  commit(dir, other + " a different area entirely", { "web/app.js": "//\n" });

  const ids = (path) => {
    const r = run(dir, ["query", "--dir", "backlog", "--modified-file", path, "--status", "pending,done", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).tasks.map((t) => t.id).sort();
  };

  // Relative to the REPOSITORY root: `scripts/thing.mjs`, not `../scripts/…`.
  assert.deepEqual(ids("scripts/thing.mjs"), [id]);
  assert.deepEqual(ids("scripts/"), [id]);
  assert.deepEqual(ids("docs/"), [id]);
  assert.deepEqual(ids("web/app.js"), [other]);

  // The negative control TL-75 asks for by name.
  assert.deepEqual(ids("scripts/never-existed.mjs"), []);
  assert.deepEqual(ids("docs/other.md"), []);

  // A task's OWN file is part of its commit, and so is its history log — that is
  // Law 1 showing up in the index rather than an accident of the fixture.
  assert.deepEqual(ids("backlog/tasks/"), [id, other].sort());
});

test("`--count` answers with a number, and `--files` with paths", () => {
  const dir = repo();
  const id = newTask(dir, "Countable");
  commit(dir, id + " it counts", { "scripts/thing.mjs": "//\n" });

  const count = run(dir, ["query", "--dir", "backlog", "--modified-file", "scripts/thing.mjs", "--status", "pending", "--count"]);
  assert.equal(count.stdout.trim(), "1");

  const files = run(dir, ["query", "--dir", "backlog", "--modified-file", "scripts/thing.mjs", "--status", "pending", "--files"]);
  assert.match(files.stdout, new RegExp(id));
});

test("a repository whose commits name no task says so instead of answering zero", () => {
  const dir = repo();
  newTask(dir, "Never committed under its id");
  commit(dir, "just some work", { "scripts/thing.mjs": "//\n" });

  const r = run(dir, ["query", "--dir", "backlog", "--modified-file", "scripts/thing.mjs", "--status", "pending"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no commit message in this repository names a task id/);

  const json = JSON.parse(run(dir, ["query", "--dir", "backlog", "--modified-file", "x", "--status", "pending", "--json"]).stdout);
  assert.equal(json.modifiedFile.scanned, true);
  assert.equal(json.modifiedFile.reason, "no-task-ids-in-commits");
});

test("outside git the answer is named as such, not printed as an empty list", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-modfiles-nogit-" + counter++ + "-"));
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const r = run(dir, ["query", "--dir", "backlog", "--modified-file", "a.mjs", "--status", "pending"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /not a git repository/);
  assert.equal(repoRoot(dir), null);
});

test("the viewer carries the list for a task that has commits", () => {
  const dir = repo();
  const id = newTask(dir, "Visible in the viewer");
  commit(dir, id + " it shows up", { "scripts/thing.mjs": "//\n" });
  assert.equal(run(dir, ["viewer", "--dir", "backlog"]).status, 0);

  const html = readFileSync(join(dir, "backlog", "viewer.html"), "utf8");
  assert.match(html, /"modified_files":\[[^\]]*"scripts\/thing\.mjs"/);
  assert.match(html, /Files changed/, "the detail view has no row for the list it carries");
});

// ── The wiring and the honesty of an empty answer ─────────────────────────

test("the log is asked for in one pass, with no rename following and no merge files", () => {
  const args = gitLogArgs();
  assert.deepEqual(args.slice(0, 2), ["log", "--name-only"]);
  assert.ok(args.some((a) => a.startsWith("--pretty=format:")));
  assert.ok(!args.includes("-m"), "`-m` would attribute a whole merged branch to the merge's message");
});

test("`explain` distinguishes the three empties, and stays silent on a real answer", () => {
  assert.match(explain("no-git"), /not a git repository/);
  assert.match(explain("git-failed"), /could not be computed/);
  assert.match(explain("no-task-ids-in-commits"), /names a task id/);
  assert.equal(explain("ok"), null);
});

test("`--modified-file` with `--tasks` is refused rather than answered wrongly", () => {
  const dir = repo();
  const r = run(dir, ["query", "--tasks", join(dir, "backlog", "tasks"), "--modified-file", "a.mjs"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs the configuration/);
});

test("`modifiedFiles` reports a git failure as such, without inventing an index", () => {
  const fake = () => ({ status: 128, stdout: "", stderr: "fatal" });
  const r = modifiedFiles({ root: "/nowhere", prefix: "TL", run: fake });
  assert.equal(r.scanned, false);
  assert.equal(r.reason, "git-failed");
  assert.equal(r.byTask.size, 0);
});
