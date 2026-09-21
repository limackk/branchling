/**
 * A PROFILE agent that closes its own task is this run's closure (TL-349).
 *
 * WHAT HAPPENED. The profile run for TL-225 on 2026-09-07 handed the task to
 * the `codex` profile; the agent satisfied the contract and ran `done` itself
 * under the actor the profile publishes — `agent:codex` — which is NOT the
 * actor the loop was started with. The loop's own `done` was then refused as
 * already-closed, and the accounting compared the closing actor against
 * `ctx.actor` alone, so the run's own success was filed as somebody else's
 * closure.
 *
 * WHY A SECOND FILE BESIDE `run-closed-by-agent.test.mjs`. That file pins the
 * SCALAR hand, where the actor the loop claims under and the actor the agent
 * closes under are one string, so it cannot distinguish "the run's actor" from
 * "the hand this run gave the task to". The profile is the case where those two
 * identities are deliberately different, and it is the only shape in which
 * TL-349's defect can be observed at all.
 *
 * THE POSITIVE CONTROL is the third test: a profile agent that closes the task
 * as a THIRD party still leaves a collision. Without it, an implementation that
 * credited every already-closed task to the run would pass the first two and
 * destroy what TL-191 and TL-200 built.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("run-profile-closes-own-task");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** The loop's actor, and the profile's own — different on purpose. */
const RUN_ACTOR = "agent:orchestrator";
const PROFILE = "codex";
const PROFILE_ACTOR = "agent:" + PROFILE;

function cli(args, env, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 120_000, env,
  });
}

function taskFile(backlog, id) {
  return join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
}

