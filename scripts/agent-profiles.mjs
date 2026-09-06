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

import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { ADAPTER_PROTOCOL_VERSION, PROFILE_PROBE_ENV, PROFILE_PROBE_OUTCOMES, PROFILE_PROTOCOL_VERSION_ENV } from "./agent-contract.mjs";
import { agentProfilesPath, ensureHome } from "./home.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { failure, heading, table } from "./ui.mjs";

export const PROFILE_NAME_SHAPE = /^[a-z0-9][a-z0-9._-]{0,62}$/;
export const PROFILE_FIELDS = ["name", "adapter", "model", "effort", "prompt", "prompt_file", "secret_env", "protocol_version"];

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
    for (const key of ["model", "effort", "prompt", "prompt_file", "secret_env", "protocol_version"]) {
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

/** One creation operation for both flags and the guided terminal flow. */
export function createAgentProfile(name, fields, env = process.env) {
  const store = readAgentProfiles(env);
  if (store.problems.length) return { ok: false, kind: "invalid-store", store };
  if (store.profiles.some((p) => p.name === name)) return { ok: false, kind: "duplicate", store };
  const candidate = { name, ...fields };
  const problems = profileProblems(candidate, store.path);
  if (problems.length) return { ok: false, kind: "invalid-profile", store, problems };
  const profiles = store.profiles.concat(candidate);
  const written = writeAgentProfiles(profiles, env);
  return { ok: true, path: written.path, profiles, profile: candidate };
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
  return { ok: true, profile: { ...profile, protocol_version: String(profile.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(profile, store.path) }, store };
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
export function checkAgentProfiles(names = [], env = process.env) {
  const store = readAgentProfiles(env);
  const wanted = names.length ? [...new Set(names)] : store.profiles.map((p) => p.name);
  if (store.problems.length) return { ok: false, path: store.path, profiles: [], results: [{ name: null, state: "invalid-configuration", problems: store.problems }] };
  const profiles = [];
  const results = wanted.map((name) => {
    const found = store.profiles.find((p) => p.name === name);
    if (!found) return { name, state: "invalid-configuration", problems: ["no profile `" + name + "`"] };
    const resolved = { ...found, protocol_version: String(found.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(found, store.path) };
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

const SUBCOMMANDS = ["create", "list", "show", "update", "remove", "check", "setup"];
const FLAGS = ["--adapter", "--model", "--effort", "--prompt", "--prompt-file", "--secret-env", "--protocol-version", "--live", "--json"];

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
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\nknown flags: " + FLAGS.join(" "));
    if (plan.name !== null) throw new Error("two profile names: " + plan.name + ", " + arg);
    plan.name = arg;
  }
  if (["create", "show", "update", "remove"].indexOf(subcommand) >= 0 && !plan.name) {
    throw new Error(subcommand + " needs a profile name");
  }
  if (subcommand === "list" && plan.name) throw new Error("list takes no profile name");
  if (subcommand === "setup" && (plan.name || Object.keys(plan.fields).length || plan.json || plan.live)) {
    throw new Error("setup is interactive and takes no names or flags");
  }
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

export const SETUP_USAGE = [
  `${N} profile setup`,
  "",
  "  Create one local agent profile through a guided terminal conversation.",
  "  It requires an interactive terminal and writes only after a final confirmation.",
  "  Use `profile create` when a script or another client supplies the values.",
  "",
  "  During input: `back` revisits the previous field; `cancel` leaves no change.",
  "  The setup never starts an adapter, contacts a provider or asks for a secret value.",
].join("\n");

const BACK = Symbol("back");
const CANCEL = Symbol("cancel");

function setupAnswer(value, fallback = "") {
  if (value === null || value === undefined) return CANCEL;
  const text = String(value).trim();
  if (/^(cancel|quit|q)$/i.test(text)) return CANCEL;
  if (/^(back|b)$/i.test(text)) return BACK;
  return text || fallback;
}

/**
 * The setup state machine is terminal-independent so its cancellation and write
 * boundary can be tested without a pseudo-terminal.
 */
export async function setupProfileConversation(io, env = process.env) {
  const fields = [
    { key: "name", label: "Profile name (lowercase slug)", required: true },
    { key: "adapter", label: "Adapter executable", required: true },
    { key: "prompt", label: "Local prompt", required: true },
    { key: "model", label: "Model (optional)", required: false },
    { key: "effort", label: "Effort (optional)", required: false },
    { key: "secret_env", label: "Credential variable names, comma-separated (optional)", required: false },
  ];
  const state = {};
  io.write("Create an agent profile. Type back or cancel at any prompt.\n");
  let index = 0;
  while (index < fields.length) {
    const field = fields[index];
    const current = state[field.key] || "";
    const suffix = current ? ` [${current}]` : "";
    const answer = setupAnswer(await io.ask(field.label + suffix + ": "), current);
    if (answer === CANCEL) return { ok: false, kind: "cancelled" };
    if (answer === BACK) { if (index) index--; continue; }
    if (field.required && !answer) { io.write(field.label + " is required.\n"); continue; }
    state[field.key] = answer;
    index++;
  }
  const secret = state.secret_env ? "\n  credential variables: " + state.secret_env : "";
  io.write("\nProfile summary:\n  name: " + state.name + "\n  adapter: " + state.adapter
    + "\n  model: " + (state.model || "(none)") + "\n  effort: " + (state.effort || "(none)")
    + secret + "\n\n1) Create profile\n2) Back\n3) Cancel\n");
  const confirmation = setupAnswer(await io.ask("Choice [1/2/3]: "));
  if (confirmation === CANCEL || confirmation === "3") return { ok: false, kind: "cancelled" };
  if (confirmation === BACK || confirmation === "2") {
    index = fields.length - 1;
    while (index < fields.length) {
      const field = fields[index];
      const answer = setupAnswer(await io.ask(field.label + " [" + (state[field.key] || "") + "]: "), state[field.key] || "");
      if (answer === CANCEL) return { ok: false, kind: "cancelled" };
      if (answer === BACK) { if (index) index--; continue; }
      if (field.required && !answer) { io.write(field.label + " is required.\n"); continue; }
      state[field.key] = answer;
      index++;
    }
    io.write("\nProfile summary confirmed after edits.\n");
    const retry = setupAnswer(await io.ask("Create profile? [1=create, 3=cancel]: "));
    if (retry === CANCEL || retry === "3" || retry !== "1") return { ok: false, kind: "cancelled" };
  } else if (confirmation !== "1") {
    io.write("Choose 1, 2 or 3. Nothing was written.\n");
    return { ok: false, kind: "cancelled" };
  }
  const { name, ...profile } = state;
  return createAgentProfile(name, profile, env);
}

async function runSetup(env = process.env, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    console.error(failure(N + " profile setup", "interactive setup needs a terminal", ["Use `" + N + " profile create <name> …` from a script or pipe."]));
    return 2;
  }
  const terminal = createInterface({ input, output, terminal: true });
  const io = { ask: (question) => terminal.question(question), write: (text) => output.write(text) };
  try {
    const result = await setupProfileConversation(io, env);
    if (!result.ok) { output.write("No profile was created.\n"); return result.kind === "cancelled" ? 0 : 1; }
    output.write("✓ profile `" + result.profile.name + "` created — " + result.path + "\n");
    output.write("Next: `" + N + " profile check " + result.profile.name + "`, then `" + N + " run --profile " + result.profile.name + " --dry-run`.\n");
    return 0;
  } catch (error) {
    console.error(failure(N + " profile setup", "setup stopped before writing", [error.message]));
    return 1;
  } finally { terminal.close(); }
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
  if (argv[0] === "setup" && argv[1] === "--help" && argv.length === 2) { console.log(SETUP_USAGE); return 0; }
  let plan;
  try { plan = parseAgentProfilesArgs(argv); }
  catch (e) {
    console.error(failure(N + " profile", e.message, ["known: " + SUBCOMMANDS.join(", ")], [N + " profile --help"]));
    return 2;
  }
  const store = readAgentProfiles(env);
  if (plan.subcommand === "setup") return runSetup(env);
  if (plan.subcommand === "check") return checkAnswer(plan, checkAgentProfiles(plan.name ? [plan.name] : [], env), env);
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
  let profiles;
  if (plan.subcommand === "remove") profiles = store.profiles.filter((p) => p.name !== plan.name);
  else {
    const candidate = { ...found, ...plan.fields };
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt")) delete candidate.prompt_file;
    if (Object.prototype.hasOwnProperty.call(plan.fields, "prompt_file")) delete candidate.prompt;
    const problems = profileProblems(candidate, store.path);
    if (problems.length) { console.error(failure(N + " profile " + plan.subcommand, "profile is invalid", problems)); return 1; }
    profiles = store.profiles.map((p) => p.name === plan.name ? candidate : p);
  }
  const written = writeAgentProfiles(profiles, env);
  const result = { path: written.path, exists: true, profiles, problems: [] };
  if (plan.json) { printJson("agent-profiles", { path: written.path, exists: true, profiles, profile: plan.subcommand === "remove" ? null : profiles.find((p) => p.name === plan.name) || null }); return 0; }
  console.log("✓ profile `" + plan.name + "` " + (plan.subcommand === "remove" ? "removed" : plan.subcommand + "d") + " — " + written.path);
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("agent-profiles.mjs")) process.exit(await run(process.argv.slice(2)));
