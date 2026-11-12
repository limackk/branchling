/**
 * The Execution view of the viewer (TL-109).
 *
 * WHAT IS BEING PROVED. That the plan reaches the page as waves, cards, edges
 * and an explicit list of what the plan does NOT cover — and that a backlog with
 * no plan gets an instruction rather than an error.
 *
 * WHY THE FIXTURE IS ITS OWN. Every value here — the statuses, the ids, the
 * estimate — is established by the fixture and never taken from this
 * repository's backlog. A test that asserted `TL-107 is in wave 1` would be
 * asserting a decision somebody may reverse tomorrow, and its failure would say
 * nothing about the code (the rule in CLAUDE.md).
 *
 * WHY THE HTML IS ASSERTED THROUGH DATA ATTRIBUTES and not through its text: the
 * text is wording and is meant to be edited. `data-plan-card`, `data-edge-from`
 * and `data-plan-unplanned` are the view's structure, which is what the page's
 * own JavaScript reads back when it measures the cards.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeHold, planState } from "../plan.mjs";
import { estimateHours } from "../estimate.mjs";
import {
  criticalLabel,
  criticalPath,
  descendants,
  durationLabel,
  enteredInProgressAt,
  pagePlanState,
  planViewModel,
  renderExecution,
  renderPlanMissing,
  statusChanges,
} from "../viewer-plan.mjs";

import { isolateHome, scriptSource } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("viewer-plan");

// A vocabulary of this fixture's own, deliberately not this project's.
const CONFIG = { archivedStatuses: ["shipped"], inProgressStatus: "running" };

const PLAN = {
  updated: "2026-01-01",
  rationale: "foundations first",
  waves: [
    { name: "foundations", tasks: ["FX-1", "FX-2"], together: [["FX-1", "FX-2"]] },
    { name: "surface", tasks: ["FX-3"], together: [] },
  ],
};

const TASKS = [
  { id: "FX-1", title: "the parser", status: "shipped", blocked_by: [], owner: "ann", estimate: "2h" },
  { id: "FX-2", title: "the guard", status: "running", blocked_by: ["FX-1"], owner: "bo", estimate: "4h" },
  { id: "FX-3", title: "the view", status: "queued", blocked_by: ["FX-2", "FX-9"], owner: "", estimate: "1d" },
  { id: "FX-9", title: "not in the plan", status: "queued", blocked_by: [], owner: "", estimate: "" },
];

const NOW = Date.parse("2026-01-02T12:00:00Z");
function model() {
  const state = planState(PLAN, TASKS, CONFIG);
  return planViewModel(state, TASKS, {
    history: { "FX-2": [{ ts: "2026-01-02T09:00:00Z", field: "status", to: "running" }] },
    now: NOW,
    estimateHours,
    archivedStatuses: CONFIG.archivedStatuses,
  });
}

test("the waves of the plan become the waves of the view, with their counts", () => {
  const vm = model();
  assert.equal(vm.exists, true);
  assert.equal(vm.waves.length, 2);
  assert.equal(vm.waves[0].name, "foundations");
  assert.equal(vm.waves[0].closed, 1);
  assert.equal(vm.waves[0].total, 2);
  // The active wave is the first one holding an open task — wave 0 here, because
  // FX-2 is still running. Wave 1 is therefore "future", not "past".
  assert.equal(vm.waves[0].active, true);
  assert.equal(vm.waves[1].future, true);
  assert.equal(vm.waves[1].past, false);
});

test("a blocker inside the plan is an edge; one outside it is a badge on the card", () => {
  const vm = model();
  assert.deepEqual(vm.edges.map((e) => [e.from, e.to]), [["FX-1", "FX-2"], ["FX-2", "FX-3"]]);
  const fx3 = vm.waves[1].cards[0];
  // FX-9 is open and unscheduled: nothing to draw a line to, so the card says it.
  assert.deepEqual(fx3.waitingOn, ["FX-9"]);
});

test("a task in progress carries elapsed time against its estimate", () => {
  const vm = model();
  const fx2 = vm.waves[0].cards.find((c) => c.id === "FX-2");
  assert.equal(fx2.inProgress, true);
  assert.equal(fx2.elapsedLabel, "3h");
  assert.equal(fx2.estimateLabel, "4h");
  assert.equal(Math.round(fx2.pct * 100), 75);
});

test("an in-progress task the history says nothing about shows no bar rather than a wrong one", () => {
  const state = planState(PLAN, TASKS, CONFIG);
  const vm = planViewModel(state, TASKS, { history: {}, now: NOW, estimateHours });
  const fx2 = vm.waves[0].cards.find((c) => c.id === "FX-2");
  assert.equal(fx2.inProgress, true);
  assert.equal(fx2.elapsedLabel, "");
  assert.equal(fx2.pct, null);
});

test("an overrun fills the bar but the label keeps telling the truth", () => {
  const state = planState(PLAN, TASKS, CONFIG);
  const vm = planViewModel(state, TASKS, {
    history: { "FX-2": [{ ts: "2026-01-01T00:00:00Z", field: "status", to: "running" }] },
    now: NOW,
    estimateHours,
  });
  const fx2 = vm.waves[0].cards.find((c) => c.id === "FX-2");
  assert.equal(fx2.pct, 1);
  assert.equal(fx2.elapsedLabel, "1d 12h");
});

test("the last entry into the in-progress status wins, not the first", () => {
  const at = enteredInProgressAt(
    [
      { ts: "2026-01-01T00:00:00Z", field: "status", to: "running" },
      { ts: "2026-01-01T06:00:00Z", field: "status", to: "queued" },
      { ts: "2026-01-02T06:00:00Z", field: "status", to: "running" },
      { ts: "2026-01-02T07:00:00Z", field: "owner", to: "running" },
    ],
    "running"
  );
  assert.equal(at, Date.parse("2026-01-02T06:00:00Z"));
});

test("durations read as a person reads them", () => {
  assert.equal(durationLabel(0), "<1m");
  assert.equal(durationLabel(45 * 60000), "45m");
  assert.equal(durationLabel(3 * 3600000 + 10 * 60000), "3h 10m");
  assert.equal(durationLabel(52 * 3600000), "2d 4h");
});

test("open tasks the plan does not schedule are listed, not counted away", () => {
  const vm = model();
  assert.deepEqual(vm.unplanned.map((u) => u.id), ["FX-9"]);
  const html = renderExecution(vm);
  assert.match(html, /data-plan-unplanned="1"/);
  assert.match(html, /data-plan-unplanned-id="FX-9"/);
});

test("the rendered view carries a card per planned task and a path per edge", () => {
  const html = renderExecution(model());
  for (const id of ["FX-1", "FX-2", "FX-3"]) {
    assert.match(html, new RegExp('data-plan-card="' + id + '"'));
  }
  assert.match(html, /data-edge-from="FX-1" data-edge-to="FX-2"/);
  assert.match(html, /data-edge-from="FX-2" data-edge-to="FX-3"/);
  // The `together` group is one frame, and the now-line sits above the active wave.
  assert.match(html, /data-plan-group="0-0"/);
  assert.match(html, /data-plan-now="1"/);
});

test("a status is a colour AND a word — never colour alone (TL-52)", () => {
  const html = renderExecution(model());
  assert.match(html, /class="badge badge-status-running">running</);
  assert.match(html, /class="badge badge-status-shipped">shipped</);
});

test("a task the plan names but the tree does not have is marked, not dropped", () => {
  const plan = { ...PLAN, waves: [{ name: "foundations", tasks: ["FX-1", "FX-404"], together: [] }] };
  const vm = planViewModel(planState(plan, TASKS, CONFIG), TASKS, { estimateHours, now: NOW });
  assert.deepEqual(vm.unknown, ["FX-404"]);
  assert.match(renderExecution(vm), /data-plan-card="FX-404"/);
});

test("no plan file is an instruction, not an error", () => {
  const vm = planViewModel(null, TASKS, {});
  assert.equal(vm.exists, false);
  const html = renderExecution(vm);
  assert.match(html, /No execution plan yet/);
  assert.doesNotMatch(html, /data-plan-wave/);
  // The empty state names the file that would fill the tab.
  assert.match(renderPlanMissing({ planPath: "fixture/plan.yaml" }), /fixture\/plan\.yaml/);
});

// ── Work running in another worktree (TL-210) ─────────────────────────────
//
// The scan reports it and the Tasks view already draws it; the Execution view
// used to derive every class from the LOCAL status, so a wave stood still on
// screen while an agent moved through it. The fixture below is the situation
// that produced the bug: from this tree FX-3 is `queued`, and a worktree says it
// is `running`.

/** FX-3 seen as running in another tree, with that tree's own record of when. */
function awayTasks(observation) {
  return TASKS.map((t) => (t.id === "FX-3" ? { ...t, elsewhere: [observation] } : t));
}

