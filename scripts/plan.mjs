#!/usr/bin/env node
/**
 * The execution plan (`plan.yaml`) — parser and consistency validation (TL-107).
 *
 * WHAT THE FILE IS. An ORDER of execution: which tasks come first, which are
 * worth doing together, and one sentence saying why. That is a decision somebody
 * made, and nothing in the tree can recompute it — so under law 1 of CLAUDE.md
 * it is DATA: it lives in the repository, travels with a branch and goes through
 * review. Only its VALIDATION is computed, and that is what this module is.
 *
 * WHY NOT A BOARD AND NOT A FIELD. A board partitions by "who / which context"
 * and is a closed vocabulary; order is a different axis and would overload it.
 * A `sequence:` number in the frontmatter is worse still: reshuffling the plan
 * would touch every task file at once — an unreadable diff that conflicts with
 * every open branch. One file, one diff, one review.
 *
 * WHY THE PLAN IS ADVISORY. `status:` remains the only truth about what has
 * happened. The plan blocks nothing; the single hard condition is that it must
 * not CONTRADICT `blocked_by`, because an order that puts a task before its own
 * blocker is not an opinion, it is a mistake. Any stronger rule would make the
 * plan a second source of truth about state, which is exactly the split this
 * backlog rejects external trackers for.
 *
 * ONE PARSER, like `parseBoardsYaml` in config.mjs. The viewer, the guard and
 * anything else that grows later read the plan through this module. Three
 * parsers of one shape is three chances to disagree about what the file says.
 *
 * Tests: `node --test scripts/tests/plan.test.mjs`
 */

import { existsSync, readFileSync } from "node:fs";

import { openQuestions, stripComment, unquote } from "./task-fields.mjs";
import { plural } from "./ui.mjs";

/** The only keys the file may carry. An unknown key FAILS — same rule as
 *  config.yaml: this is a fixed shape, so a new word is a typo, not a feature. */
const PLAN_KEYS = ["updated", "rationale", "waves"];
const WAVE_KEYS = ["name", "tasks", "together"];

/** `[A, B]` → ["A", "B"]. Returns null when the text is not an inline list. */
function inlineList(text) {
  const t = text.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  return t
    .slice(1, -1)
    .split(",")
    .map((s) => unquote(s.trim()))
    .filter(Boolean);
}

/** `[[A, B], [C, D]]` → [["A","B"], ["C","D"]]. Null when the shape is wrong. */
function inlineListOfLists(text) {
  const t = text.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  const groups = [];
  const re = /\[([^\]]*)\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(inner))) {
    groups.push(m[1].split(",").map((s) => unquote(s.trim())).filter(Boolean));
    consumed += m[0].length;
  }
  // Everything outside the brackets must be separators; `[A, [B, C]]` is a
  // shape error, not a group of one.
  const rest = inner.replace(re, "").replace(/[\s,]/g, "");
  if (!groups.length || rest.length || consumed === 0) return null;
  return groups;
}

/**
 * Parse `plan.yaml`.
 *
 * The accepted shape is deliberately exactly the one the format defines —
 * top-level `updated:`, `rationale:` and `waves:`, each wave a `- name:` block
 * with `tasks:` and optional `together:`. Lists may be inline (`[A, B]`) or a
 * block of `- ` items, because both forms already appear in this backlog's other
 * YAML and a reader should not have to remember which file allows which.
 *
 * @returns {{plan: {updated: string, rationale: string,
 *            waves: Array<{name: string, tasks: string[], together: string[][]}>},
 *           problems: string[]}}
 */
