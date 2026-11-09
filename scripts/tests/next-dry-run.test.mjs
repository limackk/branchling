/**
 * `next --dry-run` names the task `next` would hand out and writes nothing
 * (TL-644).
 *
 * THE DEFECT THIS GUARDS. "What should I work on" had a claim as its side
 * effect: a session asked only to survey the backlog ran `next`, which moved a
 * task to in progress under its name, and undoing that took a `release` with
 * a reason plus two restored files — the history kept both acts.
 *
 * TWO CLAIMS, EACH WITH A CONTROL THAT GIVES IT FORCE.
 *
 *   writes nothing   the tree (`git status --porcelain --ignored`) and the
 *                    state directory are byte-for-byte the same before and
 *                    after the dry run. The control is the real `next` that
 *                    follows: it changes BOTH, so the two observations are
 *                    able to see a claim at all. Without it, a snapshot that
 *                    read the wrong directory would be green for nothing.
 *   names the same  the id the dry run projects is the id the real `next`
 *   task             takes next. Asked on a fixture where the answer is NOT
 *                    the first task in priority order — a reservation held by
 *                    another session moves it — because a projection that
 *                    merely sorted the queue would pass a one-task fixture.
 *
 * The state directory is redirected into the fixture in every test: a suite
 * writing to the user's real one would leak locks between runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { acquireLock, lockDir, peekLock } from "../lock.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("next-dry-run");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return fixtureDir(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, opts) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, ...opts });
}

function vcs(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" }
  );
}

/** A committed repository holding a backlog with one pending task per priority. */
function fixture(priorities) {
  const dir = tmp("next-dry-run");
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], { env }).status, 0);
  const ids = priorities.map((p, i) => {
    const r = cli(["new", "--dir", backlog, "--title", "Task number " + (i + 1), "--priority", p], { env });
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  });
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);
  return { dir, repoRoot, backlog, state, env, ids };
}

/** Every file under the state directory with its content; empty when absent. */
function stateSnapshot(state) {
  const out = {};
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(state, p)] = readFileSync(p, "utf8");
    }
  };
  walk(state);
  return out;
}

/** Rewrite one frontmatter field, then commit, so the tree is clean again. */
function setFields(f, id, fields) {
  const name = readdirSync(join(f.backlog, "tasks")).find((n) => n.startsWith(id + "-"));
  const file = join(f.backlog, "tasks", name);
  let text = readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(fields)) {
    const at = new RegExp("^" + key + ": .*$", "m");
    assert.match(text, at, "the field `" + key + "` is not in " + id);
    text = text.replace(at, key + ": " + value);
  }
  writeFileSync(file, text, "utf8");
}

