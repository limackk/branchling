#!/usr/bin/env node
/**
 * `take <ID>` — claiming ONE named task (TL-87).
 *
 * WHAT IT IS FOR. "Do TL-1234", said to an agent, used to mean the agent edited
 * the frontmatter itself: status, owner and date, three fields, by hand, with
 * nothing between two sessions doing it at the same moment. This command is that
 * edit with a reservation in front of it — a lockfile that only one process can
 * create — so a collision is something you learn about AT THE TAKE, from a
 * refusal naming the holder, instead of at merge time from a conflict.
 *
 * WHY IT IS A PRIMITIVE AND `next` IS THE THIN ONE. Two modes need the claim:
 * a person naming a task, and a dispatcher choosing one. Only the CHOICE differs,
 * so only the choice is written twice — `next` selects a candidate and calls
 * `takeTask()`. A second reservation path would be a second set of rules about
 * who holds what, and the one that drifted would be the automated one.
 *
 * WHY THERE IS NO `--dry-run`. "Which task would I get, without taking it" is a
 * question `query` already answers, over the SAME selection code (task-select.mjs).
 * A second preview would be a second answer to one question.
 *
 * THE `focus:` FIELD IS NOT COMING BACK. It was abolished in BL-1386 after
 * measurement: at the time it named 3 tasks while 11 P0/P1 tasks sat outside it,
 * so it answered "what did somebody once mark" instead of "what is being worked
 * on". `status: in_progress` plus `owner:` is what NOW.yaml derives from, and
 * this command writes exactly those two.
 *
 * Tests: `node --test scripts/tests/next.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { ACTOR_NAMESPACES, appendEntries, changesRequiringReason, currentSession, eventId, FIELD_ROLE_OVERRIDE, isValidActor, isValidReason, normalizeReason, readHistory, reasonRefusal, recordEdit } from "./history.mjs";
import { withDecisions } from "./decisions.mjs";
import { focusQuietly } from "./focus.mjs";
import { printJson } from "./json-envelope.mjs";
import { acquireLock, releaseLock } from "./lock.mjs";
import { backlogPaths, resolveBacklogDir } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { buildFieldSpecs, extractMeta, fieldSpec, setFrontmatterField, splitFrontmatter } from "./task-fields.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, failure, warn } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TAKE_FLAGS = ["--dir", "--actor", "--role", "--reason", "--json"];

/** PURE — resolves `take`'s arguments. Throws on a usage error. */
export function parseTakeArgs(args) {
  const plan = { id: null, dir: null, actor: null, role: null, reason: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (a === "--dir" || a === "--actor" || a === "--role" || a === "--reason") {
      const value = args[++i] || null;
      if (!value) throw new Error("`" + a + "` with no value");
      plan[a.slice(2)] = value;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + TAKE_FLAGS.join(" "));
    }
    if (plan.id) throw new Error("two task ids given: " + plan.id + " and " + a + " — take one task at a time");
    plan.id = a;
  }
  if (!plan.id) throw new Error("no task id\nusage: " + N + " take <ID> [--actor <ns:name>]");
  // A reserved reason is a bad ARGUMENT, wrong whatever the task says, so it
  // fails with the other usage errors — the same rule as in `done`.
  if (plan.reason !== null) {
    const refusal = reasonRefusal(plan.reason, "--reason");
    if (refusal) throw new Error(refusal);
  }
  return plan;
}

/**
 * Which status means "somebody is working on this".
 *
 * The value is the PROJECT's (law 3), so it may be declared as
 * `in_progress_status`. Without the key we fall back to the default vocabulary's
 * own word — and when a project has renamed its statuses and not said which one
 * this is, we refuse rather than pick one: a dispatcher writing a status by
 * guesswork would be writing into somebody's tree a value they never chose.
 */
export function inProgressStatus(config) {
  return config.inProgressStatus || null;
}

/** Today, as the frontmatter writes it. Exported because every command that
 *  touches `updated:` has to write the same shape — two of them agreeing by
 *  coincidence is a rewrite of the whole field waiting to happen. */
export function todayStamp(now) {
  return new Date(now || Date.now()).toISOString().slice(0, 10);
}

