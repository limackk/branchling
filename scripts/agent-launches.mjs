#!/usr/bin/env node
/** Local named compositions of provider-neutral profiles (TL-315). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { agentLaunchesPath, ensureHome } from "./home.mjs";
import { PROFILE_NAME_SHAPE, readAgentProfiles } from "./agent-profiles.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure, heading, table } from "./ui.mjs";

export const LAUNCH_FIELDS = ["name", "profile", "profile_for"];
export function parseAgentLaunches(text) {
  const launches = []; let current = null; const problems = []; const seen = new Set();
  for (const [i, raw] of String(text || "").split(/\r?\n/).entries()) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/^launches:\s*$/.test(raw)) continue;
    const first = raw.match(/^\s*-\s*([a-z_]+):\s*"(.*)"\s*$/);
    const field = raw.match(/^\s+([a-z_]+):\s*"(.*)"\s*$/);
    if (first) { if (current) launches.push(current); current = { [first[1]]: first[2] }; continue; }
    if (field && current && LAUNCH_FIELDS.includes(field[1])) { current[field[1]] = field[2]; continue; }
    problems.push("line " + (i + 1) + ": cannot read launch configuration");
  }
  if (current) launches.push(current);
  for (const launch of launches) {
    if (!PROFILE_NAME_SHAPE.test(launch.name || "")) problems.push("launch name must be a lowercase slug");
    if (seen.has(launch.name)) problems.push("duplicate launch `" + launch.name + "`");
    seen.add(launch.name);
    for (const pair of String(launch.profile_for || "").split(",").filter(Boolean)) if (!/^[a-z0-9._-]+=[a-z0-9._-]+$/.test(pair)) problems.push("launch `" + launch.name + "` profile_for must be role=profile pairs");
  }
  return { launches, problems };
}
export function serializeAgentLaunches(launches) {
  return ["# Named local profile routing. Keep provider configuration in profiles and adapters.", "launches:", ...launches.flatMap((l) => ["  - name: " + JSON.stringify(l.name), ...(l.profile ? ["    profile: " + JSON.stringify(l.profile)] : []), ...(l.profile_for ? ["    profile_for: " + JSON.stringify(l.profile_for)] : [])])].join("\n") + "\n";
}
export function readAgentLaunches(env = process.env) { const path = agentLaunchesPath(env); if (!existsSync(path)) return { path, exists: false, launches: [], problems: [] }; return { path, exists: true, ...parseAgentLaunches(readFileSync(path, "utf8")) }; }
export function resolveAgentLaunch(name, env = process.env) {
  const store = readAgentLaunches(env); if (store.problems.length) return { ok: false, kind: "invalid-store", store };
  const launch = store.launches.find((l) => l.name === name); if (!launch) return { ok: false, kind: "missing-launch", store };
  const profiles = readAgentProfiles(env); if (profiles.problems.length) return { ok: false, kind: "invalid-profiles", store, profiles };
  const profileFor = Object.fromEntries(String(launch.profile_for || "").split(",").filter(Boolean).map((p) => p.split("=")));
  const names = [launch.profile, ...Object.values(profileFor)].filter(Boolean);
  const missing = names.filter((name) => !profiles.profiles.some((p) => p.name === name));
  if (missing.length) return { ok: false, kind: "missing-profile", store, missing };
  return { ok: true, launch: { name, profile: launch.profile || null, profileFor }, store };
}
const USAGE = `${N} launch <list|show|create|update|remove> [name] [--profile <name>] [--profile-for <role=profile>] [--json]`;
export function run(argv, env = process.env) {
  const command = argv[0]; let name = null; const rest = argv.slice(1); const json = rest.includes("--json"); const values = { profileFor: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--profile") { values.profile = rest[++i]; continue; }
    if (rest[i] === "--profile-for") { values.profileFor.push(rest[++i]); continue; }
    if (rest[i] === "--json") continue;
    if (rest[i].startsWith("-")) { console.error(failure(N + " launch", "unknown flag: " + rest[i], [USAGE])); return 2; }
    if (name) { console.error(failure(N + " launch", "two launch names")); return 2; }
    name = rest[i];
  }
  if (!command || !["list", "show", "create", "update", "remove"].includes(command)) { console.error(failure(N + " launch", USAGE)); return 2; }
  const store = readAgentLaunches(env); if (store.problems.length) { console.error(failure(N + " launch", "cannot read local launches", store.problems)); return 1; }
  if (command === "list") { if (json) { printJson("agent-launches", { path: store.path, launches: store.launches, launch: null }); return 0; } console.log(heading("agent launches") + "\n" + table(store.launches.map((l) => [l.name, l.profile || "", l.profile_for || ""]))); return 0; }
  const found = store.launches.find((l) => l.name === name);
  if (command === "show") { if (!found) return 1; if (json) printJson("agent-launches", { path: store.path, launches: store.launches, launch: found }); else console.log(JSON.stringify(found, null, 2)); return 0; }
  if (!name) { console.error(failure(N + " launch", "a launch name is required", [USAGE])); return 2; }
  let launches = store.launches;
  if (command === "create") { if (found) return 1; launches = launches.concat({ name, profile: values.profile || "", profile_for: values.profileFor.join(",") }); }
  if (command === "update") { if (!found) return 1; if (!values.profile && !values.profileFor.length) { console.error(failure(N + " launch update", "provide --profile or --profile-for")); return 2; } launches = launches.map((l) => l.name === name ? { ...l, ...(values.profile ? { profile: values.profile } : {}), ...(values.profileFor.length ? { profile_for: values.profileFor.join(",") } : {}) } : l); }
  if (command === "remove") { if (!found) return 1; launches = launches.filter((l) => l.name !== name); }
  const parsed = parseAgentLaunches(serializeAgentLaunches(launches)); if (parsed.problems.length) { console.error(failure(N + " launch", "launch is invalid", parsed.problems)); return 1; }
  ensureHome(env); writeFileSync(store.path, serializeAgentLaunches(launches), "utf8"); if (json) printJson("agent-launches", { path: store.path, launches, launch: command === "remove" ? null : launches.find((l) => l.name === name) }); else console.log("✓ launch `" + name + "` " + (command === "remove" ? "removed" : command + "d")); return 0;
}
if (process.argv[1] && process.argv[1].endsWith("agent-launches.mjs")) process.exit(run(process.argv.slice(2)));
