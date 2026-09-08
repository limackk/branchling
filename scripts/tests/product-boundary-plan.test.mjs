/**
 * The strategic product boundary is executable backlog data (TL-377).
 *
 * The cancellation list is intentionally explicit. A broad title or epic
 * filter would turn a later naming change into a silent change of scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BACKLOG_DIR, TASKS_DIR, isolateHome } from "./_repo.mjs";
import { parsePlanYaml } from "../plan.mjs";
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

test("the reduction plan schedules no cancelled work or managed-fleet wave", () => {
  const text = readFileSync(join(BACKLOG_DIR, "plan.yaml"), "utf8");
  const { plan, problems } = parsePlanYaml(text);
  assert.deepEqual(problems, [], "the execution plan parses before its order is asserted");

  const scheduled = new Set(plan.waves.flatMap((wave) => wave.tasks));
  for (const id of CANCELLED) assert.ok(!scheduled.has(id), id + " is not scheduled after cancellation");
  assert.ok(!plan.waves.some((wave) => /managed fleets/i.test(wave.name)), "managed fleet work has no wave");

  const position = (id) => plan.waves.findIndex((wave) => wave.tasks.includes(id));
  for (const id of ["TL-378", "TL-379", "TL-380", "TL-381", "TL-382", "TL-383"]) {
    assert.ok(position(id) >= 0, id + " is scheduled in the reduction plan");
    assert.ok(position(id) < position("TL-384"), id + " precedes onboarding validation");
  }
});
