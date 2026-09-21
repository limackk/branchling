/**
 * Does `check --task-state` tell the session's own work from an abandoned
 * closing? (TL-261)
 *
 * THE DEFECT, MEASURED. On 2026-09-04 two agents, mid-flight on different tasks
 * of the same wave, both received one block of two `!` lines: one line was the
 * task they had taken a minute earlier — the normal condition — and the other
 * was a closing an earlier session had left in the tree, which is the whole
 * reason the block exists. The lines had the same prefix, sat in the same
 * block, and were separated only by which side of "at HEAD / on disk" the open
 * status fell on. Both hands resolved it by reading `git log`.
 *
 * WHAT HAS TO BE RULED OUT HERE:
 *
 *   1. A SPLIT THAT IS NOT A SPLIT. Naming both cases in one group, or in two
 *      groups typographically identical, is what today's output already does.
 *      The abandoned closing must carry the warning mark and the remedy; the
 *      held task must carry neither.
 *   2. A SPLIT DRAWN FROM THE WRONG EVIDENCE. `owner:` cannot separate the two
 *      — in the measured case both lines named the same actor. The control
 *      below runs the SAME tree under a different actor and requires both
 *      lines to collapse back into the warning group, which no rule about
 *      statuses or ids could produce.
 *   3. A GUARD THAT FAILS. The block is reported, never failed: exit 0 with an
 *      abandoned closing present, and exit 0 with only held work present.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { partitionByHolder } from "../check-backlog-task-state-committed.mjs";

import { isolateHome } from "./_repo.mjs";

// The home is isolated for the whole file (TL-166): the actor is resolved from
// the user's configuration when no flag states it, so without this the answer
// would differ per machine.
isolateHome("task-state-own-work");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

function git(cwd, args) {
  return spawnSync("git", args, {
    cwd, encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
}

function taskFile(fx, id) {
  const dir = join(fx.backlog, "tasks");
  const name = readdirSync(dir).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "the fixture wrote no task file for " + id);
  return join(dir, name);
}

function newTask(fx, title) {
  const created = run(["new", "--dir", fx.backlog, "--title", title], fx.dir, fx.env);
  assert.equal(created.status, 0, created.stderr);
  const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  assert.ok(id, "the fixture could not read back the new task's id");
  return id;
}

/**
 * A real repository holding both cases at once, which is the situation the two
 * agents were in:
 *
 *   - `abandoned` — committed, then closed on disk with NO reservation. This is
 *     a session that finished, committed its code and left the closing behind.
 *   - `held` — committed, then taken, so a live reservation in the isolated
 *     state directory names the actor and the moment.
 */
function fixture(actor) {
  const dir = tmp("ownwork");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(git(dir, ["init", "-q", "-b", "main"]).status, 0);
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);
  const fx = { dir, backlog, env, actor };

  fx.abandoned = newTask(fx, "A task whose closing was left in the tree");
  fx.held = newTask(fx, "A task this session is holding right now");

  assert.equal(git(dir, ["add", "-A"]).status, 0);
  assert.equal(git(dir, ["commit", "-q", "-m", "both tasks, as they were created"]).status, 0);

  const file = taskFile(fx, fx.abandoned);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: done"), "utf8");

  const taken = run(["take", fx.held, "--dir", backlog, "--actor", actor], dir, env);
  assert.equal(taken.status, 0, taken.stderr);
  return fx;
}

/** The output cut at its block headings, so an assertion can say WHICH block a
 *  task was named in rather than only that the id appears somewhere. */
function blocks(stdout) {
  const lines = stdout.split("\n");
  const out = { warned: [], held: [], before: [] };
  let current = out.before;
  for (const l of lines) {
    if (l.startsWith("! task-state")) current = out.warned;
    else if (l.startsWith("· task-state")) current = out.held;
    current.push(l);
  }
  return { warned: out.warned.join("\n"), held: out.held.join("\n") };
}

const check = (fx, actor) =>
  run(
    ["check", "--task-state", "--dir", fx.backlog].concat(actor ? ["--actor", actor] : []),
    fx.dir,
    fx.env
  );

// ── the two cases are reported apart ──────────────────────────────────────