export function parsePlanYaml(text) {
  const lines = String(text || "").split(/\r?\n/).map(stripComment);
  const plan = { updated: "", rationale: "", waves: [] };
  const problems = [];

  let inWaves = false;
  let wave = null;
  // Which key of the current wave a block list belongs to; cleared by any new key.
  let pending = null;
  // The indentation of that key. A `- ` item belongs to it only when it is
  // indented at least as far — otherwise `- name:` opening the NEXT wave would
  // be swallowed as one more entry of the previous wave's list.
  let pendingIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    const where = `line ${i + 1}`;

    // A block-list item belonging to the key opened above.
    if (line.startsWith("- ") && pending && indent >= pendingIndent) {
      const value = line.slice(2).trim();
      if (pending === "tasks") {
        const one = unquote(value);
        if (one) wave.tasks.push(one);
        continue;
      }
      const group = inlineList(value);
      if (!group) {
        problems.push(`${where}: \`together\` takes groups of ids, e.g. \`- [TL-1, TL-2]\``);
        continue;
      }
      wave.together.push(group);
      continue;
    }

    if (indent === 0) {
      pending = null;
      const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
      if (!m) {
        problems.push(`${where}: cannot read \`${line}\` (expecting \`key: value\`)`);
        continue;
      }
      const [, key, value] = m;
      if (PLAN_KEYS.indexOf(key) < 0) {
        problems.push(`${where}: unknown key \`${key}\` (allowed: ${PLAN_KEYS.join(", ")})`);
        continue;
      }
      if (key === "waves") {
        // The waves follow as a block. Anything after the colon but `[]` was
        // silently dropped until TL-534, so `waves: [oops` read as a plan with
        // no waves — an answer indistinguishable from an empty plan.
        if (value && value !== "[]") {
          problems.push(`${where}: \`waves\` takes a block of \`- name:\` waves, or \`[]\` — not \`${value}\``);
        }
        inWaves = true;
        wave = null;
        continue;
      }
      inWaves = false;
      wave = null;
      plan[key] = unquote(value);
      continue;
    }

    // Indented from here down: only inside `waves:` does that mean anything.
    if (!inWaves) {
      problems.push(`${where}: indented \`${line}\` outside \`waves:\``);
      continue;
    }

    if (line.startsWith("- ")) {
      // A new wave. Its first key sits on the dash line, as in boards.yaml.
      wave = { name: "", tasks: [], together: [] };
      plan.waves.push(wave);
      pending = null;
      const head = line.slice(2).trim();
      const m = head.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
      if (!m) {
        problems.push(`${where}: a wave starts with \`- name: "…"\`, not \`${head}\``);
        continue;
      }
      lines[i] = " ".repeat(indent + 2) + head;
      i--; // re-read the key line below, now that the wave exists
      continue;
    }

    if (!wave) {
      problems.push(`${where}: \`${line}\` before the first wave (a wave starts with \`- name:\`)`);
      continue;
    }

    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) {
      problems.push(`${where}: cannot read \`${line}\` (expecting \`key: value\`)`);
      continue;
    }
    const [, key, value] = m;
    if (WAVE_KEYS.indexOf(key) < 0) {
      problems.push(`${where}: unknown key \`${key}\` in a wave (allowed: ${WAVE_KEYS.join(", ")})`);
      continue;
    }
    pending = null;
    if (key === "name") {
      wave.name = unquote(value);
      continue;
    }
    if (!value) {
      // The list follows as a block of `- ` items.
      pending = key;
      pendingIndent = indent;
      continue;
    }
    if (key === "tasks") {
      const list = inlineList(value);
      if (!list) {
        problems.push(`${where}: \`tasks\` takes a list of ids, e.g. \`[TL-1, TL-2]\``);
        continue;
      }
      wave.tasks.push(...list);
      continue;
    }
    const groups = inlineListOfLists(value);
    if (!groups) {
      problems.push(`${where}: \`together\` takes groups of ids, e.g. \`[[TL-1, TL-2]]\``);
      continue;
    }
    wave.together.push(...groups);
  }

  for (const w of plan.waves) {
    if (!w.name) problems.push("a wave with no `name` — the name is how the plan is read aloud");
  }

  return { plan, problems };
}

/** Read the plan from disk. `{ exists: false }` when there is no file — the
 *  feature is optional, and its absence is not a defect. */
export function loadPlan(planPath, read = readFileSync, exists = existsSync) {
  if (!exists(planPath)) return { exists: false, plan: null, problems: [] };
  const { plan, problems } = parsePlanYaml(read(planPath, "utf8"));
  return { exists: true, plan, problems };
}

/**
 * Does the plan agree with the tree?
 *
 * THE AUTHORED ORDER is the whole design. An order that puts a task BEFORE the
 * task it is blocked by is impossible to execute, so it is an error whether
 * the two tasks occupy different waves or the same one. Within one wave the
 * sequence binds the dispatcher (TL-257): a blocker before its dependent
 * already settles the dependency and is clean; the reverse order contradicts
 * it. A `together` group does not suspend `blocked_by` or erase that sequence.
 *
 * A CLOSED TASK IN THE PLAN IS NOT A DEFECT. The plan is a record of an order
 * that was decided, and the earlier waves are meant to be finished; deleting
 * them to stay green would erase the history the file exists to hold.
 *
 * @param {object} plan  as returned by `parsePlanYaml`
 * @param {Array<{id: string, status: string, blocked_by: string[]}>} tasks
 * @param {{archivedStatuses?: string[]}} config
 * @returns {{errors: string[], blockedBy: string[], warnings: string[], planned: number, waves: number}}
 */
