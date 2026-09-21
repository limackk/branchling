#!/usr/bin/env node
/**
 * `seed` — a whole backlog from ONE structured plan (TL-94).
 *
 * WHAT IT IS FOR. A plan arrives on stdin as JSON — a list of tasks with a
 * title, a goal, steps, dependencies and a closing contract — and this command
 * turns it into task files. After it, the backlog is ready to be worked without
 * anybody editing a file by hand: every task carries a runnable verification and
 * its dependencies are explicit, which is what `next` needs to hand work out.
 *
 * WHY THERE IS NO MODEL IN HERE. This is the fourth law applied literally
 * (docs/branchling-global-tool.md §3 — product-name: allow, a real path): a
 * writing command gets a callable input, and intelligence arrives from outside
 * through it rather than from in here. Turning prose into a plan is somebody
 * else's program — ours, in TL-95, or a stranger's. So this file imports
 * nothing that needs a network or a model, and the format below is PUBLIC
 * SURFACE: other people's adapters write to it.
 *
 * THE THREE DECISIONS WORTH KNOWING.
 *
 *   1. **A task with no runnable verification fails the WHOLE seed.** Not the
 *      one entry — the whole plan. That single field is the difference between a
 *      plan that can be worked unattended and a list of wishes, and a backlog
 *      seeded half-and-half would look finished while being unfinishable. The
 *      template's own placeholder counts as missing: a field filled in by the
 *      template was filled in by nobody.
 *   2. **Everything is validated before ANYTHING is written**, and every problem
 *      is reported at once. A partial seed is a state nobody ordered — and an
 *      adapter that retries (TL-95) needs the full list of complaints, not the
 *      first one.
 *   3. **The numbers belong to the tool.** A plan refers to its own items by
 *      LOCAL keys (`plan_id`); `seed` maps those onto the ids it allocates
 *      through the same route `new` uses. A plan may not name a TL-NNN, because
 *      the number that is free here is not free on somebody else's branch.
 *
 * THE ONE THING THIS COMMAND MAY LEAVE BEHIND ON A FAILURE is the result of
 * `init` on a directory that was not a backlog yet. That is deliberate: `init`
 * is idempotent and creates no tasks, so it cannot make a half-seeded backlog.
 * A write of a TASK is what is all-or-nothing here, and a failure part-way
 * through the writing pass removes the files this run created.
 *
 * Tests: `node --test scripts/tests/seed.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, isValidActor, isValidReason, recordCreation, reconcile } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { createTask, driftMessage, slugify } from "./new-task.mjs";
import {
  VERIFICATION_KEYS, contractFor, isNonEmptyString, isPlainObject, renderBody, taskContent,
  validateVerification,
} from "./task-input.mjs";
import { backlogPaths, looksLikeBacklogDir, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { buildFieldSpecs, fieldSpec, setFrontmatterField } from "./task-fields.mjs";
import { DEFAULT_TASK_ID_PREFIX, detectPrefixMismatch, prefixMismatchMessage } from "./task-id.mjs";
import { MARK, color, failure } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ──────────────────────────────────────────────────────────────────────────
// The plan format — public surface (README: "Seeding a backlog from a plan")
// ──────────────────────────────────────────────────────────────────────────

/**
 * The version of the INPUT contract.
 *
 * WHY IT IS NOT NAMED AFTER THE ENVELOPE'S OWN VERSION FIELD — the one the
 * `--json` output carries. That is a different contract, moving for different
 * reasons, and a caller piping a plan into `seed --json` would otherwise see one
 * word on both sides of the pipe meaning two things. One name, one contract:
 *   schemaVersion  the --json envelope   // envelope-version: allow
 *   planVersion    this document
 */
export const PLAN_VERSION = 1;

/** The keys the document itself may carry. `meta` is free-form and untouched —
 *  it is where an adapter records which model produced the plan (TL-95). */
const TOP_KEYS = ["planVersion", "meta", "tasks"];

