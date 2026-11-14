/**
 * `done` with no terminal parks a task in `awaiting_vouch_status` (TL-699).
 *
 * The defect: a loop supervisor ran `done` on a task whose contract held a
 * `manual:` entry. With no terminal the refusal offered two ways on, and both
 * vouch — typing `confirm`, or `--confirm-manual` — which an agent must not do
 * for a person. The task stayed `in_progress`, held its plan wave shut, and was
 * moved by hand. `run` already parked such a task (TL-212); `done` did not.
 *
 * `run` is called in-process with an injected terminal and answer, the same
 * way `vouch-stated-actor.test.mjs` does: a real terminal cannot be attached
 * portably. The fixture declares its OWN vocabulary — `awaiting_vouch` is this
 * fixture's word, not a fact about any project.
 *
 * Positive controls: a person at a terminal who types `confirm` still closes
 * the task under the same configuration, and `--confirm-manual` still closes
 * it, so the park cannot be green by swallowing every manual entry.
 *
 * `--json` is the one case started as a child process: its answer is written
 * to file descriptor 1 directly, past the console this file intercepts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, isolateState, plainOutput, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("done-awaiting-vouch");
isolateState("done-awaiting-vouch");
plainOutput();

import { HOME_ENV } from "../home.mjs";
import { STATE_DIR_ENV } from "../lock.mjs";
import { EXIT_AWAITING_VOUCH, run } from "../done-task.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const VOUCH = "awaiting_vouch";
const ACTOR = "agent:supervisor";

/** A task whose contract runs a command, asks a person, then runs another. The
 *  second command leaves a marker, so "the rest of the contract ran" is read
 *  from the disk rather than from the tool's own report. */
function taskText(lastCommand) {
  return [
    "---",
    "id: TASK-1",
    'title: "T"',
    "type: task",
    "labels: []",
    "board: main",
    'epic: ""',
    "priority: P1",
    "status: in_progress",
    "owner: " + ACTOR,
    "estimate: 2h",
    "confidence: high",
    "created: 2026-09-01",
    "updated: 2026-09-01",
    "blocked_by: []",
    "blocks: []",
    "verification:",
    "  - id: first",
    '    bash: "true"',
    "  - id: eyeballed",
    '    manual: "somebody looked at it"',
    "  - id: last",
    "    bash: " + JSON.stringify(lastCommand),
    "---",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] A. [proof: first]",
    "- [ ] B. [proof: eyeballed]",
    "- [ ] C. [proof: last]",
    "",
  ].join("\n");
}

