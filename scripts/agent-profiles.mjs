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

import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ADAPTER_PROTOCOL_VERSION, DELEGATION_ENFORCEMENT, PROFILE_PROBE_ENV, PROFILE_PROBE_OUTCOMES, PROFILE_PROTOCOL_VERSION_ENV } from "./agent-contract.mjs";
import { agentProfilesPath, ensureHome, homePaths } from "./home.mjs";
import { lockScope } from "./lock.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { isValidActor, stripComment, unquote } from "./task-fields.mjs";
import { failure, heading, table } from "./ui.mjs";
import { resolveBacklogDir } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PROFILE_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
export const PROFILE_FIELDS = ["name", "adapter", "model", "effort", "prompt", "prompt_file", "secret_env", "protocol_version", "delegation_control", "actor"];

/** Profile names are user-owned identities, so a missing declaration becomes a
 * truthful profile-scoped agent identity rather than a guessed provider. */
export function profileActor(profile) {
  return String(profile && profile.actor || "").trim() || "agent:" + String(profile && profile.name || "").trim();
}

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
  if (profile.protocol_version && Number(profile.protocol_version) !== ADAPTER_PROTOCOL_VERSION) {
    problems.push("profile `" + profile.name + "` protocol_version must be " + ADAPTER_PROTOCOL_VERSION);
  }
  if (profile.delegation_control && !DELEGATION_ENFORCEMENT.includes(profile.delegation_control)) {
    problems.push("profile `" + profile.name + "` delegation_control must be one of: " + DELEGATION_ENFORCEMENT.join(", "));
  }
  if (profile.actor && (!isValidActor(profile.actor) || !String(profile.actor).startsWith("agent:"))) {
    problems.push("profile `" + profile.name + "` actor must be an `agent:<name>` identity");
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
    for (const key of ["model", "effort", "prompt", "prompt_file", "secret_env", "protocol_version", "delegation_control", "actor"]) {
      if (profile[key]) out.push("    " + key + ": " + quote(profile[key]));
    }
  }
  return out.join("\n") + "\n";
}

/** Project configuration is personal data keyed by Git's common directory: it
 * follows linked worktrees without being committed or tied to one checkout. */
export function projectAgentProfilesPath(root, env = process.env) {
  const scope = lockScope(root, { env });
  return join(homePaths(env).config, "projects", scope.key, "agent-profiles.yaml");
}

export function readAgentProfiles(env = process.env, root = null) {
  const path = root ? projectAgentProfilesPath(root, env) : agentProfilesPath(env);
  if (!existsSync(path)) return { path, exists: false, profiles: [], problems: [] };
  const parsed = parseAgentProfiles(readFileSync(path, "utf8"), path);
  return { path, exists: true, ...parsed };
}

function writeAgentProfiles(profiles, env, root = null) {
  const { config } = ensureHome(env);
  const path = root ? projectAgentProfilesPath(root, env) : agentProfilesPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeAgentProfiles(profiles), "utf8");
  return { path, config };
}

/** The two scopes are deliberately disjoint: a duplicate is ambiguous, not an
 * override. Callers operating in a repository use this combined read. */
export function readAvailableAgentProfiles(root, env = process.env) {
  const global = readAgentProfiles(env);
  const project = root ? readAgentProfiles(env, root) : { path: null, exists: false, profiles: [], problems: [] };
  const names = new Set();
  const duplicate = [];
  for (const profile of global.profiles.concat(project.profiles)) {
    if (names.has(profile.name)) duplicate.push("profile `" + profile.name + "` exists in both global and this-project configuration");
    names.add(profile.name);
  }
  return { path: project.path || global.path, exists: global.exists || project.exists, profiles: global.profiles.concat(project.profiles), problems: global.problems.concat(project.problems, duplicate), global, project };
}

function profilePathInStore(store, name) {
  if (store.project && store.project.profiles.some((profile) => profile.name === name)) return store.project.path;
  if (store.global && store.global.profiles.some((profile) => profile.name === name)) return store.global.path;
  return store.path;
}

/** One creation operation for both flags and the guided terminal flow. */
export function validateAgentProfileCreation(name, fields, env = process.env, root = null) {
  const store = root ? readAvailableAgentProfiles(root, env) : readAgentProfiles(env);
  if (store.problems.length) return { ok: false, kind: "invalid-store", store };
  if (store.profiles.some((p) => p.name === name)) return { ok: false, kind: "duplicate", store };
  const candidate = { name, ...fields };
  if (!candidate.actor) candidate.actor = profileActor(candidate);
  const target = root ? readAgentProfiles(env, root) : store;
  const problems = profileProblems(candidate, target.path);
  if (problems.length) return { ok: false, kind: "invalid-profile", store, problems };
  return { ok: true, store, profile: candidate };
}

export function createAgentProfile(name, fields, env = process.env, root = null) {
  const checked = validateAgentProfileCreation(name, fields, env, root);
  if (!checked.ok) return checked;
  const { profile: candidate } = checked;
  const store = root ? readAgentProfiles(env, root) : checked.store;
  const profiles = store.profiles.concat(candidate);
  const written = writeAgentProfiles(profiles, env, root);
  return { ok: true, path: written.path, profiles, profile: candidate };
}

