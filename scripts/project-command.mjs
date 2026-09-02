#!/usr/bin/env node
/**
 * `project add|list|remove` — maintaining the index (TL-34).
 *
 * REGISTRATION IS NEVER A PRECONDITION. Nothing in this file is required for any
 * other command to work, and that is the property to protect: the moment one
 * command starts asking "which project", the index has become a source of truth
 * and detection has a rival. `init` registers automatically and best effort, so
 * the common case needs none of these commands at all.
 *
 * WHAT THEY ARE FOR is the case detection cannot reach: standing outside every
 * repository and asking what exists. That question has no answer in the
 * filesystem, so it has a file.
 *
 * Exit: 0 done · 1 refused (not a backlog, name taken, not registered) · 2 the
 * invocation was wrong.
 *
 * Tests: `node --test scripts/tests/registry.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { addProject, readRegistry, removeProject } from "./registry.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = ["add", "list", "remove"];
const FLAGS = ["--name", "--json", "--dir"];

/** PURE — resolves the arguments. Throws on a usage error. */
export function parseProjectArgs(args) {
  const plan = { target: null, name: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--name") {
      const value = args[++i];
      if (!value) throw new Error("`--name` with no value");
      plan.name = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    }
    if (plan.target) throw new Error("two arguments given: " + plan.target + " and " + a);
    plan.target = a;
  }
  return plan;
}

function runList(plan, env) {
  const registry = readRegistry(env);
  if (plan.json) {
    console.log(JSON.stringify(registry, null, 2));
    return 0;
  }
  console.log(heading("projects", { color }));
  console.log("");
  if (!registry.exists) {
    console.log("  " + color.dim("no registry yet — `" + N + " init` registers a backlog it creates,"));
    console.log("  " + color.dim("and `" + N + " project add` registers one that already exists."));
    console.log("  " + color.dim("Its absence breaks nothing: detection finds a backlog you are standing in."));
    return 0;
  }
  if (registry.projects.length) {
    console.log(table(registry.projects.map((p) => ["  " + p.name, p.path])));
  } else {
    console.log("  " + color.dim("the registry is empty"));
  }
  if (registry.missing.length) {
    console.log("");
    console.log("  " + color.warn(MARK.warn) + " registered, but not a backlog any more:");
    console.log(table(registry.missing.map((p) => ["    " + p.name, p.path])));
    console.log("  " + color.dim("Reported rather than skipped — otherwise `you moved it` would read as"));
    console.log("  " + color.dim("`that project has no tasks`. Remove one with `" + N + " project remove <name>`."));
  }
  if (registry.problems.length) {
    console.log("");
    console.log("  " + color.warn(MARK.warn) + " lines this file could not be read from:");
    for (const p of registry.problems) console.log("    " + p);
  }
  return 0;
}

export function main(argv) {
  const sub = argv[0];
  if (SUBCOMMANDS.indexOf(sub) < 0) {
    console.error(failure(N + " project", sub ? "unknown subcommand: " + sub : "no subcommand",
      ["known: " + SUBCOMMANDS.join(", ")], [N + " project --help"]));
    return 2;
  }

  const cli = takeDirFlag(argv.slice(1));
  let plan;
  try {
    plan = parseProjectArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " project " + sub, head, rest, [N + " project --help"]));
    return 2;
  }

  const env = process.env;
  if (sub === "list") return runList(plan, env);

  if (sub === "remove") {
    if (!plan.target) {
      console.error(failure(N + " project remove", "name or path of the project to forget", [],
        [N + " project list"]));
      return 2;
    }
    const result = removeProject(plan.target, { env });
    if (!result.ok) {
      console.error(failure(N + " project remove", result.message, [
        "Nothing was changed. A silent success here would leave you believing a",
        "misspelled name had been removed.",
      ], [N + " project list"]));
      return 1;
    }
    if (plan.json) { console.log(JSON.stringify(result, null, 2)); return 0; }
    console.log(color.ok(MARK.ok) + " forgotten — " + color.dim("the backlog itself was not touched"));
    return 0;
  }

  // `add` with no argument means "the backlog this run would use", which is the
  // overwhelmingly common case and needs no path typed.
  let root;
  try {
    root = plan.target || resolveBacklogDir({ dir: cli.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " project add", e.message, []));
    return 2;
  }
  const result = addProject(root, { name: plan.name, env });
  if (!result.ok) {
    console.error(failure(N + " project add", result.message, result.details || []));
    return 1;
  }
  if (plan.json) { console.log(JSON.stringify(result, null, 2)); return 0; }
  if (result.already) {
    console.log(color.dim(MARK.bullet + " " + result.project.name + " was already registered — " + result.project.path));
    return 0;
  }
  if (result.renamed) {
    console.log(color.ok(MARK.ok) + " " + result.renamed.name + " " + MARK.arrow + " " +
      result.project.name + color.dim(" — the path is the identity, the name is your label"));
    return 0;
  }
  console.log(color.ok(MARK.ok) + " " + result.project.name + color.dim(" — " + result.project.path));
  console.log("  " + color.dim("Registration is an index entry, never a precondition: every command in a"));
  console.log("  " + color.dim("repository finds its backlog without it."));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("project-command.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