function fixture({ declareVouch, lastCommand }) {
  const dir = fixtureDir(join(tmpdir(), "branchling-done-vouch-"));
  // An absolute marker: the contract runs from the repository root, not from here.
  if (lastCommand === undefined) lastCommand = "touch " + JSON.stringify(join(dir, "ran-last"));
  const backlog = join(dir, "backlog");
  mkdirSync(join(backlog, "tasks"), { recursive: true });
  writeFileSync(join(backlog, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(backlog, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(backlog, "config.yaml"),
    'task_id_prefix: "TASK"\n' +
    "statuses: [pending, in_progress, " + VOUCH + ", blocked, done, cancelled]\n" +
    (declareVouch ? "awaiting_vouch_status: " + VOUCH + "\n" : ""), "utf8");
  writeFileSync(join(backlog, "tasks", "TASK-1-x.md"), taskText(lastCommand), "utf8");
  const home = join(dir, "home");
  mkdirSync(home);
  return { dir, backlog, env: { [HOME_ENV]: home } };
}

function history(backlog) {
  const file = join(backlog, "history", "TASK-1.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const taskOf = (backlog) => readFileSync(join(backlog, "tasks", "TASK-1-x.md"), "utf8");
const statusOf = (backlog) => (taskOf(backlog).match(/^status: (\S+)/m) || [])[1];

async function done(args, io) {
  const out = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(" "));
  console.error = (...a) => out.push(a.join(" "));
  try {
    const code = await run(args, io);
    return { code, out: out.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function withFixture(opts, fn) {
  const f = fixture(opts);
  return Promise.resolve(fn(f)).finally(() => rmSync(f.dir, { recursive: true, force: true }));
}

const noTerminal = (env) => ({ env, terminal: false, ask: () => null });

test("configured: no terminal parks the task in the awaiting-vouch status, recorded", () =>
  withFixture({ declareVouch: true }, async ({ dir, backlog, env }) => {
    const r = await done(["TASK-1", "--dir", backlog, "--actor", ACTOR], noTerminal(env));
    assert.equal(r.code, EXIT_AWAITING_VOUCH, r.out);
    assert.notEqual(EXIT_AWAITING_VOUCH, 0);
    assert.notEqual(EXIT_AWAITING_VOUCH, 1);
    assert.notEqual(EXIT_AWAITING_VOUCH, 2);
    assert.equal(statusOf(backlog), VOUCH);
    assert.match(r.out, new RegExp("parked as `" + VOUCH + "`"));
    // The entry AFTER the manual one ran: the park claims every automatic entry passed.
    assert.ok(existsSync(join(dir, "ran-last")), "the contract stopped at the manual entry");
    // Nothing was closed, so nothing was proved by a person.
    assert.doesNotMatch(taskOf(backlog), /- \[x\]/, "a criterion was ticked on a task that is not closed");

    const rows = history(backlog);
    const move = rows.find((l) => l.field === "status");
    assert.ok(move, JSON.stringify(rows));
    assert.equal(move.from, "in_progress");
    assert.equal(move.to, VOUCH);
    assert.equal(move.source, "done");
    assert.equal(move.actor, ACTOR);
    assert.equal(move.park, true);
    assert.match(move.reason, /every automatic entry passed \(2\)/);
    assert.match(move.reason, /somebody looked at it/);
    assert.equal(rows.filter((l) => l.field === "__verified__").length, 0, "nobody vouched");
    const waiting = rows.filter((l) => l.field === "__unverified__");
    assert.equal(waiting.length, 1, JSON.stringify(rows));
    assert.equal(waiting[0].refusal, "no-terminal");
  }));

test("configured: a failing automatic entry after the manual one parks nothing", () =>
  withFixture({ declareVouch: true, lastCommand: "exit 1" }, async ({ backlog, env }) => {
    const r = await done(["TASK-1", "--dir", backlog, "--actor", ACTOR], noTerminal(env));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /verification failed/, "it stopped before the failing entry ran");
    assert.equal(statusOf(backlog), "in_progress");
    assert.equal(history(backlog).filter((l) => l.field === "status").length, 0);
  }));

test("configured: `--dry-run` reports the park and writes nothing", () =>
  withFixture({ declareVouch: true }, async ({ backlog, env }) => {
    const before = taskOf(backlog);
    const r = await done(["TASK-1", "--dir", backlog, "--actor", ACTOR, "--dry-run"], noTerminal(env));
    assert.equal(r.code, EXIT_AWAITING_VOUCH, r.out);
    assert.match(r.out, new RegExp("would set: status in_progress → " + VOUCH));
    assert.equal(taskOf(backlog), before);
    assert.deepEqual(history(backlog), []);
  }));

// The park writes the task file and THEN the history, so a history that
// cannot be written has to undo the park (TL-710). A regular file where the
// state directory should be makes the history's mutex fail; the variable is
// read at the write, so it is swapped around this one run and put back. The
// path is the evidence that the details carry the error itself — the contract
// prints `<dir>/ran-last`, never `<dir>/state-file`.
test("configured: a park whose history cannot be written is refused, and the task restored", () =>
  withFixture({ declareVouch: true }, async ({ dir, backlog, env }) => {
    const stateFile = join(dir, "state-file");
    writeFileSync(stateFile, "not a directory", "utf8");
    const before = taskOf(backlog);
    const saved = process.env[STATE_DIR_ENV];
    process.env[STATE_DIR_ENV] = stateFile;
    let r;
    try {
      r = await done(["TASK-1", "--dir", backlog, "--actor", ACTOR], noTerminal(env));
    } finally {
      process.env[STATE_DIR_ENV] = saved;
    }
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /TASK-1: history could not be recorded; the task was restored/);
    assert.ok(r.out.split("\n").some((l) => l.includes(stateFile)),
      "the refusal does not name the error that stopped the history write:\n" + r.out);
    assert.doesNotMatch(r.out, /parked as/);
    assert.equal(taskOf(backlog), before, "the park was not undone");
    assert.deepEqual(history(backlog), [], "an unanswered entry was recorded for a park that did not happen");
  }));

// What `--json` answers under `awaiting_vouch_status` (TL-710). It does NOT
// park: `--json` refuses at the first `manual:` entry, before a terminal is
// looked for, so the park has no JSON answer of its own (TL-736 removed the
// two it carried, which could never be written). This refusal is what `run`
// parks on — `run-loop.mjs` maps `manual-needs-person` to the awaiting-vouch
// status itself (TL-212) — so it is the answer a program gets, and the one
// asserted here.
test("configured: `--json` answers with the refusal `run` parks on, and parks nothing", () =>
  withFixture({ declareVouch: true }, ({ backlog, env }) => {
    const r = spawnSync(process.execPath, [CLI, "done", "TASK-1", "--dir", backlog, "--actor", ACTOR, "--json"], {
      encoding: "utf8",
      input: "",
      env: { ...process.env, ...env },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.kind, "verification-run");
    assert.equal(parsed.refusalKind, "manual-needs-person");
    assert.equal(parsed.closed, false);
    assert.equal(Object.hasOwn(parsed, "awaitingVouch"), false, "a refusal claims a park");
    assert.deepEqual(parsed.entries.map((e) => [e.id, e.ok]), [["first", true], ["eyeballed", false]]);
    assert.equal(statusOf(backlog), "in_progress");
  }));

test("not configured: the refusal stands, and names leaving it for a person", () =>
  withFixture({ declareVouch: false }, async ({ backlog, env }) => {
    const r = await done(["TASK-1", "--dir", backlog, "--actor", ACTOR], noTerminal(env));
    assert.equal(r.code, 1, r.out);
    assert.equal(statusOf(backlog), "in_progress");
    assert.match(r.out, /there is no terminal here/);
    assert.match(r.out, /Three ways on/);
    assert.match(r.out, /leave it for a person/);
    assert.match(r.out, /plan`/);
    assert.match(r.out, /awaiting_vouch_status/);
  }));

test("POSITIVE CONTROL: a person at a terminal still closes it under the same config", () =>
  withFixture({ declareVouch: true }, async ({ backlog, env }) => {
    const r = await done(["TASK-1", "--dir", backlog, "--actor", "user:alice"], { env, terminal: true, ask: () => "confirm" });
    assert.equal(r.code, 0, r.out);
    assert.equal(statusOf(backlog), "done");
  }));

test("POSITIVE CONTROL: `--confirm-manual` with no terminal still closes it", () =>
  withFixture({ declareVouch: true }, async ({ backlog, env }) => {
    const r = await done(["TASK-1", "--dir", backlog, "--actor", "user:alice", "--confirm-manual"], noTerminal(env));
    assert.equal(r.code, 0, r.out);
    assert.equal(statusOf(backlog), "done");
  }));
