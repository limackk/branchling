/**
 * `take` and `next` — the reservation, the choice, and the collision (TL-87).
 *
 * WHAT HAS TO BE PROVED HERE, and why each part needs a positive control:
 *
 *   1. The LOCK excludes. A refusal is easy to produce by accident — the task
 *      file itself says `owner:` after the first take, so a second caller could
 *      be refused for a reason that has nothing to do with the lock. Every test
 *      about the lock therefore takes it WITHOUT writing the file, so the only
 *      thing that can refuse is the reservation.
 *   2. Two REAL processes get two different tasks. Not two sequential calls: the
 *      window this closes is measured in microseconds and a sequential test
 *      cannot enter it.
 *   3. The test can SEE a duplicate. Run the same fleet with the reservation not
 *      shared and every session picks the same task — the selection alone gives
 *      everybody the same answer, which is precisely why the shared lock exists.
 *
 * The state directory is redirected into a temporary tree in EVERY test. A suite
 * that wrote to the user's real state directory would leak locks between runs
 * and, worse, could refuse a task in a real session.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireLock, isExpired, listLocks, lockScope, readLock, releaseLock, stateRoot } from "../lock.mjs";
import { loadConfig, parseConfigYaml } from "../config.mjs";
import { callerSpecies, lastHandoff, queueStatuses, selectCandidates, servesExecutor } from "../next-task.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { isolateHome } from "./_repo.mjs";

// The suite must not read the DEVELOPER's preferences: since TL-157 the actor
// chain reads the user layer, so a machine with `actor:` in its own config file
// would otherwise see every default-actor assertion below fail.
isolateHome("next");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

/** A backlog with `n` tasks, all pending, priorities in the order given. */
function fixture(priorities = ["P1", "P1", "P2"]) {
  const dir = tmp("next");
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = priorities.map((p, i) => {
    const r = run(["new", "--dir", backlog, "--title", "Task number " + (i + 1), "--priority", p], env);
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  });
  return { dir, backlog, state, env, ids };
}

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function taskText(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  return readFileSync(join(backlog, "tasks", file), "utf8");
}

function field(text, key) {
  const m = text.match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].trim() : null;
}

