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
import { readFileSync, realpathSync, writeFileSync, watch } from "node:fs";
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
import { loadConfigOrExit } from "./config.mjs";
import { PLAN_FILENAME, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadPlan } from "./plan.mjs";
import { ANY_TASK_ID } from "./task-id.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import {
  isValidActor,
  isValidReason,
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
const BACKLOG_DIR = resolveBacklogDir({ dir: cliArgs.dir, moduleDir: __dirname }).root;
const TASKS_DIR = join(BACKLOG_DIR, "tasks");
const PLAN_PATH = join(BACKLOG_DIR, PLAN_FILENAME);
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
function fileForTaskId(id) {
  // A shape with no prefix: this validator defends the PATH (no `/`, no `..`),
  // not the project's vocabulary — whether a task exists is settled by reading the
  // file.
  if (!ANY_TASK_ID.test(id)) return null;
  const match = listTaskFiles(TASKS_DIR).find((f) => f.startsWith(id + "-"));
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
// (`history-record.mjs --actor claude`) — dlatego czekamy RECONCILE_DELAY_MS,
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
function planPayload() {
  const loaded = loadPlan(PLAN_PATH);
  return {
    exists: loaded.exists,
    path: `${basename(BACKLOG_DIR)}/${PLAN_FILENAME}`,
    plan: loaded.plan,
    problems: loaded.problems,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/" || path === "/index.html") {
    // Rendered fresh per request, so the first paint is already live data.
    const tasks = readTasks(BACKLOG_DIR);
    const html = buildHtml(tasks, computeStats(tasks), CONFIG);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
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
    const tasks = readTasks(BACKLOG_DIR);
    sendJson(res, 200, { tasks, stats: computeStats(tasks), plan: planPayload() });
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
    const id = url.searchParams.get("id");
    if (id) {
      if (!fileForTaskId(id)) { sendJson(res, 404, { error: "Task not found: " + id }); return; }
      sendJson(res, 200, { id, entries: readHistory(BACKLOG_DIR, id) });
      return;
    }
    sendJson(res, 200, { history: readAllHistory(BACKLOG_DIR) });
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
    const { id, status, actor } = payload || {};
    await handleFieldEdit(res, { id, field: "status", value: status, actor });
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

listen(COEXISTS_WITH ? DEFAULT_PORT + 1 : DEFAULT_PORT, 10);
