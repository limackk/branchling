import assert from "node:assert/strict";
import test from "node:test";

import { dashboardModel, renderDashboard } from "../viewer-dashboard.mjs";

const DAY = 86400000;
const NOW = Date.parse("2026-09-26T12:00:00Z");
const tasks = [
  { id: "FX-1", status: "done", priority: "P1", epic: "Core", blocked_by: [], created: "2026-09-01" },
  { id: "FX-2", status: "running", priority: "P0", epic: "Core", blocked_by: ["FX-1"], created: "2026-09-10" },
  { id: "FX-3", status: "todo", priority: "P2", epic: "UI", blocked_by: ["FX-2"], executor: "human", created: "bad" },
  { id: "FX-4", status: "review", priority: "P1", epic: "UI", blocked_by: [], created: "2026-09-20" },
];
const history = {
  "FX-1": [
    { ts: "2026-09-01T10:00:00Z", field: "__created__" },
    { ts: "2026-09-05T10:00:00Z", field: "status", to: "done" },
  ],
  "FX-2": [{ ts: "2026-09-10T10:00:00Z", field: "__created__" }],
};
const plan = { waves: [{ name: "Foundation", tasks: [{ id: "FX-1" }, { id: "FX-2" }] }] };
const options = {
  archivedStatuses: ["done", "cancelled"], inProgressStatus: "running", awaitingVouchStatus: "review",
  priorities: ["P0", "P1", "P2"], now: NOW, from: NOW - 30 * DAY, to: NOW,
};

test("current health follows project vocabulary and the plan", () => {
  const model = dashboardModel(tasks, history, plan, options);
  assert.deepEqual(model.current.open.map((task) => task.id), ["FX-2", "FX-3", "FX-4"]);
  assert.deepEqual(model.current.inProgress.map((task) => task.id), ["FX-2"]);
  assert.deepEqual(model.current.blocked.map((task) => task.id), ["FX-3"]);
  assert.deepEqual(model.current.waiting.map((task) => task.id), ["FX-3", "FX-4"]);
  assert.deepEqual(model.current.unscheduled.map((task) => task.id), ["FX-3", "FX-4"]);
});

test("flow preserves unknown samples instead of converting them to zero", () => {
  const model = dashboardModel(tasks, history, plan, options);
  assert.equal(model.flow.created.length, 3);
  assert.equal(model.flow.closed.length, 1);
  assert.equal(model.flow.net, 2);
  assert.equal(model.flow.leadMedian, 4 * DAY);
  assert.equal(model.flow.incompleteCreated, 1);
  const empty = dashboardModel([{ id: "FX-9", status: "todo", created: "bad", blocked_by: [] }], {}, null, options);
  assert.equal(empty.flow.leadMedian, null);
  assert.match(renderDashboard(empty), /lead time is unknown/i);
  assert.match(renderDashboard(empty), /Add a valid plan/);
});

test("every populated aggregate carries the exact task ids for drill-down", () => {
  const html = renderDashboard(dashboardModel(tasks, history, plan, options));
  assert.match(html, /data-dashboard-tasks="FX-2,FX-3,FX-4"/);
  assert.match(html, /Foundation: 1\/2 closed/);
  assert.match(html, /Core: 1 open, 0 blocked/);
  assert.doesNotMatch(html, /owner|actor|individual throughput/i);
});
