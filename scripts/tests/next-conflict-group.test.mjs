/**
 * Conflict groups keep two loops off tasks that touch the same area (TL-492).
 *
 * THE DEFECT THIS GUARDS. Three `run` loops, one per worktree of one clone,
 * were each handed a different task of the SAME module and collided on the
 * same files and the same migration numbers; every merge needed a person. The
 * claim rule kept them off the same TASK and said nothing about the same AREA.
 *
 *   frontmatter  `conflict_group: [<value>, …]` names the area a task touches.
 *   config.yaml  `conflict_group_from: <field>` supplies the group for a task
 *                that names none. Off unless set.
 *
 * A candidate is held back while a task of one of its groups is in progress in
 * this tree or is reported in progress by another worktree. It is reported in
 * `skippedConflict`, never dropped in silence.
 *
 * EVERY CLAIM HAS A CONTROL. "Nothing to take" is also what a dispatcher that
 * has stopped handing out anything says, so each case keeps a task of an
 * UNRELATED group in the tree and asserts that it IS handed out, or runs the
 * same tree without the setting and asserts the opposite outcome. The group
 * values are invented here; nothing below reads this repository's vocabulary.
 *
 * WHY THE STATUS IS WRITTEN AND NOT TAKEN. A `take` would also leave a
 * reservation, and the reservation refuses on its own — the tests would pass
 * with the skip rule removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("next-conflict-group");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, ...opts });
}

function vcs(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" }
  );
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

function rewrite(file, edit) {
  const raw = readFileSync(file, "utf8");
  const out = edit(raw);
  assert.notEqual(out, raw, "the fixture rewrote nothing in " + file);
  writeFileSync(file, out, "utf8");
}

function setStatus(file, status) {
  rewrite(file, (raw) => raw.replace(/^status: .*$/m, "status: " + status));
}

/** Writes the field whether or not the template already carries the key. */
function setGroups(file, groups) {
  rewrite(file, (raw) => raw
    .replace(/^conflict_group: .*\n/m, "")
    .replace(/^(status: .*)$/m, "$1\nconflict_group: [" + groups.join(", ") + "]"));
}

function setEpic(file, epic) {
  rewrite(file, (raw) => raw.replace(/^epic: .*$/m, 'epic: "' + epic + '"'));
}

function statusOf(backlog, id) {
  return (readFileSync(taskPath(backlog, id), "utf8").match(/^status: (.*)$/m) || [])[1].trim();
}

/**
 * A fresh backlog with one task per entry of `tasks`, in that priority order.
 *
 * @param {Array<{priority: string, groups?: string[], epic?: string, status?: string}>} tasks
 * @param {{config?: string[], repo?: boolean}} opts
 */
function backlogWith(tasks, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-conflict-"));
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], { env }).status, 0);
  if (opts.config && opts.config.length) {
    const p = join(backlog, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\n" + opts.config.join("\n") + "\n", "utf8");
  }
  const ids = tasks.map((t, i) => {
    const r = cli(["new", "--dir", backlog, "--title", "Task number " + (i + 1), "--priority", t.priority], { env });
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = taskPath(backlog, id);
    if (t.groups) setGroups(file, t.groups);
    if (t.epic) setEpic(file, t.epic);
    if (t.status) setStatus(file, t.status);
    return id;
  });
  if (opts.repo) {
    vcs(repoRoot, ["init", "-q", "-b", "main"]);
    vcs(repoRoot, ["add", "-A"]);
    vcs(repoRoot, ["commit", "-qm", "seed"]);
  }
  return { dir, repoRoot, backlog, env, ids };
}

function next(fx, extra = []) {
  return cli(["next", "--dir", fx.backlog, "--actor", "agent:b"].concat(extra), { cwd: fx.repoRoot, env: fx.env });
}

// ── The same group in progress in THIS tree ────────────────────────────────

