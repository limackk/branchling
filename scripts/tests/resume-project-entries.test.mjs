/**
 * The plain `resume` briefing names a project `closing_contract` row as one
 * (TL-558).
 *
 * WHAT IS AT RISK. TL-496 made `resume` run the contract `done` will run — the
 * task's own `verification:` followed by the project's `closing_contract`. The
 * model and `--json` carry `project: true` on the project's rows, but a text
 * row that does not say so reads as the task's own entry, and a successor
 * hunting the task file for a red line nobody wrote there loses the time the
 * briefing exists to save.
 *
 * THE CONTRACT IS REALLY RUN. The rows come from `runVerification`, not from a
 * hand-built list, so the test proves the flag survives from the contract
 * reader to the rendered page, for every row state the run produces: passed,
 * failed, and not reached. The manual state cannot come out of a run in a
 * fixture without a person, so it is asserted on a constructed row.
 *
 * THE POSITIVE CONTROL. Every assertion that a project row carries the mark is
 * paired with one that the task's own row in the SAME briefing does not. A
 * renderer that marked every row would pass the first half alone.
 *
 * WHAT THE VOCABULARY BELOW IS. `own-check`, `project-guard` and
 * `project-later` are this FIXTURE's ids, never this repository's.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROJECT_ENTRY_TAG } from "../done-task.mjs";
import { SECTIONS, renderBriefing, runVerification } from "../resume-task.mjs";
import { isolateHome } from "./_repo.mjs";

// Nothing here reads the user layer today, but the contract runs real shell
// commands and the guard in test-hygiene holds every file to the same rule.
isolateHome("resume-project-entries");

const FRONTMATTER = [
  "id: TASK-1",
  "verification:",
  "  - id: own-check",
  "    bash: \"true\"",
].join("\n");

function modelOf(contract) {
  return {
    id: "TASK-1", file: "tasks/TASK-1.md", actor: "agent:fixture", owner: "agent:fixture",
    verified: true,
    decisions: [], goal: null, take: null, history: [],
    diff: { base: "main", branch: null, mergeBase: null, patch: "" },
    working: { patch: "", untracked: [] },
    verification: contract.entries,
    contractProblem: contract.problem,
    failedOutput: contract.failed && contract.failed.output ? contract.failed.output : null,
  };
}

/** The verification section's rows, one per entry — the lines that open with
 *  a row mark, so a transcript block below them cannot be mistaken for one. */
function verificationRows(text) {
  const section = text.slice(text.indexOf(SECTIONS[4]) + SECTIONS[4].length);
  return section.split("\n").filter((l) => /^ {2}[✓✗·!] /.test(l));
}

function rowFor(rows, id) {
  const found = rows.filter((l) => new RegExp("\\s" + id + "\\s").test(l + " "));
  assert.equal(found.length, 1, "exactly one row names " + id + ":\n" + rows.join("\n"));
  return found[0];
}

async function briefingFor(closingContract) {
  const cwd = mkdtempSync(join(tmpdir(), "resume-project-"));
  try {
    const contract = await runVerification(FRONTMATTER, cwd, { closingContract });
    return renderBriefing(modelOf(contract));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("a passing project entry is marked, and the task's own passing entry is not", async () => {
  const rows = verificationRows(await briefingFor([{ id: "project-guard", bash: "true" }]));
  assert.equal(rows.length, 2, rows.join("\n"));

  const own = rowFor(rows, "own-check");
  assert.match(own, /passed/);
  assert.ok(!own.includes(PROJECT_ENTRY_TAG), "the task's own row carries no project mark: " + own);

  const project = rowFor(rows, "project-guard");
  assert.match(project, /passed/);
  assert.ok(project.includes(PROJECT_ENTRY_TAG + "  project-guard"), "the project row is marked: " + project);
});

test("a failing project entry and the one it left unreached are both marked", async () => {
  const rows = verificationRows(await briefingFor([
    { id: "project-guard", bash: "exit 3" },
    { id: "project-later", bash: "true" },
  ]));
  assert.equal(rows.length, 3, rows.join("\n"));

  assert.ok(!rowFor(rows, "own-check").includes(PROJECT_ENTRY_TAG));

  const failed = rowFor(rows, "project-guard");
  assert.match(failed, /FAILED \(exit 3\)/);
  assert.ok(failed.includes(PROJECT_ENTRY_TAG + "  project-guard"), failed);

  const unreached = rowFor(rows, "project-later");
  assert.match(unreached, /not reached/);
  assert.ok(unreached.includes(PROJECT_ENTRY_TAG + "  project-later"), unreached);
});

test("a manual project entry is marked, and a manual own entry is not", () => {
  const text = renderBriefing(modelOf({
    entries: [
      { id: "own-check", kind: "manual", command: "look", ok: null, exitCode: null, ms: 0 },
      { id: "project-guard", kind: "manual", command: "look", ok: null, exitCode: null, ms: 0, project: true },
    ],
    problem: null, failed: null,
  }));
  const rows = verificationRows(text);
  assert.ok(!rowFor(rows, "own-check").includes(PROJECT_ENTRY_TAG));
  const project = rowFor(rows, "project-guard");
  assert.match(project, /manual/);
  assert.ok(project.includes(PROJECT_ENTRY_TAG + "  project-guard"), project);
});
