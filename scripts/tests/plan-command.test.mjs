/**
 * The `plan` command — where the execution order has got to (TL-108).
 *
 * WHAT IS BEING PROVED, and why in two ways:
 *
 *   `planState`  — pure, so it is called with literal tasks. The five
 *                  definitions (active wave, next up, in progress, unplanned,
 *                  stale) are the contract the viewer will read too (TL-109),
 *                  so they are asserted here rather than through the output.
 *   the COMMAND  — spawned, because the exit code and the stream a line lands on
 *                  are part of what it promises. A refusal printed on stdout
 *                  with status 0 is not a refusal.
 *
 * THE POSITIVE CONTROLS matter more here than usual. `plan.yaml` is optional and
 * most of these sections are empty in a healthy backlog, so a suite that only
 * checked for absence would stay green while the counting code was never
 * entered. Every section therefore has a fixture in which it is NON-EMPTY.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("plan-command");

import { PRODUCT_NAME as N } from "../product.mjs";
import { parsePlanYaml, planState } from "../plan.mjs";
import { renderPlan, wrapIds } from "../plan-report.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const CONFIG = {
  archivedStatuses: ["done", "cancelled"],
  inProgressStatus: "in_progress",
  statuses: ["pending", "in_progress", "blocked", "done", "cancelled"],
  projectName: "Fixture",
};

function t(id, status = "pending", blocked_by = []) {
  return { id, status, blocked_by };
}

function state(planText, tasks, config = CONFIG) {
  const { plan, problems } = parsePlanYaml(planText);
  assert.deepEqual(problems, [], "the fixture itself does not parse");
  return planState(plan, tasks, config);
}

// ──────────────────────────────────────────────────────────────────────────
// The five definitions
// ──────────────────────────────────────────────────────────────────────────

const THREE_WAVES = [
  "updated: 2026-09-01",
  'rationale: "first the parser"',
  "waves:",
  '  - name: "Foundation"',
  "    tasks: [TL-1]",
  '  - name: "Consumers"',
  "    tasks: [TL-2, TL-3]",
  "    together: [[TL-2, TL-3]]",
  '  - name: "On top"',
  "    tasks: [TL-4]",
  "",
].join("\n");

test("the active wave is the FIRST one holding an open task", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4")]);
  assert.equal(s.activeWave, 1);
  assert.equal(s.waves[0].active, false);
  assert.equal(s.waves[1].active, true);
  assert.deepEqual(
    s.waves.map((w) => [w.open, w.closed]),
    [[0, 1], [2, 0], [1, 0]],
  );
});

test("a wave closed in the middle is skipped, not treated as active", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2", "done"), t("TL-3", "cancelled"), t("TL-4")]);
  assert.equal(s.activeWave, 2);
});

test("every task in the plan closed: no active wave, and nothing is next up", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2", "done"), t("TL-3", "done"), t("TL-4", "done")]);
  assert.equal(s.activeWave, null);
  assert.deepEqual(s.nextUp, []);
  assert.deepEqual(s.stale, []);
});

test("a `together` group is ONE entry, and only when every open member is ready", () => {
  const ready = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4")]);
  assert.deepEqual(ready.nextUp, [{ together: true, ids: ["TL-2", "TL-3"] }]);

  // TL-3 waits on something open, so the GROUP is not next up — half a group is
  // not the one act `together:` describes.
  const half = state(THREE_WAVES, [
    t("TL-1", "done"), t("TL-2"), t("TL-3", "pending", ["TL-9"]), t("TL-4"), t("TL-9"),
  ]);
  assert.deepEqual(half.nextUp, []);
});

test("a task waiting on an open blocker is not next up; a closed blocker does not hold it", () => {
  const plan = ["waves:", '  - name: "A"', "    tasks: [TL-2, TL-3]", ""].join("\n");
  const blocked = state(plan, [t("TL-2", "pending", ["TL-9"]), t("TL-3"), t("TL-9")]);
  assert.deepEqual(blocked.nextUp, [{ together: false, ids: ["TL-3"] }]);

  const cleared = state(plan, [t("TL-2", "pending", ["TL-9"]), t("TL-3"), t("TL-9", "done")]);
  assert.deepEqual(cleared.nextUp.map((e) => e.ids[0]), ["TL-2", "TL-3"]);
});

test("in progress is counted in ANY wave, and uses the PROJECT's word for it", () => {
  const tasks = [t("TL-1", "done"), t("TL-2", "in_progress"), t("TL-3"), t("TL-4", "in_progress")];
  const s = state(THREE_WAVES, tasks);
  assert.deepEqual(s.inProgress.map((x) => [x.id, x.wave]), [["TL-2", 1], ["TL-4", 2]]);

  // Another project's vocabulary: `in_progress` is then just a word, and the
  // status that means work in flight is the one the configuration names.
  const renamed = state(THREE_WAVES, [t("TL-1", "closed"), t("TL-2", "doing"), t("TL-3"), t("TL-4")], {
    archivedStatuses: ["closed"], inProgressStatus: "doing", statuses: ["pending", "doing", "closed"],
  });
  assert.deepEqual(renamed.inProgress.map((x) => x.id), ["TL-2"]);
});

test("unplanned lists the OPEN tasks the plan does not schedule, by id", () => {
  const s = state(THREE_WAVES, [
    t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4"), t("TL-7"), t("TL-8", "done"),
  ]);
  assert.deepEqual(s.unplanned.map((x) => x.id), ["TL-7"]);
});

test("stale = a plan task already closed in a wave AFTER the active one", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4", "done")]);
  assert.deepEqual(s.stale.map((x) => [x.id, x.wave]), [["TL-4", 2]]);

  // A task closed in an EARLIER wave is not stale — that is the plan working.
  assert.deepEqual(
    state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4")]).stale,
    [],
  );
});

test("a plan naming a task that is not in the tree marks it, rather than dropping it", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3")]);
  const missing = s.waves[2].tasks[0];
  assert.deepEqual(missing, { id: "TL-4", status: null, known: false, open: false });
});

// ──────────────────────────────────────────────────────────────────────────
// The rendering
// ──────────────────────────────────────────────────────────────────────────

test("every section is printed even when empty, with the word `none`", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4")]);
  const text = renderPlan(s, CONFIG, { columns: 100 });
  assert.match(text, /next up \(wave 2 — Consumers\):/);
  assert.match(text, /together: TL-2, TL-3/);
  assert.match(text, /in progress:\n {2}none/);
  assert.match(text, /unplanned open tasks: none/);
  assert.match(text, /stale — closed in a wave after the active one: none/);
});

test("the active wave is marked by a SYMBOL and a word, never by colour alone", () => {
  const s = state(THREE_WAVES, [t("TL-1", "done"), t("TL-2"), t("TL-3"), t("TL-4")]);
  const text = renderPlan(s, CONFIG, { columns: 100 });
  const row = text.split("\n").find((l) => l.includes("Consumers") && l.includes("wave 2"));
  assert.match(row, /→/);
  assert.match(row, /active/);
});

test("ids wrap to the terminal width instead of running off the edge", () => {
  const ids = ["TL-1", "TL-2", "TL-3", "TL-4"];
  assert.deepEqual(wrapIds(ids, "  ", 100), ["  TL-1, TL-2, TL-3, TL-4"]);
  const narrow = wrapIds(ids, "  ", 17);
  assert.deepEqual(narrow, ["  TL-1, TL-2,", "  TL-3, TL-4"]);
  // The comma at the end of a continued line counts towards the width.
  for (const l of narrow) assert.ok(l.length <= 17, l);
});

// ──────────────────────────────────────────────────────────────────────────
// The command — exit codes and streams
// ──────────────────────────────────────────────────────────────────────────

function run(args) {
  const r = spawnSync(process.execPath, [CLI, "plan", ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function task(dir, id, { blocked_by = [], status = "pending" } = {}) {
  writeFileSync(
    join(dir, "tasks", `${id}-x.md`),
    [
      "---", `id: ${id}`, 'title: "T"', "type: code", "labels: []", "board: main",
      'epic: ""', "priority: P1", `status: ${status}`, "owner: unassigned",
      "estimate: 2h", "created: 2026-08-01", "updated: 2026-08-01",
      `blocked_by: [${blocked_by.join(", ")}]`, "blocks: []", "---", "", "## Cel", "", "x", "",
    ].join("\n"),
    "utf8",
  );
}

function withSandbox(build, fn) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-plan-cmd-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TL-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "config.yaml"), "task_id_prefix: TL\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  build(dir);
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("no plan.yaml: exit 0, a message that says so, and an EMPTY answer in --json", () => {
  withSandbox(
    (d) => task(d, "TL-1"),
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /no plan file/);

      const j = run(["--dir", dir, "--json"]);
      assert.equal(j.code, 0, j.err);
      const answer = JSON.parse(j.out);
      assert.equal(answer.kind, "plan");
      assert.equal(answer.exists, false);
      // The emptiness rule of the envelope: a declared key is never missing.
      for (const key of ["waves", "nextUp", "inProgress", "unplanned", "stale"]) {
        assert.deepEqual(answer[key], [], key);
      }
      assert.equal(answer.activeWave, null);
    },
  );
});

test("POSITIVE CONTROL: a real plan reports a wave, a next-up group and the unplanned", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1", { status: "done" });
      task(d, "TL-2", { status: "in_progress" });
      task(d, "TL-3");
      task(d, "TL-9");                          // open, and in no wave
      writeFileSync(
        join(d, "plan.yaml"),
        [
          "waves:", '  - name: "Foundation"', "    tasks: [TL-1]",
          '  - name: "Consumers"', "    tasks: [TL-2, TL-3]", "    together: [[TL-2, TL-3]]", "",
        ].join("\n"),
        "utf8",
      );
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out + r.err);
      assert.match(r.out, /next up \(wave 2 — Consumers\)/);
      assert.match(r.out, /together: TL-2, TL-3/);
      assert.match(r.out, /TL-2\s+in_progress\s+wave 2/);
      assert.match(r.out, /unplanned open tasks: 1/);
      assert.match(r.out, /TL-9/);

      const answer = JSON.parse(run(["--dir", dir, "--json"]).out);
      assert.equal(answer.exists, true);
      assert.equal(answer.activeWave, 1);
      assert.deepEqual(answer.nextUp, [{ together: true, ids: ["TL-2", "TL-3"] }]);
      assert.deepEqual(answer.unplanned, [{ id: "TL-9", status: "pending" }]);
      assert.deepEqual(answer.inProgress, [{ id: "TL-2", wave: 1, status: "in_progress" }]);
      // The text and the JSON are the SAME computation, not two readings of it.
      assert.equal(answer.waves.length, 2);
    },
  );
});

test("a plan that reverses a dependency is REFUSED, in the guard's own words", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1");
      task(d, "TL-2", { blocked_by: ["TL-1"] });
      writeFileSync(
        join(d, "plan.yaml"),
        ["waves:", '  - name: "First"', "    tasks: [TL-2]", '  - name: "Second"', "    tasks: [TL-1]", ""].join("\n"),
        "utf8",
      );
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 1, r.out + r.err);
      assert.equal(r.out, "", "a refusal does not belong on stdout");
      assert.match(r.err, /plan\.yaml disagrees with the tasks/);
      assert.match(r.err, /cannot be executed/);
      // Even asked for JSON: there is no answer to give about an unexecutable order.
      assert.equal(run(["--dir", dir, "--json"]).code, 1);
    },
  );
});

test("a plan that does not parse is refused too, and never half-reported", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1");
      writeFileSync(join(d, "plan.yaml"), ["sprint: 4", "waves:", '  - name: "A"', "    tasks: [TL-1]", ""].join("\n"), "utf8");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.err, /unknown key `sprint`/);
    },
  );
});

test("an unknown flag FAILS with 2 and names the alternatives", () => {
  withSandbox(
    (d) => task(d, "TL-1"),
    (dir) => {
      const r = run(["--dir", dir, "--waves"]);
      assert.equal(r.code, 2);
      assert.match(r.err, /unknown flag: --waves/);
      assert.match(r.err, /--json/);
    },
  );
});

test("`plan --help` exits 0 on stdout and names the command's own flags", () => {
  const r = run(["--help"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes(N + " plan [--dir <path>] [--json]"), r.out);
});
