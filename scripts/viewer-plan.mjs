/**
 * The Execution view of the viewer — the plan drawn as waves (TL-109).
 *
 * WHY A MODULE AND NOT A TEMPLATE STRING. Everything the page renders inside
 * `build-viewer.mjs` is unreachable from `node --test`: the strongest assertion
 * left would be a regular expression over the finished HTML, which passes just
 * as well for a function that returns the wrong answer. This file is inlined
 * into the page BY SOURCE (`readModuleSource`), so the browser and the test run
 * the same code — the same arrangement `viewer-url.mjs` and `task-fields.mjs`
 * already have.
 *
 * WHAT IS NOT HERE. The arithmetic of the plan — active wave, next up,
 * unplanned, stale — belongs to `planState()` in `plan.mjs` and is called by the
 * page, by the `plan` command and by the guard. TL-108 states the reason: two
 * implementations of those definitions would eventually disagree about which
 * task is next, and the disagreement would show up as an agent starting one task
 * while the page points at another.
 *
 * WHY THE EDGES CARRY NO COORDINATES. A `blocked_by` edge is drawn between two
 * cards whose positions only exist after the browser has laid the page out. The
 * model therefore states WHICH pairs are joined; `drawPlanEdges()` in the page
 * measures the cards and fills the geometry in. That keeps the part worth
 * testing — which dependency is a line and which is a badge — inside a test.
 *
 * NO IMPORTS. The page is not a module: every inlined file has to stand on its
 * own. What cannot be recomputed here (parsing an `estimate:`) arrives as a
 * function in `opts`.
 *
 * Tests: `node --test scripts/tests/viewer-plan.test.mjs`
 */

/** HTML escaping, local on purpose: see NO IMPORTS above. */
function planEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The same identifier shaping the palette uses, so a card can reach for the
 *  `badge-status-*` class the vocabulary already generated. */
function planIdent(v) {
  return String(v).replace(/[^A-Za-z0-9_-]/g, "-");
}

/**
 * When did this task enter the in-progress status?
 *
 * THE LAST ENTRY WINS, not the first: a task taken, handed off and taken again
 * is in flight since the LAST time it was taken, and counting from the first
 * would report an elapsed time nobody has been working.
 *
 * @param {Array<{ts: string, field: string, to: string}>} entries  history of ONE task
 * @param {string} inProgressStatus  the project's value, never a literal
 * @returns {number|null} epoch ms, or null when the history does not say
 */
export function enteredInProgressAt(entries, inProgressStatus) {
  if (!inProgressStatus || !Array.isArray(entries)) return null;
  let last = null;
  for (const e of entries) {
    if (!e || e.field !== "status" || e.to !== inProgressStatus) continue;
    const t = Date.parse(e.ts);
    if (!Number.isNaN(t)) last = t;
  }
  return last;
}

/** `45m`, `3h 10m`, `2d 4h` — a duration a person reads at a glance, not a
 *  number of seconds. Anything under a minute is `<1m`, because "0m" reads as
 *  "not started". */
export function durationLabel(ms) {
  if (!(ms > 0)) return "<1m";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return Math.max(minutes, 1) + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? hours + "h " + rest + "m" : hours + "h";
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? days + "d " + rest + "h" : days + "d";
}

/**
 * Everything a task transitively unblocks, following the plan's edges forward.
 *
 * PURE, and exported for the page: clicking a card lights up the chain that
 * waits on it, and "the chain" has to mean the same thing in the test and in the
 * browser. A cycle would be a defect in somebody's `blocked_by`, not in this
 * function, so the walk simply refuses to visit a node twice rather than
 * hanging.
 *
 * @param {Array<{from: string, to: string}>} edges  blocker → dependent
 * @returns {Set<string>} the ids downstream of `id`, NOT including `id` itself
 */
export function descendants(edges, id) {
  const next = new Map();
  for (const e of edges || []) {
    if (!next.has(e.from)) next.set(e.from, []);
    next.get(e.from).push(e.to);
  }
  const seen = new Set();
  const stack = [...(next.get(id) || [])];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const m of next.get(n) || []) stack.push(m);
  }
  seen.delete(id);
  return seen;
}

