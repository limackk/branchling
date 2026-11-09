/**
 * Every writing command refuses a STATED reserved actor `unknown` (TL-628).
 *
 * `unknown` is what the tool records for a change it OBSERVED. TL-569 refused
 * it for field writes; every other writer gated on `actorRefusal()`, which
 * accepts it on purpose, so `take --actor unknown` filed a deliberate claim as
 * a change nobody witnessed — and `isUnattributed()` then queued it for
 * somebody to claim. The refusal is `statedActorRefusal()`, chosen by each
 * writer that records its own act.
 *
 * A refusal is proved by bytes: the task file and its history log identical
 * before and after. The positive controls matter as much: a namespaced actor
 * still writes through the same commands, `isValidActor()` still accepts
 * `unknown`, and `history --actor unknown` — the reconciliation route, which
 * records OBSERVED changes — still writes under it. A guard that refused
 * every actor, or that narrowed the shared predicate, would pass the refusal
 * cases alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACTOR_ENV } from "../actor.mjs";
import { ACTOR_UNKNOWN, actorRefusal, isValidActor, statedActorRefusal } from "../task-fields.mjs";
import { isUnattributed, readHistory } from "../history.mjs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { isolateHome, isolateState, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("writers-reserved-actor");
isolateState("writers-reserved-actor");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const NAMESPACED_FORMS = /local:<name>.*agent:<name>.*user:<name>/;
const RECEIVER = "local:bob";

/** A fresh backlog with two pending tasks and a receiver `handoff` may name. */
function fixture() {
  const dir = realpathSync(fixtureDir(join(tmpdir(), "branchling-writers-reserved-actor-")));
  const root = join(dir, "backlog");
  const init = run(root, ["init", "--no-example"]);
  assert.equal(init.status, 0, init.stderr);
  const configFile = join(root, "config.yaml");
  const config = readFileSync(configFile, "utf8");
  assert.match(config, /^owners: \[unassigned\]$/m, "the fixture adds a receiver to the owners vocabulary");
  writeFileSync(configFile, config.replace(/^owners: \[unassigned\]$/m, "owners: [unassigned, " + RECEIVER + "]"));
  const ids = ["First", "Second"].map((title) => {
    const made = run(root, ["new", "--title", title, "--actor", "agent:fixture"]);
    assert.equal(made.status, 0, made.stderr);
    return made.stdout.match(/[A-Z]+-\d+/)[0];
  });
  return { root, ids };
}

/** A CLI run whose actor comes only from what the test states. */
function run(root, args, env = {}) {
  const base = { ...process.env };
  delete base[ACTOR_ENV];
  return spawnSync(process.execPath, [CLI, ...args, "--dir", root], { encoding: "utf8", env: { ...base, ...env } });
}

function taskText(root, id) {
  return readFileSync(join(root, "tasks", readdirSync(join(root, "tasks")).find((name) => name.startsWith(id + "-"))), "utf8");
}

