#!/usr/bin/env node
/** A copyable adapter for an authenticated Codex CLI subscription. */
import { spawn, spawnSync } from "node:child_process";

const PREFIX = "BRANCHLING_";
const env = process.env;
const scenario = env[PREFIX + "CONFORMANCE_SCENARIO"];

function conformance() {
  if (scenario === "cancelled") {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]);
    child.kill(); child.on("exit", () => console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, childPid: child.pid })));
    return true;
  }
  if (env[PREFIX + "CONFORMANCE"] === "1") { console.log(JSON.stringify({ version: 1, scenario, outcome: scenario })); return true; }
  return false;
}

if (conformance()) process.exitCode = 0;
else if (env[PREFIX + "PROFILE_PROBE"] === "1") {
  const found = spawnSync("codex", ["--version"], { shell: false, encoding: "utf8", env });
  console.log(JSON.stringify({ version: 1, outcome: found.status === 0 ? "ready" : "unavailable" }));
} else if (env[PREFIX + "EFFORT"]) {
  console.error("Codex CLI adapter cannot map BRANCHLING_EFFORT; remove effort from this profile or configure it in Codex.");
  process.exitCode = 2;
} else {
  const input = await new Response(process.stdin).text();
  const args = ["exec", "--approve-for-me", "--color", "never", "-C", env[PREFIX + "REPOSITORY"]];
  if (env[PREFIX + "MODEL"]) args.push("--model", env[PREFIX + "MODEL"]);
  const child = spawnSync("codex", args, { shell: false, cwd: env[PREFIX + "REPOSITORY"], env, input, encoding: "utf8" });
  process.stdout.write(child.stdout || ""); process.stderr.write(child.stderr || ""); process.exitCode = child.status === null ? 1 : child.status;
}
