/**
 * Every writing command says where its actor came from (TL-544).
 *
 * WHAT IS ACTUALLY AT RISK: a person's act, made through an interface that
 * forgot `--actor`, recorded as `agent:claude` — and the interface unable to
 * see it, because the answer carried the actor's value but not whether anybody
 * stated it. `decide` reported the source since TL-537; this file holds the
 * other writing commands to the same answer, and holds `--require-actor` to a
 * refusal that writes nothing.
 *
 * Every rung of the chain is exercised at least once — flag, env, the user
 * configuration (reported as `config`) and the default — because a mapping
 * that only ever saw `default` would pass a test that only asked for it.
 *
 * The roles are the fixture's own, never this repository's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ACTOR_REQUIRED, actorRequiredRefusal, reportedActorSource, resolveActorReport } from "../actor.mjs";
import { HOME_ENV, userConfigPath } from "../home.mjs";
import { KINDS } from "../json-envelope.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("actor-source");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const ROLES = "roles: [archivist, stonemason]";

/** The writing kinds this task covers, and `task-decide`, which set the shape. */
const WRITING_KINDS = [
  "task-take", "task-handoff", "task-release", "task-set", "task-body", "task-ask", "verification-run", "task-decide",
];

/**
 * Run the CLI with NO actor in the environment unless one is passed: the
 * developer's own `BACKLOG_ACTOR` would otherwise turn every `default` into
 * `env` and the test into a statement about their shell.
 */
function run(cwd, args, { actorEnv = null, home = null, input = undefined } = {}) {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") };
  delete env.BACKLOG_ACTOR;
  if (actorEnv) env.BACKLOG_ACTOR = actorEnv;
  if (home) env[HOME_ENV] = home;
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env, input });
}

function json(r) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    assert.fail("not JSON (exit " + r.status + "): " + r.stdout + r.stderr);
  }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-actor-source-"));
  assert.equal(spawnSync("git", ["init", "-q", "."], { cwd: dir }).status, 0);
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8") + "\n" + ROLES + "\n", "utf8");
  return dir;
}

