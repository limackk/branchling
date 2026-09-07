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

import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";

import { ADAPTER_PROTOCOL_VERSION, PROFILE_PROBE_ENV, PROFILE_PROBE_OUTCOMES, PROFILE_PROTOCOL_VERSION_ENV } from "./agent-contract.mjs";
import { agentProfilesPath, ensureHome, homePaths } from "./home.mjs";
import { lockScope } from "./lock.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { stripComment, unquote } from "./task-fields.mjs";
import { failure, heading, table } from "./ui.mjs";
import { createAgentLaunch } from "./agent-launches.mjs";
import { loadConfig } from "./config.mjs";
import { resolveBacklogDir } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

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

/** Examples shipped with this package, not a registry of supported providers. */
export function referenceAdapterTemplates() {
  return [
    { id: "claude-code", label: "Claude Code CLI", source: resolve(HERE, "..", "examples", "agent-adapters", "claude-code.mjs") },
    { id: "aider-api", label: "Aider API harness", source: resolve(HERE, "..", "examples", "agent-adapters", "aider-api.mjs") },
    { id: "codex-cli", label: "Codex CLI", source: resolve(HERE, "..", "examples", "agent-adapters", "codex-cli.mjs") },
    { id: "ollama", label: "Ollama local model", source: resolve(HERE, "..", "examples", "agent-adapters", "ollama.mjs"), model: { required: true, hint: "Ollama needs a pulled model name, for example qwen2.5-coder:7b." } },
  ];
}

/** User profiles are portable across repositories, so their copied adapters
 * live beside that user-owned configuration rather than in whichever project
 * happened to be current during setup. */
export function suggestedReferenceAdapterDestination(template, env = process.env, root = null) {
  const base = root ? dirname(projectAgentProfilesPath(root, env)) : homePaths(env).config;
  return join(base, "adapters", template.id + ".mjs");
}

