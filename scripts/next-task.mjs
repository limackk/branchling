#!/usr/bin/env node
/**
 * `next` — hand the closest executable task to one session (TL-87).
 *
 * WHAT IT MAKES POSSIBLE. N agent sessions in N worktrees on one disk take work
 * off the same backlog without a dispatcher process, without a server and
 * without an orchestrator: each one asks for the next task and gets a DIFFERENT
 * one, because the answer and the reservation happen in the same act. That is
 * the difference between a backlog that is "agent-friendly" — readable, tidy,
 * well-formatted — and one that is a work QUEUE.
 *
 * WHY IT IS A THIN LAYER. Everything below the choice belongs to `take`: the
 * lock, the write, the history entry, the refusals. This file answers one
 * question — WHICH task — and it answers it with `query`'s own filters
 * (task-select.mjs), so a person who ran `query` and a dispatcher that ran
 * `next` cannot get contradictory answers about the same tree.
 *
 * WHICH STATUSES IT HANDS OUT. By default: the active ones, minus the status
 * that means "in progress", minus every status the project protects with
 * `reason_required_statuses`. That last exclusion is the interesting one — a
 * status you may not ENTER without stating a reason (`blocked`, `cancelled`) is
 * a deliberate exit from the flow, and handing one to an unattended agent would
 * quietly undo somebody's decision. `--status` overrides it, because a person
 * asking for exactly that is not unattended.
 *
 * WHAT IT REFUSES TO HAND OUT, BEYOND THIS TREE. The tasks in one checkout are
 * one opinion about the backlog, and the command that WRITES may not have a
 * narrower view than the ones that only read: `query`, `stats` and the viewer
 * have consulted the branch and worktree scan since TL-73, while the dispatcher
 * did not, so a fleet was handed tasks another branch had already started
 * (TL-133). The scan may only ever REMOVE a candidate here, never add one — see
 * `selectCandidates`. It costs one pass over the local refs per call and is
 * switched off, explicitly, by `cross_branch_state: false`.
 *
 * EXIT CODES. 0 took a task · 3 nothing to take · 1 a refusal about a task that
 * exists · 2 a usage error. "Nothing to take" must be distinguishable from "the
 * call was wrong", or a loop cannot tell an empty queue from its own typo.
 *
 * Tests: `node --test scripts/tests/next.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { crossBranchState, describeDivergence, divergences, scanNote } from "./branch-scan.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, isValidActor, isValidReason } from "./history.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { inProgressStatus, rebuildViews, refusalCode, renderTake, resolveActor, takeJson, takeTask } from "./take-task.mjs";
import { filterTasks, readTaskRecords, sortTasks, splitList } from "./task-select.mjs";
import { MARK, color, failure, warn } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const NEXT_FLAGS = [
  "--dir", "--actor", "--reason", "--json",
  "--board", "--label", "--priority", "--epic", "--status", "--role",
];

/** No candidate is not an error — see the header. */
export const EXIT_NOTHING_TO_TAKE = 3;

/** PURE — resolves `next`'s arguments. Throws on a usage error. */
export function parseNextArgs(args) {
  const plan = { dir: null, actor: null, reason: null, json: false,
    board: null, label: null, priority: null, epic: null, status: null,
    role: null, roleStrict: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--role-strict") { plan.roleStrict = true; continue; }
    if (NEXT_FLAGS.indexOf(a) >= 0) {
      const value = args[++i] || null;
      if (!value) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + NEXT_FLAGS.concat(["--role-strict"]).join(" "));
    }
    throw new Error(
      "unexpected argument: " + a + "\n" +
        "`next` chooses the task — to name one yourself use `" + N + " take " + a + "`."
    );
  }
  // `--role-strict` alone narrows nothing — there is no role to be strict about,
  // and silently ignoring a flag is how a caller gets a queue they did not ask
  // for and no word about it.
  if (plan.roleStrict && plan.role === null) {
    throw new Error(
      "`--role-strict` with no `--role`\n" +
        "It narrows `--role r` from `r or no role` to `exactly r`; on its own there is\n" +
        "nothing for it to narrow."
    );
  }
  if (plan.reason !== null && !isValidReason(plan.reason)) {
    throw new Error(
      "`--reason " + plan.reason + "` is empty or reserved\n" +
        "`unknown` and `proven` are what the tool writes when nobody stated a reason."
    );
  }
  return plan;
}

