/**
 * A history record says which ROLE its actor was acting as (TL-222).
 *
 * WHAT WAS MISSING. The log answers WHO — `actor:` — and, since TL-164, from
 * which session. It has never answered AS WHAT. A queue served by several hands
 * through `--agent-for <role>=<command>` writes entries indistinguishable from a
 * queue served by one, so the stage a change belongs to has to be guessed from
 * the actor's name. A measurement of a pipeline read back that way is a
 * measurement of a naming convention.
 *
 * THE FIELD IS THE ACTOR'S ROLE, NOT THE TASK'S. `diffMeta` already reports a
 * change to the task's `role:` field; this says which hand made it. The two
 * differ exactly where it matters — a `handoff` writes `role: maker → checker`
 * while the hand performing it is still the maker.
 *
 * THE OMIT RULE, inherited from `session` (TL-164): absent when there is none,
 * never written as `""`. Every line in every existing log predates the field, so
 * an empty string would be a third state beside absent and present.
 *
 * WHAT MAY STAMP IT, and this is the decision the field turns on: only a command
 * that MADE the change AND was told the role. Reconciliation records changes it
 * merely SAW, so it stamps nothing — the last test is that control, and without
 * it a green run here would also be green for a field written everywhere.
 *
 * THE FIXTURE DECLARES ITS OWN VOCABULARY. `maker` and `checker` are not this
 * tool's roles and must not be read out of the repository's own config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("history-role");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

const MAKER = "maker";
const CHECKER = "checker";
const PASSING = 'verification:\n  - id: it-runs\n    bash: "true"';
const FAILING = 'verification:\n  - id: it-runs\n    bash: "false"';

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...(env || {}) },
    ...opts,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

/** Every history record for one task, as objects. The FILE is the artefact — a
 *  command's own report of what it wrote proves only that it meant to. */
function history(backlog, id) {
  const dir = join(backlog, "history");
  const out = [];
  for (const f of existsSync(dir) ? readdirSync(dir) : []) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e = null;
      try { e = JSON.parse(line); } catch { continue; }
      if (e && String(e.task || "").toUpperCase() === String(id).toUpperCase()) out.push(e);
    }
  }
  return out;
}

/** A backlog declaring the fixture's own two roles, holding one task. */
function fixture(title, contract) {
  const dir = tmp("role");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const configPath = join(backlog, "config.yaml");
  const config = readFileSync(configPath, "utf8") + "\nroles: [" + MAKER + ", " + CHECKER + "]\n";
  writeFileSync(configPath, config, "utf8");
  assert.match(readFileSync(configPath, "utf8"), new RegExp("roles: \\[" + MAKER),
    "the fixture's own `roles:` line was not written — every assertion below would be vacuous");

  const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, contract + "\n---")
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-runs]"), "utf8");
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, id };
}

/** An agent that prints, so the loop does not read the attempt as one that
 *  never started, and changes nothing. */
function worker(dir, name) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\ncat >/dev/null\necho 'the work is done'\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

/**
 * The generalist hand, which must never be reached: it leaves a file behind if
 * it is. `--agent` is mandatory even when every task in the queue asks for a
 * role (TL-223), so the two runs below have to pass one; asserting it stayed
 * unused is what keeps them tests of DISPATCH BY ROLE rather than of a single
 * command that would have served anything.
 */
function mustNotRun(dir, marker) {
  const p = join(dir, "generalist.sh");
  writeFileSync(p, "#!/bin/sh\ncat >/dev/null\ntouch '" + marker + "'\necho 'the wrong hand'\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("`take --role` records the role the caller declared", () => {
  const { dir, backlog, env, id } = fixture("Work claimed by a named hand", PASSING);
  try {
    assert.equal(cli(["take", id, "--dir", backlog, "--actor", "agent:one", "--role", MAKER], env).status, 0);
    const claim = history(backlog, id).filter((e) => e.field === "status" && e.to === "in_progress");
    assert.equal(claim.length, 1, "the claim left no status record to carry a role");
    assert.equal(claim[0].role, MAKER, "the claim does not say what the hand was acting as");
    assert.equal(claim[0].actor, "agent:one", "the actor was lost while the role was added");
  } finally {
    cleanup(dir);
  }
});

test("a take with no `--role` omits the key rather than writing an empty one", () => {
  const { dir, backlog, env, id } = fixture("Work claimed by nobody in particular", PASSING);
  try {
    assert.equal(cli(["take", id, "--dir", backlog, "--actor", "agent:one"], env).status, 0);
    for (const e of history(backlog, id)) {
      assert.ok(!("role" in e),
        "an entry carries `role` when no role was declared — absent and empty are two states, not three");
    }
  } finally {
    cleanup(dir);
  }
});

