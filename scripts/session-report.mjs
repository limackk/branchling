#!/usr/bin/env node
/**
 * `sessions` and `session <id>` — a black box for agent work (TL-92).
 *
 * THE SCENARIO IT IS FOR: it is morning, a fleet of agents worked overnight,
 * and one command has to say what each session delivered. Including the ones
 * that delivered nothing — a session with heartbeats and not a single status
 * transition is a SIGNAL ("it worked and closed nothing"), and a report that
 * only listed the productive ones would be a report you cannot trust to be
 * complete.
 *
 * IT WRITES NOTHING AND RECORDS NOTHING NEW. Two logs already exist —
 * `activity/` (heartbeats, sessions, attribution) and `history/` (field changes
 * with an actor) — and this stitches them together at read time, the way
 * `stats` does. That is also why the counter is NOT here: minutes come from
 * `clusterHeartbeats()`, the one implementation, because the same decision made
 * in two places is the same decision made differently within a month.
 *
 * THE ONE HONEST GAP, and it is named rather than papered over. History entries
 * carry an actor and a timestamp but NO session id, so a field change cannot be
 * attributed to a session with certainty. This report therefore correlates by
 * TASK AND TIME WINDOW and says so — every answer carries
 * `correlation: "window"`, and `--json` consumers can see it. The gap is not
 * worked around silently; it is TL-164, against the log that would have to
 * carry the field.
 *
 * WHY A TOKEN COUNT IS NEVER PRINTED WITHOUT A MODEL. "280k tokens" means three
 * different things for a frontier model over an API, an agent on a
 * subscription, and a local model on somebody's laptop — the number alone is
 * under-interpretable, and a reader will interpret it anyway. So tokens are
 * reported PER MODEL or not at all, and a session that used two models gets two
 * rows rather than one sum. Nothing in this repository writes those fields yet;
 * when an adapter does, this reads them.
 *
 * MISSING COST IS NOT ZERO. A column that is absent and a column that says `0`
 * are different claims, and only one of them is true here.
 *
 * Exit: 0 = reported · 1 = no such session · 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/session-report.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readAllActivity } from "./activity.mjs";
import { clusterHeartbeats, unionMinutes } from "./cluster.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { readAllHistory } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A row with no session belongs to no session, and folding those together
 *  would merge two machines that never met. They get one bucket, named. */
export const UNSESSIONED = "(no session id)";

const LIST_FLAGS = ["--since", "--actor", "--task", "--json", "--dir"];
const ONE_FLAGS = ["--json", "--dir"];

export const LIST_USAGE = [
  `${N} sessions [--since <YYYY-MM-DD>] [--actor <ns:name>] [--task <ID>] [--json] [--dir <path>]`,
  "",
  "  Every working session the activity log recorded: who, which tasks, how long,",
  "  and what moved. Written for the morning after a fleet of agents worked",
  "  overnight.",
  "",
  "  A SESSION THAT MOVED NOTHING IS LISTED, marked `nothing moved`. That is a",
  "  signal — it worked and closed nothing — and a report that quietly dropped",
  "  those would be one you cannot trust to be complete.",
  "",
  "  --since <date>  only sessions that were still running on or after this day",
  "  --actor <a>     only this actor's sessions",
  "  --task <ID>     only sessions that touched this task",
  "",
  `  \`${N} session <id>\` tells one session's story.`,
].join("\n");

export const ONE_USAGE = [
  `${N} session <id> [--json] [--dir <path>]`,
  "",
  "  One session's narrative: the tasks it touched, its working clusters with",
  "  their minutes, and the field changes recorded against those tasks while it",
  "  was running.",
  "",
  "  THE FIELD CHANGES ARE CORRELATED BY TASK AND TIME WINDOW, not by session id:",
  "  the history log does not carry one. Every answer says so, and a change made",
  "  by another actor inside the same window is shown with its actor rather than",
  "  claimed for this session.",
  "",
  "  Minutes come from the same clustering every other report uses; there is no",
  "  second counter here.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parseSessionsArgs(args) {
  const opts = { since: null, actor: null, task: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { opts.json = true; continue; }
    if (a === "--since" || a === "--actor" || a === "--task") {
      const value = args[++i];
      if (!value) throw new Error("`" + a + "` with no value");
      if (a === "--since" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("`--since " + value + "` is not a date\nthe shape is YYYY-MM-DD");
      }
      opts[a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + LIST_FLAGS.join(" "));
    throw new Error("unexpected argument: " + a + "\nevery criterion is a flag; one session is `" + N + " session <id>`");
  }
  return opts;
}

export function parseSessionArgs(args) {
  let id = null;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { json = true; continue; }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + ONE_FLAGS.join(" "));
    if (id) throw new Error("more than one session id: " + id + " and " + a);
    id = a;
  }
  if (!id) throw new Error("which session?\n`" + N + " sessions` lists them");
  return { id, json };
}

// ──────────────────────────────────────────────────────────────────────────
// Stitching the two logs together — PURE
// ──────────────────────────────────────────────────────────────────────────

