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
 * AN AGENT THAT NEVER STARTED COSTS THE TASK NOTHING (TL-184). "Did the agent
 * fail" and "did the agent RUN" are different questions, and only the first is a
 * fact about the task. An attempt that printed nothing on stdout and left the
 * tree byte-for-byte unchanged is not an attempt: the claim is given back — the
 * status the take moved it out of, and the reservation — the run STOPS rather
 * than handing the rest of the queue to a command that cannot start, and it
 * exits non-zero so that a cron entry does not read it as success.
 *
 * THE STUCK STATUS IS NEVER WRITTEN OVER AN ARCHIVED ONE (TL-191). The status a
 * task was taken in proves nothing by the time the attempts are over, so the
 * file is re-read at the write: a task that reached `archived_statuses` in the
 * meantime is reported as closed elsewhere and left exactly as it is.
 *
 * NOR OVER A TASK SOMEBODY ELSE NOW HOLDS (TL-192). The same re-read answers a
 * second question: `owner:`. A task taken over in another worktree, or handed to
 * a person, is no longer this run's to park — it is reported as held elsewhere,
 * counted apart from a task somebody closed, and left exactly as it is.
 *
 * A TASK THIS RUN'S OWN AGENT CLOSED IS CLOSED (TL-200). The refusal above is
 * also the success path for any project whose agents end in `done`, so the log
 * is asked WHO made the closing transition: the run's own actor means the work
 * was done here and the summary counts it as closed, anybody else means the
 * collision `closed-elsewhere` was named for. The per-task line keeps both
 * words and `--json` keeps both counts.
 *
 * WORKED, UNVERIFIED IS ITS OWN ENDING (TL-212). A contract whose last line is a
 * `manual:` entry can be satisfied to that line by an agent and still not close,
 * because the line asks a PERSON. That is not a failure and it is not work left
 * to do: parking it in the status this project protects with a reason files
 * finished work under "cannot move", and the person reading that queue then sees
 * a whole task where a signature is what is actually theirs. A backlog that names
 * an `awaiting_vouch_status` gets the task parked there instead, with the agent's
 * work standing; one that names none is unchanged, and told so.
 *
 * WHERE THE AGENT'S OUTPUT GOES. One log file per task, OUTSIDE the repository,
 * in the same state directory the locks live in (TL-87): it is session state,
 * not data that should travel with a branch, and twenty tasks' worth of agent
 * chatter on the terminal would hide the report.
 *
 * Tests: `node --test scripts/tests/run.test.mjs`, and
 * `scripts/tests/run-agent-launch.test.mjs` for the agent that never started.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { repoRootFor } from "./done-task.mjs";
import { readHistory, recordEdit } from "./history.mjs";
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
 * Why a `--plan` run has nothing left to take. PURE (TL-186).
 *
 * `next` answers exit 3 for several different facts, and the loop printed one
 * sentence for all of them: `the queue is empty`. That sentence is a claim about
 * the BACKLOG, and under `--plan` the backlog is usually not empty at all — the
 * plan's active wave is open and every one of its tasks is already in somebody's
 * hands, or the plan is finished while work it never scheduled is still waiting.
 * A run whose report cannot be believed is the TL-184 defect in prose.
 *
 * IT IS BUILT FROM `next`'s OWN ANSWER and never from a second reading of the
 * plan. The loop deliberately does not resolve the wave itself (see the
 * `passthrough` above), so describing a wave it had computed here would be
 * describing a different wave than the dispatcher refused from.
 *
 * ENDING THE RUN IS STILL RIGHT: this tool has no work for this session, and
 * waiting for a wave somebody else is finishing is a different feature. Only the
 * sentence changes.
 *
 * @param {object|null} answer the `task-take` envelope `next` printed on exit 3
 * @returns {string|null} the sentence, or null when that answer carries no plan
 */