export function validatePlan(plan, tasks, config = {}) {
  const errors = [];
  // The subset of `errors` that contradicts `blocked_by` (TL-534): `plan
  // --json` names that refusal apart from a plan naming the wrong tasks.
  const blockedBy = [];
  const warnings = [];
  const archived = new Set(config.archivedStatuses || []);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waveOf = new Map();
  const positionInWave = new Map();
  const waveName = (i) => `${i + 1} (${plan.waves[i].name || "unnamed"})`;

  let planned = 0;
  plan.waves.forEach((w, i) => {
    w.tasks.forEach((id, position) => {
      planned++;
      if (waveOf.has(id)) {
        errors.push(
          `${id} appears twice in the plan — wave ${waveName(waveOf.get(id))} and wave ${waveName(i)}`
        );
        return;
      }
      waveOf.set(id, i);
      positionInWave.set(id, position);
      if (!byId.has(id)) {
        errors.push(`wave ${waveName(i)} names ${id} — there is no such task in this backlog`);
      }
    });
  });

  plan.waves.forEach((w, i) => {
    for (const group of w.together) {
      for (const id of group) {
        if (!waveOf.has(id)) {
          errors.push(
            `\`together\` in wave ${waveName(i)} names ${id}, which the plan does not schedule at all`
          );
          continue;
        }
        if (waveOf.get(id) !== i) {
          errors.push(
            `\`together\` in wave ${waveName(i)} names ${id}, which is scheduled in wave ` +
              `${waveName(waveOf.get(id))} — a group is done in ONE wave or it is not a group`
          );
        }
      }
    }
  });

  for (const [id, i] of waveOf) {
    const task = byId.get(id);
    if (!task) continue;                       // already reported as unknown
    for (const blocker of task.blocked_by) {
      if (!byId.has(blocker)) continue;        // check-backlog-refs.mjs owns that defect
      if (waveOf.has(blocker)) {
        const j = waveOf.get(blocker);
        if (j > i) {
          errors.push(
            `${id} is in wave ${waveName(i)} but is blocked by ${blocker}, which the plan puts in ` +
              `wave ${waveName(j)} — the order cannot be executed`
          );
          blockedBy.push(errors[errors.length - 1]);
        } else if (j === i && positionInWave.get(id) < positionInWave.get(blocker)) {
          errors.push(
            `${id} appears before its blocker ${blocker} inside wave ${waveName(i)} — ` +
              `the authored order cannot be executed`
          );
          blockedBy.push(errors[errors.length - 1]);
        }
        continue;
      }
      if (!archived.has(byId.get(blocker).status)) {
        errors.push(
          `${id} is in wave ${waveName(i)} but is blocked by ${blocker}, which is still open and ` +
            `is not in the plan at all — nothing schedules the work this wave waits for`
        );
        blockedBy.push(errors[errors.length - 1]);
      }
    }
  }

  return { errors, blockedBy, warnings, planned, waves: plan.waves.length };
}

const HOLD_DAY_MS = 86400000;
const holdDayOf = (s) => String(s || "").slice(0, 10);