function statusOf(backlog, id) {
  return (readFileSync(taskFile(backlog, id), "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function history(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * One task whose contract appends a line to a witness file before checking for
 * a marker. The witness is what proves the contract is not executed twice: the
 * agent's own `done` runs it once, and a loop that re-ran verification after
 * the already-closed refusal would leave two lines.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "branchling-profile-closes-"));
  const repo = join(root, "repo");
  const backlog = join(repo, "backlog");
  mkdirSync(repo, { recursive: true });
  const env = {
    ...process.env, NO_COLOR: "1",
    [HOME_ENV]: join(root, "home"), BACKLOG_STATE_DIR: join(root, "state"),
  };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env, root).status, 0);

  // The vocabulary the third test needs (third law): a closer who is neither
  // the loop nor the profile it handed the task to.
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8")
    .replace(/^owners:.*$/m, "owners: [unassigned, user:someone, " + RUN_ACTOR + ", " + PROFILE_ACTOR + "]"), "utf8");

  const created = cli(["new", "--dir", backlog, "--title", "Task the profile closes itself", "--priority", "P1"], env, repo);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  const witness = join(root, "contract-runs.txt");
  const file = taskFile(backlog, id);
  writeFileSync(file, readFileSync(file, "utf8")
    .replace(/verification:[\s\S]*?\n---/,
      'verification:\n  - id: it-is-done\n    bash: "echo ran >> ' + witness + ' && test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  assert.equal(cli(["build", "--dir", backlog], env, repo).status, 0);
  return { root, repo, backlog, env, id, witness };
}

/** An adapter that satisfies the contract and then closes the task as `closer`
 *  — the one variable between the tests below. */
function adapterClosingAs(root, name, backlog, closer) {
  const p = join(root, name);
  writeFileSync(p, [
    "#!/bin/sh",
    "input=$(cat)",
    "id=$(printf '%s' \"$input\" | sed -n 's/^id: //p' | head -n 1)",
    'touch "$id.done"',
    process.execPath + " " + JSON.stringify(CLI) + ' done "$id" --dir ' + JSON.stringify(backlog) +
      " --actor " + closer + " >/dev/null 2>&1",
    "echo closed",
  ].join("\n") + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function withProfile(f) {
  const fx = fixture();
  try {
    return f(fx);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
}

test("a profile closing its own task under the profile's actor counts as closed", () => {
  withProfile(({ root, repo, backlog, env, id, witness }) => {
    const adapter = adapterClosingAs(root, "codex-adapter", backlog, PROFILE_ACTOR);
    assert.equal(cli(["profile", "create", PROFILE, "--adapter", adapter, "--model", "model-x",
      "--effort", "careful", "--prompt", "Close the task."], env, repo).status, 0);

    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--profile", PROFILE,
      "--max-attempts", "1", "--json"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    // THE TREE FIRST: the proven status stands and the run wrote nothing over it.
    assert.equal(statusOf(backlog, id), "done");
    const written = history(backlog, id).filter((e) => e.source === "run" && e.field === "status");
    assert.equal(written.length, 0, "the run recorded a status change it must not have made");

    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closed, 1, "a run whose profile closed the task reported zero closed");
    assert.equal(report.tally.closedByAgent, 1, "`--json` does not say which hand closed it");
    assert.equal(report.tally.closedElsewhere, 0, "the success path is still reported as a collision");
    assert.equal(report.tally.blocked, 0);
    const row = report.tasks.find((t) => t.id === id);
    assert.equal(row.outcome, "closed-by-agent");
    assert.equal(row.status, "done");
    assert.match(String(row.detail), new RegExp(PROFILE_ACTOR), "the detail does not name who closed it");

    // THE CONTRACT WAS EXECUTED TWICE, AND BOTH TIMES ARE ACCOUNTED FOR: the
    // baseline probe taken at the claim (TL-242), and the agent's own `done`.
    // A loop that went on to verify the task again after observing the
    // agent-owned archived status — through the loop's own `done`, or through
    // the inherited-baseline probe behind it — would leave a third line.
    assert.equal(readFileSync(witness, "utf8").split("\n").filter(Boolean).length, 2,
      "the run executed the task's verification again after the agent had closed it");
    assert.match(readFileSync(String(row.log), "utf8"), new RegExp("already closed by " + PROFILE_ACTOR),
      "the log does not record where the ending was decided");
  });
});

test("the terminal report of that run says `1 closed` and names the hand", () => {
  withProfile(({ root, repo, backlog, env, id }) => {
    const adapter = adapterClosingAs(root, "codex-adapter", backlog, PROFILE_ACTOR);
    assert.equal(cli(["profile", "create", PROFILE, "--adapter", adapter, "--model", "model-x",
      "--effort", "careful", "--prompt", "Close the task."], env, repo).status, 0);

    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--profile", PROFILE,
      "--max-attempts", "1"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1 closed ·/, "the summary still says zero closed");
    assert.doesNotMatch(r.stdout, /closed elsewhere/, "the summary calls the run's own work somebody else's");
    assert.match(r.stdout, new RegExp(id + "\\s+closed-by-agent"));
  });
});

test("POSITIVE CONTROL: a third party closing it stays `closed-elsewhere`", () => {
  withProfile(({ root, repo, backlog, env, id }) => {
    const adapter = adapterClosingAs(root, "codex-adapter", backlog, "user:someone");
    assert.equal(cli(["profile", "create", PROFILE, "--adapter", adapter, "--model", "model-x",
      "--effort", "careful", "--prompt", "Close the task."], env, repo).status, 0);

    const r = cli(["run", "--dir", backlog, "--actor", RUN_ACTOR, "--profile", PROFILE,
      "--max-attempts", "1", "--json"], env, repo);
    assert.equal(r.status, 0, r.stdout + r.stderr);

    assert.equal(statusOf(backlog, id), "done");
    const report = JSON.parse(r.stdout);
    assert.equal(report.tally.closedElsewhere, 1, "a task somebody else closed is no longer a collision");
    assert.equal(report.tally.closed, 0, "the run took credit for somebody else's closure");
    assert.equal(report.tally.closedByAgent, 0);
    assert.equal(report.tasks.find((t) => t.id === id).outcome, "closed-elsewhere");
  });
});
