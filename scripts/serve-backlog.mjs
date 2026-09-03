#!/usr/bin/env node
/**
 * Backlog viewer server.
 *
 * Serves the same viewer as `build-viewer.mjs` (one renderer, imported — no
 * second copy of the template) but over http://127.0.0.1, which removes the
 * folder picker entirely: the backlog path is known here, server-side.
 *
 * Why this exists: `showDirectoryPicker()` requires a user gesture and a user
 * pick by design, and a file:// page cannot hold a persistent permission grant
 * — so opening viewer.html off the disk always costs at least one click. Over
 * HTTP there is nothing to grant.
 *
 * What it adds over the file:// flow:
 *   - zero clicks to reach live mode, in any browser (not just Chrome/Edge)
 *   - status writes regenerate INDEX/FOCUS/archive automatically, so the
 *     generated YAML views can no longer go stale behind your back
 *   - SSE push on tasks/ changes — edits made by an agent or an editor appear
 *     without a reload
 *
 * Usage:
 *   node backlog/scripts/serve-backlog.mjs          # opens the browser
 *   node backlog/scripts/serve-backlog.mjs --port 4321 --no-open
 *
 * Zero npm dependencies. Binds to loopback only.
 */

import { createServer, get } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readTasks, computeStats, buildHtml } from "./build-viewer.mjs";
import {
  buildFieldSpecs,
  extractMeta,
  normalizeValue,
  setFrontmatterField,
  splitFrontmatter,
} from "./task-fields.mjs";
import { loadConfig, loadConfigOrExit } from "./config.mjs";
import { PLAN_FILENAME, resolveBacklogDir, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { loadPlan } from "./plan.mjs";
import { listWorktrees, resolveWorktree } from "./viewer-worktrees.mjs";
import { decideTask } from "./decide-task.mjs";
// The live signal (TL-189). `activity.mjs` is what reaches the raw log, which
// lives OUTSIDE every repository; `in-flight.mjs` holds the rules and is also
// pasted into the page, so the server and the browser cannot word one signal two
// ways.
import { activityDir, readAllActivity } from "./activity.mjs";
import { inFlightSignal, takeTimestamp } from "./in-flight.mjs";
import { ANY_TASK_ID } from "./task-id.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  ACTOR_UNKNOWN,
  isValidActor,
  isValidReason,
  normalizeActor,
  listTaskFiles,
  readAllHistory,
  readHistory,
  reconcile,
  recordEdit,
  requiresReason,
} from "./history.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_BACKLOG = join(__dirname, "build-backlog.mjs");

// The DATA directory no longer follows from where this file sits (BL-1399):
// --dir, BACKLOG_DIR, discovery from cwd, and only then co-location.
const cliArgs = takeDirFlag(process.argv.slice(2));

// `--help` MUST NOT start the server (TL-51). This is the one command where a
// mistake does not end in a message but in a process waiting for connections —
// and the one that cannot be safely exercised by a test looping over the commands
// unless this is handled.
if (cliArgs.argv.some((a) => a === "--help" || a === "-h")) {
  console.log("serve — run the viewer on 127.0.0.1 (the default command)\n");
  console.log("usage:");
  console.log("  serve [--port <n>] [--no-open] [--dir <path>]");
  process.exit(0);
}
const BACKLOG_DIR = resolveBacklogDirOrExit({ dir: cliArgs.dir, moduleDir: __dirname }, N + " serve").root;
const TASKS_DIR = join(BACKLOG_DIR, "tasks");
const CONFIG = loadConfigOrExit(BACKLOG_DIR);
const FIELDS = buildFieldSpecs(CONFIG);

/**
 * The canonical spelling of a backlog directory, for comparison only.
 *
 * WHY realpath. A worktree reached through a symlink and the same worktree
 * reached directly are ONE backlog. Compared as raw strings they are two, and
 * the second server would start over files the first one is already writing.
 * A path that cannot be resolved (deleted underneath us) falls back to itself:
 * a failed comparison must not take the process down.
 */
function canonicalDir(dir) {
  try { return realpathSync(dir); } catch { return dir; }
}

/**
 * Handshake token for `/api/ping`. Derived from the product name rather than
 * spelled out: it is computed at runtime and persisted nowhere, so a rename
 * costs nothing here. (Contrast BLOCK_MARKER_NAME, which keys blocks already
 * written into other people's repositories and is frozen for exactly that
 * reason.)
 */
