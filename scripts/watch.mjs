#!/usr/bin/env node
/** A quiet, live terminal frame for execution progress (TL-305). */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCT_NAME as N } from "./product.mjs";
import { readHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir } from "./paths.mjs";
import { failure, terminal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "cli.mjs");
export const WATCH_FLAGS = ["--dir", "--interval", "--once", "--json"];
export function parseWatchArgs(args) {
  const plan = { dir: null, interval: 2, once: false, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]; if (a === "--once") { plan.once = true; continue; } if (a === "--json") { plan.json = true; plan.once = true; continue; }
    if (a === "--dir" || a === "--interval") { const v = args[++i]; if (!v) throw new Error("`" + a + "` with no value"); plan[a.slice(2)] = a === "--interval" ? Number(v) : v; continue; }
    throw new Error("unknown flag: " + a + "\nknown flags: " + WATCH_FLAGS.join(" "));
  }
  if (!Number.isFinite(plan.interval) || plan.interval <= 0) throw new Error("`--interval` must be a positive number of seconds");
  return plan;
}
function call(args) { const r = spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } }); return { ok: r.status === 0, text: r.stdout || r.stderr || "" }; }
export function frame(plan) {
  const dir = plan.dir ? ["--dir", plan.dir] : [];
  const active = call(["query", "--status", "in_progress", "--json"].concat(dir));
  const wave = call(["plan", "--json"].concat(dir));
  const tasks = active.ok ? JSON.parse(active.text).tasks : [];
  const planState = wave.ok ? JSON.parse(wave.text) : null;
  const activeWave = planState && planState.waves.find((w) => w.active);
  const root = resolveBacklogDir({ dir: plan.dir || undefined }).root;
  const details = new Map(tasks.map((t) => [t.id, t]));
  const waveTasks = activeWave ? activeWave.tasks.map((t) => {
    const events = readHistory(root, t.id);
    const last = events.reduce((latest, e) => !latest || String(e.ts) > String(latest) ? e.ts : latest, null);
    const detail = details.get(t.id) || {};
    return { id: t.id, status: t.status, owner: detail.owner || "", title: detail.title || "", modified: last || detail.updated || null };
  }) : [];
  return { wave: activeWave ? { index: activeWave.index + 1, name: activeWave.name, open: activeWave.open, tasks: waveTasks } : null, tasks };
}
export function render(frame) {
  const wave = frame.wave ? "WAVE " + frame.wave.index + "  " + frame.wave.name + "  ·  " + frame.wave.open + " open" : "WAVE  no active plan wave";
  const lines = [N + " watch  ·  live task files  ·  Ctrl-C to stop", "", wave, "", "THIS WAVE"];
  for (const t of (frame.wave ? frame.wave.tasks : [])) {
    const current = t.status === "in_progress" ? "▶" : " ";
    lines.push(current + " " + t.id + "  " + t.status.padEnd(14) + "  " + (t.owner || "—") + "  " + (t.modified || "—"));
  }
  lines.push("", "IN PROGRESS");
  if (!frame.tasks.length) lines.push("  no tasks in progress");
  for (const t of frame.tasks) lines.push("  " + t.id + "  " + (t.owner || "unassigned") + "  " + t.title);
  return lines.join("\n") + "\n";
}
export function run(argv, deps = {}) {
  let plan; try { plan = parseWatchArgs(argv); } catch (e) { console.error(failure(N + " watch", e.message, [], [N + " watch --help"])); return 2; }
  const make = deps.frame || frame; const write = deps.write || ((s) => process.stdout.write(s)); const controls = deps.terminal || terminal;
  const one = () => { const value = make(plan); if (plan.json) printJson("watch", value); else write(render(value)); };
  if (plan.once || !process.stdout.isTTY) { one(); return 0; }
  const refresh = () => { write(controls.refreshLive()); one(); write(controls.eraseBelow()); };
  write(controls.openLive()); refresh(); const timer = setInterval(refresh, plan.interval * 1000); process.on("SIGINT", () => { clearInterval(timer); write(controls.closeLive()); process.exit(0); }); return 0;
}
if (process.argv[1] && process.argv[1].endsWith("watch.mjs")) process.exit(run(process.argv.slice(2)));