function newTask(dir, title) {
  const r = run(dir, ["new", "--dir", ".", "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const m = r.stdout.match(/[A-Z]+-\d+/);
  assert.ok(m, "the id of the new task is not in the output: " + r.stdout);
  return m[0];
}

function historyLines(dir, id) {
  const path = join(dir, "history", id + ".jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

/** A home whose user configuration states an actor — the `config` rung. */
function homeWithActor(actor) {
  const home = mkdtempSync(join(tmpdir(), "branchling-actor-source-home-"));
  const path = userConfigPath({ [HOME_ENV]: home });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "actor: " + actor + "\n", "utf8");
  return home;
}

// ── The helper ────────────────────────────────────────────────────────────

test("the user rung is reported as config, and every other rung as itself", () => {
  assert.equal(reportedActorSource("user"), "config");
  for (const s of ["flag", "env", "default"]) assert.equal(reportedActorSource(s), s);
  assert.deepEqual(resolveActorReport("local:p", { env: {} }), { actor: "local:p", actorSource: "flag" });
  assert.equal(resolveActorReport("", { env: { BACKLOG_ACTOR: "agent:e" } }).actorSource, "env");
});

test("actorRequiredRefusal refuses only the default, and only when asked", () => {
  const fallen = { actor: "agent:claude", actorSource: "default" };
  assert.equal(actorRequiredRefusal(false, fallen, "acts"), null);
  const refused = actorRequiredRefusal(true, fallen, "acts");
  assert.equal(refused.refusalKind, ACTOR_REQUIRED);
  assert.match(refused.refusal, /agent:claude/);
  // POSITIVE CONTROL: every stated rung passes the same flag.
  for (const s of ["flag", "env", "config"]) {
    assert.equal(actorRequiredRefusal(true, { actor: "local:p", actorSource: s }, "acts"), null);
  }
});

test("every writing kind declares actorSource", () => {
  // A list emptied by a rename would pass the loop below with nothing checked.
  assert.ok(WRITING_KINDS.length >= 8);
  for (const kind of WRITING_KINDS) {
    assert.ok(KINDS[kind], "no kind " + kind);
    assert.ok("actorSource" in KINDS[kind], kind + " has no actorSource");
  }
});

// ── Each writing command, end to end ──────────────────────────────────────

test("take and next report the source, and take --require-actor refuses the default", () => {
  const dir = repo();
  const a = newTask(dir, "First to claim");
  newTask(dir, "Second to claim");

  const refused = run(dir, ["take", a, "--dir", ".", "--require-actor", "--json"]);
  assert.equal(refused.status, 1);
  const answer = json(refused);
  assert.equal(answer.ok, false);
  assert.equal(answer.refusalKind, "actor-required");
  assert.equal(answer.actorSource, "default");
  assert.equal(historyLines(dir, a), 1, "a refused take wrote history");

  const taken = run(dir, ["take", a, "--dir", ".", "--actor", "local:person", "--require-actor", "--json"]);
  assert.equal(taken.status, 0, taken.stderr);
  assert.equal(json(taken).actorSource, "flag");

  const drawn = run(dir, ["next", "--dir", ".", "--json"]);
  assert.equal(drawn.status, 0, drawn.stderr);
  assert.equal(json(drawn).actorSource, "default");

  // An empty queue is still an answer from a resolved actor.
  const empty = run(dir, ["next", "--dir", ".", "--json"], { actorEnv: "agent:other" });
  assert.equal(empty.status, 3);
  assert.equal(json(empty).actorSource, "env");
});

test("handoff and release report the source, and refuse the default under --require-actor", () => {
  const dir = repo();
  const id = newTask(dir, "Changes hands");
  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:worker"]).status, 0);
  const before = historyLines(dir, id);

  const refusedHandoff = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "needs filing", "--require-actor", "--json"]);
  assert.equal(refusedHandoff.status, 1);
  assert.equal(json(refusedHandoff).refusalKind, "actor-required");
  assert.equal(json(refusedHandoff).actorSource, "default");
  const refusedRelease = run(dir, ["release", id, "--dir", ".", "--reason", "put down", "--require-actor", "--json"]);
  assert.equal(refusedRelease.status, 1);
  assert.equal(json(refusedRelease).refusalKind, "actor-required");
  assert.equal(json(refusedRelease).actorSource, "default");
  assert.equal(historyLines(dir, id), before, "a refused write wrote history");

  const released = run(dir, ["release", id, "--dir", ".", "--reason", "put down", "--require-actor", "--json"], { actorEnv: "agent:worker" });
  assert.equal(released.status, 0, released.stderr);
  assert.equal(json(released).actorSource, "env");

  assert.equal(run(dir, ["take", id, "--dir", ".", "--actor", "agent:worker"]).status, 0);
  const handed = run(dir, ["handoff", id, "--dir", ".", "--to-role", "archivist", "--reason", "needs filing", "--actor", "agent:worker", "--require-actor", "--json"]);
  assert.equal(handed.status, 0, handed.stderr);
  assert.equal(json(handed).actorSource, "flag");
});

test("set reports the user configuration as config, and refuses the default under --require-actor", () => {
  const dir = repo();
  const id = newTask(dir, "A field edited by a person");
  const before = historyLines(dir, id);

  const refused = run(dir, ["set", id, "epic", "storage", "--dir", ".", "--require-actor", "--json"]);
  assert.equal(refused.status, 1);
  assert.equal(json(refused).refusalKind, "actor-required");
  assert.equal(json(refused).actorSource, "default");
  assert.equal(historyLines(dir, id), before, "a refused set wrote history");

  const home = homeWithActor("local:person");
  const written = run(dir, ["set", id, "epic", "storage", "--dir", ".", "--require-actor", "--json"], { home });
  assert.equal(written.status, 0, written.stderr);
  const answer = json(written);
  assert.equal(answer.actorSource, "config");
  assert.equal(answer.actor, "local:person");

  // A usage refusal comes before any actor was resolved: null, not a guess.
  const usage = run(dir, ["set", id, "--dir", ".", "--json"]);
  assert.equal(usage.status, 2);
  assert.equal(json(usage).actorSource, null);
});

test("body reports the source, and refuses the default under --require-actor before reading the body", () => {
  const dir = repo();
  const id = newTask(dir, "A body rewritten");
  const shown = json(run(dir, ["show", id, "--dir", ".", "--json"]));
  // `file` may be absolute or relative to the backlog; both are accepted.
  const text = readFileSync(existsSync(shown.file) ? shown.file : join(dir, shown.file), "utf8");
  const body = text.slice(text.indexOf("\n---", 3) + 4);
  const bodyFile = join(dir, "new-body.md");
  writeFileSync(bodyFile, body + "\nOne more sentence.\n", "utf8");
  const before = historyLines(dir, id);

  const refused = run(dir, ["body", id, "--dir", ".", "--reason", "clarify", "--body-file", bodyFile, "--require-actor", "--json"]);
  assert.equal(refused.status, 1);
  assert.equal(json(refused).refusalKind, "actor-required");
  assert.equal(json(refused).actorSource, "default");
  assert.equal(historyLines(dir, id), before, "a refused body wrote history");

  const written = run(dir, ["body", id, "--dir", ".", "--reason", "clarify", "--body-file", bodyFile, "--actor", "local:person", "--require-actor", "--json"]);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(json(written).changed, true);
  assert.equal(json(written).actorSource, "flag");
});

test("ask and done report the source, default included", () => {
  const dir = repo();
  const id = newTask(dir, "A question and a closure");

  const asked = run(dir, ["ask", id, "--dir", ".", "--question", "which shape", "--json"]);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(json(asked).actorSource, "default");
  // `ask` does not take the flag: a question is an agent's act more often than not.
  assert.equal(run(dir, ["ask", id, "--dir", ".", "--question", "x", "--require-actor"]).status, 2);

  const closed = run(dir, ["done", id, "--dir", ".", "--json"], { actorEnv: "agent:closer" });
  assert.notEqual(closed.stdout, "", closed.stderr);
  assert.equal(json(closed).actorSource, "env");
});
