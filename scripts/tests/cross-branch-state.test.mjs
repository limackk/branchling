/**
 * State read from ALL active branches, not from the current checkout (TL-73).
 *
 * WHY THIS FILE HAS TO BUILD REAL REPOSITORIES. The defect it guards is a
 * DISAGREEMENT BETWEEN TREES, and a fixture that fakes the git layer would be
 * asserting that our own mock disagrees with itself. Every test here creates a
 * repository with two branches that really hold different `status:` values, and
 * asks the CLI the same question a person would.
 *
 * THE POSITIVE CONTROL IS THE POINT. Each claim is paired with a run in which
 * the mechanism is switched off (`cross_branch_state: false`) or narrowed
 * (`active_branch_days`), and that run MUST come out differently. Without the
 * pair, "the query found the task" is indistinguishable from "the query lists
 * everything anyway" — a green result with no evidentiary power, which is what
 * the fourth rule under "Before you change the code" is about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";
import { absentHere, crossBranchState, statusSetAt } from "../branch-scan.mjs";
import { loadConfig } from "../config.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("cross-branch-state");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

/** A commit date old enough to fall outside any window a test sets. */
const LONG_AGO = "2020-01-01T00:00:00Z";

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8",
    timeout: 60_000,
    ...opts,
  });
}

function vcs(cwd, args, env) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8", env: { ...process.env, ...(env || {}) } }
  );
}

/** A commit whose COMMITTER date is what `active_branch_days` measures — the
 *  author date, which `--date` sets, is not the one `for-each-ref` reports. */
function commit(cwd, message, when) {
  vcs(cwd, ["add", "-A"]);
  vcs(cwd, ["commit", "-qm", message], when ? { GIT_COMMITTER_DATE: when, GIT_AUTHOR_DATE: when } : null);
}

function taskText(id, status) {
  return [
    "---",
    "id: " + id,
    'title: "Reservations across branches"',
    "type: task",
    "labels: []",
    "board: main",
    "priority: P1",
    "status: " + status,
    "owner: unassigned",
    "estimate: 2h",
    "created: 2026-01-01",
    "updated: 2026-01-01",
    "blocked_by: []",
    "---",
    "",
    "## Goal",
    "",
    "Something to be done.",
    "",
  ].join("\n");
}

const ID = P + "-1";
const TASK_FILE = ID + "-reservations-across-branches.md";

function setConfig(backlogDir, lines) {
  if (!lines.length) return;
  const p = join(backlogDir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + lines.join("\n") + "\n", "utf8");
}

/**
 * A repository whose task is `pending` on `main` and `in_progress` on `feature`.
 * The checkout is left on `main`, which is the tree that used to be lying.
 *
 * @param {{config?: string[], stale?: boolean}} opts
 *        `stale` dates the `feature` commit far enough back to fall outside a
 *        narrow `active_branch_days`.
 */
function twoBranchesDisagreeing(opts = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "branchling-xbranch-"));
  const backlogDir = join(repoRoot, "backlog");
  const init = cli(["init", "--dir", backlogDir, "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  setConfig(backlogDir, opts.config || []);

  const taskPath = join(backlogDir, "tasks", TASK_FILE);
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  writeFileSync(taskPath, taskText(ID, "pending"), "utf8");
  commit(repoRoot, "seed");

  vcs(repoRoot, ["checkout", "-q", "-b", "feature"]);
  writeFileSync(taskPath, taskText(ID, "in_progress"), "utf8");
  commit(repoRoot, "start the task", opts.stale ? LONG_AGO : null);

  vcs(repoRoot, ["checkout", "-q", "main"]);
  return { repoRoot, backlogDir, taskPath };
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ──────────────────────────────────────────────────────────────────────────
// The claim, and the control that gives it force
// ──────────────────────────────────────────────────────────────────────────

test("`--status in_progress` from main finds the task another branch has started", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "in_progress"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("id: " + ID + "\\b"), "the task started on `feature` is invisible from main");
    assert.match(r.stdout, /feature: in_progress/, "the branch the state came from is not named");
  } finally {
    cleanup(repoRoot);
  }
});

test("POSITIVE CONTROL: with the scan off the same query finds nothing", () => {
  // This is the run that has to FAIL when the scan returns only local state —
  // the difference between the two is the entire evidence that the scan works.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing({ config: ["cross_branch_state: false"] });
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "in_progress"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, new RegExp("id: " + ID + "\\b"),
      "with `cross_branch_state: false` the answer still came from another branch");
    assert.match(r.stdout, /0 matching tasks/);
  } finally {
    cleanup(repoRoot);
  }
});

