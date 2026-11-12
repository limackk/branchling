/**
 * `follow --json` — task changes as a stream of envelopes (TL-524).
 *
 * WHAT HAS TO BE PROVED, against a real process over a real fixture tree:
 *
 *   1. one edit to a task file produces EXACTLY one `change` envelope naming
 *      the task and the field — not one per filesystem event, which an atomic
 *      write or an editor's save multiplies;
 *   2. every line is a complete envelope on its own (newline-delimited JSON);
 *   3. closing the reader's end of stdout ends the process, and so does SIGINT;
 *   4. the diff reports a body change, a creation and a deletion, and NOTHING
 *      for a rewrite that changed no field — the positive control without which
 *      "exactly one" could be satisfied by a diff that reports everything once;
 *   5. `serve` watches through the same module, so the two cannot drift.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { diffSnapshots } from "../backlog-watch.mjs";
import { FIELD_BODY } from "../task-fields.mjs";
import { SCRIPTS_DIR, isolateHome, isolateState, scriptSource } from "./_repo.mjs";

isolateHome("watch");
isolateState("watch");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SCRIPT = join(SCRIPTS_DIR, "follow-changes.mjs");

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function fixture() {
  const dir = fixtureDir(join(tmpdir(), "branchling-watch-"));
  const init = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  const created = run(dir, ["new", "--dir", "backlog", "--title", "A watched task"]);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const tasksDir = join(dir, "backlog", "tasks");
  const file = readdirSync(tasksDir).find((f) => f.startsWith(id + "-"));
  assert.ok(file, "no file for " + id);
  return { dir, id, path: join(tasksDir, file) };
}

/** A running watch, with its stdout split into parsed lines as they arrive. */
function startWatch(argv, cwd) {
  const child = spawn(process.execPath, argv, { cwd, env: { ...process.env, NO_COLOR: "1" } });
  const lines = [];
  const waiters = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 1);
      // Every line must parse ON ITS OWN — that is the whole stream contract.
      lines.push(JSON.parse(raw));
      for (const w of waiters.splice(0)) w();
    }
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += c; });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const until = async (predicate, ms, what) => {
    const deadline = Date.now() + ms;
    while (!predicate(lines)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("timed out waiting for " + what + "; lines: " + JSON.stringify(lines) + " stderr: " + stderr);
      await new Promise((r) => { waiters.push(r); setTimeout(r, Math.min(left, 100)); });
    }
  };
  return { child, lines, exited, until, stderr: () => stderr };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error("timed out: " + what)), ms); }),
  ]);
}

test("one edit produces exactly one envelope naming the task and field; closing stdout ends the process", async () => {
  const fx = fixture();
  try {
    const w = startWatch([CLI, "follow", "--json", "--heartbeat", "0.3", "--dir", "backlog"], fx.dir);
    await w.until((ls) => ls.some((l) => l.event === "ready"), 15_000, "the ready envelope");
    const ready = w.lines.find((l) => l.event === "ready");
    assert.equal(ready.schemaVersion, 1);
    assert.equal(ready.kind, "change-stream");

    const text = readFileSync(fx.path, "utf8");
    assert.match(text, /^title: .*$/m);
    writeFileSync(fx.path, text.replace(/^title: .*$/m, 'title: "A renamed task"'), "utf8");

    await w.until((ls) => ls.some((l) => l.event === "change"), 15_000, "a change envelope");
    // Long enough for a second, duplicate burst to arrive if the diff counted
    // events instead of comparing content.
    await sleep(1000);
    const changes = w.lines.filter((l) => l.event === "change");
    assert.equal(changes.length, 1, "expected exactly one change: " + JSON.stringify(changes));
    assert.equal(changes[0].kind, "change-stream");
    assert.equal(changes[0].id, fx.id);
    assert.equal(changes[0].change, "modified");
    assert.deepEqual(changes[0].fields, ["title"]);
    assert.ok(w.lines.some((l) => l.event === "heartbeat"), "no heartbeat within the window");

    // The reader goes away: the next heartbeat hits a closed pipe, and the
    // child — and the dispatcher waiting on it — must end, not linger.
    w.child.stdout.destroy();
    const { code } = await withTimeout(w.exited, 10_000, "exit after stdout closed");
    assert.equal(code, 0, w.stderr());
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// Windows has no SIGINT to deliver: kill("SIGINT") terminates the process
// outright, so the exit code is null whatever the handler would have done.
test("SIGINT stops the watch with exit 0", {
  skip: process.platform === "win32" ? "POSIX signal contract" : false,
}, async () => {
  const fx = fixture();
  try {
    const w = startWatch([SCRIPT, "--json", "--dir", "backlog"], fx.dir);
    await w.until((ls) => ls.some((l) => l.event === "ready"), 15_000, "the ready envelope");
    w.child.kill("SIGINT");
    const { code } = await withTimeout(w.exited, 10_000, "exit after SIGINT");
    assert.equal(code, 0, w.stderr());
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("--max-events ends the stream after that many changes", async () => {
  const fx = fixture();
  try {
    const w = startWatch([CLI, "follow", "--json", "--max-events", "1", "--dir", "backlog"], fx.dir);
    await w.until((ls) => ls.some((l) => l.event === "ready"), 15_000, "the ready envelope");
    const text = readFileSync(fx.path, "utf8");
    writeFileSync(fx.path, text + "\nOne more paragraph.\n", "utf8");
    const { code } = await withTimeout(w.exited, 15_000, "exit after one change");
    assert.equal(code, 0, w.stderr());
    const changes = w.lines.filter((l) => l.event === "change");
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].fields, [FIELD_BODY]);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("the diff: body, creation and deletion are reported; a rewrite that moved nothing is not", () => {
  const snap = (id, title, body, updated = "2026-11-01") => ({ meta: { id, title, updated }, body });
  const before = new Map([
    ["A-1-x.md", snap("A-1", "one", "body")],
    ["A-2-y.md", snap("A-2", "two", "body")],
    ["A-3-z.md", snap("A-3", "three", "body")],
  ]);
  const after = new Map([
    ["A-1-x.md", snap("A-1", "one", "body", "2026-11-02")],
    ["A-2-y.md", snap("A-2", "two", "a new body")],
    ["A-4-w.md", snap("A-4", "four", "body")],
  ]);
  const found = diffSnapshots(before, after, null);
  assert.deepEqual(found, [
    { id: "A-2", file: "A-2-y.md", change: "modified", fields: [FIELD_BODY] },
    { id: "A-3", file: "A-3-z.md", change: "deleted", fields: [] },
    { id: "A-4", file: "A-4-w.md", change: "created", fields: [] },
  ]);
  // Restricted to the files the watcher heard of.
  assert.deepEqual(diffSnapshots(before, after, ["A-1-x.md"]), []);
  // POSITIVE CONTROL: a moved field IS seen, so the empty answer above is a
  // judgement about `updated`, not a diff that sees nothing.
  const renamed = new Map([["A-1-x.md", snap("A-1", "uno", "body")]]);
  assert.deepEqual(diffSnapshots(before, renamed, ["A-1-x.md"]).map((c) => c.fields), [["title"]]);
});

test("serve watches through the shared module, not a copy of its own", () => {
  const src = scriptSource("serve-backlog.mjs");
  assert.match(src, /from "\.\/backlog-watch\.mjs"/);
  assert.match(src, /watchBacklog\(/);
  assert.doesNotMatch(src, /\bwatch\(\s*(TASKS_DIR|BACKLOG_DIR)/, "serve still sets up fs.watch itself");
});
