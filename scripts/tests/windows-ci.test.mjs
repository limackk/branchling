/**
 * The repository's Windows support claim must have a public transport.
 * This reads the workflow as the runner sees it and keeps a positive control:
 * removing Windows from a fixture is observed as a failure, so green cannot
 * mean that the test silently stopped finding the matrix.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("windows-ci");

const WORKFLOW = readFileSync(join(REPO_ROOT, ".github", "workflows", "test.yml"), "utf8");

function windowsJob(workflow) {
  const match = workflow.match(/include:\s*\n([\s\S]*?)(?=\n\s{4}\S|\n\s{2}\S|$)/);
  if (!match) return null;
  const item = match[1].match(/-\s+os:\s*windows-latest\s*\n\s+node:\s*["']?([^\s"']+)/);
  return item ? { os: "windows-latest", node: item[1] } : null;
}

function runSteps(workflow) {
  return [...workflow.matchAll(/^\s+- name:\s*(.+)\n(?:\s+.*\n)*?\s+run:\s*(.+)$/gm)]
    .map((match) => ({ name: match[1].trim(), command: match[2].trim() }));
}

test("the complete suite and guards run on a declared Windows job", () => {
  assert.deepEqual(windowsJob(WORKFLOW), { os: "windows-latest", node: "22" });
  assert.doesNotMatch(WORKFLOW, /continue-on-error:\s*true/,
    "Windows support cannot be advisory while README calls it supported");
  const steps = runSteps(WORKFLOW);
  assert.ok(steps.some((step) => step.command === "node --test scripts/tests/*.test.mjs"),
    "the Windows matrix job does not run the complete suite");
  assert.ok(steps.some((step) => step.command === "node scripts/cli.mjs check"),
    "the Windows matrix job does not run branchling check");
});

test("Linux and macOS still measure every Node line promised by engines", () => {
  assert.match(WORKFLOW, /os:\s*\[ubuntu-latest, macos-latest\]/);
  assert.match(WORKFLOW, /node:\s*\["18", "20", "22"\]/);
});

test("POSITIVE CONTROL: removing Windows is detected", () => {
  const withoutWindows = WORKFLOW.replace(/\s*include:\s*\n\s*- os:\s*windows-latest\s*\n\s*node:\s*["']?22["']?/, "");
  assert.equal(windowsJob(withoutWindows), null,
    "the workflow reader fabricated a Windows job after it was removed");
});
