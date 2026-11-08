/**
 * The served viewer cannot skip the commands that own `status` and `owner`
 * (TL-563).
 *
 * `set` refuses both fields because dedicated commands own them: `done` runs
 * the verification, `take` reserves, `handoff` and `release` record the
 * exchange, `ask` records the question. POST /api/task called the same core
 * WITHOUT that refusal, so a served page could archive a task with no
 * verification at all. The decision recorded in the task is that the route
 * refuses exactly what `set` refuses, and that the page offers no editor for a
 * field the route refuses.
 *
 * WHAT IS ASSERTED, AND WHERE IT COMES FROM.
 *
 *   The route — real requests against a real server over a fixture tree, with
 *   a valid capability and a current revision, so the only thing that can
 *   refuse is the field. The refused set is read from `DEDICATED_FIELDS`, not
 *   listed here: a field added there must be refused on the route too, which
 *   is the drift the shared core exists to prevent. A refusal is proved by
 *   BYTES — the task file and its history log identical before and after.
 *
 *   The page — the field row the served page renders, executed rather than
 *   matched: `metaRowHtml` and the page functions it calls are evaluated in a
 *   context that holds the inlined `task-fields.mjs`, with editing switched on.
 *   A dedicated row must carry no edit affordance and must name the commands
 *   that change it. The rule belongs in `task-fields.mjs` (the inlined module
 *   the server's specs also come from), which is why that module is the one
 *   piece of the page this context loads whole.
 *
 * Positive controls on both sides: `priority` is still written by the route and
 * still offered an editor by the page, so neither refusal is a server or a
 * page that has stopped editing altogether.
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
import vm from "node:vm";

import { DEDICATED_FIELDS } from "../field-write.mjs";
import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("viewer-dedicated-fields");
isolateState("viewer-dedicated-fields");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

/** A value the fixture's task does not already hold, per dedicated field. */
const ATTEMPTS = {
  status: ["done", "blocked", "in_progress"],
  owner: ["agent:someone-else"],
};

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
  const dir = realpathSync(fixtureDir(join(tmpdir(), "branchling-viewer-dedicated-")));
  const root = join(dir, "backlog");
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", root, "--no-example"], { encoding: "utf8" }).status, 0);
  const made = spawnSync(process.execPath, [CLI, "new", "--dir", root, "--title", "Work the viewer may not close"], { encoding: "utf8" });
  assert.equal(made.status, 0, made.stderr);
  return { dir, root, id: made.stdout.match(/[A-Z]+-\d+/)[0] };
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

function taskPath(root, id) {
  return join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-")));
}

function snapshot(root, id) {
  const history = join(root, "history", id + ".jsonl");
  return {
    task: readFileSync(taskPath(root, id), "utf8"),
    history: existsSync(history) ? readFileSync(history, "utf8") : null,
  };
}

/** A fresh capability and the task's current revision — everything a write needs. */
async function credentials(port, id) {
  const page = await call(port, "/");
  assert.equal(page.status, 200);
  const match = page.text.match(/window\.VIEWER_WRITE=({[^<]+})<\/script>/);
  assert.ok(match, "the served page did not receive a write capability");
  const tasks = (await call(port, "/api/tasks")).json().tasks;
  const task = tasks.find((candidate) => candidate.id === id);
  assert.ok(task?.revision, "the read API did not expose an optimistic revision");
  return { token: JSON.parse(match[1]).token, task, page: page.text };
}

async function post(port, id, field, value, reason) {
  const { token, task } = await credentials(port, id);
  return call(port, "/api/task", {
    method: "POST", capability: token, origin: `http://127.0.0.1:${port}`,
    body: { id, field, value, actor: "user:reader", reason, revision: task.revision },
  });
}

