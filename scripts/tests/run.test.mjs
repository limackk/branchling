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

import { agentFor, agentInput, blockedReason, parseRunArgs, renderAgentCommand, servedRoles, stuckStatus, waitingForExecutor, waitingForRole } from "../run-loop.mjs";

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
  // said by `reason_required_statuses`. Since TL-140 `init` declares it, so this
  // line is now belt and braces rather than a repair — kept because the fixture
  // must state what it depends on rather than inherit it silently. `plainConfig`
  // strips the key back out, which is the shape a backlog created before TL-140
  // still has.
  if (opts.plainConfig) {
    const cfg = join(backlog, "config.yaml");
    writeFileSync(cfg, readFileSync(cfg, "utf8").replace(/^reason_required_statuses:.*$/m, ""), "utf8");
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

/** Give a task a role, and declare the vocabulary it comes from. The roles are
 *  the FIXTURE's own: `roles:` is a project's vocabulary, and asserting one
 *  project's job titles would make the test a copy of somebody's config.yaml. */
function withRoles(backlog, roles, assignments) {
  const cfg = join(backlog, "config.yaml");
  writeFileSync(cfg, readFileSync(cfg, "utf8") + "\nroles: [" + roles.join(", ") + "]\n", "utf8");
  for (const [id, role] of Object.entries(assignments || {})) {
    const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role:.*$/m, "role: " + role), "utf8");
  }
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
  // A backlog written before TL-140 leaves `reason_required_statuses` unset, so
  // it resolves to the archived statuses and `next` hands out `blocked`. Parking
  // a task there would hand it straight back: the run refuses BEFORE it takes
  // anything, and says which key settles it. `init` now writes the key, which is
  // what TL-140 changed — the refusal stays, for the backlogs that predate it.
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

// ── One queue, several hands (TL-98) ──────────────────────────────────────

test("each role is worked by ITS OWN command, and the role-less task by --agent", () => {
  const { dir, repo, backlog, env, ids } = fixture(3);
  try {
    withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "archivist", [ids[1]]: "stonemason" });
    // Every agent appends its own name to one file, so the assertion is WHICH
    // hand did the work and not merely that the work got done. The path is
    // absolute: the contract runs in the repository root, which is not this
    // fixture's directory.
    const ledger = join(dir, "who.log");
    const mk = (name) => agentScript(dir, name + ".sh",
      'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"; echo "$id ' + name + '" >> ' + ledger);
    const r = cli([
      "run", "--dir", backlog, "--actor", "agent:worker",
      "--agent", mk("general"),
      "--agent-for", "archivist=" + mk("arch"),
      "--agent-for", "stonemason=" + mk("stone"),
    ], env, { cwd: repo });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const who = Object.fromEntries(
      readFileSync(ledger, "utf8").trim().split("\n").map((l) => l.split(" "))
    );
    assert.equal(who[ids[0]], "arch");
    assert.equal(who[ids[1]], "stone");
    assert.equal(who[ids[2]], "general");
  } finally {
    cleanup(dir);
  }
});

test("POSITIVE CONTROL: a role with no command is never handed to another hand", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason" });
    const agent = agentScript(dir, "arch.sh",
      'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli([
      "run", "--dir", backlog, "--actor", "agent:worker",
      "--agent", agent, "--agent-for", "archivist=" + agent, "--json",
    ], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    // The stonemason's task is untouched — not taken, not attempted, not blocked.
    assert.equal(statusOf(backlog, ids[0]), "pending");
    assert.equal(statusOf(backlog, ids[1]), "done");
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.waitingForRole, [{ role: "stonemason", count: 1, ids: [ids[0]] }]);
  } finally {
    cleanup(dir);
  }
});

test("a skip is never silent: the report names the role and counts the tasks", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    withRoles(backlog, ["archivist", "stonemason"], { [ids[0]]: "stonemason", [ids[1]]: "stonemason" });
    const agent = agentScript(dir, "arch.sh", "cat > /dev/null");
    const r = cli([
      "run", "--dir", backlog, "--actor", "agent:worker",
      "--agent", agent, "--agent-for", "archivist=" + agent,
    ], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 task\(s\) ask for `stonemason`/);
    assert.match(r.stdout, new RegExp(ids[0]));
  } finally {
    cleanup(dir);
  }
});

test("a role the project does not declare fails BEFORE the loop starts", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    withRoles(backlog, ["archivist"], {});
    const agent = agentScript(dir, "a.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli([
      "run", "--dir", backlog, "--actor", "agent:worker",
      "--agent", agent, "--agent-for", "stonemason=" + agent,
    ], env, { cwd: repo });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not declare/);
    // Nothing ran: the first task is exactly where it was.
    assert.equal(statusOf(backlog, ids[0]), "pending");
  } finally {
    cleanup(dir);
  }
});

test("with no --agent-for at all, one command still serves every task", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    withRoles(backlog, ["archivist"], { [ids[0]]: "archivist" });
    const agent = agentScript(dir, "a.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    for (const id of ids) assert.equal(statusOf(backlog, id), "done");
  } finally {
    cleanup(dir);
  }
});

