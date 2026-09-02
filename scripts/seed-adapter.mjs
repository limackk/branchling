#!/usr/bin/env node
/**
 * The adapter that turns prose into a plan for `seed` (TL-95).
 *
 * WHAT IT IS AND WHAT IT IS NOT. `seed` validates and writes; this produces the
 * plan and nothing else. The boundary is the whole design — Law 4 made literal
 * — and it is why both routes have to work:
 *
 *   <the binary> seed --from spec.md            # the convenient one
 *   my-own-adapter spec.md | <the binary> seed  # the surface everybody uses
 *
 * The second is the point. Somebody else's adapter, in somebody else's
 * language, calling somebody else's model, is a first-class citizen here
 * because the interface is a JSON document on a pipe rather than a plugin API.
 *
 * NO ENDPOINT, NO MODEL, NO PROMPT IN THIS FILE. The endpoint and the model are
 * facts about a MACHINE, so they live in the user layer (`llm_endpoint`,
 * `llm_model`) and never in a project's `config.yaml` — two people on one
 * repository can reasonably run a local model and a hosted one, and both be
 * right (Law 3). The prompt is a file that ships with the package and can be
 * replaced with `--prompt`, because tuning what the model is told must not
 * require a fork.
 *
 * THE MODEL'S OUTPUT IS UNTRUSTED, AND THIS FILE NEVER REPAIRS IT. `seed
 * --dry-run` is the only gate; when it rejects a plan the adapter hands the
 * plan BACK to the model with the errors attached, up to `llm_retries`, and
 * then gives up loudly, printing the last plan and the complaints. Of the three
 * available behaviours — retry, fail, or quietly patch the JSON with a
 * heuristic — only the third is dangerous, because it produces a plan nobody
 * wrote and nobody can trace: the model's mistake would arrive dressed as its
 * own answer.
 *
 * IT LOGS THE MODEL INTO THE PLAN'S METADATA. Which model planned a project is
 * the input to a measurement nobody can run retroactively — the assumption that
 * local models plan worse than frontier ones is worth disproving, and it cannot
 * be disproved from data that does not say which model produced what.
 *
 * ONE HTTP SHAPE FOR BOTH BACKENDS. Ollama's `/api/chat` takes `format` with a
 * JSON schema; an OpenAI-compatible endpoint takes `response_format`. Both are
 * sent, because an endpoint ignores the key it does not know, and one request
 * shape means one code path to keep working.
 *
 * Tests: `node --test scripts/tests/seed-adapter.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The prompt that ships with the package. A FILE, so it can be replaced
 *  without a fork; see the header. */
export const DEFAULT_PROMPT = join(HERE, "..", "templates", "seed-plan.md");

const FLAGS = ["--from", "--prompt", "--json", "--dir"];

export const USAGE = [
  `${N} plan-from <spec-file> [--prompt <file>] [--dir <path>]`,
  "",
  "  Reads a project description and prints a `seed` plan as JSON on stdout.",
  "  Nothing is written to the backlog — pipe it, or read it first:",
  "",
  `    ${N} plan-from spec.md | ${N} seed --dir ./backlog`,
  `    ${N} seed --from spec.md --dry-run        # the same, in one step`,
  "",
  "  --prompt <file>  a prompt template of your own. The one that ships is",
  "                   templates/seed-plan.md and it is data, not code",
  "",
  "  THE ENDPOINT AND THE MODEL COME FROM YOUR OWN preferences file, never from",
  "  this project's config.yaml — they are facts about your machine:",
  "",
  "    llm_endpoint: http://localhost:11434",
  "    llm_model: llama3.1",
  "",
  "  With Ollama that is `ollama pull llama3.1` and nothing else — no key, no",
  "  account. Any OpenAI-compatible endpoint works through the same code.",
  "",
  "  A plan the model produces is NEVER repaired here. It goes to `seed",
  "  --dry-run`, and a rejected one goes back to the model with the errors",
  "  attached, up to `llm_retries` times; after that the plan and the complaints",
  "  are printed and the command fails.",
].join("\n");

// ──────────────────────────────────────────────────────────────────────────
// Arguments and configuration — PURE
// ──────────────────────────────────────────────────────────────────────────

export function parseAdapterArgs(args) {
  let spec = null;
  let prompt = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--prompt") {
      prompt = args[++i];
      if (!prompt) throw new Error("`--prompt` with no file");
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\nknown flags: " + FLAGS.join(" "));
    if (spec) throw new Error("more than one description: " + spec + " and " + a);
    spec = a;
  }
  if (!spec) throw new Error("which description?\nhand it a file: `" + N + " plan-from spec.md`");
  return { spec, prompt };
}

/**
 * The model settings, or a message saying exactly what to put where.
 *
 * A MISSING CONFIGURATION IS NOT A STACK TRACE. This is the first command a
 * person runs after installing, and the failure they are most likely to hit; a
 * traceback here teaches that the tool is broken rather than unconfigured.
 */