/** The keys one plan item may carry. An unknown key FAILS, exactly as an unknown
 *  key in `config.yaml` and an unknown flag on the command line do: a plan whose
 *  typo is silently dropped is a plan whose author believes it was honoured. */
const ITEM_KEYS = [
  "plan_id", "title", "goal", "context", "steps", "blocked_by",
  "verification", "estimate", "priority",
];

/** A local key. Deliberately not the shape of a task id: `plan_id` must be
 *  impossible to confuse with `TL-1234`, so that a plan naming a real id reads
 *  as the mistake it is rather than resolving to somebody else's task. */
export const PLAN_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

// ──────────────────────────────────────────────────────────────────────────
// Arguments
// ──────────────────────────────────────────────────────────────────────────

const FLAGS = ["--dir", "--dry-run", "--json", "--actor", "--reason"];

/** PURE — resolves `seed`'s arguments. Throws on a usage error. */
export function parseSeedArgs(args) {
  let dryRun = false;
  let json = false;
  let actor = null;
  let reason = null;
  let from = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--dry-run") { dryRun = true; continue; }
    if (a === "--json") { json = true; continue; }
    if (a === "--from") {
      // The convenient route (TL-95): a description instead of a plan. The plan
      // still arrives through the same door — the adapter produces it and this
      // command validates and writes it — so `--from` is a shortcut, never a
      // second way in.
      from = args[++i] || null;
      if (!from) throw new Error("`--from` with no file\nit takes a project description: `" + N + " seed --from spec.md`");
      continue;
    }
    if (a === "--actor") {
      actor = args[++i] || null;
      if (!actor) throw new Error("`--actor` with no name");
      continue;
    }
    if (a === "--reason") {
      reason = args[++i] || null;
      if (!reason) throw new Error("`--reason` with no text");
      if (!isValidReason(reason)) {
        throw new Error(
          "`--reason " + reason + "` is reserved\n" +
            "`unknown` and `proven` are what the tool writes when nobody stated a reason\n" +
            "or when a run stood in for one. Typing them by hand would dress a machine's\n" +
            "answer up as yours."
        );
      }
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    throw new Error(
      "unexpected argument: " + a + "\nthe plan comes in on stdin: `" + N + " seed --dir <path> < plan.json`"
    );
  }
  if (actor && !isValidActor(actor)) {
    throw new Error(
      "the actor `" + actor + "` has no valid namespace\n" +
        "use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ") + "\n" +
        "the namespace says how much the attribution is worth — local: declared,\n" +
        "agent: automated, user: an authenticated account."
    );
  }
  return { dryRun, json, actor, reason, from };
}

// ──────────────────────────────────────────────────────────────────────────
// Reading and judging the plan — PURE, no filesystem
// ──────────────────────────────────────────────────────────────────────────

/** `tasks[2] (plan_id: build-cli)` — a position a reader can find in their own
 *  file. The index alone is not enough (an adapter regenerates the order); the
 *  key alone is not enough (it may be the thing that is missing). */
function where(index, item) {
  const key = item && typeof item.plan_id === "string" && item.plan_id ? " (plan_id: " + item.plan_id + ")" : "";
  return "tasks[" + index + "]" + key;
}

/**
 * Read the document and judge it whole.
 *
 * Every problem is collected — the caller prints the list and writes nothing.
 * Reporting only the first would turn a plan with three defects into three runs,
 * and for the adapter in TL-95 into three model calls.
 *
 * @returns {{plan: object|null, errors: string[]}}
 */
