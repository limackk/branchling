/**
 * `take --reopen --reason` withdraws a closing (TL-714).
 *
 * WHAT WAS WRONG. In a supervised run a supervisor rejected two tasks after
 * `done` had already closed them. `take` refused a closed task with "reopen it
 * deliberately", `release` refuses anything not in progress and `set` refuses
 * `status`, so no command performed the act the refusal named, and the rework
 * ran on a task the file and the history still called proven.
 *
 * WHAT IS UNDER TEST, each case paired with the control that bounds it:
 *
 *   1. THE ROUTE THE REFUSAL PRINTS, RUN AS PRINTED, REOPENS THE TASK: the
 *      file is in progress under the new actor, the history carries the
 *      transition out of the closed status with the reason, `audit` counts it
 *      as a reopening, and the earlier closing stops being the proven one —
 *      checked against the same reader BEFORE the reopening, which found it.
 *   2. A REOPENED TASK CLOSES AGAIN, and the second closing is the proven one.
 *   3. THE CASE THE TASK MEASURED: an own closing that never reached `main`,
 *      which a plain `take` sends to `resume`, is reopened by the flag.
 *   4. THE FLAG NARROWS NOTHING SILENTLY: without a reason it is a usage error,
 *      and on a task that is not closed it is refused — both writing nothing,
 *      while the same take without the flag succeeds.
 *      The retry exception below covers an in-progress task only, not any
 *      task whose `owner:` names the caller, and an unknown flag lists
 *      `--reopen` among the ones `take` accepts.
 *   5. A RETRIED REOPEN is "already yours" and writes no second record.
 *
 * The fixture is a co-located backlog in its own repository, never this one:
 * statuses and their closing vocabulary are a project's data.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { provenClosing } from "../check-backlog-proofs.mjs";
import { readHistory } from "../history.mjs";
import { extractMeta, splitFrontmatter } from "../task-fields.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { git } from "./_git.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("take-reopen");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const REASON = "rejected in review: the full suite fails after the closing";

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
 *  contract passes, so `done` closes it for real and records it as proven. */
