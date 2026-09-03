/**
 * The plan says which of its tasks an unattended run can never take (TL-199).
 *
 * WHAT WAS BROKEN. A wave stalled because it is waiting for a PERSON printed
 * rows identical to a wave waiting for work. This repository's own wave 2 was
 * the measurement: a fleet closed two of its three tasks, asked again, was told
 * there was nothing to take, and left the wave open — correctly, and in silence.
 * `run` does print what it could not take, but that report dies with the run,
 * and `plan` is the document somebody opens a day later to ask where this got
 * to.
 *
 * WHAT IS PROVED, and why each is separate:
 *
 *   the ROW is marked          — per entry, and a `together` group waits on a
 *                                person if any member does.
 *   the WAVE is marked         — a different answer from the rows: a wave whose
 *                                only human task is still behind a blocker
 *                                marks no row and yet still ends on a person.
 *   NOTHING is reordered       — the report gained a sentence, not a rule. The
 *                                same fixture is asserted with and without the
 *                                `executor:` field, and `nextUp` must be
 *                                identical in ids and in order.
 *   --json carries the fields  — spawned, not computed, because a dispatcher
 *                                deciding whether to keep polling reads the
 *                                wire and not this module.
 *
 * PURE where it can be: `planState` and `renderPlan` take data and return data,
 * so the contract is asserted directly rather than through a terminal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("plan-executor");

import { parsePlanYaml, planState } from "../plan.mjs";
import { renderPlan } from "../plan-report.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

// The project's own vocabulary, established by the fixture rather than read
// from this repository: statuses and the in-progress word are DATA.
const CONFIG = {
  archivedStatuses: ["done", "cancelled"],
  inProgressStatus: "in_progress",
  statuses: ["pending", "in_progress", "blocked", "done", "cancelled"],
  projectName: "Fixture",
};

/** Colourless, so an assertion is about the sentence and not about ANSI. */
const PLAIN = new Proxy({}, { get: () => (s) => String(s) });

function t(id, extra = {}) {
  return { id, status: "pending", blocked_by: [], executor: "", ...extra };
}

function state(planText, tasks) {
  const { plan, problems } = parsePlanYaml(planText);
  assert.deepEqual(problems, [], "the fixture itself does not parse");
  return planState(plan, tasks, CONFIG);
}

const ONE_WAVE = [
  "updated: 2026-09-03",
  "waves:",
  '  - name: "Watchable"',
  "    tasks: [TL-1, TL-2, TL-3]",
  "",
].join("\n");

const GROUPED = [
  "updated: 2026-09-03",
  "waves:",
  '  - name: "One act"',
  "    tasks: [TL-1, TL-2]",
  "    together: [[TL-1, TL-2]]",
  "",
].join("\n");

// ── The fact, per row and per wave ────────────────────────────────────────

test("POSITIVE CONTROL: with no executor anywhere, nothing is marked", () => {
  // Without this, every assertion below could be passing on a field that is
  // always true, and the guard would report a stall in a wave that has none.
  const s = state(ONE_WAVE, [t("TL-1"), t("TL-2"), t("TL-3")]);
  assert.equal(s.waves[0].endsOnHuman, false);
  assert.deepEqual(s.nextUp.map((e) => e.waitsOnHuman), [false, false, false]);
  assert.deepEqual(s.nextUp.map((e) => e.executors), [[], [], []]);
  assert.doesNotMatch(renderPlan(s, CONFIG, { color: PLAIN, columns: 100 }), /person/);
});

test("a `next up` row that asks for a person says so, and the wave says so too", () => {
  const s = state(ONE_WAVE, [t("TL-1"), t("TL-2", { executor: "human" }), t("TL-3")]);
  assert.deepEqual(s.nextUp.map((e) => e.waitsOnHuman), [false, true, false]);
  assert.deepEqual(s.nextUp[1].executors, ["human"]);
  assert.equal(s.waves[0].endsOnHuman, true);

  const text = renderPlan(s, CONFIG, { color: PLAIN, columns: 100 });
  const row = text.split("\n").find((l) => l.trim().startsWith("TL-2"));
  assert.match(row, /executor an unattended run is not/,
    "the marked row does not say what it is waiting for:\n" + text);
  assert.match(text, /this wave ends on a person/, text);
  const other = text.split("\n").find((l) => l.trim().startsWith("TL-1"));
  assert.doesNotMatch(other, /person|executor/, "a row nobody is waiting on was marked as well");
});

test("`executor: agent` is NOT marked — an unattended run is exactly what it asks for", () => {
  const s = state(ONE_WAVE, [t("TL-1", { executor: "agent" }), t("TL-2"), t("TL-3")]);
  assert.equal(s.waves[0].endsOnHuman, false);
  assert.deepEqual(s.nextUp.map((e) => e.waitsOnHuman), [false, false, false]);
  // The FACT is still carried, so a human reader's version of this question can
  // be answered later without changing what `waitsOnHuman` means.
  assert.deepEqual(s.nextUp[0].executors, ["agent"]);
});

