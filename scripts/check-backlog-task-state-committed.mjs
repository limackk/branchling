#!/usr/bin/env node
/**
 * Report: has a task's state travelled with its branch yet? (TL-230)
 *
 * THE DEFECT, MEASURED. On 2026-09-03 in the `tl-214-role-pipeline` worktree
 * three tasks had their CODE committed while the state change to the task file
 * stayed in the working tree: TL-214 was `in_progress` at `HEAD` and `done` on
 * disk, TL-180 `pending` against `done`, TL-187 `pending` against
 * `in_progress`. The consequence is not hypothetical — `next` handed TL-187 to
 * a second session, which took it, found the suite already green and had
 * nothing to do. The task file said `pending`, and the task file is the only
 * thing `next` reads.
 *
 * WHY CLAUDE.md's ANSWER DOES NOT REACH IT. "After the commit: merge into
 * `main` and close the worktree" covers the same failure ACROSS branches. Here
 * the divergence is between the working tree and `HEAD` of the SAME branch, so
 * there is nothing to merge yet and no worktree to remove. The work was
 * committed; only the record of the work was not.
 *
 * WHY THE TOOL CAN SEE THIS AND A RULE CANNOT. "Commit a task closed by `done`
 * together with its entry in `backlog/history/`" is a convention, and a
 * convention is checked by the person who already forgot it. A committed
 * `status:` differing from the one on disk is a fact `git show HEAD:<path>`
 * answers in one call.
 *
 * THIS IS A REPORT, NOT A FAILURE, and that is the whole design. An
 * uncommitted state change is the NORMAL condition of a session still working
 * — `take` writes one at the start. A guard that failed here would fail every
 * session mid-task, and would be switched off within a day. So it exits 0 and
 * names the tasks, the way the `--reasons` guard already reports gaps it does
 * not fail on.
 *
 * TWO THINGS ARE SILENT, DELIBERATELY. A task file git has never seen has no
 * committed state to disagree with — the absence of a commit is not a
 * divergence, it is a task that has not been committed once. And a backlog
 * outside any repository has no `HEAD` at all; there the command says so out
 * loud rather than printing a tick it never earned, exactly as the history
 * guard does.
 *
 * TWO CASES ARRIVED IN ONE BLOCK, AND ONLY ONE OF THEM NEEDS A READER
 * (TL-261). A task this session is holding right now is `in_progress` on disk
 * and `pending` at `HEAD` because `take` wrote it that way a minute ago; a task
 * whose closing was abandoned is `done` on disk with the work already
 * committed. Measured on 2026-09-04: two agents, on different tasks in the same
 * wave, both got one block of two `!` lines and both resolved it by reading
 * `git log` by hand. The tool already knows the answer — the reservation in the
 * state directory names the holder and the moment it was taken — so the two are
 * reported apart, and the remedy is printed only under the group that has one.
 *
 * WHY THE RESERVATION AND NOT `owner:`. In the measured case both lines carried
 * the SAME `owner:`, because the abandoned closing was left by an earlier
 * session of the same actor. `owner:` cannot separate them; a live reservation
 * can, because `done` gives it back.
 *
 * Usage:
 *   node scripts/check-backlog-task-state-committed.mjs [--dir <backlog>] [--actor <ns:name>]
 *
 * Exit 0 always — it reports. 2 is a usage error.
 *
 * Tests: `node --test scripts/tests/check-task-state-committed.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { DEFAULT_LOCK_TTL_MINUTES, isExpired, listLocks } from "./lock.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { MARK, color } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const WARNM = color.warn(MARK.warn);
const BULLET = color.dim(MARK.bullet);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** The fields whose divergence means a session would be handed the wrong
 *  answer. `status:` decides whether `next` offers the task at all; `owner:`
 *  decides whether it looks free. Nothing else in the frontmatter is read by
 *  the selection path, and a wider comparison would report a reworded title as
 *  if it were a lost closing. */
const COMPARED = ["status", "owner"];

/** The repository a directory belongs to, or null. The runner is injectable so
 *  a test can exercise the no-git branch without deleting anything. */
