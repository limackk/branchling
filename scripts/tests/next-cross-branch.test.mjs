/**
 * The dispatcher reads the whole clone, not one checkout (TL-133).
 *
 * THE DEFECT THIS GUARDS. `query`, `stats` and the viewer have consulted the
 * branch and worktree scan since TL-73; `next` did not, so the ONE command that
 * writes had the narrowest view of the backlog. CLAUDE.md records what that
 * costs: TL-74 was closed at 13:41 on one branch and handed out again at 13:43,
 * because in the second session's tree it was still untouched.
 *
 * WHY THE LOCK MAY NOT BE INVOLVED. Every fixture here puts the other tree's
 * status there by writing the file, never by running `take`: a `take` would also
 * leave a reservation, and the reservation refuses on its own. The test would
 * then pass with the scan removed, which is the shape of a green result with no
 * evidentiary force.
 *
 * EVERY CLAIM IS PAIRED WITH A CONTROL, because "nothing to take" is the answer
 * an empty backlog gives too. The control is either `cross_branch_state: false`
 * — the same tree, the same call, the opposite outcome — or a second task that
 * IS handed out while the held one is skipped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, ...opts,
  });
}

function vcs(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" }
  );
}

function commit(cwd, message) {
  vcs(cwd, ["add", "-A"]);
  vcs(cwd, ["commit", "-qm", message]);
}

function taskPath(backlog, id) {
  const file = readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return join(backlog, "tasks", file);
}

/** The status of one task file, rewritten in place — see the header: NOT `take`. */
function setStatus(file, status) {
  const raw = readFileSync(file, "utf8");
  const out = raw.replace(/^status: .*$/m, "status: " + status);
  assert.notEqual(out, raw, "the status line was not found — the fixture rewrote nothing");
  writeFileSync(file, out, "utf8");
}

function setConfig(backlog, lines) {
  if (!lines || !lines.length) return;
  const p = join(backlog, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + lines.join("\n") + "\n", "utf8");
}

/**
 * A repository whose FIRST task is untouched on `main` and in progress on
 * `feature`. The checkout is left on `main` — the tree that used to be lying.
 *
 * @param {{config?: string[], priorities?: string[]}} opts
 */
function twoBranches(opts = {}) {
  const dir = tmp("next-xbranch");
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };

  assert.equal(cli(["init", "--dir", backlog, "--no-example"], { env }).status, 0);
  setConfig(backlog, opts.config);
  const ids = (opts.priorities || ["P1"]).map((p, i) => {
    const r = cli(["new", "--dir", backlog, "--title", "Task number " + (i + 1), "--priority", p], { env });
    assert.equal(r.status, 0, r.stderr);
    return (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  });

  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  commit(repoRoot, "seed");
  vcs(repoRoot, ["checkout", "-q", "-b", "feature"]);
  setStatus(taskPath(backlog, ids[0]), "in_progress");
  commit(repoRoot, "start the first task");
  vcs(repoRoot, ["checkout", "-q", "main"]);

  return { dir, repoRoot, backlog, env, ids };
}

function statusOf(backlog, id) {
  return (readFileSync(taskPath(backlog, id), "utf8").match(/^status: (.*)$/m) || [])[1].trim();
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ── The claim, and the control that gives it force ─────────────────────────

test("a task another branch has started is not handed out again", () => {
  const { dir, repoRoot, backlog, env, ids } = twoBranches();
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 3, "the dispatcher handed out work another branch is doing: " + r.stdout);
    assert.equal(statusOf(backlog, ids[0]), "pending", "it wrote to the task anyway");
    assert.match(r.stdout, new RegExp(ids[0] + " skipped"), "the candidate vanished without a word");
    assert.match(r.stdout, /feature: in_progress/, "the refusal names neither the branch nor the status");
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: with `cross_branch_state: false` the same tree hands it over", () => {
  // Without this run, the test above passes just as well against a dispatcher
  // that has stopped handing out anything at all.
  const { dir, repoRoot, backlog, env, ids } = twoBranches({ config: ["cross_branch_state: false"] });
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 0, "the documented way to keep the old, single-tree behaviour stopped working: " + r.stderr);
    assert.match(r.stdout, new RegExp(ids[0]));
    assert.equal(statusOf(backlog, ids[0]), "in_progress");
  } finally {
    cleanup(dir);
  }
});

test("only the held task is skipped — the queue keeps moving", () => {
  const { dir, repoRoot, backlog, env, ids } = twoBranches({ priorities: ["P1", "P2"] });
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(statusOf(backlog, ids[1]), "in_progress", "the lower-priority free task was not handed out");
    assert.equal(statusOf(backlog, ids[0]), "pending", "the task held on `feature` was taken here as well");
    assert.match(r.stdout, new RegExp(ids[0] + " skipped — feature: in_progress"),
      "a task was passed over silently while another was handed out");
  } finally {
    cleanup(dir);
  }
});

test("an UNCOMMITTED claim in another worktree counts too", () => {
  // The state no ref scan can see, and the one that matters most: another agent
  // took the task a second ago and has not committed.
  const { dir, repoRoot, backlog, env, ids } = twoBranches();
  const wt = join(dir, "sidecar-tree");
  try {
    vcs(repoRoot, ["branch", "-q", "sidecar", "main"]);
    vcs(repoRoot, ["worktree", "add", "-q", wt, "sidecar"]);
    // `feature` is what the ref scan would find; remove it, so the only thing
    // left to see is the uncommitted file in the other working tree.
    vcs(repoRoot, ["branch", "-qD", "feature"]);
    setStatus(taskPath(join(wt, "backlog"), ids[0]), "in_progress");

    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 3, "a task claimed in another worktree was handed out: " + r.stdout);
    assert.match(r.stdout, /sidecar-tree: in_progress/, "the tree the claim came from is not named");
  } finally {
    rmSync(wt, { recursive: true, force: true });
    cleanup(dir);
  }
});

