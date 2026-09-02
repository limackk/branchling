#!/usr/bin/env node
/**
 * `activity` — the heartbeat log: writing to it, and giving it back (TL-28, TL-31).
 *
 * FIVE SUBCOMMANDS, TWO CONCERNS. `record` is the callable input every adapter
 * sits on; `prune`, `forget`, `reassign` and `report --privacy` are what the log
 * gives BACK — retention, erasure, correction, and one place a person can see
 * what the tool holds about them. They share a command because they share a
 * file, and because a module that collects with the erasure kept somewhere else
 * is one where the collecting ships first.
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
 *        `node --test scripts/tests/retention.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { ACTIVITY_KINDS, appendActivity } from "./activity.mjs";
import { forget, privacyReport, prune, reassignPreview } from "./activity-retention.mjs";
import { attribute, currentBranch } from "./attribution.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { readFocus, sessionId, SESSION_ENV, throttleCheck, throttleMark } from "./focus.mjs";
import { isValidActor } from "./history.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = ["record", "prune", "forget", "reassign", "report"];

const PRUNE_FLAGS = ["--days", "--dry-run", "--json", "--dir"];
const FORGET_FLAGS = ["--actor", "--dry-run", "--json", "--dir"];
const REASSIGN_FLAGS = ["--from", "--to", "--session", "--since", "--actor", "--reason", "--dry-run", "--json", "--dir"];
const REPORT_FLAGS = ["--privacy", "--json", "--dir"];

/** PURE — one parser shape for the four reading/erasing subcommands. Throws on
 *  a usage error, so an unknown flag FAILS rather than being dropped: these
 *  commands delete data, and a silently ignored `--dry-run` is the worst
 *  possible way for that rule to be broken. */
export function parseSubArgs(args, known, defaults) {
  const plan = { dryRun: false, json: false, ...defaults };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { plan.dryRun = true; continue; }
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--privacy") { plan.privacy = true; continue; }
    if (known.includes(a) && a.startsWith("--")) {
      const value = args[++i];
      if (!value) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    throw new Error("unknown flag: " + a + "\nknown flags: " + known.join(" "));
  }
  return plan;
}

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

/** The backlog directory and its configuration, or an exit code. */
function resolve(cliDir, payload) {
  let root;
  try {
    root = resolveBacklogDir({
      dir: cliDir || undefined,
      cwd: signalsFromPayload(payload).cwd || undefined,
      moduleDir: __dirname,
    }).root;
  } catch (e) {
    console.error(failure(N + " activity", e.message, []));
    return { code: 2 };
  }
  return { root, config: loadConfigOrExit(root) };
}

const minutes = (v) => (v >= 60 ? (Math.round((v / 60) * 10) / 10) + "h" : Math.round(v) + "m");

function runPrune(argv, cliDir) {
  let plan;
  try {
    plan = parseSubArgs(argv, PRUNE_FLAGS, { days: null });
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity prune", head, rest, [N + " activity --help"]));
    return 2;
  }
  const days = plan.days === null ? undefined : Number(plan.days);
  if (days !== undefined && (!Number.isFinite(days) || days < 0)) {
    console.error(failure(N + " activity prune", "`--days " + plan.days + "` is not a number of days", []));
    return 2;
  }
  const ctx = resolve(cliDir, {});
  if (ctx.code) return ctx.code;

  const result = prune(ctx.root, ctx.config, { days, dryRun: plan.dryRun });
  if (plan.json) { console.log(JSON.stringify(result, null, 2)); return 0; }
  console.log(heading("activity — retention", { color }));
  console.log("");
  console.log(table([
    ["  window", result.days + " day(s) (`activity_retention_days`)"],
    ["  cutoff", result.cutoff],
    ["  raw rows removed", String(result.removed)],
    ["  raw rows kept", String(result.kept)],
  ]));
  if (result.perTask.length) {
    console.log("");
    console.log(table(result.perTask.slice(0, 12).map((t) => ["    " + t.task, t.removed + " removed"])));
  }
  console.log("");
  console.log("  " + color.dim(result.dryRun
    ? "`--dry-run`: nothing was deleted and no aggregate was recomputed."
    : "The aggregates were recomputed from the FULL log BEFORE anything was deleted,"));
  if (!result.dryRun) {
    console.log("  " + color.dim("so the window did not eat the history it exists to make safe to keep."));
  }
  return 0;
}