export function parsePlan(text) {
  const errors = [];
  let doc;
  try {
    doc = JSON.parse(String(text == null ? "" : text));
  } catch (e) {
    return { plan: null, errors: ["the plan is not valid JSON: " + e.message] };
  }
  if (!isPlainObject(doc)) {
    return {
      plan: null,
      errors: [
        "the plan must be a JSON object, not " + (Array.isArray(doc) ? "an array" : typeof doc),
        'expected: { "planVersion": 1, "tasks": [ … ] }',
      ],
    };
  }
  for (const key of Object.keys(doc)) {
    if (TOP_KEYS.indexOf(key) < 0) errors.push("unknown key `" + key + "` in the plan (known: " + TOP_KEYS.join(", ") + ")");
  }
  if (doc.planVersion !== undefined && doc.planVersion !== PLAN_VERSION) {
    errors.push(
      "`planVersion: " + JSON.stringify(doc.planVersion) + "` — this build reads plan version " + PLAN_VERSION
    );
  }
  if (!Array.isArray(doc.tasks)) {
    errors.push("`tasks` must be an array of plan items");
    return { plan: null, errors };
  }
  if (!doc.tasks.length) {
    errors.push("`tasks` is empty — there is nothing to seed");
    return { plan: null, errors };
  }

  errors.push(...validateItems(doc.tasks));
  return { plan: errors.length ? null : doc, errors };
}

/** Every complaint about the items, in file order. Exported for the tests, which
 *  ask about the judgement without going near a directory. */
export function validateItems(items) {
  const errors = [];
  const byPlanId = new Map();
  const byTitle = new Map();

  items.forEach((item, i) => {
    const at = where(i, item);
    if (!isPlainObject(item)) {
      errors.push("tasks[" + i + "] is not an object");
      return;
    }
    for (const key of Object.keys(item)) {
      if (ITEM_KEYS.indexOf(key) < 0) errors.push(at + ": unknown key `" + key + "` (known: " + ITEM_KEYS.join(", ") + ")");
    }

    if (!isNonEmptyString(item.plan_id)) {
      errors.push(at + ": `plan_id` is required — it is how the other items refer to this one");
    } else if (!PLAN_ID_RE.test(item.plan_id)) {
      errors.push(
        at + ": `plan_id: " + item.plan_id + "` — expecting lower case letters, digits, `-` and `_`. " +
          "A task id (" + DEFAULT_TASK_ID_PREFIX + "-123) is not a plan key: the numbers belong to the tool."
      );
    } else if (byPlanId.has(item.plan_id)) {
      errors.push(at + ": `plan_id` is already used by tasks[" + byPlanId.get(item.plan_id) + "]");
    } else {
      byPlanId.set(item.plan_id, i);
    }

    if (!isNonEmptyString(item.title)) {
      errors.push(at + ": `title` is required");
    } else {
      const key = item.title.trim().toLowerCase();
      if (byTitle.has(key)) errors.push(at + ": the same title as tasks[" + byTitle.get(key) + "] — two tasks nobody can tell apart");
      else byTitle.set(key, i);
      if (!slugify(item.title)) errors.push(at + ": no filename can be made from this title — at least one letter or digit is needed");
    }

    if (!isNonEmptyString(item.goal)) {
      errors.push(at + ": `goal` is required — a task whose reason for existing is not written down cannot be picked up by anybody else");
    }
    for (const key of ["context", "estimate", "priority"]) {
      if (item[key] !== undefined && !isNonEmptyString(item[key])) errors.push(at + ": `" + key + "` must be a non-empty string when given");
    }
    if (item.steps !== undefined) {
      if (!Array.isArray(item.steps)) errors.push(at + ": `steps` must be an array of strings");
      else item.steps.forEach((s, j) => {
        if (!isNonEmptyString(s)) errors.push(at + ": `steps[" + j + "]` is not a non-empty string");
      });
    }
    if (item.blocked_by !== undefined && !Array.isArray(item.blocked_by)) {
      errors.push(at + ": `blocked_by` must be an array of plan_id values");
    }

    errors.push(...validateVerification(item.verification, at));
  });

  errors.push(...validateDependencies(items, byPlanId));
  return errors;
}

/**
 * References and cycles.
 *
 * A cycle is checked here and not left to the reference guard for a reason: the
 * guard judges tasks that EXIST, and a cyclic plan would write a backlog in
 * which `next` never hands out anything. Refusing before the write is the only
 * moment at which that costs nothing.
 */
