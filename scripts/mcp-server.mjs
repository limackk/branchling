#!/usr/bin/env node
/**
 * `mcp` — the backlog over the Model Context Protocol, on stdio (TL-146).
 *
 * WHY IT EXISTS. Claude Code runs shell commands natively, so for it the CLI is
 * the whole interface and `instructions` hands it the procedure. Every other
 * agent host — Codex, Gemini CLI, Kiro, an IDE — reaches a tool through MCP, so
 * without this the door is shut before any of the differences that matter (a
 * `done` that refuses, a log with an actor and a reason, an atomic reservation)
 * can be compared with anything.
 *
 * WHY IT IS A THIN ADAPTER AND NOT A SECOND INTERFACE. Law 4 is what makes it
 * thin: every reading command already answers in a `--json` envelope and every
 * writing one is callable from outside, so this file maps tools onto those two
 * surfaces and adds NOTHING of its own. In particular it does NOT validate.
 * Every call is spawned through `cli.mjs`, the same entry point a shell uses, so
 * an unknown flag, a bare actor, a missing reason and a failed contract come
 * back as the CLI's own refusal with the CLI's own exit code. A rule that lived
 * here would be a rule the CLI does not enforce — the divergence the four laws
 * exist to prevent — and the schema below is DERIVED from the command table for
 * the same reason `--help --json` is (TL-83): a second table drifts.
 *
 * THE SCHEMA IS OPEN ON PURPOSE. `additionalProperties` is true, so a property
 * nobody declared becomes a flag and the CLI refuses it. Rejecting it here
 * instead would move the refusal into this layer and change its wording.
 *
 * WHY NO SDK AND NO DEPENDENCY. The stdio transport is newline-delimited
 * JSON-RPC 2.0; `readline` and `JSON.parse` are the whole of it. Zero
 * dependencies is a property of this package worth more than the few dozen
 * lines below.
 *
 * WHAT IS DELIBERATELY NOT EXPOSED: see `NOT_EXPOSED`. And no transport other
 * than stdio — HTTP belongs to the hosted mode, which §8 of
 * `docs/worktrail-state-and-sync.md` says is not built yet.  product-name: allow
 *
 * Tests: `node --test scripts/tests/mcp.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, describeFlags } from "./cli.mjs";
import { TOPIC_NAMES } from "./instructions.mjs";
import { PRODUCT_NAME as N, PRODUCT_VERSION } from "./product.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "cli.mjs");

/**
 * The MCP revisions this server will answer in. A client asking for one of
 * these is answered in its own; anything else is answered in the newest we
 * know, which is what the specification asks a server to do rather than
 * failing a handshake over a version nobody has heard of yet.
 */
export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/**
 * Commands that must not become tools, each for a reason that would break the
 * call rather than merely be unhelpful.
 */
export const NOT_EXPOSED = {
  serve: "starts a long-lived HTTP server and opens a browser; a tool call has to return",
  mcp: "this server itself — a client would be starting a second copy of what it is already talking to",
  run: "drives an agent per task — a dispatcher inside a dispatcher, and it never returns quickly",
  "regen-hook": "reads an editor hook's JSON on stdin, which is this server's transport",
};

/** `next-id` becomes `<product>_next_id`: the character set MCP tool names use. */
export function toolName(command) {
  return (N + "_" + String(command)).replace(/[^A-Za-z0-9_]/g, "_");
}

/** Which commands this server offers, in the table's own order. */
export function exposedCommands() {
  return Object.keys(COMMANDS).filter((name) => !Object.prototype.hasOwnProperty.call(NOT_EXPOSED, name));
}

/**
 * One tool, described from the command's own usage text.
 *
 * `args` carries the POSITIONALS — a task id, a file — because `describeFlags`
 * knows only about flags, and a schema without them could not express
 * `take TL-1`. Everything else is a flag under its own name.
 */
