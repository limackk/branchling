/** Offline conformance is an adapter contract, not a provider test (TL-296). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONFORMANCE_ENV, CONFORMANCE_SCENARIO_ENV, CONFORMANCE_SCENARIOS,
  CONFORMANCE_SECRET_ENV, CONFORMANCE_SENTINEL, CONFORMANCE_VERSION,
  CONFORMANCE_VERSION_ENV,
} from "../adapter-conformance.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-adapter-conformance");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const PREFIX = PRODUCT_NAME.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

function cli(args, env = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 120_000, env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

function adapter(root, name, source, shebang = "#!/usr/bin/env node") {
  const file = join(root, name);
  writeFileSync(file, shebang + "\n" + source + "\n", "utf8");
  chmodSync(file, 0o755);
  return file;
}

function compatibleAdapter(root, witness) {
  return adapter(root, "compatible-adapter.sh", [
    "input=$(cat)",
    "printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + CONFORMANCE_ENV + "\" \"$" + CONFORMANCE_VERSION_ENV + "\" \"$" + PREFIX + "_ACTOR\" \"$" + PREFIX + "_ROLE\" \"$" + PREFIX + "_TASK\" \"$" + PREFIX + "_DIR\" \"$" + PREFIX + "_REPOSITORY\" \"$" + PREFIX + "_PROMPT\" \"$" + PREFIX + "_MODEL\" \"$" + PREFIX + "_EFFORT\" >> " + JSON.stringify(witness),
    "printf '%s' \"$input\" > " + JSON.stringify(witness + ".input"),
    "printf '%s' \"$" + CONFORMANCE_SECRET_ENV + "\" >&2",
    "if [ \"$" + CONFORMANCE_SCENARIO_ENV + "\" = cancelled ]; then",
    "  sleep 30 & child=$!",
    "  kill \"$child\"",
    "  wait \"$child\" 2>/dev/null",
    "  printf '{\"version\":1,\"scenario\":\"%s\",\"outcome\":\"%s\",\"childPid\":%s,\"delegation\":{\"policy\":\"%s\",\"control\":\"requested\",\"evidence\":\"prompt-directive\"}}' \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$child\" \"$" + PREFIX + "_DELEGATION\"",
    "else",
    "  printf '{\"version\":1,\"scenario\":\"%s\",\"outcome\":\"%s\",\"delegation\":{\"policy\":\"%s\",\"control\":\"requested\",\"evidence\":\"prompt-directive\"}}' \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + PREFIX + "_DELEGATION\"",
    "fi",
  ].join("\n"), "#!/bin/sh");
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

test("a compatible adapter passes every offline outcome in human and JSON modes without leaking its sentinel", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-conformance-test-"));
  try {
    const witness = join(root, "received.jsonl");
    const executable = compatibleAdapter(root, witness);
    const human = cli(["conformance", "--adapter", executable]);
    assert.equal(human.status, 0, human.stdout + human.stderr);
    assert.match(human.stdout, /adapter conformance passed/);
    for (const scenario of CONFORMANCE_SCENARIOS) assert.match(human.stdout, new RegExp("✓ " + scenario.id + " \\[provider\\]  " + scenario.outcome));
    assert.equal(human.stdout.includes(CONFORMANCE_SENTINEL), false, "a secret reached human output");
    assert.equal(human.stderr.includes(CONFORMANCE_SENTINEL), false, "a secret reached diagnostics");

    const json = cli(["conformance", "--adapter", executable, "--json"]);
    assert.equal(json.status, 0, json.stdout + json.stderr);
    const out = JSON.parse(json.stdout);
    assert.equal(out.kind, "adapter-conformance");
    assert.equal(out.ok, true);
    assert.equal(out.version, CONFORMANCE_VERSION);
    assert.equal(out.results.length, CONFORMANCE_SCENARIOS.length * 3);
    assert.ok(out.results.every((row) => ["provider", "branchling", "hybrid"].includes(row.delegation)));
    assert.ok(out.results.every((row) => row.outcome && row.ok));
    assert.deepEqual(out.failures, []);
    assert.equal(json.stdout.includes(CONFORMANCE_SENTINEL), false, "a secret reached JSON");
    assert.equal(json.stderr.includes(CONFORMANCE_SENTINEL), false, "a secret reached JSON diagnostics");

    const seen = readFileSync(witness, "utf8").trim().split("\n").map((line) => line.split("\t"));
    assert.equal(seen.length, CONFORMANCE_SCENARIOS.length * 2 * 3, "one invocation per policy and scenario in each output mode");
    const sample = seen[0];
    assert.equal(sample[1], "1");
    assert.equal(sample[2], String(CONFORMANCE_VERSION));
    assert.equal(sample[3], "agent:conformance");
    assert.equal(sample[4], "conformance");
    assert.equal(sample[5], "TL-CONFORMANCE-1");
    assert.match(sample[6], /repository\/backlog$/);
    assert.match(sample[7], /repository$/);
    assert.equal(sample[8], "Prove the adapter contract from evidence only.");
    assert.equal(sample[9], "conformance-model");
    assert.equal(sample[10], "careful");
    const input = readFileSync(witness + ".input", "utf8");
    assert.match(input, /## Role brief \(repository\)/);
    assert.match(input, /## Profile prompt \(local\)/);
    assert.match(input, /## Task/);
    assert.match(input, /THE PREVIOUS ATTEMPT DID NOT CLOSE THIS TASK/);
    assert.match(input, /malformed JSON/);
    assert.equal(existsSync(join(root, "backlog")), false, "the command wrote a run artifact beside the adapter");
  } finally {
    cleanup(root);
  }
});

test("an adapter cannot call an instruction an enforced delegation guarantee", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-conformance-delegation-"));
  try {
    const executable = adapter(root, "false-enforced.sh", [
      "cat >/dev/null",
      "printf '{\"version\":1,\"scenario\":\"%s\",\"outcome\":\"%s\",\"delegation\":{\"policy\":\"%s\",\"control\":\"enforced\",\"evidence\":\"prompt-directive\"}}' \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + CONFORMANCE_SCENARIO_ENV + "\" \"$" + PREFIX + "_DELEGATION\"",
    ].join("\n"), "#!/bin/sh");
    const result = cli(["conformance", "--adapter", executable, "--json"]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.ok(report.failures.every((row) => row.problem === "enforced delegation has no enforceable adapter evidence"));
  } finally { cleanup(root); }
});

test("malformed and unavailable adapters fail deterministically without exposing their output", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-conformance-negative-"));
  try {
    const malformed = adapter(root, "malformed-adapter.mjs", 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("not json"));');
    const bad = cli(["conformance", "--adapter", malformed, "--json"]);
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    const badOut = JSON.parse(bad.stdout);
    assert.equal(badOut.ok, false);
    assert.equal(badOut.failures.length, CONFORMANCE_SCENARIOS.length * 3);
    assert.ok(badOut.failures.every((row) => row.problem === "adapter did not return one JSON response"));
    assert.equal(readdirSync(root).sort().join(","), "malformed-adapter.mjs", "a failed probe changed the adapter directory");

    const unavailable = cli(["conformance", "--adapter", join(root, "not-installed"), "--json"]);
    assert.equal(unavailable.status, 1, unavailable.stdout + unavailable.stderr);
    const unavailableOut = JSON.parse(unavailable.stdout);
    assert.ok(unavailableOut.failures.every((row) => row.problem === "adapter could not be started"));
  } finally {
    cleanup(root);
  }
});

test("the command refuses a missing adapter and an unknown flag as usage errors", () => {
  const missing = cli(["conformance"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--adapter/);
  const unknown = cli(["conformance", "--adapter", "adapter", "--provider"]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown flag: --provider/);
});