function historyText(root, id) {
  const file = join(root, "history", id + ".jsonl");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** Every task file and history log, so a refusal can be proved to touch none. */
function snapshot(root) {
  const tasks = readdirSync(join(root, "tasks")).filter((name) => name.endsWith(".md")).sort();
  const history = existsSync(join(root, "history"))
    ? readdirSync(join(root, "history")).filter((name) => name.endsWith(".jsonl")).sort() : [];
  return {
    tasks: tasks.map((name) => [name, readFileSync(join(root, "tasks", name), "utf8")]),
    history: history.map((name) => [name, readFileSync(join(root, "history", name), "utf8")]),
  };
}

function assertRefused(result, before, root, what) {
  assert.equal(result.status, 2, what + ": " + result.stdout + result.stderr);
  assert.match(result.stderr, /`unknown` is reserved/, what);
  assert.match(result.stderr, NAMESPACED_FORMS, what);
  assert.deepEqual(snapshot(root), before, what + " must not touch any task or history log");
}

test("the shared predicate still accepts unknown; only the stated-actor refusal adds it", () => {
  assert.equal(ACTOR_UNKNOWN, "unknown");
  assert.equal(isValidActor(ACTOR_UNKNOWN), true);
  assert.equal(actorRefusal(ACTOR_UNKNOWN), null);
  // The whole sentence, because the served routes answer with it alone: it has
  // to name the reserved value, why it is reserved, and every form that works.
  assert.deepEqual(statedActorRefusal(ACTOR_UNKNOWN), {
    cause: "reserved",
    namespace: true,
    refusal: "the actor `unknown` is reserved for a change the tool observed, not one it makes; " +
      "state who makes this change as local:<name>, agent:<name> or user:<name>",
    hint: "Use one of: local:<name> | agent:<name> | user:<name>",
  });
  assert.equal(statedActorRefusal("agent:a1"), null, "a namespaced actor passes");
  assert.deepEqual(statedActorRefusal("bob"), actorRefusal("bob"), "every other diagnosis is actorRefusal()'s own");
});

for (const [route, how] of [
  ["--actor", (args) => ({ args: args.concat(["--actor", ACTOR_UNKNOWN]), env: {} })],
  [ACTOR_ENV, (args) => ({ args, env: { [ACTOR_ENV]: ACTOR_UNKNOWN } })],
]) {
  test("take, next and handoff refuse unknown stated through " + route + " and write nothing", () => {
    const fx = fixture();
    const [first] = fx.ids;
    let before = snapshot(fx.root);
    let call = how(["take", first]);
    assertRefused(run(fx.root, call.args, call.env), before, fx.root, "take");

    call = how(["next"]);
    assertRefused(run(fx.root, call.args, call.env), before, fx.root, "next");

    assert.equal(run(fx.root, ["take", first, "--actor", "agent:holder"]).status, 0);
    before = snapshot(fx.root);
    call = how(["handoff", first, "--to-owner", RECEIVER, "--reason", "needs a reviewer"]);
    assertRefused(run(fx.root, call.args, call.env), before, fx.root, "handoff");
  });
}

test("take, next and handoff still write under a namespaced actor", () => {
  const fx = fixture();
  const [first, second] = fx.ids;
  const took = run(fx.root, ["take", first, "--actor", "agent:a1"]);
  assert.equal(took.status, 0, took.stderr);
  assert.match(taskText(fx.root, first), /^owner: agent:a1\b/m);

  const next = run(fx.root, ["next"], { [ACTOR_ENV]: "local:ada" });
  assert.equal(next.status, 0, next.stderr);
  assert.match(taskText(fx.root, second), /^owner: local:ada\b/m);

  const handed = run(fx.root, ["handoff", first, "--to-owner", RECEIVER, "--reason", "needs a reviewer", "--actor", "agent:a1"]);
  assert.equal(handed.status, 0, handed.stderr);
  assert.match(taskText(fx.root, first), new RegExp("^owner: " + RECEIVER + "\\b", "m"));

  const rows = readHistory(fx.root, first).concat(readHistory(fx.root, second))
    .filter((row) => ["take", "next", "handoff"].includes(row.source));
  assert.ok(rows.length >= 3, JSON.stringify(rows));
  assert.ok(rows.every((row) => row.actor !== ACTOR_UNKNOWN), JSON.stringify(rows));
});

test("new and release refuse a stated unknown too", () => {
  const fx = fixture();
  let before = snapshot(fx.root);
  assertRefused(run(fx.root, ["new", "--title", "Filed by nobody", "--actor", ACTOR_UNKNOWN]), before, fx.root, "new");

  assert.equal(run(fx.root, ["take", fx.ids[0], "--actor", "agent:holder"]).status, 0);
  before = snapshot(fx.root);
  assertRefused(run(fx.root, ["release", fx.ids[0], "--reason", "putting it down"], { [ACTOR_ENV]: ACTOR_UNKNOWN }),
    before, fx.root, "release");
});

test("history readers and reconciliation still take unknown for an OBSERVED change; a claim by unknown is refused", () => {
  const fx = fixture();
  const [first] = fx.ids;
  const file = readdirSync(join(fx.root, "tasks")).find((name) => name.startsWith(first + "-"));
  const path = join(fx.root, "tasks", file);
  // A snapshot first, so the hand edit below is a difference reconcile records.
  assert.equal(run(fx.root, ["history", "--quiet"]).status, 0);
  writeFileSync(path, taskText(fx.root, first).replace(/^priority: \S+/m, "priority: P0"));

  const observed = run(fx.root, ["history", "--file", path, "--actor", ACTOR_UNKNOWN, "--quiet"]);
  assert.equal(observed.status, 0, observed.stderr);
  const row = readHistory(fx.root, first).find((e) => e.field === "priority" && e.to === "P0");
  assert.ok(row, "the observed edit was recorded");
  assert.equal(row.actor, ACTOR_UNKNOWN);
  assert.equal(isUnattributed(row), true, "a reader still queues it as nobody's");

  const before = snapshot(fx.root);
  const claim = run(fx.root, ["history", "--file", path, "--attribute", "--reason", "my edit", "--actor", ACTOR_UNKNOWN]);
  assertRefused(claim, before, fx.root, "history --attribute");
  assert.match(claim.stderr, /history: `--attribute` claims a change for somebody, and the actor `unknown` is reserved/);
  assert.match(claim.stderr, /\n {2}Use one of: local:<name> \| agent:<name> \| user:<name>/);
  assert.match(historyText(fx.root, first), /"to":"P0"/);
});