export function toolSchema(name, spec) {
  const properties = {
    args: {
      type: "array",
      items: { type: "string" },
      description: "positional arguments, in order (for example a task id)",
    },
  };
  const required = [];
  for (const f of describeFlags(spec.usage)) {
    const key = f.flag.replace(/^--/, "");
    properties[key] = f.arg
      ? { type: "string", description: "value for `" + f.flag + "` " + f.arg }
      : { type: "boolean", description: "pass `" + f.flag + "`" };
    if (f.required) required.push(key);
  }
  return {
    name: toolName(name),
    description: spec.summary,
    inputSchema: {
      type: "object",
      properties,
      required,
      // OPEN, on purpose — see the header. An undeclared property becomes a
      // flag and the CLI refuses it, in the CLI's own words.
      additionalProperties: true,
    },
  };
}

export function toolsList() {
  return exposedCommands().map((name) => toolSchema(name, COMMANDS[name]));
}

/**
 * The argv one tool call becomes. PURE.
 *
 * A `false` boolean is the ABSENCE of a flag and not a flag with a value: there
 * is no `--json false` in this CLI, and inventing one would be this layer
 * having an opinion. An array repeats the flag, which is how the repeatable
 * ones (`--also`, `--append-<field>`) are typed by hand.
 */
export function buildArgv(command, input) {
  const argv = [command];
  const obj = input && typeof input === "object" ? input : {};
  for (const a of Array.isArray(obj.args) ? obj.args : []) argv.push(String(a));
  for (const [key, value] of Object.entries(obj)) {
    if (key === "args") continue;
    const flag = "--" + key;
    const one = (v) => {
      if (v === true) return void argv.push(flag);
      if (v === false || v === null || v === undefined) return;
      argv.push(flag, String(v));
    };
    if (Array.isArray(value)) for (const v of value) one(v);
    else one(value);
  }
  return argv;
}

/**
 * Run one command exactly as a shell would.
 *
 * A SERVER STARTED WITH `--dir` PASSES IT ON AS `BACKLOG_DIR`, not as a flag.
 * `resolveBacklogDir` already reads that variable, second only to an explicit
 * `--dir`, so one line covers every command — including the several whose usage
 * does not document `--dir` although they accept it, where injecting a flag
 * would have silently missed. A caller naming its own `--dir` still outranks it,
 * because that order is the resolver's and is not decided here.
 */
