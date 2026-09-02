/**
 * A task whose stated blockers have all closed stops being invisible (TL-127).
 *
 * THE DEFECT THIS GUARDS. `blocked_by` is a FACT computable from the tree;
 * `status: blocked` is a person's DECLARATION, and `reason_required_statuses`
 * protects it so an unattended agent cannot undo a decision quietly. Nothing
 * reconciled the two, so work whose every blocker was closed sat in a queue
 * nobody serves and looked blocked while it was ready. Measured on this
 * repository on 2026-09-01: three such tasks at once.
 *
 * WHY EVERY CASE HAS ITS OPPOSITE HERE. The change widens what a dispatcher
 * hands out, so a test that only proved "the unblocked one comes out" would pass
 * just as well for a version that hands out EVERYTHING protected. Each case is
 * therefore paired with the one that must still be skipped — an open blocker,
 * and an empty `blocked_by`, which is the task waiting on something outside the
 * tree that nothing here can observe arriving.
 *
 * The statuses are the FIXTURE's own. `blocked` is this repository's word, and
 * a test asserting it would be asserting one project's config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isUnblocked, selectCandidates } from "../next-task.mjs";
import { unblockedReason } from "../take-task.mjs";
import { SCRIPTS_DIR, alignTemplate } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

/** A vocabulary of the fixture's own: `parked` is the protected status, and
 *  `shelved` is a protected status that is ALSO archived — which must never be
 *  handed out however clear its blockers are. */
const CONFIG_LINES = [
  "statuses: [queued, running, parked, shelved, shipped]",
  "archived_statuses: [shipped, shelved]",
  "dashboard_open_statuses: [queued, running, parked]",
  "in_progress_status: running",
  "reason_required_statuses: [parked, shelved]",
].join("\n");

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-unblock-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  // The generated file's own status keys are removed, not edited: a duplicate
  // key would be a different defect and would fail for the wrong reason.
  const text = readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "")
    .replace(/^archived_statuses:.*$/m, "")
    .replace(/^dashboard_open_statuses:.*$/m, "")
    .replace(/^in_progress_status:.*$/m, "")
    .replace(/^reason_required_statuses:.*$/m, "");
  writeFileSync(p, text + "\n" + CONFIG_LINES + "\n", "utf8");
  // The template still offers the DEFAULT statuses; against this vocabulary that
  // is the drift `new` refuses since TL-69, so the fixture fixes it the way a
  // user would.
  alignTemplate(dir);
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/[A-Z]+-\d+/);
  assert.ok(m, "no id in: " + r.stdout);
  return m[0];
}

function file(dir, id) {
  const name = readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-"));
  assert.ok(name, "no file for " + id);
  return join(dir, "tasks", name);
}

/** Set frontmatter fields directly: this is the state a HUMAN leaves behind, and
 *  reaching it through commands would be testing the commands instead. */
function setFields(dir, id, fields) {
  const p = file(dir, id);
  let text = readFileSync(p, "utf8");
  for (const [key, value] of Object.entries(fields)) {
    text = text.replace(new RegExp("^" + key + ":.*$", "m"), key + ": " + value);
  }
  writeFileSync(p, text, "utf8");
}

const status = (dir, id) => (readFileSync(file(dir, id), "utf8").match(/^status: *(\S+)/m) || [])[1];