const AWAY = {
  status: "running",
  source: "/home/somebody/worktrees/fx-side",
  kind: "worktree",
  since: "2026-01-02T07:00:00Z",
};

function awayModel(observation) {
  const tasks = awayTasks(observation);
  return planViewModel(planState(PLAN, tasks, CONFIG), tasks, {
    history: {},
    now: NOW,
    estimateHours,
    archivedStatuses: CONFIG.archivedStatuses,
  });
}

test("a task running in another worktree is running on this view too, and names the tree", () => {
  const fx3 = awayModel(AWAY).waves[1].cards[0];
  assert.equal(fx3.status, "queued", "the LOCAL status is still what this tree says");
  assert.equal(fx3.inProgress, false, "nobody is working on it HERE");
  assert.equal(fx3.running, true, "the card does not know that work is under way");
  assert.equal(fx3.elsewhereRunning.label, "fx-side");
  assert.equal(fx3.elsewhereRunning.source, AWAY.source, "the full path has to survive for the title");
});

test("the elapsed bar of a foreign card is measured from THAT tree's record", () => {
  // 07:00 there, 12:00 now: five hours against a one-day estimate — a WORKING
  // day, whatever `estimate.mjs` says one is, which is why the fraction is
  // computed here rather than typed. Reading this tree's history instead would
  // be reading a session that is not the one running.
  const fx3 = awayModel(AWAY).waves[1].cards[0];
  assert.equal(fx3.elapsedLabel, "5h");
  assert.equal(fx3.estimateLabel, "1d");
  assert.equal(fx3.pct, 5 / estimateHours("1d"));
});

