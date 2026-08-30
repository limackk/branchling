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

import { stripComment, unquote } from "./task-fields.mjs";

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
 * THE SEVERITY SPLIT is the whole design. An order that puts a task BEFORE the
 * task it is blocked by is impossible to execute, so it is an error. A blocker
 * inside the SAME wave is only a warning: a wave is a batch, not a claim that
 * its members are mutually independent, and a sequence within one wave is a
 * normal way to plan. Treating that as an error would push people to split
 * waves for the tool's sake rather than for the work's.
 *
 * A CLOSED TASK IN THE PLAN IS NOT A DEFECT. The plan is a record of an order
 * that was decided, and the earlier waves are meant to be finished; deleting
 * them to stay green would erase the history the file exists to hold.
 *
 * @param {object} plan  as returned by `parsePlanYaml`
 * @param {Array<{id: string, status: string, blocked_by: string[]}>} tasks
 * @param {{archivedStatuses?: string[]}} config
 * @returns {{errors: string[], warnings: string[], planned: number, waves: number}}
 */
export function validatePlan(plan, tasks, config = {}) {
  const errors = [];
  const warnings = [];
  const archived = new Set(config.archivedStatuses || []);

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const waveOf = new Map();
  const waveName = (i) => `${i + 1} (${plan.waves[i].name || "unnamed"})`;

  let planned = 0;
  plan.waves.forEach((w, i) => {
    for (const id of w.tasks) {
      planned++;
      if (waveOf.has(id)) {
        errors.push(
          `${id} appears twice in the plan — wave ${waveName(waveOf.get(id))} and wave ${waveName(i)}`
        );
        continue;
      }
      waveOf.set(id, i);
      if (!byId.has(id)) {
        errors.push(`wave ${waveName(i)} names ${id} — there is no such task in this backlog`);
      }
    }
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
        } else if (j === i) {
          warnings.push(
            `${id} and its blocker ${blocker} share wave ${waveName(i)} — fine if the wave is ` +
              `meant to be worked in sequence, wrong if it is meant to be worked in parallel`
          );
        }
        continue;
      }
      if (!archived.has(byId.get(blocker).status)) {
        errors.push(
          `${id} is in wave ${waveName(i)} but is blocked by ${blocker}, which is still open and ` +
            `is not in the plan at all — nothing schedules the work this wave waits for`
        );
      }
    }
  }

  return { errors, warnings, planned, waves: plan.waves.length };
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
 *   next up      the open tasks of that wave whose every `blocked_by` is closed.
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
 * @param {object} plan  as returned by `parsePlanYaml` (null = no plan file)
 * @param {Array<{id: string, status: string, blocked_by: string[]}>} tasks
 * @param {{archivedStatuses?: string[], inProgressStatus?: string|null}} config
 */
export function planState(plan, tasks, config = {}) {
  const archived = new Set(config.archivedStatuses || []);
  const inProgressStatus = config.inProgressStatus || null;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const isOpen = (t) => !!t && !archived.has(t.status);

  const waveOf = new Map();
  const waves = ((plan && plan.waves) || []).map((w, i) => {
    const entries = w.tasks.map((id) => {
      if (!waveOf.has(id)) waveOf.set(id, i);
      const t = byId.get(id);
      return { id, status: t ? t.status : null, known: !!t, open: isOpen(t) };
    });
    return {
      index: i,
      name: w.name,
      tasks: entries,
      together: w.together.map((g) => g.slice()),
      open: entries.filter((e) => e.open).length,
      closed: entries.filter((e) => e.known && !e.open).length,
      active: false,
    };
  });

  const activeWave = waves.findIndex((w) => w.open > 0);
  if (activeWave >= 0) waves[activeWave].active = true;

  // An unknown blocker does not block: `check --refs` owns that defect, and
  // treating it as blocking here would hide every ready task behind a typo.
  const cleared = (t) =>
    (t.blocked_by || []).every((b) => !byId.has(b) || archived.has(byId.get(b).status));

  const nextUp = [];
  if (activeWave >= 0) {
    const w = waves[activeWave];
    const openIds = w.tasks.filter((e) => e.open).map((e) => e.id);
    const openSet = new Set(openIds);
    const groupOf = new Map();
    w.together.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
    const seen = new Set();
    for (const id of openIds) {
      if (seen.has(id)) continue;
      const gi = groupOf.get(id);
      if (gi === undefined) {
        seen.add(id);
        if (cleared(byId.get(id))) nextUp.push({ together: false, ids: [id] });
        continue;
      }
      const members = w.together[gi].filter((m) => openSet.has(m));
      for (const m of members) seen.add(m);
      if (members.every((m) => cleared(byId.get(m)))) nextUp.push({ together: true, ids: members });
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

  return {
    updated: (plan && plan.updated) || "",
    rationale: (plan && plan.rationale) || "",
    waves,
    activeWave: activeWave >= 0 ? activeWave : null,
    nextUp,
    inProgress,
    unplanned,
    stale,
    inProgressStatus,
  };
}