function historyEntries(backlog, id) {
  const file = join(backlog, "history", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── The lock primitive ────────────────────────────────────────────────────

test("a second session cannot take a lock somebody is holding", () => {
  const { backlog, state } = fixture();
  const env = { BACKLOG_STATE_DIR: state };
  const first = acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a1", ttlMinutes: 60, env });
  assert.equal(first.ok, true);

  const second = acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a2", ttlMinutes: 60, env });
  assert.equal(second.ok, false, "two sessions hold the same task at once");
  assert.equal(second.holder.actor, "agent:a1", "the refusal does not say who is holding it");

  // POSITIVE CONTROL: the refusal above must not be unconditional. Released, the
  // very same call has to succeed — otherwise the test would pass with a lock
  // that refuses everybody, which is not exclusion but a broken command.
  assert.equal(releaseLock({ root: backlog, taskId: "TASK-2", actor: "agent:a1", env }), true);
  const third = acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a2", ttlMinutes: 60, env });
  assert.equal(third.ok, true, "the lock refuses even when nobody is holding it");
});

test("a lock is not released by somebody who does not hold it", () => {
  const { backlog, state } = fixture();
  const env = { BACKLOG_STATE_DIR: state };
  acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a1", ttlMinutes: 60, env });
  assert.equal(releaseLock({ root: backlog, taskId: "TASK-2", actor: "agent:a2", env }), false);
  assert.equal(readLock(join(state, "locks", lockScope(backlog).key), "TASK-2").actor, "agent:a1");
});

test("an expired lock is taken over, and the take-over is recorded", () => {
  const { backlog, state } = fixture();
  const env = { BACKLOG_STATE_DIR: state };
  const t0 = Date.parse("2026-09-01T10:00:00.000Z");
  acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a1", ttlMinutes: 30, now: t0, env });

  const tooEarly = acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a2", ttlMinutes: 30, now: t0 + 29 * 60_000, env });
  assert.equal(tooEarly.ok, false, "the lock expired before its TTL");

  const later = acquireLock({ root: backlog, taskId: "TASK-2", actor: "agent:a2", ttlMinutes: 30, now: t0 + 31 * 60_000, env });
  assert.equal(later.ok, true, "a lock outlived its TTL and still blocks the queue");
  assert.equal(later.lock.tookOver.actor, "agent:a1", "the take-over left no trace of whose lock it was");
});

test("a lock with an unreadable timestamp counts as expired", () => {
  assert.equal(isExpired({ ts: "not a date" }, 60, Date.now()), true);
  assert.equal(isExpired(null, 60, Date.now()), true);
  // POSITIVE CONTROL: a fresh, readable one does not.
  assert.equal(isExpired({ ts: new Date().toISOString() }, 60, Date.now()), false);
});

test("every worktree of one repository shares the lock namespace", () => {
  const dir = tmp("worktree");
  const repo = join(dir, "repo");
  const git = (cwd, ...args) => execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" });
  execFileSync("git", ["init", "-q", "-b", "main", repo], { encoding: "utf8" });
  assert.equal(run(["init", "--dir", join(repo, "backlog"), "--no-example"]).status, 0);
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "seed");
  const linked = join(dir, "wt");
  git(repo, "worktree", "add", "-q", linked, "-b", "side");

  const a = lockScope(join(repo, "backlog"));
  const b = lockScope(join(linked, "backlog"));
  assert.equal(a.key, b.key,
    "two worktrees of one repository landed in different lock namespaces — the case this exists for");

  // POSITIVE CONTROL: an unrelated tree must NOT share it, or the key would be
  // a constant and every backlog on the machine would lock against every other.
  const other = lockScope(fixture().backlog);
  assert.notEqual(other.key, a.key);
});

test("the state directory is redirectable and never guessed from the product name", () => {
  assert.equal(stateRoot({ BACKLOG_STATE_DIR: "/tmp/x" }), "/tmp/x");
  assert.ok(stateRoot({ XDG_STATE_HOME: "/tmp/xdg" }).startsWith("/tmp/xdg/"));
  assert.ok(stateRoot({}).includes(".local"));
});

// ── take ──────────────────────────────────────────────────────────────────

test("take claims the task: status, owner, date and a history entry", () => {
  const { backlog, env, ids } = fixture();
  const r = run(["take", ids[1], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(r.status, 0, r.stderr);

  const text = taskText(backlog, ids[1]);
  assert.equal(field(text, "status"), "in_progress");
  assert.equal(field(text, "owner"), "agent:a1");
  assert.equal(field(text, "updated"), new Date().toISOString().slice(0, 10));

  const entries = historyEntries(backlog, ids[1]).filter((e) => e.source === "take");
  assert.ok(entries.length >= 2, "the take left no history entry");
  const status = entries.find((e) => e.field === "status");
  assert.equal(status.to, "in_progress");
  assert.equal(status.actor, "agent:a1");

  // The whole task goes to stdout — whoever runs this is about to do the work.
  assert.ok(r.stdout.includes("id: " + ids[1]), "the task itself was not printed");
  assert.ok(r.stdout.includes("## Goal") || r.stdout.includes("## Acceptance criteria"),
    "only the frontmatter was printed, not the task");
});

test("take refuses a task another session HOLDS — with the file still untouched", () => {
  const { backlog, state, env, ids } = fixture();
  // The lock alone. The file still says `pending` with no owner, so nothing but
  // the reservation can produce this refusal.
  acquireLock({ root: backlog, taskId: ids[0], actor: "agent:a1", ttlMinutes: 60, env: { BACKLOG_STATE_DIR: state } });

  const r = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a2"], env);
  assert.equal(r.status, 1, "a held task was handed out (exit " + r.status + ")");
  assert.match(r.stderr, /agent:a1/, "the refusal does not name the holder");
  assert.equal(field(taskText(backlog, ids[0]), "status"), "pending", "the refused take still wrote the file");
  assert.equal(historyEntries(backlog, ids[0]).filter((e) => e.source === "take").length, 0);

  // POSITIVE CONTROL: without that lock the same call succeeds, so the refusal
  // is the lock's doing and not something about this task.
  releaseLock({ root: backlog, taskId: ids[0], actor: "agent:a1", env: { BACKLOG_STATE_DIR: state } });
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "agent:a2"], env).status, 0);
});

test("take is idempotent for the session that already owns the task", () => {
  const { backlog, env, ids } = fixture();
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env).status, 0);
  const before = historyEntries(backlog, ids[0]).length;
  const again = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(again.status, 0, "a retry by the owner was refused: " + again.stderr);
  assert.equal(historyEntries(backlog, ids[0]).length, before, "the retry wrote a second history entry");
});