/**
 * The longest chain of OPEN work in the plan, weighted by the estimates.
 *
 * WHY WEIGHTED AND NOT COUNTED. A chain of five half-hour tasks is not the thing
 * that decides when the plan finishes; one week-long task with two short ones
 * behind it is. Counting cards would highlight the wrong chain and do it
 * confidently.
 *
 * WHY CLOSED TASKS ARE OUT. The critical path is a statement about what is still
 * ahead. A closed blocker holds nothing up, so a path drawn through it would be
 * reporting history as though it were work.
 *
 * THE TIE-BREAK IS TOTAL AND STATED, never "any of them". Two chains of equal
 * weight get compared by length, then by their ids; without that the highlight
 * would move from render to render for no reason a reader could see, which is
 * indistinguishable from the plan having changed.
 *
 * THE SUM SAYS HOW MUCH OF IT IT COULD NOT COUNT. `unknown` is the number of
 * tasks on the path with no parseable estimate — the same rule `sumHours()`
 * follows, and for the same reason: a total that hides them pretends to be
 * complete.
 *
 * @param {Array<object>} cards  every planned card, closed ones included
 * @param {Array<{from: string, to: string}>} edges
 * @param {{estimateHours: (e: string) => number|null}} opts
 * @returns {{ids: string[], hours: number, unknown: number}}
 */
export function criticalPath(cards, edges, opts = {}) {
  const estimateHours = opts.estimateHours || (() => null);
  const open = new Map();
  for (const c of cards || []) if (c && c.open && c.known) open.set(c.id, c);
  if (!open.size) return { ids: [], hours: 0, unknown: 0 };

  const next = new Map();
  for (const e of edges || []) {
    if (!open.has(e.from) || !open.has(e.to)) continue;
    if (!next.has(e.from)) next.set(e.from, []);
    next.get(e.from).push(e.to);
  }
  const weight = (id) => {
    const h = estimateHours(open.get(id).estimate);
    return h == null ? 0 : h;
  };
  const unknownAt = (id) => (estimateHours(open.get(id).estimate) == null ? 1 : 0);

  // hours desc, then length desc, then ids ascending — total, so the answer
  // cannot depend on the order the map happened to be built in.
  const better = (a, b) => {
    if (!b) return true;
    if (a.hours !== b.hours) return a.hours > b.hours;
    if (a.ids.length !== b.ids.length) return a.ids.length > b.ids.length;
    return a.ids.join(",") < b.ids.join(",");
  };

  const memo = new Map();
  const inStack = new Set();
  const from = (id) => {
    if (memo.has(id)) return memo.get(id);
    // A cycle is a defect in somebody's `blocked_by`; the walk stops rather than
    // hanging, and the node still contributes its own weight.
    if (inStack.has(id)) return { ids: [id], hours: weight(id), unknown: unknownAt(id) };
    inStack.add(id);
    let best = null;
    for (const n of (next.get(id) || []).slice().sort()) {
      const tail = from(n);
      const candidate = {
        ids: [id, ...tail.ids],
        hours: weight(id) + tail.hours,
        unknown: unknownAt(id) + tail.unknown,
      };
      if (better(candidate, best)) best = candidate;
    }
    if (!best) best = { ids: [id], hours: weight(id), unknown: unknownAt(id) };
    inStack.delete(id);
    memo.set(id, best);
    return best;
  };

  let best = null;
  for (const id of [...open.keys()].sort()) {
    const candidate = from(id);
    if (better(candidate, best)) best = candidate;
  }
  return { ids: best.ids, hours: Math.round(best.hours * 10) / 10, unknown: best.unknown };
}

/**
 * Which cards and which waves have MOVED since the last render.
 *
 * PURE, so the animation has something testable behind it. `previous` is what a
 * previous call returned; `null` means FIRST PAINT and produces no changes at
 * all — animating every card on load would announce a change that did not
 * happen, which is the one thing a change animation must never do.
 *
 * A card the previous render did not have is not a change either: it is a task
 * that has just been added to the plan, and it arrives rather than moves.
 *
 * @param {{statuses: Map<string,string>, closure: Map<number,boolean>}|null} previous
 * @param {object} vm  a view model from `planViewModel()`
 * @returns {{cards: string[], waves: number[], statuses: Map, closure: Map}}
 */
export function statusChanges(previous, vm) {
  const statuses = new Map();
  const closure = new Map();
  for (const w of (vm && vm.waves) || []) {
    closure.set(w.index, w.total > 0 && w.closed === w.total);
    for (const c of w.cards) statuses.set(c.id, c.status || "");
  }
  if (!previous) return { cards: [], waves: [], statuses, closure };

  const cards = [];
  for (const [id, status] of statuses) {
    if (previous.statuses.has(id) && previous.statuses.get(id) !== status) cards.push(id);
  }
  const waves = [];
  for (const [index, isClosed] of closure) {
    if (isClosed && previous.closure.get(index) === false) waves.push(index);
  }
  return { cards: cards.sort(), waves: waves.sort((a, b) => a - b), statuses, closure };
}