/**
 * Tokens, PER MODEL. Never a total.
 *
 * `null` when nothing recorded any, which is not the same claim as `0` — and
 * the difference matters most in exactly the place a reader will skim.
 */
export function tokensByModel(rows) {
  const byModel = new Map();
  for (const r of rows || []) {
    const tokens = Number(r && r.tokens);
    if (!Number.isFinite(tokens) || tokens <= 0) continue;
    // A count with no model is unreadable, so it is bucketed as such rather
    // than added to somebody else's model or silently dropped.
    const model = String((r && r.model) || "(model not recorded)");
    byModel.set(model, (byModel.get(model) || 0) + tokens);
  }
  if (!byModel.size) return null;
  return [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([model, tokens]) => ({ model, tokens }));
}

/**
 * Every session the activity log knows about.
 *
 * The clusters — and therefore the minutes — come from `clusterHeartbeats`,
 * which already groups by session. Two parallel sessions on ONE task are two
 * keys there, so they can never blend into one row here; that property belongs
 * to the clustering and is inherited rather than re-implemented.
 */
export function collectSessions(rowsByTask, history, opts = {}) {
  const sessions = new Map();

  for (const [taskId, rows] of Object.entries(rowsByTask || {})) {
    for (const cluster of clusterHeartbeats(rows, opts)) {
      const key = cluster.session || UNSESSIONED;
      if (!sessions.has(key)) {
        sessions.set(key, {
          session: key, actors: new Set(), tasks: new Map(),
          from: cluster.from, to: cluster.to, minutes: 0, singles: 0, clusters: 0, spans: [],
        });
      }
      const s = sessions.get(key);
      if (!s.tasks.has(taskId)) s.tasks.set(taskId, { task: taskId, minutes: 0, clusters: [] });
      const t = s.tasks.get(taskId);
      t.minutes = round(t.minutes + cluster.minutes);
      t.clusters.push(cluster);
      s.minutes = round(s.minutes + cluster.minutes);
      s.clusters++;
      if (cluster.single) s.singles++;
      s.spans.push([Date.parse(cluster.from), Date.parse(cluster.to)]);
      if (cluster.from < s.from) s.from = cluster.from;
      if (cluster.to > s.to) s.to = cluster.to;
    }
    for (const r of rows || []) {
      const key = String(r.session || "") || UNSESSIONED;
      if (sessions.has(key) && r.actor) sessions.get(key).actors.add(r.actor);
    }
  }

  const out = [];
  for (const s of sessions.values()) {
    const tasks = [...s.tasks.values()].sort((a, b) => a.task.localeCompare(b.task));
    const rows = [];
    for (const t of tasks) for (const r of rowsByTask[t.task] || []) {
      if ((String(r.session || "") || UNSESSIONED) === s.session) rows.push(r);
    }
    out.push({
      session: s.session,
      actors: [...s.actors].sort(),
      from: s.from,
      to: s.to,
      // Effort sums the clusters; calendar unions them, so a session that ran
      // two tasks at once does not look twice as long as it was.
      minutes: s.minutes,
      calendarMinutes: round(unionMinutes(s.spans)),
      clusters: s.clusters,
      // Reported rather than hidden: a cluster of one heartbeat spans no time,
      // so a session made of them measures zero and is not idle.
      singles: s.singles,
      tasks,
      changes: correlateChanges(s, tasks, history),
      tokens: tokensByModel(rows),
    });
  }
  return out.sort((a, b) => String(b.from).localeCompare(String(a.from)));
}

const round = (n) => Math.round(n * 10) / 10;

/**
 * The field changes recorded against this session's tasks while it was running.
 *
 * BY WINDOW, NOT BY SESSION ID, because the history log has no session field
 * (TL-164). The consequence is stated on every answer rather than assumed away:
 * a change another actor made to the same task inside the same window appears
 * here, with its actor, and `correlation: "window"` says why.
 */
