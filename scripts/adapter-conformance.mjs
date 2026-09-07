#!/usr/bin/env node
/**
 * Offline conformance for one profile adapter (TL-296).
 *
 * A profile adapter is an executable boundary, not a provider integration. The
 * normal launcher therefore has no response protocol beyond stdin, environment
 * and its process exit. Requiring JSON there would change every existing
 * wrapper. This command enables a second, TEST-ONLY mode instead: the adapter
 * sees an explicit environment flag and answers one small JSON object for each
 * requested scenario. A provider is never contacted and a real task is never
 * claimed.
 *
 * The response is deliberately an assertion rather than provider prose:
 *
 *   { "version": 1, "scenario": "timeout", "outcome": "timeout" }
 *
 * `scenario` prevents a wrapper from returning one canned success response;
 * `outcome` proves its own translation from provider errors; and `version`
 * lets this contract grow without making a formerly green adapter ambiguous.
 * In the cancellation scenario the adapter additionally reports the PID of a
 * child it terminated before responding. The harness checks that PID is gone.
 *
 * Tests: `node --test scripts/tests/agent-adapter-conformance.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adapterEnvironment, profileInput } from "./run-loop.mjs";
import { DELEGATION_ENFORCEMENT, DELEGATION_POLICIES } from "./agent-contract.mjs";
import { printJson } from "./json-envelope.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

export const CONFORMANCE_VERSION = 1;
export const CONFORMANCE_SCENARIOS = [
  { id: "success", outcome: "success" },
  { id: "task-failure", outcome: "task-failure" },
  { id: "unavailable", outcome: "unavailable" },
  { id: "authentication-refused", outcome: "authentication-refused" },
  { id: "quota-refused", outcome: "quota-refused" },
  { id: "cancelled", outcome: "cancelled" },
  { id: "timeout", outcome: "timeout" },
];

const PREFIX = String(N).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
export const CONFORMANCE_ENV = PREFIX + "_CONFORMANCE";
export const CONFORMANCE_VERSION_ENV = PREFIX + "_CONFORMANCE_VERSION";
export const CONFORMANCE_SCENARIO_ENV = PREFIX + "_CONFORMANCE_SCENARIO";
export const CONFORMANCE_SECRET_ENV = PREFIX + "_CONFORMANCE_SECRET";
export const CONFORMANCE_SENTINEL = "conformance-secret-must-not-leak";
export const CONFORMANCE_DELEGATION_POLICIES = DELEGATION_POLICIES;
export const CONFORMANCE_FLAGS = ["--adapter", "--timeout", "--json", "--help"];

const TASK_ID = "TL-CONFORMANCE-1";
const ROLE = "conformance";
const PROMPT = "Prove the adapter contract from evidence only.";
const RETRY_FEEDBACK = "The previous conformance attempt returned malformed JSON.";

const TASK_TEXT = [
  "---",
  "id: " + TASK_ID,
  'title: "Offline adapter conformance"',
  "---",
  "",
  "## Goal",
  "",
  "Prove this profile adapter against the offline process contract.",
  "",
].join("\n");

export function parseConformanceArgs(args) {
  const plan = { adapter: null, timeout: 5, json: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") { plan.json = true; continue; }
    if (arg === "--help") { plan.help = true; continue; }
    if (arg === "--adapter" || arg === "--timeout") {
      const value = args[++i];
      if (value === undefined || !String(value).trim()) throw new Error("`" + arg + "` with no value");
      plan[arg.slice(2)] = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error("unknown flag: " + arg + "\navailable: " + CONFORMANCE_FLAGS.join(" "));
    throw new Error("unexpected argument: " + arg + "\nusage: " + N + " conformance --adapter <executable>");
  }
  if (plan.help) return plan;
  if (!plan.adapter) throw new Error("`--adapter <executable>` is required");
  const timeout = Number(plan.timeout);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60) {
    throw new Error("`--timeout` must be a whole number from 1 to 60 seconds");
  }
  plan.timeout = timeout;
  return plan;
}

export function conformanceInput() {
  return profileInput(TASK_TEXT, "Exercise the stable adapter process boundary.", PROMPT, RETRY_FEEDBACK, true);
}

function disposableContext() {
  const root = mkdtempSync(join(tmpdir(), N + "-conformance-"));
  const repository = join(root, "repository");
  const backlog = join(repository, "backlog");
  mkdirSync(join(backlog, "tasks"), { recursive: true });
  writeFileSync(join(backlog, "tasks", TASK_ID + ".md"), TASK_TEXT, "utf8");
  return { root, repository, backlog };
}

function responseProblem(response, scenario, delegation) {
  if (!response || Array.isArray(response) || typeof response !== "object") return "response is not a JSON object";
  if (response.version !== CONFORMANCE_VERSION) return "response version is not " + CONFORMANCE_VERSION;
  if (response.scenario !== scenario.id) return "response scenario does not echo `" + scenario.id + "`";
  if (response.outcome !== scenario.outcome) return "response outcome is not `" + scenario.outcome + "`";
  const declared = response.delegation;
  if (!declared || typeof declared !== "object") return "response has no delegation declaration";
  if (declared.policy !== delegation) return "response delegation policy does not echo `" + delegation + "`";
  if (!DELEGATION_ENFORCEMENT.includes(declared.control)) return "response delegation control is not declared";
  if (declared.control === "enforced" && !["native-flag", "no-agent-tree"].includes(declared.evidence)) {
    return "enforced delegation has no enforceable adapter evidence";
  }
  if (declared.control === "requested" && declared.evidence !== "prompt-directive") {
    return "requested delegation must report a prompt directive";
  }
  if (declared.control === "unsupported" && declared.evidence !== "none") {
    return "unsupported delegation must report no enforcement evidence";
  }
  if (scenario.id === "cancelled") {
    if (!Number.isInteger(response.childPid) || response.childPid < 1) {
      return "cancelled response has no positive integer `childPid`";
    }
    try {
      process.kill(response.childPid, 0);
      return "cancelled response names a child process that is still alive";
    } catch (error) {
      if (error && error.code === "ESRCH") return null;
      return "could not confirm that the cancelled child process ended";
    }
  }
  return null;
}

function runScenario(plan, context, scenario, delegation) {
  const profile = {
    name: "conformance", adapter: plan.adapter, model: "conformance-model",
    effort: "careful", prompt: PROMPT, secret_env: CONFORMANCE_SECRET_ENV,
  };
  const task = { id: TASK_ID, role: ROLE, profile, delegation, delegationEnforcement: "unsupported" };
  const env = {
    ...adapterEnvironment({ actor: "agent:conformance", root: context.backlog, cwd: context.repository, plan: { delegation } }, task, {
      PATH: process.env.PATH || "", [CONFORMANCE_SECRET_ENV]: CONFORMANCE_SENTINEL,
    }),
    [CONFORMANCE_ENV]: "1",
    [CONFORMANCE_VERSION_ENV]: String(CONFORMANCE_VERSION),
    [CONFORMANCE_SCENARIO_ENV]: scenario.id,
  };
  const child = spawnSync(plan.adapter, [], {
    shell: false, cwd: context.repository, env, encoding: "utf8",
    input: conformanceInput(), timeout: plan.timeout * 1000, maxBuffer: 64 * 1024,
  });
  if (child.error && child.error.code === "ETIMEDOUT") return { scenario: scenario.id, outcome: null, ok: false, problem: "adapter process timed out" };
  if (child.error) return { scenario: scenario.id, outcome: null, ok: false, problem: "adapter could not be started" };
  if (child.status !== 0) return { scenario: scenario.id, outcome: null, ok: false, problem: "adapter exited non-zero" };
  let response;
  try {
    response = JSON.parse(String(child.stdout || "").trim());
  } catch {
    return { scenario: scenario.id, outcome: null, ok: false, problem: "adapter did not return one JSON response" };
  }
  const problem = responseProblem(response, scenario, delegation);
  return { scenario: scenario.id, delegation, outcome: response.outcome || null, ok: !problem, problem: problem || null };
}

export function runConformance(plan) {
  const context = disposableContext();
  try {
    const results = CONFORMANCE_DELEGATION_POLICIES.flatMap((delegation) =>
      CONFORMANCE_SCENARIOS.map((scenario) => runScenario(plan, context, scenario, delegation)));
    return { ok: results.every((result) => result.ok), version: CONFORMANCE_VERSION, adapter: plan.adapter, results,
      failures: results.filter((result) => !result.ok) };
  } finally {
    rmSync(context.root, { recursive: true, force: true });
  }
}

function humanReport(result) {
  const rows = result.results.map((row) => "  " + (row.ok ? "✓" : "✗") + " " + row.scenario + " [" + row.delegation + "]  " + (row.ok ? row.outcome : row.problem));
  return [
    result.ok ? "✓ adapter conformance passed — protocol v" + result.version : "✗ adapter conformance failed — protocol v" + result.version,
    "  adapter: " + result.adapter,
    "", ...rows,
  ].join("\n");
}

export function run(argv) {
  let plan;
  try {
    plan = parseConformanceArgs(argv);
  } catch (error) {
    console.error(failure(N + " conformance", error.message, [], [N + " conformance --help"]));
    return 2;
  }
  if (plan.help) {
    console.log([
      "usage: " + N + " conformance --adapter <executable> [--timeout <seconds>] [--json]",
      "", "  offline only; the adapter receives one test-only JSON scenario at a time.",
      "  flags: " + CONFORMANCE_FLAGS.filter((flag) => flag !== "--help").join(" "),
    ].join("\n"));
    return 0;
  }
  const result = runConformance(plan);
  if (plan.json) printJson("adapter-conformance", result);
  else if (result.ok) console.log(humanReport(result));
  else console.error(failure(N + " conformance", "adapter does not satisfy the conformance contract",
    result.failures.map((row) => row.scenario + ": " + row.problem), [N + " conformance --help"]));
  return result.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("adapter-conformance.mjs")) process.exit(run(process.argv.slice(2)));
