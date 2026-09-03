#!/usr/bin/env node
/**
 * `run` — the queue driven to empty: take, hand to an agent, close (TL-96).
 *
 * WHAT IT IS. The three-line shell loop from `instructions autonomous-loop`,
 * written down once so that the accounting around it is not rewritten by
 * everybody who needs it: which task, which attempt, what the agent printed,
 * what the gate said, and where the run stopped.
 *
 * THIS TOOL IS NOT AN AGENT, and this file is where that is easiest to break.
 * The command is a TEMPLATE the caller supplies; the loop substitutes the task's
 * file and id into it and runs it through the shell. Nothing here knows what
 * `claude`, `codex` or `aider` are, and the tests prove it by driving the whole
 * loop with a shell script as the agent. Hands are replaceable (fourth law).
 *
 * WHY IT SPAWNS ITS OWN CLI instead of importing `next` and `done`. Selection is
 * `next`'s policy and the gate is `done`'s, both already tested; a second caller
 * reaching inside them would eventually mean two answers to one question. The
 * loop therefore composes exactly as a user's shell loop would — `--json` in,
 * exit codes out — which is the fourth law applied to ourselves.
 *
 * NOT A DAEMON. The process lives for one run and ends: an empty queue, nothing
 * but claimed or blocked work left, or `--max-tasks`. Nothing is scheduled and
 * nothing survives the exit.
 *
 * HONEST FAILURE INSTEAD OF AN ENDLESS LOOP. A task whose contract keeps failing
 * is moved to the status this project protects with a reason (`blocked` here)
 * after `--max-attempts` tries, with the failing command IN the reason. The
 * board after a run says where it stopped and why, which is the promise that has
 * to hold when a local model gets stuck on task 7 of 20.
 *
 * WHERE THE AGENT'S OUTPUT GOES. One log file per task, OUTSIDE the repository,
 * in the same state directory the locks live in (TL-87): it is session state,
 * not data that should travel with a branch, and twenty tasks' worth of agent
 * chatter on the terminal would hide the report.
 *
 * Tests: `node --test scripts/tests/run.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { repoRootFor } from "./done-task.mjs";
import { recordEdit } from "./history.mjs";
import { lockScope, releaseLock, stateRoot } from "./lock.mjs";
import { callerSpecies, queueStatuses, selectCandidates, servesExecutor } from "./next-task.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { loadPlanForDispatch, planState } from "./plan.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { inProgressStatus, rebuildViews, todayStamp } from "./take-task.mjs";
import { ACTOR_NAMESPACES, buildFieldSpecs, extractMeta, fieldSpec, isValidActor, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords, splitList, unknownFilterValues } from "./task-select.mjs";
import { MARK, color, failure, warn } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, "cli.mjs");

/**
 * The environment variable that carries the agent command when no flag does.
 *
 * A fact about the caller's MACHINE, so it is deliberately not a key in the
 * project's config.yaml: the third law makes the layers disjoint, and the user
 * layer that would hold it does not exist yet (TL-34).
 *
 * `BACKLOG_` and not the product's name, like `BACKLOG_DIR` and
 * `BACKLOG_STATE_DIR` before it, and like the actor variable named in `actor.mjs`. A variable set in somebody's shell profile is a
 * key in a file this tool does not own — the same class as the block marker in
 * their `.gitignore` — and naming it after a product that may still be renamed
 * would turn one rename into a silent no-op on every machine.
 */
export const AGENT_ENV = "BACKLOG_AGENT_COMMAND";

export const RUN_FLAGS = [
  "--dir", "--actor", "--agent", "--agent-for", "--max-attempts", "--max-tasks", "--timeout",
  "--log-dir", "--stuck-status", "--json", "--dry-run", "--plan",
  "--board", "--label", "--priority", "--epic",
];

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_SECONDS = 900;

