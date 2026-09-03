/**
 * A filter value outside the vocabulary FAILS (TL-161).
 *
 * WHY THIS IS NOT PEDANTRY. `query` has always refused an unknown FLAG, with a
 * reason written in its own header: zero results caused by a typo read like an
 * answer. The same sentence was true one level down and was not applied there.
 * `query --status in-progress` — a hyphen where this project's vocabulary has
 * an underscore — replied "0 matching tasks", which is not a lie and is exactly
 * the problem: it is indistinguishable from "there is nothing like that".
 *
 * AND IT IS WORSE IN THE DISPATCHER. `next` answers exit 3, "nothing to take",
 * which the loop protocol in `instructions autonomous-loop` treats as a
 * legitimate empty queue and ends on. A typo there does not produce a wrong
 * answer, it produces a queue that looks finished.
 *
 * EVERY VOCABULARY HERE IS THE FIXTURE'S OWN. Asserting this repository's
 * statuses would be asserting another project's values — they are data, not the
 * tool's contract — so each case declares what it then measures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unknownFilterValues } from "../task-select.mjs";
import { loadConfig } from "../config.mjs";
import { alignTemplate, isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("query-vocabulary");


const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** A vocabulary of two statuses, and the three other keys that speak about
 *  statuses — a configuration that renames one and not the others is
 *  inconsistent, and `loadConfig` says so rather than guessing. */
const OWN_STATUSES = [
  "statuses: [open, shipped]",
  "archived_statuses: [shipped]",
  "dashboard_open_statuses: [open]",
  "reason_required_statuses: [shipped]",
].join("\n");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") },
  });
}

/** A co-located backlog whose vocabulary is its own, not this repository's. */
function repo(configLines) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-query-vocab-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  if (configLines) {
    const p = join(dir, "config.yaml");
    writeFileSync(p, readFileSync(p, "utf8") + "\n" + configLines + "\n", "utf8");
    alignTemplate(dir);
  }
  return dir;
}