test("a task CLOSED on another branch is not reopened as fresh work", () => {
  // The 13:41/13:43 collision from CLAUDE.md, in one call: `done` on a branch
  // that has not been merged yet is still `pending` here.
  const { dir, repoRoot, backlog, env, ids } = twoBranches();
  try {
    vcs(repoRoot, ["checkout", "-q", "feature"]);
    setStatus(taskPath(backlog, ids[0]), "done");
    commit(repoRoot, "close the first task");
    vcs(repoRoot, ["checkout", "-q", "main"]);

    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 3, "finished work was handed out a second time: " + r.stdout);
    assert.match(r.stdout, /feature: done/);
  } finally {
    cleanup(dir);
  }
});

test("`--json` carries what was skipped and whether the scan ran at all", () => {
  // An empty `skippedElsewhere` is only meaningful next to `scan.scanned`:
  // "the branches agree" and "nobody looked" call for opposite decisions.
  const { dir, repoRoot, backlog, env, ids } = twoBranches({ priorities: ["P1", "P2"] });
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:b", "--json"], { cwd: repoRoot, env });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.id, ids[1]);
    assert.equal(out.scan.scanned, true);
    assert.equal(out.scan.reason, null);
    assert.deepEqual(out.skippedElsewhere, [
      { id: ids[0], elsewhere: [{ status: "in_progress", source: "feature", kind: "branch" }] },
    ]);
  } finally {
    cleanup(dir);
  }
});

test("nothing to take says so in `--json` as well, with the reason", () => {
  const { dir, repoRoot, backlog, env, ids } = twoBranches();
  try {
    const r = cli(["next", "--dir", backlog, "--actor", "agent:b", "--json"], { cwd: repoRoot, env });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout);
    assert.equal(out.kind, "nothing-to-take");
    assert.equal(out.skippedElsewhere[0].id, ids[0]);
    assert.equal(out.skippedElsewhere[0].elsewhere[0].source, "feature");
  } finally {
    cleanup(dir);
  }
});

// ── The scan may narrow the queue, never widen it ──────────────────────────

test("a task only ANOTHER branch calls startable is not started here", () => {
  // `filterTasks` matches on the statuses seen ANYWHERE — that is what
  // `query --status in_progress` from `main` is for. `next` WRITES, and writing
  // to a task on the strength of somebody else's branch would manufacture the
  // divergence this whole mechanism exists to remove. So the scan may only ever
  // narrow the queue; the run above is the control that it still fills it.
  const { dir, repoRoot, backlog, env, ids } = twoBranches();
  try {
    // `feature` says the one status this call hands out; here it is claimed.
    vcs(repoRoot, ["checkout", "-q", "feature"]);
    setStatus(taskPath(backlog, ids[0]), "pending");
    commit(repoRoot, "the task is free on this branch");
    vcs(repoRoot, ["checkout", "-q", "main"]);
    setStatus(taskPath(backlog, ids[0]), "in_progress");

    const r = cli(["next", "--dir", backlog, "--actor", "agent:b"], { cwd: repoRoot, env });
    assert.equal(r.status, 3, "a task claimed HERE was handed out because another branch called it free");
    assert.equal(statusOf(backlog, ids[0]), "in_progress", "the local claim was overwritten");
  } finally {
    cleanup(dir);
  }
});

// ── One scan, and the dispatcher is one of its callers ─────────────────────

test("`next` reads the SHARED scan module, not a copy of its own", () => {
  // Structural, because the cost of a second copy is not a failing test: it is
  // the dispatcher and the listing disagreeing about which branches exist.
  const src = readFileSync(join(SCRIPTS, "next-task.mjs"), "utf8");
  assert.match(src, /from ['"]\.\/branch-scan\.mjs['"]/, "the dispatcher reads one checkout again");
  assert.doesNotMatch(src, /child_process/, "the dispatcher grew git calls of its own");
});

test("the guarantee is stated as a CLONE, in the README and in the instructions", () => {
  // The boundary moved: the lock stops at the machine, the scan stops at the
  // clone, and the documentation may not keep promising the narrower one as if
  // it were the whole answer.
  const loop = cli(["instructions", "autonomous-loop"], { env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(loop.status, 0, loop.stderr);
  assert.match(loop.stdout, /clone/, "the loop guide does not say where the guarantee ends");
  assert.match(loop.stdout, /branch/, "it no longer says the branch is part of the boundary");

  // THE README IS ASKED ABOUT ITS SUBSTANCE, NOT ITS WORDING (TL-154). This used
  // to match one sentence verbatim, and a rewrite that kept the guarantee intact
  // and reworded the sentence turned it red — a failure that says "the prose
  // moved" in the voice of "the promise is wrong". So the paragraph is located
  // by its own heading and then asked the two questions that actually matter:
  // does it name the clone as the boundary, and does it admit that two clones
  // can still collide. A rewording passes; a narrowing back to one checkout, or
  // a paragraph quietly deleted, does not.
  const readme = readFileSync(join(SCRIPTS, "..", "README.md"), "utf8");
  const at = readme.indexOf("Where the guarantee ends");
  assert.notEqual(at, -1, "the README no longer states where the guarantee ends at all");
  const para = readme.slice(at, at + 1500);
  assert.match(para, /worktree of one clone/, "the reservation is no longer stated as covering the clone");
  assert.match(para, /branch and worktree of that clone/, "the scan's reach across branches is no longer stated");
  assert.match(para, /two clones/, "the README no longer admits that two clones can both take one task");
});
