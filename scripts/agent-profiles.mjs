#!/usr/bin/env node
/**
 * Local, provider-neutral execution profiles (TL-288).
 *
 * A profile is deliberately not a project configuration value. It says which
 * executable, model and prompt ONE person wants to use on THEIR machine; a
 * repository can be correct while each contributor uses a different provider.
 * The adapter is one executable. A user-owned wrapper translates its stable
 * inputs to provider flags or an API call, so naming providers here would make
 * every new CLI a release of this tool.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { agentProfilesPath, ensureHome } from "./home.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { failure, heading, table } from "./ui.mjs";

export const PROFILE_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
export const PROFILE_FIELDS = ["name", "adapter", "model", "effort", "prompt", "prompt_file", "secret_env"];

/** A credential may be REFERENCED through $NAME, but never copied as a value. */
export function credentialProblem(value) {
  const text = String(value || "");
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/.test(text)) return "looks like a copied API key";
  const assigned = /(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret)\s*[:=]\s*([^\s;]+)/ig;
  let match;
  while ((match = assigned.exec(text))) {
    if (!match[1].startsWith("$") && !match[1].startsWith("${")) return "contains a credential value";
  }
  return null;
}

function profileProblems(profile, path) {
  const problems = [];
  if (!PROFILE_NAME_SHAPE.test(profile.name || "")) {
    problems.push("profile name `" + (profile.name || "") + "` must be a lowercase slug");
  }
  const adapter = String(profile.adapter || "").trim();
  if (!adapter) problems.push("profile `" + profile.name + "` needs an `adapter`");
  else if (/\s/.test(adapter)) problems.push("profile `" + profile.name + "` adapter must name one executable — put provider flags in its wrapper");
  const inline = String(profile.prompt || "").trim();
  const file = String(profile.prompt_file || "").trim();
  if ((inline ? 1 : 0) + (file ? 1 : 0) !== 1) {
    problems.push("profile `" + profile.name + "` needs exactly one of `prompt` or `prompt_file`");
  }
  for (const key of ["adapter", "model", "effort", "prompt", "prompt_file"]) {
    const issue = credentialProblem(profile[key]);
    if (issue) problems.push("profile `" + profile.name + "` " + key + " " + issue + " — use an environment-variable reference instead");
  }
  if (file) {
    const promptPath = resolve(dirname(path), file);
    if (!existsSync(promptPath)) problems.push("profile `" + profile.name + "` prompt_file cannot be read: " + promptPath);
    else {
      const issue = credentialProblem(readFileSync(promptPath, "utf8"));
      if (issue) problems.push("profile `" + profile.name + "` prompt_file " + issue + " — use an environment-variable reference instead");
    }
  }
  const secretNames = secretEnvironmentNames(profile);
  if (String(profile.secret_env || "").trim() && !secretNames.length) {
    problems.push("profile `" + profile.name + "` secret_env needs one or more environment variable names");
  }
  if (secretNames.length !== new Set(secretNames).size) {
    problems.push("profile `" + profile.name + "` secret_env names a variable more than once");
  }
  for (const name of secretNames) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      problems.push("profile `" + profile.name + "` secret_env `" + name + "` is not an environment variable name");
    }
  }
  return problems;
}

