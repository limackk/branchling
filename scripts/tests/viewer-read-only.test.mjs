/**
 * The viewer is a window, not a second backlog application (TL-379).
 *
 * WHAT THIS REPLACES. `build-viewer.mjs` was the largest module in the tree and
 * carried field editing, a per-task history panel, an analytics dashboard with
 * charts, a board time-lapse, a worktree switcher and three POST routes. The
 * authoritative write surface of this product is Markdown, the CLI and git
 * review; a second write path does not strengthen that boundary, it adds actor,
 * validation and server-lifecycle obligations to defend — and every one of them
 * was defended only by the page choosing not to offer a button.
 *
 * WHY THE REQUESTS ARE ACTUALLY SENT. Hiding an editor proves nothing: the
 * route is what a stranger with `curl` reaches, and "the button is gone" and
 * "the write is gone" are the two states this file exists to tell apart. So the
 * former mutation routes are called for real, against a real server, and the
 * fixture is compared byte for byte afterwards.
 *
 * WHY ABSENCE IS ASSERTED OVER THE BUNDLE AND NOT OVER THE SOURCE. The page is
 * one self-contained computed file; what is not in it cannot run, whatever is
 * left lying in a module. A marker list is the only way to state "this
 * subsystem is gone", and it is written as the capability a reader would name,
 * not as the function that happened to implement it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("viewer-read-only");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

/** The routes that carried a mutation, or the data only a mutation needed. */
const REMOVED_ROUTES = [
  { path: "/api/field", method: "POST", body: { id: null, field: "status", value: "done" } },
  { path: "/api/status", method: "POST", body: { id: null, status: "done" } },
  { path: "/api/decision", method: "POST", body: { id: null, answer: "yes" } },
  { path: "/api/fields", method: "GET" },
  { path: "/api/history", method: "GET" },
  { path: "/api/worktrees", method: "GET" },
];

/** What a window still has to answer, and what a second application had. */
const KEPT_ROUTES = ["/api/ping", "/api/tasks"];

/**
 * Capabilities that must not be in the served page. Named as a reader would
 * name them, with the marker that betrays each — a function name is an
 * implementation detail, but a page that never mentions `/api/field` cannot
 * write a field whatever it calls the attempt.
 */
const REMOVED_CAPABILITIES = [
  ["field editing", "/api/field"],
  ["status writing", "/api/status"],
  ["answering a decision in the browser", "/api/decision"],
  ["the worktree switcher", "/api/worktrees"],
  ["the per-task history panel", "/api/history"],
];

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

function backlog() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-read-only-")));
  const root = join(dir, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(init.status, 0, init.stderr);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Work a reader can see"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  spawnSync(process.execPath, [CLI, "build", "--dir", root], { encoding: "utf8", timeout: 30_000 });
  return { dir, root, id };
}

const taskFile = (root, id) =>
  join(root, "tasks", readdirSync(join(root, "tasks")).find((f) => f.startsWith(id + "-")));
const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function startServer(root, port) {
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(port), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.setEncoding("utf8");
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
  return { proc, bound };
}

function call(port, path, method, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = request({
      host: "127.0.0.1", port, path, method,
      headers: payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function stop(handle) {
  handle.proc.kill("SIGTERM");
  await new Promise((r) => handle.proc.on("exit", r));
}

test("the built page carries no write path and no removed subsystem", () => {
  const { dir, root } = backlog();
  try {
    const built = spawnSync(process.execPath, [CLI, "viewer", "--dir", root], { encoding: "utf8", timeout: 60_000 });
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const html = readFileSync(join(root, "viewer.html"), "utf8");
    assert.ok(html.length > 1000, "the page is too small to have been built at all — the sample is empty, not green");

    for (const [capability, marker] of REMOVED_CAPABILITIES) {
      assert.ok(!html.includes(marker),
        capability + " is still in the served page (found `" + marker + "`) — hiding a button is not removing a write path");
    }
    // The positive control for the whole assertion above: a marker that IS
    // expected. Without it a mistyped path list would report every capability
    // gone while the page was unchanged.
    assert.ok(html.includes("/api/tasks"), "the page no longer reads its own data — this test would now pass on anything");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the page shows current work: tasks, blockers, the active wave and open questions", () => {
  const { dir, root, id } = backlog();
  try {
    spawnSync(process.execPath, [CLI, "viewer", "--dir", root], { encoding: "utf8", timeout: 60_000 });
    const html = readFileSync(join(root, "viewer.html"), "utf8");
    for (const shown of ["blocked_by", "blocks", id.split("-")[0]]) {
      assert.ok(html.includes(shown), "the page does not carry `" + shown + "`, so it cannot be showing current work");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a former mutation request is refused and changes nothing on disk", async () => {
  const { dir, root, id } = backlog();
  const port = await freePort();
  const handle = startServer(root, port);
  try {
    const bound = await handle.bound;
    const file = taskFile(root, id);
    const before = digest(file);

    for (const route of REMOVED_ROUTES) {
      const body = route.body ? { ...route.body, id } : undefined;
      const res = await call(bound, route.path, route.method, body);
      assert.ok(res.status === 404 || res.status === 405,
        route.method + " " + route.path + " answered " + res.status + " — the route is still there");
    }

    assert.equal(digest(file), before, "a refused request still changed the task file");

    // THE POSITIVE CONTROL. Every assertion above is an absence, and a server
    // that answered 404 to everything — or never started — would satisfy all of
    // them. These two must still answer.
    for (const path of KEPT_ROUTES) {
      const res = await call(bound, path, "GET");
      assert.equal(res.status, 200, path + " no longer answers, so the refusals above prove nothing");
    }
  } finally {
    await stop(handle);
    rmSync(dir, { recursive: true, force: true });
  }
});
