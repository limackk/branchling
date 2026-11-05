/**
 * A backlog checked out with CRLF works like one with LF (TL-479).
 *
 * Git on Windows defaults to `core.autocrlf=true`, so a user's backlog arrives
 * with CRLF in every task, the configuration, the template and the history,
 * while the repository itself stores LF. The fixture is therefore produced the
 * way a user gets one: a backlog committed with LF, then cloned twice — once
 * with `core.autocrlf=true` and once with `false`. Both clones then go through
 * the same reading, creating, closing and checking commands, and must answer
 * alike.
 *
 * Two properties are asserted, because either alone passes on a defect:
 *
 *   1. The commands SUCCEED and print the same answers in both clones — a
 *      reader written against `\n` fails or answers differently on `\r\n`.
 *   2. A file the tool REWRITES keeps the line ending it had. A writer that
 *      splices LF lines into a CRLF file leaves a file of mixed endings that
 *      every reader then still accepts, so (1) alone would stay green.
 *
 * The positive control is that the CRLF clone really carries CRLF and the LF
 * clone none: without it, a git that ignored `core.autocrlf` would make this
 * file compare two LF backlogs and pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, isolateState, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";
import { lineEnding, setFrontmatterField, withLineEnding } from "../task-fields.mjs";

isolateHome("crlf-backlog");
isolateState("crlf-backlog");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

function cli(cwd, args, input = "") {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", input, timeout: 120_000 });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function ok(cwd, args, input) {
  const r = cli(cwd, args, input);
  assert.equal(r.code, 0, "branchling " + args.join(" ") + " in " + cwd + ":\n" + r.out);
  return r.out;
}

/** A task body as `new` reads it from stdin: a goal and one runnable proof. */
function body(goal) {
  return JSON.stringify({
    goal,
    context: "A paragraph of context.",
    steps: ["The first step.", "The second step."],
    verification: [{ id: "reads", bash: "node --version", proves: "The contract runs." }],
  });
}

/** Every regular file under `dir`, relative to it. */
function walk(dir, prefix = "") {
  return readdirSync(join(dir, prefix)).flatMap((name) => {
    const rel = prefix ? prefix + "/" + name : name;
    return statSync(join(dir, rel)).isDirectory() ? walk(dir, rel) : [rel];
  });
}

const VIEWS = /(^|\/)(INDEX|NOW|done)\.yaml$|\.html$/;

/** The tracked text files of the backlog that end lines with a lone LF / with CRLF. */
function endings(backlog) {
  const lf = [], crlf = [];
  for (const rel of walk(backlog)) {
    if (VIEWS.test(rel) || rel.endsWith(".gitkeep")) continue;
    const text = readFileSync(join(backlog, rel), "utf8");
    if (/(^|[^\r])\n/.test(text)) lf.push(rel);
    if (/\r\n/.test(text)) crlf.push(rel);
  }
  return { lf, crlf };
}

/** One origin committed with LF, and a clone of it per line-ending policy. */
function clones() {
  const base = mkdtempSync(join(tmpdir(), "branchling-crlf-"));
  const origin = join(base, "origin");
  git(base, ["init", "-q", origin]);
  // The origin is written with LF whatever the platform's default, so the
  // two clones differ in their checkout and in nothing else.
  git(origin, ["config", "core.autocrlf", "false"]);
  ok(origin, ["init", "--dir", "backlog", "--no-example"]);
  ok(origin, ["new", "--title", "The first task"], body("The first task is closed."));
  ok(origin, ["new", "--title", "The second task", "--priority", "P1"], body("The second task stays open."));
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "--no-verify", "-m", "a backlog"]);
  const out = {};
  for (const [name, autocrlf] of [["lf", "false"], ["crlf", "true"]]) {
    const clone = join(base, name);
    git(base, ["clone", "-q", "-c", "core.autocrlf=" + autocrlf, origin, clone]);
    out[name] = clone;
  }
  return out;
}

const repos = clones();

/** The id `new` gave a task, read back from the tree by title. */
function idOf(cwd, title) {
  const row = JSON.parse(ok(cwd, ["query", "--json"])).tasks.find((t) => t.title === title);
  assert.ok(row, "no task titled " + title + " in " + cwd);
  return row.id;
}

