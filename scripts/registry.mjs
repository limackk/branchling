#!/usr/bin/env node
/**
 * The project registry — an INDEX, never the truth (TL-34).
 *
 * WHAT IT IS NOT FOR, and this is the whole design. "Where is my backlog" is
 * already answered by detection upwards from the working directory, and it is
 * answered better: it cannot go stale, it needs no setup, and it is right in a
 * repository the registry has never heard of. A registry that also answered that
 * question would be a second source of truth for it, and the two would disagree
 * the first time somebody moved a directory. So the registry answers a question
 * detection CANNOT: which backlogs exist when you are standing in none of them.
 *
 * LAW 2 IS THE TEST. `projects.yaml` is computed in the sense that matters —
 * deleting it must cost nothing but the cross-project view. Every command that
 * runs inside a repository has to keep working with the file absent, and there
 * is a test for exactly that. If deleting it ever hurts, it has become a truth
 * it was never meant to be.
 *
 * THE UNIT IS THE BACKLOG DIRECTORY, NOT THE GIT REPOSITORY (§8 of
 * docs/worktrail-global-tool.md — a real path, product-name: allow). This is
 * not a nicety: the workspace this tool grew up in is a repository with no
 * remote holding `backlog/`, with nine separate repositories inside it. A
 * registry assuming "one repo = one project" produces ten entries there, nine of
 * which have no tasks. Monorepos and multi-repository workspaces are more common
 * than the single `.git` at the top, so this case has a test.
 *
 * A MISSING PATH IS REPORTED, NEVER SKIPPED. A silent skip turns "you moved the
 * repository" into "that project has no tasks", which is the same shape of
 * defect as a CLI flag that is quietly ignored: the answer looks like an answer.
 *
 * A NAME IS THE USER'S LABEL, not the project's identity. The path is the
 * identity; two people may call the same backlog different things and nothing
 * follows from it.
 *
 * Tests: `node --test scripts/tests/registry.test.mjs`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { ensureHome, registryPath } from "./home.mjs";
import { looksLikeBacklogDir } from "./paths.mjs";
import { stripComment, unquote } from "./task-fields.mjs";

/** A name a person types and later has to match: letters, digits, dash, dot,
 *  underscore. Narrow because it is a lookup key, not prose. */
export const PROJECT_NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Read the file. PURE — it is handed the text.
 *
 * The shape is a list of `- name:` / `path:` pairs, and nothing else is
 * accepted: an unreadable line is REPORTED rather than skipped, for the reason
 * in the header. A registry that quietly drops the entry it could not parse is
 * a registry that gets shorter every time somebody hand-edits it.
 *
 * @returns {{projects: Array<{name: string, path: string}>, problems: string[]}}
 */