test("the disagreement is shown, never resolved: both statuses stand", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "pending"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /status: pending/, "the LOCAL status was overwritten by the branch's");
    assert.match(r.stdout, /elsewhere: \[feature: in_progress\]/, "the other branch's status is missing");
  } finally {
    cleanup(repoRoot);
  }
});

test("--json carries the divergence and says the scan ran", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "pending", "--json"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.scan.scanned, true);
    assert.equal(out.scan.reason, null);
    assert.deepEqual(out.tasks[0].elsewhere, [{ status: "in_progress", source: "feature", kind: "branch" }]);
  } finally {
    cleanup(repoRoot);
  }
});

test("`stats` names the branch too, and counts the divergence", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  try {
    const text = cli(["stats", "--dir", backlogDir], { cwd: repoRoot });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /status differs on other branches:/);
    assert.match(text.stdout, /feature: in_progress/);

    const json = cli(["stats", "--dir", backlogDir, "--json"], { cwd: repoRoot });
    assert.equal(json.status, 0, json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.stats.divergent, 1);
    assert.equal(out.divergent[0].id, ID);
    assert.equal(out.divergent[0].status, "pending");
    assert.equal(out.divergent[0].elsewhere[0].source, "feature");
  } finally {
    cleanup(repoRoot);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Existence, not only state (TL-145)
// ──────────────────────────────────────────────────────────────────────────

const ONLY_ID = P + "-2";
const ONLY_FILE = ONLY_ID + "-created-on-a-branch.md";

/**
 * A repository where `feature` carries a task `main` has never seen. The
 * checkout is left on `main`, which is the tree that used to answer "there is
 * no such task" — an absence indistinguishable from the task not existing.
 *
 * `branch: false` builds the SAME tree with the second task never committed
 * anywhere: the positive control for a rule that would otherwise pass just as
 * well by reporting a phantom on every listing.
 */
function taskOnlyOnAnotherBranch(opts = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "branchling-xbranch-only-"));
  const backlogDir = join(repoRoot, "backlog");
  const init = cli(["init", "--dir", backlogDir, "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  setConfig(backlogDir, opts.config || []);

  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  writeFileSync(join(backlogDir, "tasks", TASK_FILE), taskText(ID, "pending"), "utf8");
  commit(repoRoot, "seed");

  if (opts.branch !== false) {
    vcs(repoRoot, ["checkout", "-q", "-b", "feature"]);
    writeFileSync(join(backlogDir, "tasks", ONLY_FILE), taskText(ONLY_ID, "in_progress"), "utf8");
    commit(repoRoot, "a task that exists only here");
    vcs(repoRoot, ["checkout", "-q", "main"]);
    rmSync(join(backlogDir, "tasks", ONLY_FILE), { force: true });
  }
  return { repoRoot, backlogDir };
}

test("a task that exists only on another branch is reported, with the branch named", () => {
  const { repoRoot, backlogDir } = taskOnlyOnAnotherBranch();
  try {
    const r = cli(["query", "--dir", backlogDir], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("# " + ONLY_ID + " is not in this tree"));
    assert.match(r.stdout, /feature: in_progress/);
  } finally {
    cleanup(repoRoot);
  }
});

test("it is NOT an ordinary task of this tree: not a row, not in the count", () => {
  const { repoRoot, backlogDir } = taskOnlyOnAnotherBranch();
  try {
    const r = cli(["query", "--dir", backlogDir, "--json"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.tasks.map((t) => t.id), [ID], "the branch-only task was listed as a row");
    assert.equal(out.total, 1);
    assert.deepEqual(out.elsewhereOnly, [
      { id: ONLY_ID, elsewhere: [{ status: "in_progress", source: "feature", kind: "branch" }] },
    ]);

    // The same in the two shapes that print no rows at all — a number and a
    // path list stay usable, and the fact is on stderr rather than nowhere.
    const count = cli(["query", "--dir", backlogDir, "--count"], { cwd: repoRoot });
    assert.equal(count.stdout.trim(), "1");
    assert.match(count.stderr, new RegExp("# " + ONLY_ID + " is not in this tree"));
  } finally {
    cleanup(repoRoot);
  }
});

test("POSITIVE CONTROL: with no such branch the same query reports nothing extra", () => {
  const { repoRoot, backlogDir } = taskOnlyOnAnotherBranch({ branch: false });
  try {
    const r = cli(["query", "--dir", backlogDir, "--json"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.scan.scanned, true, "the scan did not run, so the empty answer proves nothing");
    assert.deepEqual(out.elsewhereOnly, []);
    const text = cli(["query", "--dir", backlogDir], { cwd: repoRoot });
    assert.doesNotMatch(text.stdout, /is not in this tree/);
  } finally {
    cleanup(repoRoot);
  }
});

test("`stats` names it too, and keeps it out of every tally", () => {
  const { repoRoot, backlogDir } = taskOnlyOnAnotherBranch();
  try {
    const text = cli(["stats", "--dir", backlogDir], { cwd: repoRoot });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /only on another branch, not in this tree:/);
    assert.match(text.stdout, new RegExp(ONLY_ID + "\\s+feature: in_progress"));

    const json = cli(["stats", "--dir", backlogDir, "--json"], { cwd: repoRoot });
    const out = JSON.parse(json.stdout);
    assert.equal(out.stats.total, 1, "a task of another branch was counted as one of this tree's");
    assert.equal(out.stats.divergent, 0, "existence was counted as a status disagreement");
    assert.deepEqual(out.elsewhereOnly.map((t) => t.id), [ONLY_ID]);
  } finally {
    cleanup(repoRoot);
  }
});

test("absentHere, without a repository", () => {
  const byId = new Map([
    ["Z-1", [{ status: "pending", source: "feature", kind: "branch" }]],
    ["Z-2", [{ status: "done", source: "a", kind: "branch" }, { status: "done", source: "a", kind: "branch" }]],
  ]);
  assert.deepEqual(absentHere(byId, ["z-1"]).map((t) => t.id), ["Z-2"], "the id comparison is case sensitive");
  // Duplicates collapse per (status, source), the same rule `divergences` uses.
  assert.equal(absentHere(byId, []).find((t) => t.id === "Z-2").elsewhere.length, 1);
  assert.deepEqual(absentHere(new Map(), []), []);
});

// ──────────────────────────────────────────────────────────────────────────
// The window, and the one thing it may not hide
// ──────────────────────────────────────────────────────────────────────────

test("a branch outside `active_branch_days` is not read", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing({ stale: true, config: ["active_branch_days: 1"] });
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "in_progress"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, new RegExp("id: " + ID + "\\b"), "a branch older than the window was still read");
  } finally {
    cleanup(repoRoot);
  }
});

