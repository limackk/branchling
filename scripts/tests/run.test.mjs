/**
 * `run` — the queue driven to empty by somebody else's agent (TL-96).
 *
 * THE AGENT IN EVERY TEST IS A SHELL SCRIPT. Not a mock of an LLM and not a
 * stub inside the process: a file on disk that the loop is told to execute. That
 * is the claim being made — the loop holds no knowledge of any particular agent
 * host — and a fixture that reached inside the loop would be asserting our own
 * abstraction instead of the behaviour.
 *
 * WHAT EACH TEST HAS TO RULE OUT.
 *
 *   the happy path      that the task closed because the gate is lenient. The
 *                       agent here writes the very thing the contract checks,
 *                       and the control below is the run in which it does not.
 *   the failing task    that "blocked" was produced by a crash rather than by
 *                       the policy. The POSITIVE CONTROL is the status: it must
 *                       be the project's own stuck status, never `done`, and
 *                       the reason must name the attempts.
 *   the timeout         that a killed agent is read as a refusal. It is not a
 *                       verdict about the work, and the log has to say so.
 *   `--max-tasks`       that the run stopped because the queue emptied. A second
 *                       task is left untouched, and that is asserted.
 *
 * The state directory is redirected in every test: a suite that wrote to the
 * user's real one would leak locks and logs between runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentInput, blockedReason, parseRunArgs, renderAgentCommand, stuckStatus } from "../run-loop.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "worktrail-" + prefix + "-" + (counter++) + "-"));
}

function cli(args, env, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NO_COLOR: "1", ...(env || {}) },
    ...opts,
  });
}

/**
 * A backlog with `n` tasks whose contract is "the file `<id>.done` exists in the
 * repository root". A contract a shell script can satisfy is what makes the
 * agent replaceable in the test as well as in the design.
 */
function fixture(count = 1, opts = {}) {
  const dir = tmp("run");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
  // A task parked by the run has to leave the queue, and in this tool that is
  // said by `reason_required_statuses`. `init` does not declare it, so a default
  // backlog dispatches `blocked` — the refusal that produces is asserted below.
  if (!opts.plainConfig) {
    const cfg = join(backlog, "config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8") + "\nreason_required_statuses: [blocked, cancelled]\n", "utf8");
  }

  const ids = [];
  for (let i = 1; i <= count; i++) {
    const r = cli(["new", "--dir", backlog, "--title", "Task number " + i, "--priority", "P1"], env);
    assert.equal(r.status, 0, r.stderr);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    ids.push(id);
    const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
    const raw = readFileSync(file, "utf8");
    // The template's criteria name a proof id of their own; leaving them would
    // make every run refuse on the criteria link and never reach the contract.
    writeFileSync(file, raw
      .replace(/verification:[\s\S]*?\n---/,
        'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");
  }
  cli(["build", "--dir", backlog], env);
  return { dir, repo, backlog, env, ids };
}

/** An agent that is a shell script, and nothing more. */
function agentScript(dir, name, body) {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n", "utf8");
  chmodSync(p, 0o755);
  return p;
}

function statusOf(backlog, id) {
  const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
  return (readFileSync(file, "utf8").match(/^status: ([a-z_]+)/m) || [])[1];
}

function history(backlog, id) {
  const f = join(backlog, "history", id + ".jsonl");
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ── The loop, driven by a script that is not ours ──────────────────────────

test("an agent that satisfies the contract empties the queue", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    // It reads the task on stdin and creates the file that task's contract names
    // — the id is taken from what it was HANDED, never from the loop.
    const agent = agentScript(dir, "agent.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const id of ids) assert.equal(statusOf(backlog, id), "done", id + " was not closed by the run");
    assert.match(r.stdout, /2 task\(s\) taken · 2 closed · 0 blocked/);
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: an agent that does nothing closes nothing", () => {
  // Without this run, the test above passes against a gate that closes anything.
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "idle.sh", "cat > /dev/null");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-attempts", "1"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(statusOf(backlog, ids[0]), "done", "a task nobody did was closed");
  } finally {
    cleanup(dir);
  }
});

test("a task that keeps failing is BLOCKED with the reason, never done", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "idle.sh", "cat > /dev/null");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-attempts", "2"], env, { cwd: repo });
    assert.equal(r.status, 0, "a run that blocked a task is still a finished run: " + r.stderr);

    assert.equal(statusOf(backlog, ids[0]), "blocked", "the stuck task did not reach the project's stuck status");
    const entries = history(backlog, ids[0]).filter((e) => e.source === "run" && e.field === "status");
    assert.equal(entries.length, 1, "the block was not recorded as a change made by the run");
    assert.equal(entries[0].to, "blocked");
    assert.match(entries[0].reason, /2 agent attempts/, "the reason does not say how many attempts were spent");
    assert.match(entries[0].reason, /it-is-done|test -f/, "the reason does not name what failed");
  } finally {
    cleanup(dir);
  }
});

