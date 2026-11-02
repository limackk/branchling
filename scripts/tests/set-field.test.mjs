/**
 * `set` and the served viewer's POST /api/task are ONE write (TL-521).
 *
 * Two identical fixtures receive the same edit, one through each path, and the
 * task files and the new history records are compared — apart from the fields
 * that name the path itself (`source`) and the moment (`id`, `ts`, `session`).
 * A refusal is proved by bytes: the task file and its history log must be
 * identical before and after, because a refusal that wrote half an edit is the
 * failure a status code cannot show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("set-field");
isolateState("set-field");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

function fixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-set-field-")));
  const root = join(dir, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8" }).status, 0);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Editable work"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return { dir, root, id: made.stdout.match(/[A-Z]+-\d+/)[0] };
}

function taskPath(root, id) {
  return join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-")));
}

function historyRows(root, id) {
  const file = join(root, "history", id + ".jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function snapshot(root, id) {
  const history = join(root, "history", id + ".jsonl");
  return {
    task: readFileSync(taskPath(root, id), "utf8"),
    history: existsSync(history) ? readFileSync(history, "utf8") : null,
  };
}

/** A record with the path and the moment taken out — what both writers must agree on. */
function comparable(row) {
  const { id: _id, ts: _ts, source: _source, session: _session, ...rest } = row;
  return rest;
}

function set(root, args) {
  return spawnSync(process.execPath, [CLI, "set", ...args, "--dir", root], { encoding: "utf8" });
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

function start(root, port) {
  const proc = spawn(process.execPath, [SERVER, "--dir", root, "--port", String(port), "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
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

async function stop(handle) {
  if (handle.proc.exitCode !== null) return;
  handle.proc.kill("SIGTERM");
  await new Promise((resolve) => handle.proc.once("exit", resolve));
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

async function serverEdit(root, id, field, value, actor, reason) {
  const handle = start(root, await freePort());
  try {
    const port = await handle.bound;
    const page = await call(port, "/");
    const cap = JSON.parse(page.text.match(/window\.VIEWER_WRITE=({[^<]+})<\/script>/)[1]);
    const tasks = (await call(port, "/api/tasks")).json().tasks;
    const revision = tasks.find((task) => task.id === id).revision;
    return await call(port, "/api/task", {
      method: "POST", capability: cap.token, origin: `http://127.0.0.1:${port}`,
      body: { id, field, value, actor, reason, revision },
    });
  } finally { await stop(handle); }
}

test("a field set through the CLI and through POST /api/task leaves the same file and record", async () => {
  const viaCli = fixture();
  const viaServer = fixture();
  try {
    assert.equal(viaCli.id, viaServer.id, "the two fixtures must name the same task");
    const id = viaCli.id;
    const before = historyRows(viaCli.root, id).length;
    const edits = [
      ["estimate", "3h", "local:owner", "sized after the spike"],
      ["labels", "", "local:owner", "no label applies yet"],
      ["title", "Edited by either path", "agent:writer", "clarify the thesis"],
    ];
    for (const [field, value, actor, reason] of edits) {
      const cli = set(viaCli.root, [id, field, value, "--actor", actor, "--reason", reason, "--json"]);
      assert.equal(cli.status, 0, cli.stderr + cli.stdout);
      const answer = JSON.parse(cli.stdout);
      assert.equal(answer.kind, "task-set");
      assert.equal(answer.ok, true);
      assert.equal(answer.field, field);

      const http = await serverEdit(viaServer.root, id, field, value, actor, reason);
      assert.equal(http.status, 200, http.text);
    }

    // Positive control: the edits really landed, so equality below is not two
    // untouched files agreeing with each other.
    const text = readFileSync(taskPath(viaCli.root, id), "utf8");
    assert.match(text, /^title: Edited by either path$/m);
    assert.match(text, /^estimate: 3h/m);
    assert.equal(text, readFileSync(taskPath(viaServer.root, id), "utf8"));

    const cliRows = historyRows(viaCli.root, id).slice(before);
    const serverRows = historyRows(viaServer.root, id).slice(before);
    assert.ok(cliRows.some((row) => row.field === "title" && row.reason === "clarify the thesis" && row.actor === "agent:writer"));
    assert.ok(cliRows.every((row) => row.source === "set"));
    assert.ok(serverRows.every((row) => row.source === "viewer"));
    assert.deepEqual(cliRows.map(comparable), serverRows.map(comparable));
  } finally {
    rmSync(viaCli.dir, { recursive: true, force: true });
    rmSync(viaServer.dir, { recursive: true, force: true });
  }
});

test("status, owner, an unknown field, a bad value and a reserved reason are refused without touching the tree", () => {
  const fx = fixture();
  try {
    const before = snapshot(fx.root, fx.id);
    const cases = [
      { args: [fx.id, "status", "done"], kind: "dedicated" },
      { args: [fx.id, "owner", "agent:someone"], kind: "dedicated" },
      { args: [fx.id, "frobnicate", "x"], kind: "usage" },
      { args: [fx.id, "title", ""], kind: "usage" },
      { args: [fx.id, "title", "Fine", "--reason", "unknown"], kind: "usage" },
      { args: [fx.id, "title", "Fine", "--actor", "nobody"], kind: "usage" },
      { args: [fx.id.replace(/\d+$/, "99999"), "title", "Fine"], kind: "not-found" },
    ];
    for (const { args, kind } of cases) {
      const result = set(fx.root, [...args, "--json"]);
      assert.equal(result.status, 2, args.join(" ") + ": " + result.stdout + result.stderr);
      const answer = JSON.parse(result.stdout);
      assert.equal(answer.kind, "task-set");
      assert.equal(answer.ok, false);
      assert.equal(answer.refusalKind, kind, args.join(" "));
      assert.deepEqual(snapshot(fx.root, fx.id), before, args.join(" ") + " touched the tree");
    }
    const human = set(fx.root, [fx.id, "status", "done"]);
    assert.equal(human.status, 2);
    assert.match(human.stderr, /take, done, handoff, release, ask/);

    const flag = set(fx.root, [fx.id, "title", "Fine", "--frobnicate"]);
    assert.equal(flag.status, 2);
    assert.match(flag.stderr, /available: /);
    assert.deepEqual(snapshot(fx.root, fx.id), before);

    // Positive control: the same tree accepts a valid write, so the refusals
    // above were decided by the input and not by an unwritable fixture.
    const ok = set(fx.root, [fx.id, "title", "Fine", "--actor", "local:owner"]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.notDeepEqual(snapshot(fx.root, fx.id), before);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});