test("the map, without a loop around it", () => {
  const plan = parseRunArgs(["--agent", "general", "--agent-for", "archivist=arch --flag", "--agent-for", "stonemason=stone"]);
  assert.deepEqual(plan.agentFor, { archivist: "arch --flag", stonemason: "stone" });
  assert.deepEqual(servedRoles(plan), ["archivist", "stonemason"]);
  assert.equal(agentFor(plan, "archivist"), "arch --flag");
  assert.equal(agentFor(plan, ""), "general");
  // The escalation: no entry is NOT the general command.
  assert.equal(agentFor(plan, "carpenter"), null);
  // …and with no map at all the scalar serves everybody, as it did before.
  const plain = parseRunArgs(["--agent", "general"]);
  assert.equal(agentFor(plain, "archivist"), "general");
});

test("`--agent-for` refuses a shape that is not `<role>=<command>`, and a repeat", () => {
  assert.throws(() => parseRunArgs(["--agent-for", "archivist"]), /<role>=<command>/);
  assert.throws(() => parseRunArgs(["--agent-for", "=cmd"]), /<role>=<command>/);
  assert.throws(() => parseRunArgs(["--agent-for", "archivist="]), /with no command/);
  assert.throws(
    () => parseRunArgs(["--agent-for", "archivist=a", "--agent-for", "archivist=b"]),
    /given twice/
  );
});

test("waitingForRole counts only OPEN work in roles nobody here serves", () => {
  const config = { archivedStatuses: ["done"], inProgressStatus: "in_progress" };
  const records = [
    { id: "FX-1", role: "archivist", status: "pending" },
    { id: "FX-2", role: "stonemason", status: "pending" },
    { id: "FX-3", role: "stonemason", status: "done" },        // closed, not waiting
    { id: "FX-4", role: "stonemason", status: "in_progress" },  // somebody has it
    { id: "FX-5", role: "", status: "pending" },                // nobody in particular
  ];
  assert.deepEqual(waitingForRole(records, config, ["archivist"]), { stonemason: ["FX-2"] });
  assert.deepEqual(waitingForRole(records, config, ["archivist", "stonemason"]), {});
});

// ── executor: the loop leaves a person's tasks alone (TL-113) ─────────────

test("a run under an agent actor never works a task marked `executor: human`", () => {
  const { dir, repo, backlog, env, ids } = fixture(2);
  try {
    const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role:(.*)$/m, "role:$1\nexecutor: human"), "utf8");

    const agent = agentScript(dir, "a.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent, "--json"], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statusOf(backlog, ids[0]), "pending", "the person's task was worked by an agent");
    assert.equal(statusOf(backlog, ids[1]), "done");
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.waitingForExecutor, [{ executor: "human", count: 1, ids: [ids[0]] }]);
  } finally {
    cleanup(dir);
  }
});

test("the report says so in words, not only in the JSON", () => {
  const { dir, repo, backlog, env, ids } = fixture(1);
  try {
    const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(ids[0] + "-")));
    writeFileSync(file, readFileSync(file, "utf8").replace(/^role:(.*)$/m, "role:$1\nexecutor: human"), "utf8");
    const agent = agentScript(dir, "a.sh", "cat > /dev/null");
    const r = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent], env, { cwd: repo });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 task\(s\) ask for `executor: human`/);
  } finally {
    cleanup(dir);
  }
});

test("waitingForExecutor counts only OPEN work this species may not be handed", () => {
  const config = { archivedStatuses: ["done"], inProgressStatus: "in_progress" };
  const records = [
    { id: "FX-1", executor: "human", status: "pending" },
    { id: "FX-2", executor: "human", status: "done" },          // closed
    { id: "FX-3", executor: "human", status: "in_progress" },   // somebody has it
    { id: "FX-4", executor: "", status: "pending" },            // anybody
    { id: "FX-5", executor: "agent", status: "pending" },       // this run IS one
  ];
  assert.deepEqual(waitingForExecutor(records, config, "agent"), { human: ["FX-1"] });
  assert.deepEqual(waitingForExecutor(records, config, "human"), { agent: ["FX-5"] });
});

test("a backlog straight out of `init` needs no repair before a run (TL-140)", () => {
  // The point of TL-140: this fixture adds nothing to the generated config, and
  // the flagship loop starts. Before it, the first `run` on a fresh backlog was
  // an error message.
  const dir = tmp("fresh");
  const repo = join(dir, "repo");
  mkdirSync(repo, { recursive: true });
  const backlog = join(repo, "backlog");
  const env = { BACKLOG_STATE_DIR: join(dir, "state") };
  try {
    assert.equal(cli(["init", "--dir", backlog, "--no-example"], env).status, 0);
    const r = cli(["new", "--dir", backlog, "--title", "Fresh", "--priority", "P1"], env);
    const id = (r.stdout.match(/([A-Z]+-\d+)/) || [])[1];
    const file = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((f) => f.startsWith(id + "-")));
    writeFileSync(file, readFileSync(file, "utf8")
      .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: it-is-done\n    bash: "test -f ' + id + '.done"\n---')
      .replace(/\[proof:[^\]]*\]/g, "[proof: it-is-done]"), "utf8");

    const agent = agentScript(dir, "a.sh", 'id=$(grep -m1 "^id: " | sed "s/^id: //"); touch "$id.done"');
    const run_ = cli(["run", "--dir", backlog, "--actor", "agent:worker", "--agent", agent], env, { cwd: repo });
    assert.equal(run_.status, 0, run_.stdout + run_.stderr);
    assert.equal(statusOf(backlog, id), "done");
  } finally {
    cleanup(dir);
  }
});