test("an abandoned closing is warned about; the task this actor holds is not", () => {
  const fx = fixture("local:this-session");
  const r = check(fx, "local:this-session");
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const b = blocks(r.stdout);
  assert.ok(b.warned, "nothing was warned about — the abandoned closing went unreported");
  assert.ok(b.held, "the held task was not reported in a block of its own");

  assert.ok(
    b.warned.includes(fx.abandoned),
    "the abandoned closing is not in the warned block:\n" + r.stdout
  );
  assert.ok(
    !b.warned.includes(fx.held),
    "the task this session holds is warned about as if it were abandoned:\n" + r.stdout
  );
  assert.ok(
    b.held.includes(fx.held) && !b.held.includes(fx.abandoned),
    "the held block does not hold exactly this session's own task:\n" + r.stdout
  );
});

test("the held block says whose it is, and when it was taken", () => {
  const fx = fixture("local:this-session");
  const b = blocks(check(fx, "local:this-session").stdout);
  assert.match(b.held, /held by local:this-session right now/);
  assert.match(b.held, /taken \d\d:\d\d/);
});

test("the remedy is printed under the abandoned closing only", () => {
  // The explanatory paragraph used to apply to both lines at once, which is why
  // it settled neither. "Commit it" is wrong advice for work still open.
  const fx = fixture("local:this-session");
  const b = blocks(check(fx, "local:this-session").stdout);
  assert.match(b.warned, /backlog\/history\//, "the warned block lost its remedy");
  assert.ok(
    !/backlog\/history\//.test(b.held),
    "the held block tells a session mid-task to commit its closing:\n" + b.held
  );
  assert.match(b.held, /Nothing to do while the work is open/);
});

// ── the control: the split comes from the reservation ─────────────────────

test("under a different actor the SAME tree reports both as unheld", () => {
  // The positive control. Without it the split above could be satisfied by any
  // rule that happens to separate `done` from `in_progress` — a rule which
  // would say nothing about who holds what. The reservation names
  // `local:this-session`, so to `local:somebody-else` neither task is its own.
  const fx = fixture("local:this-session");
  const r = check(fx, "local:somebody-else");
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const b = blocks(r.stdout);
  assert.ok(
    b.warned.includes(fx.abandoned) && b.warned.includes(fx.held),
    "a task held by somebody else was reported as this actor's own work:\n" + r.stdout
  );
  assert.equal(b.held, "", "a block of held work appeared for an actor holding nothing");
});

test("with only held work the block carries no warning mark, and still exits 0", () => {
  const fx = fixture("local:this-session");
  // Take the abandoned closing out of the tree: what is left is one task, held.
  const file = taskFile(fx, fx.abandoned);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: pending"), "utf8");

  const r = check(fx, "local:this-session");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(fx.held), "the held task vanished from the report");
  assert.ok(
    !r.stdout.split("\n").some((l) => l.startsWith("! task-state")),
    "a session's own work still raises a warning:\n" + r.stdout
  );
});

test("`--actor` with no name is a usage error, not a silently ignored flag", () => {
  const fx = fixture("local:this-session");
  const bad = run(["check", "--task-state", "--dir", fx.backlog, "--actor"], fx.dir, fx.env);
  assert.equal(bad.status, 2, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /`--actor` with no name/);
});

// ── the partition itself, without a repository ────────────────────────────

test("partitionByHolder holds only a live reservation of this actor, in this tree", () => {
  const now = Date.parse("2026-09-04T17:10:00.000Z");
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  const diverged = ["A-1", "A-2", "A-3", "A-4", "A-5"].map((id) => ({ id, fields: ["status"] }));

  const { held, unheld } = partitionByHolder(diverged, {
    actor: "agent:mine",
    root: "/tree/backlog",
    now,
    ttlMinutes: 120,
    locks: [
      { task: "A-1", actor: "agent:mine", tree: "/tree/backlog", ts: at(7) },
      { task: "A-2", actor: "agent:other", tree: "/tree/backlog", ts: at(7) },
      // A sibling worktree of the same clone: the reservations are one shared
      // set, so without the tree test this would read as this session's work.
      { task: "A-3", actor: "agent:mine", tree: "/other-tree/backlog", ts: at(7) },
      { task: "A-4", actor: "agent:mine", tree: "/tree/backlog", ts: at(600) },
      // A-5 has no reservation at all.
    ],
  });

  assert.deepEqual(held.map((d) => d.id), ["A-1"]);
  assert.deepEqual(unheld.map((d) => d.id), ["A-2", "A-3", "A-4", "A-5"]);
  assert.equal(held[0].lock.task, "A-1", "the held entry does not carry the reservation that proved it");
});