const PING_ID = `${N}-backlog-viewer`;

/** This process's identity as a probe from another process sees it. */
const BACKLOG_DIR_ID = canonicalDir(BACKLOG_DIR);

/**
 * Instead of a second vocabulary of statuses and fields: the options come from
 * the same spec the viewer draws its editors from. One place knows the list of
 * statuses.
 */
function fieldOptions() {
  const tasks = readTasks(BACKLOG_DIR);
  const uniq = (key) => {
    const out = [];
    for (const t of tasks) {
      const v = (t[key] || "").trim();
      if (v && out.indexOf(v) < 0) out.push(v);
    }
    return out.sort();
  };
  const boards = CONFIG.boards.map((b) => b.slug);
  for (const b of uniq("board")) if (boards.indexOf(b) < 0) boards.push(b);
  return { boards, epics: uniq("epic"), owners: uniq("owner") };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────────────────────────────────

const argv = cliArgs.argv;
const argValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// An unknown argument FAILS (BL-1411). Previously it was quietly ignored, so
// `query --status blocked` ended in an open browser tab — a silent no-op
// with a side effect looks like the tool working, which is why it is worse than
// an error. `--dir` has already been taken off by takeDirFlag, so it is not here.
const KNOWN_FLAGS = ["--port", "--no-open"];
const FLAGS_WITH_VALUE = ["--port"];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith("-")) {
    // The preceding flag's value, not a separate argument.
    if (i > 0 && FLAGS_WITH_VALUE.indexOf(argv[i - 1]) >= 0) continue;
    console.error(`${N} serve: unexpected argument: ` + a);
    console.error("  the server accepts: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    console.error(`  looking for a different command? \`${N} --help\``);
    process.exit(2);
  }
  if (KNOWN_FLAGS.indexOf(a) < 0) {
    console.error(`${N} serve: unknown flag: ` + a);
    console.error("  available: " + KNOWN_FLAGS.join(" ") + " --dir <path>");
    console.error(`  looking for a different command? \`${N} --help\``);
    process.exit(2);
  }
}

const DEFAULT_PORT = Number(argValue("--port", process.env.BACKLOG_PORT || 4321));
const AUTO_OPEN = !argv.includes("--no-open");

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("Body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Resolve a task id to its file by listing the directory and matching the id
 * prefix — never by interpolating client input into a path, so a crafted id
 * cannot escape tasks/.
 */
function fileForTaskId(id, dir = TASKS_DIR) {
  // A shape with no prefix: this validator defends the PATH (no `/`, no `..`),
  // not the project's vocabulary — whether a task exists is settled by reading the
  // file.
  if (!ANY_TASK_ID.test(id)) return null;
  // `dir` is either this server's tasks/ or a worktree's backlog directory that
  // `resolveWorktree()` matched against git's own list — never a path a request
  // composed (TL-188).
  const tasksDir = dir === TASKS_DIR ? TASKS_DIR : join(dir, "tasks");
  const match = listTaskFiles(tasksDir).find((f) => f.startsWith(id + "-"));
  return match || null;
}

/** Regenerate FOCUS/INDEX/archive — the .md files are the source of truth. */
function regenerateViews() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUILD_BACKLOG, "--dir", BACKLOG_DIR], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

// ──────────────────────────────────────────────────────────────────────────
// SSE — notify open tabs when tasks/ changes on disk
// ──────────────────────────────────────────────────────────────────────────

const sseClients = new Set();
let notifyTimer = null;
/** `selfWrite` suppresses the echo of a write this server just performed. */
let suppressUntil = 0;

function notifyClients() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    if (Date.now() < suppressUntil) return;
    for (const res of sseClients) {
      try { res.write("event: tasks-changed\ndata: {}\n\n"); } catch { sseClients.delete(res); }
    }
  }, 150);
  scheduleReconcile();
}

