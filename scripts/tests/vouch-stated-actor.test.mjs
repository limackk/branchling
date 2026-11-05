/**
 * A vouch typed by a person is never signed by the fallback actor (TL-460).
 *
 * The defect: `done` reached its `manual:` prompt with no actor stated, printed
 * that the vouch would be recorded as the fallback `agent:` actor, and waited
 * for `confirm`. Aborting still left an `__unverified__` record under that
 * actor. The fallback is right for automated writes (`scripts/actor.mjs`) and
 * false for the one act whose whole meaning is that a PERSON looked.
 *
 * `run` is called in-process with an injected environment, terminal and
 * answer. A real terminal cannot be attached portably — Windows has no
 * `/dev/tty` — and the environment is injected so the actor of whatever
 * session runs this suite never reaches the assertions.
 *
 * Two positive controls keep the refusal from being green by accident: every
 * stated source still records a typed vouch under its own actor, an agent's
 * stated vouch included, and the paths this task leaves alone (no terminal,
 * `--confirm-manual`) still record what they did before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, isolateState, plainOutput } from "./_repo.mjs";

isolateHome("vouch-stated-actor");
isolateState("vouch-stated-actor");
plainOutput();

import { ACTOR_ENV, DEFAULT_ACTOR, resolveActorSource } from "../actor.mjs";
import { HOME_ENV, homePaths } from "../home.mjs";
import { run, vouchNeedsStatedActor } from "../done-task.mjs";

const TASK = [
  "---",
  "id: TASK-1",
  'title: "T"',
  "type: task",
  "labels: []",
  "board: main",
  'epic: ""',
  "priority: P1",
  "status: in_progress",
  "owner: unassigned",
  "estimate: 2h",
  "confidence: high",
  "created: 2026-09-01",
  "updated: 2026-09-01",
  "blocked_by: []",
  "blocks: []",
  "verification:",
  "  - id: eyeballed",
  '    manual: "somebody looked at it"',
  "---",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] A. [proof: eyeballed]",
  "",
].join("\n");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-vouch-"));
  const backlog = join(dir, "backlog");
  mkdirSync(join(backlog, "tasks"), { recursive: true });
  writeFileSync(join(backlog, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(backlog, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(backlog, "config.yaml"), 'task_id_prefix: "TASK"\n', "utf8");
  writeFileSync(join(backlog, "tasks", "TASK-1-x.md"), TASK, "utf8");
  // An empty home of its own: the user layer is read through the injected
  // environment, and a test that does not state one must find none.
  const home = join(dir, "home");
  mkdirSync(home);
  return { dir, backlog, env: { [HOME_ENV]: home } };
}

/** A person at a terminal who types `answer`, counting how often they were asked. */
function person(answer) {
  const asked = [];
  return { asked, ask: (prompt) => { asked.push(prompt); return answer; } };
}