/**
 * The plan, the tree and the history folded into what the view draws.
 *
 * @param {object|null} state   the result of `planState()` (null = no plan file)
 * @param {Array<object>} tasks the tasks the page holds (titles, owners, estimates)
 * @param {object} opts
 *   - history:        { id: [entry] } as the page embeds it
 *   - now:            epoch ms, passed in so a test is not tied to the clock
 *   - estimateHours:  `estimate:` → hours, from `estimate.mjs`
 *   - archivedStatuses: the project's closed statuses — a blocker in one of them
 *     no longer waits for anything, and the card must not say that it does
 */
export function planViewModel(state, tasks, opts = {}) {
  const history = opts.history || {};
  const now = opts.now || Date.now();
  const estimateHours = opts.estimateHours || (() => null);
  if (!state) {
    return { exists: false, waves: [], edges: [], unplanned: [], unknown: [], critical: { ids: [], hours: 0, unknown: 0 } };
  }

  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const archived = opts.archivedStatuses || [];
  const inProgressStatus = state.inProgressStatus || null;

  // Which tasks the plan schedules at all — the split between an edge and a
  // badge below is exactly this set.
  const planned = new Set();
  for (const w of state.waves) for (const e of w.tasks) planned.add(e.id);

  const cardFor = (entry, groupIndex) => {
    const task = byId.get(entry.id) || null;
    const blockedBy = (task && task.blocked_by) || [];
    const openBlocker = (id) => {
      const b = byId.get(id);
      return !!b && archived.indexOf(b.status) < 0;
    };
    const card = {
      id: entry.id,
      known: entry.known,
      open: entry.open,
      status: entry.status || "",
      title: task ? task.title || "" : "",
      owner: task ? task.owner || "" : "",
      estimate: task ? task.estimate || "" : "",
      group: groupIndex,
      // A dependency the plan does NOT schedule cannot be drawn as a line to
      // anything — it becomes a badge, so the card still says it is waiting.
      waitingOn: blockedBy.filter((id) => !planned.has(id) && openBlocker(id)),
      inProgress: !!inProgressStatus && entry.status === inProgressStatus,
      elapsedMs: null,
      elapsedLabel: "",
      estimateLabel: "",
      pct: null,
    };
    if (card.inProgress) {
      const startedAt = enteredInProgressAt(history[entry.id], inProgressStatus);
      if (startedAt) {
        card.elapsedMs = Math.max(now - startedAt, 0);
        card.elapsedLabel = durationLabel(card.elapsedMs);
        const hours = estimateHours(card.estimate);
        if (hours > 0) {
          card.estimateLabel = card.estimate;
          // Capped at 1 for the BAR only; the label keeps telling the truth, so
          // an overrun reads as an overrun and not as a full bar.
          card.pct = Math.min(card.elapsedMs / (hours * 3600000), 1);
        }
      }
    }
    return card;
  };

  const waves = state.waves.map((w) => {
    const groupOf = new Map();
    w.together.forEach((g, gi) => g.forEach((id) => groupOf.set(id, gi)));
    const cards = w.tasks.map((e) => cardFor(e, groupOf.has(e.id) ? groupOf.get(e.id) : null));
    return {
      index: w.index,
      name: w.name,
      active: w.active,
      // Waves BEFORE the active one are finished; waves after it have not
      // started. The view dims them differently, so the model says which is which.
      past: state.activeWave !== null && w.index < state.activeWave,
      future: state.activeWave !== null && w.index > state.activeWave,
      closed: w.closed,
      total: w.tasks.length,
      groups: w.together.map((g) => g.slice()),
      cards,
    };
  });

  // An edge exists only between two cards the plan actually draws. Its direction
  // is blocker → dependent, i.e. the direction the work flows in.
  const edges = [];
  for (const w of waves) {
    for (const c of w.cards) {
      const task = byId.get(c.id);
      for (const b of (task && task.blocked_by) || []) {
        if (planned.has(b)) edges.push({ from: b, to: c.id });
      }
    }
  }

  // THE CRITICAL PATH IS COMPUTED HERE, over the cards and edges just built, so
  // the view and any test see the same chain. Marking the cards and edges rather
  // than handing the page a list keeps the render dumb.
  const allCards = waves.flatMap((w) => w.cards);
  const critical = criticalPath(allCards, edges, { estimateHours });
  const onPath = new Set(critical.ids);
  for (const c of allCards) c.critical = onPath.has(c.id);
  for (let i = 0; i < critical.ids.length - 1; i++) {
    const edge = edges.find((e) => e.from === critical.ids[i] && e.to === critical.ids[i + 1]);
    if (edge) edge.critical = true;
  }

  return {
    exists: true,
    critical,
    updated: state.updated || "",
    rationale: state.rationale || "",
    activeWave: state.activeWave,
    waves,
    edges,
    unknown: waves.flatMap((w) => w.cards.filter((c) => !c.known).map((c) => c.id)),
    unplanned: (state.unplanned || []).map((u) => {
      const t = byId.get(u.id);
      return { id: u.id, status: u.status, title: t ? t.title || "" : "" };
    }),
  };
}