export function gitRoot(dir, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (!r || r.status !== 0) return null;
  const top = String(r.stdout || "").trim();
  return top || null;
}

/**
 * The same path git would print for it. `rev-parse --show-toplevel` answers
 * with the REAL path, and on macOS `/var` is a symlink to `/private/var` — so a
 * backlog under a temporary directory would otherwise compute as `../../..`
 * and match nothing git says. That mistake is green, because an empty set has
 * no divergence in it (the history guard was caught by it first).
 */
function real(path) {
  try { return realpathSync(path); } catch { return resolve(path); }
}

/**
 * The comparison. PURE — it is handed both sides.
 *
 * @param {Array<{id: string, path: string, tree: object, head: object|null}>} pairs
 * @returns {{diverged: Array, compared: number}}
 */
export function compareStates(pairs) {
  const diverged = [];
  let compared = 0;
  for (const pair of pairs) {
    // No committed side: git has never seen this file. Not a divergence.
    if (!pair.head) continue;
    compared++;
    const fields = COMPARED.filter((f) => (pair.tree[f] || "") !== (pair.head[f] || ""));
    if (fields.length) diverged.push({ id: pair.id, path: pair.path, fields, tree: pair.tree, head: pair.head });
  }
  return { diverged, compared };
}

/**
 * Which of these divergences is the running session's own work? PURE — it is
 * handed the reservations rather than reading the state directory (TL-261).
 *
 * A divergence counts as HELD when a reservation for that id exists, has not
 * outlived its TTL, names THIS actor, and was taken in THIS tree. All four are
 * needed. Reservations are keyed by the git common directory, so every worktree
 * of a clone reads the same file: without the tree test a sibling session's
 * live claim would be reported here as this session's work. The TTL matters
 * because a reservation nobody released outlives the session that wrote it, and
 * an expired one proves nothing about now.
 *
 * `pid` is deliberately NOT compared: `check` runs in a different process from
 * the `take` that wrote the reservation, so equality there would hold for
 * nobody.
 *
 * @param {Array} diverged  entries from `compareStates`
 * @param {{locks: Array, actor: string, root: string, now?: number,
 *          ttlMinutes?: number}} opts
 * @returns {{held: Array, unheld: Array}} same entries, `held` carrying `.lock`
 */
export function partitionByHolder(diverged, opts) {
  const now = opts.now || Date.now();
  const ttl = opts.ttlMinutes === undefined ? DEFAULT_LOCK_TTL_MINUTES : opts.ttlMinutes;
  const tree = resolve(opts.root);
  const mine = new Map();
  for (const lock of opts.locks || []) {
    if (!lock || lock.actor !== opts.actor) continue;
    if (resolve(String(lock.tree || "")) !== tree) continue;
    if (isExpired(lock, ttl, now)) continue;
    mine.set(lock.task, lock);
  }
  const held = [];
  const unheld = [];
  for (const d of diverged) {
    const lock = mine.get(d.id);
    if (lock) held.push({ ...d, lock });
    else unheld.push(d);
  }
  return { held, unheld };
}

/** The moment a reservation was taken, as a local clock time — "taken 17:03" is
 *  what makes a line recognisable as this session's own work. An unparseable
 *  timestamp yields nothing rather than an invented time. */