/**
 * Why NO UNATTENDED RUN will take this open task, or null when one may (TL-645).
 * PURE.
 *
 * WHAT WAS MEASURED. On 2026-11-07 the active wave's only open task sat in
 * `awaiting_vouch`. `plan` printed it as "next up", `run --dry-run --plan`
 * answered "0 tasks would run" and stopped at that wave, and thirty-six
 * pending tasks behind it were unreachable. Another wave's only task was a
 * claim `audit` already called parked, printed as plain "in progress". A
 * stalled plan read exactly like a plan with work in it.
 *
 * ONE PREDICATE, BOTH READERS. `planState` decorates every open task with this
 * answer, `plan` prints it, and the run's projection names the same holds where
 * it stops (`projectionWall`). The rules are the dispatcher's own, stated in
 * `next-task.mjs` (`queueStatuses`, `isUnblocked`, `parkedByRun`,
 * `isAbandoned`, `servesExecutor`, `isOverSized`) and `audit.mjs` (`parked`),
 * and restated here rather than imported because this module is pasted into
 * the viewer page, which can reach nothing but `task-fields.mjs`.
 * `scripts/tests/plan-held-wave.test.mjs` holds the two sides together.
 *
 * THE KINDS, and whether a PERSON asking `next` may still be handed the task
 * (`startable`) — which decides whether it stays in `next up`:
 *
 *   open-question     a question `ask` recorded and nobody has decided,
 *                     WHATEVER THE STATUS (TL-666). `isExecutable` refuses
 *                     it before it reads a status, so a claim old enough to
 *                     reclaim, or a `pending` task whose status a person set
 *                     back by hand, is held exactly as a protected one is.
 *                                                                  no
 *   awaiting-vouch    the project's `awaiting_vouch_status`. The work is
 *                     finished and a person has to vouch for it.   no
 *   protected-status  a status `reason_required_statuses` protects, not
 *                     discharged: nothing named in `blocked_by`, a blocker
 *                     still open, or a run parked it there.        no
 *   parked-claim      in progress with no recorded change for more than
 *                     `audit_stale_days` — what `audit` reports as parked.
 *                                                                  no
 *   claimed           in progress, and not yet parked or abandoned. no
 *   person-only       `executor: human`.                           yes
 *   over-size         an estimate above `max_unattended_estimate`. yes
 *
 * A CLAIM PAST `abandoned_after_days` IS NOT A STATUS HOLD: `next` reclaims
 * it, unless a question is open on it. Neither is a protected status its
 * named blockers discharged. Both still meet the person-only and over-size
 * gates, which the dispatcher applies to every record before it reads a
 * status. A task waiting on a blocker is not a hold either — the run closes
 * the blocker first, which is the rule `projectionWall` states.
 *
 * WITHOUT `config.now` NOTHING IS AGED: a claim is then `claimed`, never
 * parked and never abandoned, because no date is not an old date.
 *
 * @param {object} task a task record (`history` attached, when it is known)
 * @param {Map<string, object>} byId every record, keyed by the UPPERCASED id
 * @param {object} config the loaded configuration, plus `now` in milliseconds
 * @returns {object|null} `{kind, startable, ...}` or null
 */
export function unattendedHold(task, byId, config = {}) {
  if (!task) return null;
  const archived = new Set(config.archivedStatuses || []);
  if (archived.has(task.status)) return null;
  // The dispatcher drops a person-only or over-size record BEFORE it looks at
  // any status (`selectCandidates`), so a status that releases the task — a
  // claim old enough to reclaim, a block its blockers discharged — releases
  // it to those two gates, not past them.
  return statusHold(task, byId, config, archived) || recordHold(task, config);
}

/** The holds a task's STATUS imposes, or null. PURE; see `unattendedHold`. */
function statusHold(task, byId, config, archived) {
  const status = task.status;
  const now = Number.isFinite(config.now) ? config.now : null;
  const history = task.history || [];

  // Before any status: `isExecutable` refuses an open question first, so no
  // status — not a reclaimable claim, not `pending` — releases the task.
  const questions = openQuestions(history);
  if (questions.length) {
    const first = questions[0];
    return {
      kind: "open-question", startable: false, status,
      question: String(first.to || ""), askedBy: String(first.actor || ""), event: String(first.id || ""),
      more: questions.length - 1,
    };
  }

  if (config.awaitingVouchStatus && status === config.awaitingVouchStatus) {
    return { kind: "awaiting-vouch", startable: false, status };
  }

  if (config.inProgressStatus && status === config.inProgressStatus) {
    const updated = holdDayOf(task.updated);
    const owner = String(task.owner || "").trim();
    const abandonDays = Number(config.abandonedAfterDays || 0);
    if (now !== null && abandonDays > 0 && /^\d{4}-\d{2}-\d{2}$/.test(updated)) {
      const at = Date.parse(updated + "T00:00:00Z");
      // Reclaimable: `next` hands it out again, so the status holds nothing.
      if (Number.isFinite(at) && now - at >= abandonDays * HOLD_DAY_MS) return null;
    }
    // The last recorded change, as `audit` reads it: the later of `updated:`
    // and every history entry's day.
    const last = history.reduce((acc, e) => {
      const d = holdDayOf(e && e.ts);
      return d > acc ? d : acc;
    }, updated);
    const staleDays = config.auditStaleDays == null ? NaN : Number(config.auditStaleDays);
    if (now !== null && last && Number.isFinite(staleDays)) {
      const today = holdDayOf(new Date(now).toISOString());
      const cutoff = holdDayOf(new Date(Date.parse(today) - staleDays * HOLD_DAY_MS).toISOString());
      if (last < cutoff) {
        const days = Math.round((Date.parse(today) - Date.parse(last)) / HOLD_DAY_MS);
        return { kind: "parked-claim", startable: false, status, owner, lastChange: last, days, staleDays };
      }
    }
    return { kind: "claimed", startable: false, status, owner, lastChange: last || null };
  }

  if ((config.reasonRequiredStatuses || []).indexOf(status) >= 0) {
    const named = (task.blocked_by || []).map((b) => String(b).toUpperCase());
    // An unknown blocker is unresolved, as `isExecutable` reads it.
    const open = named.filter((b) => {
      const blocker = byId.get(b);
      return !blocker || !archived.has(blocker.status);
    });
    const into = history.filter((e) => e && e.field === "status" && e.to === status).pop();
    const parkedByRun = !!(into && into.park === true);
    if (named.length && !open.length && !parkedByRun) return null;
    return { kind: "protected-status", startable: false, status, blockedBy: open, named: named.length, parkedByRun };
  }
  return null;
}