/**
 * The statuses a dispatcher may hand out. PURE.
 *
 * DERIVED from vocabulary the project has already declared, rather than asking
 * for one more key: `statuses` minus `archived_statuses` minus
 * `in_progress_status` minus `reason_required_statuses`. Every one of those
 * lists already means something in this backlog, and a fifth key would be a
 * fourth place to keep the same decision in sync.
 */
export function queueStatuses(config) {
  const inProgress = inProgressStatus(config);
  const protectedOnes = new Set(config.reasonRequiredStatuses || []);
  return config.activeStatuses.filter((s) => s !== inProgress && !protectedOnes.has(s));
}

/**
 * Are this task's blockers all closed? PURE.
 *
 * An UNKNOWN blocker id counts as unresolved. A dangling `blocked_by` is a
 * defect `check --refs` reports by name; treating it as "nothing in the way"
 * here would let a typo dispatch work somebody had deliberately gated.
 */
export function isExecutable(task, byId, archived) {
  return (task.blocked_by || []).every((id) => {
    const blocker = byId.get(String(id).toUpperCase());
    return blocker && archived.has(blocker.status);
  });
}

/**
 * Is this task in a protected status whose stated blockers are all closed? PURE.
 *
 * THE ASYMMETRY THIS RESTS ON (TL-127). `blocked_by` is a FACT computable from
 * the tree — the blocker is closed or it is not. `status: blocked` is a person's
 * DECLARATION, and `reason_required_statuses` protects it precisely so that an
 * unattended agent cannot undo somebody's decision quietly. But when the
 * declaration NAMED its condition and every named task is closed, the decision
 * has not been undone — it has been discharged, by the very tasks it pointed at.
 * Handing that work out is reading the declaration, not overruling it.
 *
 * AN EMPTY `blocked_by` IS THE OPPOSITE CASE and is deliberately excluded. A
 * task blocked with nothing named is waiting on something outside the tree — a
 * decision, another team, a delivery — and nothing here can observe that it
 * arrived. Dispatching it would hand out work that cannot be done, which is a
 * worse failure than the one this fixes.
 *
 * The status comes from the project's own `reason_required_statuses`; no value
 * is written into this code.
 */
export function isUnblocked(task, byId, archived, config) {
  const protectedOnes = new Set(config.reasonRequiredStatuses || []);
  if (!protectedOnes.has(task.status)) return false;
  if (archived.has(task.status)) return false;
  if (!(task.blocked_by || []).length) return false;
  return isExecutable(task, byId, archived);
}

/**
 * Has this claim been abandoned? PURE.
 *
 * The evidence is `updated:` — the last day a command wrote to the file — and
 * the window is the project's `abandoned_after_days`, `0` meaning never. Three
 * refusals to judge, each of them a case where guessing would hand out work
 * somebody is doing:
 *
 *   the window is off        the default. Nobody has said how long a claim of
 *                            theirs may go quiet, so nothing is abandoned.
 *   the status is not the    only a claim can be abandoned. A `pending` task was
 *   in-progress one          never held.
 *   `updated:` is missing    or unreadable. No date is not an old date, and a
 *   or unreadable            takeover on absent evidence is the silent one this
 *                            whole mechanism exists to avoid.
 *
 * A held LOCK is not consulted here and does not have to be: `next` tries to
 * acquire it, and a live session's lock refuses the take. That ordering is the
 * useful one — the lock is minute-resolution proof that a process is alive, and
 * it outranks a day-resolution guess that it is not.
 */
