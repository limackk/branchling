#!/usr/bin/env node
/**
 * Set one task field from the command line (TL-521).
 *
 * The callable twin of the served viewer's POST /api/task: the same field
 * specs, the same reason rule, the same history record — because both call
 * `writeTaskField()` in `field-write.mjs`. What this command adds is only the
 * shell around it: flags, an actor resolved the way every other writing
 * command resolves one, and an exit code.
 *
 * The fields with dedicated commands (`DEDICATED_FIELDS`) are refused rather
 * than written: a status change here would skip the verification `done` runs
 * and the reservation `take` makes.
 */
import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { DEDICATED_FIELDS, writeTaskField } from "./field-write.mjs";
import { rebuildViews } from "./handoff-task.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

export const SET_FLAGS = ["--dir", "--actor", "--reason", "--json"];

/** PURE: the invocation, or an Error whose second line onward is the detail. */
export function parseSetArgs(args) {
  const plan = { id: null, field: null, value: null, dir: null, actor: null, reason: null, json: false };
  const positional = [];
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (literal) { positional.push(arg); continue; }
    if (arg === "--") { literal = true; continue; }
    if (arg === "--json") { plan.json = true; continue; }
    if (SET_FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + arg + "` with no value");
      plan[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") throw new Error("unknown flag: " + arg + "\navailable: " + SET_FLAGS.join(" "));
    positional.push(arg);
  }
  // The value may legitimately be empty (`epic ""` clears it), so the count is
  // what is checked, not truthiness.
  if (positional.length !== 3) {
    throw new Error("expected <ID> <field> <value>, got " + positional.length + " argument(s)\n" +
      "usage: " + N + " set <ID> <field> <value>");
  }
  [plan.id, plan.field, plan.value] = positional;
  return plan;
}

export function run(argv) {
  const wantsJson = argv.includes("--json");
  const refuse = (message, details = [], code = 1, refusalKind = "refused") => {
    if (wantsJson) printJson("task-set", { ok: false, refusalKind, refusal: message, details });
    else console.error(failure(N + " set", message, details, [N + " set --help"]));
    return code;
  };
  let plan;
  try { plan = parseSetArgs(argv); }
  catch (e) {
    const [head, ...rest] = e.message.split("\n");
    return refuse(head, rest, 2, "usage");
  }
  let root;
  try { root = resolveBacklogDir({ dir: plan.dir || undefined }).root; }
  catch (e) { return refuse(e.message, [], 2, "usage"); }
  const config = loadConfigOrExit(root);
  const result = writeTaskField({
    root, config, source: "set",
    id: plan.id, field: plan.field, value: plan.value,
    actor: resolveActor(plan.actor), reason: plan.reason || "",
    refusedFields: Object.keys(DEDICATED_FIELDS),
  });
  if (!result.ok) {
    // An invocation that names nothing writable, or no task, is the caller's to
    // fix (2); a reason the status demands, or a failed record, is a refusal (1).
    const code = result.kind === "usage" || result.kind === "dedicated" || result.kind === "not-found" ? 2 : 1;
    return refuse(result.message, result.details || [], code, result.kind);
  }
  rebuildViews(root);
  if (plan.json) {
    printJson("task-set", {
      ok: true, id: result.id, file: result.file, field: result.field, value: result.value,
      actor: result.actor, changes: result.entries,
    });
  } else {
    const shown = Array.isArray(result.value) ? "[" + result.value.join(", ") + "]" : JSON.stringify(result.value);
    const moved = result.entries.find((e) => e.field === result.field);
    console.log("✓ " + result.id + " " + result.field + " = " + shown + (moved ? "" : " (unchanged)"));
  }
  return 0;
}
if (process.argv[1] && process.argv[1].endsWith("set-field.mjs")) process.exitCode = run(process.argv.slice(2));