/** The holds the RECORD imposes whatever its status, or null. PURE. */
function recordHold(task, config) {
  if (String(task.executor || "").trim() === "human") {
    return { kind: "person-only", startable: true, executor: "human" };
  }

  const bar = String(config.maxUnattendedEstimate || "").trim();
  if (bar) {
    const order = config.estimates || [];
    const limit = order.indexOf(bar);
    const estimate = String(task.estimate || "").trim();
    const at = order.indexOf(estimate);
    if (limit >= 0 && at >= 0 && at > limit) {
      return { kind: "over-size", startable: true, estimate, limit: bar };
    }
  }
  return null;
}

/**
 * One sentence for a hold, the same in `plan` and in the run's projection.
 * PURE. The words name the configuration key behind each rule, so a reader who
 * disagrees with a hold knows where it was decided.
 */
export function describeHold(hold) {
  if (!hold) return "";
  switch (hold.kind) {
    case "awaiting-vouch":
      return "awaiting a person's vouch (status `" + hold.status + "`)";
    case "open-question":
      // The asker and the event id are what `decide --resolves` needs; the
      // words are the question, so a reader knows what is being waited on.
      return "an open question is waiting for a decision (" + hold.askedBy + ", `" + hold.event + "`): " +
        hold.question.replace(/\s+/g, " ").trim() +
        (hold.more > 0 ? " — and " + hold.more + " more" : "");
    case "protected-status": {
      const why = hold.parkedByRun
        ? "a run parked it there"
        : hold.blockedBy.length
          ? "waiting on " + hold.blockedBy.join(", ")
          : "nothing is named in `blocked_by`";
      return "in `" + hold.status + "`, a status `reason_required_statuses` protects — " + why;
    }
    case "parked-claim":
      return "claim parked for " + hold.days + " " + plural(hold.days, "day", "days") + " by " + (hold.owner || "nobody") +
        " — no recorded change since " + hold.lastChange + " (`audit_stale_days` is " + hold.staleDays + ")";
    case "claimed":
      return "claimed by " + (hold.owner || "nobody") + " — work in flight" +
        (hold.lastChange ? ", last change " + hold.lastChange : "");
    case "person-only":
      return "asks for an executor an unattended run is not (human)";
    case "over-size":
      return "estimate " + hold.estimate + " is above `max_unattended_estimate` (" + hold.limit + ")";
    default:
      return hold.kind;
  }
}

/**
 * What the plan looks like AGAINST THE TREE right now (TL-108).
 *
 * WHY THE ARITHMETIC IS HERE AND NOT IN THE COMMAND. `plan` in the terminal and
 * the plan the viewer draws (TL-109) have to agree about what "active wave" and
 * "next up" mean. Two implementations of those five definitions is two chances
 * to disagree, and the disagreement would surface as an agent starting the wrong
 * task while the page shows a different one. One function, both readers.
 *
 * IT IS COMPUTED FROM THE TASK FILES the caller hands in, never from a generated
 * view: a view is a snapshot of the last build, and a plan read out of a
 * snapshot describes a backlog that may have moved an hour ago.
 *
 * THE FIVE DEFINITIONS, stated once:
 *
 *   active wave  the FIRST wave holding an open task. Earlier waves are
 *                finished; the plan is read from the front.
 *   next up      the open tasks of that wave whose every `blocked_by` is closed,
 *                less those `next` hands out to nobody (`unattendedHold`, a
 *                hold that is not `startable`: an open question, a vouch, a
 *                protected status, a claim). Since TL-645 it never names what
 *                `next --plan` will not.
 *                A `together` group is one entry and is ready only when ALL of
 *                its open members are — the group exists to say "these are done
 *                as one act", and half a group is not that act.
 *   in progress  plan tasks carrying the project's in-progress status, in ANY
 *                wave. Work that ran ahead of the order is still work in flight.
 *   unplanned    OPEN tasks the plan does not schedule at all. Reported with
 *                their ids and never as a bare number: a plan rots quietly, and
 *                the rot is exactly the tasks nobody put in it.
 *   stale        plan tasks already closed in a wave AFTER the active one — the
 *                signal that the order has been overtaken and wants reshuffling.
 *
 * A task named by the plan that does not exist in the tree is reported here as
 * `known: false` rather than skipped, but it is `validatePlan` that calls it an
 * error; this function describes, it does not judge.
 *
 * `executor:` IS REPORTED, NEVER APPLIED (TL-199). Each task entry carries the
 * field, each `next up` entry carries `executors` and `waitsOnHuman`, and each
 * wave carries `endsOnHuman` — whether an open task of it asks for a person, so
 * an unattended fleet cannot close the wave on its own. Nothing is reordered,
 * refused or hidden by any of it: `executor:` is a filter the DISPATCHER
 * applies, and a task waiting on a person is still part of the order somebody
 * decided. Without this a stalled wave and a busy one printed identical rows,
 * and the run's own report — which does say what it could not take — is gone
 * the moment the run is.
 *
 * `waitsOnHuman` is a JUDGEMENT and `executors` is the FACT beside it, so the
 * symmetric question (does a HUMAN reader want `executor: agent` marked too?)
 * can be answered later by a consumer without this function having pre-empted
 * it. A `together` group waits on a person if ANY of its members does — the
 * group is one act, and an act half of which needs a person needs a person.
 *
 * @param {object} plan  as returned by `parsePlanYaml` (null = no plan file)
 * @param {Array<{id: string, status: string, executor?: string, blocked_by: string[]}>} tasks
 * @param {{archivedStatuses?: string[], inProgressStatus?: string|null}} config
 */