export function profilePrompt(profile, path) {
  return profile.prompt || readFileSync(resolve(dirname(path), profile.prompt_file), "utf8");
}

/** Resolve one profile into the values a process launcher consumes. */
export function resolveAgentProfile(name, env = process.env, root = null) {
  const store = root ? readAvailableAgentProfiles(root, env) : readAgentProfiles(env);
  if (store.problems.length) return { ok: false, kind: "invalid-store", store };
  const profile = store.profiles.find((p) => p.name === name);
  if (!profile) return { ok: false, kind: "missing-profile", store };
  return { ok: true, profile: { ...profile, actor: profileActor(profile), protocol_version: String(profile.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(profile, profilePathInStore(store, name)) }, store };
}

/** Resolve an adapter from an absolute/relative path or PATH without running it. */
export function adapterPath(adapter, env = process.env) {
  const value = String(adapter || "").trim();
  const candidates = value.includes("/") ? [resolve(value)] : String(env.PATH || "").split(":").filter(Boolean).map((d) => resolve(d, value));
  for (const path of candidates) {
    try { accessSync(path, constants.X_OK); return path; } catch { /* try the next path */ }
  }
  return null;
}

/** Deterministic profile validation; it never starts an adapter or contacts a provider. */
export function checkAgentProfiles(names = [], env = process.env, root = null) {
  const store = root ? readAvailableAgentProfiles(root, env) : readAgentProfiles(env);
  const wanted = names.length ? [...new Set(names)] : store.profiles.map((p) => p.name);
  if (store.problems.length) return { ok: false, path: store.path, profiles: [], results: [{ name: null, state: "invalid-configuration", problems: store.problems }] };
  const profiles = [];
  const results = wanted.map((name) => {
    const found = store.profiles.find((p) => p.name === name);
    if (!found) return { name, state: "invalid-configuration", problems: ["no profile `" + name + "`"] };
    const resolved = { ...found, actor: profileActor(found), protocol_version: String(found.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(found, profilePathInStore(store, name)) };
    profiles.push(resolved);
    const problems = [];
    const executable = adapterPath(resolved.adapter, env);
    if (!executable) problems.push("adapter is unavailable: `" + resolved.adapter + "` is not executable on PATH");
    const missingSecrets = secretEnvironmentNames(resolved).filter((key) => !String(env[key] || ""));
    if (missingSecrets.length) problems.push("missing credential environment variable" + (missingSecrets.length === 1 ? "" : "s") + ": " + missingSecrets.join(", "));
    return { name, state: problems.length ? (executable ? "invalid-configuration" : "adapter-unavailable") : "ready", adapter: resolved.adapter, executable, protocolVersion: Number(resolved.protocol_version), problems };
  });
  return { ok: results.every((r) => !r.problems.length), path: store.path, profiles, results };
}

/** Explicitly opt-in provider probe. Its raw output is never displayed. */
export function liveProbe(profile, env = process.env) {
  const executable = adapterPath(profile.adapter, env);
  if (!executable) return { ok: false, state: "adapter-unavailable", outcome: "unavailable" };
  const probeEnv = { PATH: env.PATH || "", [PROFILE_PROBE_ENV]: "1", [PROFILE_PROTOCOL_VERSION_ENV]: String(ADAPTER_PROTOCOL_VERSION) };
  for (const key of secretEnvironmentNames(profile)) if (Object.prototype.hasOwnProperty.call(env, key)) probeEnv[key] = env[key];
  const child = spawnSync(executable, [], { shell: false, encoding: "utf8", env: probeEnv, timeout: 15_000, maxBuffer: 64 * 1024 });
  if (child.error || child.status !== 0) return { ok: false, state: "probe-failed", outcome: "unavailable" };
  try {
    const response = JSON.parse(String(child.stdout || "").trim());
    if (response.version !== ADAPTER_PROTOCOL_VERSION || PROFILE_PROBE_OUTCOMES.indexOf(response.outcome) < 0) throw new Error("invalid response");
    return { ok: response.outcome === "ready", state: response.outcome === "ready" ? "ready" : "probe-failed", outcome: response.outcome };
  } catch { return { ok: false, state: "probe-failed", outcome: null }; }
}

const SUBCOMMANDS = ["create", "list", "show", "update", "remove", "check"];
const FLAGS = ["--adapter", "--model", "--effort", "--prompt", "--prompt-file", "--secret-env", "--protocol-version", "--delegation-control", "--actor", "--live", "--json"];

export function parseAgentProfilesArgs(args) {
  const subcommand = args[0];
  if (SUBCOMMANDS.indexOf(subcommand) < 0) throw new Error(subcommand ? "unknown subcommand: " + subcommand : "no subcommand");
  const plan = { subcommand, name: null, json: false, live: false, fields: {} };
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { plan.json = true; continue; }
    if (arg === "--live") { plan.live = true; continue; }
    if (FLAGS.indexOf(arg) >= 0) {
      const value = args[++i];
      if (value === undefined) throw new Error("`" + arg + "` with no value");
      plan.fields[arg.slice(2).replace("-", "_")] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\navailable: " + FLAGS.join(" "));
    if (plan.name !== null) throw new Error("two profile names: " + plan.name + ", " + arg);
    plan.name = arg;
  }
  if (["create", "show", "update", "remove"].indexOf(subcommand) >= 0 && !plan.name) {
    throw new Error(subcommand + " needs a profile name");
  }
  if (subcommand === "list" && plan.name) throw new Error("list takes no profile name");
  if (subcommand !== "check" && plan.live) throw new Error("`--live` is only valid with `check`");
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

function checkAnswer(plan, checked, env) {
  const results = checked.results.map((row) => {
    const profile = checked.profiles.find((p) => p.name === row.name);
    return plan.live && profile && !row.problems.length ? { ...row, live: liveProbe(profile, env) } : { ...row, live: null };
  });
  const ok = checked.ok && results.every((row) => !row.live || row.live.ok);
  if (plan.json) { printJson("profile-check", { ok, path: checked.path, live: plan.live, results }); return ok ? 0 : 1; }
  for (const row of results) {
    const problems = row.problems || [];
    const live = row.live;
    console.log((!problems.length && (!live || live.ok) ? "✓" : "✗") + " " + (row.name || "profiles") + "  " + (live ? live.state : row.state));
    for (const problem of problems) console.log("  " + problem);
    if (live && !live.ok) console.log("  live probe: " + (live.outcome || "invalid response"));
  }
  return ok ? 0 : 1;
}

export async function run(argv, env = process.env) {
  let plan;
  try { plan = parseAgentProfilesArgs(argv); }
  catch (e) {
    console.error(failure(N + " profile", e.message, ["available: " + SUBCOMMANDS.join(", ")], [N + " profile --help"]));
    return 2;
  }
  let projectRoot = null;
  try { projectRoot = resolveBacklogDir({ moduleDir: HERE }).root; } catch { /* A global profile command is valid outside a backlog. */ }
  const store = projectRoot ? readAvailableAgentProfiles(projectRoot, env) : readAgentProfiles(env);
  if (plan.subcommand === "check") return checkAnswer(plan, checkAgentProfiles(plan.name ? [plan.name] : [], env, projectRoot), env);
  if (store.problems.length) {
    console.error(failure(N + " profile", "cannot read local agent profiles", [store.path, ...store.problems], [N + " profile list"]));
    return 1;
  }
  const found = plan.name ? store.profiles.find((p) => p.name === plan.name) : null;
  if (plan.subcommand === "list") return answer(plan, store);
  if (plan.subcommand === "show") {
    if (!found) { console.error(failure(N + " profile show", "no profile `" + plan.name + "`", ["Run `" + N + " profile list` to see local names."])); return 1; }
    return answer(plan, store, resolveAgentProfile(plan.name, env, projectRoot).profile);
  }
  if (plan.subcommand === "create" && found) {
    console.error(failure(N + " profile create", "profile `" + plan.name + "` already exists", ["Use `" + N + " profile update " + plan.name + " …` instead."]));
    return 1;
  }
  if (["update", "remove"].indexOf(plan.subcommand) >= 0 && !found) {
    console.error(failure(N + " profile " + plan.subcommand, "no profile `" + plan.name + "`", ["Nothing was changed."]));
    return 1;
  }
  if (plan.subcommand === "create") {
    const created = createAgentProfile(plan.name, plan.fields, env);
    if (!created.ok) {
      console.error(failure(N + " profile create", created.kind === "invalid-profile" ? "profile is invalid" : "cannot create profile", created.problems || []));
      return 1;
    }
    if (plan.json) { printJson("agent-profiles", { path: created.path, exists: true, profiles: created.profiles, profile: created.profile }); return 0; }
    console.log("✓ profile `" + plan.name + "` created — " + created.path);
    return 0;
  }
  const targetRoot = projectRoot && store.project.profiles.some((p) => p.name === plan.name) ? projectRoot : null;
  const targetStore = targetRoot ? store.project : store.global || store;
  let profiles;
  if (plan.subcommand === "remove") profiles = targetStore.profiles.filter((p) => p.name !== plan.name);
  else {
    const candidate = { ...found, ...plan.fields };
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt")) delete candidate.prompt_file;
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt_file")) delete candidate.prompt;
    const problems = profileProblems(candidate, targetStore.path);
    if (problems.length) { console.error(failure(N + " profile " + plan.subcommand, "profile is invalid", problems)); return 1; }
    profiles = targetStore.profiles.map((p) => p.name === plan.name ? candidate : p);
  }
  const written = writeAgentProfiles(profiles, env, targetRoot);
  const result = { path: written.path, exists: true, profiles, problems: [] };
  if (plan.json) { printJson("agent-profiles", { path: written.path, exists: true, profiles, profile: plan.subcommand === "remove" ? null : profiles.find((p) => p.name === plan.name) || null }); return 0; }
  console.log("✓ profile `" + plan.name + "` " + (plan.subcommand === "remove" ? "removed" : plan.subcommand + "d") + " — " + written.path);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("agent-profiles.mjs")) process.exit(await run(process.argv.slice(2)));