test("a foreign card whose tree's log could not be read gets no bar, only the state", () => {
  // The honest degradation: the scan cannot read a branch's log, so `since` is
  // absent. The card still says work is under way and where — it does not invent
  // a duration out of this tree's history.
  const vm = awayModel({ status: "running", source: "feature/side", kind: "branch" });
  const fx3 = vm.waves[1].cards[0];
  assert.equal(fx3.running, true);
  assert.equal(fx3.elapsedLabel, "", "a bar was drawn from a start nobody reported");
  assert.equal(fx3.pct, null);
  assert.equal(fx3.elsewhereRunning.label, "feature/side", "a branch name is not cut at its slash");
});

test("a divergence that is NOT the in-progress status leaves the card alone", () => {
  // POSITIVE CONTROL for the rule: the trigger is the configured in-progress
  // status, not the mere existence of a divergence — otherwise a task closed on
  // another branch would render as running here.
  const fx3 = awayModel({ status: "shipped", source: "/w/other", kind: "worktree" }).waves[1].cards[0];
  assert.equal(fx3.running, false);
  assert.equal(fx3.elsewhereRunning, null);
});

test("the rendered foreign card carries both the running mark and the foreign one", () => {
  const tasks = awayTasks(AWAY);
  const html = renderExecution(planViewModel(planState(PLAN, tasks, CONFIG), tasks, {
    history: {}, now: NOW, estimateHours, archivedStatuses: CONFIG.archivedStatuses,
  }));
  const card = html.slice(html.indexOf('data-plan-card="FX-3"') - 400, html.indexOf('data-plan-card="FX-3"') + 700);
  assert.match(card, /is-running/, "the card does not read as running");
  assert.match(card, /is-elsewhere/, "foreign work is indistinguishable from work in this tree");
  assert.match(card, /running in fx-side/, "the tree is not named on the card itself");
  assert.match(card, /exec-bar/);
  // A card running HERE keeps the plain running mark — without this the two
  // assertions above would pass on a view that marked everything foreign.
  const fx2 = html.slice(html.indexOf('data-plan-card="FX-2"'));
  assert.doesNotMatch(fx2.slice(0, 500), /is-elsewhere/);
});

