/**
 * The open page learns that another worktree took a task (TL-122).
 *
 * WHAT IS BROKEN. `crossBranchState()` (TL-73) exists so that a view drawn from
 * one checkout does not LIE about the rest of the repository, and `GET /`
 * renders per request — so a reload is always right. The PUSH is not. The only
 * live signal for task state is one `fs.watch` over this server's OWN
 * `backlog/tasks`; a `take` run in a SECOND worktree writes a file in THAT
 * tree's directory, nothing changes locally, the watcher never fires, and SSE
 * stays silent. The page keeps a stale scan while looking alive — it still
 * pushes on local edits — so the reader has no reason to press F5. That is
 * worse than a static file, not better: a stale answer that reads exactly like
 * a fresh one.
 *
 * WHY THIS FILE BUILDS REAL WORKTREES. The defect IS a disagreement between
 * trees. Every part of the mechanism under test is git's: `worktree list`
 * supplies the trees, each carries its own `backlog/` (law 1), and the change
 * being detected is an uncommitted edit in somebody else's checkout. A fixture
 * that faked the git layer would assert that our own mock disagrees with
 * itself.
 *
 * WHICH EVENT, AND WHY NOT A NEW NAME. The badge the reader is waiting for
 * (`elsewhere`) travels in `/api/tasks`, and the page already answers
 * `tasks-changed` by re-reading exactly that route. This repeats the decision
 * already taken for the `plan.yaml` watch in `serve-backlog.mjs`, which reuses
 * `tasks-changed` for the same reason: "a second event would be a second name
 * for one refresh". So the contract pinned here is `tasks-changed`, and a
 * dedicated third event name would be a change to this contract, not an
 * implementation detail.
 *
 * THE CONTROLS ARE THE POINT, AND THEY RUN IN BOTH DIRECTIONS. Three of the
 * claims below are claims that NOTHING is pushed — no change, a disabled scan,
 * no repository — and a claim of silence is exactly the kind that a server which
 * can never push at all satisfies for free. Not one of them has any force on its
 * own. They have it only because they are PAIRED with "a take in another worktree
 * pushes", and one of the three shares its connection: the same open stream must
 * be silent before the take and must fire after it, seconds apart, so no
 * implementation can satisfy both by doing nothing.
 *
 * WHAT FAILS TODAY, AND ON WHAT. Measured on 2026-09-04 against the code as it
 * stands: an SSE stream held open for 20 seconds after a real `take` in a second
 * worktree received NOTHING, while `/api/tasks` — one reload — already carried
 * `elsewhere: in_progress` for that task. That is the defect exactly: the data is
 * right and the notification does not exist. The case below reproduces it on an
 * UNTOUCHED configuration, so it fails on the missing push rather than on the
 * missing key; the case about the key fails on the key; and the two silences fail
 * for now only because they set the key that does not exist yet, which is what a
 * control that cannot run until the feature exists looks like.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { get, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_TASK_ID_PREFIX as P } from "../task-id.mjs";
import { ConfigError, loadConfig } from "../config.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines. It also
// moves the RESERVATION out of the machine's real state directory, which
// matters here: the fixture really runs `take`.
isolateHome("serve-cross-branch-push");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

const ID = P + "-1";
const TASK_FILE = ID + "-a-task-taken-in-another-tree.md";

/**
 * The configuration key this task adds: how often the cross-branch scan is
 * repeated for the push loop, in seconds.
 *
 * IT IS A KEY AND NOT A LITERAL because of law III and because the scan shells
 * out to `git`: how much that costs, and how fresh the answer has to be, is a
 * decision belonging to the project, not to the tool. It is named in seconds
 * like `heartbeat_throttle_seconds`, the other key in this file's family that
 * measures how often something is repeated.
 */
const POLL_KEY = "cross_branch_poll_seconds";

/** The reading side of the same key, as `loadConfig` hands it over. */
const POLL_FIELD = "crossBranchPollSeconds";

