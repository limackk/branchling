/**
 * The strategic product boundary is executable backlog data (TL-377).
 *
 * The cancellation list is intentionally explicit. A broad title or epic
 * filter would turn a later naming change into a silent change of scope.
 *
 * WHAT THE PLAN TEST MAY ASSERT (TL-397). `backlog/plan.yaml` is data that is
 * expected to be rewritten: the plan this file was written against closed
 * completely on 2026-09-21 and was replaced, at which point the guard's frozen
 * membership list — six ids scheduled, each before a seventh — began asserting
 * that a finished plan is still scheduled. A red suite of that kind is worse
 * than no guard, because every task verified by `node --test
 * scripts/tests/*.test.mjs` inherits a failure that is not its own.
 *
 * So the plan test asserts only what survives a rewrite: the file parses, the
 * plan's own consistency rules hold, no CANCELLED task is scheduled, and
 * managed fleets have no wave. It deliberately does not assert that a
 * scheduled task is still open — a plan keeps naming work while that work is
 * being finished, so that would be the same staleness one step later.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BACKLOG_DIR, TASKS_DIR, isolateHome } from "./_repo.mjs";
import { parsePlanYaml, validatePlan } from "../plan.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { loadConfig } from "../config.mjs";

const CANCELLED = [
  "TL-55", "TL-76", "TL-77", "TL-78", "TL-79", "TL-103", "TL-149", "TL-177",
  "TL-209", "TL-215", "TL-226", "TL-229", "TL-236", "TL-245", "TL-250", "TL-252",
  "TL-267", "TL-269", "TL-278", "TL-279", "TL-286", "TL-317", "TL-344", "TL-348",
];

isolateHome("product-boundary-plan");

function historyEntries(id) {
  return readFileSync(join(BACKLOG_DIR, "history", id + ".jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("the superseded work is cancelled with a stated reason", () => {
  const config = loadConfig(BACKLOG_DIR);
  const tasks = new Map(readTaskRecords(TASKS_DIR, config.taskId.file).map((task) => [task.id, task]));

  assert.equal(CANCELLED.length, 24, "the fixture must name the entire reviewed cancellation set");
  for (const id of CANCELLED) {
    const task = tasks.get(id);
    assert.ok(task, id + " is still a task file; cancellation never deletes history");
    assert.equal(task.status, "cancelled", id + " is cancelled");

    const transition = historyEntries(id).find((entry) =>
      entry.field === "status" && entry.to === "cancelled" && typeof entry.reason === "string" &&
      entry.reason.trim() && entry.reason !== "unknown" && entry.reason !== "proven"
    );
    assert.ok(transition, id + " has a non-reserved cancellation reason in its history");
  }
});

/**
 * The invariant, as a function of the plan TEXT — so the positive control
 * below can feed it a plan that does not exist on disk. Existence of every
 * scheduled id and the absence of a duplicate are `validatePlan`'s rules, not
 * this guard's; re-stating them here would be a second place to be wrong.
 */
function planProblems(text, tasks, config) {
  const { plan, problems } = parsePlanYaml(text);
  const found = problems.slice();
  found.push(...validatePlan(plan, tasks, { archivedStatuses: config.archivedStatuses }).errors);

  const byId = new Map(tasks.map((task) => [task.id, task]));
  for (const wave of plan.waves) {
    if (/managed fleets/i.test(wave.name)) found.push(`wave \`${wave.name}\` schedules managed-fleet work`);
    for (const id of wave.tasks) {
      const task = byId.get(id);
      if (task && task.status === "cancelled") found.push(`${id} is cancelled and still scheduled`);
    }
  }
  return found;
}

test("the execution plan schedules no cancelled work and no managed-fleet wave", () => {
  const config = loadConfig(BACKLOG_DIR);
  const tasks = readTaskRecords(TASKS_DIR, config.taskId.file);
  const text = readFileSync(join(BACKLOG_DIR, "plan.yaml"), "utf8");

  assert.ok(tasks.some((task) => task.status === "cancelled"), "the tree has cancelled tasks to be found");
  assert.deepEqual(planProblems(text, tasks, config), []);
});

test("a cancelled task scheduled in a wave is reported", () => {
  // The positive control. The assertion above runs against live data and would
  // pass just as loudly over a plan that happened to schedule nothing, so the
  // same function is handed a plan that is wrong in exactly the way it exists
  // to catch. The id comes from the reviewed set above, so the control cannot
  // outlive the cancellation it relies on.
  const config = loadConfig(BACKLOG_DIR);
  const tasks = readTaskRecords(TASKS_DIR, config.taskId.file);
  const id = CANCELLED[0];

  const text = [
    "updated: 2026-09-21",
    'rationale: "a plan that schedules superseded work"',
    "waves:",
    '  - name: "Managed fleets"',
    `    tasks: [${id}]`,
  ].join("\n");

  const found = planProblems(text, tasks, config);
  assert.ok(
    found.some((problem) => problem === `${id} is cancelled and still scheduled`),
    "a cancelled id in a wave is reported: " + JSON.stringify(found)
  );
  assert.ok(
    found.some((problem) => /managed-fleet/.test(problem)),
    "a managed-fleet wave is reported: " + JSON.stringify(found)
  );
});