export function parseRegistry(text) {
  const projects = [];
  const problems = [];
  const lines = String(text || "").split(/\r?\n/);
  let inList = false;
  let current = null;

  const flush = (line) => {
    if (!current) return;
    if (!current.name || !current.path) {
      problems.push(`line ${line}: an entry needs both \`name\` and \`path\``);
    } else {
      projects.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = stripComment(lines[i]);
    if (!raw.trim()) continue;
    if (/^projects:\s*$/.test(raw.trim())) { inList = true; continue; }
    if (!inList) {
      problems.push(`line ${i + 1}: expecting \`projects:\` before any entry`);
      continue;
    }
    const item = raw.match(/^\s*-\s*(.*)$/);
    if (item) {
      flush(i);
      current = { name: "", path: "" };
      const first = item[1].match(/^([a-z_]+):\s*(.*)$/);
      if (first) current[first[1]] = unquote(first[2]);
      continue;
    }
    const field = raw.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (field && current) {
      if (field[1] !== "name" && field[1] !== "path") {
        problems.push(`line ${i + 1}: unknown field \`${field[1]}\` (a project has a name and a path)`);
        continue;
      }
      current[field[1]] = unquote(field[2]);
      continue;
    }
    problems.push(`line ${i + 1}: cannot read \`${raw.trim()}\``);
  }
  flush(lines.length);
  return { projects, problems };
}

/** Write it back. The comment at the top is part of the file: this is a file a
 *  person will open, and the first thing they should learn is that deleting it
 *  is safe. */
export function serializeRegistry(projects) {
  const out = [
    "# Backlogs this machine knows about — an INDEX, not a source of truth.",
    "#",
    "# Deleting this file is HARMLESS: every command run inside a repository finds",
    "# its backlog by walking upwards from the working directory, and that is the",
    "# answer this file must never contradict. What is lost by deleting it is the",
    "# view ACROSS projects, nothing else.",
    "#",
    "# The unit is the BACKLOG directory, not the git repository: a workspace can",
    "# hold many repositories and one backlog, and it is then one project.",
    "#",
    "# A name is your own label on your own machine — it is not the project's",
    "# identity. The path is.",
    "projects:",
  ];
  for (const p of projects) {
    out.push("  - name: " + p.name);
    out.push("    path: " + p.path);
  }
  return out.join("\n") + "\n";
}

/**
 * Every registered project, each one REVALIDATED against the disk.
 *
 * `missing` is a separate list rather than an omission: the caller has to be
 * able to say "you registered this and it is not there any more", which is the
 * one thing a silent filter makes impossible.
 *
 * @returns {{path: string, exists: boolean, projects: Array, missing: Array,
 *            problems: string[]}}
 */
export function readRegistry(env = process.env) {
  const path = registryPath(env);
  if (!existsSync(path)) {
    return { path, exists: false, projects: [], missing: [], problems: [] };
  }
  const { projects, problems } = parseRegistry(readFileSync(path, "utf8"));
  const live = [];
  const missing = [];
  for (const project of projects) {
    (looksLikeBacklogDir(project.path, existsSync) ? live : missing).push(project);
  }
  return { path, exists: true, projects: live, missing, problems };
}

/** The label a fresh registration gets when nobody gave one: the directory the
 *  backlog SITS IN, not the backlog directory itself — `backlog` as a name for
 *  every project on a machine would make the registry useless on the second
 *  entry. */
export function defaultName(backlogRoot) {
  const abs = resolve(backlogRoot);
  const own = basename(abs);
  const parent = basename(dirname(abs));
  const candidate = own === "backlog" && parent ? parent : own;
  return PROJECT_NAME_SHAPE.test(candidate) ? candidate : "project";
}

function write(env, projects) {
  const path = registryPath(env);
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeRegistry(projects), "utf8");
  return path;
}

/**
 * Register a backlog. Idempotent BY PATH, because the path is the identity —
 * registering the same directory twice under two names would give one project
 * two entries and every cross-project count would be wrong.
 *
 * @returns {{ok: boolean, kind?: string, message?: string, project?: object,
 *            renamed?: object, path?: string}}
 */
export function addProject(backlogRoot, opts = {}) {
  const env = opts.env || process.env;
  const abs = resolve(backlogRoot);
  if (!looksLikeBacklogDir(abs, existsSync)) {
    return {
      ok: false, kind: "not-a-backlog",
      message: "that directory does not look like a backlog: " + abs,
      details: ["Expecting a tasks/ subdirectory and one of: boards.yaml, config.yaml, _template.md."],
    };
  }
  const name = String(opts.name || "").trim() || defaultName(abs);
  if (!PROJECT_NAME_SHAPE.test(name)) {
    return { ok: false, kind: "bad-name", message: "`" + name + "` is not a usable label" };
  }

  const current = readRegistry(env);
  const all = current.projects.concat(current.missing);
  // A label already spoken for is refused BEFORE the rename branch, not after
  // it: a re-registration under somebody else's name would otherwise half-apply
  // — the old entry renamed, the clash discovered too late, and two entries left
  // sharing a label that is supposed to be a lookup key.
  const clash = all.find((p) => p.name === name && resolve(p.path) !== abs);
  if (clash) {
    return {
      ok: false, kind: "name-taken",
      message: "`" + name + "` already points at " + clash.path,
      details: ["A label is yours to choose; pick another with `--name`."],
    };
  }

  const existing = all.find((p) => resolve(p.path) === abs);
  if (existing) {
    if (existing.name === name) return { ok: true, already: true, project: existing, path: current.path };
    const renamed = { ...existing };
    existing.name = name;
    ensureHome(env);
    return { ok: true, renamed, project: existing, path: write(env, all) };
  }

  const project = { name, path: abs };
  all.push(project);
  ensureHome(env);
  return { ok: true, project, path: write(env, all) };
}