/** Copy a versioned local example without downloading or running it. */
export function copyReferenceAdapter(template, destination) {
  const source = template && template.source;
  const target = resolve(destination || "");
  if (!source || !existsSync(source)) throw new Error("reference adapter is unavailable in this installation");
  if (!destination || existsSync(target)) throw new Error("adapter destination already exists: " + target);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  return target;
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
  return { ok: true, profile: { ...profile, protocol_version: String(profile.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(profile, profilePathInStore(store, name)) }, store };
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
    const resolved = { ...found, protocol_version: String(found.protocol_version || ADAPTER_PROTOCOL_VERSION), prompt: profilePrompt(found, profilePathInStore(store, name)) };
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
  "  Choices use arrows and Enter in a capable terminal; numbered text works everywhere else.",
  "  In a Git project, the first choices keep the profile local and copy an inspectable reference adapter.",
  "  Enter accepts the shown adapter destination and the general implementation prompt; it never guesses a model or credential.",
  "  During input: `back` revisits the previous field; `cancel` leaves no change.",
  "  The setup never starts an adapter, contacts a provider or asks for a secret value.",
].join("\n");

const BACK = Symbol("back");
const CANCEL = Symbol("cancel");
const DEFAULT_GENERALIST_PROMPT = "Implement the task with evidence.";

function setupAnswer(value, fallback = "") {
  if (value === null || value === undefined) return CANCEL;
  const text = String(value).trim();
  if (/^(cancel|quit|q)$/i.test(text)) return CANCEL;
  if (/^(back|b)$/i.test(text)) return BACK;
  return text || fallback;
}

/** A choice may be enhanced by raw keys, but test transcripts remain text. */
async function setupChoice(io, question, options, allowBack = false) {
  const presented = allowBack ? options.concat({ label: "← Back", hint: "Return to the previous step without saving.", value: "__back__" }) : options;
  if (typeof io.choose === "function") {
    const result = await io.choose(question, presented);
    if (!result.ok) return CANCEL;
    return result.value === "__back__" ? BACK : setupAnswer(result.value);
  }
  io.write(presented.map((option, index) => (index + 1) + ") " + option.label).join("\n") + "\n");
  const answer = setupAnswer(await io.ask(question + " [1-" + presented.length + "]: "));
  if (answer === BACK || answer === CANCEL) return answer;
  const selected = presented[Number(answer) - 1];
  return selected ? (selected.value === "__back__" ? BACK : setupAnswer(selected.value)) : answer;
}

/**
 * The setup state machine is terminal-independent so its cancellation and write
 * boundary can be tested without a pseudo-terminal.
 */
export async function setupProfileConversation(io, env = process.env, actions = {}) {
  const copyAdapter = actions.copyReferenceAdapter || copyReferenceAdapter;
  const projectRoot = actions.projectRoot || null;
  const fields = [
    { key: "name", label: "Name this reusable profile (lowercase slug, e.g. codex-reviewer)", required: true },
    { key: "prompt", label: "What should this agent be responsible for? (Enter for a general implementation prompt)", required: true },
    { key: "model", label: "Model identifier (optional; passed to the adapter, e.g. claude-sonnet)", required: false },
    { key: "effort", label: "Reasoning effort (optional; passed to the adapter, e.g. high)", required: false },
    { key: "secret_env", label: "Credential variable names (optional; names only, e.g. ANTHROPIC_API_KEY)", required: false },
  ];
  const state = {};
  io.write("A profile is a reusable local recipe for starting one agent. It stores no secret values. Type back or cancel at any prompt.\n");
  let index = 0;
  while (index < 1) {
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
  let scopeRoot = null;
  if (projectRoot) {
    const scope = await setupChoice(io, "Where should this agent be available?", [
      { label: "Only this Git project", hint: "Recommended: keeps its adapter, model, prompt and routing private here.", value: "project" },
      { label: "Every project on this machine", hint: "Choose this for a deliberately reusable personal agent.", value: "global" },
    ]);
    if (scope === CANCEL) return { ok: false, kind: "cancelled" };
    scopeRoot = scope === "project" ? projectRoot : null;
  }
  io.write("\nChoose how Branchling will start this agent. The adapter translates this profile to a provider CLI or API wrapper.\n");
  let sourceChoice = await setupChoice(io, "How should Branchling start this agent?", [
    { label: "Copy a shipped reference adapter", hint: "Recommended: start from a local example you can inspect and adapt.", value: "reference" },
    { label: "Use my own Branchling adapter", hint: "Advanced: only if you already created an adapter wrapper.", value: "custom" },
  ], true);
  if (sourceChoice === CANCEL) return { ok: false, kind: "cancelled" };
  if (sourceChoice === BACK) {
    const answer = setupAnswer(await io.ask(fields[0].label + " [" + state.name + "]: "), state.name);
    if (answer === CANCEL || answer === BACK || !answer) return { ok: false, kind: "cancelled" };
    state.name = answer;
    sourceChoice = await setupChoice(io, "How should Branchling start this agent?", [
      { label: "Copy a shipped reference adapter", hint: "Recommended: start from a local example you can inspect and adapt.", value: "reference" },
      { label: "Use my own Branchling adapter", hint: "Advanced: only if you already created an adapter wrapper.", value: "custom" },
    ], true);
  }
  if (sourceChoice === CANCEL || sourceChoice === BACK) return { ok: false, kind: "cancelled" };
  let reference = null;
  if (sourceChoice === "custom") {
    io.write("Enter the path to your executable Branchling adapter wrapper. This is not `claude` and not a model name. Example: /Users/you/bin/my-agent-adapter.mjs\n");
    const adapter = setupAnswer(await io.ask("Path to your adapter executable: "));
    if (adapter === CANCEL || adapter === BACK || !adapter) return { ok: false, kind: "cancelled" };
    state.adapter = adapter;
  } else if (sourceChoice === "reference") {
    const templates = referenceAdapterTemplates();
    while (!reference) {
      const selected = await setupChoice(io, "Which reference adapter should be copied?", templates.map((template, index) => ({ label: template.label, hint: "Copied locally; it does not contact the provider now.", value: String(index + 1) })), true);
      if (selected === CANCEL) return { ok: false, kind: "cancelled" };
      if (selected === BACK) {
        const alternative = await setupChoice(io, "How should Branchling start this agent?", [
          { label: "Copy a shipped reference adapter", hint: "Recommended: start from a local example you can inspect and adapt.", value: "reference" },
          { label: "Use my own Branchling adapter", hint: "Advanced: only if you already created an adapter wrapper.", value: "custom" },
        ], true);
        if (alternative === CANCEL || alternative === BACK) return { ok: false, kind: "cancelled" };
        if (alternative === "reference") continue;
        io.write("Enter the path to your executable Branchling adapter wrapper. This is not `claude` and not a model name. Example: /Users/you/bin/my-agent-adapter.mjs\n");
        const adapter = setupAnswer(await io.ask("Path to your adapter executable: "));
        if (adapter === CANCEL || adapter === BACK || !adapter) return { ok: false, kind: "cancelled" };
        state.adapter = adapter;
        break;
      }
      const template = templates[Number(selected) - 1];
      if (!template) { io.write("Choose one of the listed reference adapters. Nothing was written.\n"); continue; }
      const suggestedDestination = suggestedReferenceAdapterDestination(template, env, scopeRoot);
      io.write("Recommended: " + suggestedDestination + " keeps this editable adapter with " + (scopeRoot ? "this project's local configuration" : "your local profiles") + ". Press Enter to use it, or provide another path.\n");
      const destination = setupAnswer(await io.ask("Copy destination [" + suggestedDestination + "]: "), suggestedDestination);
      if (destination === CANCEL) return { ok: false, kind: "cancelled" };
      if (destination === BACK) continue;
      reference = { template, destination };
      state.adapter = resolve(destination);
    }
  } else {
    io.write("Choose 1 or 2. Nothing was written.\n");
    return { ok: false, kind: "cancelled" };
  }
  index = 1;
  while (index < fields.length) {
    const field = fields[index];
    const current = state[field.key] || "";
    const modelRequirement = field.key === "model" && reference && reference.template.model;
    const fallback = field.key === "prompt" ? (current || DEFAULT_GENERALIST_PROMPT) : current;
    const suffix = current ? ` [${current}]` : field.key === "prompt" ? ` [${DEFAULT_GENERALIST_PROMPT}]` : "";
    if (modelRequirement) io.write(modelRequirement.hint + "\n");
    const answer = setupAnswer(await io.ask((modelRequirement ? "Model identifier (required for this adapter)" : field.label) + suffix + ": "), fallback);
    if (answer === CANCEL) return { ok: false, kind: "cancelled" };
    if (answer === BACK) { if (index > 1) index--; continue; }
    if ((field.required || modelRequirement) && !answer) { io.write((modelRequirement ? "A model identifier" : field.label) + " is required.\n"); continue; }
    state[field.key] = answer;
    index++;
  }
  const secret = state.secret_env ? "\n  credential variables: " + state.secret_env : "";
  const source = reference ? "reference " + reference.template.label + " -> " + state.adapter : "custom executable";
  const scope = scopeRoot ? "this Git project" : "every project on this machine";
  io.write("\nProfile summary:\n  name: " + state.name + "\n  adapter: " + state.adapter
    + "\n  model: " + (state.model || "(none)") + "\n  effort: " + (state.effort || "(none)")
    + secret + "\n  scope: " + scope + "\n  source: " + source + "\n\n");
  const confirmation = await setupChoice(io, "Create this profile", [
    { label: "Create profile", value: "1" }, { label: "Back", value: "2" }, { label: "Cancel", value: "3" },
  ]);
  if (confirmation === CANCEL || confirmation === "3") return { ok: false, kind: "cancelled" };
  if (confirmation === BACK || confirmation === "2") {
    index = fields.length - 1;
    while (index < fields.length) {
      const field = fields[index];
      const modelRequirement = field.key === "model" && reference && reference.template.model;
      const fallback = field.key === "prompt" ? (state[field.key] || DEFAULT_GENERALIST_PROMPT) : state[field.key] || "";
      const answer = setupAnswer(await io.ask((modelRequirement ? "Model identifier (required for this adapter)" : field.label) + " [" + fallback + "]: "), fallback);
      if (answer === CANCEL) return { ok: false, kind: "cancelled" };
      if (answer === BACK) { if (index) index--; continue; }
      if ((field.required || modelRequirement) && !answer) { io.write((modelRequirement ? "A model identifier" : field.label) + " is required.\n"); continue; }
      state[field.key] = answer;
      index++;
    }
    io.write("\nProfile summary confirmed after edits.\n");
    const retry = await setupChoice(io, "Create this profile", [
      { label: "Create profile", value: "1" }, { label: "Cancel", value: "3" },
    ]);
    if (retry === CANCEL || retry === "3" || retry !== "1") return { ok: false, kind: "cancelled" };
  } else if (confirmation !== "1") {
    io.write("Choose 1, 2 or 3. Nothing was written.\n");
    return { ok: false, kind: "cancelled" };
  }
  const { name, ...profile } = state;
  const checked = validateAgentProfileCreation(name, profile, env, scopeRoot);
  if (!checked.ok) return checked;
  let copied = null;
  try {
    if (reference) copied = copyAdapter(reference.template, reference.destination);
    return createAgentProfile(name, profile, env, scopeRoot);
  } catch (error) {
    if (copied) rmSync(copied, { force: true });
    return { ok: false, kind: "copy-failed", problems: [error.message] };
  }
}

export async function setupFleetConversation(io, env = process.env, actions = {}) {
  const resolveBacklog = actions.resolveBacklog || (() => resolveBacklogDir({ moduleDir: HERE }));
  let root;
  try { root = resolveBacklog().root; } catch { return { ok: false, kind: "no-backlog", problems: ["fleet setup needs a backlog in the current directory"] }; }
  let config;
  try { config = loadConfig(root); } catch (error) { return { ok: false, kind: "invalid-backlog", problems: [error.message] }; }
  const roles = config.roles || [];
  const profiles = readAvailableAgentProfiles(root, env);
  if (!roles.length) return { ok: false, kind: "no-roles", problems: ["this backlog declares no roles"] };
  if (profiles.problems.length) return { ok: false, kind: "invalid-store", problems: profiles.problems };
  if (!profiles.profiles.length) return { ok: false, kind: "no-profiles", problems: ["create one profile first with `profile setup`"] };
  io.write("A specialist fleet routes repository roles to existing local profiles. Existing profiles: " + profiles.profiles.map((p) => p.name).join(", ") + "\n");
  const name = setupAnswer(await io.ask("Name this reusable routing map (lowercase slug, e.g. delivery-team): "));
  if (name === CANCEL || name === BACK || !name) return { ok: false, kind: "cancelled" };
  const scope = await setupChoice(io, "Where should this fleet routing be available?", [
    { label: "Only this Git project", hint: "Recommended: keep this repository's role routing private here.", value: "project" },
    { label: "Every project on this machine", hint: "Choose this for a deliberately reusable role-to-profile arrangement.", value: "global" },
  ]);
  if (scope === CANCEL) return { ok: false, kind: "cancelled" };
  const scopeRoot = scope === "project" ? root : null;
  const profileFor = {};
  const choices = (unassigned) => [
    { label: unassigned, hint: "Leave this routing intentionally unset.", value: "" },
    ...profiles.profiles.map((profile) => ({ label: profile.name, hint: profile.model ? "Model: " + profile.model : "No model identifier set.", value: profile.name })),
  ];
  for (const role of roles) {
    const selected = await setupChoice(io, "Which profile should handle repository role `" + role + "`?", choices("Leave `" + role + "` unassigned"));
    if (selected === CANCEL || selected === BACK) return { ok: false, kind: "cancelled" };
    if (selected && !profiles.profiles.some((p) => p.name === selected)) return { ok: false, kind: "missing-profile", problems: ["no local profile `" + selected + "`"] };
    if (selected) profileFor[role] = selected;
  }
  const generalist = await setupChoice(io, "Which profile should handle tasks with no matching role?", choices("Leave general work unassigned"));
  if (generalist === CANCEL || generalist === BACK) return { ok: false, kind: "cancelled" };
  if (generalist && !profiles.profiles.some((p) => p.name === generalist)) return { ok: false, kind: "missing-profile", problems: ["no local profile `" + generalist + "`"] };
  io.write("\nFleet summary:\n  name: " + name + "\n  scope: " + (scopeRoot ? "this Git project" : "every project on this machine") + "\n  generalist: " + (generalist || "(none)") + "\n  roles: " + Object.entries(profileFor).map(([r, p]) => r + "=" + p).join(", ") + "\n");
  const confirm = await setupChoice(io, "Create this launch", [
    { label: "Create launch", value: "1" }, { label: "Cancel", value: "3" },
  ]);
  if (confirm === CANCEL || confirm === "3" || confirm !== "1") return { ok: false, kind: "cancelled" };
  return createAgentLaunch(name, generalist, profileFor, env, scopeRoot);
}

/** Translate a typed setup failure into the next action a person can take. */
export function setupFailureMessage(result) {
  const problem = (result && result.problems || []).join(" ");
  if (result && result.kind === "no-roles") {
    return { problem: problem || "This backlog declares no roles.", next: "Add `roles: [developer, reviewer]` to backlog/config.yaml, then run setup again." };
  }
  if (result && result.kind === "no-profiles") {
    return { problem: problem || "No local agent profiles exist yet.", next: "Run `" + N + " profile setup` and choose one agent for general work first." };
  }
  if (result && result.kind === "missing-profile") {
    return { problem: problem || "A selected local profile is missing.", next: "Run `" + N + " profile list` to choose an existing profile or create one." };
  }
  return { problem: problem || "Setup could not be completed.", next: "Nothing was written. Review the message above and try again." };
}

/** Fleet routing is meaningful only after at least one local profile exists. */
export function setupModes(profiles) {
  const modes = [{ label: "One agent for general work", hint: "Recommended first setup. Use it for any task.", value: "1" }];
  if (profiles && profiles.length) modes.push({ label: "A specialist fleet", hint: "Advanced: route repository roles to different profiles.", value: "2" });
  return modes;
}

function fleetRolesAvailable() {
  try { return (loadConfig(resolveBacklogDir({ moduleDir: HERE }).root).roles || []).length > 0; }
  catch { return false; }
}

async function runSetup(env = process.env, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) {
    console.error(failure(N + " profile setup", "interactive setup needs a terminal", ["Use `" + N + " profile create <name> …` from a script or pipe."]));
    return 2;
  }
  const io = {
    ask: async (question) => {
      const answer = await clack.text({ message: String(question).replace(/:\s*$/, "") });
      return clack.isCancel(answer) ? null : answer;
    },
    write: (text) => clack.log.message(String(text).trim()),
    choose: async (question, options) => {
      const answer = await clack.select({ message: question, options });
      return clack.isCancel(answer) ? { ok: false } : { ok: true, value: answer };
    },
  };
  try {
    let projectRoot = null;
    try { projectRoot = resolveBacklogDir({ moduleDir: HERE }).root; } catch { /* Global setup remains available outside a backlog. */ }
    clack.intro("Configure " + N);
    const modes = setupModes((projectRoot ? readAvailableAgentProfiles(projectRoot, env) : readAgentProfiles(env)).profiles);
    const firstProfile = modes.length === 1;
    if (modes.length === 1) clack.note("Specialist fleets become available after you create at least one local agent profile.", "First setup");
    const mode = await setupChoice(io, "What do you want to configure?", modes);
    if (mode === CANCEL) { clack.cancel("No configuration was created."); return 0; }
    const result = mode === "2" ? await setupFleetConversation(io, env) : mode === "1" ? await setupProfileConversation(io, env, { projectRoot }) : { ok: false, kind: "cancelled" };
    if (!result.ok) {
      if (result.kind === "cancelled") { clack.cancel("No profile was created."); return 0; }
      const message = setupFailureMessage(result);
      clack.log.error(message.problem);
      clack.outro(message.next);
      return 1;
    }
    if (mode === "2") clack.outro("Launch `" + result.launch.name + "` created. Next: `" + N + " run --launch " + result.launch.name + " --dry-run`.");
    else if (firstProfile && fleetRolesAvailable()) {
      const addFleet = await clack.confirm({ message: "Your general agent is ready. Configure specialist fleet routing now?", initialValue: false });
      if (addFleet === true) {
        const fleet = await setupFleetConversation(io, env);
        if (fleet.ok) clack.outro("Profile and launch `" + fleet.launch.name + "` created.");
        else clack.outro("Profile `" + result.profile.name + "` created. Fleet routing was not created.");
      } else clack.outro("Profile `" + result.profile.name + "` created. Next: `" + N + " profile check " + result.profile.name + "`.");
    } else clack.outro("Profile `" + result.profile.name + "` created. Next: `" + N + " profile check " + result.profile.name + "`.");
    return 0;
  } catch (error) {
    console.error(failure(N + " profile setup", "setup stopped before writing", [error.message]));
    return 1;
  } finally {}
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
  let projectRoot = null;
  try { projectRoot = resolveBacklogDir({ moduleDir: HERE }).root; } catch { /* A global profile command is valid outside a backlog. */ }
  const store = projectRoot ? readAvailableAgentProfiles(projectRoot, env) : readAgentProfiles(env);
  if (plan.subcommand === "setup") return runSetup(env);
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