test("a title carrying HTML cannot break out of a card", () => {
  const tasks = TASKS.map((t) => (t.id === "FX-1" ? { ...t, title: '</article><script>x</script>' } : t));
  const html = renderExecution(planViewModel(planState(PLAN, tasks, CONFIG), tasks, { estimateHours, now: NOW }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;\/article&gt;/);
});

// ── The critical path (TL-110) ────────────────────────────────────────────
//
// Three properties, and only the first of them is about drawing anything:
// the chain is weighted rather than counted, it is drawn through OPEN work
// only, and a tie is settled by a rule rather than by whatever order a map
// happened to be built in.

const card = (id, over = {}) => ({ id, known: true, open: true, estimate: "1h", ...over });

test("the critical path is the heaviest chain, not the longest one", () => {
  // Three short tasks against two long ones: counting cards picks the wrong
  // chain, and picks it confidently.
  const cards = [
    card("A", { estimate: "30m" }), card("B", { estimate: "30m" }), card("C", { estimate: "30m" }),
    card("X", { estimate: "1d" }), card("Y", { estimate: "1d" }),
  ];
  const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "X", to: "Y" }];
  const r = criticalPath(cards, edges, { estimateHours });
  assert.deepEqual(r.ids, ["X", "Y"]);
  assert.equal(r.hours, 16);
});

test("a closed task is not on the critical path — it holds nothing up", () => {
  const cards = [card("A", { open: false, estimate: "1w" }), card("B"), card("C")];
  const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }];
  const r = criticalPath(cards, edges, { estimateHours });
  assert.deepEqual(r.ids, ["B", "C"]);
  assert.equal(r.hours, 2);
});

test("a tie is settled by a stated rule, and the same input always answers the same", () => {
  // Two chains of identical weight AND identical length: only the id order can
  // separate them, and it has to separate them every time.
  const cards = [card("B1"), card("B2"), card("A1"), card("A2")];
  const edges = [{ from: "A1", to: "A2" }, { from: "B1", to: "B2" }];
  const first = criticalPath(cards, edges, { estimateHours });
  assert.deepEqual(first.ids, ["A1", "A2"]);
  // Reversed input, same answer — that is what "deterministic" has to mean.
  const reversed = criticalPath(cards.slice().reverse(), edges.slice().reverse(), { estimateHours });
  assert.deepEqual(reversed.ids, first.ids);
});

test("a task with no estimate is counted as a task and reported as uncounted", () => {
  const cards = [card("A", { estimate: "2h" }), card("B", { estimate: "" })];
  const r = criticalPath(cards, [{ from: "A", to: "B" }], { estimateHours });
  assert.deepEqual(r.ids, ["A", "B"]);
  assert.equal(r.hours, 2);
  assert.equal(r.unknown, 1, "a sum that hides what it could not count pretends to be complete");
  assert.match(criticalLabel(r), /1 unestimated/);
});

test("the label counts in words a person uses — never `1 tasks`", () => {
  assert.match(criticalLabel({ ids: ["A"], hours: 2, unknown: 0 }), /1 task\b/);
  assert.match(criticalLabel({ ids: ["A", "B"], hours: 2, unknown: 0 }), /2 tasks/);
});

test("a cycle in blocked_by stops the walk instead of hanging it", () => {
  const cards = [card("A"), card("B")];
  const r = criticalPath(cards, [{ from: "A", to: "B" }, { from: "B", to: "A" }], { estimateHours });
  assert.ok(r.ids.length >= 1 && r.ids.length <= 3);
});