test("POSITIVE CONTROL: the same stale branch IS read with no window", () => {
  // Without this pair, the test above passes just as well when the scan is
  // broken outright.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing({ stale: true, config: ["active_branch_days: 0"] });
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "in_progress"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("id: " + ID + "\\b"), "`active_branch_days: 0` has to mean NO window");
  } finally {
    cleanup(repoRoot);
  }
});

test("a branch checked out in a worktree is read however old it is", () => {
  // The window is a cost control, not a rule about relevance. A tree somebody is
  // standing in is the single most likely holder of a task, and dropping it
  // would reintroduce the collision this whole task exists to remove.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing({ stale: true, config: ["active_branch_days: 1"] });
  const wt = join(repoRoot, "..", "branchling-xbranch-wt-" + process.pid);
  try {
    vcs(repoRoot, ["worktree", "add", "-q", wt, "feature"]);
    const r = cli(["query", "--dir", backlogDir, "--status", "in_progress"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("id: " + ID + "\\b"),
      "a stale branch that somebody has CHECKED OUT was dropped by the window");
  } finally {
    rmSync(wt, { recursive: true, force: true });
    cleanup(repoRoot);
  }
});

test("an UNCOMMITTED change in another worktree is visible", () => {
  // The state the ref scan cannot see, and the one that matters most: another
  // agent has just taken the task and has not committed yet.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  const wt = join(repoRoot, "..", "branchling-xbranch-dirty-" + process.pid);
  try {
    vcs(repoRoot, ["branch", "-q", "sidecar", "main"]);
    vcs(repoRoot, ["worktree", "add", "-q", wt, "sidecar"]);
    writeFileSync(join(wt, "backlog", "tasks", TASK_FILE), taskText(ID, "blocked"), "utf8");

    const r = cli(["query", "--dir", backlogDir, "--status", "blocked"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("id: " + ID + "\\b"), "an uncommitted status in another worktree is invisible");
    assert.match(r.stdout, /: blocked/);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    cleanup(repoRoot);
  }
});

test("statusSetAt: the LAST entry setting that status wins, and a torn line is skipped", () => {
  // A task taken, handed back and taken again is in flight since the last take.
  // The trailing fragment is what a log being appended to right now looks like:
  // it must not cost the answer the complete lines before it.
  const log = [
    '{"ts":"2026-01-01T08:00:00Z","field":"status","to":"in_progress"}',
    '{"ts":"2026-01-01T09:00:00Z","field":"status","to":"pending"}',
    '{"ts":"2026-01-01T10:00:00Z","field":"owner","to":"in_progress"}',
    '{"ts":"2026-01-01T11:00:00Z","field":"status","to":"in_progress"}',
    '{"ts":"2026-01-01T12:00:00Z","field":"sta',
  ].join("\n");
  assert.equal(statusSetAt(log, "in_progress"), "2026-01-01T11:00:00Z");
  assert.equal(statusSetAt(log, "blocked"), null, "a status the log never set was given a time anyway");
  assert.equal(statusSetAt("", "in_progress"), null);
});

test("a task taken in another worktree reports WHEN that tree took it", () => {
  // What the Execution view draws its elapsed bar from (TL-210). This tree's own
  // history cannot answer it — the take was written over there and has not been
  // committed — so the scan reads that tree's log or says nothing.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  const wt = join(repoRoot, "..", "branchling-xbranch-since-" + process.pid);
  try {
    vcs(repoRoot, ["branch", "-q", "sidecar", "main"]);
    vcs(repoRoot, ["worktree", "add", "-q", wt, "sidecar"]);
    // The take, made by the tool in THAT tree: the file and the log entry.
    const took = cli(["take", ID, "--dir", join(wt, "backlog"), "--actor", "agent:other"], { cwd: wt });
    assert.equal(took.status, 0, took.stderr);

    const scan = crossBranchState(backlogDir, loadConfig(backlogDir));
    const seen = (scan.byId.get(ID) || []).find((o) => o.kind === "worktree");
    assert.ok(seen, "the uncommitted take in the other worktree was not seen at all");
    assert.equal(seen.status, "in_progress");
    assert.ok(seen.since, "the tree that holds the task did not say when it took it");
    assert.ok(Date.parse(seen.since) > 0, "`since` is not a timestamp anything can be measured from");

    // POSITIVE CONTROL: with that tree's log removed the answer becomes null
    // rather than a time invented from THIS tree's history, which still holds
    // the task's own entries.
    rmSync(join(wt, "backlog", "history", ID + ".jsonl"), { force: true });
    const blind = crossBranchState(backlogDir, loadConfig(backlogDir));
    const after = (blind.byId.get(ID) || []).find((o) => o.kind === "worktree");
    assert.ok(after, "the observation itself disappeared with the log");
    assert.equal(after.since, null, "a start time was produced with nothing to read it from");
  } finally {
    rmSync(wt, { recursive: true, force: true });
    cleanup(repoRoot);
  }
});

test("the caller's own uncommitted change is not reported as somebody else's", () => {
  // `take` writes the file before it is committed. If the caller's own branch
  // counted as a second opinion, every listing after every `take` would carry a
  // difference against HEAD — and a warning nobody reads is a warning gone.
  const { repoRoot, backlogDir, taskPath } = twoBranchesDisagreeing();
  try {
    writeFileSync(taskPath, taskText(ID, "blocked"), "utf8");
    const r = cli(["query", "--dir", backlogDir, "--status", "blocked"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /main: pending/, "the tool reported the caller's own HEAD back at them");
    assert.match(r.stdout, /elsewhere: \[feature: in_progress\]/, "a real difference disappeared along with it");
  } finally {
    cleanup(repoRoot);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Working without git, and without a network
// ──────────────────────────────────────────────────────────────────────────

test("outside a git repository the query works and SAYS the state is local only", () => {
  const backlogDir = mkdtempSync(join(tmpdir(), "branchling-xbranch-nogit-"));
  try {
    const init = cli(["init", "--dir", backlogDir, "--no-example"]);
    assert.equal(init.status, 0, init.stderr);
    writeFileSync(join(backlogDir, "tasks", TASK_FILE), taskText(ID, "pending"), "utf8");

    const r = cli(["query", "--dir", backlogDir, "--status", "pending"], { cwd: backlogDir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("id: " + ID + "\\b"), "the command has to still answer");
    assert.match(r.stdout, /state from this tree only/, "it did not say the answer is narrower than usual");

    const json = cli(["query", "--dir", backlogDir, "--json"], { cwd: backlogDir });
    assert.equal(JSON.parse(json.stdout).scan.reason, "not-a-repository");
  } finally {
    cleanup(backlogDir);
  }
});

test("the configuration rejects a negative window instead of scanning nothing", () => {
  const { repoRoot, backlogDir } = twoBranchesDisagreeing({ config: ["active_branch_days: -5"] });
  try {
    const r = cli(["query", "--dir", backlogDir, "--status", "pending"], { cwd: repoRoot });
    assert.notEqual(r.status, 0, "a window that can never match anything passed silently");
    assert.match(r.stderr, /active_branch_days/);
  } finally {
    cleanup(repoRoot);
  }
});

test("NO PATH RUNS `git fetch` — the tool works with no network", () => {
  // Asserted against the calls git actually receives, not by reading the source:
  // a `fetch` reached through a helper or an alias would be invisible to a grep
  // and would show up here as a recorded argument list.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  const shimDir = mkdtempSync(join(tmpdir(), "branchling-xbranch-shim-"));
  const log = join(shimDir, "calls.log");
  try {
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    assert.ok(realGit, "no git on PATH — this test would prove nothing");
    mkdirSync(join(shimDir, "bin"), { recursive: true });
    const shim = join(shimDir, "bin", "git");
    writeFileSync(
      shim,
      ['#!/bin/sh', 'printf "%s\\n" "$*" >> ' + JSON.stringify(log), 'exec ' + JSON.stringify(realGit) + ' "$@"', ""].join("\n"),
      "utf8"
    );
    chmodSync(shim, 0o755);

    const env = { ...process.env, PATH: join(shimDir, "bin") + ":" + process.env.PATH };
    for (const args of [["query", "--dir", backlogDir], ["stats", "--dir", backlogDir], ["build", "--dir", backlogDir]]) {
      const r = cli(args, { cwd: repoRoot, env });
      assert.equal(r.status, 0, args[0] + ": " + r.stderr);
    }

    assert.ok(existsSync(log), "the shim was never called — the test measured nothing");
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    assert.ok(calls.length > 0, "the shim recorded no calls");
    const network = calls.filter((c) => /(^|\s)(fetch|pull|remote update|ls-remote|clone)(\s|$)/.test(c));
    assert.deepEqual(network, [], "a read command reached for the network");
  } finally {
    cleanup(repoRoot, shimDir);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// One scan, two callers
// ──────────────────────────────────────────────────────────────────────────

test("the branch and worktree scan lives in ONE module", () => {
  // A structural guard, because the cost of a second copy is not a failing test
  // — it is `next-id` and `query` disagreeing about which branches exist, which
  // surfaces as a task handed to two sessions.
  const nextId = readFileSync(join(SCRIPTS, "next-backlog-id.mjs"), "utf8");
  assert.match(nextId, /from ['"]\.\/branch-scan\.mjs['"]/, "next-id no longer uses the shared scan");
  // Asked as "does it run git ITSELF", not as "does the word appear": the prose
  // at the top of that file names the same commands, and a guard that reads
  // comments would have to be loosened until it stopped guarding.
  assert.doesNotMatch(nextId, /child_process/, "next-id grew its own git calls again");

  for (const caller of ["query.mjs", "stats-report.mjs", "build-viewer.mjs"]) {
    const src = readFileSync(join(SCRIPTS, caller), "utf8");
    assert.match(src, /from ['"]\.\/branch-scan\.mjs['"]/, caller + " reads state from one checkout only");
  }
});

test("`next-id` still counts numbers across branches after the extraction", () => {
  // The extraction had to leave `next-id` behaving exactly as before; this is
  // the behaviour that would break first if the shared module changed shape.
  const { repoRoot, backlogDir } = twoBranchesDisagreeing();
  try {
    vcs(repoRoot, ["checkout", "-q", "-b", "numbers"]);
    writeFileSync(join(backlogDir, "tasks", P + "-7-elsewhere.md"), taskText(P + "-7", "pending"), "utf8");
    commit(repoRoot, "a task numbered on another branch");
    vcs(repoRoot, ["checkout", "-q", "main"]);

    const r = cli(["next-id", "--dir", backlogDir, "--explain"], { cwd: repoRoot });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp("^maximum: " + P + "-7\\b", "m"));
    assert.match(r.stdout, /^8$/m);
  } finally {
    cleanup(repoRoot);
  }
});