function commitAll(f) {
  vcs(f.repoRoot, ["add", "-A"]);
  vcs(f.repoRoot, ["commit", "-qm", "fixture"]);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function treeStatus(repoRoot) {
  return vcs(repoRoot, ["status", "--porcelain", "--ignored"]);
}

function parse(r) {
  assert.equal(r.stderr, "", "stderr is not empty under --json: " + r.stderr);
  return JSON.parse(r.stdout);
}

test("next --dry-run names the task next takes, and the tree and state directory do not change", () => {
  const f = fixture(["P2", "P1"]);
  try {
    const run = (extra) => cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json"].concat(extra),
      { cwd: f.repoRoot, env: f.env });
    const treeBefore = treeStatus(f.repoRoot);
    const stateBefore = stateSnapshot(f.state);

    const dry = run(["--dry-run"]);
    assert.equal(dry.status, 0, dry.stderr);
    const projected = parse(dry);
    assert.equal(projected.kind, "task-take");
    assert.equal(projected.dryRun, true);
    assert.equal(projected.taken, false);
    assert.equal(projected.ok, true);
    assert.equal(projected.lock, null, "a dry run reported a reservation");
    assert.equal(projected.id, f.ids[1], "the projection did not follow priority");
    assert.equal(projected.task.status, "pending", "`task` is not the task as it stands");
    assert.equal(projected.reclaimed, null, "a fresh task was projected as a reclaim");
    assert.equal(typeof projected.scan, "object");
    assert.ok(projected.scan && "scanned" in projected.scan, "the branch scan summary is missing");

    assert.equal(treeStatus(f.repoRoot), treeBefore, "the dry run changed the tree");
    assert.deepEqual(stateSnapshot(f.state), stateBefore, "the dry run wrote to the state directory");

    // THE CONTROL: the same call without the flag takes the projected task and
    // is seen by both observations above.
    const real = run([]);
    assert.equal(real.status, 0, real.stderr);
    const taken = parse(real);
    assert.equal(taken.taken, true);
    assert.equal(taken.dryRun, false);
    assert.equal(taken.id, projected.id, "the dry run named a task the real call did not take");
    assert.notEqual(treeStatus(f.repoRoot), treeBefore, "the tree observation cannot see a claim");
    assert.notDeepEqual(stateSnapshot(f.state), stateBefore, "the state observation cannot see a reservation");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a candidate another session holds is stepped over by the dry run exactly as by next", () => {
  const f = fixture(["P1", "P2"]);
  try {
    // Another session's live reservation on the first candidate.
    const held = acquireLock({ root: f.backlog, taskId: f.ids[0], actor: "agent:other", env: f.env });
    assert.equal(held.ok, true, "the fixture could not reserve the first task");
    const stateBefore = stateSnapshot(f.state);
    const treeBefore = treeStatus(f.repoRoot);

    const dry = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json", "--dry-run"],
      { cwd: f.repoRoot, env: f.env });
    assert.equal(dry.status, 0, dry.stderr);
    const projected = parse(dry);
    assert.equal(projected.id, f.ids[1], "the dry run named a task another session holds");
    assert.deepEqual(projected.passedOver.map((p) => p.id), [f.ids[0]]);
    assert.match(projected.passedOver[0].why, /held by agent:other/, "the holder is not named");
    assert.deepEqual(stateSnapshot(f.state), stateBefore, "the dry run touched the reservations");
    assert.equal(treeStatus(f.repoRoot), treeBefore, "the dry run changed the tree");

    const real = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json"], { cwd: f.repoRoot, env: f.env });
    assert.equal(real.status, 0, real.stderr);
    assert.equal(parse(real).id, projected.id, "the dry run and the real call disagree");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("the human answer says nothing was claimed, names what it stepped over, and the real one still claims", () => {
  const f = fixture(["P1", "P2"]);
  try {
    assert.equal(acquireLock({ root: f.backlog, taskId: f.ids[0], actor: "agent:other", env: f.env }).ok, true);
    const r = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^· " + f.ids[1] + " would be taken by agent:a — pending → in_progress$", "m"));
    assert.match(r.stdout, /dry run: nothing was claimed/);
    assert.match(r.stdout, new RegExp(f.ids[0] + " passed over: .*agent:other"), "the step-over went unsaid");
    assert.doesNotMatch(r.stdout, /✓/, "a projection printed the mark of a completed claim");
    assert.match(r.stdout, /## Goal/, "the task text was not printed");

    // The control: the same call without the flag prints a claim, not a projection.
    const real = cli(["next", "--dir", f.backlog, "--actor", "agent:a"], { cwd: f.repoRoot, env: f.env });
    assert.equal(real.status, 0, real.stderr);
    assert.match(real.stdout, new RegExp("✓ " + f.ids[1] + " taken by agent:a"));
    assert.doesNotMatch(real.stdout, /would be taken|dry run/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("an EXPIRED reservation does not hold the task back in the dry run, as it does not in next", () => {
  const f = fixture(["P1", "P2"]);
  try {
    // Three hours old against the default two-hour TTL.
    const old = Date.now() - 3 * 60 * 60_000;
    assert.equal(acquireLock({ root: f.backlog, taskId: f.ids[0], actor: "agent:other", env: f.env, now: old }).ok, true);
    const dry = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.equal(dry.status, 0, dry.stderr);
    const projected = parse(dry);
    assert.equal(projected.id, f.ids[0], "an expired reservation was treated as live");
    assert.deepEqual(projected.passedOver, []);
    const real = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json"], { cwd: f.repoRoot, env: f.env });
    assert.equal(parse(real).id, projected.id);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a reclaim is projected as one: the old owner is named and stays in the file", () => {
  const f = fixture(["P2"]);
  try {
    const config = join(f.backlog, "config.yaml");
    const text = readFileSync(config, "utf8");
    const windowed = text.replace(/^abandoned_after_days: .*$/m, "abandoned_after_days: 2");
    assert.notEqual(windowed, text, "the template no longer carries `abandoned_after_days`");
    writeFileSync(config, windowed, "utf8");
    setFields(f, f.ids[0], { status: "in_progress", owner: "agent:gone", updated: daysAgo(9) });
    commitAll(f);
    const treeBefore = treeStatus(f.repoRoot);

    const dry = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--json", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.equal(dry.status, 0, dry.stderr);
    const projected = parse(dry);
    assert.equal(projected.id, f.ids[0]);
    assert.equal(projected.reclaimed, "agent:gone");
    assert.equal(projected.task.owner, "agent:gone", "`task` is not the task as it stands");
    assert.equal(treeStatus(f.repoRoot), treeBefore, "the dry run of a reclaim changed the tree");

    const human = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.match(human.stdout, new RegExp(f.ids[0] + " would be taken by agent:a — agent:gone → agent:a"));

    // A task the caller already holds is not a reclaim, and is not claimed either.
    const control = cli(["next", "--dir", f.backlog, "--actor", "agent:gone", "--json", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.equal(control.status, 0, control.stderr);
    assert.equal(parse(control).reclaimed, null);
    assert.equal(treeStatus(f.repoRoot), treeBefore);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

// ── peekLock: the reservation read with acquireLock's own predicates ──────

test("peekLock answers what acquireLock would, and creates nothing", () => {
  const dir = tmp("peek-lock");
  try {
    const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state") };
    const root = join(dir, "bl");
    mkdirSync(root, { recursive: true });
    const base = { root, taskId: "X-1", actor: "agent:a", env };

    assert.deepEqual(peekLock(base), { ok: true }, "an absent reservation is not free");
    assert.equal(existsSync(join(dir, "state")), false, "peeking created the state directory");

    const now = Date.now();
    assert.equal(acquireLock({ ...base, actor: "agent:other", now: now - 30 * 60_000 }).ok, true);
    const held = peekLock({ ...base, ttlMinutes: 60, now });
    assert.equal(held.ok, false, "a live reservation of another actor was not seen");
    assert.equal(held.holder.actor, "agent:other");

    // The TTL and the clock are the caller's, as in acquireLock.
    const stale = peekLock({ ...base, ttlMinutes: 10, now });
    assert.equal(stale.ok, true, "a reservation past its TTL still held the task");
    assert.equal(stale.expired.actor, "agent:other");
    assert.equal(peekLock({ ...base, ttlMinutes: 10, now: now - 25 * 60_000 }).ok, false, "`now` was ignored");
    assert.equal(peekLock({ ...base }).ok, false, "the default TTL is not acquireLock's two hours");
    assert.equal(peekLock({ ...base, ttlMinutes: 10 }).ok, true, "the default clock is not the present");
    assert.equal(peekLock({ ...base, now: now + 3 * 60 * 60_000 }).ok, true,
      "with no TTL given, a reservation three hours old still held the task");
    assert.equal(acquireLock({ ...base, actor: "agent:third", ttlMinutes: 10 }).ok, true,
      "the control: acquireLock agrees the reservation was stale");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("peekLock treats this process's own reservation as free, and another process's as held", () => {
  const dir = tmp("peek-own");
  try {
    const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state") };
    const root = join(dir, "bl");
    mkdirSync(root, { recursive: true });
    const base = { root, taskId: "X-2", actor: "agent:a", env };
    assert.equal(acquireLock(base).ok, true);
    assert.deepEqual(peekLock(base), { ok: true }, "this session's own reservation refused it");
    assert.equal(peekLock({ ...base, actor: "agent:b" }).ok, false, "another actor's reservation was free");

    // The same actor from ANOTHER process is a collision for acquireLock, so it
    // is one for peekLock: rewrite the holder's pid, then its tree.
    const file = join(lockDir(root, { env }).dir, "X-2.lock");
    const record = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...record, pid: record.pid + 1 }) + "\n");
    assert.equal(peekLock(base).ok, false, "another process of the same actor was treated as this one");
    writeFileSync(file, JSON.stringify({ ...record, tree: record.tree + "-elsewhere" }) + "\n");
    assert.equal(peekLock(base).ok, false, "another tree of the same actor was treated as this one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an empty queue under --dry-run is still exit 3 with dryRun in the envelope", () => {
  const f = fixture(["P2"]);
  try {
    const first = cli(["next", "--dir", f.backlog, "--actor", "agent:a"], { cwd: f.repoRoot, env: f.env });
    assert.equal(first.status, 0, first.stderr);
    const r = cli(["next", "--dir", f.backlog, "--actor", "agent:b", "--json", "--dry-run"], { cwd: f.repoRoot, env: f.env });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const out = parse(r);
    assert.equal(out.refusalKind, "nothing-to-take");
    assert.equal(out.dryRun, true);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--dry-run with --probe is a usage error, because a probe runs commands that may write", () => {
  const f = fixture(["P2"]);
  try {
    const treeBefore = treeStatus(f.repoRoot);
    const r = cli(["next", "--dir", f.backlog, "--actor", "agent:a", "--dry-run", "--probe"], { cwd: f.repoRoot, env: f.env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--dry-run.*--probe/);
    assert.match(r.stderr, /runs the task's verification commands, which may write anything/);
    assert.match(r.stderr, /a dry run writes nothing\. Ask `\S+ next --dry-run`, then probe the task\n\s+you are actually handed\./);
    assert.equal(treeStatus(f.repoRoot), treeBefore);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