test("no open work at all is an empty path, not a crash", () => {
  assert.deepEqual(criticalPath([card("A", { open: false })], [], { estimateHours }).ids, []);
  assert.equal(criticalLabel({ ids: [], hours: 0, unknown: 0 }), "");
});

test("the path is marked in the HTML by a WORD, not by colour alone", () => {
  const vm = model();
  const html = renderExecution(vm);
  assert.ok(vm.critical.ids.length, "the fixture has to have a path, or this proves nothing");
  assert.match(html, /exec-critical-tag">critical path</);
  assert.match(html, /critical path: ~\d/);
  assert.match(html, /data-edge-critical="1"/);
});

// ── Lighting up a chain (TL-110) ──────────────────────────────────────────

test("clicking a task lights everything it transitively unblocks, and nothing else", () => {
  const edges = [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "X", to: "Y" }];
  assert.deepEqual([...descendants(edges, "A")].sort(), ["B", "C"]);
  assert.deepEqual([...descendants(edges, "C")], []);
  assert.deepEqual([...descendants(edges, "X")], ["Y"]);
});

test("a cycle does not make the walk loop", () => {
  assert.deepEqual([...descendants([{ from: "A", to: "B" }, { from: "B", to: "A" }], "A")].sort(), ["B"]);
});

// ── What has moved since the last render (TL-110) ─────────────────────────

test("the FIRST paint reports no changes — nothing has moved yet", () => {
  const vm = model();
  const r = statusChanges(null, vm);
  assert.deepEqual(r.cards, []);
  assert.deepEqual(r.waves, []);
  assert.ok(r.statuses.size > 0, "it still has to remember what it saw");
});

test("a status that changed is reported; one that did not is not", () => {
  const before = statusChanges(null, model());
  const moved = TASKS.map((t) => (t.id === "FX-3" ? { ...t, status: "running" } : t));
  const vm = planViewModel(planState(PLAN, moved, CONFIG), moved, {
    history: {}, now: NOW, estimateHours, archivedStatuses: CONFIG.archivedStatuses,
  });
  assert.deepEqual(statusChanges(before, vm).cards, ["FX-3"]);
});

test("a wave that has just closed in full is reported once, and only once", () => {
  const before = statusChanges(null, model());
  const closed = TASKS.map((t) => (t.id === "FX-2" ? { ...t, status: "shipped" } : t));
  const vmA = planViewModel(planState(PLAN, closed, CONFIG), closed, {
    history: {}, now: NOW, estimateHours, archivedStatuses: CONFIG.archivedStatuses,
  });
  const first = statusChanges(before, vmA);
  assert.deepEqual(first.waves, [0]);
  // The same state again is not a second closing.
  assert.deepEqual(statusChanges(first, vmA).waves, []);
});

// ── A wave held shut, as `plan` prints it (TL-660) ────────────────────────
//
// The page computes the plan through `pagePlanState`, with the whole
// configuration, the history and the clock — the inputs `plan` hands
// `planState`. The vocabulary is this fixture's own: `vouching` is the status
// awaiting a person, `parked` a protected one.

const HOLD_CONFIG = {
  archivedStatuses: ["shipped"],
  inProgressStatus: "running",
  awaitingVouchStatus: "vouching",
  reasonRequiredStatuses: ["parked"],
  auditStaleDays: 7,
  abandonedAfterDays: 30,
  estimates: ["1h", "2h", "4h", "1d"],
  maxUnattendedEstimate: "4h",
};
const HOLD_PLAN = {
  updated: "2026-01-01",
  waves: [
    { name: "review", tasks: ["HX-1"], together: [] },
    { name: "after", tasks: ["HX-2"], together: [] },
  ],
};
const holdTasks = (status) => [
  { id: "HX-1", title: "the finished one", status, blocked_by: [], owner: "", estimate: "2h" },
  { id: "HX-2", title: "the next one", status: "queued", blocked_by: [], owner: "", estimate: "1h" },
];
function holdView(tasks, history = {}) {
  const state = pagePlanState(HOLD_PLAN, tasks, history, HOLD_CONFIG, NOW);
  const vm = planViewModel(state, tasks, {
    history, now: NOW, estimateHours, archivedStatuses: HOLD_CONFIG.archivedStatuses,
  });
  return { state, vm, html: renderExecution(vm) };
}