export function callCli(command, input, opts = {}) {
  const argv = buildArgv(command, input);
  const env = { ...process.env, NO_COLOR: "1" };
  if (opts.dir) env.BACKLOG_DIR = opts.dir;
  const r = spawnSync(process.execPath, [CLI].concat(argv), {
    encoding: "utf8",
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { exit: 1, text: "could not start " + N + ": " + r.error.message };
  const text = (String(r.stdout || "") + String(r.stderr || "")).trimEnd();
  return { exit: r.signal ? 0 : (r.status === null ? 1 : r.status), text };
}

// ──────────────────────────────────────────────────────────────────────────
// Resources — the procedure, in this backlog's vocabulary
// ──────────────────────────────────────────────────────────────────────────

/** `<product>://instructions/<topic>` for every topic the tool prints. */
export function resourcesList() {
  return TOPIC_NAMES.map((topic) => ({
    uri: N + "://instructions/" + topic,
    name: N + " instructions " + topic,
    description: "the procedure for this phase, rendered with THIS backlog's vocabulary",
    mimeType: "text/plain",
  }));
}

export function readResource(uri, opts = {}) {
  const prefix = N + "://instructions/";
  const topic = String(uri || "").startsWith(prefix) ? String(uri).slice(prefix.length) : null;
  if (!topic || TOPIC_NAMES.indexOf(topic) < 0) return null;
  const r = callCli("instructions", { args: [topic] }, opts);
  return { uri, mimeType: "text/plain", text: r.text };
}

// ──────────────────────────────────────────────────────────────────────────
// JSON-RPC
// ──────────────────────────────────────────────────────────────────────────

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * One request in, one response out — or null for a notification, which by the
 * protocol gets no answer at all.
 *
 * An unknown method and an unknown tool are both ERRORS. The reason is the one
 * `cli.mjs` gives for its own closed table: a call that is quietly ignored looks
 * exactly like a call that worked.
 */
export function handle(msg, opts = {}) {
  const id = msg && Object.prototype.hasOwnProperty.call(msg, "id") ? msg.id : undefined;
  const method = msg && msg.method;
  const isNotification = id === undefined;

  if (method === "initialize") {
    const asked = msg.params && msg.params.protocolVersion;
    return ok(id, {
      protocolVersion: PROTOCOL_VERSIONS.indexOf(asked) >= 0 ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: N, version: PRODUCT_VERSION || "0.0.0" },
    });
  }
  if (isNotification) return null;
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: toolsList() });
  if (method === "resources/list") return ok(id, { resources: resourcesList() });

  if (method === "resources/read") {
    const uri = msg.params && msg.params.uri;
    const found = readResource(uri, opts);
    if (!found) {
      return err(id, -32602, "unknown resource: " + uri + "\navailable: " +
        resourcesList().map((r) => r.uri).join(" "));
    }
    return ok(id, { contents: [found] });
  }

  if (method === "tools/call") {
    const asked = msg.params && msg.params.name;
    const command = exposedCommands().find((c) => toolName(c) === asked);
    if (!command) {
      return err(id, -32602, "unknown tool: " + asked + "\navailable: " +
        toolsList().map((t) => t.name).join(" "));
    }
    const r = callCli(command, msg.params.arguments, opts);
    return ok(id, {
      // The CLI's exit code, carried as MCP's own word for a failure. A refusal
      // is an answer here exactly as it is in a shell: the text is the CLI's.
      isError: r.exit !== 0,
      content: [{ type: "text", text: r.text || "(no output, exit " + r.exit + ")" }],
    });
  }

  return err(id, -32601, "unknown method: " + method);
}

const USAGE = [
  `${N} mcp [--dir <path>]`,
  "",
  "  Speaks the Model Context Protocol over stdio, so an agent that is not a shell",
  "  can read and write this backlog. Every tool is one of this tool's own commands",
  "  and every refusal is that command's own — nothing is validated here.",
  "",
  "  --dir <path>       the backlog to serve. Without it each call resolves the",
  "                     directory the way the CLI does, from the working directory",
  "                     the client started this server in",
  "",
  "  Started by an MCP client, not by hand: it reads JSON-RPC on stdin and writes",
  "  it on stdout, so anything else printed there would corrupt the stream.",
].join("\n");

export function main(argv) {
  if (argv.some((a) => ["--help", "-h", "help"].includes(a))) {
    console.log(USAGE);
    return 0;
  }
  let dir = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") { dir = argv[++i] || null; continue; }
    rest.push(argv[i]);
  }
  if (rest.length) {
    // The same rule as everywhere else: an unknown argument FAILS. A server that
    // started anyway would be serving a backlog nobody chose.
    console.error(`${N} mcp: unknown argument: ` + rest.join(" "));
    console.error("  usage: " + USAGE.split("\n")[0]);
    return 2;
  }
  return listen({ dir });
}

/** The read loop. Split out so a test can drive `handle` without a process. */
export function listen(opts) {
  const rl = createInterface({ input: process.stdin });
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return void send(err(null, -32700, "parse error"));
    }
    let response;
    try {
      response = handle(msg, opts);
    } catch (e) {
      response = err(msg && msg.id !== undefined ? msg.id : null, -32603, String(e && e.message));
    }
    if (response) send(response);
  });
  rl.on("close", () => process.exit(0));
  return null;
}

if (process.argv[1] && process.argv[1].endsWith("mcp-server.mjs")) {
  const code = main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
