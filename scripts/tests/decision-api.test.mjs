/**
 * Answering a question by picking a row, from the page (TL-205).
 *
 * The decision panel renders the menu a question was asked with (TL-204) and
 * lets a reader take one of the rows. That click is a WRITE to an append-only
 * log, and it reaches `decideTask` through `/api/decision` — the same function
 * `branchling decide --choose <n>` calls, which is the whole reason the page is
 * allowed to offer the menu at all.
 *
 * WHAT IS AT RISK, and why each case is paired with its opposite:
 *
 *   1. THE WRONG ANSWER RECORDED. The page sends a NUMBER; the server resolves
 *      it against the event the question was asked in. A page that sent the
 *      text it had rendered would be a second opinion about what option 2 says.
 *      The control is a row that is NOT the recommended one, so an off-by-one
 *      or a "follow the recommendation" shortcut cannot pass.
 *   2. AN ANSWER TO A QUESTION NOBODY ASKED. One task can carry two open
 *      questions, so `choose` without `resolves` must be refused rather than
 *      guessed — and the refusal has to happen before anything is written.
 *   3. TWO ANSWERS IN ONE FIELD. `choose` and `reason` both say what was
 *      decided. The command refuses the pair; the page's write path may not be
 *      the softer of the two.
 *
 * The statuses are whatever `init` writes: this project's words are not the
 * tool's contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("decision-api");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SERVER = join(SCRIPTS_DIR, "serve-backlog.mjs");
const LISTENING = /serve: http:\/\/127\.0\.0\.1:(\d+)\//;

const OPTIONS = [
  "keep it in config.yaml — the project decides how long its own log lives",
  "put it in the user layer — it is a machine's disk, not the project's contract",
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

function run(args, dir) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--dir", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(r.status, 0, args.join(" ") + " did not pass: " + r.stderr + r.stdout);
  return r.stdout;
}

/** A backlog holding ONE task with ONE open question carrying a menu. */
function makeBacklog() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "branchling-decision-api-")));
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(init.status, 0, "init did not pass: " + init.stderr);
  const id = "TASK-1";
  run(["ask", id, "--actor", "agent:worker",
    "--question", "Where does the retention window belong?",
    "--option", OPTIONS[0], "--option", OPTIONS[1], "--recommend", "1"], dir);
  const log = readFileSync(join(dir, "history", id + ".jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l));
  const question = log.find((e) => e.field === "__comment__");
  assert.ok(question, "the fixture has no question to answer");
  assert.deepEqual(question.options, OPTIONS, "the fixture's menu is not what ask wrote");
  return { dir, id, eventId: question.id };
}

function startServer(dir, port) {
  const proc = spawn(
    process.execPath,
    [SERVER, "--dir", dir, "--port", String(port), "--no-open"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let out = "";
  let err = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });
  const bound = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the server did not report a port in 20s\n" + out + err)),
      20_000
    );
    const check = () => {
      const m = out.match(LISTENING);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", check);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("the server exited (" + code + ") instead of listening\n" + out + err));
    });
    check();
  });
  return { proc, bound };
}

function stop(handle) {
  if (!handle || handle.proc.exitCode !== null || handle.proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    handle.proc.on("exit", () => resolve());
    handle.proc.kill("SIGKILL");
  });
}

function post(port, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1", port, path: "/api/decision", method: "POST", timeout: 5000,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { text += c; });
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(text); } catch { /* the status is the assertion */ }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, json: null, text: "timeout" }); });
    req.on("error", (e) => resolve({ status: 0, json: null, text: String(e) }));
    req.end(payload);
  });
}

const decisions = (dir, id) =>
  readFileSync(join(dir, "history", id + ".jsonl"), "utf8")
    .trim().split("\n").map((l) => JSON.parse(l))
    .filter((e) => e.field === "__decision__");

test("picking a menu row records that option's TEXT, and which row it was", async () => {
  const { dir, id, eventId } = makeBacklog();
  const port = await freePort();
  let server;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;
    // ROW 2, NOT THE RECOMMENDED ONE. Option 1 is what `ask` recommended, so a
    // path that answered with the recommendation instead of the choice — or
    // that was off by one — would look correct against row 1.
    const res = await post(bound, { id, resolves: eventId, choose: 2, actor: "user:kim" });
    assert.equal(res.status, 200, res.text);
    const recorded = decisions(dir, id);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].to, OPTIONS[1]);
    assert.equal(recorded[0].chose, 2);
    assert.equal(recorded[0].resolves, eventId);
    assert.equal(recorded[0].actor, "user:kim");
  } finally {
    await stop(server);
  }
});

test("a free-text answer still works, and records no row", async () => {
  // THE POSITIVE CONTROL for the branch above: `choose` was added beside
  // `reason`, not in front of it. An answer that is not on the menu is the case
  // TL-204 kept `--reason` for, and the page's fallback input is how it arrives.
  const { dir, id, eventId } = makeBacklog();
  const port = await freePort();
  let server;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;
    const res = await post(bound, {
      id, resolves: eventId, reason: "neither — the window is not ours to choose", actor: "user:kim",
    });
    assert.equal(res.status, 200, res.text);
    const recorded = decisions(dir, id);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].to, "neither — the window is not ours to choose");
    assert.equal(recorded[0].chose, undefined);
  } finally {
    await stop(server);
  }
});

test("a row number with no question to index is refused, and writes nothing", async () => {
  const { dir, id } = makeBacklog();
  const port = await freePort();
  let server;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;
    const res = await post(bound, { id, choose: 1, actor: "user:kim" });
    assert.equal(res.status, 400, res.text);
    assert.match(res.json.error, /resolves/);
    assert.deepEqual(decisions(dir, id), []);
  } finally {
    await stop(server);
  }
});

test("a row number AND a typed answer are two answers for one field, and are refused", async () => {
  const { dir, id, eventId } = makeBacklog();
  const port = await freePort();
  let server;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;
    const res = await post(bound, {
      id, resolves: eventId, choose: 1, reason: "and also this", actor: "user:kim",
    });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(decisions(dir, id), []);
  } finally {
    await stop(server);
  }
});

test("a row number that is not a row is refused — 0, a fraction, a word, out of range", async () => {
  const { dir, id, eventId } = makeBacklog();
  const port = await freePort();
  let server;
  try {
    server = startServer(dir, port);
    const bound = await server.bound;
    for (const bad of [0, -1, 1.5, "two", null]) {
      const res = await post(bound, { id, resolves: eventId, choose: bad, actor: "user:kim" });
      // `null` means "no row chosen", which then wants a reason; every other
      // value is a malformed row. Both are refusals, and neither may write.
      assert.equal(res.status, 400, "choose " + String(bad) + ": " + res.text);
    }
    // Out of range is refused by `decideTask`, which is the only code that has
    // read the menu — and it says how many rows there were.
    const over = await post(bound, { id, resolves: eventId, choose: 3, actor: "user:kim" });
    assert.equal(over.status, 409, over.text);
    assert.deepEqual(decisions(dir, id), []);
    // …AND THE CONTROL: a row that does exist still goes through, so the cases
    // above are refusing the value and not the whole path.
    const ok = await post(bound, { id, resolves: eventId, choose: 1, actor: "user:kim" });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(decisions(dir, id).length, 1);
  } finally {
    await stop(server);
  }
});