// ──────────────────────────────────────────────────────────────────────────
// Reconciliation — changes made OUTSIDE the viewer
// ──────────────────────────────────────────────────────────────────────────
//
// A task file is also changed by the agent, by an editor and by `git checkout`.
// Without this pass the history would say "nobody changed anything" about half of
// the real changes.
//
// The author: `unknown`, and that is deliberate. The server sees a changed byte,
// not the hand that changed it. Who really edited it is known to the agent's hook
// (`history-record.mjs --actor claude`) — which is why we wait RECONCILE_DELAY_MS,
// so that it gets to write its entry first; after that this pass no longer sees a
// difference and stays quiet. Guessing "if not the viewer then the agent" would
// produce entries signed by somebody who did not do it.
const RECONCILE_DELAY_MS = 2500;
let reconcileTimer = null;

function scheduleReconcile() {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    try {
      const { entries, seeded } = reconcile(BACKLOG_DIR, { actor: "unknown", source: "external" });
      if (seeded) {
        console.log(`${N} serve: history: reference point created (no entries)`);
      } else if (entries.length) {
        console.log(`${N} serve: history: ` + entries.length + " change(s) from outside the viewer (author: unknown)");
        for (const res of sseClients) {
          try { res.write("event: history-changed\ndata: {}\n\n"); } catch { sseClients.delete(res); }
        }
      }
    } catch (e) {
      console.warn(`${N} serve: history reconciliation did not pass:`, e.message);
    }
  }, RECONCILE_DELAY_MS);
}

// ──────────────────────────────────────────────────────────────────────────
// The live signal — what happens BETWEEN the two writes (TL-189)
// ──────────────────────────────────────────────────────────────────────────
//
// A heartbeat changes nothing in the repository, so `tasks-changed` never fires
// for one: the whole point of this signal is that it moves while the task file
// stands still. Hence its own event, and its own watch below on a directory that
// is not in any tree.
let activityTimer = null;

function notifyActivity() {
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => {
    for (const res of sseClients) {
      try { res.write("event: activity-changed\ndata: {}\n\n"); } catch { sseClients.delete(res); }
    }
  }, 150);
}

/**
 * The signal for every task the subject tree's log knows about.
 *
 * READ FRESH ON EVERY REQUEST AND NEVER CACHED ON HEAD, unlike the file index:
 * the answer's whole value is its age, and a cached one would report a session
 * as alive for as long as the cache held.
 *
 * `now` TRAVELS WITH THE PAYLOAD because the page computes the age from it. A
 * browser with a clock five minutes off would otherwise call a live session
 * stale, or a stale one live, and would do it silently.
 */
/**
 * Attach the watch on ONE backlog's raw log, if there is one yet. Idempotent.
 *
 * KEYED BY DIRECTORY, because the log follows the backlog: every worktree has
 * its own, and the switcher (TL-188) lets a reader look at a tree that is not
 * this process's own. A watch on this server's log alone would push for the tree
 * nobody is looking at and stay silent for the one they are.
 *
 * TRIED AGAIN ON EVERY REQUEST FOR THE SIGNAL, not only at boot, because the
 * directory is created by the FIRST heartbeat a backlog ever records — which for
 * a fresh clone is after the server started. A watch attached once at boot would
 * then never exist, and the feature would fail in the way this codebase likes
 * least: silently, looking exactly like a backlog nobody is working in.
 *
 * A SEPARATE `try` FROM THE TASK AND PLAN WATCHES, and not out of tidiness: a
 * failure here must not take down the two watches that already work.
 *
 * The event it raises carries no subject, so a tab reading tree A refetches when
 * tree B's log moves. That is one extra request against a route scoped by the
 * tab's own subject — cheaper than a fan-out that would have to track which
 * client is looking at what, and wrong in no direction.
 */
const activityWatched = new Set();
function ensureActivityWatch(root = BACKLOG_DIR) {
  if (activityWatched.has(root)) return;
  try {
    const dir = activityDir(root);
    if (!existsSync(dir)) return;
    watch(dir, { persistent: false }, (_event, filename) => {
      if (filename && !/\.jsonl$/.test(filename)) return;
      notifyActivity();
    });
    activityWatched.add(root);
  } catch (e) {
    // Recorded as attached so the warning is printed once rather than per request.
    activityWatched.add(root);
    console.warn(`${N} serve: the heartbeat log in ` + root + ` cannot be watched — the live signal will not push:`, e.message);
  }
}

