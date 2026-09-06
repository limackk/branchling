/** API-backed adapters remain ordinary profile executables (TL-290). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HOME_ENV } from "../home.mjs";
import { logPathFor } from "../run-loop.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("agent-api-harness");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SECRET = "api-key-kept-out-of-branchling";

function run(args, env, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000, env });
}

function runAsync(args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
}

function startRemote(token) {
  const requests = [];
  const server = createServer((req, res) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      const body = JSON.parse(text || "{}");
      if (req.url === "/v1/chat/completions") {
        requests.push({
          shape: "compatible", authenticated: req.headers.authorization === "Bearer " + token,
          model: body.model, input: body.messages && body.messages[0] && body.messages[0].content,
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ tool: "write-proof" }) } }] }));
        return;
      }
      if (req.url === "/dispatch") {
        requests.push({
          shape: "different", authenticated: req.headers["x-harness-token"] === token,
          model: body.deployment, input: body.instructions,
        });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ result: { tool: "write-proof" } }));
        return;
      }
      res.statusCode = 404;
      res.end("unknown endpoint");
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ endpoint: "http://127.0.0.1:" + port, requests, close: () => new Promise((done) => server.close(done)) });
    });
  });
}

function writeAdapter(path, shape, endpoint, inputPath) {
  writeFileSync(path, [
    "#!/usr/bin/env node",
    'import { readFileSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const input = readFileSync(0, \"utf8\");",
    "writeFileSync(" + JSON.stringify(inputPath) + ", input, \"utf8\");",
    "const token = process.env.HARNESS_TOKEN;",
    "const compatible = " + JSON.stringify(shape === "compatible") + ";",
    "const response = await fetch(" + JSON.stringify(endpoint) + " + (compatible ? \"/v1/chat/completions\" : \"/dispatch\"), {",
    "  method: \"POST\",",
    "  headers: compatible ? { Authorization: \"Bearer \" + token, \"Content-Type\": \"application/json\" } : { \"X-Harness-Token\": token, \"Content-Type\": \"application/json\" },",
    "  body: JSON.stringify(compatible ? { model: process.env.BRANCHLING_MODEL, messages: [{ role: \"user\", content: input }] } : { deployment: process.env.BRANCHLING_MODEL, instructions: input }),",
    "});",
    "if (!response.ok) throw new Error(\"remote harness request failed\");",
    "const body = await response.json();",
    "const tool = compatible ? JSON.parse(body.choices[0].message.content).tool : body.result.tool;",
    "if (tool !== \"write-proof\") throw new Error(\"the harness received no executable tool instruction\");",
    "writeFileSync(join(process.env.BRANCHLING_REPOSITORY, process.env.BRANCHLING_TASK + \".done\"), \"done\\n\", \"utf8\");",
    "process.stderr.write(\"adapter diagnostic: \" + token + \"\\n\");",
  ].join("\n") + "\n", "utf8");
  chmodSync(path, 0o755);
}

function rewriteVerification(path, id) {
  const text = readFileSync(path, "utf8")
    .replace(/verification:[\s\S]*?\n---/, 'verification:\n  - id: remote-done\n    bash: "test -f ' + id + '.done"\n---')
    .replace(/\[proof:[^\]]*\]/g, "[proof: remote-done]");
  writeFileSync(path, text, "utf8");
}

test("two incompatible API harnesses close work without exposing credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-api-harness-"));
  const remote = await startRemote(SECRET);
  try {
    for (const shape of ["compatible", "different"]) {
      const repo = join(root, shape + "-repo");
      const backlog = join(repo, "backlog");
      const home = join(root, shape + "-home");
      const env = { ...process.env, NO_COLOR: "1", [HOME_ENV]: home, BACKLOG_STATE_DIR: join(root, shape + "-state"), HARNESS_TOKEN: SECRET };
      assert.equal(run(["init", "--dir", backlog, "--no-example"], env, root).status, 0);
      const created = run(["new", "--dir", backlog, "--title", "Remote harness contract"], env, repo);
      const id = created.stdout.match(/[A-Z]+-\d+/)[0];
      const taskPath = join(backlog, "tasks", readdirSync(join(backlog, "tasks")).find((file) => file.startsWith(id + "-")));
      rewriteVerification(taskPath, id);
      assert.equal(run(["build", "--dir", backlog], env, repo).status, 0);

      const inputPath = join(root, shape + "-adapter-input.txt");
      const adapter = join(root, shape + "-api-adapter");
      writeAdapter(adapter, shape, remote.endpoint, inputPath);
      const profile = run([
        "profile", "create", shape + "-api", "--adapter", adapter,
        "--model", shape + "-model", "--effort", "normal",
        "--prompt", "Use the remote harness and execute its tool response.",
        "--secret-env", "HARNESS_TOKEN",
      ], env, repo);
      assert.equal(profile.status, 0, profile.stderr);

      const result = await runAsync(["run", "--dir", backlog, "--actor", "agent:api", "--profile", shape + "-api"], env, repo);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /1 closed/);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(SECRET));
      assert.doesNotMatch(readFileSync(inputPath, "utf8"), new RegExp(SECRET));
      assert.ok(readFileSync(join(backlog, id + ".done"), "utf8"));

      const task = readFileSync(taskPath, "utf8");
      assert.doesNotMatch(task, new RegExp(SECRET));
      const log = readFileSync(logPathFor(backlog, id, { env }), "utf8");
      assert.doesNotMatch(log, new RegExp(SECRET));
      assert.match(log, /\[redacted HARNESS_TOKEN\]/);
    }

    assert.deepEqual(remote.requests.map((request) => request.shape), ["compatible", "different"]);
    for (const request of remote.requests) {
      assert.equal(request.authenticated, true, request.shape + " did not authenticate with the declared secret");
      assert.equal(request.model, request.shape + "-model");
      assert.match(request.input, /## Task/);
      assert.doesNotMatch(request.input, new RegExp(SECRET));
    }
    const dispatcher = readFileSync(join(SCRIPTS_DIR, "run-loop.mjs"), "utf8");
    assert.equal(dispatcher.includes("/v1/chat/completions"), false);
    assert.equal(dispatcher.includes("X-Harness-Token"), false);
  } finally {
    await remote.close();
    rmSync(root, { recursive: true, force: true });
  }
});
