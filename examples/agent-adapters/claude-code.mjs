#!/usr/bin/env node
/** A copyable adapter for an already authenticated Claude Code CLI. */
import { spawn, spawnSync } from "node:child_process";

const PREFIX = "BRANCHLING_";
const env = process.env;
const scenario = env[PREFIX + "CONFORMANCE_SCENARIO"];
function delegation() { return { policy: env[PREFIX + "DELEGATION"] || "provider", control: "requested", evidence: "prompt-directive" }; }

function conformance() {
  if (scenario === "cancelled") {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    child.kill();
    child.on("exit", () => console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, childPid: child.pid, delegation: delegation() })));
    return true;
  }
  if (env[PREFIX + "CONFORMANCE"] === "1") {
    console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, delegation: delegation() }));
    return true;
  }
  return false;
}

if (conformance()) process.exitCode = 0;
else if (env[PREFIX + "PROFILE_PROBE"] === "1") {
  const found = spawnSync("claude", ["--version"], { encoding: "utf8", env });
  console.log(JSON.stringify({ version: 1, outcome: found.status === 0 ? "ready" : "unavailable" }));
} else {
  const input = "## Delegation policy\n\n" + (delegation().policy === "branchling"
    ? "Branchling owns task dispatch. Do not create subagents or invoke Branchling queue commands."
    : delegation().policy === "hybrid" ? "Use subagents only for bounded work; Branchling owns task selection and closure."
      : "You may use this harness's own bounded delegation; Branchling owns task selection and closure.") + "\n\n" + await new Response(process.stdin).text();
  const args = ["--print", "--permission-mode", "acceptEdits"];
  if (env[PREFIX + "MODEL"]) args.push("--model", env[PREFIX + "MODEL"]);
  if (env[PREFIX + "EFFORT"]) args.push("--effort", env[PREFIX + "EFFORT"]);
  const child = spawnSync("claude", args, { cwd: env[PREFIX + "REPOSITORY"], env, input, encoding: "utf8" });
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  process.exitCode = child.status === null ? 1 : child.status;
}
