/**
 * `take` on a task this actor closed in a tree `main` has not received points
 * at `resume` (TL-684).
 *
 * WHAT WAS WRONG. A supervised loop that died between `done` and the commit
 * was resumed, ran `take` on its own task, and was told only that the task is
 * closed and has to be reopened deliberately. `resume` exists for exactly this
 * state and was used zero times, because nothing named it.
 *
 * WHAT IS UNDER TEST, each case paired with the control that bounds it:
 *
 *   1. AN OWN CLOSING, NOT COMMITTED — the measured case — names `resume`.
 *   2. AN OWN CLOSING COMMITTED ON A BRANCH `main` does not have names it too.
 *   3. THE SAME CLOSING ONCE MERGED keeps the reopen refusal: `main` already
 *      carries the decision, so there is nothing left to resume.
 *   4. A CLOSING BY SOMEBODY ELSE keeps the reopen refusal even when it is
 *      unmerged: resuming another actor's decision is the takeover `resume`
 *      itself refuses.
 *   5. THE ROUTE IS RUN AS PRINTED and the briefing answers, so the pointer is
 *      worth what it promises.
 *   6. THE SECOND ROUTE, `take --reopen` (TL-737), is printed after `resume`
 *      for a closing rejected in review, and run as printed it reopens the
 *      task — the refusal does not steer that caller away from the withdrawal.
 *
 * The refusal is `ownUnmergedClosing()` in `scripts/take-task.mjs`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDir } from "./_fixture-dir.mjs";
import { git } from "./_git.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("take-closed-resume");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

function gitOk(cwd, args) {
  const r = git(cwd, ["-c", "user.email=test@example.invalid", "-c", "user.name=test", ...args]);
  assert.equal(r.status, 0, "git " + args.join(" ") + ": " + r.stderr);
  return r.stdout;
}

/** A co-located backlog on `main` holding one committed, pending task whose
 *  contract passes, so `done` closes it for real. */
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-take-closed-"));
  gitOk(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const made = run(dir, ["new", "--dir", ".", "--title", "a task to close", "--actor", "agent:a"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/([A-Z]+-\d+)-/)[1];
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  const file = join(dir, "tasks", name);
  writeFileSync(file, readFileSync(file, "utf8").replace('bash: "command to run"', 'bash: "true"'), "utf8");
  writeFileSync(join(dir, ".gitignore"), ".state/\n", "utf8");
  gitOk(dir, ["add", "-A"]);
  gitOk(dir, ["commit", "-q", "-m", "a pending task"]);
  return { dir, id };
}

function closeAs(dir, id, actor) {
  const taken = run(dir, ["take", id, "--dir", ".", "--actor", actor]);
  assert.equal(taken.status, 0, taken.stderr);
  const done = run(dir, ["done", id, "--dir", ".", "--actor", actor]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
}

function takeJson(dir, id, actor) {
  const r = run(dir, ["take", id, "--dir", ".", "--actor", actor, "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  return JSON.parse(r.stdout);
}

test("an own closing that was never committed names resume", () => {
  const { dir, id } = repo();
  closeAs(dir, id, "agent:a");

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, new RegExp("→ \\S+ resume " + id + " --actor agent:a"));
  assert.match(r.stderr, new RegExp("take: " + id + " is closed \\(status: done\\), by you, and `main` does not have that closing"));
  assert.match(r.stderr, /agent:a closed it at \d{4}-\d\d-\d\dT[\d:.]+Z; on `main` it is still `pending`\./);
  assert.match(r.stderr, /stopped before its commit or its merge/);
  assert.match(r.stderr, new RegExp("→ \\S+ take " + id + " --reopen --reason \"…\" --actor agent:a"));
  assert.ok(r.stderr.indexOf(" resume " + id) < r.stderr.indexOf(" take " + id + " --reopen"),
    "the resume route is no longer the first suggestion: " + r.stderr);
  assert.doesNotMatch(r.stderr, /Reopen it deliberately/);

  const out = takeJson(dir, id, "agent:a");
  assert.equal(out.refusalKind, "closed-unmerged");
  assert.equal(out.details.length, 6, out.details.join("\n"));
  assert.match(out.details[1], /stopped before its commit or its merge/);
  assert.match(out.details[2], /^If so, the closing stands: finish it from the briefing \(the first route below\)\.$/);
  assert.match(out.details[3], /^If the closing was rejected in review, withdraw it instead \(the second route\); the reason is recorded\.$/);
  // The resume route stays FIRST (TL-684); the reopen route follows it (TL-737).
  assert.match(out.details[4], new RegExp(" resume " + id + " --actor agent:a$"));
  assert.match(out.details[5], new RegExp(" take " + id + " --reopen --reason \"…\" --actor agent:a$"));
  assert.doesNotMatch(out.details.join("\n"), /Do not reopen/, "the advice contradicts the reopen route it prints");
});

test("a later write by somebody else does not hide whose closing it was", () => {
  const { dir, id } = repo();
  closeAs(dir, id, "agent:a");
  const set = run(dir, ["set", id, "priority", "P3", "--dir", ".", "--actor", "agent:b"]);
  assert.equal(set.status, 0, set.stderr);

  assert.equal(takeJson(dir, id, "agent:a").refusalKind, "closed-unmerged");
  assert.equal(takeJson(dir, id, "agent:b").refusalKind, "closed");
});

test("without a main ref the closing cannot be placed and the reopen refusal stays", () => {
  const { dir, id } = repo();
  gitOk(dir, ["branch", "-m", "main", "trunk"]);
  closeAs(dir, id, "agent:a");

  assert.equal(takeJson(dir, id, "agent:a").refusalKind, "closed");
});

test("a backlog outside any repository keeps the reopen refusal", () => {
  const dir = fixtureDir(join(tmpdir(), "branchling-take-closed-nogit-"));
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const made = run(dir, ["new", "--dir", ".", "--title", "a task outside git", "--actor", "agent:a"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/([A-Z]+-\d+)-/)[1];
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  const file = join(dir, "tasks", name);
  writeFileSync(file, readFileSync(file, "utf8").replace('bash: "command to run"', 'bash: "true"'), "utf8");
  closeAs(dir, id, "agent:a");
  assert.equal(takeJson(dir, id, "agent:a").refusalKind, "closed");

  // Standing in an UNRELATED repository that has `main` must not lend the
  // backlog that repository's history: git would otherwise answer from the
  // caller's working directory.
  const elsewhere = repo().dir;
  const r = run(elsewhere, ["take", id, "--dir", dir, "--actor", "agent:a", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).refusalKind, "closed");
});

test("an own closing committed on a branch main does not have names resume", () => {
  const { dir, id } = repo();
  gitOk(dir, ["checkout", "-q", "-b", "work"]);
  closeAs(dir, id, "agent:a");
  gitOk(dir, ["add", "-A"]);
  gitOk(dir, ["commit", "-q", "-m", "closed on a branch"]);

  assert.equal(takeJson(dir, id, "agent:a").refusalKind, "closed-unmerged");
});

test("an own closing of a task main has never seen names resume and says so", () => {
  const { dir } = repo();
  const made = run(dir, ["new", "--dir", ".", "--title", "a task only this tree has", "--actor", "agent:a"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/([A-Z]+-\d+)-/)[1];
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  const file = join(dir, "tasks", name);
  writeFileSync(file, readFileSync(file, "utf8").replace('bash: "command to run"', 'bash: "true"'), "utf8");
  closeAs(dir, id, "agent:a");

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /on `main` it is absent\./);
  assert.match(r.stderr, new RegExp("→ \\S+ resume " + id + " --actor agent:a"));
});

test("a cancellation of one's own on an unmerged tree names resume too", () => {
  const { dir, id } = repo();
  const taken = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]);
  assert.equal(taken.status, 0, taken.stderr);
  const cancelled = run(dir, ["done", id, "--dir", ".", "--actor", "agent:a", "--status", "cancelled", "--reason", "superseded by another task"]);
  assert.equal(cancelled.status, 0, cancelled.stdout + cancelled.stderr);

  const out = takeJson(dir, id, "agent:a");
  assert.equal(out.refusalKind, "closed-unmerged");
  assert.match(out.refusal, /status: cancelled/);
});

test("an own closing merged into main keeps the reopen refusal", () => {
  const { dir, id } = repo();
  gitOk(dir, ["checkout", "-q", "-b", "work"]);
  closeAs(dir, id, "agent:a");
  gitOk(dir, ["add", "-A"]);
  gitOk(dir, ["commit", "-q", "-m", "closed on a branch"]);
  gitOk(dir, ["checkout", "-q", "main"]);
  gitOk(dir, ["merge", "-q", "--ff-only", "work"]);

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Reopen it deliberately/);
  assert.doesNotMatch(r.stderr, / resume /);
  const out = takeJson(dir, id, "agent:a");
  assert.equal(out.refusalKind, "closed");
  assert.equal(out.details.length, 2, out.details.join("\n"));
  assert.equal(out.details[0], "Reopen it deliberately — a closed task is a decision, not a free slot. The reason is recorded:");
  assert.match(out.details[1], new RegExp(" take " + id + " --reopen --reason \"…\" --actor agent:a$"));
});

test("a closing by somebody else keeps the reopen refusal even unmerged", () => {
  const { dir, id } = repo();
  closeAs(dir, id, "agent:a");

  const r = run(dir, ["take", id, "--dir", ".", "--actor", "agent:b"]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /Reopen it deliberately/);
  assert.doesNotMatch(r.stderr, / resume /);
  assert.equal(takeJson(dir, id, "agent:b").refusalKind, "closed");
});

test("the resume route the refusal prints answers when run as printed", () => {
  const { dir, id } = repo();
  closeAs(dir, id, "agent:a");

  const refusal = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]).stderr;
  const printed = refusal.match(/→ \S+ (resume .+)$/m);
  assert.ok(printed, refusal);
  const r = run(dir, printed[1].split(" ").concat(["--dir", "."]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /## Goal/);
});

test("the reopen route the refusal prints second reopens the task when run as printed", () => {
  const { dir, id } = repo();
  closeAs(dir, id, "agent:a");

  const refusal = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a"]).stderr;
  const printed = refusal.match(/→ \S+ (take .+ --reopen .+)$/m);
  assert.ok(printed, refusal);
  // The placeholder is the one word a caller has to supply; everything else
  // runs exactly as printed.
  const args = printed[1].replace('"…"', "REASON").split(" ")
    .map((a) => (a === "REASON" ? "rejected in review" : a));
  const r = run(dir, args.concat(["--dir", ".", "--json"]));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.from, "done");
  assert.equal(out.task.status, "in_progress");
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.match(readFileSync(join(dir, "tasks", name), "utf8"), /^status: in_progress/m);
});