function validateDependencies(items, byPlanId) {
  const errors = [];
  const edges = new Map();

  items.forEach((item, i) => {
    if (!isPlainObject(item) || !Array.isArray(item.blocked_by)) return;
    const at = where(i, item);
    const from = typeof item.plan_id === "string" ? item.plan_id : null;
    const out = [];
    item.blocked_by.forEach((ref, j) => {
      if (!isNonEmptyString(ref)) {
        errors.push(at + ": `blocked_by[" + j + "]` is not a plan_id");
        return;
      }
      if (!byPlanId.has(ref)) {
        errors.push(
          at + ": `blocked_by` names `" + ref + "`, which is not a `plan_id` in this plan — " +
            "a dependency on something outside the plan belongs in `context`, where nothing pretends to have checked it"
        );
        return;
      }
      if (ref === from) {
        errors.push(at + ": blocks itself");
        return;
      }
      out.push(ref);
    });
    if (from) edges.set(from, out);
  });

  for (const cycle of findCycles(edges)) {
    errors.push("`blocked_by` forms a cycle: " + cycle.join(" → ") + " — nothing in it could ever be started");
  }
  return errors;
}

/** Every cycle reachable in the dependency graph, each reported once. */
export function findCycles(edges) {
  const state = new Map();          // plan_id → 0 unvisited, 1 on the stack, 2 done
  const stack = [];
  const found = [];
  const seen = new Set();

  const visit = (node) => {
    state.set(node, 1);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      if (!edges.has(next)) continue;
      if (state.get(next) === 1) {
        const cycle = stack.slice(stack.indexOf(next)).concat(next);
        // The same loop is reached from every node on it; the sorted member list
        // is what makes those one report instead of N.
        const key = cycle.slice(0, -1).slice().sort().join("|");
        if (!seen.has(key)) { seen.add(key); found.push(cycle); }
      } else if (!state.get(next)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const node of edges.keys()) if (!state.get(node)) visit(node);
  return found;
}

// ──────────────────────────────────────────────────────────────────────────
// Plan item → task file
// ──────────────────────────────────────────────────────────────────────────

/** The task-document shape is SHARED with `new` (TL-237): a plan item is one
 *  task plus its plan-local keys, so the judgement of its contract, the
 *  criteria it earns and the markdown it renders are defined once, in
 *  `task-input.mjs`, and re-exported here for the callers that already ask this
 *  module for them. */
export { contractFor, renderBody };

// ──────────────────────────────────────────────────────────────────────────
// The directory
// ──────────────────────────────────────────────────────────────────────────

/** `init` on a directory that is not a backlog yet — by SPAWNING the command,
 *  not by a copy of what it does. A second creator would drift from this one at
 *  the first change to the shape of a new backlog, and the drift would only ever
 *  show in trees created by `seed`. */
function runInit(target, json) {
  // `--no-example`: the example task exists to give an EMPTY backlog something to
  // show. A seeded one is not empty, and an unrelated task standing among the
  // plan's would be the first thing `next` could hand out.
  //
  // Under `--json` init's own report is DROPPED, not merged: stdout then carries
  // one document and nothing else, which is the whole promise a caller parses it
  // on. Its stderr still passes through — a warning is not output.
  const r = spawnSync(process.execPath, [join(HERE, "init-backlog.mjs"), "--dir", target, "--no-example"], {
    stdio: json ? ["ignore", "ignore", "inherit"] : "inherit",
  });
  return r.status === 0;
}

/** The number `new` would allocate next, for `--dry-run`. */
function peekNextId(root) {
  const r = spawnSync(process.execPath, [join(HERE, "next-backlog-id.mjs"), "--dir", root, "--json"], {
    encoding: "utf8", timeout: 60_000, cwd: root,
  });
  if (r.status !== 0) return null;
  try {
    const parsed = JSON.parse(r.stdout);
    return Number.isFinite(parsed.nextId) ? parsed.nextId : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────────

function refused(problems, json, extra) {
  if (json) {
    printJson("seed", { ok: false, errors: problems, ...(extra || {}) });
  } else {
    console.error(failure(
      N + " seed", "the plan was refused — nothing was written",
      problems,
      ["`" + N + " seed --help` describes the plan format"]
    ));
  }
  return 2;
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseSeedArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " seed", head, rest, [N + " seed --help"]));
    return 2;
  }

  if (opts.from) {
    // Composition, not a special case: the adapter is spawned exactly as a
    // stranger's would be, and its stdout is this command's stdin. `--from`
    // therefore cannot do anything a pipe could not.
    const produced = spawnSync(process.execPath, [join(HERE, "seed-adapter.mjs"), opts.from, "--dir", cli.dir || "."], {
      encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 600_000,
    });
    if (produced.status !== 0) {
      console.error(failure(N + " seed", "no plan came out of " + opts.from, [], []));
      return produced.status === null ? 1 : produced.status;
    }
    return seedFromText(produced.stdout, cli, opts);
  }

  if (process.stdin.isTTY) {
    console.error(failure(
      N + " seed", "no plan on stdin",
      ["The plan is JSON and it arrives on standard input — there is no `--plan <file>`,",
       "because the input is meant to be piped from whatever produced it."],
      [N + " seed --dir ./backlog < plan.json"]
    ));
    return 2;
  }

  let input;
  try {
    input = readFileSync(0, "utf8");
  } catch (e) {
    console.error(failure(N + " seed", "could not read the plan from stdin", [e.message], []));
    return 2;
  }
  return seedFromText(input, cli, opts);
}

