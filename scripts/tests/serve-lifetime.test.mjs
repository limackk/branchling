/**
 * A running viewer can be named, and a dead one is never called running (TL-266).
 *
 * WHAT WAS MEASURED. On 2026-09-04 six `serve` processes were listening on one
 * machine; three had `ppid=1` — the shell that started them was gone and the
 * kernel had reparented them — and three came from worktrees that no longer
 * existed. While this file was written, one had been listening for two days and
 * three hours from the main checkout of this clone. Every one of them is a
 * WRITER: `serve` reconciles on a timer and appends to `backlog/history/` as
 * `unknown`, and TL-185 already lists "two serve processes reconciling on their
 * own timer" among the causes it could not rule out. The tool could name none
 * of them; `lsof` and `kill` were the only instruments.
 *
 * WHAT IS PROVEN HERE, and in the same words the module uses, because a test
 * that proves a weaker claim than the documentation makes is worse than none:
 *
 *   A server that exits normally, or on SIGINT/SIGTERM/SIGHUP, REMOVES its own
 *   entry. That is a guarantee and it is asserted below.
 *
 *   A server that is SIGKILLed runs no handler and leaves its entry behind.
 *   That is NOT a guarantee, and the case below asserts the honest answer
 *   instead: the entry is reported as `stale`, never as `running`, and the next
 *   `serve` reclaims it.
 *
 * WHY `--stop` ASKS THE PORT BEFORE IT SIGNALS. Pids are recycled. An entry
 * whose pid now belongs to another program would turn `--stop` into a way of
 * killing a stranger's process with the tool's own hand. The case at the bottom
 * builds exactly that situation — a live innocent process, registered against a
 * port that answers something else — and requires that nothing is signalled and
 * that the innocent process is still alive afterwards.
 *
 * EVERY PROCESS THIS FILE STARTS IS STOPPED in a `finally`, and every fixture
 * directory is removed. The suite runs these files concurrently, and a leaked
 * listener here would be this file committing the defect it is about.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, request } from "node:http";
import { createServer } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";
import { listServers, serversDir } from "../serve-registry.mjs";

isolateHome("serve-lifetime");

// The register is per-user machine state (`stateRoot()`), so a suite that did
// not move it would read — and stop — the developer's own running viewers.
const STATE_DIR = realpathSync(mkdtempSync(join(tmpdir(), "branchling-serve-state-")));
process.env.BACKLOG_STATE_DIR = STATE_DIR;

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

function backlog() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-serve-life-")));
  const root = join(dir, "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(init.status, 0, init.stderr);
  return { dir, root };
}

function startServer(root, port) {
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(port), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  let out = "";
  for (const stream of [proc.stdout, proc.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (c) => { out += c; });
  }
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no port reported in 20s: " + out)), 20_000);
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

const exited = (proc) => new Promise((resolve) => {
  if (proc.exitCode !== null || proc.signalCode !== null) { resolve({ code: proc.exitCode, signal: proc.signalCode }); return; }
  proc.on("exit", (code, signal) => resolve({ code, signal }));
});

async function stop(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  const hard = setTimeout(() => proc.kill("SIGKILL"), 5_000);
  await exited(proc);
  clearTimeout(hard);
}

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args],
  { encoding: "utf8", timeout: 30_000, env: { ...process.env } });

function call(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", timeout: 3000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.end();
  });
}

const entries = () => listServers();
const entryFor = (port) => entries().find((e) => e.port === port) || null;

test("a running server is in the register, and its entry goes when it exits", async () => {
  const fixture = backlog();
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  try {
    const bound = await handle.bound;

    const seen = entryFor(bound);
    assert.ok(seen, "the running server is not in the register — the tool still cannot name it");
    assert.equal(seen.state, "running");
    assert.equal(seen.pid, handle.proc.pid, "the entry names a different process than the one that started");
    assert.equal(seen.tree, fixture.root);
    assert.equal(seen.host, hostname());

    // THROUGH THE TOOL, not only through the module: the criterion is that a
    // person can ask, and `--list` is what they type.
    const listed = cli("serve", "--list", "--json");
    assert.equal(listed.status, 0, listed.stderr);
    const payload = JSON.parse(listed.stdout);
    assert.equal(payload.kind, "serve-list");
    assert.ok(payload.servers.some((e) => e.port === bound && e.state === "running"),
      "`serve --list --json` does not carry the server that is running: " + listed.stdout);
    assert.match(cli("serve", "--list").stdout, new RegExp("port " + bound),
      "the human listing does not name the port either");

    // The server still answers while registered: registration must not be the
    // thing that broke serving.
    assert.equal((await call(bound, "/api/tasks")).status, 200);

    await stop(handle.proc);
    assert.equal(entryFor(bound), null, "the entry outlived a server that exited on SIGTERM");
  } finally {
    await stop(handle.proc);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("Ctrl-C still stops it, exit 0, and the entry goes with it", async () => {
  const fixture = backlog();
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  try {
    const bound = await handle.bound;
    assert.ok(entryFor(bound), "nothing was registered, so what follows would prove nothing");
    handle.proc.kill("SIGINT");
    const end = await exited(handle.proc);
    assert.equal(end.code, 0, "SIGINT no longer ends the server cleanly (signal " + end.signal + ")");
    assert.equal(entryFor(bound), null, "the entry survived Ctrl-C");
  } finally {
    await stop(handle.proc);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("a SIGKILLed server is reported as stale, not as running, and the next serve reclaims it", async () => {
  const fixture = backlog();
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  let second = null;
  try {
    const bound = await handle.bound;
    assert.equal(entryFor(bound).state, "running");

    // NO HANDLER RUNS HERE. This is the case the guarantee does not cover, and
    // the whole point is that the tool says so rather than guessing.
    handle.proc.kill("SIGKILL");
    await exited(handle.proc);

    const dead = entryFor(bound);
    assert.ok(dead, "the entry vanished by itself — then this case is measuring nothing");
    assert.equal(dead.state, "stale", "a process that was killed is still being reported as running");

    const listed = JSON.parse(cli("serve", "--list", "--json").stdout);
    assert.equal(listed.servers.find((e) => e.port === bound).state, "stale");

    // THE RECLAIM. Starting a server is what clears what the dead ones left —
    // "the next `serve` detects and reclaims" is the honest form of the
    // promise, and this asserts it rather than a handler that cannot run.
    const port2 = await freePort();
    second = startServer(fixture.root, port2);
    await second.bound;
    assert.equal(entryFor(bound), null, "the stale entry survived the next serve — nothing reclaims it");
    assert.equal(entryFor(port2).state, "running");
  } finally {
    await stop(handle.proc);
    if (second) await stop(second.proc);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("--stop ends a running server, and says so", async () => {
  const fixture = backlog();
  const port = await freePort();
  const handle = startServer(fixture.root, port);
  try {
    const bound = await handle.bound;
    const stopped = cli("serve", "--stop", String(bound), "--json");
    assert.equal(stopped.status, 0, stopped.stderr);
    const payload = JSON.parse(stopped.stdout);
    assert.equal(payload.kind, "serve-stop");
    assert.equal(payload.stopped[0].outcome, "stopped");
    assert.equal(payload.stopped[0].forced, false, "it had to be killed — SIGTERM is no longer handled");

    await exited(handle.proc);
    assert.equal(entryFor(bound), null, "the entry outlived the server --stop ended");
    await assert.rejects(() => call(bound, "/api/tasks"), "the port still answers after --stop");
  } finally {
    await stop(handle.proc);
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("--stop on a port nothing registered is an answer, not a crash", () => {
  const r = cli("serve", "--stop", "1", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).stopped[0].outcome, "not-registered");
});

test("--stop signals NOTHING when the port does not answer as this tool's viewer", async () => {
  // The situation this exists for: the registered pid was recycled and now
  // belongs to somebody else's program. Built here out of two real processes —
  // a live child that must survive, and a listener that is not our viewer.
  const innocent = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const port = await freePort();
  const stranger = createHttpServer((_req, res) => { res.writeHead(200); res.end("not a viewer"); });
  await new Promise((resolve) => stranger.listen(port, "127.0.0.1", resolve));
  writeFileSync(join(serversDir(), port + ".json"), JSON.stringify({
    port, pid: innocent.pid, host: hostname(), tree: "/nowhere", repository: "/nowhere",
    projectName: "fixture", startedAt: new Date().toISOString(),
  }) + "\n", "utf8");
  try {
    const r = cli("serve", "--stop", String(port), "--json");
    assert.equal(JSON.parse(r.stdout).stopped[0].outcome, "not-ours");
    assert.equal(r.status, 1, "a refusal to stop reported success — a script cannot tell");
    assert.equal(innocent.exitCode, null, "the tool killed a process that was not its server");
    assert.ok(entryFor(port), "the entry was dropped although the pid is alive and unaccounted for");
  } finally {
    innocent.kill("SIGKILL");
    await exited(innocent);
    // `close()` alone WAITS for open connections, and the handshake this case
    // is about leaves one: the probe's client keeps its socket alive. Measured
    // under the full suite — the file sat for eight minutes in this line while
    // everything it asserts had already passed. A test that hangs is a test
    // that breaks the suite for everybody, which is this task's own subject.
    stranger.closeAllConnections?.();
    await new Promise((resolve) => stranger.close(resolve));
    try { rmSync(join(serversDir(), port + ".json")); } catch { /* the command took it */ }
  }
});

test("positive control: the register is the directory this suite pointed it at", () => {
  // Every assertion above reads `listServers()`. If the state directory were
  // the developer's real one, the file would be judging their machine — and
  // `--stop` would have been aimed at their running viewers.
  assert.ok(serversDir().startsWith(STATE_DIR),
    "the register is at " + serversDir() + ", outside the throwaway state directory");
  assert.ok(readdirSync(STATE_DIR).length >= 0);
});
