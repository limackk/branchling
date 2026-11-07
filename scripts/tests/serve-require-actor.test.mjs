/**
 * The served viewer acts for a person, so its field edit is the caller
 * `--require-actor` exists for (TL-551): an edit that states no actor is
 * refused, and nothing is written, rather than recorded under the default
 * `agent:` actor — a person's act attributed to a program nobody named.
 *
 * Real requests against a real server, because the defect lived in which
 * actor the ROUTE handed the shared write, not in the write itself. The
 * positive controls matter as much as the refusal: an actor stated in the
 * request is recorded under that actor, and the server's own environment is a
 * statement exactly as it is for the CLI — a guard that refused everything
 * would pass the refusal case alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACTOR_ENV, ACTOR_REQUIRED, DEFAULT_ACTOR } from "../actor.mjs";
import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("serve-require-actor");
isolateState("serve-require-actor");

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
  const dir = realpathSync(fixtureDir(join(tmpdir(), "branchling-require-actor-")));
  const root = join(dir, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8" }).status, 0);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Editable work"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return { dir, root, id: made.stdout.match(/[A-Z]+-\d+/)[0] };
}

/** A server whose environment states an actor only when `actor` is given. */
async function start(root, actor = null) {
  const env = { ...process.env };
  delete env[ACTOR_ENV];
  if (actor) env[ACTOR_ENV] = actor;
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(await freePort()), "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"], env,
  });
  let output = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => { output += chunk; });
  proc.stderr.on("data", (chunk) => { output += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not bind: " + output)), 20_000);
    proc.stdout.on("data", () => {
      const match = output.match(LISTENING);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    proc.on("exit", (code) => { clearTimeout(timer); reject(new Error("server exited " + code + ": " + output)); });
  });
  return { proc, port };
}

async function stop(handle) {
  if (handle.proc.exitCode !== null) return;
  handle.proc.kill("SIGTERM");
  await new Promise((resolve) => handle.proc.once("exit", resolve));
}

function call(port, path, { method = "GET", body, capability } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = { Origin: `http://127.0.0.1:${port}` };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    if (capability) headers["X-Viewer-Capability"] = capability;
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

/** One edit as the served page makes it: a fresh capability and revision. */
async function edit(port, id, fields) {
  const page = await call(port, "/");
  const token = JSON.parse(page.text.match(/window\.VIEWER_WRITE=({[^<]+})<\/script>/)[1]).token;
  const revision = (await call(port, "/api/tasks")).json().tasks.find((task) => task.id === id).revision;
  return call(port, "/api/task", { method: "POST", capability: token, body: { id, field: "title", revision, ...fields } });
}

function taskText(root, id) {
  return readFileSync(join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-"))), "utf8");
}

function historyRows(root, id) {
  const file = join(root, "history", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

test("an edit with no stated actor is refused, says how to state one, and writes nothing", async () => {
  const fx = fixture();
  const handle = await start(fx.root);
  try {
    for (const actor of [undefined, "", "   "]) {
      const before = taskText(fx.root, fx.id);
      const rowsBefore = historyRows(fx.root, fx.id).length;
      const refused = await edit(handle.port, fx.id, { value: "Edited by nobody", ...(actor === undefined ? {} : { actor }) });
      assert.equal(refused.status, 422, refused.text);
      const body = refused.json();
      assert.equal(body.refusalKind, ACTOR_REQUIRED);
      assert.equal(body.actorSource, "default");
      assert.match(body.error, /Editing as/, "the refusal must name the page's way of stating an actor");
      assert.match(body.error, /user:<name>/);
      assert.ok(body.details.some((line) => line.includes(ACTOR_ENV)), "the refusal must name the server-side ways too");
      assert.equal(taskText(fx.root, fx.id), before, "a refused edit must not touch the task");
      assert.equal(historyRows(fx.root, fx.id).length, rowsBefore, "a refused edit must not record history");
    }
    // `new` above stated no actor either, so the tree's own creation row may
    // carry the default; what may not is any row this route wrote.
    assert.ok(!historyRows(fx.root, fx.id).some((row) => row.source === "viewer" && row.actor === DEFAULT_ACTOR),
      "no edit from the page may be attributed to the default actor");
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});

test("an actor stated in the request is the one recorded", async () => {
  const fx = fixture();
  const handle = await start(fx.root);
  try {
    const accepted = await edit(handle.port, fx.id, { value: "Edited by Ada", actor: "user:ada" });
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.json().actor, "user:ada");
    assert.equal(accepted.json().actorSource, "flag");
    assert.match(taskText(fx.root, fx.id), /title: Edited by Ada/);
    const rows = historyRows(fx.root, fx.id).filter((row) => row.field === "title");
    assert.ok(rows.length > 0, "the accepted edit recorded no title row");
    assert.ok(rows.every((row) => row.actor === "user:ada" && row.source === "viewer"), JSON.stringify(rows));
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});

test("the server's environment states an actor, as it does for the CLI", async () => {
  const fx = fixture();
  const handle = await start(fx.root, "user:grace");
  try {
    const accepted = await edit(handle.port, fx.id, { value: "Edited by Grace" });
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.json().actor, "user:grace");
    assert.equal(accepted.json().actorSource, "env");
    assert.ok(historyRows(fx.root, fx.id).some((row) => row.field === "title" && row.actor === "user:grace"));
  } finally { await stop(handle); rmSync(fx.dir, { recursive: true, force: true }); }
});