/** PURE — resolves `run`'s arguments. Throws on a usage error. */
export function parseRunArgs(args) {
  const plan = {
    dir: null, actor: null, agent: null, agentFor: {}, json: false, dryRun: false, usePlan: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS, maxTasks: 0, timeout: DEFAULT_TIMEOUT_SECONDS,
    logDir: null, stuckStatus: null, board: null, label: null, priority: null, epic: null,
  };
  const numbers = { "--max-attempts": "maxAttempts", "--max-tasks": "maxTasks", "--timeout": "timeout" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--dry-run") { plan.dryRun = true; continue; }
    if (a === "--plan") { plan.usePlan = true; continue; }
    if (RUN_FLAGS.indexOf(a) >= 0) {
      const value = args[++i] || null;
      if (!value) throw new Error("`" + a + "` with no value");
      if (numbers[a]) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < (a === "--max-tasks" ? 1 : 1)) {
          throw new Error("`" + a + " " + value + "` is not a positive whole number");
        }
        plan[numbers[a]] = n;
        continue;
      }
      if (a === "--agent-for") {
        const at = value.indexOf("=");
        if (at <= 0) {
          throw new Error(
            "`--agent-for " + value + "` is not `<role>=<command>`\n" +
              "One role, one command, one flag — repeat it for each role you serve."
          );
        }
        const role = value.slice(0, at).trim();
        const command = value.slice(at + 1).trim();
        if (!command) throw new Error("`--agent-for " + role + "=` with no command");
        if (plan.agentFor[role]) {
          throw new Error(
            "`--agent-for " + role + "` given twice\n" +
              "Two commands for one role is two answers to one question; say which."
          );
        }
        plan.agentFor[role] = command;
        continue;
      }
      const key = { "--log-dir": "logDir", "--stuck-status": "stuckStatus" }[a] || a.slice(2);
      plan[key] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + RUN_FLAGS.join(" "));
    }
    throw new Error(
      "unexpected argument: " + a + "\n" +
        "`run` takes no task id — it empties the queue, and a dispatcher that is\n" +
        "told which task to run is a queue with the choosing put back in."
    );
  }
  return plan;
}

/**
 * The agent command for one task. PURE.
 *
 * Two placeholders and no more: the task's FILE (what every agent CLI wants to
 * be pointed at) and its ID (for a command that speaks in ids). An unknown
 * placeholder is left alone rather than blanked — silently deleting part of
 * somebody's command line is how a run does the wrong thing and reports success.
 */
/**
 * Which command serves this task. PURE.
 *
 * ONE QUEUE, SEVERAL HANDS (TL-98). `--agent` is the command for a task that
 * asks for nobody in particular; `--agent-for <role>=<cmd>` names one hand per
 * role. With no `--agent-for` at all the scalar serves EVERY task, which is the
 * behaviour before this existed, byte for byte.
 *
 * A ROLE WITH NO ENTRY IS NOT AN ERROR AND NOT A FALLBACK. It is the escalation:
 * "I have no analyst" is a fact about this deployment, and the task waits for
 * one — possibly a person. Falling back to the general command would hand a
 * specialist's task to whoever was left, which is the outcome `role:` exists to
 * prevent; failing would stop a queue that has other work it can do.
 *
 * @returns {string|null} the command, or null when nothing here serves that role
 */
export function agentFor(plan, role) {
  const wanted = String(role || "").trim();
  if (!wanted) return plan.agent || null;
  if (!Object.keys(plan.agentFor || {}).length) return plan.agent || null;
  return plan.agentFor[wanted] || null;
}

/** The roles this invocation serves, for `next --role`. Empty when the caller
 *  named none — and then no role filter is passed at all, so the queue behaves
 *  exactly as it did. PURE. */
export function servedRoles(plan) {
  return Object.keys(plan.agentFor || {}).sort();
}

/**
 * Open work this invocation cannot serve, counted per role. PURE.
 *
 * A SKIP IS NEVER SILENT. A task quietly left out is indistinguishable from an
 * empty queue, and the reader has no second place to look — the same class of
 * defect as a silent no-op. So the run reports "3 task(s) waiting for `analyst`
 * — no command was given for that role" and names the ids.
 */
/**
 * Open work this invocation may not be handed because of `executor:` (TL-113).
 * PURE.
 *
 * The same rule as `waitingForRole` and for the same reason: a skip nobody
 * names looks like an empty queue. The usual case is `executor: human` under an
 * `agent:` actor, and then this list IS the escalation — "N tasks are waiting
 * for you".
 */