test("the run tries again, and the second attempt is TOLD what failed", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  const seen = join(dir, "stdin-2.txt");
  try {
    // Fails on the first attempt, records its second input, then satisfies the
    // contract. The recorded stdin is the evidence the feedback travelled.
    const agent = agentScript(dir, "twice.sh", [
      'n=$(cat ' + JSON.stringify(join(dir, "n")) + ' 2>/dev/null || echo 0)',
      'n=$((n+1)); echo $n > ' + JSON.stringify(join(dir, "n")),
      'input=$(cat)',
      'if [ "$n" = "1" ]; then exit 0; fi',
      'printf "%s" "$input" > ' + JSON.stringify(seen),
      'id=$(printf "%s" "$input" | grep -m1 "^id: " | sed "s/^id: //")',
      'touch "$id.done"',
    ].join("\n"));

    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-attempts", "2"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statusOf(backlog, ids[0]), "done", "the second attempt did not close the task");

    const second = readFileSync(seen, "utf8");
    assert.match(second, /THE PREVIOUS ATTEMPT DID NOT CLOSE THIS TASK/);
    assert.match(second, /test -f/, "the failing command never reached the agent");
    assert.match(second, new RegExp("^id: " + ids[0], "m"), "the task itself stopped being handed over");
  } finally {
    cleanup(dir);
  }
});

test("an agent that hangs is killed, and that is not read as a refusal", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "hang.sh", "cat > /dev/null; sleep 30");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent,
      "--timeout", "1", "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tasks[0].id, ids[0]);
    assert.equal(out.tasks[0].status, "blocked");
    assert.match(out.tasks[0].detail, /killed after 1s/, "the report does not say the agent was killed");
    assert.match(readFileSync(out.tasks[0].log, "utf8"), /killed after 1s/, "the log does not say it either");
  } finally {
    cleanup(dir);
  }
});

test("`--max-tasks` stops the run with work still in the queue", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    const agent = agentScript(dir, "agent.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-tasks", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tally.taken, 1);
    assert.match(out.stopped, /--max-tasks 1/);
    assert.equal(statusOf(backlog, ids[1]), "pending", "the second task was worked on anyway");
  } finally {
    cleanup(dir);
  }
});

test("a blocked task does not come back, so the run ends instead of spinning", () => {
  // The stop condition that is easiest to get wrong: with nothing but blocked
  // work left, `next` has nothing to hand out and the loop must END.
  const { dir, repo, backlog, env } = fixture(2);
  try {
    const agent = agentScript(dir, "idle.sh", "cat > /dev/null");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-attempts", "1", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tally.taken, 2, "the run did not reach every task, or reached one twice");
    assert.equal(out.tally.blocked, 2);
    assert.equal(out.stopped, "the queue is empty");
  } finally {
    cleanup(dir);
  }
});

test("the reservation is given back, so the next run is not locked out", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "idle.sh", "cat > /dev/null");
    cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--max-attempts", "1"], env, { cwd: repo });
    const held = cli(["take", ids[0], "--dir", backlog, "--actor", "agent:someone-else", "--reason", "looking at why it stuck"], env, { cwd: repo });
    assert.equal(held.status, 0, "the blocked task is still reserved by the run that gave up: " + held.stderr);
  } finally {
    cleanup(dir);
  }
});

// ── The report, and the run that changes nothing ───────────────────────────

test("`--dry-run` prints the order, claims nothing and needs no agent", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    const r = cli(["run", "--dir", backlog, "--dry-run", "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.order.map((t) => t.id), ids, "the order is not the dispatcher's own");
    for (const id of ids) assert.equal(statusOf(backlog, id), "pending", "`--dry-run` claimed a task");
  } finally {
    cleanup(dir);
  }
});

test("`--json` carries per task the outcome, the attempts and the log path", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "agent.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.tasks.length, 1);
    assert.equal(out.tasks[0].id, ids[0]);
    assert.equal(out.tasks[0].outcome, "closed");
    assert.equal(out.tasks[0].attempts, 1);
    assert.ok(existsSync(out.tasks[0].log), "the log path in the report points at nothing");
    assert.ok(!out.tasks[0].log.startsWith(backlog), "the agent log was written INTO the repository");
  } finally {
    cleanup(dir);
  }
});

test("with no agent command the run refuses instead of inventing one", () => {
  const { dir, repo, backlog, env } = fixture(1);
  try {
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker"], { ...env, BACKLOG_AGENT_COMMAND: "" }, { cwd: repo });
    assert.equal(r.status, 2, "a run with no agent did something anyway");
    assert.match(r.stderr, /BACKLOG_AGENT_COMMAND/);
    assert.match(r.stderr, /config\.yaml/, "it does not say why the command is not a project setting");
  } finally {
    cleanup(dir);
  }
});