/** Everything after the plan is in hand, whoever produced it — stdin, or the
 *  adapter `--from` spawned. One body, so the two routes cannot drift. */
function seedFromText(input, cli, opts) {
  // FIRST, and against nothing on disk: a plan judged before the directory is
  // touched is a plan whose refusal costs nothing to undo.
  const { plan, errors } = parsePlan(input);
  if (errors.length) return refused(errors, opts.json);

  // The directory. An explicit `--dir` that is not a backlog yet is the "seed a
  // fresh project" case and goes through `init`; anything else is resolved the
  // way every other command resolves it.
  let root;
  let initialised = false;
  const explicit = cli.dir ? resolve(cli.dir) : null;
  if (explicit && !looksLikeBacklogDir(explicit)) {
    if (opts.dryRun) {
      return reportDryRun(plan, {
        root: explicit, prefix: DEFAULT_TASK_ID_PREFIX, firstId: 1, json: opts.json, fresh: true,
      });
    }
    if (!runInit(explicit, opts.json)) {
      console.error(failure(N + " seed", "could not create a backlog in " + explicit, [], []));
      return 1;
    }
    initialised = true;
    root = explicit;
  } else {
    try {
      root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
    } catch (e) {
      console.error(failure(N + " seed", e.message, [], [N + " seed --dir <path> < plan.json"]));
      return 2;
    }
  }

  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  // The same gate `new` has, and for the same reason: a task written under a
  // prefix the tree does not use gives the tree two number spaces, and the
  // symptom appears at the next rebuild rather than here. Seeding would multiply
  // it by the size of the plan.
  const mismatch = detectPrefixMismatch(readdirSync(paths.tasksDir), config.taskIdPrefix);
  if (!mismatch.ok) {
    console.error(prefixMismatchMessage(mismatch, paths.tasksDir, {
      consequence: [
        "  Stopping BEFORE anything is written. Every task in this plan would get the",
        "  prefix `" + mismatch.expected + "` and stand next to `" + mismatch.found.join("`, `") + "`.",
      ],
    }));
    return 1;
  }

  // Values the plan borrows from THIS project's vocabulary — checkable only now
  // that the configuration is known, and still before any task is written.
  const vocabulary = [];
  for (const [i, item] of plan.tasks.entries()) {
    if (item.priority && config.priorities.length && config.priorities.indexOf(item.priority) < 0) {
      vocabulary.push(
        where(i, item) + ": `priority: " + item.priority + "` is not a value this project uses (" +
          config.priorities.join(" | ") + ")"
      );
    }
  }
  if (vocabulary.length) return refused(vocabulary, opts.json);

  if (opts.dryRun) {
    const firstId = peekNextId(root);
    return reportDryRun(plan, { root, prefix: config.taskIdPrefix, firstId, json: opts.json, fresh: false });
  }

  const board = config.defaultBoard || (config.boards || []).map((b) => b.slug)[0] || "main";
  let written;
  try {
    written = writePlan({ root, config, board, plan });
  } catch (e) {
    if (e && e.code === "EVOCABULARY") {
      // A drifted template is not "a failure part-way through" — nothing about the
      // plan was wrong, and the fix is one line in one file (TL-69). Saying that
      // instead of a rollback notice is the difference between a user who knows
      // what to edit and one who re-runs the same seed.
      console.error(driftMessage(e.divergences, { templatePath: e.templatePath, fields: {}, command: N + " seed" }));
      return 1;
    }
    console.error(failure(
      N + " seed", "the seed failed part-way through and was rolled back",
      [e.message, (e.rolledBack || 0) + " task file(s) created by this run were removed"], []
    ));
    return 1;
  }

  recordCreations(root, written, opts);

  const built = spawnSync(process.execPath, [join(HERE, "build-backlog.mjs"), "--dir", root], { stdio: "ignore" });

  if (opts.json) {
    printJson("seed", {
      ok: true, root, dryRun: false,
      created: written.map((w) => ({ planId: w.planId, id: w.id, file: w.file, title: w.title })),
    });
    return 0;
  }

  console.log(color.ok(MARK.ok) + " " + N + " seed: " + written.length + " task(s) in " + root);
  if (initialised) console.log("  the backlog was created here first (`" + N + " init`)");
  for (const w of written) {
    const blockers = (w.item.blocked_by || []).map((ref) => idFor(written, ref)).filter(Boolean);
    console.log("  " + color.id(w.id) + "  " + w.title + (blockers.length ? "  " + MARK.arrow + " after " + blockers.join(", ") : ""));
  }
  if (built.status !== 0) console.log("  WARNING: could not rebuild the views — run `" + N + " build`");
  console.log("  next: `" + N + " next --actor <ns:name>` hands out the first task nothing blocks");
  return 0;
}