function renderCard(card) {
  const cls = ["exec-card"];
  if (!card.known) cls.push("is-unknown");
  if (!card.open && card.known) cls.push("is-closed");
  if (card.inProgress) cls.push("is-running");
  if (card.critical) cls.push("is-critical");
  const bits = [];
  bits.push('<a class="exec-id" href="#' + planEsc(card.id) + '">' + planEsc(card.id) + "</a>");
  // The status is a colour AND a word (TL-52): colour is emphasis, never the
  // only carrier of the value.
  if (card.status) {
    bits.push(
      '<span class="badge badge-status-' + planIdent(card.status) + '">' + planEsc(card.status) + "</span>"
    );
  } else {
    bits.push('<span class="badge exec-missing">not in this backlog</span>');
  }
  const meta = [];
  // A WORD, not only a colour and a thicker border (TL-52). The critical path is
  // the one claim on this view a reader might act on, and a claim carried by
  // hue alone is invisible to a good share of the people reading it.
  if (card.critical) meta.push('<span class="exec-critical-tag">critical path</span>');
  if (card.owner && card.owner !== "unassigned") meta.push(planEsc(card.owner));
  if (card.estimate) meta.push(planEsc(card.estimate));
  for (const id of card.waitingOn) {
    meta.push('<span class="exec-waiting" title="Waiting on a task the plan does not schedule">⇠ ' + planEsc(id) + "</span>");
  }
  let bar = "";
  if (card.inProgress && card.elapsedLabel) {
    const width = card.pct === null ? 0 : Math.round(card.pct * 100);
    bar =
      '<div class="exec-bar" role="img" aria-label="Running ' + planEsc(card.elapsedLabel) +
      (card.estimateLabel ? " of " + planEsc(card.estimateLabel) : "") + '">' +
      '<div class="exec-bar-fill" style="width:' + width + '%"></div>' +
      '<span class="exec-bar-label">' + planEsc(card.elapsedLabel) +
      (card.estimateLabel ? " / " + planEsc(card.estimateLabel) : "") + "</span></div>";
  }
  return (
    '<article class="' + cls.join(" ") + '" data-plan-card="' + planEsc(card.id) + '">' +
    '<div class="exec-card-head">' + bits.join("") + "</div>" +
    '<div class="exec-title">' + planEsc(card.title) + "</div>" +
    (meta.length ? '<div class="exec-meta">' + meta.join(" · ") + "</div>" : "") +
    bar +
    "</article>"
  );
}

/** The cards of one wave, with `together` groups inside a shared frame. */
function renderWaveCards(wave) {
  const out = [];
  const done = new Set();
  for (const card of wave.cards) {
    if (done.has(card.id)) continue;
    if (card.group === null) {
      done.add(card.id);
      out.push(renderCard(card));
      continue;
    }
    const members = wave.cards.filter((c) => c.group === card.group);
    for (const m of members) done.add(m.id);
    out.push(
      '<div class="exec-group" data-plan-group="' + wave.index + "-" + card.group + '">' +
        '<span class="exec-group-label">done as one</span>' +
        members.map(renderCard).join("") +
      "</div>"
    );
  }
  return out.join("");
}

/**
 * What the tab shows when there is no `plan.yaml`.
 *
 * NOT AN ERROR SCREEN. Ordering is an optional decision (TL-107), so the empty
 * state says what would put something here — the rule for every empty state in
 * this page.
 */
export function renderPlanMissing(opts = {}) {
  const path = planEsc(opts.planPath || "backlog/plan.yaml");
  const example = planEsc(
    "updated: 2026-01-01\n" +
      "rationale: what this order is for, in one sentence\n" +
      "waves:\n" +
      "  - name: foundations\n" +
      "    tasks: [ID-1, ID-2]\n" +
      "    together: [[ID-1, ID-2]]\n"
  );
  return (
    '<div class="exec-empty">' +
    "<h2>No execution plan yet</h2>" +
    "<p>This view draws the order the work was decided to be done in. That order is a " +
    "decision somebody makes — nothing in the backlog can compute it — so it lives in " +
    "one file: <code>" + path + "</code>.</p>" +
    "<p>Create it with the shape below and this tab fills in. The plan is advisory: it " +
    "changes no task's status and blocks nothing.</p>" +
    "<pre>" + example + "</pre>" +
    "</div>"
  );
}

