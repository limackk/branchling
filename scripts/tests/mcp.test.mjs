/**
 * `mcp` — the backlog over the Model Context Protocol (TL-146).
 *
 * WHAT HAS TO BE PROVED, and why each part needs its own control:
 *
 *   1. IT SPEAKS THE PROTOCOL. Driven over a real pipe, not by calling `handle`
 *      in-process: the transport is half of what a client depends on, and a test
 *      that skipped it would pass against a server that never wrote a line.
 *   2. EVERY TOOL ROUTES THROUGH THE CLI. Measured, not asserted about the
 *      source: the same call made over MCP and made in a shell must come back
 *      with the SAME text and the same success. That is the only way to show no
 *      rule lives in the adapter — a second validation would show up as a
 *      different wording, in either direction.
 *   3. A REFUSAL IS A REFUSAL. An unknown tool, an unknown flag and a bare actor
 *      are errors, with the positive control beside each of them: the very same
 *      call, made correctly, has to succeed. Without that pair a server that
 *      refused everything would be green.
 *   4. THE RESERVATION IS THE SAME ONE. `take` over MCP leaves the lock the CLI
 *      leaves, in the same file, under the same actor — otherwise two hosts
 *      would exclude each other only by accident.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../cli.mjs";
import { PRODUCT_NAME as N } from "../product.mjs";
import { TOPIC_NAMES } from "../instructions.mjs";
import { NOT_EXPOSED, buildArgv, exposedCommands, toolName, toolsList } from "../mcp-server.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("mcp");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-mcp-" + counter++ + "-"));
  const backlog = join(dir, "bl");
  const state = join(dir, "state");
  const env = { ...process.env, BACKLOG_STATE_DIR: state, NO_COLOR: "1" };
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", backlog, "--no-example"], { encoding: "utf8", env });
  assert.equal(init.status, 0, init.stderr);
  const made = spawnSync(process.execPath,
    [CLI, "new", "--dir", backlog, "--title", "A task to be taken", "--priority", "P1"],
    { encoding: "utf8", env });
  assert.equal(made.status, 0, made.stderr);
  const id = (made.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  return { dir, backlog, state, env, id };
}

/** Drive the server over a pipe and collect the responses, in order. */
function rpc(requests, { backlog, env }) {
  const input = requests.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const r = spawnSync(process.execPath, [CLI, "mcp", "--dir", backlog], {
    input, encoding: "utf8", env, timeout: 60_000,
  });
  assert.equal(r.status, 0, "the server exited badly: " + r.stderr);
  return r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const call = (name, args, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

// ── The protocol ──────────────────────────────────────────────────────────

test("it answers `initialize` and lists its tools over a pipe", () => {
  const fx = fixture();
  try {
    const out = rpc([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ], fx);

    // The notification is in the middle and gets NO answer — two responses for
    // three messages is the assertion that says so.
    assert.equal(out.length, 2, "a notification was answered: " + JSON.stringify(out));
    assert.equal(out[0].result.protocolVersion, "2025-06-18");
    assert.equal(out[0].result.serverInfo.name, N);
    const names = out[1].result.tools.map((t) => t.name);
    assert.ok(names.includes(toolName("query")), "the tool list has no `query`: " + names.join(" "));
    assert.ok(names.length > 10, "suspiciously few tools: " + names.length);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("a version nobody knows is answered in one we do, not refused", () => {
  const fx = fixture();
  try {
    const out = rpc([{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }], fx);
    assert.equal(out[0].error, undefined);
    assert.match(out[0].result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("an unknown method is an error, not a silent success", () => {
  const fx = fixture();
  try {
    const out = rpc([{ jsonrpc: "2.0", id: 7, method: "frobnicate" }], fx);
    assert.equal(out[0].id, 7);
    assert.equal(out[0].error.code, -32601);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── One code path, measured ───────────────────────────────────────────────

test("a tool call comes back with EXACTLY what the shell would have printed", () => {
  // The claim the whole design rests on: the adapter adds nothing. Compared
  // against a real shell run of the same command rather than against a string
  // written here, so a rule appearing in either layer breaks this.
  const fx = fixture();
  try {
    const out = rpc([call(toolName("query"), { json: true, status: "pending" })], fx);
    const shell = spawnSync(process.execPath, [CLI, "query", "--json", "--status", "pending", "--dir", fx.backlog],
      { encoding: "utf8", env: fx.env });
    assert.equal(out[0].result.isError, false, out[0].result.content[0].text);
    assert.equal(out[0].result.content[0].text, (shell.stdout + shell.stderr).trimEnd());
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("an unknown argument is refused — in the CLI's words, not this layer's", () => {
  const fx = fixture();
  try {
    const out = rpc([call(toolName("query"), { frobnicate: true })], fx);
    const shell = spawnSync(process.execPath, [CLI, "query", "--frobnicate", "--dir", fx.backlog],
      { encoding: "utf8", env: fx.env });
    assert.notEqual(shell.status, 0, "the fixture stopped demonstrating a refusal");
    assert.equal(out[0].result.isError, true, "an unknown flag went through");
    assert.equal(out[0].result.content[0].text, (shell.stdout + shell.stderr).trimEnd());
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("an unknown tool is an error that names what there is", () => {
  const fx = fixture();
  try {
    const out = rpc([call(N + "_frobnicate", {})], fx);
    assert.equal(out[0].result, undefined, "an unknown tool was answered as a result");
    assert.equal(out[0].error.code, -32602);
    assert.match(out[0].error.message, new RegExp(toolName("query")));
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

test("the commands that must not be tools are not tools, and say why", () => {
  const names = toolsList().map((t) => t.name);
  for (const [command, why] of Object.entries(NOT_EXPOSED)) {
    assert.ok(Object.prototype.hasOwnProperty.call(COMMANDS, command), command + " is not a command at all");
    assert.ok(!names.includes(toolName(command)), command + " is exposed as a tool");
    assert.ok(why.length > 20, command + " is excluded with no stated reason");
  }
  // POSITIVE CONTROL: the exclusion list is not the whole table.
  assert.ok(exposedCommands().length > Object.keys(NOT_EXPOSED).length * 3);
});

// ── The reservation ───────────────────────────────────────────────────────

test("`take` over MCP leaves the same lock, and a bare actor is refused", () => {
  const fx = fixture();
  try {
    const bare = rpc([call(toolName("take"), { args: [fx.id], actor: "claude" })], fx);
    assert.equal(bare[0].result.isError, true, "an actor with no namespace was accepted");
    assert.match(bare[0].result.content[0].text, /namespace/);

    // POSITIVE CONTROL: the same call with a namespaced actor succeeds — and
    // leaves the reservation the CLI leaves, in the same file.
    const good = rpc([call(toolName("take"), { args: [fx.id], actor: "agent:over-mcp" })], fx);
    assert.equal(good[0].result.isError, false, good[0].result.content[0].text);

    const locks = join(fx.state, "locks");
    const scopes = readdirSync(locks);
    assert.equal(scopes.length, 1, "the lock did not land in one scope: " + scopes.join(" "));
    const file = join(locks, scopes[0], fx.id + ".lock");
    assert.ok(existsSync(file), "no lock file where the CLI would have left one");
    assert.equal(JSON.parse(readFileSync(file, "utf8")).actor, "agent:over-mcp");

    // And the task file itself moved, which is what the reservation is for.
    const task = readdirSync(join(fx.backlog, "tasks")).find((f) => f.startsWith(fx.id + "-"));
    assert.match(readFileSync(join(fx.backlog, "tasks", task), "utf8"), /^owner: agent:over-mcp$/m);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The procedure travels ─────────────────────────────────────────────────

test("the phase guides are resources, rendered with this backlog's words", () => {
  const fx = fixture();
  try {
    const uri = N + "://instructions/task-execution";
    const out = rpc([
      { jsonrpc: "2.0", id: 1, method: "resources/list" },
      { jsonrpc: "2.0", id: 2, method: "resources/read", params: { uri } },
      { jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: N + "://instructions/nonsense" } },
    ], fx);

    const uris = out[0].result.resources.map((r) => r.uri);
    for (const topic of TOPIC_NAMES) {
      assert.ok(uris.includes(N + "://instructions/" + topic), "no resource for " + topic);
    }
    const text = out[1].result.contents[0].text;
    assert.match(text, new RegExp(N + " take"), "the guide did not come through");
    // Rendered, not a template: the placeholder machinery ran.
    assert.doesNotMatch(text, /\{\{/);

    assert.equal(out[2].result, undefined, "an unknown resource was answered as a result");
    assert.equal(out[2].error.code, -32602);
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});

// ── The pure parts ────────────────────────────────────────────────────────

test("the schema is DERIVED from the command's own usage, not written beside it", () => {
  const tools = toolsList();
  for (const t of tools) {
    const command = exposedCommands().find((c) => toolName(c) === t.name);
    const usage = String(COMMANDS[command].usage || "");
    assert.equal(t.description, COMMANDS[command].summary, t.name);
    for (const key of Object.keys(t.inputSchema.properties)) {
      if (key === "args") continue;
      assert.ok(usage.includes("--" + key), t.name + " declares --" + key + ", which is not in its usage");
    }
    // Open, so an undeclared property reaches the CLI and is refused there.
    assert.equal(t.inputSchema.additionalProperties, true, t.name);
  }
});

test("buildArgv turns one call into the argv a person would have typed", () => {
  assert.deepEqual(buildArgv("take", { args: ["TL-1"], actor: "agent:a" }), ["take", "TL-1", "--actor", "agent:a"]);
  // A false boolean is the ABSENCE of a flag: there is no `--json false` here.
  assert.deepEqual(buildArgv("query", { json: false, count: true }), ["query", "--count"]);
  // Repeatable flags repeat, which is how they are typed by hand.
  assert.deepEqual(buildArgv("renumber", { also: ["docs", "README.md"] }),
    ["renumber", "--also", "docs", "--also", "README.md"]);
  assert.deepEqual(buildArgv("stats", null), ["stats"]);
});