test("an active wave holding only a task awaiting a vouch renders as held, with that reason, and nothing is next up", () => {
  const { state, vm, html } = holdView(holdTasks("vouching"));
  assert.equal(state.activeWave, 0);
  assert.deepEqual(state.nextUp, [], "a task `next --plan` hands out to nobody is not next up");
  assert.equal(vm.waves[0].held, true);
  assert.deepEqual(vm.waves[0].holds.map((h) => [h.id, h.kind]), [["HX-1", "awaiting-vouch"]]);
  // The sentence is `plan`'s own, not a second wording of it.
  const reason = describeHold({ kind: "awaiting-vouch", status: "vouching" });
  assert.equal(vm.waves[0].holds[0].text, reason);
  assert.match(html, /data-plan-wave="0"[^]*?data-plan-held="1"/);
  assert.ok(html.includes('data-plan-hold="HX-1" data-plan-hold-kind="awaiting-vouch"'));
  assert.ok(html.includes(reason), "the reason reaches the page");
  // The wave after it is not held: its task is pending and nothing holds it.
  assert.equal(vm.waves[1].held, false);
  assert.ok(!/data-plan-wave="1"[^]*data-plan-held/.test(html));
});

test("positive control: the same task pending is next up and the wave is not held", () => {
  const { state, vm, html } = holdView(holdTasks("queued"));
  assert.deepEqual(state.nextUp.map((e) => e.ids), [["HX-1"]]);
  assert.equal(vm.waves[0].held, false);
  assert.deepEqual(vm.waves[0].holds, []);
  assert.ok(!html.includes("data-plan-held"));
  assert.ok(!html.includes("data-plan-holds"));
});

test("the page reads the history it embeds: a claim with no change past audit_stale_days is parked", () => {
  const tasks = holdTasks("running").map((t) =>
    t.id === "HX-1" ? { ...t, owner: "agent:x", updated: "2025-12-15" } : t);
  const history = { "HX-1": [{ ts: "2025-12-20T09:00:00Z", field: "status", to: "running" }] };
  const { vm } = holdView(tasks, history);
  const hold = vm.waves[0].holds[0];
  assert.equal(hold.kind, "parked-claim");
  // 2025-12-20 is the last change, which only the history says.
  assert.ok(hold.text.includes("since 2025-12-20"), hold.text);
});

test("a wave that is not held still names what it withholds, as `plan` does", () => {
  const plan = { updated: "2026-01-01", waves: [{ name: "mixed", tasks: ["HX-1", "HX-2"], together: [] }] };
  const tasks = holdTasks("vouching");
  const state = pagePlanState(plan, tasks, {}, HOLD_CONFIG, NOW);
  const vm = planViewModel(state, tasks, { now: NOW, estimateHours, archivedStatuses: ["shipped"] });
  assert.equal(vm.waves[0].held, false);
  assert.deepEqual(vm.waves[0].holds.map((h) => h.id), ["HX-1"]);
  assert.deepEqual(state.nextUp.map((e) => e.ids), [["HX-2"]]);
});

