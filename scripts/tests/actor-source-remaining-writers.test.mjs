/**
 * The writers TL-544 did not reach say where their actor came from (TL-550).
 *
 * WHAT IS AT RISK is the same failure TL-544 closed for `take`, `set` and the
 * rest: a write recorded under `agent:claude` because nobody stated an actor,
 * and the caller unable to see it, because the answer carried at most the
 * actor's value and never whether anybody named it. `seed`, `import`,
 * `deploy record` and `run` resolved their actor and dropped the rung; `new`
 * had no `--actor` and no `--json` at all, so a creation was attributed
 * through the default chain with no way to ask which rung answered.
 *
 * Each command is asked end to end, through the CLI, under more than one rung —
 * a mapping exercised only under `default` would pass a test asking only for
 * `default`. Every fixture is its own throwaway backlog; no value of this
 * repository's configuration is asserted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV, userConfigPath } from "../home.mjs";
import { KINDS } from "../json-envelope.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("actor-source-remaining-writers");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** The kinds this task covers. */
const KINDS_COVERED = ["seed", "import", "task-new", "release-record", "run"];

const TEMP = [];
function temp(prefix) {
  const dir = fixtureDir(join(tmpdir(), "branchling-actor-rest-" + prefix + "-"));
  TEMP.push(dir);
  return dir;
}
test.after(() => { for (const d of TEMP) rmSync(d, { recursive: true, force: true }); });

/**
 * The CLI with NO actor in the environment unless one is passed: the
 * developer's own `BACKLOG_ACTOR` would otherwise turn every `default` into
 * `env`, and the test into a statement about their shell. The home is always
 * an isolated one, so a real user configuration cannot answer as `config`.
 */
function run(cwd, args, { actorEnv = null, home = null, input = undefined } = {}) {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(cwd, ".state") };
  delete env.BACKLOG_ACTOR;
  if (actorEnv) env.BACKLOG_ACTOR = actorEnv;
  env[HOME_ENV] = home || join(cwd, ".home");
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 60_000, env, input });
}

function json(r) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    assert.fail("not JSON (exit " + r.status + "): " + r.stdout + r.stderr);
  }
}