/**
 * The longest DEFAULT interval this contract accepts, in seconds.
 *
 * Not a preference, and the reason it is a BOUND rather than an exact number is
 * that the number belongs to the project — that is what the key above is for, and
 * a repository whose scan is expensive raises it. What the tool owes is a default
 * on a human timescale: a badge is read by somebody looking at the screen now, and
 * one that stays wrong for half a minute is barely worth pushing at all.
 *
 * It is also the unit every window below is measured in. A quiet window shorter
 * than the slowest legal default would prove nothing — "no event arrived" would
 * only mean the first tick had not run yet — and a push timeout shorter than it
 * would fail a correct implementation. Both are multiples of this, so tightening
 * or loosening the contract moves them together.
 */
const MAX_DEFAULT_POLL_SECONDS = 5;

// A push that needs more than three ticks of the slowest legal default is a
// failure, not a slow machine.
const PUSH_TIMEOUT_MS = 3 * MAX_DEFAULT_POLL_SECONDS * 1000;

// Silence is only evidence over several ticks — so how long it must be watched
// for depends on how long a tick is, and there are two answers here.
//
// The case that exercises the DEFECT runs on an untouched configuration (see
// there), so its tick is unknown and only bounded: three of the slowest legal
// one.
const DEFAULT_QUIET_MS = 3 * MAX_DEFAULT_POLL_SECONDS * 1000;

// The two cases that assert the loop stays OFF set the interval themselves, so
// their tick is known and short. Five of them is stronger evidence than three
// slow ones and costs the suite a fifth of the time.
const TICK_SECONDS = 1;
const TICK_QUIET_MS = 5 * TICK_SECONDS * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function vcs(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function cli(args) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000 });
}

function taskText(status) {
  return [
    "---",
    "id: " + ID,
    'title: "A task taken in another tree"',
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
    "Something to be done somewhere else.",
    "",
  ].join("\n");
}

/** Append project-layer keys to a fixture's `config.yaml`. */
function configure(backlogDir, lines) {
  const path = join(backlogDir, "config.yaml");
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/\n*$/, "\n") + lines.join("\n") + "\n", "utf8");
}

/**
 * A repository with two checkouts of the same backlog: `repo` on `main`, which
 * the server is started over, and `fleet` on its own branch, where the work
 * happens. Both hold the task as `pending` — the disagreement is created by the
 * test, not by the fixture, so the moment it appears is known.
 */
function twoTrees(configLines = []) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "branchling-xpush-")));
  const repoRoot = join(base, "repo");
  const backlogDir = join(repoRoot, "backlog");
  const init = cli(["init", "--dir", backlogDir, "--no-example"]);
  assert.equal(init.status, 0, "init did not pass: " + init.stderr);
  if (configLines.length) configure(backlogDir, configLines);

  vcs(repoRoot, ["init", "-q", "-b", "main"]);
  writeFileSync(join(backlogDir, "tasks", TASK_FILE), taskText("pending"), "utf8");
  vcs(repoRoot, ["add", "-A"]);
  vcs(repoRoot, ["commit", "-qm", "seed"]);

  const fleet = join(base, "fleet");
  vcs(repoRoot, ["worktree", "add", "-q", "-b", "fleet", fleet]);

  return { base, repoRoot, backlogDir, fleet, fleetBacklog: join(fleet, "backlog") };
}

/** The change under test, made the way a person makes it: in the OTHER tree. */
function takeInOtherTree(fx) {
  const r = cli(["take", ID, "--dir", fx.fleetBacklog, "--actor", "agent:other"]);
  assert.equal(r.status, 0, "the fixture could not take the task in the second tree: " + r.stderr + r.stdout);
  const there = readFileSync(join(fx.fleetBacklog, "tasks", TASK_FILE), "utf8");
  assert.match(there, /^status: in_progress$/m, "the take did not change the second tree's file");
  const here = readFileSync(join(fx.backlogDir, "tasks", TASK_FILE), "utf8");
  assert.match(here, /^status: pending$/m,
    "the served tree changed too — then a local watch would explain any push, and this file would prove nothing");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(dir, port) {
  const proc = spawn(process.execPath, [SERVER, "--dir", dir, "--port", String(port), "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the server did not report a port in 20s\n" + out + "\n" + err)),
      20_000
    );
    const check = () => {
      const m = out.match(LISTENING);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("the server exited (" + code + ") instead of listening\n" + out + "\n" + err));
    });
    check();
  });
  return { proc, bound, stdout: () => out, stderr: () => err };
}

