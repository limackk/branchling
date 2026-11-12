/**
 * `query --owner <prefix>*` and `query --worktrees` (TL-700).
 *
 * WHAT WAS MEASURED. On 2026-11-10 a loop coordinator looped awk and grep over
 * `.claude/worktrees/loop-*` because no single `query` call could answer
 * "what does every loop hold": `--owner 'agent:loop-*'` matched exactly and
 * returned 0, and the cross-branch scan reports a sibling tree's STATUS but
 * never its owner, so a claim `take` left uncommitted in a sibling was
 * invisible as a claim from the main checkout.
 *
 * THE FIXTURE IS THAT SHAPE: one clone, two sibling worktrees, and claims
 * that exist only as uncommitted edits in them. Every assertion that a row is
 * found has a control in which it is not — the same tree before the claim,
 * or the same query without the flag — so an answer that lists everything
 * cannot pass.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";
import { ownerMatches } from "../task-select.mjs";

isolateHome("query-owner-worktrees");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function cli(args, env, cwd) {
  const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env, cwd });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function vcs(cwd, args) {
  return execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" });
}

function setField(backlog, id, field, value) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  const path = join(backlog, "tasks", file);
  const text = readFileSync(path, "utf8");
  const next = text.replace(new RegExp("^" + field + ":.*$", "m"), field + ": " + value);
  assert.notEqual(next, text, "the fixture has no `" + field + ":` line to set");
  writeFileSync(path, next, "utf8");
}

/** A clone with three tasks and two sibling worktrees, nothing claimed yet. */
function clone() {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-owner-wt-" + counter++ + "-"));
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).code, 0);
  const ids = [];
  for (const title of ["First loop's work", "Second loop's work", "Work nobody holds"]) {
    const r = cli(["new", "--dir", backlog, "--title", title], env);
    assert.equal(r.code, 0, r.err);
    ids.push((r.out.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  vcs(repo, ["init", "-q", "-b", "main"]);
  vcs(repo, ["add", "-A"]);
  vcs(repo, ["commit", "-qm", "seed"]);
  const loops = [1, 2].map((n) => {
    const path = join(dir, "loop-" + n);
    vcs(repo, ["worktree", "add", "-q", "-b", "loop-" + n, path]);
    return { path: realpathSync(path), backlog: join(path, "backlog") };
  });
  return { repo: realpathSync(repo), backlog, env, ids, loops };
}

/** What `take` leaves in a loop's tree: an uncommitted edit of the file. */
function claim(loop, id, owner) {
  setField(loop.backlog, id, "status", "in_progress");
  setField(loop.backlog, id, "owner", owner);
}

function query(f, args) {
  const r = cli(["query", "--dir", f.backlog, "--json"].concat(args), f.env, f.repo);
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out);
}

test("a trailing * on --owner matches a prefix; anything else stays exact", () => {
  assert.equal(ownerMatches(["agent:loop-*"], "agent:loop-1"), true);
  assert.equal(ownerMatches(["AGENT:LOOP-*"], "agent:loop-12"), true);
  assert.equal(ownerMatches(["agent:loop-*"], "agent:coordinator"), false);
  assert.equal(ownerMatches(["agent:loop-*"], "user:agent:loop-1"), false);
  // Exact values keep their old meaning: no implicit prefix, no inner wildcard.
  assert.equal(ownerMatches(["agent:loop"], "agent:loop-1"), false);
  assert.equal(ownerMatches(["agent:*-1"], "agent:loop-1"), false);
  assert.equal(ownerMatches(["agent:loop-1"], "agent:loop-1"), true);
  assert.equal(ownerMatches(["*"], ""), true);
  // A task with no owner matches no non-empty prefix.
  assert.equal(ownerMatches(["s*"], undefined), false);
  // OR inside the axis, as on every other: one matching value is enough.
  assert.equal(ownerMatches(["user:jane", "agent:loop-*"], "agent:loop-1"), true);
});

test("--owner prefix matches claims in this tree", () => {
  const f = clone();
  setField(f.backlog, f.ids[0], "owner", "agent:loop-7");
  setField(f.backlog, f.ids[1], "owner", "agent:coordinator");
  const answer = query(f, ["--owner", "agent:loop-*"]);
  assert.deepEqual(answer.tasks.map((t) => t.id), [f.ids[0]]);
  // Without the flag no row names a worktree, and the envelope says nobody asked.
  assert.equal(answer.worktrees, null);
  assert.equal(answer.tasks[0].worktree, null);
});

test("--owner prefix --worktrees finds an uncommitted claim in a sibling worktree", () => {
  const f = clone();
  // CONTROL: before any claim, nothing is held by a loop anywhere.
  assert.deepEqual(query(f, ["--owner", "agent:loop-*", "--worktrees"]).tasks, []);

  claim(f.loops[0], f.ids[0], "agent:loop-1");
  claim(f.loops[1], f.ids[1], "agent:loop-2");

  // CONTROL: without --worktrees the main checkout sees no owner of either.
  assert.deepEqual(query(f, ["--owner", "agent:loop-*"]).tasks, []);

  const answer = query(f, ["--owner", "agent:loop-*", "--worktrees"]);
  const rows = answer.tasks.map((t) => [t.id, t.owner, t.status, t.worktree]).sort();
  assert.deepEqual(rows, [
    [f.ids[0], "agent:loop-1", "in_progress", f.loops[0].path],
    [f.ids[1], "agent:loop-2", "in_progress", f.loops[1].path],
  ]);
  assert.deepEqual(answer.worktrees.trees.slice().sort(), f.loops.map((l) => l.path).sort());
  assert.equal(answer.worktrees.reason, null);
  assert.equal(answer.worktrees.self, f.repo);
  // The path opens the sibling's file, not this tree's copy of it.
  for (const t of answer.tasks) {
    assert.match(readFileSync(t.file, "utf8"), new RegExp("^owner: " + t.owner + "$", "m"));
  }

  // A sibling's row is that tree's own copy, not a disagreement with itself.
  for (const t of answer.tasks) assert.deepEqual(t.elsewhere, []);

  // The text output names the worktree on the row.
  const text = cli(["query", "--dir", f.backlog, "--owner", "agent:loop-*", "--worktrees"], f.env, f.repo);
  assert.equal(text.code, 0, text.err);
  assert.match(text.out, new RegExp("id: " + f.ids[0] + ".*worktree: \"" + f.loops[0].path + "\""));
  assert.equal(cli(["query", "--dir", f.backlog, "--owner", "agent:loop-*", "--worktrees", "--count"], f.env, f.repo).out.trim(), "2");
});

test("--worktrees adds no row for a sibling copy identical to this tree's", () => {
  const f = clone();
  claim(f.loops[0], f.ids[0], "agent:loop-1");
  const answer = query(f, ["--worktrees"]);
  // Three local rows plus the one sibling copy that differs — not three per tree.
  const sibling = answer.tasks.filter((t) => t.worktree !== f.repo);
  assert.deepEqual(sibling.map((t) => [t.id, t.worktree]), [[f.ids[0], f.loops[0].path]]);
  assert.equal(answer.tasks.filter((t) => t.worktree === f.repo).length, 3);
});

test("--worktrees reports a task only a sibling has as a row, not as elsewhere-only", () => {
  const f = clone();
  const r = cli(["new", "--dir", f.loops[0].backlog, "--title", "Filed in a loop"], f.env, f.loops[0].path);
  assert.equal(r.code, 0, r.err);
  const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  const without = query(f, []);
  assert.ok(without.elsewhereOnly.some((t) => t.id === id), "control: the scan sees it as elsewhere-only");
  const answer = query(f, ["--worktrees"]);
  assert.deepEqual(answer.tasks.filter((t) => t.id === id).map((t) => t.worktree), [f.loops[0].path]);
  assert.equal(answer.elsewhereOnly.some((t) => t.id === id), false);
});

test("--worktrees is refused beside --tasks, which bypasses the repository", () => {
  const f = clone();
  // CONTROL: --tasks alone still answers.
  const plain = cli(["query", "--tasks", join(f.backlog, "tasks"), "--count"], f.env, f.repo);
  assert.equal(plain.code, 0, plain.err);
  assert.equal(plain.out.trim(), "3");
  const r = cli(["query", "--tasks", join(f.backlog, "tasks"), "--worktrees"], f.env, f.repo);
  assert.equal(r.code, 2);
  assert.match(r.err, /--worktrees needs the repository/);
});

test("without --worktrees no text row names a worktree", () => {
  const f = clone();
  const r = cli(["query", "--dir", f.backlog], f.env, f.repo);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /id: /);
  assert.doesNotMatch(r.out, /worktree:/);
  // Nor is a note about worktrees printed: every line is a row.
  for (const line of r.out.trim().split("\n")) assert.match(line, /^- \{/);
});

test("--worktrees keeps a task only an unchecked-out branch has as elsewhere-only", () => {
  const f = clone();
  const away = join(f.repo, "..", "away");
  vcs(f.repo, ["worktree", "add", "-q", "-b", "away", away]);
  const r = cli(["new", "--dir", join(away, "backlog"), "--title", "Filed on a branch"], f.env, away);
  assert.equal(r.code, 0, r.err);
  const id = (r.out.match(/([A-Z]+-\d+)/) || [])[1];
  vcs(away, ["add", "-A"]);
  vcs(away, ["commit", "-qm", "branch task"]);
  vcs(f.repo, ["worktree", "remove", away]);
  const answer = query(f, ["--worktrees"]);
  assert.equal(answer.tasks.some((t) => t.id === id), false, "no tree has it on disk");
  assert.ok(answer.elsewhereOnly.some((t) => t.id === id), "the branch still says it exists");
});

test("a worktree whose backlog directory is gone is skipped, not read", () => {
  const f = clone();
  rmSync(f.loops[1].backlog, { recursive: true, force: true });
  claim(f.loops[0], f.ids[0], "agent:loop-1");
  const answer = query(f, ["--owner", "agent:loop-*", "--worktrees"]);
  assert.deepEqual(answer.worktrees.trees, [f.loops[0].path]);
  assert.deepEqual(answer.tasks.map((t) => t.id), [f.ids[0]]);
});

test("outside a git repository --worktrees says it read this tree only", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-query-owner-wt-norepo-"));
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1", GIT_CEILING_DIRECTORIES: dir };
  assert.equal(cli(["init", "--dir", join(dir, "backlog"), "--no-example"], env).code, 0);
  assert.equal(cli(["new", "--dir", join(dir, "backlog"), "--title", "Local only"], env).code, 0);
  const json = cli(["query", "--dir", join(dir, "backlog"), "--json", "--worktrees"], env, dir);
  assert.equal(json.code, 0, json.err);
  const answer = JSON.parse(json.out);
  assert.deepEqual(answer.worktrees, { reason: "not-a-repository", self: null, trees: [] });
  assert.equal(answer.tasks.length, 1);
  const note = /^# --worktrees read this tree only — the backlog is not in a git repository$/m;
  const text = cli(["query", "--dir", join(dir, "backlog"), "--worktrees"], env, dir);
  assert.match(text.out, note);
  for (const shape of ["--count", "--files"]) {
    const r = cli(["query", "--dir", join(dir, "backlog"), "--worktrees", shape], env, dir);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, note, shape + " says it on stderr");
    assert.doesNotMatch(r.out, /--worktrees/, shape + " keeps stdout clean");
  }
  // CONTROL: without the flag nothing is said about worktrees.
  assert.doesNotMatch(cli(["query", "--dir", join(dir, "backlog")], env, dir).out, /--worktrees/);
});
