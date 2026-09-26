/**
 * Removed telemetry stays out of the product's terminal text and rationale
 * (TL-427).
 *
 * TL-378 removed the activity collector and its reports, but inventories and
 * comments survived in four production files. Those sentences were especially
 * misleading because one of them is printed by `instructions autonomous-loop`.
 * This guard checks both that public output and the source rationale behind it;
 * tests may still name the old surface as historical evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("removed-telemetry-surface");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const PRODUCT_SOURCES = [
  "scripts/instructions.mjs",
  "scripts/run-loop.mjs",
  "scripts/home.mjs",
  "scripts/history.mjs",
];
const RETIRED_PROMISE = /\bactivity log\b|session <id>|\btwo logs\b|\bfocus\.mjs\b/gi;

function retiredPromises(name, text) {
  return [...text.matchAll(RETIRED_PROMISE)].map((match) => name + ": " + match[0]);
}

test("positive control: a retired telemetry promise is caught", () => {
  const found = retiredPromises("fixture.mjs", "The session <id> report joins two logs from the activity log.");
  assert.deepEqual(found, [
    "fixture.mjs: session <id>",
    "fixture.mjs: two logs",
    "fixture.mjs: activity log",
  ]);
});

test("production rationale does not promise removed telemetry", () => {
  const offenders = PRODUCT_SOURCES.flatMap((file) =>
    retiredPromises(file, readFileSync(join(REPO_ROOT, file), "utf8")));
  assert.equal(PRODUCT_SOURCES.length, 4, "the production-source sample is empty");
  assert.deepEqual(offenders, []);
});

test("autonomous-loop instructions do not print removed telemetry", () => {
  const result = spawnSync(process.execPath, [CLI, "instructions", "autonomous-loop"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.stdout.length > 1_000, "the instructions sample is empty");
  assert.deepEqual(retiredPromises("stdout", result.stdout), []);
});