export function planStop(answer) {
  const plan = answer && answer.plan;
  if (!plan) return null;
  // Never silent: open work this run stepped over is exactly the part a reader
  // would otherwise take "the queue is empty" to cover.
  //
  // THE TWO BRANCHES WORD IT DIFFERENTLY BECAUSE THE NUMBER MEANS TWO THINGS
  // (TL-219). `skippedUnplanned` counts the open tasks outside the ACTIVE WAVE,
  // which under an active wave includes everything the plan schedules LATER —
  // so "the plan does not schedule them" would be false here. With no active
  // wave there is no later, and an open task really is one the plan does not
  // schedule. The field's name is wrong, not this sentence; TL-219 owns that.
  const n = plan.skippedUnplanned;
  if (!plan.wave) {
    return "every wave of the plan is finished" +
      (n ? ", and " + n + " open task(s) the plan does not schedule were left alone" : "");
  }
  return "plan wave " + plan.wave + " (" + (plan.name || "unnamed") + ") is not finished — " +
    plan.open + " of " + plan.scheduled + " task(s) in it are still open and none was free to take" +
    (n ? ", and " + n + " open task(s) outside that wave were left alone" : "");
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

export function waitingForRole(records, config, served, servesRoleless = true) {
  const archived = new Set(config.archivedStatuses || []);
  const inProgress = config.inProgressStatus || null;
  const serving = new Set(served);
  const out = {};
  for (const t of records || []) {
    const role = String(t.role || "").trim();
    // THE ROLELESS REMAINDER IS ONE MORE UNSERVED AUDIENCE (TL-223), under the
    // empty key rather than a word of its own: a run with no `--agent` steps
    // over those tasks for exactly the reason it steps over a role nobody gave
    // a command for, and a reader counting what was left behind should not have
    // to look in two places. With a generalist there is nothing to report.
    if (!role) {
      if (servesRoleless) continue;
    } else if (serving.has(role)) continue;
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
 *
 * `ran` says whether the contract was REACHED. It is not decoration: several
 * refusals happen before a single command is executed (no contract at all, a
 * broken criterion link), and the agent is killed by `--timeout` before `done`
 * is even called. Telling that agent "the contract ran and refused" sends it
 * looking for a failing command that was never run — a sentence the loop knows
 * to be false, which is the worst kind to put in a prompt.
 */
export function agentInput(taskText, feedback, ran) {
  if (!feedback) return taskText;
  return [
    taskText,
    "",
    "---",
    "",
    "THE PREVIOUS ATTEMPT DID NOT CLOSE THIS TASK.",
    ran
      ? "`" + N + " done` ran the `verification:` contract and refused. What it said:"
      : "The `verification:` contract was never reached. What stopped the attempt:",
    "",
    feedback.trim(),
    "",
    "Fix the cause, not the contract.",
    "",
  ].join("\n");
}

/**
 * The sentence written into the history when a task is parked by a run. It
 * states the EVIDENCE — what stopped the run, and what failed — never a verdict
 * about the work. PURE, so a test can assert the words somebody will read.
 *
 * THE HEAD CLAUSE FOLLOWS THE OUTCOME, NOT ONLY THE COUNTER (TL-193). Two
 * different endings arrive here and only one of them is about the agent's work.
 * `exhausted` spent its attempts on a contract that ran and refused, and the
 * count is the reader's first question. `needs-person` never got that far: the
 * contract asks somebody to vouch, or the task FILE is what refused, and no
 * number of further attempts moves either. Saying "no verification after 1 agent
 * attempt" there blames the agent for a stop it had no part in — and a `reason`
 * is the one thing about a status change nobody can reconstruct afterwards, so
 * it is the wrong field to be approximately right in.
 *
 * The attempt count is deliberately dropped from that sentence rather than kept
 * as a second clause: it is a true number that answers nothing here, and a
 * reader who sees a count in a reason will read it as the cause.
 */
export function blockedReason(attempts, detail, outcome) {
  const head = outcome === "needs-person"
    ? "closing needs a person, not another agent attempt"
    : "no verification after " + attempts + " agent attempt" + (attempts === 1 ? "" : "s");
  const tail = String(detail || "").split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
  return tail ? head + ": " + tail : head;
}

/**
 * The sentence written into the history when a run parks a task as awaiting a
 * person's vouch (TL-212). PURE, for the same reason `blockedReason` is: the
 * words end up permanently in an append-only log and a test is entitled to
 * assert them without a tree.
 *
 * IT SAYS BOTH FACTS, and the first one is the one that was previously lost: the
 * agent's work STANDS. A reader who finds only "needs a person" has to open the
 * task to learn whether anything was done, which is exactly the reading cost
 * this status exists to remove.
 */
export function vouchReason(detail) {
  const head = "the agent's work stands; a `manual:` entry is waiting for a person to vouch";
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
  // The vouch status is parkable in every mechanical sense and still may not be
  // used here (TL-212): it says a person has to SIGN for finished work, and a
  // task that spent its attempts failing has none to sign for. Filing a failure
  // there would put it in front of the one reader whose queue is meant to be
  // thirty seconds of checking.
  const vouch = config.awaitingVouchStatus || null;
  const parkable = (s) => !archived.has(s) && !dispatched.has(s) && s !== vouch;
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
    if (requested === vouch) {
      return { error: "`--stuck-status " + requested + "` is this backlog's `awaiting_vouch_status`",
        details: [
          "That status means the work is FINISHED and a person has to vouch for it.",
          "A task that spent its attempts without verification has nothing to vouch for,",
          "and filing it there would put a failure in the queue somebody skims in seconds.",
        ] };
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
 * WHO moved this task into the archived status it now carries (TL-200).
 *
 * The append-only log is the only witness: the file says a task is finished and
 * says nothing about who finished it, while every transition in
 * `backlog/history/` names its actor. The last status entry landing in
 * `archived_statuses` is that transition — read with `readHistory`, which is
 * also what `history` reads, so a de-duplicated log is de-duplicated here too.
 *
 * "" when the log cannot answer — a task closed before the log existed, a
 * missing file, a status a person set by hand and nothing recorded. The caller
 * must read that as "not us": an unattributed closure is exactly the case for
 * the cautious word, not for crediting a run that may have had no part in it.
 */
function archivedBy(root, id, archived) {
  const closings = readHistory(root, id)
    .filter((e) => e && e.field === "status" && archived.has(e.to));
  const last = closings[closings.length - 1];
  return last ? String(last.actor || "") : "";
}

/**
 * Write a status the RUN decided on, with a stated reason.
 *
 * Written here rather than by shelling out because no command sets an arbitrary
 * status — and that is deliberate, not an omission: `take` and `done` exist so
 * that a status is a CONSEQUENCE of an act. The run performs two such acts and
 * both come through here: parking a task that spent its attempts in the status
 * this project protects, and giving a claim back untouched when the agent never
 * started (TL-184). Both write through the same door as `take`
 * (`setFrontmatterField` + `recordEdit`), never with a regex over the file.
 *
 * The two guards below serve both acts equally: whichever status the run arrived
 * at, a task somebody FINISHED in the meantime is not written over (TL-191), and
 * neither is one somebody else now HOLDS (TL-192).
 */
export function writeStatus(opts) {
  const { root, config, id, actor, reason, status } = opts;
  const paths = backlogPaths(root);
  const record = readTaskRecords(paths.tasksDir, config.taskId.file)
    .find((t) => String(t.id).toUpperCase() === String(id).toUpperCase());
  if (!record) return { ok: false, message: "no task " + id + " in " + paths.tasksDir };

  // THE FILE AS IT IS NOW, not the status the task was taken in (TL-191). The
  // record above was read from disk a moment ago, and that re-read is the whole
  // guard: between the claim and the last attempt the task may have reached an
  // archived status — the agent closing it itself, a person in another worktree,
  // a merge arriving, a second run. `done` RUNS the contract and is the only
  // thing entitled to say a task is finished; a stuck status written over that
  // would destroy a proven fact with an opinion formed from a refusal. So the
  // write is refused and the caller is told what it found. The vocabulary is the
  // project's — `archived_statuses` — never `done` spelled out here.
  const archived = new Set(config.archivedStatuses || []);
  if (archived.has(record.status)) {
    return {
      ok: false,
      reason: "closed-elsewhere",
      status: record.status,
      // WHO closed it, so the caller can tell the success path from the
      // collision (TL-200). The refusal is the same either way — nothing here
      // writes over a proven fact — but "the agent this run started closed it"
      // and "somebody else closed it while we worked" are not the same event,
      // and only the report can say so.
      closedBy: archivedBy(root, record.id, archived),
      message: id + " reached `status: " + record.status + "` while this run was working on it",
    };
  }

  // AND STILL OURS — the second question that same re-read answers (TL-192). The
  // guard above defends a PROVEN fact; this one defends a CLAIM. `take` writes
  // `owner:` at the claim and that line is the run's whole title to the task: a
  // file that now names somebody else — a takeover in another worktree, the work
  // handed to a person — or names nobody, is a file this run may not write a
  // status into, least of all with a reason about ITS agents. Nothing proven is
  // destroyed here and that is why it is a separate refusal, not a wider version
  // of the one above: the reader of a report has to be able to tell "somebody
  // finished it" from "somebody took it".
  //
  // THE TEST IS `owner:`, NOT THE STATUS THE RUN LEFT. The two were candidates
  // for the same sentence and they answer different questions: an owner is what
  // a claim IS, while a status is where the work stands. An agent that moves its
  // own task between two open statuses has not given it up, and a status test
  // would refuse to park exactly the task the run is still holding.
  //
  // A HANDOFF IS NOT AN EXCEPTION TO THIS RULE, it is its clearest case.
  // `handoff` deliberately CLEARS `owner:` when it passes work to a role, so an
  // agent that legitimately handed its task on leaves nobody holding it — and
  // parking it afterwards would undo the very act the agent was asked to
  // perform. Nobody is still not us.
  const owner = String(record.owner || "").trim();
  if (owner !== String(actor || "").trim()) {
    return {
      ok: false,
      reason: "held-elsewhere",
      status: record.status,
      owner,
      message: id + " is held by " + (owner || "nobody") + ", not by " + actor +
        " — this run's claim on it is gone",
    };
  }

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
    // The role this invocation dispatched the task on, when it had one (TL-222).
    // The run is the one writer that always knows it — `--agent-for` chose the
    // hand by exactly this value — and a parked task whose entry does not say
    // which hand tried is a record that cannot be read back into a stage.
    role: opts.role,
    reason,
  });
  return { ok: true, status, file };
}

/**
 * `git status --porcelain` over the repository, as one opaque string.
 *
 * `null` means the question COULD NOT BE ASKED — no git, or a tree that is not
 * a repository — and the one rule for reading it is that null is never "nothing
 * changed". A caller that treated an unanswerable question as evidence of
 * inaction would declare an agent dead on the strength of a missing binary.
 *
 * The string is never parsed. The only question asked of it is whether it is
 * the same before and after an attempt, which needs no understanding of the
 * format and stays right if git changes it.
 */
function treeState(cwd) {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || "");
}

/**
 * Did this task's agent ever run? PURE (both readings are taken by the caller).
 *
 * THE DISTINCTION IS NOT "DID THE AGENT FAIL" BUT "DID IT RUN" (TL-184). A task
 * whose contract fails after real work is a fact about the task and belongs in
 * its file; a task whose agent never started is a fact about the MACHINE and
 * belongs in the run report, nowhere else. Writing the second into the task file
 * is the tool telling a lie that survives the session — measured here on
 * 2026-09-03, when two 57-second attempts printing `Failed to authenticate:
 * OAuth session expired` parked a task as `blocked` with a reason describing
 * work nobody had done.
 *
 * Deliberately NOT a heuristic over exit codes: every agent uses them
 * differently, and a tool that is not an agent may not pretend to know which
 * code means "I could not start". The two signals below need no such knowledge.
 *
 *   · it said nothing on STDOUT — an agent that worked reports; the failed
 *     launch in the measurement wrote its one line to stderr, which is exactly
 *     where a shell puts `command not found` too, so stderr cannot count as
 *     having spoken.
 *   · the tree is byte-for-byte what it was when the task was CLAIMED — the
 *     baseline spans every attempt, not one of them, because an agent that
 *     worked once has run whatever a later attempt repeats.
 *
 * BOTH are required, and that is the safe direction: a false "never started"
 * would take a genuinely failing task out of the attempt budget that exists to
 * stop it looping forever. For the same reason an unknown tree (`null`) is not
 * an unchanged one.
 */
export function neverRan(stdout, before, after) {
  if (String(stdout || "").trim()) return false;
  if (before === null || after === null) return false;
  return before === after;
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

/**
 * The refusals from `done` that no further attempt can turn into a closure, and
 * the outcome each of them ends the task with.
 *
 * THE KEYS ARE `refusalKind` FROM THE ENVELOPE (`scripts/done-task.mjs`), which
 * is the published name — `scripts/json-envelope.mjs` says why that word and not
 * `kind`. This map used to be an inline comparison against `verdict.reason`, a
 * key nothing writes, so it matched nothing and every refusal below spent the
 * whole `--max-attempts` budget arriving at the same sentence (TL-190).
 *
 * What earns a place here is one property: the refusal happens BEFORE any
 * command runs, and no work an agent can do changes the answer.
 *
 *   · `manual-needs-person` — the contract asks a PERSON to vouch, and an
 *     unattended loop is exactly the case where there is none.
 *   · `no-contract`, `criteria` — the task file itself is the problem; an agent
 *     told to "fix the cause" would have to edit the contract it is measured by.
 *   · `already-closed` — the task is finished. `closed-elsewhere` rather than
 *     `needs-person` because nobody is needed: it is the outcome TL-191 gave the
 *     same situation found one step later, at the stuck-status write.
 *
 * Everything else stays retryable, including a contract that genuinely failed.
 */
export const TERMINAL_REFUSALS = {
  "manual-needs-person": "needs-person",
  "no-contract": "needs-person",
  "criteria": "needs-person",
  "already-closed": "closed-elsewhere",
};

function workOne(ctx, task) {
  const logPath = logPathFor(ctx.root, task.id, { logDir: ctx.plan.logDir, env: process.env });
  writeFileSync(logPath, "", "utf8");
  let feedback = "";
  let feedbackRan = false;
  let failure = "";
  let attempts = 0;
  const started = Date.now();
  // ONE reading, taken at the CLAIM and never refreshed (TL-184). Comparing an
  // attempt against the start of that same attempt looked equivalent and is not:
  // an agent whose second attempt writes the same bytes as its first leaves
  // `--porcelain` identical across it, and would be declared never started after
  // demonstrably having run. The question the loop actually needs answering is
  // whether ANY of this task's attempts moved the tree, so the baseline is where
  // the task was picked up.
  const treeAtTake = treeState(ctx.cwd);

  for (let attempt = 1; attempt <= ctx.plan.maxAttempts; attempt++) {
    attempts = attempt;
    const command = renderAgentCommand(task.command, task);
    appendFileSync(logPath, "=== attempt " + attempt + ": " + command + "\n", "utf8");
    const agent = spawnSync(command, {
      shell: true,
      cwd: ctx.cwd,
      encoding: "utf8",
      input: agentInput(task.text, feedback, feedbackRan),
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
      feedbackRan = false;
      failure = feedback;
      continue;
    }

    // An attempt that changed nothing and said nothing is not an attempt
    // (TL-184). It is reported with the attempts ACTUALLY made — none, on the
    // first — because counting it would spend against a budget that exists to
    // stop a failing task looping, and this task has not been tried yet.
    if (neverRan(agent.stdout, treeAtTake, treeState(ctx.cwd))) {
      const said = String(agent.stderr || "").trim().split("\n")[0] || "";
      appendFileSync(logPath,
        "\n=== the agent never ran: nothing on stdout and nothing changed in " + ctx.cwd + "\n", "utf8");
      return {
        id: task.id, outcome: "agent-never-ran", attempts: attempt - 1,
        ms: Date.now() - started, log: logPath, command,
        detail: said || "the agent printed nothing and changed nothing",
      };
    }

    const doneArgs = ["done", task.id, "--dir", ctx.root, "--actor", ctx.actor, "--json"];
    // The closing entry names the stage, not just the hand (TL-222). Only when
    // the task asked for a role: passing "" would be a role nobody declared.
    if (task.role) doneArgs.push("--role", task.role);
    const closing = cli(doneArgs);
    appendFileSync(logPath, "\n=== done: exit " + closing.status + "\n" + (closing.stderr || ""), "utf8");
    if (closing.status === 0) {
      return { id: task.id, outcome: "closed", attempts, ms: Date.now() - started, log: logPath };
    }
    const verdict = parseJson(closing.stdout) || {};
    const kind = String(verdict.refusalKind || "");
    if (TERMINAL_REFUSALS[kind]) {
      return {
        id: task.id, outcome: TERMINAL_REFUSALS[kind], attempts, ms: Date.now() - started, log: logPath,
        // THE KIND TRAVELS WITH THE RESULT, not only the outcome it maps to
        // (TL-212). Three refusals share the outcome `needs-person` and they do
        // not share an ending: a contract asking a person to VOUCH leaves work
        // that is finished, while a missing contract or a broken criterion link
        // leaves a task file nobody has written properly. The caller parks those
        // in two different places and cannot tell them apart from the outcome.
        refusalKind: kind,
        detail: verdict.refusal || "`" + N + " done` refused: " + kind,
      };
    }
    // Whether the agent gets told the contract ran is read off the envelope, not
    // guessed from the refusal: every shape of it carries `entries`, and an empty
    // one is the gate saying it stopped before executing anything.
    feedbackRan = Array.isArray(verdict.entries) && verdict.entries.length > 0;
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
    tally.blocked + " blocked · " +
    (tally.awaitingVouch ? tally.awaitingVouch + " awaiting a vouch · " : "") +
    (tally.closedElsewhere ? tally.closedElsewhere + " closed elsewhere · " : "") +
    (tally.heldElsewhere ? tally.heldElsewhere + " held elsewhere · " : "") +
    Math.round(report.ms / 1000) + "s");
  lines.push("");
  for (const r of report.taken) {
    // `closed-elsewhere` reads as an ok: the task IS closed, and the run's only
    // part in it was declining to write over that (TL-191). `held-elsewhere`
    // does NOT (TL-192): nothing was proven, the task is still open, and the
    // warning mark is what tells the eye those two are different endings.
    // `awaiting-vouch` reads as an ok for the same reason as the first (TL-212):
    // the work is finished and nothing about the run went wrong — what is left is
    // a signature, and a warning mark beside it would restate the very confusion
    // between "cannot move" and "needs thirty seconds" this ending removes.
    // `closed-by-agent` is an ok for the plainest reason of the four (TL-200):
    // this run's agent finished the work. The per-task line keeps the word, so
    // a reader can still see which hand closed it; the summary above does not,
    // because to the summary it is simply one closed task.
    const mark = r.outcome === "closed" || r.outcome === "closed-elsewhere" ||
      r.outcome === "awaiting-vouch" || r.outcome === "closed-by-agent" ? MARK.ok
      : r.outcome === "agent-never-ran" ? MARK.err : MARK.warn;
    lines.push("  " + mark + " " + r.id + "  " + r.outcome + "  " + r.attempts +
      " attempt" + (r.attempts === 1 ? "" : "s") + "  " + Math.round(r.ms / 1000) + "s");
    lines.push("      " + color.dim(r.log));
    if (r.detail) lines.push("      " + color.dim(String(r.detail).split("\n")[0]));
  }
  if (!report.taken.length) lines.push("  " + color.dim(MARK.bullet + " nothing was taken"));
  // THE FACT ABOUT THE MACHINE, SAID HERE AND NOWHERE ELSE (TL-184). The task
  // file carries nothing about this: no attempt was made, so there is nothing
  // about the task to record. The command is quoted in full because the reader's
  // next act is to run it themselves.
  const never = report.neverStarted;
  if (never) {
    lines.push("");
    lines.push("  " + MARK.err + " the agent command never ran — it printed nothing and changed nothing:");
    lines.push("      " + (never.command || "(no command)"));
    if (never.detail) lines.push("      " + color.dim(String(never.detail).split("\n")[0]));
    lines.push("      " + color.dim(
      never.status
        ? never.id + " was left in `" + never.status + "`, the status it was taken from"
        : never.id + " could not be given back — check its status by hand"
    ));
  }
  const waitingRoles = Object.keys(report.waiting || {}).sort();
  if (waitingRoles.length) {
    lines.push("");
    lines.push("  waiting for a role this run does not serve:");
    for (const role of waitingRoles) {
      const ids = report.waiting[role];
      // The roleless remainder comes through the same block under the empty key
      // (TL-223). It is named for what it is — those tasks ask for nobody in
      // particular — rather than as a role called "", which no reader would
      // recognise and no `--agent-for` could ever answer.
      lines.push("    " + MARK.warn + " " + ids.length + " task(s) " + (role
        ? "ask for `" + role + "` — no `--agent-for " + role + "=…` was given"
        : "ask for no role in particular — no `--agent` was given"));
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
  // A RUN OF SPECIALISTS IS A RUN (TL-223). `--agent` is the hand for tasks that
  // ask for no role, and a queue where every task asks for one needs no such
  // hand. Requiring it anyway made the arrangement `--agent-for` exists for the
  // one arrangement that could not be invoked. What is refused is a run with no
  // command of ANY kind, which is still what this message is about.
  if (!plan.agent && !Object.keys(plan.agentFor || {}).length && !plan.dryRun) {
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
  // A GENERALIST IS WHAT MAKES `--role r` MEAN `r OR NO ROLE` (TL-223). `next`
  // widens the filter that way on purpose, so a fleet of specialists does not
  // strand every roleless task; that widening is right exactly when this run has
  // a hand for the roleless ones. Without `--agent` it would hand out work this
  // invocation cannot serve — the thing the comment above forbids — so the
  // filter is narrowed to the roles themselves, with the flag `next` already
  // has for it.
  const generalist = !!plan.agent;
  if (served.length) {
    passthrough.push("--role", served.join(","));
    if (!generalist) passthrough.push("--role-strict");
    filters.role = generalist ? served.concat([""]) : served.slice();
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

  // Where a task whose contract ends in a `manual:` entry is parked (TL-212).
  // Null when this backlog has not declared one, and then nothing changes: such
  // a task goes where it went before, and the run says so once, per task, rather
  // than filing finished work under failure in silence.
  const vouchStatus = config.awaitingVouchStatus || null;

  const started = Date.now();
  const taken = [];
  // `closedByAgent` is a SUB-COUNT of `closed`, not a further ending beside it
  // (TL-200): a task the run's own agent closed is closed, and the summary line
  // says so. It is carried separately only because `--json` must still let a
  // caller tell which hand did it.
  const tally = { closed: 0, blocked: 0, awaitingVouch: 0, closedByAgent: 0, closedElsewhere: 0, heldElsewhere: 0 };
  let stopped = "the queue is empty";
  // The one result that ends the run without being a fact about a task (TL-184).
  let neverStarted = null;
  const seen = new Set();

  for (;;) {
    if (plan.maxTasks && taken.length >= plan.maxTasks) {
      stopped = "--max-tasks " + plan.maxTasks;
      break;
    }
    const handed = cli(["next", "--dir", root, "--actor", actor, "--json"].concat(passthrough));
    if (handed.status === 3) {
      // `nothing to take` is not `the backlog is empty`, and under `--plan` the
      // difference is the whole report (TL-186). The answer already carries the
      // wave and what was left alone; without the flag the sentence is untouched.
      const why = planned ? planStop(parseJson(handed.stdout)) : null;
      if (why) stopped = why;
      break;
    }
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
    const result = workOne(ctx, { id: task.id, file: task.file, text: task.text || "", command, role });
    result.role = role;
    if (result.outcome === "agent-never-ran") {
      // NOTHING WAS MEASURED, so nothing about the task may change (TL-184). The
      // claim is given back — the status the take moved it out of, and the
      // reservation — and the run stops rather than walking the queue: the next
      // task would meet the same wall, and an unattended loop that kept going
      // would hand the whole backlog to a command that cannot start.
      const from = String(task.from || "");
      if (from) {
        const given = writeStatus({
          root, config, id: task.id, actor, status: from, role,
          // The WHY of this write, which is a fact about the run and not about
          // the task: the agent's output stays in the report and the log, where
          // TL-184 says a fact about the machine belongs.
          reason: "the agent command never ran — the claim is given back, nothing about the task was measured",
        });
        if (given.ok) result.status = from;
        else console.error(warn(task.id + ": " + given.message));
      } else {
        console.error(warn(task.id + ": `" + N + " next` did not say which status it was taken from"));
      }
      releaseLock({ root, taskId: task.id, actor });
      neverStarted = result;
      taken.push(result);
      stopped = "the agent command never ran";
      break;
    }
    if (result.outcome === "closed") {
      tally.closed++;
    } else {
      // WORKED, UNVERIFIED IS NOT FAILED (TL-212). A contract that ends in a
      // `manual:` entry is one an agent can satisfy to the last automatic line
      // and still not close, because the last line asks for a person. Parking
      // that in the status this project protects with a reason says the work
      // failed, and the reader who acts on the panel then sees a whole task where
      // thirty seconds of checking is what is actually theirs.
      //
      // ONLY THIS ONE REFUSAL. `no-contract` and `criteria` share the outcome
      // `needs-person` and are the opposite case: nothing was verified because
      // the task FILE is not finished, and there is no work to vouch for.
      const toVouch = result.refusalKind === "manual-needs-person" && !!vouchStatus;
      if (result.refusalKind === "manual-needs-person" && !vouchStatus) {
        console.error(warn(task.id + ": its contract asks a person to vouch, and this backlog declares no " +
          "`awaiting_vouch_status` — parking it as `" + stuck.status + "`, which says the work failed"));
      }
      const reason = toVouch
        ? vouchReason(result.detail)
        : blockedReason(result.attempts, result.detail, result.outcome);
      const blocked = writeStatus({
        root, config, id: task.id, actor, reason, role, status: toVouch ? vouchStatus : stuck.status,
      });
      if (blocked.reason === "closed-elsewhere") {
        // NOT a failure of this run and not a task it may park: somebody closed
        // it while the agents were working (TL-191). It is counted apart from
        // both, because calling it `blocked` in the report would be the same lie
        // in prose that the refused write would have been in the tree.
        //
        // WHICH SOMEBODY, THOUGH (TL-200). If the closing transition names the
        // actor this run handed the task to, the somebody is this run's own
        // agent — the success path, and the one a project whose agents end in
        // `done` takes EVERY time. Reporting that as `0 closed` was a false
        // negative in the one field an unattended caller reads. The refusal
        // itself does not change: the run still writes nothing over a proven
        // fact, and it is only the accounting that learns to tell the two
        // endings apart.
        if (blocked.closedBy && blocked.closedBy === actor) {
          tally.closed++;
          tally.closedByAgent++;
          result.outcome = "closed-by-agent";
          result.status = blocked.status;
          result.detail = task.id + " was closed by " + blocked.closedBy +
            ", the actor this run handed it to — `" + N + " done` had nothing left to do";
        } else {
          tally.closedElsewhere++;
          result.outcome = "closed-elsewhere";
          result.status = blocked.status;
          result.detail = blocked.message;
        }
      } else if (blocked.reason === "held-elsewhere") {
        // A THIRD OUTCOME, and deliberately not the one above (TL-192). Both
        // refusals leave the tree alone, and there the resemblance ends: one
        // says the work is finished, this one says the work is still open and
        // somebody else is doing it. A reader who cannot tell them apart cannot
        // tell a run that finished its queue from one whose tasks were taken out
        // from under it. The detail carries WHO holds it, because that is the
        // reader's next question and the file will not be there to answer it.
        tally.heldElsewhere++;
        result.outcome = "held-elsewhere";
        result.status = blocked.status;
        result.detail = blocked.message;
      } else if (!blocked.ok) {
        console.error(warn(task.id + ": " + blocked.message));
      } else if (toVouch) {
        // Counted apart from `blocked` and that is the whole point (TL-212): a
        // summary line that adds the two together is the sentence the panel was
        // repeating — ten rows of "cannot move" for five tasks that only need a
        // signature.
        tally.awaitingVouch++;
        // A FOURTH ENDING, named like the other two the run distinguishes. The
        // outcome is only renamed once the park has actually happened: a backlog
        // that declares no vouch status ends the same task as `needs-person`,
        // which is still true of it, and nothing downstream reads an ending this
        // run did not reach.
        result.outcome = "awaiting-vouch";
        result.status = blocked.status;
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
  const waiting = served.length ? waitingForRole(leftover, config, served, !!plan.agent) : {};
  const waitingExecutor = waitingForExecutor(leftover, config, callerSpecies(actor));

  const report = { taken, tally, ms: Date.now() - started, stopped, waiting, waitingExecutor, neverStarted };
  if (plan.json) {
    console.log(JSON.stringify({
      // `ok` is about the RUN, not about the tasks: blocked work is a run that
      // finished, an agent that could not start is a run that did not (TL-184).
      ok: !neverStarted, dryRun: false, agent: plan.agent, agentFor: plan.agentFor, stopped,
      // The whole fact about the machine, in the one place it belongs: which
      // command was tried, what it said, and which status the task was given
      // back to. A consumer never has to parse the report's prose for it.
      agentNeverRan: neverStarted ? {
        id: neverStarted.id, command: neverStarted.command || null,
        output: neverStarted.detail || null, restoredTo: neverStarted.status || null,
      } : null,
      waitingForRole: Object.keys(waiting).sort().map((r) => ({ role: r, count: waiting[r].length, ids: waiting[r] })),
      waitingForExecutor: Object.keys(waitingExecutor).sort()
        .map((e) => ({ executor: e, count: waitingExecutor[e].length, ids: waitingExecutor[e] })),
      tally: { ...tally, taken: taken.length },
      ms: report.ms,
      tasks: taken.map((r) => ({
        id: r.id, outcome: r.outcome, attempts: r.attempts, ms: r.ms, log: r.log,
        role: r.role || "", status: r.status || null, detail: r.detail || null,
        command: r.command || null,
      })),
    }, null, 2));
  } else {
    console.log(renderReport(report, plan));
  }
  // A run that blocked something is still a run that finished. The tally says
  // what happened; an exit code that called it a failure would make an unattended
  // loop indistinguishable from a broken invocation.
  //
  // An agent that never started is the opposite case and exits non-zero (TL-184).
  // The measurement that produced this rule ended `1 blocked` with exit 0, which
  // in a cron entry reads as success — and an unattended queue is exactly where
  // nobody is left to read the report. 1 and not 2: the invocation was correct,
  // it is the machine that could not honour it.
  return neverStarted ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("run-loop.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