test("take refuses somebody else's in-progress task, and a closed one", () => {
  const { backlog, env, ids } = fixture();
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env).status, 0);
  const other = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a2"], env);
  assert.equal(other.status, 1);
  assert.match(other.stderr, /agent:a1/);

  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[2] + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
  const closed = run(["take", ids[2], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(closed.status, 1);
  assert.match(closed.stderr, /closed/);
});

test("take fails loudly on an unknown id and on an actor with no namespace", () => {
  const { backlog, env, ids } = fixture();
  const unknown = run(["take", "TASK-9999", "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(unknown.status, 2, "an unknown id is a usage error, not a refusal");

  const bare = run(["take", ids[0], "--dir", backlog, "--actor", "claude"], env);
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /namespace/);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "pending", "a rejected actor still wrote the file");
});

test("an unknown flag fails instead of being ignored", () => {
  const { backlog, env, ids } = fixture();
  for (const args of [["take", ids[0], "--force"], ["next", "--statu", "pending"]]) {
    const r = run(args.concat(["--dir", backlog]), env);
    assert.equal(r.status, 2, args.join(" ") + " did not fail");
    assert.equal(field(taskText(backlog, ids[0]), "status"), "pending");
  }
  // `next` takes no positional argument — that is what `take` is for.
  assert.equal(run(["next", "TASK-2", "--dir", backlog], env).status, 2);
});

// ── next ──────────────────────────────────────────────────────────────────

test("next hands out the highest priority executable task", () => {
  const { backlog, env, ids } = fixture(["P2", "P0", "P1"]);
  const r = run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, ids[1], "priority order came out wrong");
  assert.equal(out.task.owner, "agent:a1");
  assert.equal(out.taken, true);
});

test("a task whose blockers are open is never handed out", () => {
  const { backlog, env, ids } = fixture(["P0", "P2"]);
  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^blocked_by: .*$/m, "blocked_by: [" + ids[1] + "]"), "utf8");

  const first = JSON.parse(run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env).stdout);
  assert.equal(first.id, ids[1], "a blocked task was handed out ahead of its blocker");

  // POSITIVE CONTROL: it is the BLOCKER that keeps it back, not the sort order —
  // close the blocker and the same call hands out the task it was holding.
  const blocker = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[1] + "-")));
  writeFileSync(blocker, readFileSync(blocker, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");
  const second = JSON.parse(run(["next", "--dir", backlog, "--actor", "agent:a2", "--json"], env).stdout);
  assert.equal(second.id, ids[0]);
});

test("an empty queue is code 3 — neither success nor a usage error", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:a1"], env).status, 0);
  const empty = run(["next", "--dir", backlog, "--actor", "agent:a2"], env);
  assert.equal(empty.status, 3, "an empty queue is indistinguishable from an error");
  assert.match(empty.stdout, /nothing to take/);
  assert.equal(empty.stderr, "", "an empty queue was reported as a diagnostic");
  assert.ok(ids.length === 1);
});

test("the filters narrow the choice, and they are query's filters", () => {
  const { backlog, env, ids } = fixture(["P0", "P2"]);
  const r = run(["next", "--dir", backlog, "--actor", "agent:a1", "--priority", "P2", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).id, ids[1], "--priority did not narrow the choice");

  // A filter that matches nothing answers "nothing to take". The value has to
  // be a REAL one for that to be the answer: labels are an open vocabulary
  // here, so a label no task carries is a legitimate question with an empty
  // answer.
  const nothing = run(["next", "--dir", backlog, "--actor", "agent:a2", "--label", "unused"], env);
  assert.equal(nothing.status, 3);

  // A value outside a CLOSED vocabulary is a typo, and since TL-161 it fails
  // instead. Exit 3 is what a loop stops on, so a typo that answered it would
  // report a queue as finished.
  const board = run(["next", "--dir", backlog, "--actor", "agent:a2", "--board", "nonexistent"], env);
  assert.equal(board.status, 2, "a board outside the registry answered `nothing to take`");
  assert.match(board.stderr, /`nonexistent` is not an allowed value/);
});

test("statuses a project protects with a reason are not dispatched", () => {
  const { backlog, env, ids } = fixture(["P0", "P1"]);
  // Stated by the FIXTURE, not assumed of a fresh `init` (CLAUDE.md): which
  // statuses a project protects is that project's data, not this tool's
  // contract, and a test that assumed a value would be asserting somebody
  // else's configuration.
  const configPath = join(backlog, "config.yaml");
  writeFileSync(configPath,
    readFileSync(configPath, "utf8") + "\nreason_required_statuses: [blocked, cancelled]\n", "utf8");
  const config = loadConfig(backlog);
  assert.deepEqual(queueStatuses(config), ["pending"],
    "the dispatcher would hand out a status entering which requires a stated reason");

  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: blocked"), "utf8");
  const r = run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env);
  assert.equal(JSON.parse(r.stdout).id, ids[1], "a `blocked` task was dispatched");

  // POSITIVE CONTROL: asked for explicitly by a person, it IS handed out — the
  // rule is about what an unattended dispatcher may choose, not a prohibition.
  const asked = run(["next", "--dir", backlog, "--actor", "agent:a2", "--status", "blocked", "--json"], env);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(asked.stdout).id, ids[0]);
});