function stop(handle) {
  if (!handle || handle.proc.exitCode !== null || handle.proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    handle.proc.on("exit", () => resolve());
    handle.proc.kill("SIGKILL");
  });
}

function http(port, path) {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", timeout: 20_000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "" }); });
    req.on("error", () => resolve({ status: 0, text: "" }));
    req.end();
  });
}

/**
 * One open tab, held for the whole case: the connection is made ONCE and never
 * re-made. That is what "without a reload" means here — every later assertion
 * reads from this same stream, so nothing the test itself does could be
 * mistaken for the push.
 */
function openEvents(port) {
  const seen = [];
  const req = get({ host: "127.0.0.1", port, path: "/api/events" }, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        const m = line.match(/^event:\s*(\S+)/);
        if (m) seen.push(m[1]);
      }
    });
  });
  const connected = new Promise((resolve, reject) => {
    req.on("response", (res) => resolve(res.statusCode));
    req.on("error", reject);
    setTimeout(() => reject(new Error("the SSE stream never answered")), 20_000).unref?.();
  });
  req.end();
  return {
    connected,
    count: (name) => seen.filter((n) => n === name).length,
    seen: () => seen.slice(),
    close: () => req.destroy(),
  };
}

/** Wait for the nth occurrence of an event, or give up. */
async function waitForEvent(stream, name, from, ms = PUSH_TIMEOUT_MS) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (stream.count(name) > from) return true;
    await sleep(100);
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────
// The key: the interval is the project's decision, not a number in the code
// ──────────────────────────────────────────────────────────────────────────

test("the poll interval is a project configuration key with a working default", () => {
  const fx = twoTrees([POLL_KEY + ": 7"]);
  const config = loadConfig(fx.backlogDir);
  assert.equal(config[POLL_FIELD], 7, "`" + POLL_KEY + "` did not reach the loaded configuration as a number");

  // ON by default, for the same reason `cross_branch_state` is: a viewer whose
  // push has to be switched on is a viewer that lies until somebody reads the
  // documentation. The number is the project's; that there IS one is the tool's.
  const plain = twoTrees();
  const fresh = loadConfig(plain.backlogDir);
  assert.equal(typeof fresh[POLL_FIELD], "number", "the key has no default at all");
  assert.ok(fresh[POLL_FIELD] > 0, "the default switches the loop off, so the defect survives an untouched config");
  assert.ok(fresh[POLL_FIELD] <= MAX_DEFAULT_POLL_SECONDS,
    "the default is slower than " + MAX_DEFAULT_POLL_SECONDS + "s, which is longer than anybody watches a badge");

  // THE CONTROL. Without this, "the key was accepted" would be equally true of a
  // configuration layer that had simply stopped failing on unknown keys — and
  // this whole assertion would be about nothing.
  const typo = twoTrees(["cross_branch_pol_seconds: 7"]);
  assert.throws(() => loadConfig(typo.backlogDir), ConfigError,
    "a near-miss of the new key was accepted — the vocabulary is not being checked");
});

// ──────────────────────────────────────────────────────────────────────────
// The push, and the three silences that only mean something beside it
// ──────────────────────────────────────────────────────────────────────────