function inFlightPayload(subject) {
  ensureActivityWatch(subject.dir);
  const rowsByTask = readAllActivity(subject.dir);
  const history = readAllHistory(subject.dir);
  const status = subject.config.inProgressStatus;
  const tasks = {};
  for (const [id, rows] of Object.entries(rowsByTask)) {
    const signal = inFlightSignal(rows, { since: takeTimestamp(history[id], status) });
    if (signal) tasks[id] = signal;
  }
  return { now: new Date().toISOString(), idleGapMinutes: subject.config.idleGapMinutes, tasks };
}

try {
  watch(TASKS_DIR, { persistent: false }, (_event, filename) => {
    if (filename && !/\.md$/.test(filename)) return;
    notifyClients();
  });
  // plan.yaml sits BESIDE tasks/, not inside it, so the watch above never sees
  // it — and the Execution view (TL-109) is drawn from it. The same
  // `tasks-changed` signal on purpose: the page answers it by re-reading
  // /api/tasks, which carries the plan, so a second event would be a second name
  // for one refresh.
  watch(BACKLOG_DIR, { persistent: false }, (_event, filename) => {
    if (filename && filename !== PLAN_FILENAME) return;
    notifyClients();
  });
} catch (e) {
  console.warn(`${N} serve: fs.watch unavailable — live push disabled:`, e.message);
}

ensureActivityWatch();

// ──────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────

/**
 * Writing ONE field of a task: validation → write the file → `updated:` →
 * history →
 * then the views are rebuilt. The order is not accidental: the history entry
 * comes from comparing the state BEFORE the write with the state AFTER the write
 * as read back from the file, not with what arrived from the browser — which is
 * how the entry ends up describing what really landed on disk.
 */
