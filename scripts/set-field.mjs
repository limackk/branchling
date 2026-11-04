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
import { actorRequiredRefusal, resolveActorReport } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { DEDICATED_FIELDS, writableFields, writeTaskField } from "./field-write.mjs";
import { FIELD_SHAPES } from "./task-fields.mjs";
import { rebuildViews } from "./handoff-task.mjs";
import { printJson } from "./json-envelope.mjs";
import { BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND, isBacklogDirRefusal, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

export const SET_FLAGS = ["--dir", "--actor", "--reason", "--json", "--fields", "--require-actor"];

/** PURE: the invocation, or an Error whose second line onward is the detail. */
export function parseSetArgs(args) {
  const plan = { id: null, field: null, value: null, dir: null, actor: null, reason: null, json: false, fields: false, requireActor: false };
  const positional = [];
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (literal) { positional.push(arg); continue; }
    if (arg === "--") { literal = true; continue; }
    if (arg === "--json") { plan.json = true; continue; }
    if (arg === "--fields") { plan.fields = true; continue; }
    if (arg === "--require-actor") { plan.requireActor = true; continue; }
    if (SET_FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + arg + "` with no value");
      plan[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") throw new Error("unknown flag: " + arg + "\navailable: " + SET_FLAGS.join(" "));
    positional.push(arg);
  }
  if (plan.fields) {
    if (positional.length || plan.actor !== null || plan.reason !== null || plan.requireActor) {
      throw new Error("`--fields` describes what `set` edits, and takes no task, field, value, --actor, --reason or --require-actor");
    }
    return plan;
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

/**
 * The fields `set` edits, as data (TL-543). PURE.
 *
 * `vocabulary` is the config.yaml key a value MUST come from — the key
 * `vocabulary --json` answers under — or null when the field takes free text,
 * task ids or a vocabulary the tool fixes; `values` carries such a fixed one.
 * `suggestions` names a key whose values are offered but not enforced. A
 * consumer that hard-coded this list could only compare it, in a test, with a
 * sentence in a usage refusal.
 *
 * @returns {{name: string, list: boolean, clearable: boolean, vocabulary: string|null,
 *            suggestions: string|null, values: string[]|null}[]}
 */
export function setFieldDescriptions(config) {
  const shapes = new Map(FIELD_SHAPES.map((shape) => [shape.key, shape]));
  return writableFields(config, Object.keys(DEDICATED_FIELDS)).map((spec) => {
    const shape = shapes.get(spec.key) || {};
    const list = spec.kind === "list";
    let vocabulary = null;
    if (spec.dynamic === "boards") vocabulary = "boards";
    else if (spec.dictionary && (list ? spec.closed : (spec.kind === "enum" && !spec.fixed))) vocabulary = spec.dictionary;
    let suggestions = shape.suggestFrom || null;
    if (!suggestions && list && spec.dictionary && !spec.closed) suggestions = spec.dictionary;
    return {
      name: spec.key,
      list,
      clearable: list || !!spec.allowEmpty,
      vocabulary,
      suggestions,
      values: spec.fixed ? spec.options.slice() : null,
    };
  });
}

export function run(argv) {
  const wantsJson = argv.includes("--json");
  // Null until the actor is resolved: a usage refusal has no actor to report a
  // source for.
  let actorSource = null;
  const refuse = (message, details = [], code = 1, refusalKind = "refused", extra = {}) => {
    if (wantsJson) printJson("task-set", { ok: false, actorSource, refusalKind, refusal: message, details, ...extra });
    else console.error(failure(N + " set", message, details, [N + " set --help"]));
    return code;
  };
  let plan;
  try { plan = parseSetArgs(argv); }
  catch (e) {
    const [head, ...rest] = e.message.split("\n");
    return refuse(head, rest, 2, "usage");
  }
  // WHERE THE ACTOR CAME FROM travels with the answer (TL-544). `--fields`
  // writes nothing and so has no actor. A field a person edits through an
  // interface refuses the default under `--require-actor`.
  let actor = null;
  if (!plan.fields) {
    const resolved = resolveActorReport(plan.actor);
    actor = resolved.actor;
    actorSource = resolved.actorSource;
    const required = actorRequiredRefusal(plan.requireActor, resolved, "sets the field");
    if (required) return refuse(required.refusal, required.details, 1, required.refusalKind);
  }
  let root;
  try { root = resolveBacklogDir({ dir: plan.dir || undefined }).root; }
  catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return refuse(e.message, e.details || [], BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND);
  }
  const config = loadConfigOrExit(root);
  if (plan.fields) {
    const fields = setFieldDescriptions(config);
    if (plan.json) printJson("task-set-fields", { root, fields });
    else {
      for (const f of fields) {
        console.log(f.name.padEnd(16) + (f.list ? "list" : "value").padEnd(7) +
          (f.vocabulary ? "from " + f.vocabulary : f.values ? "one of " + f.values.join(", ") : "free") +
          (f.suggestions ? " · suggested from " + f.suggestions : "") + (f.clearable ? " · clearable" : ""));
      }
    }
    return 0;
  }
  const result = writeTaskField({
    root, config, source: "set",
    id: plan.id, field: plan.field, value: plan.value,
    actor, reason: plan.reason || "",
    refusedFields: Object.keys(DEDICATED_FIELDS),
  });
  if (!result.ok) {
    // An invocation that names nothing writable, or no task, is the caller's to
    // fix (2); a reason the status demands, or a failed record, is a refusal (1).
    const code = result.kind === "usage" || result.kind === "dedicated" || result.kind === "not-found" ? 2 : 1;
    // An `unknown-value` is a refusal (1): a value a person typed, answered
    // with what was rejected and what is declared (TL-543).
    const extra = result.kind === "unknown-value" ? { rejected: result.rejected, declared: result.declared } : {};
    return refuse(result.message, result.details || [], code, result.kind, extra);
  }
  rebuildViews(root);
  if (plan.json) {
    printJson("task-set", {
      ok: true, id: result.id, file: result.file, field: result.field, value: result.value,
      actor: result.actor, actorSource, changes: result.entries,
    });
  } else {
    const shown = Array.isArray(result.value) ? "[" + result.value.join(", ") + "]" : JSON.stringify(result.value);
    const moved = result.entries.find((e) => e.field === result.field);
    console.log("✓ " + result.id + " " + result.field + " = " + shown + (moved ? "" : " (unchanged)"));
  }
  return 0;
}
if (process.argv[1] && process.argv[1].endsWith("set-field.mjs")) process.exitCode = run(process.argv.slice(2));