test("a take in ANOTHER worktree reaches the open page without a reload", async () => {
  // NO KEY IS SET HERE, deliberately: this case is about the DEFECT, not about
  // the configuration. On an untouched `config.yaml` the server starts today,
  // and what it fails to do is push — which is the failure this file exists to
  // record. Setting the key would make it fail on "unknown key" instead, and a
  // reader would learn nothing about the viewer from that.
  const fx = twoTrees();
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  let stream = null;
  try {
    const bound = await server.bound;

    // The page is loaded once — and this is the ONLY request for it in the case.
    const page = await http(bound, "/");
    assert.equal(page.status, 200, "the viewer did not render");

    stream = openEvents(bound);
    assert.equal(await stream.connected, 200, "the tab could not open the event stream");

    // Several ticks BEFORE anything changes: the push must be caused by the
    // take, not by the clock. Without this, a loop that pushed every tick would
    // pass the assertion below and destroy the meaning of every push.
    await sleep(DEFAULT_QUIET_MS);
    const before = stream.count("tasks-changed");
    assert.equal(before, 0, "the page was pushed to before anything changed anywhere: " + stream.seen().join(", "));

    takeInOtherTree(fx);

    const pushed = await waitForEvent(stream, "tasks-changed", before);
    assert.ok(
      pushed,
      "no push after a take in the second worktree — the page still shows `pending` and has no reason to reload.\n" +
        "events seen: [" + stream.seen().join(", ") + "]\n" +
        "server stdout:\n" + server.stdout() + "\nserver stderr:\n" + server.stderr()
    );

    // The push has to be worth acting on: the badge the reader is waiting for is
    // in /api/tasks, which is what the page re-reads on this event.
    const tasks = await http(bound, "/api/tasks");
    assert.equal(tasks.status, 200, tasks.text);
    const task = JSON.parse(tasks.text).tasks.find((t) => t.id === ID);
    assert.ok(task, "the served tree lost the task");
    assert.equal(task.status, "pending", "the served tree's own status is not what changed");
    assert.ok(
      JSON.stringify(task.elsewhere || []).includes("in_progress"),
      "the event fired but the route it sends the page to still knows nothing: " + JSON.stringify(task.elsewhere)
    );

    // AND THE SECOND SILENCE, on the same connection: a scan that has stopped
    // changing must stop pushing. A loop that fired every tick would redraw the
    // page forever and make the signal mean nothing.
    const after = stream.count("tasks-changed");
    await sleep(DEFAULT_QUIET_MS);
    assert.equal(stream.count("tasks-changed"), after,
      "the page kept being pushed to while nothing changed — the loop fires on the tick, not on a difference");
  } finally {
    stream?.close();
    await stop(server);
  }
});

test("a disabled scan disables the loop: no push, whatever the other tree does", async () => {
  const fx = twoTrees(["cross_branch_state: false", POLL_KEY + ": " + TICK_SECONDS]);
  const port = await freePort();
  const server = startServer(fx.backlogDir, port);
  let stream = null;
  try {
    const bound = await server.bound;
    assert.equal((await http(bound, "/")).status, 200, "the viewer did not render");
    stream = openEvents(bound);
    assert.equal(await stream.connected, 200, "the tab could not open the event stream");

    // The very change that MUST push when the scan is on.
    takeInOtherTree(fx);

    await sleep(TICK_QUIET_MS);
    assert.equal(stream.count("tasks-changed"), 0,
      "`cross_branch_state: false` asked for silence and got a scan anyway: " + stream.seen().join(", "));
  } finally {
    stream?.close();
    await stop(server);
  }
});

test("outside a git repository the loop has nothing to watch and says so at most once", async () => {
  // A backlog that is not in a repository at all: `crossBranchState()` answers
  // `not-a-repository` and never will answer anything else while this server
  // runs. A warning per tick would fill the terminal of every person serving a
  // backlog that is not yet committed.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-xpush-nogit-")));
  const backlogDir = join(dir, "backlog");
  assert.equal(cli(["init", "--dir", backlogDir, "--no-example"]).status, 0);
  configure(backlogDir, [POLL_KEY + ": " + TICK_SECONDS]);
  writeFileSync(join(backlogDir, "tasks", TASK_FILE), taskText("pending"), "utf8");

  const port = await freePort();
  const server = startServer(backlogDir, port);
  let stream = null;
  try {
    const bound = await server.bound;
    stream = openEvents(bound);
    assert.equal(await stream.connected, 200, "the tab could not open the event stream");
    await sleep(TICK_QUIET_MS);

    const noisy = (server.stdout() + server.stderr())
      .split("\n")
      .filter((l) => /repositor|branch|worktree|scan/i.test(l));
    assert.ok(noisy.length <= 1,
      "the loop complains on every tick about a repository that will never appear:\n" + noisy.join("\n"));
    assert.equal(stream.count("tasks-changed"), 0, "a scan that did not run pushed anyway");

    // The server is still THERE — a loop that threw on `not-a-repository` would
    // take the process with it. What `/` answers outside a repository is not
    // this task's contract (today: 404, because the worktree list it resolves
    // the subject from is empty), so the assertion is that it still answers at
    // all, not what it answers.
    assert.equal(server.proc.exitCode, null, "the server died while polling a repository that does not exist");
    const page = await http(bound, "/");
    assert.ok(page.status > 0, "the server stopped answering requests");
  } finally {
    stream?.close();
    await stop(server);
  }
});
