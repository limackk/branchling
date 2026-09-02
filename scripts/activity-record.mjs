#!/usr/bin/env node
/**
 * `activity record` — one heartbeat, from anywhere (TL-28).
 *
 * THE CORE MUST NOT REQUIRE AN ADAPTER (§7 of docs/backlog-time-tracking.md — a
 * real path, product-name: allow). Everything that produces heartbeats — the
 * Claude Code hook shipped beside this file, a git hook, a shell prompt,
 * WakaTime, an editor nobody has written yet — is a thin plugin on top of an
 * ordinary command that reads flags and stdin. If the measurement depended on
 * one host, the module would be that host's feature rather than the tool's, and
 * every other host would have to be added to the core to be supported at all.
 *
 * STDIN IS A HINT, FLAGS ARE AN INSTRUCTION. A hook payload is JSON the host
 * chose the shape of: `session_id`, `tool_name`, `tool_input.file_path`, `cwd`.
 * It fills in what the caller did not say, and never overrides what they did —
 * a program piping a payload can still state the task outright, and it then
 * wins, because a statement is not an inference.
 *
 * A THROTTLED CALL SUCCEEDS. Exit 0 with nothing written is the normal case, not
 * an error: the adapter fires on every tool invocation by design (§7), so a
 * non-zero exit for "already counted this minute" would paint an error banner
 * over most of somebody's editing session.
 *
 * Exit: 0 recorded or throttled · 1 a refusal about the task · 2 the invocation
 * was wrong.
 *
 * Tests: `node --test scripts/tests/attribution.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTIVITY_KINDS, appendActivity } from "./activity.mjs";
import { attribute, currentBranch } from "./attribution.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { readFocus, sessionId, SESSION_ENV, throttleCheck, throttleMark } from "./focus.mjs";
import { isValidActor } from "./history.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = ["record"];

const RECORD_FLAGS = [
  "--task", "--kind", "--actor", "--session", "--source", "--file", "--branch",
  "--no-throttle", "--json", "--dir",
];

/** PURE — resolves `activity record`'s arguments. Throws on a usage error. */
export function parseRecordArgs(args) {
  const plan = {
    task: null, kind: "tool", actor: null, session: null, source: null,
    file: null, branch: null, throttle: true, json: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--no-throttle") { plan.throttle = false; continue; }
    if (a === "--task" || a === "--kind" || a === "--actor" || a === "--session" ||
        a === "--source" || a === "--file" || a === "--branch") {
      const value = args[++i];
      if (!value) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    // An unknown FLAG fails rather than being ignored — the rule the whole CLI
    // holds to, and here it matters more than usual: this command is wired into
    // a hook, so a silently dropped flag would produce a log that looks complete
    // and measures something else.
    throw new Error("unknown flag: " + a + "\nknown flags: " + RECORD_FLAGS.join(" "));
  }
  if (ACTIVITY_KINDS.indexOf(plan.kind) < 0) {
    throw new Error(
      "unknown kind `" + plan.kind + "` — one of: " + ACTIVITY_KINDS.join(", ")
    );
  }
  return plan;
}

/**
 * The host's payload, when there is one. Never throws: a malformed payload is
 * the host's problem, and failing here would turn every tool call into an error.
 */
export function readPayload(opts = {}) {
  const isTty = opts.isTty === undefined ? Boolean(process.stdin.isTTY) : opts.isTty;
  if (isTty) return {};
  try {
    const text = opts.text === undefined ? readFileSync(0, "utf8") : opts.text;
    if (!String(text).trim()) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** What a hook payload contributes, in the tool's own vocabulary. PURE. */
export function signalsFromPayload(payload) {
  const p = payload || {};
  return {
    session: String(p.session_id || p.sessionId || "").trim() || null,
    file: (p.tool_input && (p.tool_input.file_path || p.tool_input.filePath)) || null,
    cwd: p.cwd || null,
    tool: p.tool_name || p.toolName || null,
  };
}

/**
 * Decide and write one row. Returns a RESULT rather than exiting, so a test can
 * drive it and the dispatcher can decide what the outcome prints as.
 *
 * @param {{root: string, config: object, plan: object, payload?: object,
 *          env?: object, now?: number, run?: Function}} opts
 */
export function record(opts) {
  const { root, config, plan } = opts;
  const env = opts.env || process.env;
  const now = opts.now || Date.now();
  const hints = signalsFromPayload(opts.payload);

  const actor = plan.actor || env.BACKLOG_ACTOR || "agent:claude";
  if (!isValidActor(actor)) {
    return {
      ok: false, kind: "actor",
      message: "the actor `" + actor + "` has no valid namespace",
      details: ["one of `local:`, `agent:` or `user:` — an actor without one is refused"],
    };
  }

  // TWO SESSION KEYS, AND THEY ARE NOT INTERCHANGEABLE.
  //
  // `focusSession` is the one `take` wrote its auto-focus under, so it may only
  // ever come from the ENVIRONMENT: `take` is run by the person or the agent and
  // has no way to learn the host's internal session id. Reading the focus under
  // the payload's id instead would key the write and the read differently, and
  // leg 2 of the chain would then never fire — silently, looking exactly like a
  // session that had not taken a task.
  //
  // `session` is what goes ON THE ROW, and there the host's id is the better
  // answer: clustering (§6 rule 3) needs to tell two sessions apart, and the
  // derived key cannot do that for two runs in one checkout.
  const focusSession = sessionId({ env, root });
  const session = plan.session || hints.session || focusSession;
  const scopedEnv = { ...env, [SESSION_ENV]: focusSession };

  const patterns = taskIdPatterns(config.taskId.prefix);
  let task = plan.task;
  let attribution = "declared";
  if (!task) {
    const decided = attribute({
      env,
      focus: readFocus(root, { env: scopedEnv }),
      filePath: plan.file || hints.file,
      branch: plan.branch || currentBranch(root, { run: opts.run }),
    }, patterns);
    task = decided.task;
    attribution = decided.attribution;
  }

  if (!task) {
    // `unknown` is an ANSWER (§8.2) — but a row with no task is not a row at
    // all, because `task` is what the file is keyed by. Nothing is written and
    // the caller is told, so the gap is visible instead of being a silence.
    return {
      ok: true, wrote: false, why: "unattributed", session, actor,
      message: "no leg of the chain named a task — nothing recorded",
    };
  }

  const key = task + "|" + plan.kind;
  const seconds = config.heartbeatThrottleSeconds;
  if (plan.throttle) {
    const gate = throttleCheck(root, key, seconds, { env: scopedEnv, now });
    if (!gate.allowed) {
      return {
        ok: true, wrote: false, why: "throttled", task, session, actor,
        message: task + ": already counted " + Math.round(gate.since) + "s ago (window " + seconds + "s)",
      };
    }
  }

  const [entry] = appendActivity(root, task, [{
    ts: new Date(now).toISOString(),
    task, kind: plan.kind, actor,
    source: plan.source || (hints.tool ? "hook" : "cli"),
    session, attribution,
  }]);
  throttleMark(root, key, seconds, { env: scopedEnv, now });
  return { ok: true, wrote: true, task, session, actor, attribution, entry };
}

function renderRecord(result, opts = {}) {
  const paint = opts.color || color;
  if (!result.wrote) {
    return paint.dim(MARK.bullet + " " + result.message);
  }
  return paint.ok(MARK.ok) + " " + result.task + " — " + result.entry.kind +
    " " + paint.dim("(" + result.attribution + ", session " + result.session + ")");
}

export function main(argv) {
  const sub = argv[0];
  if (SUBCOMMANDS.indexOf(sub) < 0) {
    console.error(failure(N + " activity", sub ? "unknown subcommand: " + sub : "no subcommand",
      ["known: " + SUBCOMMANDS.join(", ")], [N + " activity --help"]));
    return 2;
  }

  const cli = takeDirFlag(argv.slice(1));
  let plan;
  try {
    plan = parseRecordArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity record", head, rest, [N + " activity --help"]));
    return 2;
  }

  const payload = readPayload();
  let root;
  try {
    root = resolveBacklogDir({
      dir: cli.dir || undefined,
      cwd: signalsFromPayload(payload).cwd || undefined,
      moduleDir: __dirname,
    }).root;
  } catch (e) {
    console.error(failure(N + " activity record", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);

  const result = record({ root, config, plan, payload });
  if (!result.ok) {
    console.error(failure(N + " activity record", result.message, result.details || []));
    return 1;
  }
  if (plan.json) {
    console.log(JSON.stringify(result.entry || { wrote: false, why: result.why, task: result.task || null }, null, 2));
    return 0;
  }
  console.log(renderRecord(result));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("activity-record.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
