#!/usr/bin/env node
/**
 * The Claude Code cost adapter — tokens off the end of a session (TL-30).
 *
 * A PLUGIN, NOT A DEPENDENCY, and the shape of this file is that decision made
 * literal. §7 of docs/backlog-time-tracking.md (a real path — product-name:
 * allow) requires the module's core to work over somebody else's process, so
 * NOTHING in `scripts/` may import this file. Its own test may, and does; the
 * guard is `grep -rl cost-adapter scripts/ --include=*.mjs`, which must find
 * this file and its test and nothing else.
 *
 * That constraint is why it reaches the log through `record()` rather than
 * writing rows itself: attribution, throttling and the session key are decided
 * in exactly one place, and an adapter that duplicated them would be a second
 * answer to "whose task was this" — the question §8 exists to settle.
 *
 * HOW IT IS WIRED. Claude Code's `SessionEnd` hook, which hands it a JSON
 * payload on stdin carrying `transcript_path`, `session_id` and `cwd`:
 *
 *   node <path>/scripts/cost-adapter.mjs
 *
 * It can also be pointed at a transcript by hand, which is what makes it
 * testable and what makes it usable from a host that fires no hook:
 *
 *   node scripts/cost-adapter.mjs --transcript <file> [--task TL-1] [--dir <path>]
 *
 * ONE ROW PER MODEL, never one row per session. Tokens of two models are two
 * different units of effort (§10), and a row carrying their sum could not be
 * priced at all — `model` is a single value on a row precisely so that this
 * cannot be written.
 *
 * WHAT IT DOES NOT DO. It does not invent a task: if no leg of the attribution
 * chain names one, `record()` writes nothing and says so. A session's tokens
 * belong to a task or to nobody; splitting them across every task touched would
 * be a guess with a number attached.
 *
 * Tests: `node --test scripts/tests/cost-adapter.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readPayload, record, signalsFromPayload } from "./activity-command.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Tokens per model from a Claude Code transcript. PURE — text in, rows out.
 *
 * A TRANSCRIPT IS JSONL AND A LINE MAY BE ANYTHING. It is written by another
 * program, it is appended to while a session runs, and the last line of a
 * killed session is routinely half-written — so an unreadable line is SKIPPED,
 * never fatal. A cost adapter that threw on a truncated transcript would fail
 * exactly at the end of the sessions that ended badly.
 *
 * CACHE TOKENS COUNT AS INPUT, because that is how they are billed and because
 * a report that dropped them would understate a long session by most of its
 * cost. Reads are billed at a discount the rate here cannot express; that
 * inaccuracy is stated in the document rather than hidden behind a second rate
 * this file would have to guess at.
 */
export function usageFromTranscript(text) {
  const byModel = new Map();
  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row;
    try { row = JSON.parse(trimmed); } catch { continue; }
    const message = row && (row.message || row);
    const usage = message && message.usage;
    if (!usage || typeof usage !== "object") continue;
    const model = String((message && message.model) || row.model || "").trim();
    if (!model) continue;
    const inTok = whole(usage.input_tokens) + whole(usage.cache_creation_input_tokens) + whole(usage.cache_read_input_tokens);
    const outTok = whole(usage.output_tokens);
    if (!inTok && !outTok) continue;
    if (!byModel.has(model)) byModel.set(model, { model, tokens_in: 0, tokens_out: 0 });
    const cell = byModel.get(model);
    cell.tokens_in += inTok;
    cell.tokens_out += outTok;
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}

function whole(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

const KNOWN_FLAGS = ["--transcript", "--task", "--actor", "--session", "--dir", "--json"];

export function parseArgs(args) {
  const plan = { transcript: null, task: null, actor: null, session: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") { plan.json = true; continue; }
    if (KNOWN_FLAGS.indexOf(a) < 0) {
      throw new Error("unknown flag: " + a + "\nknown flags: " + KNOWN_FLAGS.join(" "));
    }
    const value = args[++i];
    if (!value) throw new Error("`" + a + "` with no value");
    plan[a.slice(2)] = value;
  }
  return plan;
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  let plan;
  try {
    plan = parseArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " cost-adapter", head, rest));
    return 2;
  }

  const payload = readPayload();
  const path = plan.transcript || payload.transcript_path || payload.transcriptPath;
  if (!path) {
    console.error(failure(N + " cost-adapter", "no transcript to read",
      ["pass `--transcript <file>`, or run this from a SessionEnd hook, which supplies `transcript_path`"]));
    return 2;
  }

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    // A MISSING TRANSCRIPT IS NOT AN ERROR WORTH FAILING A HOOK OVER. The hook
    // runs at the end of every session, including ones whose transcript was
    // never written; a non-zero exit there would put a red line in front of
    // somebody for something that costs them nothing.
    console.error(N + " cost-adapter: cannot read " + path + " — " + e.message + "; nothing recorded");
    return 0;
  }

  const usage = usageFromTranscript(text);
  if (!usage.length) {
    console.log(N + " cost-adapter: the transcript carries no usage — nothing recorded");
    return 0;
  }

  let root;
  try {
    root = resolveBacklogDir({
      dir: cli.dir || undefined,
      cwd: signalsFromPayload(payload).cwd || undefined,
      moduleDir: __dirname,
    }).root;
  } catch (e) {
    console.error(failure(N + " cost-adapter", e.message, []));
    return 2;
  }
  const config = loadConfigOrExit(root);

  const written = [];
  for (const cell of usage) {
    const result = record({
      root, config, payload,
      plan: {
        task: plan.task, kind: "session", actor: plan.actor,
        session: plan.session, source: "cost-adapter", file: null, branch: null,
        // NEVER THROTTLED. The window exists to stop a tool firing on every
        // keystroke from measuring typing speed; this runs once per session and
        // per model, and a throttle would silently drop the second model's
        // tokens for looking like a repeat of the first.
        throttle: false, json: false,
        tokensIn: cell.tokens_in, tokensOut: cell.tokens_out, model: cell.model,
      },
    });
    if (!result.ok) {
      console.error(failure(N + " cost-adapter", result.message, result.details || []));
      return 1;
    }
    if (result.wrote) written.push({ ...cell, task: result.task });
    else console.log(N + " cost-adapter: " + result.message);
  }

  if (plan.json) {
    console.log(JSON.stringify({ recorded: written }, null, 2));
    return 0;
  }
  for (const w of written) {
    console.log(N + " cost-adapter: " + w.task + " — " + w.model + " " +
      w.tokens_in + " in / " + w.tokens_out + " out");
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("cost-adapter.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