export function waitingForExecutor(records, config, species) {
  const archived = new Set(config.archivedStatuses || []);
  const inProgress = config.inProgressStatus || null;
  const out = {};
  for (const t of records || []) {
    if (servesExecutor(t, species)) continue;
    if (archived.has(t.status) || t.status === inProgress) continue;
    (out[String(t.executor).trim()] = out[String(t.executor).trim()] || []).push(t.id);
  }
  return out;
}

export function waitingForRole(records, config, served) {
  const archived = new Set(config.archivedStatuses || []);
  const inProgress = config.inProgressStatus || null;
  const serving = new Set(served);
  const out = {};
  for (const t of records || []) {
    const role = String(t.role || "").trim();
    if (!role || serving.has(role)) continue;
    if (archived.has(t.status) || t.status === inProgress) continue;
    (out[role] = out[role] || []).push(t.id);
  }
  return out;
}

export function renderAgentCommand(template, task) {
  return String(template)
    .split("{task_file}").join(task.file)
    .split("{id}").join(task.id);
}

/**
 * What the agent is handed on stdin: the task, and — from the second attempt on
 * — what the gate refused last time.
 *
 * The feedback is the point. An agent that is told only "try again" repeats
 * itself; the failing command and its output are the difference between a
 * second attempt and a second identical attempt.
 */
export function agentInput(taskText, feedback) {
  if (!feedback) return taskText;
  return [
    taskText,
    "",
    "---",
    "",
    "THE PREVIOUS ATTEMPT DID NOT CLOSE THIS TASK.",
    "`" + N + " done` ran the `verification:` contract and refused. What it said:",
    "",
    feedback.trim(),
    "",
    "Fix the cause, not the contract.",
    "",
  ].join("\n");
}

/** The sentence written into the history when a task is blocked by a run. It
 *  states the EVIDENCE — how many attempts, and what failed — never a verdict
 *  about the work. PURE, so a test can assert the words somebody will read. */
