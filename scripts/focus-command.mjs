#!/usr/bin/env node
/**
 * `focus` — say which task this session's heartbeats belong to (TL-28).
 *
 * WHY IT EXISTS AT ALL, GIVEN THAT `take` SETS IT. Leg 1 of the attribution
 * chain (§8 of docs/backlog-time-tracking.md — a real path, product-name:
 * allow) is the only one a person can reach: work that never touches a task
 * file and happens on a branch with no id in its name is invisible to legs 3
 * and 4, and §8.1 measured both of those firing almost never. `take` covers the
 * ordinary path automatically — this command covers the rest, and it is also
 * how a session corrects an attribution BEFORE the rows are written, which is
 * the only moment it can be corrected at all: the log is append-only.
 *
 * WHAT IT DOES NOT DO. It does not claim the task, does not change its status,
 * and does not touch the tree. A pointer is a statement about this session, not
 * about the backlog — `take` is the command that changes what everybody sees.
 * The two are deliberately separate: pointing a measurement at a task somebody
 * else holds is legitimate (a review, a second pair of eyes), and refusing it
 * would push that time into `unknown` instead.
 *
 * Exit: 0 set, cleared or reported · 1 no such task · 2 the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/attribution.test.mjs`
 */

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { clearFocus, readFocus, sessionId, writeFocus } from "./focus.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { taskIdPatterns } from "./task-id.mjs";
import { MARK, color, failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FOCUS_FLAGS = ["--clear", "--actor", "--json", "--dir"];

/** PURE — resolves `focus`'s arguments. Throws on a usage error. */
export function parseFocusArgs(args) {
  const plan = { id: null, clear: false, actor: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--clear") { plan.clear = true; continue; }
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--actor") {
      const value = args[++i];
      if (!value) throw new Error("`--actor` with no value");
      plan.actor = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + FOCUS_FLAGS.join(" "));
    }
    if (plan.id) {
      throw new Error("two task ids given: " + plan.id + " and " + a + " — a session is on one task");
    }
    plan.id = a;
  }
  if (plan.id && plan.clear) {
    throw new Error("`--clear` and a task id say opposite things — pick one");
  }
  return plan;
}

/** Does this backlog hold that task? The pointer is checked against the TREE
 *  before it is written: a focus on a typo would silently send a session's
 *  whole measurement to a task that does not exist, and nothing downstream
 *  could tell that from a task that was later renumbered. */
export function taskExists(root, id, patterns) {
  if (!patterns.id.test(id)) return false;
  const dir = backlogPaths(root).tasksDir;
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => {
    const m = f.match(patterns.fileId);
    return Boolean(m) && m[1] === id && patterns.file.test(f);
  });
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let plan;
  try {
    plan = parseFocusArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " focus", head, rest, [N + " focus --help"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " focus", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const session = sessionId({ root });

  if (plan.clear) {
    const had = clearFocus(root);
    if (plan.json) {
      console.log(JSON.stringify({ session, focus: null, cleared: had }, null, 2));
      return 0;
    }
    console.log(had
      ? color.ok(MARK.ok) + " focus cleared for session " + color.dim(session)
      : color.dim(MARK.bullet + " session " + session + " had no focus"));
    return 0;
  }

  if (!plan.id) {
    const current = readFocus(root);
    if (plan.json) {
      console.log(JSON.stringify({ session, focus: current }, null, 2));
      return 0;
    }
    if (!current) {
      console.log(color.dim(MARK.bullet + " session " + session + " has no focus — heartbeats fall to"));
      console.log(color.dim("  the file, the branch, or `unknown`, in that order"));
      return 0;
    }
    console.log(color.ok(MARK.ok) + " " + current.task + " " +
      color.dim("(" + current.origin + ", since " + current.ts + ", session " + session + ")"));
    return 0;
  }

  const patterns = taskIdPatterns(config.taskId.prefix);
  if (!taskExists(root, plan.id, patterns)) {
    console.error(failure(N + " focus", "no such task: " + plan.id, [
      "The pointer is checked against the tree before it is written — a focus on a",
      "typo would send this session's whole measurement to a task nobody can find.",
    ], [N + " query --status pending"]));
    return 1;
  }

  const written = writeFocus(root, {
    task: plan.id,
    actor: resolveActor(plan.actor),
    origin: "focus",
  });
  if (plan.json) {
    console.log(JSON.stringify({ session, focus: written }, null, 2));
    return 0;
  }
  console.log(color.ok(MARK.ok) + " focus " + color.bold(plan.id) + " " +
    color.dim("— heartbeats from session " + session + " are attributed here until it changes"));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("focus-command.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
