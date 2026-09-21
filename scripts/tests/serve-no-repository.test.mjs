/**
 * A backlog nobody has committed yet is still served (TL-232).
 *
 * WHAT THIS DEFENDS. `serve` needs a DIRECTORY, not a repository. A backlog
 * created by `init` in a plain folder — the state every new user is in for the
 * first few minutes — has no `.git` anywhere above it, and the viewer is the
 * surface that user meets first. Between TL-188 and TL-379 the served subject
 * was resolved through the worktree switcher: git listed no worktree outside a
 * repository, the allowlist came back empty, and the empty key — "this
 * server's own tree" — matched nothing, so every route answered
 * `404 {"error":"No worktree of this repository is called ``"}`. A running
 * server that says the tree is not there is a false claim about the tree, and
 * it reads exactly like a real answer.
 *
 * WHY THIS FILE IS A GUARD AND NOT A REPAIR. The defect is gone: TL-379 removed
 * the switcher, the per-request `?worktree=` resolution and the per-tree
 * configuration load, and with them the only path by which git's opinion could
 * decide whether the backlog exists. Nothing in this tree fails today. What was
 * missing is the measurement — the absence of a repository was never asserted
 * anywhere, so the next module that reaches for git at request time would
 * restore the 404 with the whole suite green.
 *
 * WHY IT SENDS REAL REQUESTS. Reading the source for `git` proves nothing: the
 * question is what a reader's browser gets from a process that is actually
 * listening, so a real server is started over a fixture on disk and the routes
 * are called.
 *
 * WHY EVERY CASE CARRIES A CONTROL. "200 over a backlog with no repository" is
 * satisfied by a server that answers 200 to everything, and "the tree has no
 * repository" is satisfied by a fixture whose git state was never checked. Both
 * are asserted: `git rev-parse` must FAIL in the non-repository fixture and
 * SUCCEED in the control one, and an unknown route must still answer 404 in
 * both.
 *
 * EVERY SERVER STARTED HERE IS STOPPED in a `finally`, including when the bind
 * never happens — a leaked listener is TL-266's subject and would make this
 * file the thing that flakes the suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("serve-no-repository");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

/** What a reader's browser asks for on the first paint. */
const READER_ROUTES = ["/", "/api/tasks", "/api/ping"];

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

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 });

/**
 * A backlog with one real task. `repository` decides whether git knows about
 * the tree at all — the single variable this file is about.
 */
function backlog({ repository }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-serve-norepo-")));
  if (repository) assert.equal(git(dir, "init").status, 0, "the control fixture could not be made a repository");
  const root = join(dir, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(init.status, 0, init.stderr);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Work a reader can see"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];

  // THE CONTROL ON THE FIXTURE ITSELF. Without it a tmpdir that happened to sit
  // inside somebody's repository would make the whole file assert nothing.
  const seen = git(root, "rev-parse", "--git-dir");
  if (repository) assert.equal(seen.status, 0, "the control fixture is not in a repository, so it controls nothing");
  else assert.notEqual(seen.status, 0, "the fixture IS in a repository — this file did not measure its own subject");

  return { dir, root, id };
}

function startServer(root, port) {
  // The MODULE, not `cli.mjs serve`: the CLI dispatches with a blocking
  // `spawnSync`, so a signal sent to it leaves the server behind as its own
  // orphan — which is TL-266's subject, not a dependency this file may take on.
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(port), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (c) => { out += c; });
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the server did not report a port in 20s: " + out)), 20_000);
    const check = () => {
      const m = out.match(LISTENING);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (c) => { clearTimeout(timer); reject(new Error("the server exited (" + c + "): " + out)); });
    check();
  });
  return { proc, bound, output: () => out };
}

function call(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    req.end();
  });
}

/** Stop unconditionally: a server left listening outlives the whole suite. */
async function stop(handle) {
  if (handle.proc.exitCode !== null || handle.proc.signalCode !== null) return;
  handle.proc.kill("SIGTERM");
  await new Promise((resolve) => {
    const hard = setTimeout(() => handle.proc.kill("SIGKILL"), 5_000);
    handle.proc.on("exit", () => { clearTimeout(hard); resolve(); });
  });
}

/** The whole measurement, run over both layouts so neither can drift. */
async function servesItsOwnTree(repository) {
  const fixture = backlog({ repository });
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  try {
    const bound = await handle.bound;
    for (const path of READER_ROUTES) {
      const res = await call(bound, path);
      assert.equal(res.status, 200,
        path + " answered " + res.status + " over a backlog " +
        (repository ? "in" : "outside") + " a repository: " + res.text.slice(0, 200));
    }
    const tasks = JSON.parse((await call(bound, "/api/tasks")).text);
    assert.ok(tasks.tasks.some((t) => t.id === fixture.id),
      "/api/tasks answered 200 without the task on disk — the 200 above proves nothing");
    const page = await call(bound, "/");
    assert.ok(page.text.includes(fixture.id), "the served page does not carry the task it was asked to show");

    // THE CONTROL ON THE 200s. A server that answered 200 to everything would
    // have satisfied every assertion above it.
    const stranger = await call(bound, "/api/no-such-route");
    assert.equal(stranger.status, 404, "an unknown route no longer answers 404, so the 200s above mean nothing");
  } finally {
    await stop(handle);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
}

test("a backlog outside any git repository is served, not answered 404", async () => {
  await servesItsOwnTree(false);
});

test("the same backlog inside a repository is served identically", async () => {
  await servesItsOwnTree(true);
});

test("no route resolves through git, so no request can be refused for the tree's git state", async () => {
  // THE MECHANISM, not just the symptom. The 404 came from a subject derived
  // per request from `git worktree list`; the repair was to stop deriving it.
  // A request handler that shells out to git again is how the symptom returns,
  // and this is the cheapest place to say so.
  const fixture = backlog({ repository: false });
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  try {
    const bound = await handle.bound;
    for (const query of ["", "?worktree=", "?worktree=no-such-tree"]) {
      const res = await call(bound, "/api/tasks" + query);
      assert.equal(res.status, 200,
        "/api/tasks" + query + " answered " + res.status + " — a query parameter is deciding whether the backlog exists");
    }
    assert.ok(!/no worktree/i.test(handle.output()),
      "the server named a worktree over a tree git knows nothing about: " + handle.output());
  } finally {
    await stop(handle);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
