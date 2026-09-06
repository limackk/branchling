#!/usr/bin/env node
/** Return this actor's claimed task to the queue (TL-304). */
import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { handoffTask, rebuildViews } from "./handoff-task.mjs";
import { ACTOR_NAMESPACES, isValidActor } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

export const RELEASE_FLAGS = ["--dir", "--actor", "--reason", "--status", "--json"];

export function parseReleaseArgs(args) {
  const plan = { id: null, dir: null, actor: null, reason: null, status: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { plan.json = true; continue; }
    if (RELEASE_FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (!value) throw new Error("`" + arg + "` with no value");
      plan[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\nknown flags: " + RELEASE_FLAGS.join(" "));
    if (plan.id) throw new Error("two task ids: " + plan.id + ", " + arg);
    plan.id = arg;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " release <ID> --reason \"…\"");
  if (!plan.reason) throw new Error("`--reason` is required — a task put down without why is abandoned, not released");
  return plan;
}

export function run(argv) {
  let plan;
  const wantsJson = argv.includes("--json");
  const refuse = (message, details = [], code = 1, refusalKind = "refused") => {
    if (wantsJson) printJson("task-release", { ok: false, refusalKind, refusal: message, details });
    else console.error(failure(N + " release", message, details, [N + " release --help"]));
    return code;
  };
  try { plan = parseReleaseArgs(argv); }
  catch (e) { return refuse(e.message, [], 2, "usage"); }
  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) return refuse("the actor `" + actor + "` has no valid namespace", ["Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")], 2, "usage");
  let root;
  try { root = resolveBacklogDir({ dir: plan.dir || undefined }).root; }
  catch (e) { return refuse(e.message, [], 2, "usage"); }
  const config = loadConfigOrExit(root);
  if (plan.status && (config.statuses.indexOf(plan.status) < 0 || config.archivedStatuses.indexOf(plan.status) >= 0)) {
    return refuse("`--status` must name an open status in this backlog", [], 2, "usage");
  }
  const result = handoffTask({ root, config, id: plan.id, actor, reason: plan.reason, status: plan.status });
  if (!result.ok) return refuse(result.message, result.details || [], result.kind === "not-found" ? 2 : 1, result.kind || "refused");
  rebuildViews(root);
  if (plan.json) printJson("task-release", { ok: true, id: result.id, status: result.after.status, owner: result.after.owner, released: result.released, comment: result.comment.id });
  else console.log("✓ " + result.id + " released — " + result.before.status + " → " + result.after.status + "; owner cleared");
  return 0;
}
if (process.argv[1] && process.argv[1].endsWith("release-task.mjs")) process.exit(run(process.argv.slice(2)));