/**
 * The writing pass: every task file, then the dependencies between them.
 *
 * ALL OR NOTHING. A failure part-way through removes the files THIS RUN created
 * and nothing else — a partial seed is a state nobody ordered, and a tree half
 * of a plan reads as a plan somebody has already started on.
 *
 * `createOne` is injected so the rollback can be measured. A collision cannot be
 * arranged from outside: numbers are allocated as max+1 over everything present,
 * so any file placed in the way to provoke one just moves the numbers past it.
 * A guard that cannot be made to fire is a guard nobody has seen work.
 *
 * @throws {Error & {rolledBack: number}}
 */
export function writePlan({ root, config, board, plan, createOne = createTask }) {
  const written = [];
  try {
    for (const item of plan.tasks) {
      const content = taskContent(item);
      const created = createOne({
        root, config, board,
        slug: slugify(item.title),
        fields: {
          title: item.title,
          priority: item.priority || undefined,
          estimate: item.estimate || undefined,
          verification: content.verification,
        },
        body: content.body,
      });
      written.push({ planId: item.plan_id, id: created.taskId, file: created.path, title: item.title, item });
    }
    linkDependencies(plan, written, config);
  } catch (e) {
    for (const w of written) {
      try { unlinkSync(w.file); } catch { /* already gone — nothing to undo */ }
    }
    e.rolledBack = written.length;
    throw e;
  }
  return written;
}

