#!/usr/bin/env node
/** A copyable adapter for Aider, an API-backed coding harness. */
import { spawn, spawnSync } from "node:child_process";

const PREFIX = "BRANCHLING_";
const env = process.env;
const scenario = env[PREFIX + "CONFORMANCE_SCENARIO"];
function delegation() { return { policy: env[PREFIX + "DELEGATION"] || "provider", control: "enforced", evidence: "no-agent-tree" }; }

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
  const found = spawnSync("aider", ["--version"], { encoding: "utf8", env });
  console.log(JSON.stringify({ version: 1, outcome: found.status === 0 ? "ready" : "unavailable" }));
} else {
  const input = await new Response(process.stdin).text();
  const args = ["--yes", "--message", input];
  if (env[PREFIX + "MODEL"]) args.push("--model", env[PREFIX + "MODEL"]);
  if (env[PREFIX + "EFFORT"]) args.push("--reasoning-effort", env[PREFIX + "EFFORT"]);
  const child = spawnSync("aider", args, { cwd: env[PREFIX + "REPOSITORY"], env, encoding: "utf8" });
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  process.exitCode = child.status === null ? 1 : child.status;
}