// ── Real concurrency ──────────────────────────────────────────────────────

function fleet(size, env, backlog, extra = []) {
  const kids = [];
  for (let i = 0; i < size; i++) {
    kids.push(new Promise((resolve) => {
      const child = spawn(process.execPath,
        [CLI, "next", "--dir", backlog, "--actor", "agent:a" + i, "--json"].concat(extra),
        { env: typeof env === "function" ? env(i) : env });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("close", (code) => resolve({ code, out, err }));
    }));
  }
  return Promise.all(kids);
}

test("two sessions asking at the same moment never get the same task", async () => {
  const { backlog, env } = fixture(["P1", "P1", "P1", "P1", "P1", "P1"]);
  const results = await fleet(6, env, backlog);
  const taken = results.filter((r) => r.code === 0).map((r) => JSON.parse(r.out).id);
  assert.equal(taken.length, 6, "some sessions came back empty-handed: " +
    results.map((r) => r.code + " " + r.err + r.out).join(" | "));
  assert.equal(new Set(taken).size, taken.length,
    "the same task was handed to two sessions: " + taken.join(", "));

  // Every claim is also visible in the tree — six files, six different owners.
  const owners = readTaskRecords(join(backlog, "tasks"), loadConfig(backlog).taskId.file)
    .filter((t) => t.status === "in_progress").map((t) => t.owner);
  assert.equal(new Set(owners).size, 6);
});

test("positive control: without a SHARED reservation everybody picks the same task", async () => {
  // Each session gets its own copy of the tree and its own state directory —
  // that is, exactly the situation the shared lock removes. The selection is
  // deterministic, so all of them choose the same id. If this test ever went
  // green, the one above would be proving nothing.
  const { backlog, dir } = fixture(["P1", "P1", "P1", "P1"]);
  const copies = [];
  for (let i = 0; i < 4; i++) {
    const copy = join(dir, "copy" + i);
    cpSync(backlog, copy, { recursive: true });
    copies.push(copy);
  }
  const picks = await Promise.all(copies.map((copy, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, "next", "--dir", copy, "--actor", "agent:b" + i, "--json"],
      { env: { ...process.env, BACKLOG_STATE_DIR: join(dir, "state" + i), NO_COLOR: "1" } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", () => {});
    child.on("close", () => resolve(JSON.parse(out).id));
  })));
  assert.equal(new Set(picks).size, 1,
    "unreserved sessions came back with different tasks — then the test above cannot detect a collision");
});

// ── The structure the acceptance criteria ask for ─────────────────────────

test("`next` has no reservation path of its own", () => {
  const source = readFileSync(join(SCRIPTS, "next-task.mjs"), "utf8");
  assert.match(source, /takeTask/, "next does not call the take primitive at all");
  for (const forbidden of ["acquireLock", "writeFileSync", "recordEdit", "setFrontmatterField"]) {
    assert.ok(source.indexOf(forbidden) < 0,
      "next-task.mjs reserves or writes on its own (`" + forbidden + "`) — that is a second path");
  }
  // POSITIVE CONTROL: those names have to exist SOMEWHERE, or the loop above is
  // checking for words this codebase never uses.
  const primitive = readFileSync(join(SCRIPTS, "take-task.mjs"), "utf8");
  for (const required of ["acquireLock", "writeFileSync", "recordEdit", "setFrontmatterField"]) {
    assert.match(primitive, new RegExp(required), "take-task.mjs does not " + required);
  }
});

test("query and next choose over the same code", () => {
  const query = readFileSync(join(SCRIPTS, "query.mjs"), "utf8");
  const next = readFileSync(join(SCRIPTS, "next-task.mjs"), "utf8");
  for (const source of [query, next]) {
    assert.match(source, /from "\.\/task-select\.mjs"/, "a second copy of the filters");
  }
  // And they agree on a real tree: what `next` hands out is what `query` puts
  // first, given the same filters.
  const { backlog, env } = fixture(["P2", "P0", "P1"]);
  const asked = JSON.parse(run(["query", "--dir", backlog, "--status", "pending", "--json"], env).stdout);
  const taken = JSON.parse(run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env).stdout);
  assert.equal(taken.id, asked.tasks[0].id);
});