test("positive control: the CRLF clone carries CRLF, the LF clone carries none", () => {
  const lf = endings(join(repos.lf, "backlog"));
  const crlf = endings(join(repos.crlf, "backlog"));
  assert.deepEqual(lf.crlf, [], "the LF clone has CRLF files, so it is no control");
  assert.ok(lf.lf.length > 0, "the LF clone has no text file at all");
  assert.deepEqual(crlf.lf, [], "the CRLF clone has LF lines, so git ignored core.autocrlf");
  for (const must of ["config.yaml", "_template.md"]) {
    assert.ok(crlf.crlf.includes(must), must + " was not checked out with CRLF: " + crlf.crlf.join(", "));
  }
  assert.ok(crlf.crlf.some((f) => f.startsWith("tasks/")), "no task file was checked out with CRLF");
  assert.ok(crlf.crlf.some((f) => f.startsWith("history/")), "no history log was checked out with CRLF");
});

test("a CRLF backlog reads, creates, closes and checks like an LF one", () => {
  const answers = {};
  for (const [name, cwd] of Object.entries(repos)) {
    const first = idOf(cwd, "The first task");
    ok(cwd, ["new", "--title", "The third task"], body("The third task is created on the checkout."));
    ok(cwd, ["take", first]);
    ok(cwd, ["done", first]);
    // `check` judges the history against git, so the closing is committed first,
    // as AGENTS.md has every closing committed.
    git(cwd, ["add", "-A"]);
    git(cwd, ["commit", "-q", "--no-verify", "-m", "closed"]);
    ok(cwd, ["check"]);
    ok(cwd, ["doctor"]);
    answers[name] = {
      query: ok(cwd, ["query"]),
      done: ok(cwd, ["query", "--status", "done", "--count"]),
      stats: ok(cwd, ["stats", "--json"]).replace(/"[^"]*backlog"/g, '"<dir>"'),
    };
  }
  assert.equal(answers.crlf.done.trim(), "1", "the CRLF clone did not record the closing:\n" + answers.crlf.done);
  assert.deepEqual(answers.crlf, answers.lf);
});

test("the task files the commands wrote say the same in both clones", () => {
  // `done` ticks criteria in the body and `new` strips the template's banner:
  // neither shows in `query`, so the files themselves are compared, with the
  // line ending — the one difference the clones are allowed — taken out.
  const tasks = (cwd) => walk(join(cwd, "backlog", "tasks")).filter((f) => f.endsWith(".md")).sort();
  assert.deepEqual(tasks(repos.crlf), tasks(repos.lf));
  const read = (cwd, f) => readFileSync(join(cwd, "backlog", "tasks", f), "utf8").replace(/\r\n/g, "\n");
  for (const f of tasks(repos.lf)) assert.equal(read(repos.crlf, f), read(repos.lf, f), f + " differs between the clones");
  assert.match(read(repos.lf, tasks(repos.lf)[0]), /^- \[x\] /m,
    "the closed task has no ticked criterion, so the comparison proves nothing about `done`");
});

test("a file the tool rewrites keeps the line ending it was checked out with", () => {
  // The tests above have taken, closed and created tasks in both clones, and
  // appended to their history. Committing through `core.autocrlf` rewrites
  // nothing in the working tree, so what is on disk is what the tool wrote. A
  // file the tool CREATED has no ending to keep and may carry either — but a
  // file carrying both was spliced.
  const crlf = endings(join(repos.crlf, "backlog"));
  const lf = endings(join(repos.lf, "backlog"));
  assert.deepEqual(crlf.lf.filter((f) => crlf.crlf.includes(f)), [], "the tool wrote LF lines into a CRLF file");
  assert.deepEqual(lf.crlf, [], "the tool wrote CRLF lines into the LF checkout");
  assert.equal(crlf.crlf.filter((f) => f.startsWith("tasks/")).length, 3,
    "not every task of the CRLF clone is CRLF: " + crlf.crlf.join(", "));
});

test("a field set or inserted into a frontmatter is written in the file's own ending", () => {
  const lines = ["---", "id: TASK-1", "status: pending   # a note", "verification:", "  - id: x", "---", "", "Body.", ""];
  for (const eol of ["\r\n", "\n"]) {
    let text = setFrontmatterField(lines.join(eol), "status", "in_progress");
    text = setFrontmatterField(text, "updated", "2026-10-30");
    assert.equal(lineEnding(text), eol);
    assert.equal(withLineEnding(text, eol), text, JSON.stringify(eol) + " came back with mixed endings: " + JSON.stringify(text));
    assert.match(text, /^status: in_progress {2}# a note$/m, "the edited line lost its comment");
    assert.match(text, /^updated: 2026-10-30$/m, "the inserted field is missing");
  }
});