function history(backlog) {
  const file = join(backlog, "history", "TASK-1.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const statusOf = (backlog) =>
  (readFileSync(join(backlog, "tasks", "TASK-1-x.md"), "utf8").match(/^status: (.+)$/m) || [])[1];

/** Run `done` and capture what it printed, so the refusal's wording can be read. */
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

function withFixture(fn) {
  const f = fixture();
  return Promise.resolve(fn(f)).finally(() => rmSync(f.dir, { recursive: true, force: true }));
}

// ──────────────────────────────────────────────────────────────────────────
// The source of the actor
// ──────────────────────────────────────────────────────────────────────────

test("the actor's source names the rung that answered, in the documented order", () => {
  const home = mkdtempSync(join(tmpdir(), "branchling-vouch-src-"));
  try {
    const env = { [HOME_ENV]: home };
    assert.deepEqual(resolveActorSource("", { env }), { actor: DEFAULT_ACTOR, source: "default" });

    mkdirSync(homePaths(env).config, { recursive: true });
    writeFileSync(join(homePaths(env).config, "config.yaml"), "actor: user:carol\n", "utf8");
    assert.deepEqual(resolveActorSource("", { env }), { actor: "user:carol", source: "user" });

    env[ACTOR_ENV] = "user:alice";
    assert.deepEqual(resolveActorSource("", { env }), { actor: "user:alice", source: "env" });
    assert.deepEqual(resolveActorSource("user:bob", { env }), { actor: "user:bob", source: "flag" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("only a typed vouch with no stated actor needs one", () => {
  const entries = [{ id: "eyeballed", manual: "somebody looked at it" }];
  const base = { entries, source: "default", confirmManual: false, json: false, terminal: true };
  assert.equal(vouchNeedsStatedActor(base), true);
  for (const source of ["flag", "env", "user"]) {
    assert.equal(vouchNeedsStatedActor({ ...base, source }), false, source + " is a stated actor");
  }
  assert.equal(vouchNeedsStatedActor({ ...base, confirmManual: true }), false, "`--confirm-manual` is a stated act");
  assert.equal(vouchNeedsStatedActor({ ...base, json: true }), false, "`--json` never asks");
  assert.equal(vouchNeedsStatedActor({ ...base, terminal: false }), false, "with no terminal nobody is asked");
  assert.equal(vouchNeedsStatedActor({ ...base, entries: [{ id: "t", bash: "true" }] }), false,
    "a contract with no `manual:` entry asks nobody");
});

// ──────────────────────────────────────────────────────────────────────────
// The refusal
// ──────────────────────────────────────────────────────────────────────────

test("a typed vouch with no stated actor is refused before anything is asked or written", () =>
  withFixture(async ({ backlog, env }) => {
    const p = person("confirm");
    const r = await done(["TASK-1", "--dir", backlog], { env, terminal: true, ask: p.ask });

    assert.equal(r.code, 1, r.out);
    assert.equal(p.asked.length, 0, "the person was asked to vouch under an actor nobody stated");
    assert.equal(statusOf(backlog), "in_progress", "the task file was touched");
    assert.deepEqual(history(backlog), [], "the refusal wrote a history record — under the fallback actor");

    // It says how to state one, by all three sources.
    assert.match(r.out, /nobody said who/);
    assert.match(r.out, /--actor user:<name>/);
    assert.match(r.out, new RegExp(ACTOR_ENV + "=user:<name>"));
    assert.match(r.out, /actor: user:<name>/);
  }));

// ──────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS — every stated source still vouches, as before
// ──────────────────────────────────────────────────────────────────────────

const STATED = [
  { name: "`--actor`", actor: "user:bob", setup: (f) => ({ args: ["--actor", "user:bob"] }) },
  { name: ACTOR_ENV, actor: "user:alice", setup: (f) => { f.env[ACTOR_ENV] = "user:alice"; return { args: [] }; } },
  {
    name: "the user-layer `actor:`",
    actor: "user:carol",
    setup: (f) => {
      mkdirSync(homePaths(f.env).config, { recursive: true });
      writeFileSync(join(homePaths(f.env).config, "config.yaml"), "actor: user:carol\n", "utf8");
      return { args: [] };
    },
  },
  // An agent that states itself is not the fallback: its vouch is its own act,
  // and it is recorded as the agent's.
  { name: "an agent's own `--actor`", actor: "agent:worker", setup: (f) => ({ args: ["--actor", "agent:worker"] }) },
];

for (const s of STATED) {
  test("POSITIVE CONTROL: a typed vouch under " + s.name + " is recorded under that actor", () =>
    withFixture(async (f) => {
      const { args } = s.setup(f);
      const p = person("confirm");
      const r = await done(["TASK-1", "--dir", f.backlog, ...args], { env: f.env, terminal: true, ask: p.ask });

      assert.equal(r.code, 0, r.out);
      assert.equal(p.asked.length, 1, "the person was not asked");
      const vouch = history(f.backlog).find((l) => l.field === "__verified__" && l.vouch);
      assert.ok(vouch, "the vouch left no history record: " + JSON.stringify(history(f.backlog)));
      assert.equal(vouch.actor, s.actor);
      assert.equal(vouch.vouch, "typed");
      assert.notEqual(statusOf(f.backlog), "in_progress", "the task was not closed");
    }));
}

test("POSITIVE CONTROL: a typed refusal under a stated actor is still recorded, under that actor", () =>
  withFixture(async (f) => {
    f.env[ACTOR_ENV] = "user:alice";
    const r = await done(["TASK-1", "--dir", f.backlog], { env: f.env, terminal: true, ask: person("no").ask });
    assert.equal(r.code, 1, r.out);
    const rows = history(f.backlog).filter((l) => l.field === "__unverified__");
    assert.equal(rows.length, 1, JSON.stringify(history(f.backlog)));
    assert.equal(rows[0].actor, "user:alice");
    assert.equal(rows[0].refusal, "declined");
  }));

// ──────────────────────────────────────────────────────────────────────────
// What this task deliberately leaves alone
// ──────────────────────────────────────────────────────────────────────────

test("with no terminal the refusal is recorded as before, under the fallback", () =>
  withFixture(async ({ backlog, env }) => {
    // `askLine` answers null when there is no terminal to read; so does this one.
    const r = await done(["TASK-1", "--dir", backlog], { env, terminal: false, ask: () => null });
    assert.equal(r.code, 1, r.out);
    const rows = history(backlog).filter((l) => l.field === "__unverified__");
    assert.equal(rows.length, 1, JSON.stringify(history(backlog)));
    assert.equal(rows[0].refusal, "no-terminal");
    assert.equal(rows[0].actor, DEFAULT_ACTOR);
  }));

test("`--confirm-manual` with no stated actor is unchanged: a stated act, under the fallback", () =>
  withFixture(async ({ backlog, env }) => {
    const p = person("confirm");
    const r = await done(["TASK-1", "--dir", backlog, "--confirm-manual"], { env, terminal: true, ask: p.ask });
    assert.equal(r.code, 0, r.out);
    assert.equal(p.asked.length, 0, "`--confirm-manual` asked anyway");
    const vouch = history(backlog).find((l) => l.field === "__verified__" && l.vouch);
    assert.ok(vouch, JSON.stringify(history(backlog)));
    assert.equal(vouch.actor, DEFAULT_ACTOR);
    assert.equal(vouch.vouch, "flag");
  }));