test("a `together` group waits on a person if ANY member does", () => {
  // The group is one act; an act half of which needs a person needs a person.
  const s = state(GROUPED, [t("TL-1"), t("TL-2", { executor: "human" })]);
  assert.equal(s.nextUp.length, 1);
  assert.equal(s.nextUp[0].together, true);
  assert.deepEqual(s.nextUp[0].ids, ["TL-1", "TL-2"]);
  assert.equal(s.nextUp[0].waitsOnHuman, true);
});

test("a wave ends on a person even when that task is still behind a blocker", () => {
  // The reason the wave carries its own answer: TL-2 is not in `next up` at all,
  // so a per-row mark alone would say the wave is a fleet's to finish.
  const s = state(ONE_WAVE, [
    t("TL-1"),
    t("TL-2", { executor: "human", blocked_by: ["TL-1"] }),
    t("TL-3"),
  ]);
  assert.deepEqual(s.nextUp.map((e) => e.ids[0]), ["TL-1", "TL-3"]);
  assert.deepEqual(s.nextUp.map((e) => e.waitsOnHuman), [false, false]);
  assert.equal(s.waves[0].endsOnHuman, true);
  assert.match(renderPlan(s, CONFIG, { color: PLAIN, columns: 100 }), /this wave ends on a person/);
});

test("a CLOSED human task does not make the wave end on a person", () => {
  // It was finished by a person already; a fleet is not waiting for anybody.
  const s = state(ONE_WAVE, [t("TL-1"), t("TL-2", { executor: "human", status: "done" }), t("TL-3")]);
  assert.equal(s.waves[0].endsOnHuman, false);
});

// ── The rule the task forbade: no refusing, reordering or hiding ──────────

test("the marked task is STILL listed, in the same place in the same order", () => {
  const without = state(ONE_WAVE, [t("TL-1"), t("TL-2"), t("TL-3")]);
  const with_ = state(ONE_WAVE, [t("TL-1"), t("TL-2", { executor: "human" }), t("TL-3")]);
  assert.deepEqual(
    with_.nextUp.map((e) => e.ids),
    without.nextUp.map((e) => e.ids),
    "`executor:` changed WHICH tasks are next up, or their order — the plan reports " +
      "an order somebody decided and must not start filtering it",
  );
  assert.deepEqual(with_.waves[0].open, without.waves[0].open, "the wave's open count moved");
  assert.match(renderPlan(with_, CONFIG, { color: PLAIN, columns: 100 }), /TL-2/,
    "the row was dropped rather than marked");
});

// ── The wire ──────────────────────────────────────────────────────────────

function task(dir, id, { blocked_by = [], status = "pending", executor = "" } = {}) {
  writeFileSync(
    join(dir, "tasks", `${id}-x.md`),
    [
      "---", `id: ${id}`, 'title: "T"', "type: code", "labels: []", "board: main",
      'epic: ""', "priority: P1", `status: ${status}`, "owner: unassigned",
      `executor: "${executor}"`, "estimate: 2h", "created: 2026-08-01", "updated: 2026-08-01",
      `blocked_by: [${blocked_by.join(", ")}]`, "blocks: []", "---", "", "## Goal", "", "x", "",
    ].join("\n"),
    "utf8",
  );
}

test("--json carries both fields, because that is what a dispatcher reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-plan-executor-"));
  try {
    mkdirSync(join(dir, "tasks"));
    writeFileSync(join(dir, "_template.md"), "---\nid: TL-NNN\n---\n", "utf8");
    writeFileSync(join(dir, "config.yaml"), "task_id_prefix: TL\n", "utf8");
    writeFileSync(join(dir, "boards.yaml"),
      'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
    task(dir, "TL-1");
    task(dir, "TL-2", { executor: "human" });
    writeFileSync(join(dir, "plan.yaml"),
      ["updated: 2026-09-03", "waves:", '  - name: "Watchable"', "    tasks: [TL-1, TL-2]", ""].join("\n"),
      "utf8");

    const r = spawnSync(process.execPath, [CLI, "plan", "--dir", dir, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const answer = JSON.parse(r.stdout);
    assert.equal(answer.kind, "plan");
    assert.deepEqual(answer.nextUp.map((e) => [e.ids[0], e.waitsOnHuman]), [["TL-1", false], ["TL-2", true]]);
    assert.deepEqual(answer.nextUp[1].executors, ["human"]);
    assert.equal(answer.waves[0].endsOnHuman, true);
    // The field on the task entry too: `executor:` read alongside `status:`.
    assert.deepEqual(answer.waves[0].tasks.map((e) => e.executor), ["", "human"]);

    const text = spawnSync(process.execPath, [CLI, "plan", "--dir", dir], {
      encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
    });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /this wave ends on a person/, text.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