/**
 * Claim one task: validate, reserve, write, record.
 *
 * Returns a RESULT rather than printing or exiting, because `next` calls it in a
 * loop and has to decide what a refusal means (try the next candidate) — a
 * function that exited would make that impossible.
 *
 * @param {{root: string, config: object, id: string, actor: string, role?: string,
 *          reason?: string, source?: string, now?: number, env?: object}} opts
 *        `role` is the role the CALLER declares they are acting as. It never
 *        blocks the take — see FIELD_ROLE_OVERRIDE — it only decides whether the
 *        history gets an entry saying the take was outside the task's role.
 * @returns {{ok: boolean, kind?: string, message?: string, details?: string[],
 *            id?: string, file?: string, text?: string, before?: object,
 *            after?: object, lock?: object, warnings?: string[]}}
 */
export function takeTask(opts) {
  const { root, config, actor } = opts;
  const paths = backlogPaths(root);
  const warnings = [];
  const wanted = String(opts.id || "").toUpperCase();
  const now = opts.now || Date.now();

  const records = readTaskRecords(paths.tasksDir, config.taskId.file);
  const record = records.find((t) => String(t.id).toUpperCase() === wanted);
  if (!record) {
    return {
      ok: false, kind: "not-found", id: opts.id,
      message: "no task " + opts.id + " in " + paths.tasksDir,
    };
  }
  const id = record.id;
  const file = join(paths.tasksDir, record.file.replace(/^tasks\//, ""));

  if (config.archivedStatuses.indexOf(record.status) >= 0) {
    return {
      ok: false, kind: "closed", id,
      message: id + " is closed (status: " + record.status + ")",
      details: ["Reopen it deliberately — a closed task is a decision, not a free slot."],
    };
  }

  const inProgress = inProgressStatus(config);
  if (!inProgress) {
    return {
      ok: false, kind: "no-in-progress-status", id,
      message: "this backlog does not say which status means `in progress`",
      details: [
        "`statuses` in config.yaml holds: " + config.statuses.join(", "),
        "Add `in_progress_status: <one of them>` — writing a status of our own",
        "choosing into your tree would be inventing your vocabulary for you.",
      ],
    };
  }

  // Somebody else's claim, visible in the FILE and not only in the lock. A lock
  // lives on one machine; `owner:` travels with the branch, so this catches the
  // case the lock cannot see — a take on another machine that has already been
  // merged in.
  //
  // `reclaim` is the ONE exception, and the caller has to have judged it: the
  // claim is older than the project's `abandoned_after_days` (TL-104). The
  // judgement is not made here because it belongs to the dispatcher's selection
  // — `next` decides WHICH task, and a takeover is a kind of choice, not a kind
  // of write. What this function owes it is that the takeover is never quiet:
  // the old owner is in the history entry's `from` and in a warning on stdout.
  if (record.status === inProgress && record.owner && record.owner !== actor && !opts.reclaim) {
    return {
      ok: false, kind: "other-owner", id,
      message: id + " is already " + inProgress + ", owner: " + record.owner,
      details: ["Ask them, or take it over deliberately by editing the file — not silently."],
    };
  }

  const raw = readFileSync(file, "utf8");
  const before = extractMeta(splitFrontmatter(raw).frontmatter);

  // Already yours: nothing to change, and no lock to argue about. Idempotence
  // belongs HERE rather than in the lock — the durable claim is `owner:` in the
  // file, and a retry that refused on the strength of its own first run would be
  // unusable in exactly the loop this command exists for.
  if (record.status === inProgress && record.owner === actor) {
    return {
      ok: true, id, file, text: raw, before, after: before,
      alreadyOwned: true, warnings,
      message: id + " is already yours (" + inProgress + ", owner: " + actor + ")",
    };
  }

  // A reason is demanded BEFORE anything is written (TL-105): a write followed
  // by a refusal would leave the change without the sentence that was its price.
  const needsReason = changesRequiringReason(config, [{ field: "status", to: inProgress }]);
  if (needsReason.length && !isValidReason(opts.reason || "")) {
    return {
      ok: false, kind: "needs-reason", id,
      message: "moving " + id + " to `" + inProgress + "` needs a stated reason",
      details: [
        "`reason_required_statuses` in config.yaml names it: " +
          (config.reasonRequiredStatuses || []).join(", "),
        "Pass `--reason \"…\"`.",
      ],
    };
  }

  const lock = acquireLock({
    root, taskId: id, actor, ttlMinutes: config.lockTtlMinutes, now, env: opts.env,
  });
  if (!lock.ok) {
    const h = lock.holder || {};
    return {
      ok: false, kind: "locked", id, holder: lock.holder,
      message: id + " is held by " + (h.actor || "another session"),
      details: [
        "since " + (h.ts || "?") + ", pid " + (h.pid || "?") + " on " + (h.host || "?"),
        "tree: " + (h.tree || "?"),
        "The lock expires after " + config.lockTtlMinutes + " minutes (`lock_ttl_minutes`).",
      ],
    };
  }
  if (lock.lock && lock.lock.tookOver) {
    warnings.push(
      "took over an expired lock held by " + (lock.lock.tookOver.actor || "?") +
        " since " + (lock.lock.tookOver.ts || "?")
    );
  }
  const reclaim = record.owner && record.owner !== actor ? opts.reclaim : null;
  if (reclaim) {
    warnings.push(
      "reclaimed from " + record.owner + " — `" + inProgress + "` since " +
        (record.updated || "?") + ", past `abandoned_after_days: " + reclaim.afterDays + "`"
    );
  }
  const cleared = opts.unblocked && record.status !== inProgress ? opts.unblocked : null;
  if (record.status !== inProgress && config.reasonRequiredStatuses.indexOf(record.status) >= 0) {
    // A status this project does not let anybody ENTER without a reason. Leaving
    // it is worth a line either way, and the two lines say different things: a
    // person naming the task outranks the dispatcher's caution, while a
    // dispatched one has had its own stated condition discharged (TL-127) and
    // names the tasks that discharged it.
    warnings.push(cleared
      ? "left `" + record.status + "` — every task in `blocked_by` is closed (" +
        (cleared.blockers || []).join(", ") + ")"
      : "was `" + record.status + "` — a status this project does not let you enter without a reason");
  }

  const specs = buildFieldSpecs(config);
  let text = raw;
  try {
    text = setFrontmatterField(text, "status", inProgress, fieldSpec("status", specs));
    text = setFrontmatterField(text, "owner", actor, fieldSpec("owner", specs));
    text = setFrontmatterField(text, "updated", todayStamp(now));
  } catch (e) {
    releaseLock({ root, taskId: id, actor, env: opts.env });
    return { ok: false, kind: "unwritable", id, message: id + ": " + e.message };
  }
  writeFileSync(file, text, "utf8");

  const after = extractMeta(splitFrontmatter(text).frontmatter);
  const ts = new Date(now).toISOString();
  // A reclaim states its own reason when the caller did not, and it states the
  // EVIDENCE rather than the verdict: the date the claim stopped moving and the
  // window it outlived. `reason` is the field the project decided a change's why
  // lives in (TL-105), so there is no second place to write this — and no
  // pseudo-field either, because `owner:` really did change and `diffMeta` can
  // already see it. A pseudo-field is for an event the frontmatter cannot show
  // (`__verified__`, `__role_override__`); this is not one.
  recordEdit(root, {
    taskId: id, before, after, actor, ts,
    // The role the CALLER declared with `--role` — what they were acting as, not
    // what the task asks for (TL-222). The mismatch event below records the two
    // disagreeing; this records the half a reader cannot reconstruct afterwards.
    role: opts.role,
    source: opts.source || "take",
    reason:
      opts.reason ||
      (reclaim ? reclaimReason(before.owner, before.updated, reclaim.afterDays) : "") ||
      (cleared ? unblockedReason(before.status, cleared.blockers) : ""),
  });

  // AUTO-FOCUS (TL-28, §8.1). The agent has just DECLARED what it is working on
  // — that is what `status: in_progress` plus `owner:` means — so the strongest
  // signal the attribution chain has is already in hand and free. Asking anybody
  // to also run the `focus` command would make the measurement depend on somebody
  // remembering, which is the failure that disqualified the off-the-shelf tools.
  //
  // SCOPED TO THE SESSION, NEVER GLOBAL. "Which task is in progress" has no
  // single answer across a repository — this backlog has had dozens at once —
  // and the same number that makes cycle time meaningless would make attribution
  // wrong rather than merely coarse. It has an unambiguous answer inside one
  // session, because one session takes one task.
  //
  // BEST EFFORT, ALWAYS. A state directory that cannot be written must not turn
  // a successful claim into a failure: what is lost is one leg of the chain, and
  // the answer to that is an honest `unknown`, not a refused take.
  focusQuietly(root, { task: id, actor, origin: "session-state", ts }, { env: opts.env });

  // Taken by somebody other than the role the task asks for. NOT a refusal: a
  // person naming a task outranks the field, and the gate belongs to the
  // dispatcher (TL-98). What it must not be is invisible — otherwise "was the
  // intended specialist the one who did this" has no answer afterwards, and the
  // field would be advice nobody can audit. Recorded ONLY when the caller
  // declared a role: with no declaration there is no mismatch to assert, and
  // guessing one from the actor name would invent the fact.
  const declaredRole = String(opts.role || "").trim();
  const wantedRole = String(before.role || "").trim();
  if (declaredRole && wantedRole && declaredRole !== wantedRole) {
    appendEntries(root, id, [{
      id: eventId(ts), ts, task: id, field: FIELD_ROLE_OVERRIDE,
      from: wantedRole, to: declaredRole,
      actor, source: opts.source || "take",
      reason: normalizeReason(opts.reason || ""),
      session: currentSession(root, opts.env),
    }]);
    warnings.push(
      "taken outside its role — the task asks for `" + wantedRole + "`, you declared `" +
        declaredRole + "` (recorded in the history)"
    );
  }

  return { ok: true, id, file, text, before, after, lock: lock.lock, reclaimed: reclaim ? before.owner : null, warnings };
}

/** The sentence a dispatched-after-unblocking take writes into the history when
 *  the caller gave none (TL-127). It states the EVIDENCE — which tasks closed —
 *  and not a verdict, for the same reason `reclaimReason` does: a reader a year
 *  from now can check the evidence and cannot check an opinion. */
export function unblockedReason(status, blockers) {
  return "left `" + status + "`: every task it named is closed (" +
    ((blockers || []).join(", ") || "none named") + ")";
}

/** The sentence a takeover writes into the history when the caller gave none.
 *  PURE, and exported so a test can assert the wording somebody will read a year
 *  from now rather than assert that a non-empty string was written. */
export function reclaimReason(owner, updated, afterDays) {
  return "reclaimed from " + (owner || "nobody") + ": no change since " +
    (updated || "an unrecorded date") + ", past abandoned_after_days " + afterDays;
}

// ──────────────────────────────────────────────────────────────────────────
// Output
// ──────────────────────────────────────────────────────────────────────────

/**
 * What a caller gets on stdout: the WHOLE task file after the summary.
 *
 * Not a row of fields. Whoever runs this command is about to do the work, and
 * the task was written for somebody with none of the conversation that produced
 * it — printing a title and making them open the file is asking them to do the
 * one step this command exists to remove.
 */
export function renderTake(result, root, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  // The shorter of the two: a relative path is easier to read for a tree under
  // the current directory, and turns into a ladder of `../..` for one that is not.
  const rel = relative(process.cwd(), result.file) || result.file;
  const shown = rel.length < result.file.length ? rel : result.file;
  for (const w of result.warnings || []) out.push(paint.warn(MARK.warn) + " " + w);
  if (result.alreadyOwned) {
    out.push(paint.ok(MARK.ok) + " " + result.message);
  } else {
    // The transition worth printing is the one that HAPPENED. An ordinary take
    // moves the status; a takeover of an abandoned claim moves the owner and
    // leaves the status where it was, and printing `in_progress → in_progress`
    // there would show the one field that did not change (TL-104).
    const [from, to] = result.reclaimed
      ? [result.reclaimed, result.after.owner]
      : [result.before.status, result.after.status];
    out.push(
      paint.ok(MARK.ok) + " " + paint.id(result.id) + " taken by " + result.after.owner +
        " — " + from + " " + MARK.arrow + " " + to
    );
  }
  out.push("  " + paint.dim(shown));
  out.push("");
  // The answers a person has already given, placed where the reader starts
  // (TL-148). Print time only: nothing of this reaches the file on disk.
  const entries = opts.entries || (root ? readHistory(root, result.id) : []);
  out.push(withDecisions(result.text, entries).replace(/\n+$/, ""));
  return out.join("\n");
}

/**
 * Rebuild the generated views after a claim.
 *
 * In the CLI layer and not inside `takeTask()` on purpose: the write is the
 * thing that must be atomic, and regenerating four files is not part of it. A
 * failure here is a WARNING — the task is taken either way, and the views are
 * computed, so they can be rebuilt by hand at any time (law 2).
 */
export function rebuildViews(root) {
  const build = spawnSync(process.execPath, [join(__dirname, "build-backlog.mjs"), "--dir", root], {
    encoding: "utf8",
  });
  return build.status === 0;
}

export function takeJson(result) {
  return {
    ok: true,
    taken: !result.alreadyOwned,
    id: result.id,
    file: result.file,
    task: result.after,
    // The status the take moved the task OUT of — what an undo has to put back
    // (TL-184). It cannot be read off `task`, which is the state AFTER the
    // write, and reconstructing it from the project's queue statuses is a guess
    // with several answers. `run` needs it for exactly one case: an agent that
    // never started, where nothing was measured and the claim is given back.
    // Equal to the in-progress status when the task was already the caller's,
    // which makes the undo the no-op it should be.
    from: (result.before && result.before.status) || null,
    text: result.text,
    warnings: result.warnings || [],
    // Who held it before, when this take was a takeover of an abandoned claim
    // (TL-104) — `null` otherwise. A loop that reclaims work has to be able to
    // report it without parsing the warning text.
    reclaimed: result.reclaimed || null,
    lock: result.lock || null,
  };
}

/**
 * A refusal, as the SAME kind with `ok: false` (TL-119).
 *
 * Shared with `next`, which refuses for the same reasons and must not answer in
 * a second shape. `refusalKind` and not `kind`: the envelope owns that word.
 */
export function refusalPayload(result, fallbackId) {
  return {
    ok: false,
    taken: false,
    id: result.id || fallbackId || null,
    refusalKind: result.kind,
    refusal: result.message,
    details: result.details || [],
  };
}

/** The exit code for a refusal. A usage error (you named a task that is not
 *  there) is 2, like every other bad invocation; a refusal about a task that
 *  exists is 1. `next` adds 3 for "nothing to do", which is neither. */
export function refusalCode(kind) {
  return kind === "not-found" ? 2 : 1;
}

export function run(argv) {
  let plan;
  try {
    plan = parseTakeArgs(argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " take", head, rest, [N + " take --help"]));
    return 2;
  }

  const actor = resolveActor(plan.actor);
  if (!isValidActor(actor)) {
    return fail2(
      "the actor `" + actor + "` has no valid namespace",
      [
        "Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | "),
        "The namespace says how much the attribution is worth — local: declared,",
        "agent: automated, user: an authenticated account. BL-1404.",
      ]
    );
  }

  let root;
  try {
    root = resolveBacklogDir({ dir: plan.dir || undefined, moduleDir: __dirname }).root;
  } catch (e) {
    return fail2(e.message, []);
  }
  const config = loadConfigOrExit(root);

  // A role outside the project's vocabulary is a bad ARGUMENT — wrong whatever
  // the task says — so it fails with the other usage errors, exactly like a
  // reserved reason. Accepting it would let a typo report a mismatch that never
  // existed, in the one record kept to answer whether it did.
  if (plan.role !== null && (config.roles || []).indexOf(plan.role) < 0) {
    return fail2(
      "unknown role `" + plan.role + "`",
      (config.roles || []).length
        ? ["`roles` in config.yaml holds: " + config.roles.join(", ")]
        : [
            "This backlog declares no `roles:` in config.yaml, so no task asks for one.",
            "Declare the vocabulary there before acting as a role.",
          ]
    );
  }

  const result = takeTask({ root, config, id: plan.id, actor, role: plan.role, reason: plan.reason });
  if (!result.ok) {
    if (plan.json) {
      printJson("task-take", refusalPayload(result, plan.id));
    } else {
      console.error(failure(N + " take", result.message, result.details || []));
    }
    return refusalCode(result.kind);
  }

  if (!result.alreadyOwned && !rebuildViews(root)) {
    console.error(warn("the views were not rebuilt — run `" + N + " build` yourself"));
  }
  if (plan.json) printJson("task-take", takeJson(result));
  else console.log(renderTake(result, root));
  return 0;
}

function fail2(problem, details) {
  console.error(failure(N + " take", problem, details, [N + " take --help"]));
  return 2;
}

if (process.argv[1] && process.argv[1].endsWith("take-task.mjs")) {
  process.exit(run(process.argv.slice(2)));
}
