#!/usr/bin/env node
/** Return this actor's claimed task to the queue (TL-304). */
import { actorRequiredRefusal, resolveActorReport } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { handoffTask, rebuildViews } from "./handoff-task.mjs";
import { ACTOR_NAMESPACES, isValidActor } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND, isBacklogDirRefusal, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";
import { DEPLOY_SUBCOMMANDS } from "./deploy-command.mjs";

export const RELEASE_FLAGS = ["--dir", "--actor", "--reason", "--status", "--json", "--require-actor"];
/** The flags that take no value — `releaseSubject` must not skip a word after them. */
const BARE_FLAGS = ["--json", "--require-actor"];

export function parseReleaseArgs(args) {
  const plan = { id: null, dir: null, actor: null, reason: null, status: null, json: false, requireActor: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { plan.json = true; continue; }
    if (arg === "--require-actor") { plan.requireActor = true; continue; }
    if (RELEASE_FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (!value) throw new Error("`" + arg + "` with no value");
      plan[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\navailable: " + RELEASE_FLAGS.join(" "));
    if (plan.id) throw new Error("two task ids: " + plan.id + ", " + arg);
    plan.id = arg;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " release <ID> --reason \"…\"");
  if (!plan.reason) throw new Error("`--reason` is required — a task put down without why is abandoned, not released");
  return plan;
}

/**
 * The positional word of a `release` line, skipping the values of its flags —
 * so `--reason status` is a reason and not a misplaced subcommand. PURE.
 */
export function releaseSubject(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (BARE_FLAGS.indexOf(arg) >= 0) continue;
    if (RELEASE_FLAGS.indexOf(arg) >= 0) { i++; continue; }
    if (!arg.startsWith("-")) return arg;
  }
  return null;
}

export function run(argv) {
  let plan;
  const wantsJson = argv.includes("--json");
  // Null until the actor is resolved: a refusal before that point (a usage
  // error, a deploy subcommand) has no actor to report a source for.
  let actorSource = null;
  const refuse = (message, details = [], code = 1, refusalKind = "refused") => {
    if (wantsJson) printJson("task-release", { ok: false, actorSource, refusalKind, refusal: message, details });
    else console.error(failure(N + " release", message, details, [N + " release --help"]));
    return code;
  };
  // `release` returns a task to the queue and means nothing else (TL-513). The
  // deployment subcommands moved to `deploy` before any version shipped them,
  // so there is no alias: a word that would keep working would keep `release`
  // naming two unrelated acts. It fails as an id that names no task would —
  // before `--reason` is demanded, which would send the reader the wrong way —
  // and says where the command went.
  const subject = releaseSubject(argv);
  if (subject && DEPLOY_SUBCOMMANDS.indexOf(subject) >= 0) {
    return refuse("no task " + subject + " — `release` only returns a claimed task to the queue",
      ["what was `release " + subject + "` is `" + N + " deploy " + subject + "`"], 2, "not-found");
  }
  try { plan = parseReleaseArgs(argv); }
  catch (e) {
    // The message's SECOND line is the available set, and it belongs in the
    // details where `failure` indents it (TL-220) — handed over whole it printed
    // flush left and stopped looking like the other thirty-nine refusals.
    const [head, ...rest] = e.message.split("\n");
    return refuse(head, rest, 2, "usage");
  }
  // WHERE THE ACTOR CAME FROM travels with the answer (TL-544); a person
  // putting a task down through an interface refuses the default under
  // `--require-actor`, before anything is written.
  const resolved = resolveActorReport(plan.actor);
  const actor = resolved.actor;
  actorSource = resolved.actorSource;
  const required = actorRequiredRefusal(plan.requireActor, resolved, "releases the task");
  if (required) return refuse(required.refusal, required.details, 1, required.refusalKind);
  if (!isValidActor(actor)) return refuse("the actor `" + actor + "` has no valid namespace", ["Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")], 2, "usage");
  let root;
  try { root = resolveBacklogDir({ dir: plan.dir || undefined }).root; }
  catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return refuse(e.message, e.details || [], BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND);
  }
  const config = loadConfigOrExit(root);
  if (plan.status && (config.statuses.indexOf(plan.status) < 0 || config.archivedStatuses.indexOf(plan.status) >= 0)) {
    return refuse("`--status` must name an open status in this backlog", [], 2, "usage");
  }
  const result = handoffTask({ root, config, id: plan.id, actor, reason: plan.reason, status: plan.status });
  if (!result.ok) return refuse(result.message, result.details || [], result.kind === "not-found" ? 2 : 1, result.kind || "refused");
  rebuildViews(root);
  if (plan.json) printJson("task-release", { ok: true, id: result.id, status: result.after.status, owner: result.after.owner, released: result.released, comment: result.comment.id, actorSource });
  else console.log("✓ " + result.id + " released — " + result.before.status + " → " + result.after.status + "; owner cleared");
  return 0;
}
if (process.argv[1] && process.argv[1].endsWith("release-task.mjs")) process.exitCode = run(process.argv.slice(2));
