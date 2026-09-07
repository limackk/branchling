#!/usr/bin/env node
/** A copyable adapter for an authenticated Codex CLI subscription. */
import { spawn, spawnSync } from "node:child_process";

const PREFIX = "BRANCHLING_";
const env = process.env;
const scenario = env[PREFIX + "CONFORMANCE_SCENARIO"];
const EFFORTS = ["low", "medium", "high", "xhigh"];
function delegation() { return { policy: env[PREFIX + "DELEGATION"] || "provider", control: "requested", evidence: "prompt-directive" }; }

function conformance() {
  if (scenario === "cancelled") {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    child.kill(); child.on("exit", () => console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, childPid: child.pid, delegation: delegation() })));
    return true;
  }
  if (env[PREFIX + "CONFORMANCE"] === "1") { console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, delegation: delegation() })); return true; }
  return false;
}

if (conformance()) process.exitCode = 0;
else if (env[PREFIX + "PROFILE_PROBE"] === "1") {
  const found = spawnSync("codex", ["--version"], { shell: false, encoding: "utf8", env });
  console.log(JSON.stringify({ version: 1, outcome: found.status === 0 ? "ready" : "unavailable" }));
} else if (env[PREFIX + "MODEL_CATALOG"] === "1") {
  console.log(JSON.stringify({ version: 1, outcome: "not-verifiable", detail: env[PREFIX + "MODEL"] ? "Codex accepted the override but cannot list account-specific model aliases." : "No override: Codex will use its configured default model." }));
} else {
  const effort = String(env[PREFIX + "EFFORT"] || "").trim();
  if (effort && !EFFORTS.includes(effort)) {
    console.error("Codex CLI adapter accepts BRANCHLING_EFFORT only as: " + EFFORTS.join(", ") + ". Leave it empty to use Codex's default.");
    process.exitCode = 2;
  } else {
    const input = "## Delegation policy\n\n" + (delegation().policy === "branchling"
      ? "Branchling owns task dispatch. Do not create subagents or invoke Branchling queue commands."
      : delegation().policy === "hybrid" ? "Use subagents only for bounded work; Branchling owns task selection and closure."
        : "You may use this harness's own bounded delegation; Branchling owns task selection and closure.") + "\n\n" + await new Response(process.stdin).text();
    const args = ["exec", "--approve-for-me", "--color", "never", "-C", env[PREFIX + "REPOSITORY"]];
    // `-c` applies only to this Codex invocation, so profiles remain independent.
    if (effort) args.push("-c", "model_reasoning_effort=" + JSON.stringify(effort));
    if (env[PREFIX + "MODEL"]) args.push("--model", env[PREFIX + "MODEL"]);
    const child = spawnSync("codex", args, { shell: false, cwd: env[PREFIX + "REPOSITORY"], env, input, encoding: "utf8" });
    process.stdout.write(child.stdout || ""); process.stderr.write(child.stderr || ""); process.exitCode = child.status === null ? 1 : child.status;
  }
}