export function planState(plan, tasks, config = {}) {
  const archived = new Set(config.archivedStatuses || []);
  const inProgressStatus = config.inProgressStatus || null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isOpen = (t) => !!t && !archived.has(t.status);
  // "human" is the value FIELD_SHAPES declares for `executor`, the same literal
  // `decision-panel.mjs` compares against. Empty means anybody, which is the
  // overwhelming majority of tasks and the reason the field is optional.
  const executorOf = (t) => String((t && t.executor) || "").trim();
  // The hold is asked against the dispatcher's own reading of the tree, whose
  // ids are uppercased (TL-645).
  const byUpper = new Map(tasks.map((t) => [String(t.id).toUpperCase(), t]));
  const holdOf = (t) => (isOpen(t) ? unattendedHold(t, byUpper, config) : null);

  const waveOf = new Map();
  const waves = ((plan && plan.waves) || []).map((w, i) => {
    const entries = w.tasks.map((id) => {
      if (!waveOf.has(id)) waveOf.set(id, i);
      const t = byId.get(id);
      // `title` and `blocked_by` (TL-534) so a consumer draws the wave without
      // a second call; `tasks` holds closed task files too, so a finished
      // wave keeps its titles.
      return {
        id, title: t ? t.title : null, status: t ? t.status : null, blocked_by: t ? (t.blocked_by || []).slice() : [],
        known: !!t, open: isOpen(t), executor: executorOf(t), hold: holdOf(t),
      };
    });
    const openEntries = entries.filter((e) => e.open);
    return {
      index: i,
      name: w.name,
      tasks: entries,
      together: w.together.map((g) => g.slice()),
      open: entries.filter((e) => e.open).length,
      closed: entries.filter((e) => e.known && !e.open).length,
      // A CLOSED task that asked for a person no longer stops anybody, so only
      // the open ones count: a wave finished by a person yesterday is finished.
      endsOnHuman: entries.some((e) => e.open && e.executor === "human"),
      // Every open task of the wave carries a hold, so no unattended run can
      // finish it and the run's projection stops here (TL-645).
      held: openEntries.length > 0 && openEntries.every((e) => e.hold),
      active: false,
    };
  });

  const activeWave = waves.findIndex((w) => w.open > 0);
  if (activeWave >= 0) waves[activeWave].active = true;

  // An unknown blocker does not block: `check --refs` owns that defect, and
  // treating it as blocking here would hide every ready task behind a typo.
  // An open question needs no test here: it is an `open-question` hold, which
  // keeps the task out of `openIds` below (TL-666).
  const cleared = (t) =>
    (t.blocked_by || []).every((b) => !byId.has(b) || archived.has(byId.get(b).status));

  const nextUp = [];
  if (activeWave >= 0) {
    const w = waves[activeWave];
    // A task `next` hands out to NOBODY is not next up, whoever reads the plan
    // (TL-645): a question, a vouch, a protected status, a claim. A
    // person-only or over-size task stays — a person asking is handed it —
    // and is marked.
    const openIds = w.tasks.filter((e) => e.open && !(e.hold && !e.hold.startable)).map((e) => e.id);
    const openSet = new Set(openIds);
    const groupOf = new Map();
    w.together.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
    const seen = new Set();
    // The order of `nextUp` is the plan's, and marking an entry must not change
    // it: this only decorates the entry that was going to be pushed anyway.
    const entry = (together, ids) => {
      const executors = [...new Set(ids.map((id) => executorOf(byId.get(id))).filter(Boolean))].sort();
      return { together, ids, executors, waitsOnHuman: executors.includes("human") };
    };
    for (const id of openIds) {
      if (seen.has(id)) continue;
      const gi = groupOf.get(id);
      if (gi === undefined) {
        seen.add(id);
        if (cleared(byId.get(id))) nextUp.push(entry(false, [id]));
        continue;
      }
      const members = w.together[gi].filter((m) => openSet.has(m));
      for (const m of members) seen.add(m);
      if (members.every((m) => cleared(byId.get(m)))) nextUp.push(entry(true, members));
    }
  }

  const inProgress = [];
  const stale = [];
  for (const [id, i] of waveOf) {
    const t = byId.get(id);
    if (!t) continue;
    if (inProgressStatus && t.status === inProgressStatus) {
      inProgress.push({ id, wave: i, status: t.status });
    }
    if (activeWave >= 0 && i > activeWave && !isOpen(t)) {
      stale.push({ id, wave: i, status: t.status });
    }
  }

  const unplanned = tasks
    .filter((t) => isOpen(t) && !waveOf.has(t.id))
    .map((t) => ({ id: t.id, status: t.status }));
  const open = tasks.filter(isOpen).length;
  const planned = open - unplanned.length;
  const coverage = {
    open,
    planned,
    unplanned: unplanned.length,
    share: open ? Math.round((unplanned.length / open) * 100) : 0,
  };

  return {
    updated: (plan && plan.updated) || "",
    rationale: (plan && plan.rationale) || "",
    waves,
    activeWave: activeWave >= 0 ? activeWave : null,
    nextUp,
    inProgress,
    unplanned,
    coverage,
    stale,
    inProgressStatus,
  };
}