async function handleFieldEdit(res, payload) {
  const { id, field, value } = payload;
  const actor = isValidActor(payload.actor) ? payload.actor : "unknown";

  const spec = FIELDS.find((f) => f.key === field);
  if (!spec) {
    sendJson(res, 400, { error: "This field is not editable: " + field });
    return;
  }
  const norm = normalizeValue(field, value, { fields: FIELDS, options: fieldOptions() });
  if (!norm.ok) {
    sendJson(res, 400, { error: norm.error });
    return;
  }

  // The reason is judged BEFORE the file is touched (TL-105): a write followed
  // by a refusal would leave the task changed and the history saying why not.
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  if (requiresReason(CONFIG, { field, to: norm.value })) {
    if (!isValidReason(reason)) {
      sendJson(res, 422, {
        error:
          "`" + field + " → " + norm.value + "` needs a reason. `reason_required_statuses` in " +
          "config.yaml names it: " + (CONFIG.reasonRequiredStatuses || []).join(", ") + ". " +
          "Nothing else about this task is refused — only this transition, and only because " +
          "its why is the part nobody can reconstruct afterwards.",
        needsReason: true,
        field,
        to: norm.value,
      });
      return;
    }
  }

  const file = fileForTaskId(String(id || ""));
  if (!file) {
    sendJson(res, 404, { error: "Task not found: " + id });
    return;
  }

  const full = join(TASKS_DIR, file);
  const original = readFileSync(full, "utf8");
  const before = extractMeta(splitFrontmatter(original).frontmatter);

  let text;
  try {
    text = setFrontmatterField(original, field, norm.value, spec);
  } catch (e) {
    sendJson(res, 422, { error: file + ": " + e.message });
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (/^updated:\s*.+$/m.test(text)) {
    text = text.replace(/^updated:\s*.+$/m, "updated: " + today);
  }

  suppressUntil = Date.now() + 1500;   // do not echo our own write back over SSE
  writeFileSync(full, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  let entries = [];
  try {
    entries = recordEdit(BACKLOG_DIR, { taskId: after.id || id, before, after, actor, source: "viewer", reason });
  } catch (e) {
    console.warn(`${N} serve: history not recorded:`, e.message);
  }

  const regenerated = await regenerateViews();
  console.log(
    `${N} serve: ${id} · ${field} → ${Array.isArray(norm.value) ? norm.value.join(", ") : norm.value}` +
      ` (${actor})` +
      (regenerated ? " [views rebuilt]" : " [WARNING: build-backlog.mjs did not pass]")
  );
  sendJson(res, 200, {
    ok: true,
    id,
    field,
    value: norm.value,
    updated: today,
    regenerated,
    entries,
    status: after.status,
  });
}

/** The plan file in the shape the page embeds it in — one definition, so a
 *  refresh cannot deliver a different structure than the first paint did. */
function planPayload(dir = BACKLOG_DIR) {
  const loaded = loadPlan(join(dir, PLAN_FILENAME));
  return {
    exists: loaded.exists,
    path: `${basename(dir)}/${PLAN_FILENAME}`,
    plan: loaded.plan,
    problems: loaded.problems,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// The subject: WHICH worktree this request is about (TL-188)
// ──────────────────────────────────────────────────────────────────────────
//
// Every worktree of one clone has its own backlog/ — law 1, data travelling with
// the branch — so a server standing in the main checkout shows a board that does
// not move while a run drives a task somewhere else. `?worktree=<key>` points a
// READ at one of the others.
//
// THE ENUMERATION IS THE ALLOWLIST, and it is redone per request rather than
// cached at boot: `git worktree add` during a session is the normal case here,
// and a switcher that needed a restart to see the tree a run just made would
// miss exactly the moment it exists for. The cost is one `git worktree list`.
//
// NOTHING WRITES THROUGH THIS. The write routes below take no directory at all —
// they address BACKLOG_DIR and only BACKLOG_DIR — so a foreign tree cannot be
// written to even by mistake. What they add is a REFUSAL when a request names
// one, because the failure to prevent is not "the wrong file changed" but "the
// caller believed it was editing another tree and this one changed instead".

/** The worktree a request names, or null when it names one that does not exist.
 *  An unknown key is never quietly the server's own tree: that would answer
 *  about the wrong backlog and look like it worked. */
function subjectFor(url) {
  const requested = url.searchParams.get("worktree");
  const state = listWorktrees(BACKLOG_DIR);
  const entry = resolveWorktree(state.entries, requested);
  return { requested, state, entry };
}

/**
 * The configuration of a tree that is NOT this process's own.
 *
 * `loadConfigOrExit` ends the program, which is right for a command and fatal
 * here: an unreadable config.yaml in a worktree the server merely OFFERED to
 * show would take the viewer down for everybody. So it is loaded by hand, and a
 * failure becomes an answer rather than an exit.
 */
function configFor(entry) {
  if (!entry || entry.isSelf) return { config: CONFIG, error: null };
  try {
    return { config: loadConfig(entry.backlogDir), error: null };
  } catch (e) {
    return { config: null, error: e.message };
  }
}

/** 404 for a key nothing answers to, 502 for a tree whose configuration cannot
 *  be read — a distinction worth keeping: the first is a stale link, the second
 *  is a real problem in a real tree. */
function subjectOrFail(res, url) {
  const { requested, state, entry } = subjectFor(url);
  if (!entry) {
    sendJson(res, 404, {
      error: "No worktree of this repository is called `" + String(requested || "") + "`",
      worktrees: state.entries.map((w) => w.key),
    });
    return null;
  }
  const { config, error } = configFor(entry);
  if (!config) {
    sendJson(res, 502, { error: "The backlog in " + entry.path + " cannot be read: " + error });
    return null;
  }
  return { entry, config, dir: entry.backlogDir, state };
}

/**
 * A write that names a worktree other than this server's is REFUSED.
 *
 * The routes cannot reach another tree — they have no directory to reach it
 * with. This is about the caller's belief: a request that says `worktree=other`
 * and gets a 200 has been told its edit landed there, and it landed here.
 */
function refusesForeignWrite(res, url, payload) {
  const named = url.searchParams.get("worktree") || (payload && payload.worktree) || "";
  if (!named) return false;
  const state = listWorktrees(BACKLOG_DIR);
  const entry = resolveWorktree(state.entries, named);
  if (entry && entry.isSelf) return false;
  const home = (state.entries.find((w) => w.isSelf) || {}).key || BACKLOG_DIR;
  sendJson(res, 403, {
    error: "This server writes only to the worktree it was started in (`" + home +
      "`). Another tree is read-only here — start a server in it to edit it.",
    kind: "foreign-worktree",
  });
  return true;
}

async function handle(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/" || path === "/index.html") {
    // Rendered fresh per request, so the first paint is already live data.
    // AND rendered from the SUBJECT's own configuration (TL-188): a worktree
    // brings its own statuses, priorities, boards and the palette generated from
    // them, so painting its tasks with this tree's vocabulary would leave values
    // with no colour and no badge — rendered, and wrong.
    const subject = subjectOrFail(res, url);
    if (!subject) return;
    const tasks = readTasks(subject.dir, subject.config);
    const html = buildHtml(
      tasks,
      computeStats(tasks),
      subject.config,
      readAllHistory(subject.dir),
      loadPlan(join(subject.dir, PLAN_FILENAME)),
      {
        worktrees: subject.state.entries,
        worktree: subject.entry.key,
        canEdit: subject.entry.isSelf,
      }
    );
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
    return;
  }

  // What the switcher offers. Its own route so a caller can ask the question
  // without downloading a page — and so `--json` composition (law 4) reaches it.
  if (path === "/api/worktrees") {
    const state = listWorktrees(BACKLOG_DIR);
    sendJson(res, 200, {
      listed: state.listed,
      reason: state.reason,
      worktrees: state.entries.map((w) => ({
        key: w.key, label: w.label, branch: w.branch, path: w.path, isSelf: w.isSelf,
      })),
    });
    return;
  }

  // Identity probe. `app` says "an instance of this server"; `backlogDir`
  // says WHICH backlog it serves — and only the second question decides whether
  // a new invocation may bow out to this one (TL-71).
  if (path === "/api/ping") {
    sendJson(res, 200, {
      app: PING_ID,
      pid: process.pid,
      backlogDir: BACKLOG_DIR_ID,
      projectName: CONFIG.projectName,
    });
    return;
  }

  if (path === "/api/tasks") {
    const subject = subjectOrFail(res, url);
    if (!subject) return;
    const tasks = readTasks(subject.dir, subject.config);
    sendJson(res, 200, {
      tasks,
      stats: computeStats(tasks),
      plan: planPayload(subject.dir),
      worktree: { key: subject.entry.key, label: subject.entry.label, writable: subject.entry.isSelf },
    });
    return;
  }

  // WHY THIS IS A ROUTE AND NOT PART OF THE PAGE (TL-189). `buildHtml` also
  // writes `backlog/viewer.html`, a file that gets mailed around and opened over
  // file://. Baking the log's answer into it would put a record of what hour
  // somebody worked into a document that leaves the machine — the exact thing
  // keeping the raw log outside every repository exists to prevent. Over HTTP the
  // data never leaves the machine that holds it, and a page with no server simply
  // renders no signal.
  if (path === "/api/in-flight") {
    const subject = subjectOrFail(res, url);
    if (!subject) return;
    sendJson(res, 200, inFlightPayload(subject));
    return;
  }

  if (path === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    sseClients.add(res);
    const keepAlive = setInterval(() => {
      try { res.write(": ping\n\n"); } catch { /* closed */ }
    }, 25000);
    req.on("close", () => { clearInterval(keepAlive); sseClients.delete(res); });
    return;
  }

  if (path === "/api/history") {
    const subject = subjectOrFail(res, url);
    if (!subject) return;
    const id = url.searchParams.get("id");
    if (id) {
      if (!fileForTaskId(id, subject.dir)) { sendJson(res, 404, { error: "Task not found: " + id }); return; }
      sendJson(res, 200, { id, entries: readHistory(subject.dir, id) });
      return;
    }
    sendJson(res, 200, { history: readAllHistory(subject.dir) });
    return;
  }

  if (path === "/api/fields") {
    sendJson(res, 200, { fields: FIELDS, options: fieldOptions(), config: CONFIG });
    return;
  }

  // One write route for ALL fields. `/api/status` below is an alias of it — two
  // endpoints writing frontmatter would mean two places deciding about
  // validation, about `updated:` and about the history.
  if (path === "/api/field" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      sendJson(res, 400, { error: "Malformed JSON: " + e.message });
      return;
    }
    if (refusesForeignWrite(res, url, payload)) return;
    await handleFieldEdit(res, payload || {});
    return;
  }

  if (path === "/api/status" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      sendJson(res, 400, { error: "Malformed JSON: " + e.message });
      return;
    }
    if (refusesForeignWrite(res, url, payload)) return;
    const { id, status, actor } = payload || {};
    await handleFieldEdit(res, { id, field: "status", value: status, actor });
    return;
  }

  // A decision from the panel (TL-115). It calls the SAME function the `decide`
  // command calls, so the validation of `--resolves`, the event's shape and the
  // reserved reasons cannot differ between the terminal and the page — the
  // lesson §5 of docs/backlog-field-editing-history.md draws from the field
  // edits (a real path — product-name: allow).
  if (path === "/api/decision" && req.method === "POST") {
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch (e) {
      sendJson(res, 400, { error: "Malformed JSON: " + e.message });
      return;
    }
    if (refusesForeignWrite(res, url, payload)) return;
    const { id, reason, resolves, actor } = payload || {};
    const who = normalizeActor(actor || ACTOR_UNKNOWN);
    if (!isValidActor(who)) {
      sendJson(res, 400, { error: "The actor `" + who + "` has no valid namespace" });
      return;
    }
    if (!isValidReason(reason || "")) {
      sendJson(res, 400, {
        error: "A decision needs its content — and `unknown` and `proven` are the tool's own words",
      });
      return;
    }
    const result = decideTask({
      root: BACKLOG_DIR, config: CONFIG, id, actor: who,
      reason, resolves: resolves || null,
    });
    if (!result.ok) {
      sendJson(res, result.kind === "not-found" ? 404 : 409, { error: result.message, kind: result.kind });
      return;
    }
    // The history moved and nothing else did — the same signal the reconciler
    // sends, so an open tab refreshes the axis it is showing.
    for (const client of sseClients) {
      try { client.write("event: history-changed\ndata: {}\n\n"); } catch { sseClients.delete(client); }
    }
    sendJson(res, 200, {
      ok: true,
      decision: { id: result.decision.id, ts: result.decision.ts, text: result.decision.to, actor: who },
      openQuestions: result.open.map((e) => ({ id: e.id, ts: e.ts, text: e.to, actor: e.actor })),
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

// ──────────────────────────────────────────────────────────────────────────
// Boot — retry a few ports so a stale instance doesn't block startup
// ──────────────────────────────────────────────────────────────────────────

function openBrowser(target) {
  if (!AUTO_OPEN) return;
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [target], { stdio: "ignore", detached: true, shell: process.platform === "win32" })
    .on("error", () => console.log("  (open it yourself: " + target + ")"))
    .unref();
}

/**
 * WHO holds `port` — three answers, not two (TL-71).
 *
 *   same  — this server, over the backlog we were asked to serve
 *   other — this server, over SOMEBODY ELSE'S backlog
 *   none  — nothing we recognise (free, or a stranger's process)
 *
 * `same` is what keeps the shell alias idempotent: running it twice focuses the
 * existing viewer instead of starting a rival server on the next free port (two
 * servers, two SSE feeds, one of them silently stale).
 *
 * `other` is the answer a boolean used to swallow. An instance serving a
 * different backlog answered the probe just as affirmatively, so the second
 * invocation printed "already running", opened a tab and exited 0 — handing the
 * user a success signal over another project's tasks. Diagnosing that took
 * `ps aux`, because the port could not be asked whose data it held.
 */
function probeExisting(port, expectedDir) {
  return new Promise((resolve) => {
    const NONE = { state: "none", backlogDir: null, projectName: null };
    const req = get(
      { host: "127.0.0.1", port, path: "/api/ping", timeout: 500 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
        res.on("end", () => {
          let ping = null;
          try { ping = JSON.parse(body); } catch { /* not our JSON */ }
          if (!ping || ping.app !== PING_ID) { resolve(NONE); return; }
          resolve({
            // A server too old to name its directory cannot PROVE it is ours,
            // and an unproven claim counts as a stranger's: the cost of being
            // wrong is a superfluous second server, against showing the wrong
            // backlog and calling it success.
            state: ping.backlogDir && ping.backlogDir === expectedDir ? "same" : "other",
            backlogDir: ping.backlogDir || null,
            projectName: ping.projectName || null,
          });
        });
      }
    );
    req.on("timeout", () => { req.destroy(); resolve(NONE); });
    req.on("error", () => resolve(NONE));
  });
}

function listen(port, attemptsLeft) {
  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error(`${N} serve:`, e);
      if (!res.headersSent) sendJson(res, 500, { error: e.message });
      else res.end();
    });
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.warn(`${N} serve: port ${port} is taken — trying ${port + 1}`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(`${N} serve:`, e.message);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    const target = `http://127.0.0.1:${port}/`;
    const count = listTaskFiles(TASKS_DIR).length;
    // Closing the "the server was down" gap: whatever changed in the meantime
    // reaches the history now — as `unknown`, because nobody saw the author.
    let boot = "";
    try {
      const { entries, seeded } = reconcile(BACKLOG_DIR, { actor: "unknown", source: "boot" });
      boot = seeded
        ? "  History: reference point (snapshot) created — entries start with the next change\n"
        : entries.length
          ? `  History: ${entries.length} change(s) from before the server started (author: unknown)\n`
          : "";
    } catch (e) {
      boot = `  History: reconciliation did not pass (${e.message})\n`;
    }
    // Named here and not at probe time: the sentence needs BOTH ports, and our
    // own is only known once the socket is bound. Without the names the user is
    // back to `ps aux` to find out what the other port is serving.
    const beside = COEXISTS_WITH
      ? `  Port ${COEXISTS_WITH.port} already serves ${COEXISTS_WITH.projectName} ` +
        `(${COEXISTS_WITH.backlogDir}) — ${CONFIG.projectName} is here on ${port}\n`
      : "";
    console.log(
      `${N} serve: ${target}\n` +
        `  ${count} tasks, live mode with no clicking (the folder is known server-side)\n` +
        beside +
        `  Editing a field writes the .md, appends to the history and rebuilds NOW/INDEX/archive\n` +
        (VIEWS_BUILT ? "" : "  WARNING: build-backlog.mjs did not pass — the views may be stale\n") +
        boot +
        `  Ctrl-C stops it`
    );
    openBrowser(target);
  });
}

const probe = await probeExisting(DEFAULT_PORT, BACKLOG_DIR_ID);

// THIS backlog is already up? Focus it and exit 0 — a repeated invocation is
// then a no-op that just brings the tab up.
if (probe.state === "same") {
  const target = `http://127.0.0.1:${DEFAULT_PORT}/`;
  console.log(`${N} serve: already running on ${target} — opening a tab`);
  openBrowser(target);
  process.exit(0);
}

/**
 * Somebody else's backlog on our port: start BESIDE it, never instead of it.
 *
 * One server serves one backlog, and that is not a simplification to undo
 * later: the server WRITES — the .md file, the history entry, the regenerated
 * views — and one writing process spanning N repositories divorces state from
 * the branch it belongs to (Law 1).
 */
const COEXISTS_WITH = probe.state === "other"
  ? {
      port: DEFAULT_PORT,
      projectName: probe.projectName || "another backlog",
      backlogDir: probe.backlogDir || "an unknown directory",
    }
  : null;

// The views are GENERATED and not versioned (BL-1404), so a fresh clone or a new
// worktree does not have them. Starting the server is one of the two places that
// recreate them by themselves (the other is the hook after a task edit) — without
// it the gitignore from BL-1404 would trade the absence of conflicts for the
// absence of files. Outside listen(), because that recurses through further
// ports: we build ONCE.
const VIEWS_BUILT = await regenerateViews();

// RETENTION RUNS HERE FOR THE REASON THE BUILD DOES (TL-31). Raw heartbeats are
// a record of what hour a particular person worked, and a retention window
// somebody has to remember to apply is not a retention window — it is a
// paragraph in a document. So it runs where the tool is already doing periodic
// housekeeping, on the same two triggers as the views.
//
// SILENT AND BEST EFFORT. The aggregates are recomputed from the full log before
// anything is deleted, so a failure here loses nothing; and a viewer that
// refused to start because a directory was read-only would be trading the
// user's whole session for a tidy-up.
try {
  const { prune } = await import("./activity-retention.mjs");
  const { loadConfig } = await import("./config.mjs");
  prune(BACKLOG_DIR, loadConfig(BACKLOG_DIR));
} catch {
  // Nothing measured yet, an unreadable state directory, a configuration the
  // server has already complained about elsewhere — none of them is this
  // process's problem to report twice.
}

listen(COEXISTS_WITH ? DEFAULT_PORT + 1 : DEFAULT_PORT, 10);
