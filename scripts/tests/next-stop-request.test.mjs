/**
 * `next` honours a stop request made with `run --stop` (TL-697).
 *
 * THE DEFECT THIS GUARDS. Only `run` read the request, so a loop built on
 * `next` alone — supervisors calling `next --plan` themselves — could not be
 * told to finish its task and stop: on 2026-11-10 that was done by killing the
 * orchestration, mid-merge, after two loops had claimed new tasks.
 *
 * THE CLAIM AND ITS CONTROL. While a request holds, `next` claims nothing; the
 * control is the same `next` after `run --stop --clear`, which DOES claim — so
 * the refusal is the request's doing and not a fixture with nothing to take.
 * A further control keeps `run`'s own rule: the `next` a run spawns carries
 * the run's start time, and a request older than that does not stop it.
 *
 * The state directory is redirected into the fixture: a suite writing to the
 * user's real one would leave a stop request behind that halts their loops.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STOP_SINCE_ENV } from "../run-stop.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("next-stop-request");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return fixtureDir(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000, env });
}

function vcs(cwd, args) {
  return execFileSync("git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false"].concat(args),
    { cwd, encoding: "utf8" });
}

/** A committed repository holding a backlog with one pending task. */
function fixture() {
  const dir = tmp("next-stop");
  const repoRoot = join(dir, "repo");
  mkdirSync(repoRoot, { recursive: true });
  const backlog = join(repoRoot, "backlog");
  const env = { ...process.env, BACKLOG_STATE_DIR: join(dir, "state"), NO_COLOR: "1" };
  delete env[STOP_SINCE_ENV];
  delete env.BACKLOG_ACTOR;
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const r = cli(["new", "--dir", backlog, "--title", "Task number one", "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);
  return { dir, backlog, env, id };
}

function statusOf(backlog, id) {
  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
  return (readFileSync(file, "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

test("next claims nothing while a stop request holds and claims again once it is cleared (TL-697)", () => {
  const { dir, backlog, env, id } = fixture();
  try {
    const asked = cli(["run", "--stop", "--dir", backlog, "--actor", "agent:supervisor", "--json"], env);
    assert.equal(asked.status, 0, asked.stderr);
    const request = JSON.parse(asked.stdout);
    assert.equal(request.cleared, false);

    const refused = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--json"], env);
    assert.equal(refused.status, 3, refused.stdout + refused.stderr);
    const out = JSON.parse(refused.stdout);
    assert.equal(out.refusalKind, "stop-requested");
    assert.equal(out.ok, false);
    assert.equal(out.taken, false);
    assert.equal(out.dryRun, false);
    assert.equal(out.stopRequest.by, "agent:supervisor");
    assert.equal(out.stopRequest.requestedAt, request.requestedAt);
    assert.equal(statusOf(backlog, id), "pending", "next claimed a task while a stop request held");

    // The request is not consumed by the first `next` that sees it: several
    // loops share one clone, and each of them must be told.
    const again = cli(["next", "--dir", backlog, "--actor", "agent:other", "--plan"], env);
    assert.equal(again.status, 3, again.stdout + again.stderr);
    assert.doesNotMatch(again.stdout, /^\s*\{/, "the answer for a person came out as JSON");
    assert.match(again.stdout, /stop requested/);
    assert.ok(again.stdout.includes("requested " + request.requestedAt + " by agent:supervisor with `"),
      "the answer does not name who asked and when: " + again.stdout);
    assert.ok(again.stdout.includes("run --stop`, for " + request.origin), "the answer does not name the clone");
    assert.match(again.stdout, /withdraw it with `\S+ run --stop --clear` to claim again/, "the answer does not say how to withdraw it");

    const dry = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--dry-run", "--json"], env);
    assert.equal(dry.status, 3, dry.stdout + dry.stderr);
    assert.equal(JSON.parse(dry.stdout).refusalKind, "stop-requested");
    assert.equal(JSON.parse(dry.stdout).dryRun, true);

    const cleared = cli(["run", "--stop", "--clear", "--dir", backlog, "--json"], env);
    assert.equal(cleared.status, 0, cleared.stderr);
    const withdrawn = JSON.parse(cleared.stdout);
    assert.equal(withdrawn.cleared, true);
    assert.equal(withdrawn.by, "agent:supervisor");

    // CONTROL: the same call, the request withdrawn, takes the task.
    const taken = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--json"], env);
    assert.equal(taken.status, 0, taken.stdout + taken.stderr);
    assert.equal(JSON.parse(taken.stdout).id, id);
    assert.equal(statusOf(backlog, id), "in_progress");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the next a run spawns honours only a request made after the run started (TL-697)", () => {
  const { dir, backlog, env, id } = fixture();
  try {
    const asked = JSON.parse(cli(["run", "--stop", "--dir", backlog, "--json"], env).stdout);
    // A request made at the very moment the run started is one the run must
    // honour: the run's own check reads `>=`, and `next` may not disagree.
    const same = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--json"], { ...env, [STOP_SINCE_ENV]: asked.requestedAt });
    assert.equal(same.status, 3, same.stdout + same.stderr);
    assert.equal(JSON.parse(same.stdout).refusalKind, "stop-requested");
    // Nobody named on the request: the sentence says when and stops there.
    assert.equal(asked.by, null);
    const plain = cli(["next", "--dir", backlog, "--actor", "agent:loop"], env);
    assert.ok(plain.stdout.includes("requested " + asked.requestedAt + " with `"), plain.stdout);
    const later = new Date(Date.parse(asked.requestedAt) + 1).toISOString();
    const r = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--json"], { ...env, [STOP_SINCE_ENV]: later });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).id, id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("`--clear` with nothing to withdraw answers so, and without `--stop` it fails (TL-697)", () => {
  const { dir, backlog, env } = fixture();
  try {
    const none = cli(["run", "--stop", "--clear", "--dir", backlog, "--json"], env);
    assert.equal(none.status, 0, none.stderr);
    const out = JSON.parse(none.stdout);
    assert.equal(out.cleared, false);
    assert.equal(out.requestedAt, null);
    const bare = cli(["run", "--clear", "--dir", backlog], env);
    assert.equal(bare.status, 2, bare.stdout + bare.stderr);
    assert.match(bare.stderr, /--stop/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a request file that names no time is no request (TL-697)", () => {
  // Anything able to write a byte into the state directory must not be able to
  // stop every loop of the clone; only what `run --stop` writes counts.
  const { dir, backlog, env, id } = fixture();
  try {
    const asked = JSON.parse(cli(["run", "--stop", "--dir", backlog, "--json"], env).stdout);
    writeFileSync(asked.path, JSON.stringify({ by: "agent:supervisor" }) + "\n", "utf8");
    const r = cli(["next", "--dir", backlog, "--actor", "agent:loop", "--json"], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).id, id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