// ── The vocabulary is the project's ───────────────────────────────────────

test("a backlog with renamed statuses is asked which one means `in progress`", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  const configPath = join(backlog, "config.yaml");
  const renamed = readFileSync(configPath, "utf8")
    .replace(/^statuses: .*$/m, "statuses: [todo, doing, parked, shipped, dropped]")
    .replace(/^archived_statuses: .*$/m, "archived_statuses: [shipped, dropped]")
    .replace(/^dashboard_open_statuses: .*$/m, "dashboard_open_statuses: [todo, doing, parked]")
    // `init` declares this since TL-140, so a fixture renaming the statuses has
    // to rename it too rather than leave the configuration naming missing words.
    .replace(/^reason_required_statuses: .*$/m, "reason_required_statuses: [parked, dropped]");
  writeFileSync(configPath, renamed, "utf8");
  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: todo"), "utf8");

  const refused = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(refused.status, 1, "a status of our own choosing was written into somebody's tree");
  assert.match(refused.stderr, /in_progress_status/);

  // POSITIVE CONTROL: once the project says which word it uses, it works.
  writeFileSync(configPath, renamed + "\nin_progress_status: doing\n", "utf8");
  const ok = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "doing");
});

test("a status the project protects cannot be entered without a reason", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  const configPath = join(backlog, "config.yaml");
  writeFileSync(configPath,
    readFileSync(configPath, "utf8").replace(/^reason_required_statuses: .*$/m, "") +
      "\nreason_required_statuses: [in_progress, done, cancelled]\n", "utf8");

  const refused = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(refused.status, 1, "the rule was written down and not enforced");
  assert.match(refused.stderr, /reason/);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "pending");

  const ok = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1", "--reason", "picked up in this session"], env);
  assert.equal(ok.status, 0, ok.stderr);
  const entry = historyEntries(backlog, ids[0]).find((e) => e.field === "status" && e.source === "take");
  assert.equal(entry.reason, "picked up in this session");
});

test("a reserved reason cannot be typed by hand", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  for (const reserved of ["unknown", "proven"]) {
    const r = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1", "--reason", reserved], env);
    assert.equal(r.status, 2, "`--reason " + reserved + "` was accepted");
  }
});

test("lock_ttl_minutes is a number the configuration owns", () => {
  const { backlog } = fixture(["P1"]);
  assert.equal(loadConfig(backlog).lockTtlMinutes, 120);
  const configPath = join(backlog, "config.yaml");
  writeFileSync(configPath, readFileSync(configPath, "utf8").replace(/^lock_ttl_minutes: .*$/m, "lock_ttl_minutes: 0"), "utf8");
  assert.throws(() => loadConfig(backlog), /lock_ttl_minutes/);
  assert.deepEqual(parseConfigYaml("lock_ttl_minutes: nope").problems.length, 1);
});

// ── Closing gives the reservation back ────────────────────────────────────

