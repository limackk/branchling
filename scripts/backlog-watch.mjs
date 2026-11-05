/**
 * backlog-watch.mjs — the one watcher over a backlog directory, shared by
 * `serve` and `follow` (TL-524).
 *
 * WHY ONE MODULE. `serve` already watched `tasks/` and `plan.yaml` with
 * `fs.watch` and folded a burst of events into one push with a short debounce.
 * `follow` needs exactly that, and a second copy would be a second set of rules
 * about which filenames count and how long a burst lasts — the two would part
 * company on the first change, and "the page refreshed but the stream said
 * nothing" is not a defect anybody debugs quickly.
 *
 * WHAT IS SHARED AND WHAT IS NOT. The watcher reports THAT something changed and
 * which filenames it heard of; it does not read a single task. `serve` answers a
 * change by telling the page to re-read `/api/tasks`; `follow` answers it by
 * diffing task files against the last snapshot it took. That diff lives here too,
 * as pure functions, because it is the part that deserves a test of its own.
 *
 * WHY THE DIFF COMPARES CONTENT, NOT EVENTS. One atomic write is a temporary file
 * plus a rename, and on some platforms an editor's save is three events. Counting
 * events would report one edit two or three times; comparing what the file says
 * now with what it said before reports it once, and reports nothing for an event
 * that changed nothing.
 */

import { readFileSync, readdirSync, watch } from "node:fs";
import { join } from "node:path";

import { PLAN_FILENAME, backlogPaths } from "./paths.mjs";
import { FIELD_BODY, diffMeta, extractMeta, splitFrontmatter } from "./task-fields.mjs";

/** How long a burst of filesystem events is folded into one notification. */
export const WATCH_DEBOUNCE_MS = 150;

/**
 * Watch one backlog's `tasks/` directory and its `plan.yaml`.
 *
 * Throws when `fs.watch` cannot be set up at all (a missing directory, a
 * platform without it) — the caller decides whether that is fatal: for `serve`
 * it disables the live push, for `follow` it is the whole command.
 *
 * @param {string} root  the backlog directory
 * @param {object} opts
 * @param {(change: { files: string[] | null, plan: boolean }) => void} opts.onChange
 *        called once per burst. `files` is the task filenames heard of, or
 *        `null` when the platform withheld a filename and everything must be
 *        re-read; `plan` says whether `plan.yaml` was among them.
 * @param {RegExp} [opts.taskFile]  which filenames in `tasks/` count; by default
 *        any `.md`
 * @param {number} [opts.debounceMs]
 * @param {boolean} [opts.persistent]  whether the watchers alone keep the
 *        process alive
 * @param {(e: Error) => void} [opts.onError]  a watcher that failed after setup
 * @returns {{ close(): void }}
 */
export function watchBacklog(root, opts) {
  const { onChange, taskFile = /\.md$/, debounceMs = WATCH_DEBOUNCE_MS, persistent = false, onError } = opts;
  let timer = null;
  let files = new Set();
  let unknown = false;
  let plan = false;
  let closed = false;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const change = { files: unknown ? null : [...files].sort(), plan };
      files = new Set();
      unknown = false;
      plan = false;
      if (!closed) onChange(change);
    }, debounceMs);
  };

  const watchers = [];
  const onWatcherError = (e) => { if (onError) onError(e); };
  try {
    watchers.push(watch(backlogPaths(root).tasksDir, { persistent }, (_event, filename) => {
      if (filename && !taskFile.test(String(filename))) return;
      if (filename) files.add(String(filename));
      else unknown = true;
      schedule();
    }));
    // plan.yaml sits BESIDE tasks/, not inside it, so the watch above never sees
    // it — and the served Execution view (TL-109) is drawn from it.
    watchers.push(watch(root, { persistent }, (_event, filename) => {
      if (filename && String(filename) !== PLAN_FILENAME) return;
      plan = true;
      schedule();
    }));
  } catch (e) {
    for (const w of watchers) w.close();
    throw e;
  }
  for (const w of watchers) w.on("error", onWatcherError);

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      for (const w of watchers) {
        try { w.close(); } catch { /* already closed */ }
      }
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Snapshots and their difference
// ──────────────────────────────────────────────────────────────────────────

/** One task file as the diff sees it, or `null` when it cannot be read. */
export function readTaskSnapshot(tasksDir, file) {
  let text;
  try {
    text = readFileSync(join(tasksDir, file), "utf8");
  } catch {
    return null;
  }
  const { frontmatter, body } = splitFrontmatter(text);
  return { meta: extractMeta(frontmatter), body };
}

/**
 * Every task file in the tree, keyed by filename.
 *
 * @param {string} tasksDir
 * @param {RegExp} taskFile  from the configuration, never a constant here
 * @returns {Map<string, { meta: object, body: string }>}
 */
export function snapshotTasks(tasksDir, taskFile) {
  const out = new Map();
  let names;
  try {
    names = readdirSync(tasksDir);
  } catch {
    return out;
  }
  for (const f of names.filter((n) => taskFile.test(n)).sort()) {
    const snap = readTaskSnapshot(tasksDir, f);
    if (snap) out.set(f, snap);
  }
  return out;
}

/**
 * The changes between two snapshots, restricted to `files` (all of them when
 * `files` is null). PURE.
 *
 * Each change names the task, the file, `created` / `modified` / `deleted`, and
 * for `modified` the tracked fields that moved, plus `__body__` — the history
 * log's name for the same fact (TL-523) — when the markdown body did. `updated`
 * is not reported, for the reason `diffMeta` gives: it moves on every edit. A
 * file whose bytes moved but whose fields and body did not produces nothing.
 *
 * @param {Map} before
 * @param {Map} after
 * @param {string[] | null} files
 */
export function diffSnapshots(before, after, files) {
  const names = files ? [...new Set(files)] : [...new Set([...before.keys(), ...after.keys()])];
  const out = [];
  for (const file of names.sort()) {
    const a = before.get(file);
    const b = after.get(file);
    if (!a && !b) continue;
    if (!a) {
      out.push({ id: b.meta.id, file, change: "created", fields: [] });
      continue;
    }
    if (!b) {
      out.push({ id: a.meta.id, file, change: "deleted", fields: [] });
      continue;
    }
    const fields = diffMeta(a.meta, b.meta).map((d) => d.field);
    if (a.body !== b.body) fields.push(FIELD_BODY);
    if (fields.length) out.push({ id: b.meta.id, file, change: "modified", fields });
  }
  return out;
}

/**
 * Apply what was re-read to a snapshot, so the next diff starts from it.
 * Mutates and returns `snapshot`.
 */
export function advanceSnapshot(snapshot, fresh, files) {
  if (!files) {
    snapshot.clear();
    for (const [k, v] of fresh) snapshot.set(k, v);
    return snapshot;
  }
  for (const f of files) {
    if (fresh.has(f)) snapshot.set(f, fresh.get(f));
    else snapshot.delete(f);
  }
  return snapshot;
}

/** Re-read only `files` (all when null) into a Map shaped like a snapshot. */
export function rereadTasks(tasksDir, taskFile, files) {
  if (!files) return snapshotTasks(tasksDir, taskFile);
  const out = new Map();
  for (const f of files) {
    if (!taskFile.test(f)) continue;
    const snap = readTaskSnapshot(tasksDir, f);
    if (snap) out.set(f, snap);
  }
  return out;
}