/** Names, not values: profile data can opt in to a secret's delivery. */
export function secretEnvironmentNames(profile) {
  return String(profile && profile.secret_env || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Parse the narrow `profiles:` list format. */
export function parseAgentProfiles(text, path = "agent-profiles.yaml") {
  const profiles = [];
  const problems = [];
  let current = null;
  let sawHeader = false;
  const seen = new Set();
  const flush = (line) => {
    if (!current) return;
    const name = current.name || "";
    if (seen.has(name)) problems.push("line " + line + ": duplicate profile `" + name + "`");
    else {
      seen.add(name);
      problems.push(...profileProblems(current, path));
      profiles.push(current);
    }
    current = null;
  };

  for (let i = 0; i < String(text || "").split(/\r?\n/).length; i++) {
    const raw = stripComment(String(text || "").split(/\r?\n/)[i]);
    if (!raw.trim()) continue;
    if (/^profiles:\s*$/.test(raw.trim())) {
      if (sawHeader) problems.push("line " + (i + 1) + ": duplicate `profiles:` header");
      sawHeader = true;
      continue;
    }
    const item = raw.match(/^\s*-\s*(.*)$/);
    if (item) {
      if (!sawHeader) { problems.push("line " + (i + 1) + ": expecting `profiles:` before an entry"); continue; }
      flush(i);
      current = {};
      const first = item[1].match(/^([a-z_]+):\s*(.*)$/);
      if (!first) { problems.push("line " + (i + 1) + ": entry must start with `name:`"); continue; }
      if (PROFILE_FIELDS.indexOf(first[1]) < 0) problems.push("line " + (i + 1) + ": unknown profile field `" + first[1] + "`");
      else current[first[1]] = unquote(first[2]);
      continue;
    }
    const field = raw.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (field && current) {
      if (PROFILE_FIELDS.indexOf(field[1]) < 0) problems.push("line " + (i + 1) + ": unknown profile field `" + field[1] + "`");
      else if (Object.prototype.hasOwnProperty.call(current, field[1])) problems.push("line " + (i + 1) + ": duplicate field `" + field[1] + "`");
      else current[field[1]] = unquote(field[2]);
      continue;
    }
    problems.push("line " + (i + 1) + ": cannot read `" + raw.trim() + "`");
  }
  flush(String(text || "").split(/\r?\n/).length);
  if (!sawHeader && String(text || "").trim()) problems.push("expecting a `profiles:` header");
  return { profiles, problems };
}

function quote(value) {
  return JSON.stringify(String(value || ""));
}

export function serializeAgentProfiles(profiles) {
  const out = [
    "# Agent profiles for this person and this machine.",
    "# Keep credentials outside this file: refer to environment variables or provider configuration.",
    "# The adapter is one executable; its wrapper may serve any present or future provider.",
    "profiles:",
  ];
  for (const profile of profiles) {
    out.push("  - name: " + profile.name);
    out.push("    adapter: " + quote(profile.adapter));
    for (const key of ["model", "effort", "prompt", "prompt_file", "secret_env"]) {
      if (profile[key]) out.push("    " + key + ": " + quote(profile[key]));
    }
  }
  return out.join("\n") + "\n";
}

export function readAgentProfiles(env = process.env) {
  const path = agentProfilesPath(env);
  if (!existsSync(path)) return { path, exists: false, profiles: [], problems: [] };
  const parsed = parseAgentProfiles(readFileSync(path, "utf8"), path);
  return { path, exists: true, ...parsed };
}

function writeAgentProfiles(profiles, env) {
  const { config } = ensureHome(env);
  const path = agentProfilesPath(env);
  writeFileSync(path, serializeAgentProfiles(profiles), "utf8");
  return { path, config };
}

export function profilePrompt(profile, path) {
  return profile.prompt || readFileSync(resolve(dirname(path), profile.prompt_file), "utf8");
}

/** Resolve one profile into the values a process launcher consumes. */
export function resolveAgentProfile(name, env = process.env) {
  const store = readAgentProfiles(env);
  if (store.problems.length) return { ok: false, kind: "invalid-store", store };
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) return { ok: false, kind: "missing-profile", store };
  return { ok: true, profile: { ...profile, prompt: profilePrompt(profile, store.path) }, store };
}

const SUBCOMMANDS = ["create", "list", "show", "update", "remove"];
const FLAGS = ["--adapter", "--model", "--effort", "--prompt", "--prompt-file", "--secret-env", "--json"];

export function parseAgentProfilesArgs(args) {
  const subcommand = args[0];
  if (SUBCOMMANDS.indexOf(subcommand) < 0) throw new Error(subcommand ? "unknown subcommand: " + subcommand : "no subcommand");
  const plan = { subcommand, name: null, json: false, fields: {} };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { plan.json = true; continue; }
    if (FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + arg + "` with no value");
      plan.fields[arg.slice(2).replace("-", "_")] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\nknown flags: " + FLAGS.join(" "));
    if (plan.name !== null) throw new Error("two profile names: " + plan.name + ", " + arg);
    plan.name = arg;
  }
  if (["create", "show", "update", "remove"].indexOf(subcommand) >= 0 && !plan.name) {
    throw new Error(subcommand + " needs a profile name");
  }
  if (subcommand === "list" && plan.name) throw new Error("list takes no profile name");
  if (subcommand === "create" && !plan.fields.adapter) throw new Error("create needs `--adapter <command>`");
  if (["create", "update"].indexOf(subcommand) >= 0 &&
      (Object.prototype.hasOwnProperty.call(plan.fields, "prompt") === Object.prototype.hasOwnProperty.call(plan.fields, "prompt_file")) &&
      subcommand === "create") {
    throw new Error("create needs exactly one of `--prompt` or `--prompt-file`");
  }
  if (subcommand === "update" && !Object.keys(plan.fields).length) throw new Error("update needs at least one profile field");
  if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt") && Object.prototype.hasOwnProperty.call(plan.fields, "prompt_file")) {
    throw new Error("`--prompt` and `--prompt-file` are alternatives, not two prompts");
  }
  return plan;
}