function git(dir, args) {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

/** A git repository holding a backlog at `<repo>/backlog`. */
function repo(prefix) {
  const dir = temp(prefix);
  git(dir, ["init", "-q", "-b", "main", "."]);
  const r = run(dir, ["init", "--dir", "backlog", "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

/** A home whose user configuration states an actor — the `config` rung. */
function homeWithActor(actor) {
  const home = temp("home");
  const path = userConfigPath({ [HOME_ENV]: home });
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "actor: " + actor + "\n", "utf8");
  return home;
}

function creationActor(dir, id) {
  const path = join(dir, "backlog", "history", id + ".jsonl");
  assert.ok(existsSync(path), "no history for " + id);
  const rows = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const born = rows.find((r) => r.field === "__created__");
  assert.ok(born, "no creation row for " + id);
  return born.actor;
}

const PLAN = JSON.stringify({
  tasks: [{
    plan_id: "first", title: "A seeded task", goal: "Something is true afterwards.",
    verification: [{ id: "it-runs", bash: "true", proves: "The check runs." }],
  }],
});

const ISSUES = JSON.stringify([{
  number: 1, title: "An imported issue", body: "The fixture issue body.",
  state: "OPEN", labels: [], url: "https://example.test/issues/1",
}]);

// ── The declaration ───────────────────────────────────────────────────────

test("every kind this task covers declares actorSource", () => {
  assert.equal(KINDS_COVERED.length, 5);
  for (const kind of KINDS_COVERED) {
    assert.ok(KINDS[kind], "no kind " + kind);
    assert.ok("actorSource" in KINDS[kind], kind + " has no actorSource");
  }
});

// ── new ───────────────────────────────────────────────────────────────────

test("new --json names the rung, and the creation is recorded under that actor", () => {
  const dir = repo("new");
  const cases = [
    { opts: {}, args: ["--actor", "local:typed"], source: "flag", actor: "local:typed" },
    { opts: { actorEnv: "agent:shell" }, args: [], source: "env", actor: "agent:shell" },
    { opts: { home: homeWithActor("user:configured") }, args: [], source: "config", actor: "user:configured" },
    { opts: {}, args: [], source: "default", actor: "agent:claude" },
  ];
  for (const [i, c] of cases.entries()) {
    const r = run(dir, ["new", "--dir", "backlog", "--title", "Task " + i, "--json"].concat(c.args), c.opts);
    assert.equal(r.status, 0, r.stderr);
    const doc = json(r);
    assert.equal(doc.kind, "task-new");
    assert.equal(doc.ok, true);
    assert.equal(doc.actorSource, c.source, "case " + c.source);
    assert.match(doc.id, /^[A-Z]+-\d+$/);
    assert.ok(existsSync(doc.file), "the reported file does not exist: " + doc.file);
    assert.equal(creationActor(dir, doc.id), c.actor, "case " + c.source);
  }
});

test("new refuses an actor with no namespace and writes nothing", () => {
  const dir = repo("new-refuse");
  const r = run(dir, ["new", "--dir", "backlog", "--title", "Refused", "--actor", "nobody"]);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /no valid namespace/);
  // POSITIVE CONTROL: the same invocation with a namespace writes the task.
  const ok = run(dir, ["new", "--dir", "backlog", "--title", "Accepted", "--actor", "local:somebody", "--json"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(json(ok).actorSource, "flag");
  const tasks = readdirSync(join(dir, "backlog", "tasks")).filter((f) => f.endsWith(".md"));
  assert.deepEqual(tasks.map((f) => f.replace(/^[A-Z]+-\d+-/, "")), ["accepted.md"], "the refused task was written");
});

test("new without --json still answers in text", () => {
  const dir = repo("new-text");
  const r = run(dir, ["new", "--dir", "backlog", "--title", "Plain"]);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /^\{/);
  assert.match(r.stdout, /new: /);
});

// ── seed ──────────────────────────────────────────────────────────────────

test("seed --json names the rung on a write, a dry run and a refusal", () => {
  const dir = repo("seed");
  const written = run(dir, ["seed", "--dir", "backlog", "--json"], { actorEnv: "agent:seeder", input: PLAN });
  assert.equal(written.status, 0, written.stderr);
  const doc = json(written);
  assert.equal(doc.kind, "seed");
  assert.equal(doc.actorSource, "env");
  assert.equal(creationActor(dir, doc.created[0].id), "agent:seeder");

  const dry = run(dir, ["seed", "--dir", "backlog", "--dry-run", "--json", "--actor", "local:planner"], { input: PLAN });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(json(dry).actorSource, "flag");

  const refused = run(dir, ["seed", "--dir", "backlog", "--json"], { input: "{}" });
  assert.equal(refused.status, 2, refused.stderr);
  const rdoc = json(refused);
  assert.equal(rdoc.ok, false);
  assert.equal(rdoc.actorSource, "default");
});

// ── import ────────────────────────────────────────────────────────────────

test("import --json names the rung on a write, a dry run and a refusal", () => {
  const dir = repo("import");
  const home = homeWithActor("user:importer");
  const written = run(dir, ["import", "--from", "github", "--dir", "backlog", "--json"], { home, input: ISSUES });
  assert.equal(written.status, 0, written.stderr);
  const doc = json(written);
  assert.equal(doc.kind, "import");
  assert.equal(doc.actorSource, "config");
  assert.equal(creationActor(dir, doc.created[0].id), "user:importer");

  const dry = run(dir, ["import", "--from", "github", "--dir", "backlog", "--dry-run", "--json"], { input: ISSUES });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(json(dry).actorSource, "default");

  const refused = run(dir, ["import", "--from", "github", "--dir", "backlog", "--json", "--actor", "local:p"], { input: "{}" });
  assert.notEqual(refused.status, 0);
  const rdoc = json(refused);
  assert.equal(rdoc.ok, false);
  assert.equal(rdoc.actorSource, "flag");
});

// ── deploy record ─────────────────────────────────────────────────────────

const TARGETS = `
deploy_targets:
  - name: app
    stages:
      - { name: review, ref: refs/deploys/app/review, recorded: true }
`;

test("deploy record --json names the rung, and is null before the actor is resolved", () => {
  const dir = repo("deploy");
  appendFileSync(join(dir, "backlog", "config.yaml"), TARGETS, "utf8");
  writeFileSync(join(dir, "a.txt"), "a\n", "utf8");
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "first"]);
  const base = ["deploy", "record", "--dir", "backlog", "--target", "app", "--stage", "review", "HEAD", "--json"];

  const recorded = run(dir, base.concat("--reason", "a fixture"), { actorEnv: "agent:deployer" });
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  const doc = json(recorded);
  assert.equal(doc.kind, "release-record");
  assert.equal(doc.ok, true);
  assert.equal(doc.actor, "agent:deployer");
  assert.equal(doc.actorSource, "env");

  const flagged = run(dir, base.concat("--reason", "again", "--actor", "local:typed"));
  assert.equal(flagged.status, 0, flagged.stdout + flagged.stderr);
  assert.equal(json(flagged).actorSource, "flag");

  // A refusal of the reason comes before the actor is resolved, so it names
  // no rung — never one nobody consulted.
  const early = run(dir, base);
  assert.equal(early.status, 2);
  assert.equal(json(early).actorSource, null);
});

// ── run ───────────────────────────────────────────────────────────────────

test("run --json names the rung, including a local profile's identity", () => {
  const dir = repo("run");
  const home = join(dir, ".home");
  const asked = (args, opts = {}) => {
    const r = run(dir, ["run", "--dir", "backlog", "--dry-run", "--json"].concat(args), { home, ...opts });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const doc = json(r);
    assert.equal(doc.kind, "run");
    return doc.actorSource;
  };
  assert.equal(asked(["--actor", "agent:loop"]), "flag");
  assert.equal(asked([], { actorEnv: "agent:shell" }), "env");
  assert.equal(asked([]), "default");

  const adapter = join(dir, "adapter");
  writeFileSync(adapter, "#!/bin/sh\ncat >/dev/null\n", "utf8");
  chmodSync(adapter, 0o755);
  const created = run(dir, ["profile", "create", "worker", "--adapter", adapter,
    "--model", "model-x", "--effort", "careful", "--prompt", "Do the task."], { home });
  assert.equal(created.status, 0, created.stderr);
  assert.equal(asked(["--profile", "worker"]), "profile");
  // A stated actor outranks the profile, and says so.
  assert.equal(asked(["--profile", "worker", "--actor", "agent:loop"]), "flag");
});