test("the route refuses every field a dedicated command owns, and writes nothing", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort());
  try {
    const port = await handle.bound;
    const fields = Object.keys(DEDICATED_FIELDS);
    assert.ok(fields.includes("status") && fields.includes("owner"), "the dedicated set lost a field this task is about");
    for (const field of fields) {
      const values = ATTEMPTS[field];
      assert.ok(values, "no attempted value for dedicated field `" + field + "` — add one to ATTEMPTS");
      for (const value of values) {
        const before = snapshot(fx.root, fx.id);
        // A stated reason, so a reason-required status is refused for the
        // field and not for the missing sentence.
        const answer = await post(port, fx.id, field, value, "the viewer tried to change it");
        const label = field + " → " + value;
        assert.equal(answer.status, 400, label + ": " + answer.text);
        assert.match(answer.json().error, new RegExp("`" + field + "` has dedicated commands"), label);
        assert.equal("needsReason" in answer.json(), false, label + ": the route answers with a reason flag (TL-566)");
        assert.deepEqual(snapshot(fx.root, fx.id), before, label + " touched the tree");
      }
    }
    assert.doesNotMatch(readFileSync(taskPath(fx.root, fx.id), "utf8"), /^status: done\b/m);

    // Positive control: the same server, credentials and task accept a plain
    // field, so the refusals above were decided by the field.
    const current = (await credentials(port, fx.id)).task.priority;
    const vocabulary = JSON.parse(spawnSync(process.execPath, [CLI, "vocabulary", "--dir", fx.root, "--json"], { encoding: "utf8" }).stdout);
    const priorities = (vocabulary.priorities || []).map((p) => (typeof p === "string" ? p : p.value || p.name));
    const other = priorities.find((p) => p && p !== current);
    assert.ok(other, "the fixture declares a single priority; the control needs two");
    const before = snapshot(fx.root, fx.id);
    const accepted = await post(port, fx.id, "priority", other, "");
    assert.equal(accepted.status, 200, accepted.text);
    assert.notDeepEqual(snapshot(fx.root, fx.id), before);
    assert.match(readFileSync(taskPath(fx.root, fx.id), "utf8"), new RegExp("^priority: " + other + "\\b", "m"));
  } finally {
    await stop(handle);
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The page ────────────────────────────────────────────────────────────

/** The source of one top-level function of the page, braces matched. */
function functionSource(source, name) {
  const start = source.search(new RegExp("(^|\\n)\\s*function " + name.replace(/\$/g, "\\$") + "\\("));
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1).trim();
  }
  return null;
}

function stripLiterals(body) {
  return body
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, "");
}

/** `name` and every page function it reaches, as sources — not those `skip` already defines. */
function closure(page, name, skip) {
  const declared = new Set([...page.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const seen = new Set();
  const out = [];
  const visit = (fn) => {
    if (seen.has(fn) || skip.has(fn)) return;
    seen.add(fn);
    const source = functionSource(page, fn);
    if (!source) return;
    out.push(source);
    for (const m of stripLiterals(source.slice(source.indexOf("{"))).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (declared.has(m[1])) visit(m[1]);
    }
  };
  visit(name);
  return out;
}

/** `task-fields.mjs` as the page inlines it. */
function inlinedTaskFields() {
  return readFileSync(join(SCRIPTS_DIR, "task-fields.mjs"), "utf8")
    .replace(/^import [^;]*;\n/gm, "")
    .replace(/^export /gm, "");
}

/** What the page renders for each field row of `task`, with editing switched on. */
function renderedRows(page, task, specs) {
  const module = inlinedTaskFields();
  const own = new Set([...module.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const script = module + "\n" + closure(page, "metaRowHtml", own).join("\n") +
    "\nglobalThis.__rows = __specs.map(function (spec) { return [spec.key, metaRowHtml(__task, spec)]; });";
  const context = vm.createContext({
    __task: task, __specs: specs,
    CAN_EDIT: true, SERVER_MODE: true,
    state: { editing: null, actor: "user:reader" },
    window: { VIEWER_WRITE: { token: "test" } },
  });
  vm.runInContext(script, context);
  return Object.fromEntries(context.__rows);
}

const AFFORDANCE = /startEdit\(|is-editable|edit-pen/;

test("the served page offers no editor for a field the route refuses, and names its commands", async () => {
  const fx = fixture();
  const handle = start(fx.root, await freePort());
  try {
    const port = await handle.bound;
    const { task, page } = await credentials(port, fx.id);
    const { buildFieldSpecs } = await import("../task-fields.mjs");
    const { loadConfig } = await import("../config.mjs");
    const specs = buildFieldSpecs(loadConfig(fx.root));
    assert.ok(specs.some((spec) => spec.key === "priority"), "the control field is missing from the specs");
    const rows = renderedRows(page, task, specs);

    for (const [field, commands] of Object.entries(DEDICATED_FIELDS)) {
      const row = rows[field];
      assert.ok(row, "the page renders no row for `" + field + "`; the value must still be shown");
      assert.doesNotMatch(row, AFFORDANCE, "`" + field + "` is offered an editor the route refuses");
      for (const command of commands) {
        assert.match(row, new RegExp("\\b" + command + "\\b"), "`" + field + "` row does not name `" + command + "`");
      }
    }
    // Positive control: editing is on in this context, so the absence above
    // is the rule and not a page that renders no editor for anything.
    assert.match(rows.priority, AFFORDANCE, "the control field lost its editor");
  } finally {
    await stop(handle);
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