/** Forget a project. By name or by path — a person remembers whichever they
 *  used. Removing something that was never registered is not an error worth an
 *  exit code, but it IS worth saying, because the alternative is a person
 *  believing they removed something they misspelled. */
export function removeProject(nameOrPath, opts = {}) {
  const env = opts.env || process.env;
  const current = readRegistry(env);
  const all = current.projects.concat(current.missing);
  const wanted = String(nameOrPath || "").trim();
  const abs = resolve(wanted);
  const kept = all.filter((p) => p.name !== wanted && resolve(p.path) !== abs);
  if (kept.length === all.length) {
    return { ok: false, kind: "not-registered", message: "nothing registered as `" + wanted + "`" };
  }
  ensureHome(env);
  return { ok: true, removed: all.length - kept.length, path: write(env, kept) };
}

/**
 * Which registered entries are dead, and in which of the two ways (TL-176).
 *
 * THE TWO ARE NOT THE SAME PROBLEM AND MUST NOT SHARE A FIX. A path that does
 * not exist is a project moved or deleted — nothing can be done with the entry
 * and nobody will miss it. A path that EXISTS but no longer looks like a backlog
 * is somebody's checkout mid-surgery, or a `tasks/` deleted by accident: the
 * directory is still there, and forgetting it would throw away the only record
 * that it used to be a project.
 *
 * PURE apart from the existence check it is handed.
 */
export function classifyRegistry(registry, exists = existsSync) {
  const gone = [];
  const hollow = [];
  for (const p of registry.missing || []) (exists(p.path) ? hollow : gone).push(p);
  return { live: registry.projects || [], gone, hollow };
}

/**
 * Forget the entries whose directory is gone.
 *
 * NEVER AUTOMATIC, and never on a schedule. The registry is the one file that
 * records a decision the user made; a network share that did not mount this
 * morning is not a reason to forget a project. So this is a command somebody
 * runs, `--dry-run` is offered first, and it names every entry it takes.
 *
 * `includeHollow` extends it to directories that exist but are no longer
 * backlogs — off by default, for the reason `classifyRegistry` gives.
 */
export function pruneProjects(opts = {}) {
  const env = opts.env || process.env;
  const registry = readRegistry(env);
  if (!registry.exists) {
    return { ok: true, removed: [], kept: 0, dryRun: Boolean(opts.dryRun), path: registry.path, existed: false };
  }
  const { live, gone, hollow } = classifyRegistry(registry);
  const removed = opts.includeHollow ? gone.concat(hollow) : gone;
  const kept = live.concat(opts.includeHollow ? [] : hollow);
  if (opts.dryRun || !removed.length) {
    return { ok: true, removed, kept: kept.length, dryRun: Boolean(opts.dryRun), path: registry.path, existed: true };
  }
  ensureHome(env);
  return { ok: true, removed, kept: kept.length, dryRun: false, path: write(env, kept), existed: true };
}

/** Registration that must never fail the command it rode in on — `init` calls
 *  this. Creating a backlog is the user's request; putting it in an index is
 *  the tool's convenience, and a read-only home directory may not turn the
 *  first into a failure. */
export function registerQuietly(backlogRoot, opts = {}) {
  try {
    const result = addProject(backlogRoot, opts);
    return result.ok ? result : null;
  } catch {
    return null;
  }
}

/** Which registered project a directory belongs to, if any. Used by `where` to
 *  say whether the backlog it found is one this machine knows about — a
 *  question, never an answer that overrides detection. */
export function projectFor(backlogRoot, env = process.env) {
  const abs = resolve(backlogRoot);
  return readRegistry(env).projects.find((p) => resolve(p.path) === abs) || null;
}

export { registryPath };