/**
 * The wave a dispatcher may hand work out of (TL-183). PURE.
 *
 * ONE DEFINITION OF "ACTIVE WAVE", NOT TWO. `planState` already answers it for
 * the `plan` command and for the viewer, and a dispatcher that computed its own
 * would put an agent on a different wave than the page somebody is watching —
 * the exact disagreement that function's header exists to prevent. So this is a
 * projection of that answer, not a second reading of the file.
 *
 * A PLAN WHOSE EVERY TASK IS CLOSED RETURNS NULL, and the caller has to say
 * "nothing to take" rather than fall through to the work the plan does not
 * schedule. The plan is advisory about ORDER, but a caller that asked for it
 * asked for that order; widening the answer would be answering a different
 * question, and quietly at that.
 *
 * @returns {{index: number, name: string, ids: string[], open: number}|null}
 */
export function dispatchWave(plan, tasks, config = {}) {
  const state = planState(plan, tasks, config);
  if (state.activeWave === null) return null;
  const w = state.waves[state.activeWave];
  return { index: w.index, name: w.name, ids: w.tasks.map((e) => e.id), open: w.open };
}

/**
 * The wave `next --plan --spill` may draw from when the active one is waiting
 * on other trees (TL-683). PURE.
 *
 * The first wave AFTER the active one that still holds an open task, in the
 * shape `dispatchWave` returns, or null when there is none. It reads the same
 * `planState`, so "active" means here what it means to `plan` and to the
 * dispatcher. Whether the active wave is waiting is the caller's judgement; this
 * only names where the spill would go.
 *
 * @returns {{index: number, name: string, ids: string[], open: number}|null}
 */
export function spillWave(plan, tasks, config = {}) {
  const state = planState(plan, tasks, config);
  // No active wave means every wave is closed, so the search finds nothing.
  const w = state.waves.find((x) => x.index > state.activeWave && x.open > 0);
  if (!w) return null;
  return { index: w.index, name: w.name, ids: w.tasks.map((e) => e.id), open: w.open };
}

