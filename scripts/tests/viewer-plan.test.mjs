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

import { planState } from "../plan.mjs";
import { estimateHours } from "../estimate.mjs";
import {
  durationLabel,
  enteredInProgressAt,
  planViewModel,
  renderExecution,
  renderPlanMissing,
} from "../viewer-plan.mjs";

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
  assert.deepEqual(vm.edges, [{ from: "FX-1", to: "FX-2" }, { from: "FX-2", to: "FX-3" }]);
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

test("a title carrying HTML cannot break out of a card", () => {
  const tasks = TASKS.map((t) => (t.id === "FX-1" ? { ...t, title: '</article><script>x</script>' } : t));
  const html = renderExecution(planViewModel(planState(PLAN, tasks, CONFIG), tasks, { estimateHours, now: NOW }));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;\/article&gt;/);
});
