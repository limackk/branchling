/**
 * A refusal no attempt can fix ends the run, and does it on the FIRST attempt
 * (TL-190).
 *
 * WHAT HAPPENED. `scripts/run-loop.mjs` decided a refusal was terminal by
 * reading `verdict.reason`, a key `done --json` never writes — the envelope
 * publishes `refusalKind`. The comparison was `undefined === "manual-needs-person"`,
 * so the branch was dead code: a run against a task the agent had already closed
 * itself launched a second agent at a finished task, prefixed with "THE PREVIOUS
 * ATTEMPT DID NOT CLOSE THIS TASK", and spent the whole `--max-attempts` budget
 * proving the task was done.
 *
 * WHY IT WAS INVISIBLE. `manual-refusal-residue.test.mjs` asserts `refusalKind`
 * on the `done` side; the loop's own tests never reached the `needs-person`
 * outcome. Each side was tested against its own spelling and nothing crossed
 * between them. This file is that crossing, twice over: end to end through a
 * fixture tree, and directly — every kind the loop calls terminal has to be a
 * kind `done` actually publishes.
 *
 * THE POSITIVE CONTROL is the last test: the same fixture, an agent that never
 * satisfies the contract, and MORE than one attempt. Without it, a loop that
 * stopped after one attempt whatever happened would pass everything above.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TERMINAL_REFUSALS } from "../run-loop.mjs";

import { isolateHome } from "./_repo.mjs";

isolateHome("run-terminal-refusal");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

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

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

/** A backlog with one task whose contract is `contract` — the frontmatter block
 *  written verbatim — and whose criteria all name `proofId`, so nothing refuses
 *  over the criteria links before the contract is reached. */
function fixture(title, contract, proofId) {
  const dir = tmp("terminal");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);

  const r = cli(["new", "--dir", backlog, "--title", title, "--priority", "P1"], env);
  assert.equal(r.status, 0, r.stderr);
  const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/, contract.split("{id}").join(id) + "\n---")
    .replace(/\[proof:[^\]]*\]/g, "[proof: " + proofId + "]"), "utf8");
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, id };
}

/** An agent that records every invocation, so "one attempt" is read off the
 *  agent's own trace and not only off the run's report of itself. */
function agentScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + 'echo x >> ' + JSON.stringify(join(dir, "calls")) + "\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function calls(dir) {
  const f = join(dir, "calls");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0;
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

const BASH_CONTRACT = 'verification:\n  - id: it-is-done\n    bash: "test -f {id}.done"';
const MANUAL_CONTRACT = 'verification:\n  - id: a-person-looked\n    manual: "a person reads the screen and agrees"';

test("a task the agent closed itself ends the run in ONE attempt", () => {
  // The budget is deliberately larger than one: the defect this rules out was
  // spending every attempt of it on a task that was already finished.
  const { dir, repo, backlog, env, id } = fixture("Task the agent closes itself", BASH_CONTRACT, "it-is-done");
  try {
    const agent = agentScript(dir, "closer.sh", [
      'id=$(grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
      process.execPath + ' ' + JSON.stringify(CLI) +
        ' done "$id" --dir ' + JSON.stringify(backlog) + ' --actor user:someone >/dev/null 2>&1',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "3", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(calls(dir), 1, "a second agent was launched at a task that was already closed");

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.attempts, 1, "the run spent more than the one attempt the answer needed");
    assert.equal(row.outcome, "closed-elsewhere");
    assert.equal(row.status, "done", "the report does not say which status was found");
    assert.doesNotMatch(String(row.detail), /undefined/, "a refusal printed `undefined`");

    // The tree is the authority: the run stopped early, it did not park anything.
    assert.equal(statusOf(backlog, id), "done");
    assert.equal(report.tally.blocked, 0);
    assert.equal(report.tally.closedElsewhere, 1);
  } finally {
    cleanup(dir);
  }
});

test("a `manual:` contract ends as `needs-person`, also in one attempt", () => {
  const { dir, repo, backlog, env, id } = fixture("Task only a person can vouch for", MANUAL_CONTRACT, "a-person-looked");
  try {
    // The agent does the work; nothing it can do makes an unattended `done`
    // able to ask a person.
    const agent = agentScript(dir, "worker.sh", "cat >/dev/null");

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "3", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(calls(dir), 1, "the loop retried a refusal that asks for a person");

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "needs-person", "the `needs-person` outcome is still unreachable");
    assert.equal(row.attempts, 1);
    assert.ok(String(row.detail).length > 0, "the outcome does not say what refused");
    assert.doesNotMatch(String(row.detail), /undefined/, "a refusal printed `undefined`");
  } finally {
    cleanup(dir);
  }
});

test("every kind the loop calls terminal is a kind `done` publishes", () => {
  // The defect was a name, not a rule: the loop compared against a key nothing
  // wrote. Reading the literals out of `done-task.mjs` is what makes a rename on
  // either side fail here instead of silently switching the branch off again.
  const source = readFileSync(join(HERE, "..", "done-task.mjs"), "utf8");
  // Both shapes a kind is written in: the last argument of a `refuse(…)` call,
  // and the `kind:` of a `stop` that a later `refuse` passes on.
  const published = new Set(
    (source.match(/"[a-z-]+"\s*\n?\s*\);/g) || []).map((m) => m.replace(/[^a-z-]/g, ""))
      .concat((source.match(/kind: "[a-z-]+"/g) || []).map((m) => m.replace(/^kind: "|"$/g, "")))
  );
  // A positive control on the extraction itself: a set that matched nothing
  // would make the loop below vacuous.
  assert.ok(published.size >= 4, "the refusal kinds could not be read out of `done-task.mjs`");
  for (const [kind, outcome] of Object.entries(TERMINAL_REFUSALS)) {
    assert.ok(published.has(kind),
      "`" + kind + "` is not a refusal kind `done` writes — the loop is reading a name nobody publishes");
    assert.ok(outcome, "`" + kind + "` names no outcome");
  }
});

test("POSITIVE CONTROL: a contract that genuinely fails still takes every attempt", () => {
  const { dir, repo, backlog, env, id } = fixture("Task nobody finishes", BASH_CONTRACT, "it-is-done");
  try {
    const agent = agentScript(dir, "idle.sh", "cat >/dev/null");

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--max-attempts", "2", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(calls(dir), 2, "the loop stopped early on a refusal a further attempt could have fixed");

    const report = JSON.parse(r.stdout);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.attempts, 2);
    assert.equal(row.outcome, "exhausted");
    assert.equal(statusOf(backlog, id), "blocked");
  } finally {
    cleanup(dir);
  }
});