/** The allocated id for a plan key. */
function idFor(written, planId) {
  const hit = written.find((w) => w.planId === planId);
  return hit ? hit.id : null;
}

/**
 * `blocked_by` and `blocks`, written in a SECOND pass.
 *
 * It cannot be the first: a dependency is expressed in allocated ids, and an id
 * exists only once its file does. Both directions are written, because that is
 * how the guides tell a person to record a link and a backlog in which only one
 * side is filled reads differently depending on which task you open.
 */
function linkDependencies(plan, written, config) {
  const specs = buildFieldSpecs(config);
  const blockedBy = new Map();
  const blocks = new Map();
  for (const w of written) { blockedBy.set(w.id, []); blocks.set(w.id, []); }

  for (const w of written) {
    for (const ref of w.item.blocked_by || []) {
      const target = idFor(written, ref);
      if (!target) continue;                       // validation already refused this plan
      blockedBy.get(w.id).push(target);
      blocks.get(target).push(w.id);
    }
  }

  for (const w of written) {
    const mine = blockedBy.get(w.id);
    const theirs = blocks.get(w.id);
    if (!mine.length && !theirs.length) continue;
    let text = readFileSync(w.file, "utf8");
    if (mine.length) text = setFrontmatterField(text, "blocked_by", mine, fieldSpec("blocked_by", specs));
    if (theirs.length) text = setFrontmatterField(text, "blocks", theirs, fieldSpec("blocks", specs));
    writeFileSync(w.file, text, "utf8");
  }
}

/**
 * One `__created__` per task, attributed to whoever ran the command.
 *
 * WHY NOT `reconcile()` ALONE. Reconciliation is the route for changes nobody
 * was watching, and on a backlog with no snapshot yet — which is every backlog
 * `seed` has just created — it deliberately writes NO history and only takes a
 * reference point. The creations would vanish exactly in the case this command
 * exists for. So the events are written here, by the observer that saw them, and
 * reconciliation runs afterwards only to move the snapshot forward.
 */
function recordCreations(root, written, opts) {
  const actor = resolveActor(opts.actor);
  const ts = new Date().toISOString();
  // ONE SHAPE FOR A CREATION, in `history.mjs` (TL-187): `new` writes this
  // entry too now, and three hand-built copies of it would drift.
  for (const w of written) {
    recordCreation(root, { id: w.id, title: w.title }, { actor, source: "seed", reason: opts.reason, ts });
  }
  reconcile(root, { actor, source: "seed", reason: opts.reason || undefined });
}

/** `--dry-run`: what would be created, with the numbers it would be created
 *  under. They are PROVISIONAL and said to be — nothing is reserved, so another
 *  session allocating in between moves them. */
function reportDryRun(plan, { root, prefix, firstId, json, fresh }) {
  const base = Number.isFinite(firstId) ? firstId : 1;
  const ids = new Map();
  plan.tasks.forEach((item, i) => ids.set(item.plan_id, prefix + "-" + (base + i)));
  const created = plan.tasks.map((item) => ({
    planId: item.plan_id, id: ids.get(item.plan_id), file: null, title: item.title,
  }));

  if (json) {
    printJson("seed", { ok: true, root, dryRun: true, created });
    return 0;
  }
  console.log(N + " seed --dry-run: " + plan.tasks.length + " task(s) would be created in " + root);
  if (fresh) console.log("  this directory is not a backlog yet — `" + N + " init` would create it first");
  for (const item of plan.tasks) {
    const after = (item.blocked_by || []).map((ref) => ids.get(ref)).filter(Boolean);
    console.log("  " + color.id(ids.get(item.plan_id)) + "  " + item.title + (after.length ? "  " + MARK.arrow + " after " + after.join(", ") : ""));
  }
  console.log("  the numbers are PROVISIONAL — nothing is reserved, so a session allocating in between moves them");
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("seed-backlog.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
