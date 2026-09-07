#!/usr/bin/env node
/** A copyable adapter for a local Ollama model already pulled on this machine. */
import { spawn, spawnSync } from "node:child_process";

const PREFIX = "BRANCHLING_";
const env = process.env;
const scenario = env[PREFIX + "CONFORMANCE_SCENARIO"];
function conformance() {
  if (scenario === "cancelled") { const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"]); child.kill(); child.on("exit", () => console.log(JSON.stringify({ version: 1, scenario, outcome: scenario, childPid: child.pid }))); return true; }
  if (env[PREFIX + "CONFORMANCE"] === "1") { console.log(JSON.stringify({ version: 1, scenario, outcome: scenario })); return true; }
  return false;
}
if (conformance()) process.exitCode = 0;
else if (env[PREFIX + "PROFILE_PROBE"] === "1") {
  const found = spawnSync("ollama", ["--version"], { shell: false, encoding: "utf8", env });
  console.log(JSON.stringify({ version: 1, outcome: found.status === 0 ? "ready" : "unavailable" }));
} else if (env[PREFIX + "MODEL_CATALOG"] === "1") {
  const listed = spawnSync("ollama", ["list", "--format", "json"], { shell: false, encoding: "utf8", env });
  if (listed.status !== 0) console.log(JSON.stringify({ version: 1, outcome: "unavailable" }));
  else {
    try {
      const models = String(listed.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line).name).filter((name) => typeof name === "string");
      console.log(JSON.stringify({ version: 1, outcome: "listed", models }));
    } catch { console.log(JSON.stringify({ version: 1, outcome: "unavailable" })); }
  }
} else if (!env[PREFIX + "MODEL"]) {
  console.error("Ollama adapter needs BRANCHLING_MODEL; pull a model and set this profile's model, for example `ollama pull qwen2.5-coder:7b`."); process.exitCode = 2;
} else {
  const input = await new Response(process.stdin).text();
  const args = ["run", env[PREFIX + "MODEL"]];
  if (env[PREFIX + "EFFORT"]) args.push("--think", env[PREFIX + "EFFORT"]);
  const child = spawnSync("ollama", args, { shell: false, cwd: env[PREFIX + "REPOSITORY"], env, input, encoding: "utf8" });
  process.stdout.write(child.stdout || ""); process.stderr.write(child.stderr || ""); process.exitCode = child.status === null ? 1 : child.status;
}