test("done releases the lock the take made", () => {
  const { backlog, state, env, ids } = fixture(["P1"]);
  assert.equal(run(["take", ids[0], "--dir", backlog, "--actor", "agent:a1"], env).status, 0);
  assert.equal(listLocks(backlog, { env: { BACKLOG_STATE_DIR: state } }).length, 1);

  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
  const text = readFileSync(file, "utf8");
  const [, frontmatter, body] = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  // A contract that passes, and criteria that name it — the template ships a
  // placeholder proof id, and `done` rightly refuses a criterion pointing at an
  // entry that does not exist.
  writeFileSync(file, "---\n" +
    frontmatter.replace(/^verification:[\s\S]*$/m, 'verification:\n  - id: it-runs\n    bash: "true"') +
    "\n---\n" + body.replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");

  const closed = run(["done", ids[0], "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  assert.equal(listLocks(backlog, { env: { BACKLOG_STATE_DIR: state } }).length, 0,
    "the closed task is still reserved");
});

// ── Selection is pure and testable without a tree ─────────────────────────

test("selectCandidates is pure: no disk, and it says what it skipped", () => {
  const config = { activeStatuses: ["pending", "in_progress"], archivedStatuses: ["done"],
    reasonRequiredStatuses: ["done"], inProgressStatus: "in_progress",
    priorities: ["P0", "P1"], taskIdPrefix: "T" };
  const records = [
    { id: "T-1", status: "pending", priority: "P1", labels: [], blocked_by: ["T-3"], board: "main", epic: "", owner: "", type: "task", title: "" },
    { id: "T-2", status: "pending", priority: "P0", labels: [], blocked_by: [], board: "main", epic: "", owner: "", type: "task", title: "" },
    { id: "T-3", status: "pending", priority: "P1", labels: [], blocked_by: [], board: "main", epic: "", owner: "", type: "task", title: "" },
  ];
  const { candidates, skippedBlocked } = selectCandidates(records, config, {});
  assert.deepEqual(candidates.map((t) => t.id), ["T-2", "T-3"]);
  assert.equal(skippedBlocked, 1);
});

test("a closed dependency does not reopen an unanswered decision", () => {
  const config = { activeStatuses: ["pending", "in_progress"], archivedStatuses: ["done"],
    reasonRequiredStatuses: ["blocked"], inProgressStatus: "in_progress",
    priorities: ["P0", "P1"], taskIdPrefix: "T" };
  const question = { id: "Q-1", field: "__comment__", source: "ask", to: "which shape?" };
  const records = [
    { id: "T-1", status: "blocked", priority: "P0", labels: [], blocked_by: ["T-3"], history: [question], board: "main", epic: "", owner: "", type: "task", title: "" },
    { id: "T-2", status: "blocked", priority: "P1", labels: [], blocked_by: ["T-3"], history: [], board: "main", epic: "", owner: "", type: "task", title: "" },
    { id: "T-3", status: "done", priority: "P1", labels: [], blocked_by: [], history: [], board: "main", epic: "", owner: "", type: "task", title: "" },
  ];
  const selected = selectCandidates(records, config, {});
  assert.deepEqual(selected.candidates.map((t) => t.id), ["T-2"],
    "a question block was treated like an ordinary dependency block");

  records[0].history.push({ id: "D-1", field: "__decision__", resolves: "Q-1", to: "use the stable shape" });
  const answered = selectCandidates(records, config, {});
  assert.deepEqual(answered.candidates.map((t) => t.id), ["T-1", "T-2"],
    "answering the recorded question did not restore queue eligibility");
});

// ── Roles in the dispatcher (TL-98) ───────────────────────────────────────
//
// The roles are the FIXTURE's own. `roles:` is a project's vocabulary, and a
// test asserting one project's job titles would be a copy of somebody's
// config.yaml rather than a statement about the code.

/** Declare a vocabulary of roles and give some tasks one. */
function withRoles(backlog, roles, assignments) {
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8") + "\nroles: [" + roles.join(", ") + "]\n", "utf8");
  for (const [id, role] of Object.entries(assignments)) {
    const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
    const file = join(backlog, "tasks", name);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role:.*$/m, "role: " + role), "utf8");
  }
}

test("--role hands out that role AND the tasks that ask for nobody", () => {
  const { backlog, env, ids } = fixture(["P1", "P1"]);
  withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason" });

  // ids[0] asks for a stonemason, ids[1] for nobody. An archivist gets the
  // second one — never the first.
  const first = run(["next", "--dir", backlog, "--actor", "agent:a", "--role", "archivist", "--json"], env);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).id, ids[1]);

  const second = run(["next", "--dir", backlog, "--actor", "agent:a", "--role", "archivist"], env);
  assert.equal(second.status, 3, "the stonemason's task was handed to an archivist: " + second.stdout);
  assert.match(second.stdout, /searched roles: archivist \(or no role at all\)/);
});

test("--role-strict leaves the role-less tasks for somebody else", () => {
  const { backlog, env, ids } = fixture(["P1", "P1"]);
  withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason" });

  const r = run(["next", "--dir", backlog, "--actor", "agent:a", "--role", "archivist", "--role-strict"], env);
  assert.equal(r.status, 3, "a role-less task was handed out under --role-strict: " + r.stdout);
  // POSITIVE CONTROL: the same call for the role that IS on a task does hand it out.
  const s = run(["next", "--dir", backlog, "--actor", "agent:a", "--role", "stonemason", "--role-strict", "--json"], env);
  assert.equal(s.status, 0, s.stderr);
  assert.equal(JSON.parse(s.stdout).id, ids[0]);
});