test("the environment supplies the agent when the flag does not", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const agent = agentScript(dir, "agent.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker"],
      { ...env, BACKLOG_AGENT_COMMAND: agent }, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statusOf(backlog, ids[0]), "done");
  } finally {
    cleanup(dir);
  }
});

test("a backlog that still dispatches `blocked` is REFUSED, not parked in a loop", () => {
  // The default `init` config leaves `reason_required_statuses` unset, so it
  // resolves to the archived statuses and `next` hands out `blocked`. Parking a
  // task there would hand it straight back: the run refuses BEFORE it takes
  // anything, and says which key settles it.
  const { dir, repo, backlog, env, ids } = fixture(1, { plainConfig: true });
  try {
    const agent = agentScript(dir, "idle.sh", "cat > /dev/null");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent], env, { cwd: repo });
    assert.equal(r.status, 2, "the run started with nowhere to park a task it could not finish");
    assert.match(r.stderr, /reason_required_statuses/);
    assert.equal(statusOf(backlog, ids[0]), "pending", "it claimed a task before refusing");
  } finally {
    cleanup(dir);
  }
});

test("an unknown flag and a task id both FAIL", () => {
  const { dir, backlog, env } = fixture(1);
  try {
    const flag = cli(["run", "--dir", backlog, "--parallel"], env);
    assert.equal(flag.status, 2);
    assert.match(flag.stderr, /unknown flag/);

    const named = cli(["run", "--dir", backlog, "TASK-1"], env);
    assert.equal(named.status, 2, "a dispatcher that is told which task to run is not a queue");
    assert.match(named.stderr, /no task id/);
  } finally {
    cleanup(dir);
  }
});

// ── The pure parts ─────────────────────────────────────────────────────────

test("the template substitutes the file and the id, and leaves the rest alone", () => {
  const rendered = renderAgentCommand("claude -p @{task_file} # {id} {unknown}", {
    file: "backlog/tasks/T-1-x.md", id: "T-1",
  });
  assert.equal(rendered, "claude -p @backlog/tasks/T-1-x.md # T-1 {unknown}");
});

test("the first attempt gets the task alone; a later one gets the refusal too", () => {
  assert.equal(agentInput("the task", ""), "the task");
  const second = agentInput("the task", "  exit 1: test -f X.done  ");
  assert.match(second, /^the task/);
  assert.match(second, /exit 1: test -f X\.done/);
});

test("the blocked reason states the evidence, not a verdict", () => {
  assert.match(blockedReason(1, "test -f X.done"), /^no verification after 1 agent attempt: test -f X\.done$/);
  assert.match(blockedReason(3, ""), /^no verification after 3 agent attempts$/);
});

test("the stuck status is derived from the project's own words", () => {
  const base = { statuses: ["pending", "in_progress", "blocked", "done", "cancelled"],
    activeStatuses: ["pending", "in_progress", "blocked"],
    archivedStatuses: ["done", "cancelled"], inProgressStatus: "in_progress" };
  const config = { ...base, reasonRequiredStatuses: ["blocked", "cancelled"] };
  assert.deepEqual(stuckStatus(config, null), { status: "blocked" });

  // Two candidates and no answer: the run must ASK rather than pick.
  const two = { ...config, statuses: base.statuses.concat("waiting"),
    activeStatuses: base.activeStatuses.concat("waiting"),
    reasonRequiredStatuses: ["blocked", "waiting"] };
  assert.match(stuckStatus(two, null).error, /more than one status/);
  assert.deepEqual(stuckStatus(two, "waiting"), { status: "waiting" });

  // The two answers that may never be given: closing a task the run could not
  // verify, and parking it where the dispatcher will hand it straight back.
  assert.match(stuckStatus(config, "done").error, /ARCHIVED/);
  assert.match(stuckStatus(config, "nonsense").error, /not one of/);
  assert.match(stuckStatus(config, "pending").error, /handed straight back/);

  // A backlog that protects only its archived statuses dispatches `blocked`,
  // so there is nowhere to park anything — and the refusal names the key.
  const plain = { ...base, reasonRequiredStatuses: ["done", "cancelled"] };
  assert.match(stuckStatus(plain, null).error, /nowhere to park/);
  assert.match(stuckStatus(plain, null).details.join(" "), /reason_required_statuses/);
});

test("a positive whole number, or a usage error", () => {
  assert.equal(parseRunArgs(["--max-attempts", "3"]).maxAttempts, 3);
  assert.throws(() => parseRunArgs(["--max-attempts", "0"]), /positive whole number/);
  assert.throws(() => parseRunArgs(["--timeout", "1.5"]), /positive whole number/);
  assert.throws(() => parseRunArgs(["--agent"]), /with no value/);
});