function runForget(argv, cliDir) {
  let plan;
  try {
    plan = parseSubArgs(argv, FORGET_FLAGS, { actor: null });
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity forget", head, rest, [N + " activity --help"]));
    return 2;
  }
  if (!plan.actor) {
    console.error(failure(N + " activity forget", "`--actor <ns:name>` is required", [
      "Erasing without naming whose data it is would erase everybody's.",
    ], [N + " activity report --privacy"]));
    return 2;
  }
  const ctx = resolve(cliDir, {});
  if (ctx.code) return ctx.code;

  const result = forget(ctx.root, ctx.config, { actor: plan.actor, dryRun: plan.dryRun });
  if (plan.json) { console.log(JSON.stringify(result, null, 2)); return 0; }
  console.log(heading("activity — forget " + result.actor, { color }));
  console.log("");
  console.log(table([
    ["  raw rows removed", String(result.removed)],
    ["  raw rows left", String(result.kept)],
    ["  tasks touched", String(result.perTask.length)],
  ]));
  console.log("");
  if (result.dryRun) {
    console.log("  " + color.dim("`--dry-run`: not one byte was written. This command has no undo,"));
    console.log("  " + color.dim("which is why the preview is required rather than offered."));
  } else {
    console.log("  " + color.dim("The aggregates were recomputed WITHOUT these rows — an aggregate left"));
    console.log("  " + color.dim("standing over deleted rows is the data coming back at the next report."));
    console.log("  " + color.dim("This acts on a CLAIM: nothing here authenticates an actor."));
  }
  return 0;
}

function runReassign(argv, cliDir) {
  let plan;
  try {
    plan = parseSubArgs(argv, REASSIGN_FLAGS, { from: null, to: null, session: null, since: null, actor: null });
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity reassign", head, rest, [N + " activity --help"]));
    return 2;
  }
  for (const required of ["from", "to", "session"]) {
    if (!plan[required]) {
      console.error(failure(N + " activity reassign", "`--" + required + "` is required", [
        "A correction names the task the rows were on, the task they belong to,",
        "and the SESSION that was mismeasured. Without the session this is not a",
        "correction but a merge of everything ever recorded on that task.",
      ], [N + " activity reassign --from <ID> --to <ID> --session <s>"]));
      return 2;
    }
  }
  const ctx = resolve(cliDir, {});
  if (ctx.code) return ctx.code;

  const moving = reassignPreview(ctx.root, plan.from, plan.session, plan.since);
  if (!plan.dryRun) {
    try {
      appendActivity(ctx.root, plan.from, [{
        task: plan.from, to: plan.to, since: plan.since || "", session: plan.session,
        kind: "reassign", actor: plan.actor || process.env.BACKLOG_ACTOR || "agent:claude",
        source: "cli", attribution: "declared",
      }]);
    } catch (e) {
      console.error(failure(N + " activity reassign", e.message.split("\n")[0], e.message.split("\n").slice(1)));
      return 1;
    }
  }
  if (plan.json) {
    console.log(JSON.stringify({
      from: plan.from, to: plan.to, session: plan.session, since: plan.since || null,
      rows: moving.length, dryRun: plan.dryRun,
    }, null, 2));
    return 0;
  }
  console.log((plan.dryRun ? color.dim(MARK.bullet) : color.ok(MARK.ok)) + " " +
    moving.length + " row(s) " + (plan.dryRun ? "would move" : "move") + " from " +
    plan.from + " to " + plan.to + color.dim(" (session " + plan.session +
    (plan.since ? ", since " + plan.since : "") + ")"));
  console.log("  " + color.dim(plan.dryRun
    ? "`--dry-run`: nothing was appended."
    : "Written as a NEW row. Nothing on disk was edited — the reader applies it."));
  return 0;
}