export function modelSettings(user, prefsPath) {
  const endpoint = String((user && user.llm_endpoint) || "").trim();
  const model = String((user && user.llm_model) || "").trim();
  const missing = [];
  if (!endpoint) missing.push("llm_endpoint");
  if (!model) missing.push("llm_model");
  if (missing.length) {
    return {
      error: [
        "no model is configured — " + missing.join(" and ") + " " + (missing.length > 1 ? "are" : "is") + " not set",
        "",
        "These are facts about YOUR machine, so they go in your own preferences file:",
        "  " + prefsPath,
        "",
        "  llm_endpoint: http://localhost:11434",
        "  llm_model: llama3.1",
        "",
        "With Ollama that is `ollama pull llama3.1` and nothing else — no key, no account.",
        "Any OpenAI-compatible endpoint works through the same code.",
      ].join("\n"),
    };
  }
  return {
    endpoint, model,
    retries: Number.isFinite(user.llm_retries) ? user.llm_retries : 2,
    timeoutMs: (Number.isFinite(user.llm_timeout_seconds) ? user.llm_timeout_seconds : 120) * 1000,
  };
}

/**
 * The prompt, with the description and any previous errors substituted in.
 *
 * Everything above the first `---` on a line of its own is documentation for
 * whoever edits the file, and is dropped: a template that has to be free of
 * explanation is a template people are afraid to change.
 */
export function renderPrompt(template, { spec, errors }) {
  const text = String(template || "");
  const cut = text.search(/^---\s*$/m);
  const body = cut >= 0 ? text.slice(text.indexOf("\n", cut) + 1) : text;
  const complaints = (errors && errors.length)
    ? "The previous answer was REJECTED for these reasons. Fix them and answer again:\n\n" +
      errors.map((e) => "- " + e).join("\n")
    : "";
  return body.replace(/\{\{spec\}\}/g, String(spec || "")).replace(/\{\{errors\}\}/g, complaints).trim() + "\n";
}

/**
 * The JSON shape both backends are asked to honour.
 *
 * Sent as Ollama's `format` AND as an OpenAI `response_format` in one request:
 * an endpoint ignores the key it does not know, and one request shape is one
 * code path that can go wrong.
 */
