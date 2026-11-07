/**
 * The loop baseline and `resume` read the contract `done` runs (TL-496).
 *
 * WHAT HAS TO BE PROVED. `done` appends the project's `closing_contract` to a
 * task's own `verification:` (TL-493). The worktree loop takes a baseline of
 * that contract at the claim so a red it inherited is not blamed on the hand,
 * and `resume` re-runs it for a successor. Both used to read the task's own
 * entries only, so:
 *
 *   1. a project entry red at the claim had no baseline row, and the refusal
 *      `done` produced on it was treated as the hand's own failure;
 *   2. a briefing reported green where `done` would refuse.
 *
 * The positive control is the opposite case: a project entry GREEN at the
 * claim and red afterwards is the hand's failure, not an inherited one. Without
 * it, "inherited" could be the answer for every red and the guard would prove
 * nothing.
 *
 * Fixtures live in temporary directories with a configuration written here:
 * no value is read from this repository's own `config.yaml`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome } from "./_repo.mjs";

isolateHome("loop-inherits-project-red");

import { loadConfig } from "../config.mjs";
import { splitFrontmatter } from "../task-fields.mjs";
import { baselineFailure, contractProbe } from "../run-loop.mjs";
import { runVerification } from "../resume-task.mjs";

// The project entry is red while `repo-red` exists in the working directory.
// The file is the switch the tests flip between the claim and the closing.
const PROJECT_ENTRY = '"test ! -e repo-red"';

function task(verification) {
  return [
    "---", "id: TASK-1", 'title: "T"', "type: task", "labels: []", "board: main", 'epic: ""',
    "priority: P1", "status: in_progress", "owner: agent:x", "estimate: 2h", "confidence: high",
    "created: 2026-09-01", "updated: 2026-09-01", "blocked_by: []", "blocks: []",
    "verification:", ...verification, "---", "", "## Acceptance criteria", "",
    "- [ ] The task's own check passes. [proof: own]", "",
  ].join("\n");
}

const OWN = ["  - id: own", '    bash: "node -e 0"'];

function withBacklog(projectId, verification, fn) {
  const dir = fixtureDir(join(tmpdir(), "branchling-loop-project-red-"));
  mkdirSync(join(dir, "tasks"));
  writeFileSync(join(dir, "_template.md"), "---\nid: TASK-NNN\n---\n", "utf8");
  writeFileSync(join(dir, "boards.yaml"), 'default: main\nboards:\n  - slug: main\n    name: "Main"\n', "utf8");
  writeFileSync(join(dir, "config.yaml"), [
    'task_id_prefix: "TASK"',
    "closing_contract:",
    "  - id: " + projectId,
    "    bash: " + PROJECT_ENTRY,
    "",
  ].join("\n"), "utf8");
  const file = join(dir, "tasks", "TASK-1-x.md");
  writeFileSync(file, task(verification), "utf8");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = fn({ dir, file, config: loadConfig(dir) });
  } catch (err) {
    cleanup();
    throw err;
  }
  // An async test body must finish before its directory goes: removed at once,
  // every command would run in a deleted cwd and fail for the wrong reason.
  if (result && typeof result.then === "function") return result.finally(cleanup);
  cleanup();
  return result;
}

const red = (dir) => writeFileSync(join(dir, "repo-red"), "", "utf8");

test("the loop baseline carries the project entry the closing will run", () => {
  withBacklog("repo-guard", OWN, ({ dir, file, config }) => {
    const probe = contractProbe(file, dir, config);
    assert.deepEqual(probe.rows.map((r) => [r.id, Boolean(r.project)]), [["own", false], ["repo-guard", true]]);
    assert.equal(probe.failed, 0);
  });
});

test("a project entry red at the claim is inherited, not the hand's failure", () => {
  withBacklog("repo-guard", OWN, ({ dir, file, config }) => {
    red(dir);
    const atTake = contractProbe(file, dir, config);
    const project = atTake.rows.find((r) => r.id === "repo-guard");
    assert.equal(project.ok, false, "the fixture must make the project entry red at the claim");
    const inherited = baselineFailure(atTake, contractProbe(file, dir, config));
    assert.ok(inherited, "a red the tree already had at the claim is foreign to the hand");
    assert.equal(inherited.id, "repo-guard");
  });
});

test("positive control: a project entry green at the claim and red later is the hand's", () => {
  withBacklog("repo-guard", OWN, ({ dir, file, config }) => {
    const atTake = contractProbe(file, dir, config);
    assert.equal(atTake.failed, 0);
    red(dir);
    const now = contractProbe(file, dir, config);
    assert.equal(now.failed, 1, "the fixture must turn the project entry red after the claim");
    assert.equal(baselineFailure(atTake, now), null);
  });
});

test("an id shared with closing_contract yields no baseline rows, as done refuses it", () => {
  withBacklog("own", OWN, ({ dir, file, config }) => {
    const probe = contractProbe(file, dir, config);
    assert.deepEqual(probe.rows, []);
    assert.match(probe.problems.join("\n"), /closing_contract/);
  });
});

test("resume runs the project entry and reports its red", async () => {
  await withBacklog("repo-guard", OWN, async ({ dir, config }) => {
    const { frontmatter } = splitFrontmatter(task(OWN));
    const green = await runVerification(frontmatter, dir, config);
    assert.equal(green.problem, null);
    assert.deepEqual(green.entries.map((r) => [r.id, r.ok, Boolean(r.project)]),
      [["own", true, false], ["repo-guard", true, true]]);
    red(dir);
    const failing = await runVerification(frontmatter, dir, config);
    assert.equal(failing.failed && failing.failed.entry.id, "repo-guard");
  });
});

test("resume refuses an id shared with closing_contract before running anything", async () => {
  await withBacklog("own", OWN, async ({ dir, config }) => {
    const { frontmatter } = splitFrontmatter(task(OWN));
    const result = await runVerification(frontmatter, dir, config);
    assert.deepEqual(result.entries, []);
    assert.match(result.problem, /closing_contract/);
  });
});
