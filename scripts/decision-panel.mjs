/**
 * "Waiting on you" — what hangs on a person's decision (TL-115).
 *
 * WHY A MODULE AND NOT A VIEW. The panel is a pure function of data that
 * already exists: the task files and the history. Nothing new is stored, so
 * there is nothing to keep in step (law 2). Written inside the viewer's template
 * it would also be unreachable from a test — this file is pasted into the page
 * by source, so `node --test` and the browser run the same code.
 *
 * WHAT IT ANSWERS, in one list rather than three, because the reader's question
 * is one question — "what is stopping the work":
 *
 *   a task    open, every `blocked_by` closed, and marked `executor: human`
 *             (TL-113) or asking for a role this deployment has no agent for.
 *   a question a `__comment__` nothing has answered (TL-114's `openQuestions`),
 *             carrying the options it was asked with and which one is
 *             recommended (TL-204), because the panel is where a NON-technical
 *             reader answers and they cannot go and read the log for the rest.
 *
 * THE ORDER IS THE POINT. Both kinds are sorted by how many tasks the decision
 * would release — counted TRANSITIVELY through `blocks`, because a task that
 * unblocks one task which unblocks nine is not a small decision. That number is
 * the panel's unit of priority; sorting by date would put the oldest question
 * above the one holding up the release.
 *
 * ONE IMPORT, AND IT IS THE CONSTRAINT ON THE PASTE ORDER. `openQuestions` is
 * imported from `task-fields.mjs` so this file runs under `node --test`;
 * `readModuleSource` strips the import line, and the page works because
 * task-fields.mjs is pasted BEFORE this one. Nothing else may be imported here
 * without moving it into an earlier paste.
 *
 * Tests: `node --test scripts/tests/decision-panel.test.mjs`
 */

import { openQuestions } from "./task-fields.mjs";

/**
 * How many OPEN tasks this one would release, directly or through a chain.
 * PURE.
 *
 * Transitive, and it counts a task once however many paths reach it. A cycle in
 * `blocks:` is a defect `check --refs` reports; here it must simply not hang, so
 * the walk carries a `seen` set.
 *
 * A task is counted only if THIS one is its last open blocker — otherwise
 * finishing it releases nothing, and a number that counts what stays blocked is
 * a number that argues for the wrong decision.
 */
export function unblocksCount(id, byId, archived) {
  const closed = new Set(archived || []);
  const isOpen = (t) => !!t && !closed.has(t.status);
  const released = new Set([String(id).toUpperCase()]);
  const out = new Set();

  // Repeat until nothing new is released: a task two steps down may become
  // reachable only after the one above it is counted.
  for (let pass = 0; pass < 100; pass++) {
    let grew = false;
    for (const [key, task] of byId) {
      if (released.has(key) || !isOpen(task)) continue;
      const blockers = (task.blocked_by || []).map((b) => String(b).toUpperCase());
      if (!blockers.length) continue;
      const stillBlocked = blockers.filter(
        (b) => !released.has(b) && isOpen(byId.get(b))
      );
      if (stillBlocked.length) continue;
      // Every blocker is either closed already or released by this decision, and
      // at least one of them is ours — otherwise the task was never waiting.
      if (!blockers.some((b) => released.has(b))) continue;
      released.add(key);
      out.add(key);
      grew = true;
    }
    if (!grew) break;
  }
  return out.size;
}

/**
 * The panel's rows.
 *
 * @param {Array<object>} tasks   task records (status, executor, role, blocked_by)
 * @param {object} history        { id: [entry] }, as the page holds it
 * @param {object} opts
 *   - archivedStatuses: the project's closed statuses
 *   - servedRoles:      the roles this deployment has an agent for. OMITTED
 *     rather than guessed: the map lives in the caller's `run` invocation (TL-98),
 *     which the page has never seen, and inventing an empty one would put every
 *     task with any role into a person's queue.
 *   - now:              epoch ms, passed in so a test is not tied to the clock
 */
export function decisionPanel(tasks, history, opts = {}) {
  const archived = opts.archivedStatuses || [];
  const closed = new Set(archived);
  const now = opts.now || Date.now();
  const served = opts.servedRoles ? new Set(opts.servedRoles) : null;
  const byId = new Map((tasks || []).map((t) => [String(t.id).toUpperCase(), t]));
  const isOpen = (t) => !!t && !closed.has(t.status);
  const cleared = (t) =>
    (t.blocked_by || []).every((b) => {
      const blocker = byId.get(String(b).toUpperCase());
      // An unknown id is not a closed one: `check --refs` owns that defect, and
      // treating it as cleared would put work in a person's queue that nothing
      // can actually start.
      return blocker && closed.has(blocker.status);
    });

  const items = [];
  for (const task of tasks || []) {
    if (!isOpen(task) || !cleared(task)) continue;
    const reasons = [];
    if (String(task.executor || "").trim() === "human") reasons.push("executor");
    if (served && String(task.role || "").trim() && !served.has(String(task.role).trim())) {
      reasons.push("role");
    }
    if (!reasons.length) continue;
    items.push({
      kind: "task",
      id: task.id,
      title: task.title || "",
      status: task.status,
      priority: task.priority || "",
      owner: task.owner || "",
      role: String(task.role || "").trim(),
      why: reasons,
      unblocks: unblocksCount(task.id, byId, archived),
    });
  }

  for (const task of tasks || []) {
    if (!isOpen(task)) continue;
    const entries = (history || {})[task.id] || [];
    for (const q of openQuestions(entries)) {
      items.push({
        kind: "question",
        id: task.id,
        title: task.title || "",
        status: task.status,
        priority: task.priority || "",
        eventId: q.id,
        question: q.to,
        asked: q.ts,
        asker: q.actor || "",
        ageDays: q.ts ? Math.max(Math.floor((now - Date.parse(q.ts)) / 86400000), 0) : null,
        // THE MENU TRAVELS WITH THE QUESTION (TL-204). A reader who opens this
        // panel has none of the conversation; a menu left behind in the log
        // makes them redo the analysis the asker already did. Normalised to an
        // array here so no caller has to distinguish the three states on disk —
        // absent key, `[]`, a list — but NOTHING is invented: a question asked
        // without options carries an empty menu and the viewer draws none.
        options: Array.isArray(q.options) ? q.options.slice() : [],
        recommend: Number.isInteger(q.recommend) && q.recommend >= 1 ? q.recommend : null,
        unblocks: unblocksCount(task.id, byId, archived),
      });
    }
  }

  // A question outranks a task at the same count: somebody is explicitly
  // waiting for an answer, while a task marked for a person is merely unstarted.
  const rank = { question: 0, task: 1 };
  items.sort(
    (a, b) =>
      b.unblocks - a.unblocks ||
      rank[a.kind] - rank[b.kind] ||
      String(a.id).localeCompare(String(b.id))
  );
  return items;
}

/** Narrow the rows to one person's queue. PURE.
 *
 *  IT MATCHES A DECLARED ACTOR, not an authenticated identity — the viewer has
 *  no such thing yet, and saying so is better than a filter that quietly means
 *  something weaker than it looks. A row counts as "mine" when I hold the task,
 *  or when I am the one who asked the question and it is still open. */
export function minePanel(items, actor) {
  const me = String(actor || "").trim();
  if (!me) return items;
  return items.filter((i) => i.owner === me || i.asker === me);
}