function takenAt(lock) {
  const ts = Date.parse((lock && lock.ts) || "");
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/** The frontmatter of one path as it stands at `HEAD`, or null if git has never
 *  committed it. A file merely STAGED has no `HEAD` blob either, and that is the
 *  same answer for the same reason. */
function metaAtHead(repoRoot, relPath, run = spawnSync) {
  const r = run("git", ["-C", repoRoot, "show", "HEAD:" + relPath], { encoding: "utf8" });
  if (!r || r.status !== 0) return null;
  return extractMeta(splitFrontmatter(String(r.stdout || "")).frontmatter);
}

export function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  // `--actor` states WHOSE work this run is. Unstated, it comes off the same
  // chain every writing command uses, which is what makes the answer match the
  // reservation that `take` wrote in this session.
  let actorFlag = "";
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--actor") {
      actorFlag = rest[i + 1] || "";
      if (!actorFlag) {
        console.error(`${N} check: --actor needs a value, e.g. --actor agent:claude`);
        return 2;
      }
      i++;
      continue;
    }
    args.push(rest[i]);
  }
  if (args.length) {
    console.error(`${N} check: unknown argument: ` + args.join(" "));
    console.error("  usage: check-backlog-task-state-committed.mjs [--dir <backlog>] [--actor <ns:name>]");
    return 2;
  }
  const actor = resolveActor(actorFlag);
  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const paths = backlogPaths(root);

  const repo = gitRoot(root);
  if (!repo) {
    console.log(`${OKM} task-state: not a git repository — nothing to compare a task file against`);
    return 0;
  }
  const repoRoot = real(repo);
  // A repository with no commits yet has no `HEAD`, so there is no committed
  // side for anything. Said out loud for the same reason as the branch above.
  const head = spawnSync("git", ["-C", repoRoot, "rev-parse", "--verify", "-q", "HEAD"], { encoding: "utf8" });
  if (!head || head.status !== 0) {
    console.log(`${OKM} task-state: no commit yet — nothing has a committed state to disagree with`);
    return 0;
  }

  const rel = (p) => relative(repoRoot, real(p)).split("\\").join("/");
  const pairs = [];
  if (existsSync(paths.tasksDir)) {
    for (const file of readdirSync(paths.tasksDir).sort()) {
      const m = file.match(config.taskId.fileId);
      if (!m || !config.taskId.file.test(file)) continue;
      const full = join(paths.tasksDir, file);
      const tree = extractMeta(splitFrontmatter(readFileSync(full, "utf8")).frontmatter);
      pairs.push({ id: m[1], path: rel(full), tree, head: metaAtHead(repoRoot, rel(full)) });
    }
  }

  const { diverged, compared } = compareStates(pairs);

  if (!diverged.length) {
    // The counts are the positive control: "0 diverged" over 0 files compared
    // would be a report that read nothing, and it must not look like one that
    // looked and found nothing.
    console.log(
      `${OKM} task-state: ${compared} task file(s) compared with HEAD, each one agrees ` +
        `(${pairs.length} in the tree)`
    );
    return 0;
  }

  const { held, unheld } = partitionByHolder(diverged, { locks: listLocks(root), actor, root });

  const sides = (d) =>
    d.fields
      .map((f) => `${f}: ${d.head[f] || "(none)"} at HEAD, ${d.tree[f] || "(none)"} on disk`)
      .join("; ");
  const listOut = (entries, render) => {
    for (const d of entries.slice(0, 20)) console.log(render(d));
    if (entries.length > 20) console.log(`  … and ${entries.length - 20} more`);
  };

  // The group with a remedy goes first, and it is the only one that gets the
  // warning mark. Nobody holds these, so nobody is going to commit them on
  // their way out of a session.
  if (unheld.length) {
    console.log(
      `${WARNM} task-state: ${unheld.length} of ${compared} task file(s) differ from HEAD ` +
        "with no session holding them — a state change left behind"
    );
    listOut(unheld, (d) => `  - ${d.id} — ${sides(d)}`);
    console.log("");
    console.log("  Reported, never failed: the exit code is 0 either way. This is the group that");
    console.log("  matters — the CODE was committed and the closing was not, and `next` reads the");
    console.log("  task file, so the next tree to look sees the task as it was before the work.");
    console.log("");
    console.log("  → Commit each task file together with its `backlog/history/` entry, or, if the");
    console.log("    change was never meant to be, restore it from HEAD.");
  }

  // The session's own work. Said in different words, under a neutral bullet,
  // and with no remedy — there is nothing to do about a task still open.
  if (held.length) {
    if (unheld.length) console.log("");
    console.log(
      `${BULLET} task-state: ${held.length} of ${compared} task file(s) differ from HEAD and are ` +
        `held by ${color.id(actor)} right now — the normal condition of a session mid-task`
    );
    listOut(held, (d) => {
      const at = takenAt(d.lock);
      return `  - ${d.id} — ${at ? `taken ${at} — ` : ""}${sides(d)}`;
    });
    console.log("");
    console.log("  → Nothing to do while the work is open; it travels with the closing commit.");
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-task-state-committed.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
