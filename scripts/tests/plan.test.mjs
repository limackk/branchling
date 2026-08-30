/**
 * The execution plan: parser and consistency guard (TL-107).
 *
 * WHAT IS BEING PROVED. Two different things, and they are tested differently
 * on purpose:
 *
 *   the PARSER   — pure, so it is called directly with text. An unknown key
 *                  fails, because `plan.yaml` is a fixed shape and a new word in
 *                  it is a typo, not a capability.
 *   the GUARD    — spawned as a program, because the exit code IS the contract:
 *                  a message printed on stdout with status 0 is a guard that
 *                  does not guard.
 *
 * THE POSITIVE CONTROL is not decoration. `plan.yaml` is optional, so the guard
 * passes over a backlog that has none — which means the whole suite could be
 * green while the checking code was never entered. Every rule therefore has a
 * fixture that MUST fail, and the run over this repository's own tree is
 * asserted to have judged a non-zero number of tasks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKLOG_DIR, SCRIPTS_DIR } from "./_repo.mjs";
import { parsePlanYaml, validatePlan } from "../plan.mjs";

const GUARD = join(SCRIPTS_DIR, "check-backlog-plan.mjs");
const CLI = join(SCRIPTS_DIR, "cli.mjs");

// ──────────────────────────────────────────────────────────────────────────
// The parser
// ──────────────────────────────────────────────────────────────────────────

test("a plan in the documented shape parses into waves", () => {
  const { plan, problems } = parsePlanYaml(
    [
      "updated: 2026-09-01",
      'rationale: "the parser first, its consumers after"',
      "waves:",
      '  - name: "Foundation"',
      "    tasks: [TL-1, TL-2]",
      '  - name: "Consumers"',
      "    tasks:",
      "      - TL-3",
      "      - TL-4",
      "    together:",
      "      - [TL-3, TL-4]",
      "",
    ].join("\n"),
  );
  assert.deepEqual(problems, []);
  assert.equal(plan.updated, "2026-09-01");
  assert.equal(plan.rationale, "the parser first, its consumers after");
  assert.equal(plan.waves.length, 2);
  assert.deepEqual(plan.waves[0], { name: "Foundation", tasks: ["TL-1", "TL-2"], together: [] });
  assert.deepEqual(plan.waves[1].tasks, ["TL-3", "TL-4"]);
  assert.deepEqual(plan.waves[1].together, [["TL-3", "TL-4"]]);
});

test("a comment beside a value is not part of the value", () => {
  const { plan } = parsePlanYaml(
    ["updated: 2026-09-01   # when this order was decided", "waves:", '  - name: "A"  # first', "    tasks: [TL-1]", ""].join("\n"),
  );
  assert.equal(plan.updated, "2026-09-01");
  assert.equal(plan.waves[0].name, "A");
});

test("`together:` inline, as a list of groups", () => {
  const { plan, problems } = parsePlanYaml(
    ["waves:", '  - name: "A"', "    tasks: [TL-1, TL-2]", "    together: [[TL-1, TL-2]]", ""].join("\n"),
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(plan.waves[0].together, [["TL-1", "TL-2"]]);
});

test("an unknown top-level key FAILS instead of being ignored", () => {
  const { problems } = parsePlanYaml(["sprint: 4", "waves:", '  - name: "A"', "    tasks: [TL-1]", ""].join("\n"));
  assert.equal(problems.length, 1, "an unknown key went through: " + JSON.stringify(problems));
  assert.match(problems[0], /sprint/);
});

test("an unknown key INSIDE a wave FAILS", () => {
  const { problems } = parsePlanYaml(["waves:", '  - name: "A"', "    owner: nobody", "    tasks: [TL-1]", ""].join("\n"));
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /owner/);
});

test("a wave with no name is reported — the name is how the plan is read", () => {
  const { problems } = parsePlanYaml(["waves:", "  - tasks: [TL-1]", ""].join("\n"));
  assert.ok(problems.some((p) => /name/.test(p)), JSON.stringify(problems));
});

// ──────────────────────────────────────────────────────────────────────────
// The validation
// ──────────────────────────────────────────────────────────────────────────

const CONFIG = { archivedStatuses: ["done", "cancelled"] };

function tasks(...entries) {
  return entries.map(([id, status = "pending", blocked_by = []]) => ({ id, status, blocked_by }));
}

function validate(text, list) {
  const { plan, problems } = parsePlanYaml(text);
  assert.deepEqual(problems, [], "the fixture itself does not parse");
  return validatePlan(plan, list, CONFIG);
}

test("a task scheduled BEFORE its blocker is an error naming both ids and both waves", () => {
  const r = validate(
    ["waves:", '  - name: "First"', "    tasks: [TL-2]", '  - name: "Second"', "    tasks: [TL-1]", ""].join("\n"),
    tasks(["TL-1"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /TL-2/);
  assert.match(r.errors[0], /TL-1/);
  assert.match(r.errors[0], /First/);
  assert.match(r.errors[0], /Second/);
});

test("a blocker in the SAME wave is a warning, not an error", () => {
  const r = validate(
    ["waves:", '  - name: "One"', "    tasks: [TL-1, TL-2]", ""].join("\n"),
    tasks(["TL-1"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1, JSON.stringify(r));
});

test("a task scheduled AFTER its blocker is clean", () => {
  const r = validate(
    ["waves:", '  - name: "First"', "    tasks: [TL-1]", '  - name: "Second"', "    tasks: [TL-2]", ""].join("\n"),
    tasks(["TL-1"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.planned, 2);
});

test("an OPEN blocker that the plan does not schedule at all is an error", () => {
  const r = validate(
    ["waves:", '  - name: "One"', "    tasks: [TL-2]", ""].join("\n"),
    tasks(["TL-1"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /TL-1/);
});

test("a CLOSED blocker outside the plan is not a defect — the work is already done", () => {
  const r = validate(
    ["waves:", '  - name: "One"', "    tasks: [TL-2]", ""].join("\n"),
    tasks(["TL-1", "done"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.deepEqual(r.errors, []);
});

test("a closed task INSIDE the plan is not a defect — a plan keeps its history", () => {
  const r = validate(
    ["waves:", '  - name: "First"', "    tasks: [TL-1]", '  - name: "Second"', "    tasks: [TL-2]", ""].join("\n"),
    tasks(["TL-1", "done"], ["TL-2", "pending", ["TL-1"]]),
  );
  assert.deepEqual(r.errors, []);
});

test("an id the backlog does not have is an error", () => {
  const r = validate(["waves:", '  - name: "One"', "    tasks: [TL-9]", ""].join("\n"), tasks(["TL-1"]));
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /TL-9/);
});

test("the same id in two waves is an error", () => {
  const r = validate(
    ["waves:", '  - name: "First"', "    tasks: [TL-1]", '  - name: "Second"', "    tasks: [TL-1]", ""].join("\n"),
    tasks(["TL-1"]),
  );
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /twice/);
});

test("a `together` group spanning two waves is an error", () => {
  const r = validate(
    [
      "waves:",
      '  - name: "First"',
      "    tasks: [TL-1]",
      "    together: [[TL-1, TL-2]]",
      '  - name: "Second"',
      "    tasks: [TL-2]",
      "",
    ].join("\n"),
    tasks(["TL-1"], ["TL-2"]),
  );
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /together/);
});

test("a `together` id the plan does not schedule at all is an error", () => {
  const r = validate(
    ["waves:", '  - name: "One"', "    tasks: [TL-1]", "    together: [[TL-1, TL-2]]", ""].join("\n"),
    tasks(["TL-1"], ["TL-2"]),
  );
  assert.equal(r.errors.length, 1, JSON.stringify(r));
  assert.match(r.errors[0], /TL-2/);
});

// ──────────────────────────────────────────────────────────────────────────
// The guard as a program — the exit code is the contract
// ──────────────────────────────────────────────────────────────────────────

function run(args, script = GUARD) {
  const r = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function task(dir, id, { blocked_by = [], status = "pending" } = {}) {
  writeFileSync(
    join(dir, "tasks", `${id}-x.md`),
    [
      "---",
      `id: ${id}`,
      'title: "T"',
      "type: code",
      "labels: []",
      "board: main",
      'epic: ""',
      "priority: P1",
      `status: ${status}`,
      "owner: unassigned",
      "estimate: 2h",
      "created: 2026-08-01",
      "updated: 2026-08-01",
      `blocked_by: [${blocked_by.join(", ")}]`,
      "blocks: []",
      "---",
      "",
      "## Cel",
      "",
      "x",
      "",
    ].join("\n"),
    "utf8",
  );
}

function withSandbox(build, fn) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-plan-"));
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

test("no plan.yaml passes, and says why rather than claiming a clean plan", () => {
  withSandbox(
    (d) => task(d, "TL-1"),
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /no plan\.yaml/);
    },
  );
});

test("POSITIVE CONTROL: a plan that reverses a dependency FAILS the guard", () => {
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
      assert.notEqual(r.code, 0, "an unexecutable order passed the guard: " + r.out);
      assert.match(r.out, /TL-1/);
      assert.match(r.out, /TL-2/);
      assert.match(r.out, /First/);
      assert.match(r.out, /Second/);
    },
  );
});

test("an executable plan passes, and the ✓ names how much it judged", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1");
      task(d, "TL-2", { blocked_by: ["TL-1"] });
      writeFileSync(
        join(d, "plan.yaml"),
        ["waves:", '  - name: "First"', "    tasks: [TL-1]", '  - name: "Second"', "    tasks: [TL-2]", ""].join("\n"),
        "utf8",
      );
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /2 task\(s\) across 2 wave\(s\)/);
    },
  );
});

test("a plan that cannot be PARSED fails — a shape error is not a warning", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1");
      writeFileSync(join(d, "plan.yaml"), ["sprint: 4", "waves:", '  - name: "A"', "    tasks: [TL-1]", ""].join("\n"), "utf8");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.notEqual(r.code, 0, "an unknown key passed: " + r.out);
      assert.match(r.out, /sprint/);
    },
  );
});

test("a warning alone does not fail the guard", () => {
  withSandbox(
    (d) => {
      task(d, "TL-1");
      task(d, "TL-2", { blocked_by: ["TL-1"] });
      writeFileSync(join(d, "plan.yaml"), ["waves:", '  - name: "One"', "    tasks: [TL-1, TL-2]", ""].join("\n"), "utf8");
    },
    (dir) => {
      const r = run(["--dir", dir]);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /TL-2/);
    },
  );
});

test("an unknown argument is a usage error, not a failed check", () => {
  const r = run(["--frobnicate"]);
  assert.equal(r.code, 2, r.out);
});

// ──────────────────────────────────────────────────────────────────────────
// The dispatcher and this repository's own plan
// ──────────────────────────────────────────────────────────────────────────

test("`check --plan` runs the guard, and `check --help` lists the flag", () => {
  const selected = run(["check", "--plan", "--dir", BACKLOG_DIR], CLI);
  assert.equal(selected.code, 0, selected.out);
  assert.match(selected.out, /plan/);

  const help = run(["check", "--help"], CLI);
  assert.equal(help.code, 0, help.out);
  assert.match(help.out, /--plan/);
});

test("this repository's own plan.yaml is executable, and it schedules something", () => {
  if (!existsSync(join(BACKLOG_DIR, "plan.yaml"))) {
    // Stated rather than skipped in silence: the assertion below has no sample.
    assert.fail("backlog/plan.yaml is missing — TL-107 requires this repository to carry its own plan");
  }
  const r = run(["--dir", BACKLOG_DIR]);
  assert.equal(r.code, 0, r.out);
  const m = r.out.match(/schedules (\d+) task\(s\)/);
  assert.ok(m, "the ✓ does not say how much it judged: " + r.out);
  assert.ok(Number(m[1]) > 0, "the plan schedules nothing — a guard over an empty plan proves nothing");
});