export function planSchema() {
  return {
    type: "object",
    required: ["planVersion", "tasks"],
    properties: {
      planVersion: { type: "integer" },
      meta: { type: "object" },
      tasks: {
        type: "array",
        items: {
          type: "object",
          required: ["plan_id", "title", "goal", "verification"],
          properties: {
            plan_id: { type: "string" },
            title: { type: "string" },
            goal: { type: "string" },
            context: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
            blocked_by: { type: "array", items: { type: "string" } },
            verification: {
              type: "array",
              items: {
                type: "object",
                required: ["bash"],
                properties: { id: { type: "string" }, bash: { type: "string" }, proves: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}

/** The answer text out of either backend's response shape. */
export function extractContent(body) {
  if (!body || typeof body !== "object") return null;
  // Ollama `/api/chat`.
  if (body.message && typeof body.message.content === "string") return body.message.content;
  // OpenAI-compatible `/v1/chat/completions`.
  const choice = Array.isArray(body.choices) ? body.choices[0] : null;
  if (choice && choice.message && typeof choice.message.content === "string") return choice.message.content;
  // Ollama `/api/generate`.
  if (typeof body.response === "string") return body.response;
  return null;
}

/**
 * The plan out of the answer.
 *
 * A model told to answer with JSON and nothing else sometimes wraps it in a
 * fence anyway. Stripping one fence is not "repairing the plan" — it is reading
 * the transport — and it is the only forgiveness in this file; malformed JSON
 * inside is reported, never patched.
 */
export function parsePlanText(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  const body = fenced ? fenced[1] : raw;
  try {
    return { plan: JSON.parse(body) };
  } catch (e) {
    return { error: "the model did not answer with JSON: " + e.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// The loop
// ──────────────────────────────────────────────────────────────────────────

/**
 * @param {object} deps `ask` sends one prompt and resolves to the raw answer
 *   text; `validate` runs the plan past `seed --dry-run` and resolves to
 *   `{ok, errors}`. Both are injected so the tests need neither a model nor a
 *   network — the fixture answers stand in for the model, exactly as TL-95
 *   requires.
 */
export async function producePlan({ spec, template, settings, ask, validate, log = () => {} }) {
  const attempts = [];
  let errors = [];

  for (let attempt = 0; attempt <= settings.retries; attempt++) {
    const prompt = renderPrompt(template, { spec, errors });
    let answer;
    try {
      answer = await ask(prompt);
    } catch (e) {
      return { ok: false, attempts, errors: ["the model could not be reached: " + e.message] };
    }

    const parsed = parsePlanText(answer);
    if (parsed.error) {
      errors = [parsed.error];
      attempts.push({ attempt: attempt + 1, ok: false, errors, raw: answer });
      log("attempt " + (attempt + 1) + ": " + parsed.error);
      continue;
    }

    // The model is asked to name its source; the MODEL ITSELF is stamped here,
    // because an answer cannot be trusted about its own identity and this is
    // the input to a measurement nobody can reconstruct later.
    const plan = { ...parsed.plan, meta: { ...(parsed.plan.meta || {}), model: settings.model, endpoint: settings.endpoint } };

    const verdict = await validate(plan);
    if (verdict.ok) {
      attempts.push({ attempt: attempt + 1, ok: true, errors: [] });
      return { ok: true, plan, attempts };
    }
    errors = verdict.errors;
    attempts.push({ attempt: attempt + 1, ok: false, errors, plan });
    log("attempt " + (attempt + 1) + " rejected: " + errors.join("; "));
  }

  // Loudly, with the evidence. The one thing that must not happen here is a
  // plan this file has edited into shape.
  const last = attempts[attempts.length - 1] || {};
  return { ok: false, attempts, errors, plan: last.plan || null, raw: last.raw || null };
}

/** One request, both backends' keys at once. Separate so the loop above can be
 *  tested without a network. */
export function httpAsk(settings, fetchImpl = globalThis.fetch) {
  return async (prompt) => {
    const url = settings.endpoint.replace(/\/+$/, "") +
      (/\/v1$/.test(settings.endpoint.replace(/\/+$/, "")) ? "/chat/completions" : "/api/chat");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          stream: false,
          messages: [{ role: "user", content: prompt }],
          format: planSchema(),
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status + " from " + url);
      return extractContent(await res.json()) || "";
    } finally {
      clearTimeout(timer);
    }
  };
}

/** `seed --dry-run` as the gate. The plan goes in on stdin exactly as a user's
 *  own adapter would send it, so nothing here is a privileged path. */
export function seedValidator(root) {
  return async (plan) => {
    const r = spawnSync(process.execPath, [join(HERE, "cli.mjs"), "seed", "--dir", root, "--dry-run", "--json"], {
      encoding: "utf8", input: JSON.stringify(plan), timeout: 120_000,
    });
    if (r.status === 0) return { ok: true, errors: [] };
    let errors = [];
    try {
      const doc = JSON.parse(r.stdout);
      errors = doc.errors || [];
    } catch {
      errors = String(r.stderr || r.stdout || "").split("\n").filter(Boolean);
    }
    return { ok: false, errors: errors.length ? errors : ["the plan was rejected, with no reason given"] };
  };
}

export async function main(argv) {
  const cli = takeDirFlag(argv);
  let opts;
  try {
    opts = parseAdapterArgs(cli.argv);
  } catch (e) {
    const [head, ...rest] = e.message.split("\n");
    console.error(failure(N + " plan-from", head, rest, [`${N} plan-from --help`]));
    return 2;
  }

  let spec;
  try {
    spec = readFileSync(opts.spec, "utf8");
  } catch (e) {
    console.error(failure(N + " plan-from", "cannot read " + opts.spec, [e.message], []));
    return 2;
  }

  const promptPath = opts.prompt || DEFAULT_PROMPT;
  if (!existsSync(promptPath)) {
    console.error(failure(N + " plan-from", "no prompt template at " + promptPath, [], []));
    return 2;
  }
  const template = readFileSync(promptPath, "utf8");

  let root;
  try {
    root = resolveBacklogDir({ dir: cli.dir, moduleDir: HERE }).root;
  } catch (e) {
    console.error(failure(N + " plan-from", e.message, [], [`${N} plan-from spec.md --dir <path>`]));
    return 2;
  }
  const config = loadConfigOrExit(root);
  const settings = modelSettings(config.user, config.user.path);
  if (settings.error) {
    const [head, ...rest] = settings.error.split("\n");
    console.error(failure(N + " plan-from", head, rest, []));
    return 2;
  }

  const result = await producePlan({
    spec, template, settings,
    ask: httpAsk(settings),
    validate: seedValidator(root),
    log: (line) => console.error("  " + line),
  });

  if (!result.ok) {
    console.error(failure(
      N + " plan-from", "no plan survived " + result.attempts.length + " attempt(s)",
      result.errors.concat([
        "",
        "The last answer is on stdout. It is NOT repaired: a plan this command",
        "edited into shape would be one nobody wrote and nobody can trace.",
      ]), []
    ));
    // The evidence goes to stdout, where it can be redirected and read.
    if (result.plan) console.log(JSON.stringify(result.plan, null, 2));
    else if (result.raw) console.log(result.raw);
    return 1;
  }

  console.log(JSON.stringify(result.plan, null, 2));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("seed-adapter.mjs")) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