function repo() {
  const dir = fixtureDir(join(tmpdir(), "branchling-take-reopen-"));
  gitOk(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const made = run(dir, ["new", "--dir", ".", "--title", "a task to reopen", "--actor", "agent:a"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/([A-Z]+-\d+)-/)[1];
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  const file = join(dir, "tasks", name);
  writeFileSync(file, readFileSync(file, "utf8").replace('bash: "command to run"', 'bash: "true"'), "utf8");
  writeFileSync(join(dir, ".gitignore"), ".state/\n", "utf8");
  gitOk(dir, ["add", "-A"]);
  gitOk(dir, ["commit", "-q", "-m", "a pending task"]);
  return { dir, id, file };
}

function closeAs(dir, id, actor) {
  const taken = run(dir, ["take", id, "--dir", ".", "--actor", actor]);
  assert.equal(taken.status, 0, taken.stderr);
  const done = run(dir, ["done", id, "--dir", ".", "--actor", actor]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
}

/** Closed by agent:a and merged into `main`, so the closing stands everywhere. */
function closedOnMain() {
  const fixture = repo();
  closeAs(fixture.dir, fixture.id, "agent:a");
  gitOk(fixture.dir, ["add", "-A"]);
  gitOk(fixture.dir, ["commit", "-q", "-m", "closed"]);
  return fixture;
}

function meta(file) {
  return extractMeta(splitFrontmatter(readFileSync(file, "utf8")).frontmatter);
}

function proven(dir, id) {
  return provenClosing(readHistory(dir, id), ["done", "cancelled"]);
}

function reopen(dir, id, actor, extra = []) {
  return run(dir, ["take", id, "--dir", ".", "--reopen", "--reason", REASON, "--actor", actor].concat(extra));
}

test("the closed refusal names the reopen route, and the route run as printed reopens the task", () => {
  const { dir, id, file } = closedOnMain();
  assert.ok(proven(dir, id), "the positive control: the closing is the proven one before the reopening");

  const refused = run(dir, ["take", id, "--dir", ".", "--actor", "agent:b"]);
  assert.equal(refused.status, 1, refused.stderr);
  const printed = refused.stderr.match(/→ \S+ (take .+)$/m);
  assert.ok(printed, refused.stderr);
  // The reason is the one part a refusal cannot know; everything else is run
  // exactly as printed.
  const route = printed[1].match(/^take (\S+) --reopen --reason "…" --actor (\S+)$/);
  assert.ok(route, printed[1]);
  assert.equal(route[1], id);
  const r = run(dir, ["take", route[1], "--reopen", "--reason", REASON, "--actor", route[2], "--dir", "."]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(id + " reopened by agent:b — done → in_progress"));

  const after = meta(file);
  assert.equal(after.status, "in_progress");
  assert.equal(after.owner, "agent:b");

  const rows = readHistory(dir, id);
  const status = rows.filter((e) => e.field === "status").pop();
  assert.equal(status.from, "done");
  assert.equal(status.to, "in_progress");
  assert.equal(status.reason, REASON);
  assert.equal(status.actor, "agent:b");
  assert.equal(status.source, "take");
  const owner = rows.filter((e) => e.field === "owner").pop();
  assert.equal(owner.from, "agent:a");
  assert.equal(owner.to, "agent:b");
  assert.equal(owner.reason, REASON);

  assert.equal(proven(dir, id), null, "a withdrawn closing must not stay the proven one");
  const audit = run(dir, ["audit", "--dir", ".", "--json"]);
  const reopened = JSON.parse(audit.stdout).reopened;
  assert.deepEqual(
    reopened.map((f) => [f.task, f.from, f.to, f.closedBy, f.reopenedBy]),
    [[id, "done", "in_progress", "agent:a", "agent:b"]]
  );
});

test("a reopened task closes again, and the second closing is the proven one", () => {
  const { dir, id, file } = closedOnMain();
  const first = proven(dir, id);
  assert.equal(reopen(dir, id, "agent:b").status, 0);

  const done = run(dir, ["done", id, "--dir", ".", "--actor", "agent:b"]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(meta(file).status, "done");
  const second = proven(dir, id);
  assert.ok(second, "the second closing is proven");
  assert.equal(second.actor, "agent:b");
  assert.notEqual(second.ts, first.ts);
});

test("an own closing that never reached main is reopened, not sent to resume", () => {
  const { dir, id, file } = repo();
  closeAs(dir, id, "agent:a");
  const plain = run(dir, ["take", id, "--dir", ".", "--actor", "agent:a", "--json"]);
  assert.equal(plain.status, 1, plain.stdout + plain.stderr);
  assert.equal(JSON.parse(plain.stdout).refusalKind, "closed-unmerged");

  const r = reopen(dir, id, "agent:a", ["--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.taken, true);
  assert.equal(out.from, "done");
  assert.equal(out.task.status, "in_progress");
  assert.equal(meta(file).status, "in_progress");
  assert.equal(proven(dir, id), null);
});

test("--reopen without --reason is a usage error and writes nothing", () => {
  const { dir, id, file } = closedOnMain();
  const text = readFileSync(file, "utf8");
  const rows = readHistory(dir, id).length;

  const r = run(dir, ["take", id, "--dir", ".", "--reopen", "--actor", "agent:b"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /`--reopen` without `--reason`/);
  // The explanation is the part a caller acts on: where the reason goes.
  assert.match(r.stderr, /Withdrawing a closing is a decision of its own: the history keeps the reason\n/);
  assert.match(r.stderr, /on the transition out of the closed status, and nowhere else says why\./);
  assert.equal(readFileSync(file, "utf8"), text);
  assert.equal(readHistory(dir, id).length, rows);
});

test("--reopen on a task that is not closed is refused and writes nothing", () => {
  const { dir, id, file } = repo();
  const text = readFileSync(file, "utf8");
  const rows = readHistory(dir, id).length;

  const r = run(dir, ["take", id, "--dir", ".", "--reopen", "--reason", REASON, "--actor", "agent:b", "--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.refusalKind, "not-closed");
  assert.match(out.refusal, /is not closed \(status: pending\)/);
  assert.equal(out.details.length, 2, out.details.join("\n"));
  assert.equal(out.details[0], "Take it without the flag:");
  assert.match(out.details[1], new RegExp(" take " + id + " --actor agent:b$"));
  assert.equal(readFileSync(file, "utf8"), text);
  assert.equal(readHistory(dir, id).length, rows);

  // The control: the same take without the flag is not refused, and says
  // "taken", not "reopened" — nothing was withdrawn.
  const plain = run(dir, ["take", id, "--dir", ".", "--actor", "agent:b"]);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.match(plain.stdout, new RegExp(id + " taken by agent:b — pending → in_progress"));
});

test("--reopen on an open task the caller already owns, but not in progress, is refused", () => {
  // The retry exception is for the RESULT of a reopening — in progress under
  // this actor — not for any task whose `owner:` happens to name the caller.
  const { dir, id, file } = repo();
  writeFileSync(file, readFileSync(file, "utf8").replace(/^owner:.*$/m, "owner: agent:b"), "utf8");
  const text = readFileSync(file, "utf8");

  const r = reopen(dir, id, "agent:b", ["--json"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).refusalKind, "not-closed");
  assert.equal(readFileSync(file, "utf8"), text);
});

test("an unknown flag lists --reopen among the flags take accepts", () => {
  const { dir, id } = repo();
  const r = run(dir, ["take", id, "--dir", ".", "--no-such-flag"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /available: .*--reopen/);
});

test("a retried reopen is already yours and writes no second record", () => {
  const { dir, id } = closedOnMain();
  assert.equal(reopen(dir, id, "agent:b").status, 0);
  const rows = readHistory(dir, id).length;

  const again = reopen(dir, id, "agent:b");
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /already yours/);
  assert.equal(readHistory(dir, id).length, rows);

  // Somebody else's retry is not a retry: the task is in progress under
  // agent:b, so there is no closing for agent:c to withdraw.
  const other = reopen(dir, id, "agent:c", ["--json"]);
  assert.equal(other.status, 1, other.stdout + other.stderr);
  assert.equal(JSON.parse(other.stdout).refusalKind, "not-closed");
});
