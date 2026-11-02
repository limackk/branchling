#!/usr/bin/env node
/**
 * follow-changes.mjs — follow one backlog's task changes as a stream (TL-524).
 *
 * WHAT WAS MISSING. `serve` already watched the task files and pushed to the
 * page over SSE at `/api/events`, but that endpoint is a private contract of the
 * served page. An interface built by composing `--json` commands had two bad
 * options: poll `query --json`, paying a Node start per poll and still learning
 * only THAT something changed, or reimplement the watcher with its own debounce
 * and its own rules about which files count.
 *
 * WHAT IT IS. A reading command whose answer does not end: `--json` prints one
 * envelope (`change-stream`) per line — `ready` once the watch is armed, `change`
 * per task whose tracked fields or body moved, `heartbeat` when nothing did. The
 * watcher and its debounce are the ones `serve` uses (`backlog-watch.mjs`), so
 * the page and the stream cannot disagree about what counts as a change.
 *
 * HOW IT ENDS. SIGINT, SIGTERM or SIGHUP close the watchers and exit 0. A reader
 * that goes away is noticed at the next write — a pipe says nothing until it is
 * written to — which is the second job of the heartbeat: it bounds how long a
 * process outlives its consumer. `--max-events <n>` exits after n changes, which
 * makes "wait for the next change" one invocation.
 *
 * Exit: 0 = stopped (signal, reader gone, `--max-events` reached),
 *       1 = the watch could not be set up, 2 = a usage error.
 *
 * Tests: `node --test scripts/tests/watch-stream.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { advanceSnapshot, diffSnapshots, rereadTasks, snapshotTasks, watchBacklog } from "./backlog-watch.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { printJsonLine } from "./json-envelope.mjs";
import { backlogPaths, resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { printLine } from "./stdout.mjs";
import { color, failure, refusal } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMAND = N + " follow";
const KNOWN = ["--json", "--heartbeat", "--max-events"];
const AVAILABLE = "--json --heartbeat <seconds> --max-events <n> --dir <path>";
const DEFAULT_HEARTBEAT_SECONDS = 30;

/**
 * PURE apart from what it throws: `{ code, problem }` on a refusal.
 */
export function parseWatchArgs(argv) {
  let taken;
  try {
    taken = takeDirFlag(argv, { missing: "--dir needs a value" });
  } catch (e) {
    throw { code: 2, problem: e.message };
  }
  const out = { json: false, heartbeat: DEFAULT_HEARTBEAT_SECONDS, maxEvents: null, dir: taken.dir };
  const a = taken.argv;
  for (let i = 0; i < a.length; i++) {
    const flag = a[i];
    if (flag === "--json") { out.json = true; continue; }
    if (flag === "--heartbeat" || flag === "--max-events") {
      const raw = a[i + 1];
      if (raw === undefined || raw.startsWith("--")) throw { code: 2, problem: flag + " needs a value" };
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw { code: 2, problem: flag + " needs a non-negative number, got " + raw };
      if (flag === "--max-events" && !Number.isInteger(n)) throw { code: 2, problem: "--max-events needs a whole number, got " + raw };
      if (flag === "--heartbeat") out.heartbeat = n;
      else out.maxEvents = n;
      i++;
      continue;
    }
    if (flag.startsWith("-")) throw { code: 2, problem: "unknown flag: " + flag };
    throw { code: 2, problem: "unexpected argument: " + flag };
  }
  return out;
}

export function run(argv) {
  let plan;
  try {
    plan = parseWatchArgs(argv);
  } catch (e) {
    if (!e || e.code === undefined) throw e;
    console.error(refusal(COMMAND, e.problem, AVAILABLE));
    return e.code;
  }
  const root = resolveBacklogDirOrExit({ dir: plan.dir || undefined, moduleDir: __dirname }, COMMAND).root;
  const config = loadConfigOrExit(root);
  const tasksDir = backlogPaths(root).tasksDir;
  const taskFile = config.taskId.file;

  let watcher = null;
  let heartbeat = null;
  let changes = 0;
  let stopped = false;

  const stop = (code) => {
    if (stopped) return;
    stopped = true;
    clearInterval(heartbeat);
    if (watcher) watcher.close();
    process.exitCode = code;
  };

  /** One envelope or one line; the reader having gone away ends the process. */
  const emit = (payload) => {
    const ok = plan.json
      ? printJsonLine("change-stream", { at: new Date().toISOString(), root, ...payload })
      : payload.event === "change"
        ? printLine(color.id(payload.id || payload.file) + "  " + payload.change +
          (payload.fields.length ? "  " + payload.fields.join(", ") : ""))
        : true;
    if (!ok) stop(0);
    return ok;
  };

  let snapshot;
  try {
    // Armed BEFORE the snapshot: a change landing between the two is then
    // either already in the snapshot or still to be reported — never lost.
    watcher = watchBacklog(root, {
      taskFile,
      persistent: true,
      onError: (e) => {
        console.error(failure(COMMAND, "the watch failed: " + e.message));
        stop(1);
      },
      onChange: ({ files }) => {
        if (stopped) return;
        const fresh = rereadTasks(tasksDir, taskFile, files);
        const found = diffSnapshots(snapshot, fresh, files);
        advanceSnapshot(snapshot, fresh, files);
        for (const c of found) {
          if (!emit({ event: "change", ...c })) return;
          changes++;
          if (plan.maxEvents !== null && changes >= plan.maxEvents) { stop(0); return; }
        }
      },
    });
    snapshot = snapshotTasks(tasksDir, taskFile);
  } catch (e) {
    console.error(failure(COMMAND, "cannot watch " + tasksDir + ": " + e.message));
    stop(1);
    return 1;
  }

  // Installed BEFORE `ready` is announced: a reader that signals as soon as it
  // sees `ready` would otherwise race the registration, and a signal landing
  // in that gap takes the default action and kills the process with no code.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));

  if (plan.json) {
    if (!emit({ event: "ready" })) return 0;
  } else {
    console.error(COMMAND + ": watching " + snapshot.size + " task(s) in " + tasksDir + " — Ctrl-C stops");
  }
  if (plan.maxEvents === 0) { stop(0); return 0; }

  if (plan.heartbeat > 0) {
    // The human form prints no heartbeat — it is read by a person, who stops
    // it with Ctrl-C — but the interval still keeps the process alive alike.
    heartbeat = setInterval(() => {
      if (plan.json) emit({ event: "heartbeat" });
    }, plan.heartbeat * 1000);
  }

  return undefined;
}

if (process.argv[1] && process.argv[1].endsWith("follow-changes.mjs")) {
  const code = run(process.argv.slice(2));
  if (code !== undefined) process.exitCode = code;
}