function runReport(argv, cliDir) {
  let plan;
  try {
    plan = parseSubArgs(argv, REPORT_FLAGS, { privacy: false });
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity report", head, rest, [N + " activity --help"]));
    return 2;
  }
  if (!plan.privacy) {
    console.error(failure(N + " activity report", "`--privacy` is the only report there is", [
      "Minutes per task are `" + N + " time --engaged`. This one answers a different",
      "question: what does the tool hold about the people it measures.",
    ], [N + " activity report --privacy"]));
    return 2;
  }
  const ctx = resolve(cliDir, {});
  if (ctx.code) return ctx.code;

  const report = privacyReport(ctx.root, ctx.config);
  if (plan.json) { console.log(JSON.stringify(report, null, 2)); return 0; }
  console.log(heading("activity — what is kept, and for how long", { color }));
  console.log("");
  console.log(table([
    ["  mode", report.privacy + " (`activity_privacy`)"],
    ["  retention", report.retentionDays + " day(s) (`activity_retention_days`)"],
    ["  rows past the window now", report.oldestRow && report.oldestRow < report.cutoff ? "yes — run `activity prune`" : "none"],
    ["  raw rows on disk", String(report.rawRows)],
    ["  oldest row", report.oldestRow || "—"],
    ["  tasks measured", String(report.tasks)],
  ]));
  if (report.actors.length) {
    console.log("");
    console.log("  rows per actor:");
    console.log(table(report.actors.map((a) => ["    " + a.actor, String(a.count)])));
  }
  console.log("");
  console.log("  versioned — committed, and outlives the raw rows:");
  console.log(table(report.versioned.map((p) => ["    " + p, ""])));
  console.log("  NOT versioned — stays on this machine:");
  console.log(table(report.notVersioned.map((p) => ["    " + p, ""])));
  console.log("");
  console.log("  " + color.dim("To erase one person's rows: `" + N + " activity forget --actor <ns:name>`"));
  console.log("  " + color.dim("(with `--dry-run` first — there is no undo). To correct an attribution:"));
  console.log("  " + color.dim("`" + N + " activity reassign --from <ID> --to <ID> --session <s>`."));
  console.log("");
  console.log("  " + color.dim("This is a set of mechanisms, not a compliance claim. The legal basis,"));
  console.log("  " + color.dim("informing the people measured and any assessment stay with the deployer."));
  return 0;
}

export function main(argv) {
  const sub = argv[0];
  if (SUBCOMMANDS.indexOf(sub) < 0) {
    console.error(failure(N + " activity", sub ? "unknown subcommand: " + sub : "no subcommand",
      ["known: " + SUBCOMMANDS.join(", ")], [N + " activity --help"]));
    return 2;
  }

  const cli = takeDirFlag(argv.slice(1));
  if (sub === "prune") return runPrune(cli.argv, cli.dir);
  if (sub === "forget") return runForget(cli.argv, cli.dir);
  if (sub === "reassign") return runReassign(cli.argv, cli.dir);
  if (sub === "report") return runReport(cli.argv, cli.dir);

  let plan;
  try {
    plan = parseRecordArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " activity record", head, rest, [N + " activity --help"]));
    return 2;
  }

  const payload = readPayload();
  const ctx = resolve(cli.dir, payload);
  if (ctx.code) return ctx.code;

  const result = record({ root: ctx.root, config: ctx.config, plan, payload });
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

if (process.argv[1] && process.argv[1].endsWith("activity-command.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