test("both of the page's plan computations go through pagePlanState", () => {
  const src = scriptSource("build-viewer.mjs");
  assert.equal((src.match(/pagePlanState\(PLAN\.plan, /g) || []).length, 2);
  assert.ok(!/[^.\w]planState\(PLAN\.plan/.test(src), "a call with a partial configuration bypasses the holds");
});

test("a startable hold in a wave that is not held is not withheld: `next` still hands it to a person", () => {
  // `executor: human` is a hold an unattended run applies, but a person asking
  // `next` is still handed the task — `plan` lists it as next up, not withheld.
  const plan = { updated: "2026-01-01", waves: [{ name: "mixed", tasks: ["HX-1", "HX-2"], together: [] }] };
  const tasks = holdTasks("queued").map((t) => (t.id === "HX-1" ? { ...t, executor: "human" } : t));
  const state = pagePlanState(plan, tasks, {}, HOLD_CONFIG, NOW);
  const vm = planViewModel(state, tasks, { now: NOW, estimateHours, archivedStatuses: ["shipped"] });
  assert.equal(state.waves[0].tasks[0].hold.kind, "person-only", "the fixture must carry the hold it is about");
  assert.equal(vm.waves[0].held, false);
  assert.deepEqual(vm.waves[0].holds, []);
});

test("the held block is structure a reader can follow: a word on the wave, a link and a sentence per task", () => {
  const { vm, html } = holdView(holdTasks("vouching"));
  const reason = vm.waves[0].holds[0].text;
  // The claim is carried by a WORD, not by colour alone (TL-52).
  assert.ok(html.includes('<span class="exec-wave-tag exec-wave-held" data-plan-held="1">held</span>'));
  const block = html.match(/<div class="exec-holds" data-plan-holds="(\d+)"><p>([^<]+)<\/p><ul>(.*?)<\/ul><\/div>/);
  assert.ok(block, "the holds render as one block with a lead-in and a list");
  assert.equal(block[1], "1");
  assert.equal(
    block[3],
    '<li data-plan-hold="HX-1" data-plan-hold-kind="awaiting-vouch">' +
      '<a class="exec-id" href="#HX-1">HX-1</a> ' + reason + "</li>"
  );
  // A held wave and a wave that only withholds open with different lead-ins:
  // the first stops a run, the second does not.
  const plan = { updated: "2026-01-01", waves: [{ name: "mixed", tasks: ["HX-1", "HX-2"], together: [] }] };
  const tasks = holdTasks("vouching");
  const withheld = renderExecution(planViewModel(pagePlanState(plan, tasks, {}, HOLD_CONFIG, NOW), tasks, {
    now: NOW, estimateHours, archivedStatuses: ["shipped"],
  }));
  const lead = withheld.match(/<div class="exec-holds" data-plan-holds="1"><p>([^<]+)<\/p>/);
  assert.ok(lead, "a withholding wave renders the block too");
  assert.ok(block[2].length > 0 && lead[1].length > 0);
  assert.notEqual(block[2], lead[1]);
  assert.ok(!withheld.includes("data-plan-held"));
});

test("a wave with no hold renders no block between its header and its cards", () => {
  const { html } = holdView(holdTasks("queued"));
  assert.match(html, /data-plan-wave="0"><header class="exec-wave-head">.*?<\/header><div class="exec-cards">/);
  // Nothing follows the last tag of an unheld wave's header — no stray mark.
  assert.match(html, /data-plan-wave="0"><header class="exec-wave-head">.*?active wave<\/span><\/header>/);
  assert.match(html, /data-plan-wave="1"><header class="exec-wave-head">.*? done<\/span><\/header>/);
});

test("a held wave names each of its open tasks, one line apiece", () => {
  const plan = { updated: "2026-01-01", waves: [{ name: "review", tasks: ["HX-1", "HX-2"], together: [] }] };
  const tasks = holdTasks("vouching").map((t) => (t.id === "HX-2" ? { ...t, status: "parked" } : t));
  const state = pagePlanState(plan, tasks, {}, HOLD_CONFIG, NOW);
  const html = renderExecution(planViewModel(state, tasks, { now: NOW, estimateHours, archivedStatuses: ["shipped"] }));
  assert.equal(state.waves[0].held, true);
  const list = html.match(/<div class="exec-holds" data-plan-holds="2"><p>[^<]+<\/p><ul>(.*?)<\/ul><\/div>/);
  assert.ok(list);
  assert.match(list[1], /^<li data-plan-hold="HX-1" [^]*?<\/li><li data-plan-hold="HX-2" data-plan-hold-kind="protected-status">[^]*<\/li>$/);
});
