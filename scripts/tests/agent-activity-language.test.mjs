import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { isolateHome, REPO_ROOT } from "./_repo.mjs";

isolateHome("agent-activity-language");

const PATHS = {
  agents: join(REPO_ROOT, "AGENTS.md"),
  instructions: join(REPO_ROOT, "scripts", "instructions.mjs"),
  readme: join(REPO_ROOT, "README.md"),
};

function sources() {
  return Object.fromEntries(
    Object.entries(PATHS).map(([name, path]) => [name, readFileSync(path, "utf8")]),
  );
}

function auditActivityLanguage(source) {
  const errors = [];
  const required = [
    ["agents", /A task claim is not proof of live execution\./],
    ["agents", /Execution is checkpointed; no background process remains active\./],
    ["agents", /Every progress report names completed evidence/],
    ["instructions", /durable claim of responsibility, not evidence that an agent or process is/],
    ["instructions", /LIVE means you can name and poll a runtime handle now\./],
    ["instructions", /Execution is checkpointed; no background/],
    ["readme", /state means the work is claimed; it does not prove that an agent or/],
    ["readme", /durable task state, not a\n+liveness probe/],
  ];
  const misleading = [
    ["agents", /status: in_progress proves (?:that )?(?:an agent|execution) is (?:live|running)/i],
    ["instructions", /Taking sets the status[^\n]*and proves[^\n]*(?:live|running)/i],
    ["readme", /in_progress[^\n]*means (?:an agent|execution) is (?:live|running)/i],
  ];

  for (const [name, pattern] of required) {
    if (!pattern.test(source[name])) errors.push(`${name}: missing ${pattern}`);
  }
  for (const [name, pattern] of misleading) {
    if (pattern.test(source[name])) errors.push(`${name}: misleading ${pattern}`);
  }
  return errors;
}

test("repository prose separates a task claim from live execution", () => {
  const source = sources();
  assert.equal(Object.keys(source).length, 3, "the guard read no source surface");
  assert.deepEqual(auditActivityLanguage(source), []);
});

test("NEGATIVE CONTROL: restoring status-based liveness claims fails the guard", () => {
  const source = sources();
  source.agents += "\nstatus: in_progress proves an agent is live.\n";
  source.instructions += "\nTaking sets the status and proves execution is running.\n";
  source.readme += "\nin_progress means an agent is running.\n";

  const errors = auditActivityLanguage(source);
  assert.equal(errors.length, 3, `the misleading fixtures escaped:\n${errors.join("\n")}`);
  assert.ok(errors.every((error) => error.includes("misleading")));
});