test("`done --role` records the role that closed the task", () => {
  const { dir, backlog, env, id } = fixture("Work closed by a named hand", PASSING);
  try {
    const r = cli(["done", id, "--dir", backlog, "--actor", "agent:two", "--role", CHECKER], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const closing = history(backlog, id).filter((e) => e.field === "status" && e.to === "done");
    assert.equal(closing.length, 1, "the closure left no status record");
    assert.equal(closing[0].role, CHECKER, "the closing entry does not name the stage that closed it");
  } finally {
    cleanup(dir);
  }
});

test("a role outside the project's vocabulary is a usage error, not a silent note", () => {
  const { dir, backlog, env, id } = fixture("Work closed as something undeclared", PASSING);
  try {
    const r = cli(["done", id, "--dir", backlog, "--actor", "agent:two", "--role", "reviewer"], env);
    assert.equal(r.status, 2, "an undeclared role was accepted: " + r.stdout + r.stderr);
    assert.match(r.stderr, /unknown role/);
    assert.match(r.stderr, new RegExp(MAKER), "the refusal does not say what the vocabulary holds");
  } finally {
    cleanup(dir);
  }
});

test("a run serving a role stamps the closing entry with it", () => {
  const { dir, repo, backlog, env, id } = fixture("Work dispatched to one of several hands", PASSING);
  try {
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role: .*$/m, "role: " + MAKER), "utf8");
    cli(["build", "--dir", backlog], env);

    const marker = join(dir, "generalist-ran");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent", mustNotRun(dir, marker),
      "--agent-for", MAKER + "=" + worker(dir, "worker.sh")], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!existsSync(marker), "the generalist served a task that asked for a role");

    const closing = history(backlog, id).filter((e) => e.field === "status" && e.to === "done");
    assert.equal(closing.length, 1, "the run did not close the task it was given");
    assert.equal(closing[0].role, MAKER,
      "a queue served by several hands records which one closed the task nowhere");
  } finally {
    cleanup(dir);
  }
});

test("a run that parks a task stamps the park with the role that tried", () => {
  const { dir, repo, backlog, env, id } = fixture("Work no hand could finish", FAILING);
  try {
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role: .*$/m, "role: " + MAKER), "utf8");
    cli(["build", "--dir", backlog], env);

    const marker = join(dir, "generalist-ran");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:fleet", "--max-attempts", "1", "--json",
      "--agent", mustNotRun(dir, marker),
      "--agent-for", MAKER + "=" + worker(dir, "worker.sh")], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!existsSync(marker), "the generalist served a task that asked for a role");

    const parked = history(backlog, id).filter((e) => e.field === "status" && e.source === "run").pop();
    assert.ok(parked, "the park left no record");
    assert.equal(parked.role, MAKER, "the park does not say which hand could not finish it");
  } finally {
    cleanup(dir);
  }
});

test("reconciliation stamps no role — it records a change it merely SAW", () => {
  const { dir, backlog, env, id } = fixture("Work edited by hand", PASSING);
  try {
    // The FIRST reconcile seeds the snapshot and records nothing, so the edit has
    // to come after one, or it is absorbed rather than observed.
    assert.equal(cli(["history", "--dir", backlog, "--actor", "user:someone",
      "--reason", "seeding the snapshot before the hand edit"], env).status, 0);
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^priority: .*$/m, "priority: P3"), "utf8");
    const r = cli(["history", "--dir", backlog, "--actor", "user:someone", "--source", "manual",
      "--reason", "a hand edit, reconciled afterwards"], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    const seen = history(backlog, id).filter((e) => e.field === "priority");
    assert.equal(seen.length, 1, "the hand edit was not recorded at all");
    assert.ok(!("role" in seen[0]),
      "a change the tool only OBSERVED was stamped with a role — that attributes a stage to whoever ran the reconcile");
  } finally {
    cleanup(dir);
  }
});

test("`next` stamps the role it dispatched on, and only on a real match", () => {
  const { dir, backlog, env, id } = fixture("Work a dispatcher hands out", PASSING);
  try {
    const file = taskFile(backlog, id);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role: .*$/m, "role: " + MAKER), "utf8");
    cli(["build", "--dir", backlog], env);

    const r = cli(["next", "--dir", backlog, "--actor", "agent:fleet", "--role", MAKER + "," + CHECKER], env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const claim = history(backlog, id).filter((e) => e.field === "status" && e.source === "next");
    assert.equal(claim.length, 1, "the dispatcher left no claim record");
    assert.equal(claim[0].role, MAKER,
      "the one path a fleet uses records no role — the whole stage is unattributed");
  } finally {
    cleanup(dir);
  }
});

test("`next` with no role filter records none, and a roleless task caught by one records none", () => {
  const loose = fixture("Work nobody asked a role for", PASSING);
  try {
    // No filter at all: the caller was acting as nobody in particular.
    assert.equal(cli(["next", "--dir", loose.backlog, "--actor", "agent:fleet"], loose.env).status, 0);
    for (const e of history(loose.backlog, loose.id)) {
      assert.ok(!("role" in e), "a claim made under no role carries one");
    }
  } finally {
    cleanup(loose.dir);
  }

  const widened = fixture("Work with no role, selected by a role filter", PASSING);
  try {
    // `--role r` still selects a roleless task unless `--role-strict` narrows it.
    // That task was not worked AS `r`, so nothing may be stamped.
    assert.equal(cli(["next", "--dir", widened.backlog, "--actor", "agent:fleet", "--role", MAKER],
      widened.env).status, 0);
    for (const e of history(widened.backlog, widened.id)) {
      assert.ok(!("role" in e),
        "a roleless task caught by the widening was recorded as worked in that role — a guess, in the log");
    }
  } finally {
    cleanup(widened.dir);
  }
});