export function isAbandoned(task, config, now) {
  const days = Number(config.abandonedAfterDays || 0);
  if (!(days > 0)) return false;
  const inProgress = inProgressStatus(config);
  if (!inProgress || task.status !== inProgress) return false;
  const stamp = String(task.updated || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return false;
  const at = Date.parse(stamp + "T00:00:00Z");
  if (!Number.isFinite(at)) return false;
  return (now - at) >= days * 24 * 60 * 60 * 1000;
}

/**
 * The observations that say somebody else's tree has already moved this task on.
 * PURE.
 *
 * The rule is DERIVED, not a list of statuses written here: an observation
 * disqualifies the task exactly when its status is one this call would not have
 * handed out in the first place (third law — the vocabulary is the project's).
 * By default that is every status outside `queueStatuses()`, so a task another
 * branch reports as in progress, closed or blocked is not offered a second time.
 *
 * @param {object} task a record carrying `elsewhere` from `branch-scan.mjs`
 * @param {Set<string>} handedOut the statuses of this call, lowercased
 */
export function heldElsewhere(task, handedOut) {
  return (task.elsewhere || []).filter(
    (o) => !handedOut.has(String(o.status || "").toLowerCase())
  );
}

/**
 * The candidates, best first. PURE with respect to the disk — it is handed the
 * records.
 *
 * TWO GROUPS, AND THE ORDER BETWEEN THEM IS THE POLICY. Untouched work first,
 * sorted as `query` sorts it; abandoned claims after ALL of it, whatever their
 * priority. A P0 somebody walked away from is still somebody's, and taking it
 * over while a P3 sits untouched trades a certain duplicate for an uncertain
 * rescue. Reclaiming is what the queue does when it has nothing else to do.
 *
 * The second group is skipped entirely when `--status` was given: a caller
 * naming statuses is asking a question, and answering it with tasks in a status
 * they did not name would be the tool choosing for them.
 *
 * THE SCAN MAY ONLY NARROW THIS, NEVER WIDEN IT (TL-133). Two rules, and the
 * asymmetry between them is the decision:
 *
 *   removes  a task another branch or worktree reports in a status this call
 *            does not hand out is EXCLUDED, not pushed to the end. Pushing back
 *            is right for an abandoned claim, where the evidence is a stale date
 *            and taking it over may be a rescue; here the evidence is another
 *            tree's live state, and a candidate at the end of the queue is still
 *            handed out the moment nothing else is left — which is exactly the
 *            13:41/13:43 collision in CLAUDE.md, delayed rather than removed.
 *   adds     nothing. `filterTasks` matches a task on the statuses seen ANYWHERE
 *            (that is what `query --status in_progress` from `main` is for), but
 *            `next` WRITES: a task whose only evidence of being startable comes
 *            from somebody else's branch is not startable in this tree, and
 *            claiming it here would manufacture the divergence. So the local
 *            status has to be one of this call's own.
 *
 * @returns {{candidates: object[], reclaimable: Set<string>, skippedBlocked: number,
 *            skippedElsewhere: Array<{id: string, elsewhere: object[]}>}}
 */
export function selectCandidates(records, config, filters, now) {
  const archived = new Set(config.archivedStatuses);
  const byId = new Map(records.map((t) => [String(t.id).toUpperCase(), t]));
  const wanted = filters.status || queueStatuses(config);
  const handedOut = new Set(wanted.map((s) => String(s).toLowerCase()));
  const matching = filterTasks(records, { ...filters, status: wanted }, archived)
    .filter((t) => handedOut.has(String(t.status || "").toLowerCase()));
  const fresh = matching.filter((t) => isExecutable(t, byId, archived));

  // Work whose stated blockers have all closed (TL-127). Only when the caller
  // did NOT name statuses: `--status` is somebody choosing what they want, and
  // widening their answer would be answering a different question. They are
  // merged BEFORE the sort rather than appended after it — a discharged P1 is
  // ready work, and burying it under every `pending` P3 would leave the queue
  // stuck in a slower way.
  const unblocked = new Set();
  if (!filters.status) {
    for (const t of filterTasks(records, { ...filters, status: null }, archived)) {
      if (!isUnblocked(t, byId, archived, config)) continue;
      unblocked.add(String(t.id).toUpperCase());
      fresh.push(t);
    }
  }
  sortTasks(fresh, "priority", config);

  const skippedElsewhere = [];
  const free = (task, held) => {
    if (!held.length) return true;
    skippedElsewhere.push({ id: task.id, elsewhere: held });
    return false;
  };
  const candidates = fresh.filter((t) => free(t, heldElsewhere(t, handedOut)));

  const reclaimable = new Set();
  if (!filters.status) {
    const stale = filterTasks(records, { ...filters, status: [inProgressStatus(config)].filter(Boolean) }, archived)
      .filter((t) => isAbandoned(t, config, now || Date.now()))
      .filter((t) => isExecutable(t, byId, archived))
      // ANY disagreement stops a reclaim, whatever it says. Taking over a claim
      // is already a guess made from a date; a tree that reports something else
      // about the same task is the one piece of evidence that the guess is
      // wrong, and it costs nothing to believe it.
      .filter((t) => free(t, (t.elsewhere || []).slice()));
    sortTasks(stale, "priority", config);
    for (const t of stale) reclaimable.add(String(t.id).toUpperCase());
    candidates.push(...stale);
  }
  return {
    candidates, reclaimable, unblocked, skippedElsewhere,
    // The count is of tasks that MATCHED and were held back by an open blocker;
    // the unblocked ones were never in `matching`, so they must not be
    // subtracted from it.
    skippedBlocked: matching.length - (fresh.length - unblocked.size),
  };
}

export function run(argv) {
  let plan;
  try {
    plan = parseNextArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " next", head, rest, [N + " next --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    console.error(failure(N + " next", "the actor `" + actor + "` has no valid namespace", [
      "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
      "The namespace says how much the attribution is worth — local: declared,",
      "agent: automated, user: an authenticated account. BL-1404.",
    ], [N + " next --help"]));
    return 2;
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    console.error(failure(N + " next", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);

  // A role outside the project's vocabulary is a typo, and a typo that silently
  // matches nothing looks exactly like an empty queue (TL-97's rule, applied to
  // the dispatcher's side).
  const wantedRoles = splitList(plan.role);
  if (wantedRoles) {
    const unknown = wantedRoles.filter((r) => (config.roles || []).indexOf(r) < 0);
    if (unknown.length) {
      console.error(failure(N + " next", "unknown role(s): " + unknown.join(", "),
        (config.roles || []).length
          ? ["`roles` in config.yaml holds: " + config.roles.join(", ")]
          : [
              "This backlog declares no `roles:` in config.yaml, so no task can carry one.",
              "Declare the vocabulary there first — filtering by a role nobody serves",
              "would answer `nothing to take` about a queue that is not empty.",
            ],
        [N + " next --help"]));
      return 2;
    }
  }

  const filters = {
    status: splitList(plan.status),
    priority: splitList(plan.priority),
    board: splitList(plan.board),
    label: splitList(plan.label),
    epic: splitList(plan.epic),
    // `--role r` means `r OR no role`, because a task that asks for nobody in
    // particular can be done by anybody. The reverse default would starve every
    // role-less task the moment all the callers passed the flag — which, in a
    // fleet of specialised agents, is all of them. `--role-strict` is the
    // narrower question, asked explicitly.
    role: wantedRoles ? (plan.roleStrict ? wantedRoles : wantedRoles.concat([""])) : null,
  };
  const now = Date.now();
  const records = readTaskRecords(backlogPaths(root).tasksDir, config.taskId.file);
  // What the REST of this clone says (TL-133). Attached exactly as `query`
  // attaches it, from the same module, so the dispatcher and the listing cannot
  // disagree about the tree they are both looking at.
  const scan = crossBranchState(root, config);
  for (const t of records) t.elsewhere = divergences(t.status, scan.byId.get(t.id));
  const { candidates, reclaimable, unblocked, skippedBlocked, skippedElsewhere } =
    selectCandidates(records, config, filters, now);
  // Named, never silent: a candidate that disappears without a word is
  // indistinguishable from an empty queue, and the reader has no second place
  // to look.
  const elsewhereLines = skippedElsewhere.map(
    (s) => s.id + " skipped — " + s.elsewhere.map(describeDivergence).join(", ")
  );

  // Candidates are tried IN ORDER, and a taken one is skipped rather than
  // waited for: that is what makes two parallel calls come back with two
  // different tasks instead of one of them blocking. Only a collision is worth
  // stepping over — every other refusal would repeat itself on the next
  // candidate, so it ends the run and is reported.
  const passedOver = [];
  for (const candidate of candidates) {
    const reclaim = reclaimable.has(String(candidate.id).toUpperCase())
      ? { afterDays: config.abandonedAfterDays }
      : null;
    const key = String(candidate.id).toUpperCase();
    // The blockers travel with the take, because the REASON written into the
    // history has to name the tasks that discharged the status — a change whose
    // why is "the tool decided" is the `unknown` this project refuses.
    const cleared = unblocked.has(key) ? { blockers: (candidate.blocked_by || []).slice() } : null;
    const result = takeTask({
      root, config, id: candidate.id, actor, reason: plan.reason,
      source: reclaim ? "reclaim" : "next", reclaim, unblocked: cleared, now,
    });
    if (result.ok) {
      if (!rebuildViews(root)) {
        console.error(warn("the views were not rebuilt — run `" + N + " build` yourself"));
      }
      if (plan.json) {
        console.log(JSON.stringify({
          ...takeJson(result), passedOver, considered: candidates.length,
          skippedElsewhere, scan: { scanned: scan.scanned, reason: scan.reason },
        }, null, 2));
      } else {
        for (const line of elsewhereLines) console.log(color.dim(MARK.bullet + " " + line));
        for (const p of passedOver) {
          console.log(color.dim(MARK.bullet + " " + p.id + " passed over: " + p.why));
        }
        console.log(renderTake(result, root));
      }
      return 0;
    }
    if (result.kind === "locked" || result.kind === "other-owner") {
      passedOver.push({ id: candidate.id, why: result.message });
      continue;
    }
    if (plan.json) {
      console.log(JSON.stringify({ ok: false, kind: result.kind, id: result.id, message: result.message, details: result.details || [] }, null, 2));
    } else {
      console.error(failure(N + " next", result.message, result.details || []));
    }
    return refusalCode(result.kind);
  }

  const searched = plan.status ? splitList(plan.status) : queueStatuses(config);
  const details = [
    "searched statuses: " + (searched.join(", ") || "(none — check `statuses` in config.yaml)"),
  ];
  if (wantedRoles) {
    details.push(
      "searched roles: " + wantedRoles.join(", ") +
        (plan.roleStrict ? " (exactly — `--role-strict`)" : " (or no role at all)")
    );
  }
  if (skippedBlocked) details.push(skippedBlocked + " matching task(s) still have open blockers");
  if (elsewhereLines.length) {
    details.push(elsewhereLines.length + " candidate(s) are in another state on another branch or worktree");
    for (const line of elsewhereLines) details.push("  " + MARK.bullet + " " + line);
  }
  const note = scanNote(scan.reason);
  if (note) details.push(note);
  if (!(config.abandonedAfterDays > 0)) {
    details.push(
      "claims already held are never handed out again — `abandoned_after_days` is 0 (off)"
    );
  }
  if (passedOver.length) details.push(passedOver.length + " candidate(s) are held by another session");
  for (const p of passedOver) details.push("  " + MARK.bullet + " " + p.why);

  if (plan.json) {
    console.log(JSON.stringify({
      ok: false, kind: "nothing-to-take", taken: null,
      searchedStatuses: searched, skippedBlocked, passedOver, skippedElsewhere,
      scan: { scanned: scan.scanned, reason: scan.reason },
    }, null, 2));
  } else {
    // NOT an error, and it says so: silence here would read as a crash, and an
    // error would make an empty queue indistinguishable from a broken call.
    console.log(color.dim(MARK.bullet) + " nothing to take");
    for (const d of details) console.log("  " + color.dim(d));
  }
  return EXIT_NOTHING_TO_TAKE;
}

if (process.argv[1] && process.argv[1].endsWith("next-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