/**
 * The critical path, in words.
 *
 * `~` because the sum is built from estimates, and `+N unestimated` because a
 * total that quietly drops the tasks it could not count is a total nobody should
 * plan against.
 */
export function criticalLabel(critical) {
  if (!critical || !critical.ids.length) return "";
  // "1 tasks" is a programmer's note seen by a user — the same rule `plural()`
  // follows in the terminal reports.
  const n = critical.ids.length;
  const parts = ["critical path: ~" + critical.hours + "h", n + (n === 1 ? " task" : " tasks")];
  if (critical.unknown) parts.push(critical.unknown + " unestimated");
  return parts.join(" · ");
}

/** The whole Execution view. */
export function renderExecution(vm, opts = {}) {
  if (!vm || !vm.exists) return renderPlanMissing(opts);

  const critical = criticalLabel(vm.critical);
  const criticalTag = critical
    ? '<span class="exec-critical-sum" data-plan-critical="' + planEsc(String((vm.critical.ids || []).length)) +
      '">' + planEsc(critical) + "</span>"
    : "";
  // BESIDE THE NOW-LINE where there is one, and in the header where there is
  // not. The number is about what is still ahead, so it belongs next to the
  // marker for "here"; a plan with every wave closed has no such marker, and
  // dropping the label there would hide the answer instead of stating it.
  let sumPlaced = false;

  const waves = vm.waves
    .map((w) => {
      const cls = ["exec-wave"];
      if (w.active) cls.push("is-active");
      if (w.past) cls.push("is-past");
      if (w.future) cls.push("is-future");
      let nowLine = "";
      if (w.active) {
        nowLine = '<div class="exec-now" data-plan-now="1"><span>now</span>' + criticalTag + "</div>";
        sumPlaced = true;
      }
      return (
        nowLine +
        '<section class="' + cls.join(" ") + '" data-plan-wave="' + w.index + '">' +
        '<header class="exec-wave-head">' +
        '<span class="exec-wave-name">' + planEsc(w.name || "unnamed") + "</span>" +
        '<span class="exec-wave-count">' + w.closed + " / " + w.total + " done</span>" +
        (w.active ? '<span class="exec-wave-tag">active wave</span>' : "") +
        "</header>" +
        '<div class="exec-cards">' + renderWaveCards(w) + "</div>" +
        "</section>"
      );
    })
    .join("");

  // Empty `<path>`s: the pairs are decided here, the geometry after layout.
  const edges = vm.edges
    .map((e) => '<path data-edge-from="' + planEsc(e.from) + '" data-edge-to="' + planEsc(e.to) + '"' +
      (e.critical ? ' data-edge-critical="1" class="is-critical"' : "") + "></path>")
    .join("");

  const unplanned =
    '<section class="exec-unplanned" data-plan-unplanned="' + vm.unplanned.length + '">' +
    "<h3>Unplanned (" + vm.unplanned.length + ")</h3>" +
    (vm.unplanned.length
      ? "<p>Open tasks the plan does not schedule. A plan rots quietly, and this is where the rot shows.</p>" +
        '<div class="exec-chips">' +
        vm.unplanned
          .map(
            (u) =>
              '<a class="exec-chip" href="#' + planEsc(u.id) + '" data-plan-unplanned-id="' + planEsc(u.id) + '">' +
              '<span class="badge badge-status-' + planIdent(u.status) + '">' + planEsc(u.status) + "</span>" +
              planEsc(u.id) + " " + planEsc(u.title) +
              "</a>"
          )
          .join("") +
        "</div>"
      : "<p>Every open task is somewhere in the plan.</p>") +
    "</section>";

  return (
    '<div class="exec-head">' +
    "<h2>Execution</h2>" +
    (vm.updated ? '<span class="exec-updated">plan updated ' + planEsc(vm.updated) + "</span>" : "") +
    (vm.rationale ? '<p class="exec-rationale">' + planEsc(vm.rationale) + "</p>" : "") +
    (criticalTag && !sumPlaced ? '<p class="exec-critical-head">' + criticalTag + "</p>" : "") +
    "</div>" +
    '<div class="exec-flow">' +
    '<svg class="exec-edges" id="execEdges" aria-hidden="true">' + edges + "</svg>" +
    waves +
    "</div>" +
    unplanned
  );
}