export function correlateChanges(session, tasks, history) {
  const from = Date.parse(session.from);
  const to = Date.parse(session.to);
  const out = [];
  for (const t of tasks) {
    for (const e of (history && history[t.task]) || []) {
      const at = Date.parse(e.ts);
      if (!Number.isFinite(at) || at < from || at > to) continue;
      out.push({
        task: t.task, field: e.field, from: e.from || "", to: e.to || "",
        actor: e.actor || "", ts: e.ts, reason: e.reason || "",
      });
    }
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

/** A session that moved no STATUS is the one the morning report exists to
 *  surface: it worked and closed nothing. */
export function movedNothing(session) {
  return !session.changes.some((c) => c.field === "status");
}

export function filterSessions(sessions, { since, actor, task }) {
  return sessions.filter((s) => {
    // `--since` compares against the END of the session: one that started the
    // night before and ran past midnight belongs to the morning it finished in.
    if (since && String(s.to).slice(0, 10) < since) return false;
    if (actor && !s.actors.includes(actor)) return false;
    if (task && !s.tasks.some((t) => t.task === task)) return false;
    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────

const stamp = (iso) => String(iso || "").replace("T", " ").slice(0, 16);

export function renderList(sessions, opts = {}) {
  const out = [heading(N + " sessions — " + sessions.length + " session(s)")];
  if (!sessions.length) {
    out.push("");
    out.push("  " + color.dim("no heartbeats recorded" + (opts.filtered ? " for that filter" : " — nothing has measured a session yet")));
    return out.join("\n");
  }
  out.push("");
  out.push(table(sessions.map((s) => [
    "  ", s.session, s.actors.join(", ") || "(no actor)",
    stamp(s.from) + " → " + stamp(s.to).slice(-5),
    s.minutes + " min",
    s.tasks.map((t) => t.task).join(", "),
    movedNothing(s) ? color.warn("nothing moved") : s.changes.length + " change(s)",
  ])));
  out.push("");
  out.push("  " + color.dim("`nothing moved` means heartbeats but no status transition — it worked and closed nothing."));
  out.push("  " + color.dim("Changes are correlated by task and time window; the history log carries no session id."));
  return out.join("\n");
}

export function renderOne(s) {
  const out = [heading(N + " session " + s.session)];
  out.push("");
  out.push(table([
    ["  ", "actor", s.actors.join(", ") || "(no actor)"],
    ["  ", "ran", stamp(s.from) + " → " + stamp(s.to)],
    ["  ", "effort", s.minutes + " min across " + s.clusters + " cluster(s)"],
    ["  ", "calendar", s.calendarMinutes + " min"],
  ]));
  if (s.singles) {
    out.push("  " + color.dim(s.singles + " cluster(s) of a single heartbeat — they span no time, so they measure zero"));
  }

  out.push("");
  out.push(heading("  tasks"));
  out.push(table(s.tasks.map((t) => ["   ", t.task, t.minutes + " min", t.clusters.length + " cluster(s)"])));

  out.push("");
  out.push(heading("  what moved  (" + s.changes.length + ")"));
  if (!s.changes.length) {
    out.push("  " + color.warn(MARK.warn) + " nothing — this session recorded work and changed no field");
  } else {
    out.push(table(s.changes.map((c) => [
      "   ", stamp(c.ts).slice(-5), c.task, c.field,
      (c.from || "—") + " → " + (c.to || "—"), c.actor,
    ])));
  }
  out.push("  " + color.dim("correlated by task and time window — the history log carries no session id,"));
  out.push("  " + color.dim("so a change another actor made to the same task in the same window appears here."));

  if (s.tokens) {
    out.push("");
    out.push(heading("  tokens, per model"));
    out.push(table(s.tokens.map((t) => ["   ", t.model, String(t.tokens)])));
    out.push("  " + color.dim("never a single total: the same number means different things per model."));
  }
  // No token section at all when nothing recorded any. An absent column and a
  // column of zeros are different claims, and only the first is true here.
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// The run
// ──────────────────────────────────────────────────────────────────────────

function load(dir) {
  const root = resolveBacklogDir({ dir, moduleDir: HERE }).root;
  const config = loadConfigOrExit(root);
  const rowsByTask = readAllActivity(root);
  const history = readAllHistory(root);
  return { root, config, sessions: collectSessions(rowsByTask, history, { idleGapMinutes: config.idleGapMinutes }) };
}

export function mainList(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseSessionsArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " sessions", head, rest, [`${N} sessions --help`]));
    return 2;
  }
  const { sessions } = load(cli.dir);
  const shown = filterSessions(sessions, opts);

  if (opts.json) {
    printJson("sessions", {
      correlation: "window",
      total: sessions.length,
      sessions: shown.map((s) => ({ ...s, movedNothing: movedNothing(s) })),
    });
    return 0;
  }
  console.log(renderList(shown, { filtered: !!(opts.since || opts.actor || opts.task) }));
  return 0;
}

export function mainOne(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseSessionArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " session", head, rest, [`${N} sessions`]));
    return 2;
  }
  const { sessions } = load(cli.dir);
  const found = sessions.find((s) => s.session === opts.id);
  if (!found) {
    // WITH `--json`, "not found" is still an ANSWER and still an envelope: a
    // consumer must not have to parse stderr to learn that a session it asked
    // about does not exist. The exit code carries the verdict, as everywhere
    // else — the document describes the result, it does not replace it.
    if (opts.json) {
      printJson("session", { correlation: "window", session: null });
      return 1;
    }
    console.error(failure(N + " session", "no session `" + opts.id + "` in this backlog's activity log",
      [sessions.length ? sessions.length + " session(s) are recorded" : "no sessions are recorded at all"],
      [`${N} sessions`]));
    return 1;
  }
  if (opts.json) {
    printJson("session", { correlation: "window", session: { ...found, movedNothing: movedNothing(found) } });
    return 0;
  }
  console.log(renderOne(found));
  return 0;
}

// No `main` here on purpose: two commands share this module, and each has its
// own thin entry point (`sessions-command.mjs`, `session-command.mjs`) so the
// dispatcher can name a script per command without a mode flag nobody types.