/**
 * EVERY ID THE PLAN SCHEDULES, IN ANY WAVE. PURE (TL-219).
 *
 * `dispatchWave` above answers "which wave may be handed out of now", and a
 * caller that counts what it stepped over needs the other question too: whether
 * a task the plan does not hand out today is scheduled in a LATER wave or is
 * scheduled nowhere at all. Those are two quantities, and `next --plan` was
 * reporting the larger of them under the name of the smaller — 34 against
 * `plan`'s 16 in this repository on 2026-09-03.
 *
 * The ids are UPPERCASED, because the dispatcher compares them against task
 * records exactly as it compares `filters.planIds`; a plan is written by hand
 * and its case is not guaranteed to match the tree's.
 *
 * It does NOT take the tasks: membership of a wave is a property of the plan
 * alone. Whether a task is OPEN is not, which is why the counting belongs to
 * the caller holding the records.
 *
 * @param {object|null} plan a parsed plan, as `parsePlanYaml` returns it
 * @returns {Set<string>} every scheduled id, uppercased; empty for no plan
 */
export function scheduledIds(plan) {
  const ids = new Set();
  for (const w of (plan && plan.waves) || []) {
    for (const id of w.tasks || []) ids.add(String(id).toUpperCase());
  }
  return ids;
}

/**
 * Where a projection of the plan has to STOP, named. PURE (TL-206).
 *
 * `dispatchWave` above is the single definition of what may be handed out, and
 * it never moves on while the wave it named still holds open work. A projection
 * that walks the waves is therefore only entitled to reach the next one if this
 * run would CLOSE the current one: a wave left open is a wave the run is still
 * standing in when it stops. Measured on 2026-09-03 — `--dry-run` listed the
 * tasks of later waves while the run took none of them, and neither output said
 * the other existed. Asked and answered the same day (`backlog/history`,
 * decision 01M1M8CN8WSWKYG2T7J01YVKSR): the fleet does NOT run ahead, and the
 * projection names the wave it stopped at instead of skipping past it.
 *
 * A TASK ONLY ITS OWN WAVE IS BLOCKING IS NOT A WALL. `validatePlan` refuses a
 * plan whose blocker sits in a LATER wave, so an open blocker met inside a wave
 * is work this run is about to close — the wave grows as the run walks it. The
 * caller counts those as reachable; a wall is work this run may never be handed
 * at all, which is what a person's task and a claim in another tree are.
 *
 * THE WALL NAMES ITS HOLDS (TL-645): every open task of the wave that
 * `unattendedHold` says no unattended run will take, with the sentence `plan`
 * prints for it, so the projection and `plan` give one reason in one wording.
 * `held` says the wave is held shut by those alone; when it is false, the rest
 * of `left` is this run's own filter (a role, a conflict group, a handback).
 *
 * @param {object} wave one entry of `planState().waves`
 * @param {number} reachable how many of that wave's open tasks this run would take
 * @returns {{wave: number, name: string, open: number, reachable: number, left: number,
 *            held: boolean, holds: Array<{id: string, kind: string, reason: string}>}|null}
 *          the wall, in the terms a report needs, or null when the wave is finishable
 */
export function projectionWall(wave, reachable) {
  const left = wave.open - reachable;
  if (left <= 0) return null;
  const holds = (wave.tasks || []).filter((e) => e.open && e.hold)
    .map((e) => ({ id: e.id, kind: e.hold.kind, reason: describeHold(e.hold) }));
  return { wave: wave.index + 1, name: wave.name || "", open: wave.open, reachable, left, held: !!wave.held, holds };
}

/**
 * Read the plan for a caller that REQUIRES one — `next --plan`, `run --plan`.
 *
 * WHY THE ABSENCE OF A PLAN IS A USAGE ERROR AND NOT AN EMPTY FILTER. A filter
 * that matches everything reads exactly like a plan that schedules everything,
 * and the caller would watch a fleet work in priority order convinced it was
 * following an order somebody wrote. The same argument as an unknown `--role`:
 * silence about a filter that did not apply is the defect.
 *
 * A PLAN THAT DOES NOT PARSE IS THE SAME REFUSAL. Half a plan is not a weaker
 * plan, it is a different one — the waves after the unreadable line are missing,
 * so the order would be wrong in a way nothing downstream can notice.
 *
 * @returns {{plan: object}|{error: string, details: string[]}}
 */
export function loadPlanForDispatch(planPath, read = readFileSync, exists = existsSync) {
  const loaded = loadPlan(planPath, read, exists);
  if (!loaded.exists) {
    return {
      error: "`--plan` was given and there is no plan to follow",
      details: [
        "expected: " + planPath,
        "The flag restricts the queue to what the plan schedules, in wave order. With",
        "no file there is no order, and matching everything instead would look exactly",
        "like a plan that schedules everything.",
      ],
    };
  }
  if (loaded.problems.length) {
    return {
      error: "the plan cannot be read, so nothing can be dispatched from it",
      details: [planPath].concat(loaded.problems.map((p) => "  " + p)),
    };
  }
  return { plan: loaded.plan };
}