test("a task whose group is in progress here is skipped, an unrelated one is handed out", () => {
  const fx = backlogWith([
    { priority: "P1", groups: ["billing"], status: "in_progress" },
    { priority: "P1", groups: ["billing"] },
    { priority: "P2", groups: ["search"] },
  ]);
  try {
    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    // POSITIVE CONTROL: the lower-priority task of another group is taken, so
    // the skip below is a decision about one task and not an empty dispatcher.
    assert.equal(out.id, fx.ids[2]);
    assert.equal(statusOf(fx.backlog, fx.ids[1]), "pending", "the conflicting task was written to");
    assert.deepEqual(out.skippedConflict, [{
      id: fx.ids[1], group: ["billing"],
      heldBy: [{ id: fx.ids[0], group: "billing", kind: "here", source: null }],
    }]);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("an empty queue names the conflict in prose, so it does not read as an empty backlog", () => {
  const fx = backlogWith([
    { priority: "P1", groups: ["billing"], status: "in_progress" },
    { priority: "P1", groups: ["billing", "search"] },
  ]);
  try {
    const r = next(fx);
    assert.equal(r.status, 3, "a task of a group in progress was handed out: " + r.stdout);
    assert.match(r.stdout, new RegExp(fx.ids[1] + " skipped — conflict group billing is in progress: " + fx.ids[0] + " here"));
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("CONTROL: with no group in common the same tree hands the task out", () => {
  const fx = backlogWith([
    { priority: "P1", groups: ["billing"], status: "in_progress" },
    { priority: "P1", groups: ["search"] },
  ]);
  try {
    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.id, fx.ids[1]);
    assert.deepEqual(out.skippedConflict, []);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The same group in progress in ANOTHER worktree ────────────────────────

test("a task whose group is in progress in another worktree is skipped and reported", () => {
  const fx = backlogWith([
    { priority: "P1", groups: ["billing"] },
    { priority: "P1", groups: ["billing"] },
    { priority: "P2", groups: ["search"] },
  ], { repo: true });
  const wt = join(fx.dir, "sidecar-tree");
  try {
    vcs(fx.repoRoot, ["worktree", "add", "-q", "-b", "sidecar", wt, "main"]);
    // Uncommitted, exactly what a loop that has just taken a task leaves.
    setStatus(taskPath(join(wt, "backlog"), fx.ids[0]), "in_progress");

    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.id, fx.ids[2], "the unrelated task was not the one handed out");
    // The claimed task itself is the existing `elsewhere` skip and is not
    // reported a second time as a conflict with itself.
    assert.deepEqual(out.skippedElsewhere.map((s) => s.id), [fx.ids[0]]);
    assert.equal(out.skippedConflict.length, 1, JSON.stringify(out.skippedConflict));
    const skip = out.skippedConflict[0];
    assert.equal(skip.id, fx.ids[1]);
    assert.deepEqual(skip.group, ["billing"]);
    assert.equal(skip.heldBy.length, 1);
    assert.equal(skip.heldBy[0].id, fx.ids[0]);
    assert.equal(skip.heldBy[0].kind, "worktree");
    assert.match(skip.heldBy[0].source, /sidecar-tree$/);
    assert.equal(statusOf(fx.backlog, fx.ids[1]), "pending");
  } finally {
    rmSync(wt, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The configured fallback ────────────────────────────────────────────────

test("with `conflict_group_from: epic` a task without the field is grouped by its epic", () => {
  const fx = backlogWith([
    { priority: "P1", epic: "Ledger rework", status: "in_progress" },
    { priority: "P1", epic: "Ledger rework" },
    { priority: "P2", epic: "Search rework" },
  ], { config: ["conflict_group_from: epic"] });
  try {
    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.id, fx.ids[2], "an epic in progress did not hold its sibling back");
    assert.deepEqual(out.skippedConflict, [{
      id: fx.ids[1], group: ["Ledger rework"],
      heldBy: [{ id: fx.ids[0], group: "Ledger rework", kind: "here", source: null }],
    }]);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("CONTROL: without `conflict_group_from` the same epic holds nothing back", () => {
  const fx = backlogWith([
    { priority: "P1", epic: "Ledger rework", status: "in_progress" },
    { priority: "P1", epic: "Ledger rework" },
    { priority: "P2", epic: "Search rework" },
  ]);
  try {
    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.id, fx.ids[1], "the fallback is on without being configured");
    assert.deepEqual(out.skippedConflict, []);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("a task's own `conflict_group` replaces the fallback rather than adding to it", () => {
  const fx = backlogWith([
    { priority: "P1", epic: "Ledger rework", status: "in_progress" },
    { priority: "P1", epic: "Ledger rework", groups: ["docs"] },
  ], { config: ["conflict_group_from: epic"] });
  try {
    const r = next(fx, ["--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).id, fx.ids[1]);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("`conflict_group_from` naming a field the dispatcher cannot group by fails", () => {
  // Written after the task exists: the configuration is refused at load, so
  // `new` would refuse it too and the fixture would never reach `next`.
  const fx = backlogWith([{ priority: "P1" }]);
  try {
    const p = join(fx.backlog, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\nconflict_group_from: status\n", "utf8");
    const r = next(fx);
    assert.notEqual(r.status, 0, "a fallback that can group nothing was accepted: " + r.stdout);
    assert.notEqual(r.status, 3);
    assert.match(r.stderr, /conflict_group_from/);
    assert.equal(statusOf(fx.backlog, fx.ids[0]), "pending");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── `run` says it too ──────────────────────────────────────────────────────

test("`run --dry-run --json` reports the conflict under the same key", () => {
  const fx = backlogWith([
    { priority: "P1", groups: ["billing"], status: "in_progress" },
    { priority: "P1", groups: ["billing"] },
    { priority: "P2", groups: ["search"] },
  ]);
  try {
    const r = cli(["run", "--dir", fx.backlog, "--actor", "agent:b", "--agent", "true", "--dry-run", "--json"],
      { cwd: fx.repoRoot, env: fx.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.order.map((o) => o.id), [fx.ids[2]]);
    assert.deepEqual(out.skippedConflict.map((s) => s.id), [fx.ids[1]]);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