export function blockedReason(attempts, detail) {
  const head = "no verification after " + attempts + " agent attempt" + (attempts === 1 ? "" : "s");
  const tail = String(detail || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  return tail ? head + ": " + tail : head;
}

/** The word the DEFAULT vocabulary uses for work that has stopped. Not a fact
 *  about any project — the same standing as DEFAULT_IN_PROGRESS_STATUS, and used
 *  the same way: only when the project actually declares this status. */
export const DEFAULT_STUCK_STATUS = "blocked";

/**
 * Which status a task that will not close is moved into. PURE.
 *
 * THE ONE PROPERTY THAT MAKES IT SAFE: the status must be one this dispatcher
 * does NOT hand out. Park a task somewhere `next` still selects from and the
 * loop takes it straight back, spends the attempts again and parks it again —
 * a queue that never empties, which is the failure this task exists to rule
 * out. `queueStatuses()` is where that question is already answered, so the
 * check reads it rather than restating it.
 *
 * THREE SOURCES, IN THIS ORDER, and none of them invents a word:
 *
 *   --stuck-status        the caller said it. Validated against `statuses`, and
 *                         refused if it is archived or still dispatched.
 *   the project's own     `reason_required_statuses` minus `archived_statuses`.
 *   declaration           That list is exactly "the statuses you may not enter
 *                         without saying why", which is what this is, and
 *                         `next` already refuses to hand those out. Used when it
 *                         leaves exactly one — two candidates is a question, not
 *                         a default.
 *   the default word      `blocked`, and only if this backlog declares it AND
 *                         does not dispatch it. A backlog that renamed its
 *                         statuses gets a refusal instead of a value it never
 *                         chose.
 *
 * `cancelled` is never reached by this: abandoning a task is a decision a loop
 * does not get to make, and closing one it could not verify would be the lie the
 * whole gate exists to prevent.
 *
 * @returns {{status: string}|{error: string, details: string[]}}
 */
export function stuckStatus(config, requested) {
  const archived = new Set(config.archivedStatuses || []);
  const dispatched = new Set(queueStatuses(config));
  const parkable = (s) => !archived.has(s) && !dispatched.has(s);
  const stillDispatched = (s) => [
    "`" + s + "` is a status this backlog still hands out — `next` would take the task",
    "straight back and the run would never end.",
    "Name it in `reason_required_statuses` in config.yaml: a task parked with a stated",
    "reason is one an unattended dispatcher must not pick up again.",
  ];

  if (requested) {
    if ((config.statuses || []).indexOf(requested) < 0) {
      return { error: "`--stuck-status " + requested + "` is not one of this backlog's `statuses`",
        details: ["statuses: " + (config.statuses || []).join(", ")] };
    }
    if (archived.has(requested)) {
      return { error: "`--stuck-status " + requested + "` is an ARCHIVED status",
        details: ["A run that could not verify a task may not close it — that is the one thing the gate is for."] };
    }
    if (dispatched.has(requested)) {
      return { error: "`--stuck-status " + requested + "` would be handed straight back", details: stillDispatched(requested) };
    }
    return { status: requested };
  }

  const declared = (config.reasonRequiredStatuses || []).filter(parkable);
  if (declared.length === 1) return { status: declared[0] };
  if (declared.length > 1) {
    return { error: "more than one status could mean `stuck` here: " + declared.join(", "),
      details: ["Name one with `--stuck-status <status>` — choosing for you would be inventing your vocabulary."] };
  }
  const fallback = DEFAULT_STUCK_STATUS;
  if ((config.statuses || []).indexOf(fallback) >= 0) {
    if (parkable(fallback)) return { status: fallback };
    if (dispatched.has(fallback)) {
      return { error: "there is nowhere to park a task this run cannot finish", details: stillDispatched(fallback) };
    }
  }
  return { error: "this backlog has no status a stuck task can be parked in",
    details: [
      "statuses: " + (config.statuses || []).join(", "),
      "It has to be one that is neither archived nor handed out by `next`.",
      "Declare it in `reason_required_statuses` in config.yaml, or name one with `--stuck-status`.",
    ] };
}

/** Where one task's agent output is kept — outside the repository, beside the
 *  locks, keyed the same way so two backlogs cannot share a file. */
export function logPathFor(root, id, opts = {}) {
  const dir = opts.logDir || join(stateRoot(opts.env || process.env), "runs", lockScope(root).key);
  mkdirSync(dir, { recursive: true });
  return join(dir, id + ".log");
}

function cli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...(opts.env || {}) },
    timeout: opts.timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Move a task to the status this project protects, with a stated reason.
 *
 * Written here rather than by shelling out because no command sets an arbitrary
 * status — and that is deliberate, not an omission: `take` and `done` exist so
 * that a status is a CONSEQUENCE of an act. This is the third such act, and it
 * writes through the same door as `take` (`setFrontmatterField` + `recordEdit`),
 * never with a regex over the file.
 */