test("several roles at once, and a role outside the vocabulary fails", () => {
  const { backlog, env, ids } = fixture(["P1", "P1", "P2"]);
  withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason", [ids[1]]: "archivist" });

  const r = run(["next", "--dir", backlog, "--actor", "agent:a", "--role", "archivist,stonemason", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok([ids[0], ids[1]].includes(JSON.parse(r.stdout).id));

  const bad = run(["next", "--dir", backlog, "--actor", "agent:b", "--role", "carpenter"], env);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown role/);
});

test("--role-strict on its own is a usage error, not a silently ignored flag", () => {
  const { backlog, env } = fixture(["P1"]);
  const r = run(["next", "--dir", backlog, "--actor", "agent:a", "--role-strict"], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /with no `--role`/);
});

test("`take <ID>` is untouched by roles — the gate belongs to the dispatcher", () => {
  const { backlog, env, ids } = fixture(["P1", "P1"]);
  withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason" });
  // No role declared by the caller, no flag: the direct mode works exactly as it
  // did, and TL-97 says why — a person naming a task outranks the field.
  const r = run(["take", ids[0], "--dir", backlog, "--actor", "agent:a"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "in_progress");
});

// ── executor: who may be HANDED it (TL-113) ───────────────────────────────
//
// A third axis, and the test keeps it separate from the other two on purpose:
// `role` is a competence and its vocabulary is the project's, `executor` is a
// species and its two values are the shape of the field. Mixing them in one
// case would hide which one did the excluding.

function withExecutor(backlog, assignments) {
  for (const [id, value] of Object.entries(assignments)) {
    const name = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
    const file = join(backlog, "tasks", name);
    const text = readFileSync(file, "utf8");
    writeFileSync(file, /^executor:/m.test(text)
      ? text.replace(/^executor:.*$/m, "executor: " + value)
      : text.replace(/^role:(.*)$/m, "role:$1\nexecutor: " + value), "utf8");
  }
}

test("an agent is never handed a task marked `executor: human`", () => {
  const { backlog, env, ids } = fixture(["P1", "P2"]);
  withExecutor(backlog, { [ids[0]]: "human" });

  const r = run(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).id, ids[1], "the P1 marked for a person was handed to an agent");

  // POSITIVE CONTROL: a person asking gets it, and it is the higher priority one.
  const p = run(["next", "--dir", backlog, "--actor", "local:kamil", "--json"], env);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(JSON.parse(p.stdout).id, ids[0]);
});

test("the skip is counted and named, never silent", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  withExecutor(backlog, { [ids[0]]: "human" });

  const r = run(["next", "--dir", backlog, "--actor", "agent:claude"], env);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /1 of them wait for a person/);
  assert.match(r.stdout, new RegExp(ids[0]));

  const j = run(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
  assert.deepEqual(JSON.parse(j.stdout).skippedExecutor, [{ id: ids[0], executor: "human" }]);
});