function history(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// ── Through the dispatcher, which is where the defect was felt ────────────

test("a parked task whose every blocker is closed IS handed out", () => {
  const dir = repo();
  const blocker = newTask(dir, "the blocker");
  const waiting = newTask(dir, "the task that waited");
  setFields(dir, blocker, { status: "shipped" });
  setFields(dir, waiting, { status: "parked", blocked_by: "[" + blocker + "]" });

  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:worker"]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, new RegExp(waiting));
  assert.equal(status(dir, waiting), "running");
});

test("positive control: an OPEN blocker still hides the task", () => {
  const dir = repo();
  const blocker = newTask(dir, "the blocker that is not done");
  const waiting = newTask(dir, "the task that waits on it");
  setFields(dir, blocker, { status: "parked", blocked_by: "[]" });
  setFields(dir, waiting, { status: "parked", blocked_by: "[" + blocker + "]" });

  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:worker"]);
  assert.equal(r.status, 3, "the queue should be empty: " + r.stdout);
  assert.equal(status(dir, waiting), "parked");
  assert.equal(status(dir, blocker), "parked");
});

test("positive control: a parked task with an EMPTY blocked_by is never handed out", () => {
  const dir = repo();
  const external = newTask(dir, "waiting on somebody outside this repository");
  setFields(dir, external, { status: "parked", blocked_by: "[]" });

  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:worker"]);
  assert.equal(r.status, 3, "nothing in the tree can say this one is ready: " + r.stdout);
  assert.equal(status(dir, external), "parked");
});

test("a protected status that is also ARCHIVED stays closed, blockers or not", () => {
  const dir = repo();
  const blocker = newTask(dir, "closed");
  const shelved = newTask(dir, "shelved for good");
  setFields(dir, blocker, { status: "shipped" });
  setFields(dir, shelved, { status: "shelved", blocked_by: "[" + blocker + "]" });

  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:worker"]);
  assert.equal(r.status, 3, r.stdout);
  assert.equal(status(dir, shelved), "shelved");
});

test("the status change is in the history, with an actor and a reason that is not `unknown`", () => {
  const dir = repo();
  const blocker = newTask(dir, "the blocker");
  const waiting = newTask(dir, "the task that waited");
  setFields(dir, blocker, { status: "shipped" });
  setFields(dir, waiting, { status: "parked", blocked_by: "[" + blocker + "]" });

  assert.equal(run(dir, ["next", "--dir", ".", "--actor", "agent:worker"]).status, 0);

  const row = history(dir, waiting).find((e) => e.field === "status" && e.from === "parked");
  assert.ok(row, "no history row for leaving the protected status");
  assert.equal(row.to, "running");
  assert.equal(row.actor, "agent:worker");
  assert.notEqual(row.reason, "unknown");
  // The evidence, not a verdict: the reader has to be able to check it.
  assert.match(row.reason, new RegExp(blocker));
});

test("a reason the caller states wins over the one the tool would write", () => {
  const dir = repo();
  const blocker = newTask(dir, "the blocker");
  const waiting = newTask(dir, "the task that waited");
  setFields(dir, blocker, { status: "shipped" });
  setFields(dir, waiting, { status: "parked", blocked_by: "[" + blocker + "]" });

  assert.equal(run(dir, ["next", "--dir", ".", "--actor", "agent:worker", "--reason", "picked up by hand"]).status, 0);
  const row = history(dir, waiting).find((e) => e.field === "status" && e.from === "parked");
  assert.equal(row.reason, "picked up by hand");
});

test("`--status` narrows and is not widened: a caller naming statuses gets those", () => {
  const dir = repo();
  const blocker = newTask(dir, "the blocker");
  const waiting = newTask(dir, "the parked one");
  setFields(dir, blocker, { status: "shipped" });
  setFields(dir, waiting, { status: "parked", blocked_by: "[" + blocker + "]" });

  const r = run(dir, ["next", "--dir", ".", "--status", "queued", "--actor", "agent:worker"]);
  assert.equal(r.status, 3, "only `queued` was asked for: " + r.stdout);
  assert.equal(status(dir, waiting), "parked");
});

// ── The rule itself, without a subprocess ─────────────────────────────────

const CONFIG = {
  statuses: ["queued", "running", "parked", "shelved", "shipped"],
  activeStatuses: ["queued", "running", "parked"],
  archivedStatuses: ["shipped", "shelved"],
  inProgressStatus: "running",
  reasonRequiredStatuses: ["parked", "shelved"],
  priorities: ["P1", "P2"],
};

const task = (over) => ({
  id: "FX-1", status: "parked", priority: "P2", blocked_by: [], labels: [], epic: "", board: "main",
  type: "task", owner: "", role: "", elsewhere: [], ...over,
});

test("isUnblocked: the four answers, stated as a table", () => {
  const archived = new Set(CONFIG.archivedStatuses);
  const byId = new Map([["FX-9", task({ id: "FX-9", status: "shipped" })], ["FX-8", task({ id: "FX-8", status: "queued" })]]);
  const check = (over) => isUnblocked(task(over), byId, archived, CONFIG);

  assert.equal(check({ blocked_by: ["FX-9"] }), true, "closed blocker");
  assert.equal(check({ blocked_by: ["FX-8"] }), false, "open blocker");
  assert.equal(check({ blocked_by: [] }), false, "nothing named");
  assert.equal(check({ status: "queued", blocked_by: ["FX-9"] }), false, "not a protected status");
  assert.equal(check({ status: "shelved", blocked_by: ["FX-9"] }), false, "protected AND archived");
  assert.equal(check({ blocked_by: ["FX-404"] }), false, "an unknown blocker is not a closed one");
});

test("selectCandidates: an unblocked P1 outranks an untouched P2", () => {
  const records = [
    task({ id: "FX-1", status: "queued", priority: "P2", blocked_by: [] }),
    task({ id: "FX-2", status: "parked", priority: "P1", blocked_by: ["FX-9"] }),
    task({ id: "FX-9", status: "shipped", priority: "P1" }),
  ];
  const out = selectCandidates(records, CONFIG, {}, Date.now());
  assert.deepEqual(out.candidates.map((t) => t.id), ["FX-2", "FX-1"]);
  assert.deepEqual([...out.unblocked], ["FX-2"]);
  // The count of "held back by an open blocker" must not swallow it.
  assert.equal(out.skippedBlocked, 0);
});

test("selectCandidates: a task with an open blocker is counted as skipped, not hidden", () => {
  const records = [
    task({ id: "FX-1", status: "queued", blocked_by: ["FX-8"] }),
    task({ id: "FX-8", status: "queued" }),
  ];
  const out = selectCandidates(records, CONFIG, {}, Date.now());
  assert.deepEqual(out.candidates.map((t) => t.id), ["FX-8"]);
  assert.equal(out.skippedBlocked, 1);
});

test("the sentence a reader will meet a year from now", () => {
  assert.equal(
    unblockedReason("parked", ["FX-9", "FX-10"]),
    "left `parked`: every task it named is closed (FX-9, FX-10)"
  );
});