export function blockTask(opts) {
  const { root, config, id, actor, reason, status } = opts;
  const paths = backlogPaths(root);
  const record = readTaskRecords(paths.tasksDir, config.taskId.file)
    .find((t) => String(t.id).toUpperCase() === String(id).toUpperCase());
  if (!record) return { ok: false, message: "no task " + id + " in " + paths.tasksDir };

  const file = join(paths.tasksDir, record.file.replace(/^tasks\//, ""));
  const raw = readFileSync(file, "utf8");
  const before = extractMeta(splitFrontmatter(raw).frontmatter);
  const specs = buildFieldSpecs(config);
  const now = opts.now || Date.now();
  let text = raw;
  try {
    text = setFrontmatterField(text, "status", status, fieldSpec("status", specs));
    text = setFrontmatterField(text, "updated", todayStamp(now));
  } catch (e) {
    return { ok: false, message: id + ": " + e.message };
  }
  writeFileSync(file, text, "utf8");
  recordEdit(root, {
    taskId: record.id,
    before,
    after: extractMeta(splitFrontmatter(text).frontmatter),
    actor,
    ts: new Date(now).toISOString(),
    source: "run",
    reason,
  });
  return { ok: true, status, file };
}

/**
 * One task, from the claim it arrives with to a result. PURE of argument
 * parsing and of the queue: it is handed one task and returns what happened.
 */
/** The verification entry that refused, named the way the task file names it.
 *  PURE. Null when the refusal happened before anything ran. */
export function failedEntry(verdict) {
  const failed = ((verdict && verdict.entries) || []).filter((e) => e && e.ok === false).pop();
  if (!failed) return null;
  const command = String(failed.command || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return failed.id ? failed.id + ": " + command : command;
}

function workOne(ctx, task) {
  const logPath = logPathFor(ctx.root, task.id, { logDir: ctx.plan.logDir, env: process.env });
  writeFileSync(logPath, "", "utf8");
  let feedback = "";
  let failure = "";
  let attempts = 0;
  const started = Date.now();

  for (let attempt = 1; attempt <= ctx.plan.maxAttempts; attempt++) {
    attempts = attempt;
    const command = renderAgentCommand(task.command, task);
    appendFileSync(logPath, "=== attempt " + attempt + ": " + command + "\n", "utf8");
    const agent = spawnSync(command, {
      shell: true,
      cwd: ctx.cwd,
      encoding: "utf8",
      input: agentInput(task.text, feedback),
      timeout: ctx.plan.timeout * 1000,
      maxBuffer: 64 * 1024 * 1024,
    });
    appendFileSync(logPath, (agent.stdout || "") + (agent.stderr || ""), "utf8");

    // A killed process is not a failed one: `spawnSync` reports the timeout as a
    // signal, and calling that "the agent said no" would send the gate looking
    // for work nobody did.
    const timedOut = agent.error && agent.error.code === "ETIMEDOUT";
    if (timedOut) {
      appendFileSync(logPath, "\n=== the agent was killed after " + ctx.plan.timeout + "s\n", "utf8");
      feedback = "the agent was killed after " + ctx.plan.timeout + "s (`--timeout`)";
      failure = feedback;
      continue;
    }

    const closing = cli(["done", task.id, "--dir", ctx.root, "--actor", ctx.actor, "--json"]);
    appendFileSync(logPath, "\n=== done: exit " + closing.status + "\n" + (closing.stderr || ""), "utf8");
    if (closing.status === 0) {
      return { id: task.id, outcome: "closed", attempts, ms: Date.now() - started, log: logPath };
    }
    const verdict = parseJson(closing.stdout) || {};
    // A `manual:` entry is not something a further attempt can change: it asks a
    // PERSON, and this loop is the case where there is none. Retrying would burn
    // the whole budget to arrive at the same sentence.
    if (verdict.reason === "manual-needs-person" || verdict.reason === "no-contract" || verdict.reason === "criteria") {
      return {
        id: task.id, outcome: "needs-person", attempts, ms: Date.now() - started, log: logPath,
        detail: verdict.refusal || "`" + N + " done` refused: " + verdict.reason,
      };
    }
    feedback = (closing.stderr || "").trim() || (verdict.refusal || "the contract did not pass");
    // The REASON gets the entry that failed, not the first line of the refusal:
    // "verification failed (exit 1)" is what a reader already knows by the time
    // they are looking at a blocked task. The agent still gets the whole output.
    failure = failedEntry(verdict) || String(feedback).split("\n")[0];
  }
  return { id: task.id, outcome: "exhausted", attempts, ms: Date.now() - started, log: logPath, detail: failure };
}

function renderReport(report, plan) {
  const lines = [];
  const tally = report.tally;
  lines.push("");
  lines.push("  " + report.taken.length + " task(s) taken · " + tally.closed + " closed · " +
    tally.blocked + " blocked · " + Math.round(report.ms / 1000) + "s");
  lines.push("");
  for (const r of report.taken) {
    const mark = r.outcome === "closed" ? MARK.ok : MARK.warn;
    lines.push("  " + mark + " " + r.id + "  " + r.outcome + "  " + r.attempts +
      " attempt" + (r.attempts === 1 ? "" : "s") + "  " + Math.round(r.ms / 1000) + "s");
    lines.push("      " + color.dim(r.log));
    if (r.detail) lines.push("      " + color.dim(String(r.detail).split("\n")[0]));
  }
  if (!report.taken.length) lines.push("  " + color.dim(MARK.bullet + " nothing was taken"));
  const waitingRoles = Object.keys(report.waiting || {}).sort();
  if (waitingRoles.length) {
    lines.push("");
    lines.push("  waiting for a role this run does not serve:");
    for (const role of waitingRoles) {
      const ids = report.waiting[role];
      lines.push("    " + MARK.warn + " " + ids.length + " task(s) ask for `" + role +
        "` — no `--agent-for " + role + "=…` was given");
      lines.push("      " + color.dim(ids.join(", ")));
    }
  }
  const waitingExecutors = Object.keys(report.waitingExecutor || {}).sort();
  if (waitingExecutors.length) {
    lines.push("");
    lines.push("  waiting for an executor this run is not:");
    for (const kind of waitingExecutors) {
      const ids = report.waitingExecutor[kind];
      lines.push("    " + MARK.warn + " " + ids.length + " task(s) ask for `executor: " + kind + "`");
      lines.push("      " + color.dim(ids.join(", ")));
    }
  }
  lines.push("");
  lines.push("  " + color.dim("stopped: " + report.stopped));
  if (plan.dryRun) lines.push("  " + color.dim("`--dry-run`: no agent was run and nothing was claimed"));
  return lines.join("\n");
}

export function run(argv) {
  let plan;
  try {
    plan = parseRunArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " run", head, rest, [N + " run --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    console.error(failure(N + " run", "the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
    ], [N + " run --help"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " run", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);

  // A role in the map that the project does not declare is a typo, and it fails
  // BEFORE the loop starts: found in the middle of a run it would have wasted
  // every task up to it (third law — the map is the user's layer, the vocabulary
  // is the project's, and the consistency between them is checked at the seam).
  const unknownRoles = servedRoles(plan).filter((r) => (config.roles || []).indexOf(r) < 0);
  if (unknownRoles.length) {
    console.error(failure(N + " run", "`--agent-for` names role(s) this backlog does not declare: " + unknownRoles.join(", "),
      (config.roles || []).length
        ? ["`roles` in config.yaml holds: " + config.roles.join(", ")]
        : ["This backlog declares no `roles:` in config.yaml, so no task can ask for one."],
      [N + " run --help"]));
    return 2;
  }

  // The plan is read BEFORE the loop starts, for the same reason as the roles
  // above: a missing plan found at the first `next` would have cost a claim, a
  // spawned agent and a log file before anybody was told the order was never
  // followed (TL-183).
  let planned = null;
  if (plan.usePlan) {
    const loaded = loadPlanForDispatch(backlogPaths(root).planPath);
    if (loaded.error) {
      console.error(failure(N + " run", loaded.error, loaded.details, [N + " run --help"]));
      return 2;
    }
    planned = loaded.plan;
  }

  plan.agent = plan.agent || process.env[AGENT_ENV] || null;
  if (!plan.agent && !plan.dryRun) {
    console.error(failure(N + " run", "no agent command — this tool does not have one of its own", [
      "Pass `--agent \"<command>\"` or set " + AGENT_ENV + ".",
      "`{task_file}` and `{id}` are substituted; the task, and the last refusal,",
      "arrive on stdin. Examples of the SHAPE, not a recommendation:",
      "  " + MARK.bullet + " \"claude -p @{task_file}\"",
      "  " + MARK.bullet + " \"codex exec\"",
      "",
      "It is a fact about your machine, so it is deliberately not a key in this",
      "project's config.yaml — the layers are disjoint (third law).",
    ], [N + " run --help"]));
    return 2;
  }

  const filters = {
    status: null,
    priority: splitList(plan.priority),
    board: splitList(plan.board),
    label: splitList(plan.label),
    epic: splitList(plan.epic),
  };

  // A FILTER VALUE OUTSIDE THE VOCABULARY IS A TYPO, and here a typo is worse
  // than in `query`: it does not answer zero, it answers "nothing to take" —
  // exit 3, which the loop protocol treats as an empty queue and stops on
  // (TL-161). The vocabularies are the project's, read from its configuration.
  const unknownValues = unknownFilterValues(filters, config);
  if (unknownValues.length) {
    console.error(failure(N + " run",
      "`" + unknownValues[0].value + "` is not an allowed value for the field `" + unknownValues[0].axis + "`",
      unknownValues.map((p) => "allowed for `" + p.axis + "`: " + p.allowed.join(" | ") + "   (" + p.where + ")"),
      [N + " run --help"]));
    return 2;
  }

  const passthrough = [];
  for (const key of ["board", "label", "priority", "epic"]) {
    if (plan[key]) passthrough.push("--" + key, plan[key]);
  }
  // The loop does not resolve the wave itself and must not: `next` re-reads the
  // plan against the tree on every iteration, so a wave finished by the task
  // just closed is left behind at once. A wave computed here would be the one
  // that was active when the run started.
  if (planned) passthrough.push("--plan");
  // The roles are pushed into the SELECTION rather than filtered after it. A
  // task claimed and then skipped would be left `in_progress` under this run's
  // actor with nobody working on it — the dispatcher must not hand out what this
  // invocation cannot serve.
  const served = servedRoles(plan);
  if (served.length) {
    passthrough.push("--role", served.join(","));
    filters.role = served.concat([""]);
  }

  // `--dry-run` asks WHICH tasks, in what order, and must not claim any of them.
  // The order comes from `next`'s own selection function rather than from a
  // second implementation of the policy — the same module, not a copy of it.
  if (plan.dryRun) {
    const records = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
    const base = { ...filters, callerSpecies: callerSpecies(actor) };
    const rows = [];
    if (planned) {
      // WAVE BY WAVE, FROM THE ACTIVE ONE ON. A single call would show only the
      // wave `next` hands out of right now, which answers "what is next" and not
      // "what order would this run follow" — and the order is the whole reason
      // somebody passes `--plan` to a dry run.
      const state = planState(planned, records, {
        archivedStatuses: config.archivedStatuses,
        inProgressStatus: inProgressStatus(config),
      });
      const from = state.activeWave === null ? state.waves.length : state.activeWave;
      for (const w of state.waves.slice(from)) {
        const planIds = new Set(w.tasks.map((e) => String(e.id).toUpperCase()));
        const { candidates } = selectCandidates(records, config, { ...base, planIds }, Date.now());
        for (const t of candidates) rows.push({ task: t, wave: w.index + 1, name: w.name });
      }
    } else {
      const { candidates } = selectCandidates(records, config, base, Date.now());
      for (const t of candidates) rows.push({ task: t, wave: null, name: "" });
    }
    const shown = plan.maxTasks ? rows.slice(0, plan.maxTasks) : rows;
    if (plan.json) {
      console.log(JSON.stringify({
        ok: true, dryRun: true, agent: plan.agent, plan: planned ? true : false,
        order: shown.map((r) => ({
          id: r.task.id, priority: r.task.priority, status: r.task.status, file: r.task.file,
          ...(planned ? { wave: r.wave, waveName: r.name } : {}),
        })),
        considered: rows.length,
      }, null, 2));
    } else {
      console.log("");
      console.log("  " + shown.length + " task(s) would run, in this order:");
      let heading = null;
      for (const r of shown) {
        if (planned && r.wave !== heading) {
          heading = r.wave;
          console.log("    " + color.dim("wave " + r.wave + " — " + (r.name || "unnamed")));
        }
        console.log((planned ? "      " : "    ") + MARK.bullet + " " + r.task.id + "  " +
          r.task.priority + "  " + r.task.title);
      }
      console.log("");
      if (planned) {
        console.log("  " + color.dim(
          "a task whose blockers are still open is not listed — a later wave grows as the earlier ones close"
        ));
      }
      console.log("  " + color.dim("`--dry-run`: nothing was claimed and no agent was run"));
    }
    return 0;
  }

  const stuck = stuckStatus(config, plan.stuckStatus);
  if (stuck.error) {
    console.error(failure(N + " run", stuck.error, stuck.details, [N + " run --help"]));
    return 2;
  }

  // The SAME answer `done` uses for where a contract runs. Two answers to "which
  // directory is this repository" would show up as an agent writing its result
  // where the verification does not look.
  const cwd = repoRootFor(root);
  const ctx = { root, config, actor, cwd, plan };

  const started = Date.now();
  const taken = [];
  const tally = { closed: 0, blocked: 0 };
  let stopped = "the queue is empty";
  const seen = new Set();

  for (;;) {
    if (plan.maxTasks && taken.length >= plan.maxTasks) {
      stopped = "--max-tasks " + plan.maxTasks;
      break;
    }
    const handed = cli(["next", "--dir", root, "--actor", actor, "--json"].concat(passthrough));
    if (handed.status === 3) break;
    if (handed.status !== 0) {
      console.error(handed.stderr || handed.stdout);
      stopped = "`" + N + " next` refused (exit " + handed.status + ")";
      break;
    }
    const task = parseJson(handed.stdout);
    if (!task || !task.id) {
      stopped = "`" + N + " next` answered with something this loop cannot read";
      break;
    }
    // A dispatcher that hands out the same id twice has a defect; a loop that
    // does not notice has an endless one. Better to stop and say so than to
    // spend a night proving it.
    if (seen.has(task.id)) {
      stopped = task.id + " was handed out twice — the loop stopped rather than spin";
      break;
    }
    seen.add(task.id);

    const role = String((task.task && task.task.role) || "").trim();
    const command = agentFor(plan, role);
    if (!command) {
      // Belt and braces: the selection above already excludes these, so arriving
      // here means the dispatcher and this loop disagree — and a task claimed
      // with nobody to work it must not be left claimed.
      releaseLock({ root, taskId: task.id, actor });
      stopped = task.id + " asks for role `" + role + "`, which no `--agent-for` serves";
      break;
    }
    const result = workOne(ctx, { id: task.id, file: task.file, text: task.text || "", command });
    result.role = role;
    if (result.outcome === "closed") {
      tally.closed++;
    } else {
      const reason = blockedReason(result.attempts, result.detail);
      const blocked = blockTask({ root, config, id: task.id, actor, reason, status: stuck.status });
      if (!blocked.ok) {
        console.error(warn(task.id + ": " + blocked.message));
      } else {
        tally.blocked++;
        result.status = blocked.status;
      }
      // The reservation goes back whatever happened: `done` releases it when it
      // closes a task, and a task nobody closed would otherwise stay reserved
      // until its TTL — invisible to the very next run.
      releaseLock({ root, taskId: task.id, actor });
    }
    taken.push(result);
  }

  if (!rebuildViews(root)) {
    console.error(warn("the views were not rebuilt — run `" + N + " build` yourself"));
  }

  // Counted from the tree AFTER the run: what is left that this invocation had
  // no hand for. It is not an error and not a failure — it is the escalation,
  // and naming it is the whole point (a silent skip looks like an empty queue).
  const leftover = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  const waiting = served.length ? waitingForRole(leftover, config, served) : {};
  const waitingExecutor = waitingForExecutor(leftover, config, callerSpecies(actor));

  const report = { taken, tally, ms: Date.now() - started, stopped, waiting, waitingExecutor };
  if (plan.json) {
    console.log(JSON.stringify({
      ok: true, dryRun: false, agent: plan.agent, agentFor: plan.agentFor, stopped,
      waitingForRole: Object.keys(waiting).sort().map((r) => ({ role: r, count: waiting[r].length, ids: waiting[r] })),
      waitingForExecutor: Object.keys(waitingExecutor).sort()
        .map((e) => ({ executor: e, count: waitingExecutor[e].length, ids: waitingExecutor[e] })),
      tally: { ...tally, taken: taken.length },
      ms: report.ms,
      tasks: taken.map((r) => ({
        id: r.id, outcome: r.outcome, attempts: r.attempts, ms: r.ms, log: r.log,
        role: r.role || "", status: r.status || null, detail: r.detail || null,
      })),
    }, null, 2));
  } else {
    console.log(renderReport(report, plan));
  }
  // A run that blocked something is still a run that finished. The tally says
  // what happened; an exit code that called it a failure would make an unattended
  // loop indistinguishable from a broken invocation.
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("run-loop.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