function newTask(dir, args) {
  const r = run(dir, ["new", "--dir", "."].concat(args));
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

// ── the refusal ───────────────────────────────────────────────────────────

test("a status outside the vocabulary is refused, and the vocabulary is named", () => {
  const dir = repo(OWN_STATUSES);
  const r = run(dir, ["query", "--dir", ".", "--status", "opne"]);
  assert.equal(r.status, 2, "a typo must not answer");
  assert.match(r.stderr, /`opne` is not an allowed value for the field `status`/);
  // The permitted values are the FIXTURE's, which is the whole point: a message
  // listing this repository's statuses would be the tool answering about itself.
  assert.match(r.stderr, /open \| shipped/);
});

test("the refusal says that --status is also how the archive is searched", () => {
  // A refusal on the one flag that lifts the active-only default would
  // otherwise read as the archive being closed off.
  const dir = repo();
  const r = run(dir, ["query", "--dir", ".", "--status", "nope"]);
  assert.match(r.stderr, /also how you search the archive/);
});

test("every axis with a declared vocabulary is checked, not only the status", () => {
  const dir = repo();
  for (const [flag, value] of [["--priority", "P9"], ["--type", "epic"], ["--board", "nowhere"]]) {
    const r = run(dir, ["query", "--dir", ".", flag, value]);
    assert.equal(r.status, 2, flag + " " + value + " was accepted");
    assert.match(r.stderr, new RegExp("`" + value + "` is not an allowed value"));
  }
});

test("a closed label vocabulary is checked; an open one has nothing to be outside of", () => {
  const closed = repo("labels: [ops, docs]\nlabels_closed: true\n");
  assert.equal(run(closed, ["query", "--dir", ".", "--label", "opz"]).status, 2);
  assert.equal(run(closed, ["query", "--dir", ".", "--label", "ops"]).status, 0);

  // The default vocabulary is open: any word is a label somebody may add, so
  // refusing one would refuse a question the project allows.
  const open = repo();
  assert.equal(run(open, ["query", "--dir", ".", "--label", "anything"]).status, 0);
});

// ── the controls: what must still work ────────────────────────────────────

test("POSITIVE CONTROL: a value inside the vocabulary answers, including with zero", () => {
  // Without this the refusal would be indistinguishable from a command that
  // refuses everything.
  const dir = repo(OWN_STATUSES);
  newTask(dir, ["--title", "One thing"]);

  const some = run(dir, ["query", "--dir", ".", "--status", "open", "--count"]);
  assert.equal(some.status, 0, some.stderr);
  assert.equal(some.stdout.trim(), "1");

  const none = run(dir, ["query", "--dir", ".", "--status", "shipped", "--count"]);
  assert.equal(none.status, 0, none.stderr);
  assert.equal(none.stdout.trim(), "0", "zero is an answer when the value is real");
});

test("`--tasks <dir>` has no configuration, so it has nothing to check against", () => {
  // It bypasses the backlog root entirely. Refusing every value there would
  // break the one route that deliberately works without a project.
  const dir = repo();
  newTask(dir, ["--title", "Another thing"]);
  const r = run(dir, ["query", "--tasks", join(dir, "tasks"), "--status", "whatever", "--count"]);
  assert.equal(r.status, 0, r.stderr);
});

test("an empty --role or --executor is a QUESTION, not a typo", () => {
  // "What is open to anybody" and "what any species may take". The empty string
  // is a value a task can carry, so it passes whatever the vocabulary says.
  const dir = repo("roles: [analyst]\n");
  assert.equal(run(dir, ["query", "--dir", ".", "--role", ""]).status, 0);
  assert.equal(run(dir, ["query", "--dir", ".", "--executor", ""]).status, 0);
  assert.equal(run(dir, ["query", "--dir", ".", "--role", "analyzt"]).status, 2);
});

// ── the dispatcher gets the same rule ─────────────────────────────────────

test("`next` refuses a typo instead of reporting an empty queue", () => {
  // The failure this guards against: exit 3 is what a loop stops on.
  const dir = repo();
  newTask(dir, ["--title", "Work to be found"]);
  const r = run(dir, ["next", "--dir", ".", "--actor", "agent:test", "--priority", "P9"]);
  assert.equal(r.status, 2, "a typo answered `nothing to take` — the loop would have ended");
  assert.match(r.stderr, /`P9` is not an allowed value/);

  // The control: the same call with a real value still hands out the task.
  const ok = run(dir, ["next", "--dir", ".", "--actor", "agent:test"]);
  assert.equal(ok.status, 0, ok.stderr);
});

test("`run --dry-run` refuses the same typo, before it claims anything", () => {
  const dir = repo();
  newTask(dir, ["--title", "Work for a loop"]);
  const r = run(dir, ["run", "--dir", ".", "--agent", "true", "--board", "nowhere", "--dry-run"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /`nowhere` is not an allowed value/);
});

// ── the rule itself ───────────────────────────────────────────────────────

test("no configuration means no problems, not every value refused", () => {
  assert.deepEqual(unknownFilterValues({ status: ["anything"] }, null), []);
});

test("an axis whose vocabulary the project never declared is not checked", () => {
  // `roles: []` is an answer — this project does not use roles — and there is
  // nothing for a value to be outside of. `next` says so in its own words,
  // because a dispatcher filtering by a role nobody serves needs the longer
  // explanation; a listing does not.
  const dir = repo();
  const cfg = loadConfig(dir);
  assert.deepEqual(cfg.roles, [], "the fixture was supposed to declare no roles");
  assert.deepEqual(unknownFilterValues({ role: ["analyst"] }, cfg), []);
});

test("the executor vocabulary is the TOOL's, and is read from the field shapes", () => {
  // Not copied into this module: a second list is a list that drifts.
  const dir = repo();
  const cfg = loadConfig(dir);
  const found = unknownFilterValues({ executor: ["robot"] }, cfg);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].allowed, ["human", "agent"]);
  assert.match(found[0].where, /not a project's/);
});