function answer(plan, store, profile = null) {
  if (plan.json) {
    printJson("agent-profiles", { path: store.path, exists: store.exists, profiles: store.profiles, profile });
    return 0;
  }
  if (plan.subcommand === "list") {
    console.log(heading("agent profiles"));
    if (!store.profiles.length) console.log("\n  no local profiles — `" + N + " profile create <name> …` adds one");
    else console.log("\n" + table(store.profiles.map((p) => ["  " + p.name, p.adapter, p.model || "", p.effort || ""])));
    return 0;
  }
  console.log(JSON.stringify({ ...profile, prompt: profilePrompt(profile, store.path) }, null, 2));
  return 0;
}

export function run(argv, env = process.env) {
  let plan;
  try { plan = parseAgentProfilesArgs(argv); }
  catch (e) {
    console.error(failure(N + " profile", e.message, ["known: " + SUBCOMMANDS.join(", ")], [N + " profile --help"]));
    return 2;
  }
  const store = readAgentProfiles(env);
  if (store.problems.length) {
    console.error(failure(N + " profile", "cannot read local agent profiles", [store.path, ...store.problems], [N + " profile list"]));
    return 1;
  }
  const found = plan.name ? store.profiles.find((p) => p.name === plan.name) : null;
  if (plan.subcommand === "list") return answer(plan, store);
  if (plan.subcommand === "show") {
    if (!found) { console.error(failure(N + " profile show", "no profile `" + plan.name + "`", ["Run `" + N + " profile list` to see local names."])); return 1; }
    return answer(plan, store, { ...found, prompt: profilePrompt(found, store.path) });
  }
  if (plan.subcommand === "create" && found) {
    console.error(failure(N + " profile create", "profile `" + plan.name + "` already exists", ["Use `" + N + " profile update " + plan.name + " …` instead."]));
    return 1;
  }
  if (["update", "remove"].indexOf(plan.subcommand) >= 0 && !found) {
    console.error(failure(N + " profile " + plan.subcommand, "no profile `" + plan.name + "`", ["Nothing was changed."]));
    return 1;
  }
  let profiles;
  if (plan.subcommand === "remove") profiles = store.profiles.filter((p) => p.name !== plan.name);
  else {
    const candidate = plan.subcommand === "create" ? { name: plan.name, ...plan.fields } : { ...found, ...plan.fields };
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt")) delete candidate.prompt_file;
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt_file")) delete candidate.prompt;
    const problems = profileProblems(candidate, store.path);
    if (problems.length) { console.error(failure(N + " profile " + plan.subcommand, "profile is invalid", problems)); return 1; }
    profiles = plan.subcommand === "create" ? store.profiles.concat(candidate) : store.profiles.map((p) => p.name === plan.name ? candidate : p);
  }
  const written = writeAgentProfiles(profiles, env);
  const result = { path: written.path, exists: true, profiles, problems: [] };
  if (plan.json) { printJson("agent-profiles", { path: written.path, exists: true, profiles, profile: plan.subcommand === "remove" ? null : profiles.find((p) => p.name === plan.name) || null }); return 0; }
  console.log("✓ profile `" + plan.name + "` " + (plan.subcommand === "remove" ? "removed" : plan.subcommand + "d") + " — " + written.path);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("agent-profiles.mjs")) process.exit(run(process.argv.slice(2)));
