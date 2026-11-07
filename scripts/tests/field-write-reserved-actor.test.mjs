/**
 * A field write refuses the reserved actor `unknown` (TL-569).
 *
 * `unknown` is what the tool records for a change it OBSERVED; `isValidActor()`
 * accepts it on purpose, because history readers and `reconcile()` need it. A
 * field write is a change the tool MAKES, so recording one under `unknown`
 * with source `set` or `viewer` is a record contradicting itself. The refusal
 * lives in the shared core, `writeTaskField()`, so both of its callers are
 * exercised here: `set` as a subprocess and POST /api/task against a real
 * server.
 *
 * A refusal is proved by bytes — the task file and its history log identical
 * before and after. The positive controls matter as much: a namespaced actor
 * still writes through both paths, and `isValidActor()` still accepts
 * `unknown`, because a guard that refused every actor, or that was enforced by
 * narrowing the shared predicate, would pass the refusal cases alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACTOR_ENV } from "../actor.mjs";
import { ACTOR_UNKNOWN, isValidActor } from "../task-fields.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("field-write-reserved-actor");
isolateState("field-write-reserved-actor");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;
const NAMESPACED_FORMS = /local:<name>.*agent:<name>.*user:<name>/;

function fixture() {
  const dir = realpathSync(fixtureDir(join(tmpdir(), "branchling-reserved-actor-")));
  const root = join(dir, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8" }).status, 0);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Editable work", "--actor", "agent:fixture"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return { dir, root, id: made.stdout.match(/[A-Z]+-\d+/)[0] };
}

function taskText(root, id) {
  return readFileSync(join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-"))), "utf8");
}

function historyText(root, id) {
  const file = join(root, "history", id + ".jsonl");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function historyRows(root, id) {
  return historyText(root, id).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function snapshot(root, id) {
  return { task: taskText(root, id), history: historyText(root, id) };
}

/** `set` with no actor in the environment, so only `--actor` can name one. */
function set(root, args) {
  const env = { ...process.env };
  delete env[ACTOR_ENV];
  return spawnSync(process.execPath, [CLI, "set", "--dir", root, ...args], { encoding: "utf8", env });
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

async function start(root) {
  const env = { ...process.env };
  delete env[ACTOR_ENV];
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

/** One title edit as the served page makes it: a fresh capability and revision. */
async function edit(port, id, fields) {
  const page = await call(port, "/");
  const token = JSON.parse(page.text.match(/window\.VIEWER_WRITE=({[^<]+})<\/script>/)[1]).token;
  const revision = (await call(port, "/api/tasks")).json().tasks.find((task) => task.id === id).revision;
  return call(port, "/api/task", { method: "POST", capability: token, body: { id, field: "title", revision, ...fields } });
}

test("the shared predicate still accepts unknown, so history readers keep it", () => {
  assert.equal(ACTOR_UNKNOWN, "unknown");
  assert.equal(isValidActor(ACTOR_UNKNOWN), true);
});

test("set --actor unknown is refused, names the namespaced forms, and writes nothing", () => {
  const fx = fixture();
  const before = snapshot(fx.root, fx.id);
  const human = set(fx.root, [fx.id, "title", "Edited by nobody", "--actor", ACTOR_UNKNOWN]);
  assert.equal(human.status, 2, human.stdout + human.stderr);
  assert.match(human.stderr, /reserved/);
  assert.match(human.stderr, NAMESPACED_FORMS);
  assert.equal(human.stdout, "");
  assert.deepEqual(snapshot(fx.root, fx.id), before, "a refused set must not touch the task or its history");

  const json = set(fx.root, [fx.id, "title", "Edited by nobody", "--actor", ACTOR_UNKNOWN, "--json"]);
  assert.equal(json.status, 2, json.stdout + json.stderr);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, false);
  assert.match(body.refusal, /reserved/);
  assert.match(body.refusal, NAMESPACED_FORMS);
  assert.deepEqual(snapshot(fx.root, fx.id), before, "a refused set --json must not touch the task or its history");
});

test("set with a namespaced actor still writes and records that actor", () => {
  const fx = fixture();
  const accepted = set(fx.root, [fx.id, "title", "Edited by Ada", "--actor", "local:ada"]);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  assert.match(taskText(fx.root, fx.id), /title: "?Edited by Ada"?/);
  const rows = historyRows(fx.root, fx.id).filter((row) => row.field === "title" && row.source === "set");
  assert.ok(rows.length > 0, "the accepted set recorded no title row");
  assert.ok(rows.every((row) => row.actor === "local:ada"), JSON.stringify(rows));
});

test("POST /api/task with actor unknown is refused and writes nothing; a namespaced actor still writes", async () => {
  const fx = fixture();
  const handle = await start(fx.root);
  try {
    const before = snapshot(fx.root, fx.id);
    const refused = await edit(handle.port, fx.id, { value: "Edited by nobody", actor: ACTOR_UNKNOWN });
    assert.equal(refused.status, 400, refused.text);
    assert.match(refused.json().error, /reserved/);
    assert.match(refused.json().error, NAMESPACED_FORMS);
    assert.deepEqual(snapshot(fx.root, fx.id), before, "a refused edit must not touch the task or its history");
    assert.ok(!historyRows(fx.root, fx.id).some((row) => row.actor === ACTOR_UNKNOWN && row.source === "viewer"),
      "no edit from the page may be recorded under the reserved actor");

    const accepted = await edit(handle.port, fx.id, { value: "Edited by Ada", actor: "user:ada" });
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.json().actor, "user:ada");
    assert.match(taskText(fx.root, fx.id), /title: "?Edited by Ada"?/);
    const rows = historyRows(fx.root, fx.id).filter((row) => row.field === "title" && row.source === "viewer");
    assert.ok(rows.length > 0, "the accepted edit recorded no title row");
    assert.ok(rows.every((row) => row.actor === "user:ada"), JSON.stringify(rows));
  } finally { await stop(handle); }
});