test("`executor: agent` is the mirror image, and a person is the one skipped", () => {
  const { backlog, env, ids } = fixture(["P1", "P2"]);
  withExecutor(backlog, { [ids[0]]: "agent" });

  const person = run(["next", "--dir", backlog, "--actor", "local:kamil", "--json"], env);
  assert.equal(JSON.parse(person.stdout).id, ids[1]);
  const agent = run(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
  assert.equal(JSON.parse(agent.stdout).id, ids[0]);
});

test("`take <ID>` is untouched: naming a task IS the human decision", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  withExecutor(backlog, { [ids[0]]: "human" });
  const r = run(["take", ids[0], "--dir", backlog, "--actor", "agent:claude"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(field(taskText(backlog, ids[0]), "status"), "in_progress");
  // And it is in the history under the agent that took it, so "who did this"
  // still has an answer.
  const row = historyEntries(backlog, ids[0]).find((e) => e.field === "status" && e.to === "in_progress");
  assert.equal(row.actor, "agent:claude");
});

test("a task with no `executor` is handed to anybody — the field is optional", () => {
  const { backlog, env, ids } = fixture(["P1"]);
  const r = run(["next", "--dir", backlog, "--actor", "agent:claude", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).id, ids[0]);
});

test("the species comes from the actor's namespace and nothing else", () => {
  assert.equal(callerSpecies("agent:claude"), "agent");
  assert.equal(callerSpecies("AGENT:Claude"), "agent");
  assert.equal(callerSpecies("local:kamil"), "human");
  assert.equal(callerSpecies("user:kamil"), "human");
  assert.equal(callerSpecies(""), "human");
  // An empty field means anybody, which is the majority of tasks.
  assert.equal(servesExecutor({ executor: "" }, "agent"), true);
  assert.equal(servesExecutor({ executor: "human" }, "agent"), false);
  assert.equal(servesExecutor({ executor: "human" }, "human"), true);
});

// ── A task handed back is not re-offered to the actor who did it (TL-141) ──
//
// Measured twice in a row on 2026-09-02: a session judged TL-137 too large for
// one session, said so with `handoff`, and `next` offered it again on the very
// next call — because nothing about a handoff was part of selection. The
// judgement is a fact in the tree, so the dispatcher reads it; a loop that
// filtered candidates itself would be a queue with the choosing put back in.

test("lastHandoff reads the tree's LAST word, not `was ever handed off`", () => {
  const back = { source: "handoff", field: "__comment__", actor: "agent:a1", to: "too large" };
  assert.equal(lastHandoff([]), null);
  assert.deepEqual(lastHandoff([back]), { actor: "agent:a1", reason: "too large" });
  // The field rows a handoff writes alongside its comment do not hide it.
  assert.deepEqual(
    lastHandoff([{ source: "handoff", field: "owner", actor: "agent:a1" }, back]),
    { actor: "agent:a1", reason: "too large" },
  );
  // Anything recorded AFTER it is the task moving on, and a stale judgement
  // must not outlive the state it was made about.
  assert.equal(lastHandoff([back, { source: "take", field: "status", actor: "agent:a2" }]), null);
});

test("a task this actor handed back is not the next thing it is offered", () => {
  const { backlog, env, ids } = fixture(["P0", "P2"]);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env).status, 0);
  const h = run(["handoff", ids[0], "--dir", backlog, "--actor", "agent:a1",
    "--to-owner", "unassigned", "--reason", "a week of work does not fit a session"], env);
  assert.equal(h.status, 0, h.stderr);

  const r = run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, ids[1], "the handed-back task was offered straight back");
  // Never silent: the pass-over is in `--json`, with the reason that was given.
  assert.equal(out.skippedHandedBack.length, 1);
  assert.equal(out.skippedHandedBack[0].id, ids[0]);
  assert.match(out.skippedHandedBack[0].reason, /does not fit a session/);

  // …and on stdout, for the reader who is not parsing anything.
  const plain = run(["next", "--dir", backlog, "--actor", "agent:a1"], env);
  assert.equal(plain.status, 3, plain.stdout + plain.stderr);
  assert.match(plain.stdout + plain.stderr, new RegExp(ids[0] + " skipped — you handed it back yourself"));
});

test("POSITIVE CONTROL: another actor is still offered the same task", () => {
  // Without this, a rule that simply hid handed-back work would pass the test
  // above and empty the queue for everybody.
  const { backlog, env, ids } = fixture(["P0", "P2"]);
  assert.equal(run(["next", "--dir", backlog, "--actor", "agent:a1", "--json"], env).status, 0);
  const h = run(["handoff", ids[0], "--dir", backlog, "--actor", "agent:a1",
    "--to-owner", "unassigned", "--reason", "too large for me"], env);
  assert.equal(h.status, 0, h.stderr);

  const r = run(["next", "--dir", backlog, "--actor", "agent:a2", "--json"], env);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.id, ids[0], "a handoff held the task back from everybody, not from its author");
  assert.equal(out.skippedHandedBack.length, 0);
});

test("the rule lives in the dispatcher: `selectCandidates` decides, no caller does", () => {
  // The criterion of TL-141 that a test can actually hold: the pure selector
  // takes the fact and applies it, so nothing in `run` — the loop or any other
  // caller — has a filter of its own to keep in step.
  const records = [
    { id: "T-1", status: "pending", priority: "P0", handedBack: { actor: "agent:a1", reason: "big" } },
    { id: "T-2", status: "pending", priority: "P2" },
  ];
  const config = {
    statuses: ["pending", "in_progress", "done"],
    activeStatuses: ["pending", "in_progress"],
    archivedStatuses: ["done"],
    inProgressStatus: "in_progress",
    reasonRequiredStatuses: [],
    priorities: ["P0", "P1", "P2"],
  };
  const mine = selectCandidates(records, config, { actor: "agent:a1" }, Date.now());
  assert.deepEqual(mine.candidates.map((t) => t.id), ["T-2"]);
  assert.deepEqual(mine.skippedHandedBack, [{ id: "T-1", actor: "agent:a1", reason: "big" }]);

  const theirs = selectCandidates(records, config, { actor: "agent:a2" }, Date.now());
  assert.deepEqual(theirs.candidates.map((t) => t.id), ["T-1", "T-2"]);
  assert.deepEqual(theirs.skippedHandedBack, []);
});
