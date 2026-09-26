/**
 * The live viewer's write boundary is a server capability, not a hidden button.
 * Real requests prove both sides: a served page can make one attributed edit,
 * while a foreign page, guessed token, stale page and malformed task id cannot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("viewer-write-api");
isolateState("viewer-write-api");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

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

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-viewer-write-")));
  const root = join(dir, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8" }).status, 0);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Editable work"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return { dir, root, id: made.stdout.match(/[A-Z]+-\d+/)[0] };
}

function start(root, port, ttl = 60_000) {
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(port), "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VIEWER_WRITE_CAPABILITY_TTL_MS: String(ttl) },
  });
  let output = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => { output += chunk; });
  proc.stderr.on("data", (chunk) => { output += chunk; });
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not bind: " + output)), 20_000);
    const check = () => {
      const match = output.match(LISTENING);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error("server exited " + code + ": " + output)); });
  });
  return { proc, bound };
}

function call(port, path, { method = "GET", body, capability, origin } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (capability) headers["X-Viewer-Capability"] = capability;
    if (origin) headers.Origin = origin;
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function capability(port) {
  const page = await call(port, "/");
  assert.equal(page.status, 200);
  const match = page.text.match(/window\.VIEWER_WRITE=({[^<]+})<\/script>/);
  assert.ok(match, "the served page did not receive a write capability");
  return JSON.parse(match[1]);
}

async function revision(port, id) {
  const response = await call(port, "/api/tasks");
  assert.equal(response.status, 200);
  const task = response.json().tasks.find((candidate) => candidate.id === id);
  assert.ok(task?.revision, "the read API did not expose an optimistic revision");
  return task.revision;
}

async function stop(handle) {
  if (handle.proc.exitCode !== null) return;
  handle.proc.kill("SIGTERM");
  await new Promise((resolve) => handle.proc.once("exit", resolve));
}

function taskPath(root, id) {
  return join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-")));
}

test("only a same-origin served page can make an attributed edit", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort());
  try {
    const port = await handle.bound;
    const cap = await capability(port);
    const body = {
      id: fx.id, field: "title", value: "Edited in the live viewer",
      actor: "local:owner", reason: "Clarify the task", revision: await revision(port, fx.id),
    };
    for (const headers of [
      {},
      { capability: "guessed", origin: `http://127.0.0.1:${port}` },
      { capability: cap.token, origin: "https://foreign.example" },
    ]) {
      const refused = await call(port, "/api/task", { method: "POST", body, ...headers });
      assert.equal(refused.status, 403);
    }
    const accepted = await call(port, "/api/task", {
      method: "POST", body, capability: cap.token, origin: `http://127.0.0.1:${port}`,
    });
    assert.equal(accepted.status, 200, accepted.text);
    assert.match(readFileSync(taskPath(fx.root, fx.id), "utf8"), /title: Edited in the live viewer/);
    const rows = readFileSync(join(fx.root, "history", fx.id + ".jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(rows.some((row) => row.field === "title" && row.actor === "local:owner" && row.source === "viewer"));
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});

test("repeated page requests evict old capabilities while the current page can write", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort());
  try {
    const port = await handle.bound;
    const issued = [];
    for (let i = 0; i < 33; i++) issued.push(await capability(port));
    const origin = `http://127.0.0.1:${port}`;
    const body = {
      id: fx.id, field: "title", value: "Bounded capability registry",
      actor: "local:owner", revision: await revision(port, fx.id),
    };

    const evicted = await call(port, "/api/task", {
      method: "POST", body, capability: issued[0].token, origin,
    });
    assert.equal(evicted.status, 403, "the oldest unexpired capability should be pruned at the bound");

    const current = await call(port, "/api/task", {
      method: "POST", body, capability: issued.at(-1).token, origin,
    });
    assert.equal(current.status, 200, current.text);
    assert.match(readFileSync(taskPath(fx.root, fx.id), "utf8"), /title: Bounded capability registry/);
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});

test("stale tokens, traversal, invalid actors and oversized input are refused", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort(), 2_000);
  try {
    const port = await handle.bound;
    const cap = await capability(port);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    const base = { method: "POST", capability: cap.token, origin: `http://127.0.0.1:${port}` };
    assert.equal((await call(port, "/api/task", { ...base, body: { id: fx.id, field: "title", value: "No", actor: "local:owner", revision: "stale" } })).status, 403);

    const fresh = await capability(port);
    const live = { ...base, capability: fresh.token };
    const current = await revision(port, fx.id);
    assert.equal((await call(port, "/api/task", { ...live, body: { id: "../config", field: "title", value: "No", actor: "local:owner", revision: current } })).status, 404);
    assert.equal((await call(port, "/api/task", { ...live, body: { id: fx.id, field: "title", value: "No", actor: "owner", revision: current } })).status, 400);
    const needsReason = await call(port, "/api/task", {
      ...live, body: { id: fx.id, field: "status", value: "blocked", actor: "local:owner", revision: current },
    });
    assert.equal(needsReason.status, 422);
    assert.equal(needsReason.json().needsReason, true);
    const latest = await capability(port);
    const huge = "x".repeat(17 * 1024);
    const oversized = await call(port, "/api/task", {
      ...live, capability: latest.token,
      body: { id: fx.id, field: "title", value: huge, actor: "local:owner", revision: current },
    });
    assert.equal(oversized.status, 413);
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});

test("a history failure restores the task and concurrent edits stay serialized", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort());
  try {
    const port = await handle.bound;
    const cap = await capability(port);
    const origin = `http://127.0.0.1:${port}`;
    const file = taskPath(fx.root, fx.id);
    const original = readFileSync(file, "utf8");
    const staleRevision = await revision(port, fx.id);
    const external = original.replace(/^title: .*$/m, "title: External writer won");
    writeFileSync(file, external, "utf8");
    const conflicted = await call(port, "/api/task", {
      method: "POST", capability: cap.token, origin,
      body: { id: fx.id, field: "title", value: "Must not overwrite", actor: "local:owner", revision: staleRevision },
    });
    assert.equal(conflicted.status, 409);
    assert.equal(readFileSync(file, "utf8"), external);

    const history = join(fx.root, "history");
    const saved = history + ".saved";
    renameSync(history, saved);
    writeFileSync(history, "not a directory\n", "utf8");
    const failed = await call(port, "/api/task", {
      method: "POST", capability: cap.token, origin,
      body: { id: fx.id, field: "title", value: "Must roll back", actor: "local:owner", revision: await revision(port, fx.id) },
    });
    assert.equal(failed.status, 500);
    assert.equal(readFileSync(file, "utf8"), external);
    rmSync(history);
    renameSync(saved, history);

    const sharedRevision = await revision(port, fx.id);
    const edit = (value) => call(port, "/api/task", {
      method: "POST", capability: cap.token, origin,
      body: { id: fx.id, field: "title", value, actor: "local:owner", revision: sharedRevision },
    });
    const replies = await Promise.all([edit("First concurrent title"), edit("Second concurrent title")]);
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
    const rows = readFileSync(join(history, fx.id + ".jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(rows.filter((row) => row.field === "title" && row.source === "viewer").length, 1);
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});
