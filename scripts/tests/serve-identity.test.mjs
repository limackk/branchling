/**
 * Whose backlog is on that port? (TL-71)
 *
 * The bug this pins down was not "two servers cannot coexist" — they always
 * could (`--port`, plus stepping to `port + 1` on EADDRINUSE). It was that the
 * startup probe asked the wrong question. `/api/ping` answered "an instance of
 * this server", not "an instance over THIS backlog", so a second invocation in
 * project A found project B's server, printed "already running", opened a tab
 * and exited 0. A success signal over somebody else's tasks — the same class of
 * silent no-op that TL-22 removed from flag validation.
 *
 * WHY THE `same` CASE IS TESTED TOO. An implementation that never recognises a
 * server as its own passes every "it started beside it" assertion while
 * destroying the idempotence of the bare command. Without that positive control
 * this file would be green with no evidential force.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

/**
 * A port nothing holds right now. Asking the kernel beats a hard-coded number:
 * the suite must not fail because the developer happens to have a viewer open.
 */
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

/** A real backlog on disk, created by the tool itself, named as we ask. */
function makeBacklog(projectName) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "worktrail-identity-")));
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(init.status, 0, "init did not pass: " + init.stderr);
  const config = join(dir, "config.yaml");
  const rewritten = readFileSync(config, "utf8").replace(
    /^project_name:.*$/m,
    `project_name: "${projectName}"`
  );
  writeFileSync(config, rewritten);
  return dir;
}

/**
 * Start a server and wait until it says which port it bound — the message is
 * printed from inside the listen callback, so a matched line means the socket
 * is up and the next request cannot race it.
 */
function startServer(dir, port) {
  const proc = spawn(
    process.execPath,
    [SERVER, "--dir", dir, "--port", String(port), "--no-open"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  let out = "";
  let err = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });

  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`the server did not report a port in 20s\nstdout:\n${out}\nstderr:\n${err}`)),
      20_000
    );
    const check = () => {
      const m = out.match(LISTENING);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the server exited (${code}) instead of listening\nstdout:\n${out}\nstderr:\n${err}`));
    });
    check();
  });

  return { proc, bound, stdout: () => out, stderr: () => err };
}

/** Stop a server and WAIT for it to be gone — a survivor breaks the next run. */
function stop(handle) {
  if (!handle || handle.proc.exitCode !== null || handle.proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    handle.proc.on("exit", () => resolve());
    handle.proc.kill("SIGKILL");
  });
}

function ping(port) {
  return new Promise((resolve) => {
    const req = get({ host: "127.0.0.1", port, path: "/api/ping", timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

test("/api/ping names the backlog it serves, resolved and absolute", async () => {
  const dir = makeBacklog("Ping Project");
  const port = await freePort();
  const server = startServer(dir, port);
  try {
    const bound = await server.bound;
    const body = await ping(bound);
    assert.ok(body, "the probe endpoint did not answer");
    assert.equal(body.backlogDir, realpathSync(dir), "backlogDir must be the resolved absolute path");
    assert.equal(body.projectName, "Ping Project");
    assert.ok(body.pid > 0, "pid is what makes the answer actionable in `kill`");
  } finally {
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second server over ANOTHER backlog starts beside it and serves its own", async () => {
  const dirA = makeBacklog("Project A");
  const dirB = makeBacklog("Project B");
  const port = await freePort();
  let a = null;
  let b = null;
  try {
    a = startServer(dirA, port);
    const portA = await a.bound;
    assert.equal(portA, port, "the first server takes the port it was given");

    b = startServer(dirB, port);
    const portB = await b.bound;

    assert.notEqual(portB, portA, "the second server must not bow out to a stranger's backlog");

    const served = await ping(portB);
    assert.equal(served.backlogDir, dirB, "it serves ITS OWN backlog, not the one already up");
    assert.equal(served.projectName, "Project B");

    // The first one is untouched — taking the port would have been the other
    // way to get this wrong.
    const first = await ping(portA);
    assert.equal(first.backlogDir, dirA);

    // Without the names the user is back to `ps aux` to learn what the busy
    // port holds — which is the diagnosis this task came from.
    const said = b.stdout();
    assert.match(said, /Project A/, "the message must name the project already on the port");
    assert.match(said, /Project B/, "the message must name the project that just started");
    assert.match(said, new RegExp(String(portA)), "the message must name the taken port");
    assert.match(said, new RegExp(String(portB)), "the message must name the port it chose");
  } finally {
    await stop(a);
    await stop(b);
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("a second server over the SAME backlog opens a tab and exits — no rival process", async () => {
  const dir = makeBacklog("Only Project");
  const port = await freePort();
  let server = null;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;

    const second = spawnSync(
      process.execPath,
      [SERVER, "--dir", dir, "--port", String(bound), "--no-open"],
      { encoding: "utf8", timeout: 30_000 }
    );

    assert.equal(second.status, 0, "recognising our own server is success, not an error");
    assert.match(second.stdout, /already running/);
    assert.doesNotMatch(second.stdout, LISTENING, "it must not have bound a port of its own");
    assert.equal(await ping(bound + 1), null, "nothing may be listening on the next port");
  } finally {
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed assertion still leaves no server behind", async () => {
  // Cleanup that only runs on the happy path is cleanup that is absent exactly
  // when it is needed: a survivor on the port makes the NEXT run of this suite
  // measure the previous run. So the guarantee is asserted, not assumed.
  const dir = makeBacklog("Leak Check");
  const port = await freePort();
  let bound = null;
  let server = null;
  try {
    try {
      server = startServer(dir, port);
      bound = await server.bound;
      assert.fail("a deliberate failure, standing in for a real one");
    } finally {
      await stop(server);
    }
  } catch (e) {
    assert.match(e.message, /a deliberate failure/, "only the planted failure may reach here");
  }
  assert.equal(await ping(bound), null, "the port must be free once the test body has failed");
  rmSync(dir, { recursive: true, force: true });
});

test("the same backlog reached through a symlink is the SAME backlog", async () => {
  // A worktree behind a symlink compared as a raw string reads as a stranger,
  // and the tool would start a second writer over one directory.
  const dir = makeBacklog("Linked Project");
  const link = join(mkdtempSync(join(tmpdir(), "worktrail-link-")), "backlog");
  symlinkSync(dir, link);
  const port = await freePort();
  let server = null;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;

    const second = spawnSync(
      process.execPath,
      [SERVER, "--dir", link, "--port", String(bound), "--no-open"],
      { encoding: "utf8", timeout: 30_000 }
    );

    assert.equal(second.status, 0);
    assert.match(second.stdout, /already running/, "the symlink must resolve to the running instance");
  } finally {
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
});
