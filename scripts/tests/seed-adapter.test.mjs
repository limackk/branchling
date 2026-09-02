/**
 * The adapter that turns prose into a plan (TL-95).
 *
 * NO MODEL AND NO NETWORK ANYWHERE IN HERE, which TL-95 requires by name. The
 * backend is a function that returns fixture answers, and the gate is `seed
 * --dry-run` — the real one, spawned, because that is the whole point of the
 * boundary: the adapter produces and `seed` judges, and a test that mocked the
 * judge would be testing neither.
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. Both routes work — `plan-from` on stdout AND `seed --from`. The first is
 *      the surface everybody else's adapter writes to, so it cannot be the one
 *      that is second-class.
 *   2. Nothing is hardcoded: no endpoint, no model, no prompt. Proved by
 *      reading the source for a URL and by driving the whole thing from a
 *      fixture prompt and fixture settings.
 *   3. A rejected plan is retried or FAILS — never quietly repaired. The
 *      dangerous behaviour is the third one, so it gets the sharpest test: the
 *      plan that comes out on a failure is byte-for-byte the model's.
 *   4. The plan's metadata names the model, because a measurement of plan
 *      quality per model cannot be reconstructed from data that does not say
 *      which model produced what.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PROMPT, extractContent, httpAsk, modelSettings, parseAdapterArgs, parsePlanText,
  planSchema, producePlan, renderPrompt, seedValidator,
} from "../seed-adapter.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

const SETTINGS = { endpoint: "http://fixture.invalid", model: "fixture-model", retries: 2, timeoutMs: 1000 };

const goodPlan = () => ({
  planVersion: 1,
  tasks: [{
    plan_id: "first", title: "The thing works", goal: "It runs.",
    verification: [{ id: "it-runs", bash: "true", proves: "The command runs." }],
  }],
});

// ── Arguments and configuration ───────────────────────────────────────────

test("it takes one description, and an unknown flag fails", () => {
  assert.equal(parseAdapterArgs(["spec.md"]).spec, "spec.md");
  assert.equal(parseAdapterArgs(["spec.md", "--prompt", "p.md"]).prompt, "p.md");
  assert.throws(() => parseAdapterArgs([]), /which description\?/);
  assert.throws(() => parseAdapterArgs(["a", "b"]), /more than one description/);
  assert.throws(() => parseAdapterArgs(["--model", "x"]), /unknown flag: --model/);
});

test("a missing configuration is a message naming the file and the two keys", () => {
  const r = modelSettings({}, "/home/me/prefs.yaml");
  assert.match(r.error, /llm_endpoint and llm_model/);
  assert.match(r.error, /\/home\/me\/prefs\.yaml/);
  assert.match(r.error, /ollama pull/, "the free path has to be in the message somebody actually hits");
  assert.equal(r.endpoint, undefined);
});

test("half a configuration is still missing, and says which half", () => {
  assert.match(modelSettings({ llm_endpoint: "http://x" }, "p").error, /llm_model is not set/);
  assert.match(modelSettings({ llm_model: "m" }, "p").error, /llm_endpoint is not set/);
});

test("the retry limit and the timeout come from the user layer, with defaults", () => {
  const s = modelSettings({ llm_endpoint: "http://x", llm_model: "m" }, "p");
  assert.equal(s.retries, 2);
  assert.equal(s.timeoutMs, 120000);
  assert.equal(modelSettings({ llm_endpoint: "http://x", llm_model: "m", llm_retries: 0 }, "p").retries, 0);
});

test("the request goes to the CONFIGURED endpoint, and to nowhere else", async () => {
  // Asserted on BEHAVIOUR rather than by grepping the source. The source
  // legitimately contains `http://localhost:11434` — twice, in the help and in
  // the message somebody reads when nothing is configured, which is exactly the
  // line they will paste. What must not exist is a URL the code USES, and the
  // way to show that is to watch where it goes.
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ message: { content: "{}" } }) };
  };

  await httpAsk({ ...SETTINGS, endpoint: "http://ollama.example:11434" }, fetchImpl)("p");
  assert.equal(calls[0].url, "http://ollama.example:11434/api/chat");
  assert.equal(calls[0].body.model, "fixture-model", "the model is the configured one too");

  // An OpenAI-compatible base ends in `/v1` and takes a different path — the
  // same code, one request shape, both backends' keys sent at once.
  await httpAsk({ ...SETTINGS, endpoint: "https://api.example/v1/" }, fetchImpl)("p");
  assert.equal(calls[1].url, "https://api.example/v1/chat/completions");
  assert.ok(calls[1].body.format, "Ollama's schema key");
  assert.ok(calls[1].body.response_format, "the OpenAI key, sent in the same request");

  // And the proof that there is no fallback at all: with nothing configured the
  // command refuses rather than reaching for a default endpoint of its own.
  assert.ok(modelSettings({}, "p").error);
});

// ── The prompt is data ────────────────────────────────────────────────────

test("the shipped prompt is a file, and its documentation is not sent to the model", () => {
  const template = readFileSync(DEFAULT_PROMPT, "utf8");
  assert.match(template, /This file is DATA, not code/, "the file has to explain itself to whoever edits it");
  const rendered = renderPrompt(template, { spec: "A project.", errors: [] });
  assert.ok(!rendered.includes("This file is DATA"), "the explanation must not reach the model");
  assert.match(rendered, /A project\./);
});

test("on a retry the errors are named in the prompt; on a first attempt nothing is", () => {
  const template = "---\nplan this:\n\n{{spec}}\n\n{{errors}}\n";
  const first = renderPrompt(template, { spec: "S", errors: [] });
  assert.ok(!first.includes("REJECTED"));

  const again = renderPrompt(template, { spec: "S", errors: ["task `a`: no verification"] });
  assert.match(again, /REJECTED/);
  assert.match(again, /no verification/);
});

test("a template with no divider is sent whole — a custom prompt need not be documented", () => {
  assert.match(renderPrompt("just this: {{spec}}", { spec: "S", errors: [] }), /just this: S/);
});

// ── The transport ─────────────────────────────────────────────────────────

test("the answer is read out of either backend's shape", () => {
  assert.equal(extractContent({ message: { content: "a" } }), "a");
  assert.equal(extractContent({ choices: [{ message: { content: "b" } }] }), "b");
  assert.equal(extractContent({ response: "c" }), "c");
  assert.equal(extractContent({ nothing: true }), null);
});

test("the schema demands a verification on every task — the one rule that matters most", () => {
  const schema = planSchema();
  assert.ok(schema.properties.tasks.items.required.includes("verification"));
});

test("a fenced answer is read; malformed JSON is REPORTED, not patched", () => {
  assert.deepEqual(parsePlanText('```json\n{"a":1}\n```').plan, { a: 1 });
  assert.deepEqual(parsePlanText('{"a":1}').plan, { a: 1 });
  const bad = parsePlanText('{"a":');
  assert.equal(bad.plan, undefined);
  assert.match(bad.error, /did not answer with JSON/);
});

// ── The loop ──────────────────────────────────────────────────────────────

const okValidator = async () => ({ ok: true, errors: [] });
const badValidator = async () => ({ ok: false, errors: ["task `first`: no verification"] });

test("a plan the gate accepts comes back on the first attempt", async () => {
  const r = await producePlan({
    spec: "S", template: "{{spec}}{{errors}}", settings: SETTINGS,
    ask: async () => JSON.stringify(goodPlan()), validate: okValidator,
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts.length, 1);
});

test("the model is stamped into the metadata, whatever the model said about itself", async () => {
  const r = await producePlan({
    spec: "S", template: "{{spec}}{{errors}}", settings: SETTINGS,
    ask: async () => JSON.stringify({ ...goodPlan(), meta: { model: "a model lying about itself" } }),
    validate: okValidator,
  });
  assert.equal(r.plan.meta.model, "fixture-model", "an answer cannot be trusted about its own identity");
  assert.equal(r.plan.meta.endpoint, SETTINGS.endpoint);
});

test("a rejected plan is handed BACK to the model with the errors, and can succeed", async () => {
  const answers = [JSON.stringify({ planVersion: 1, tasks: [] }), JSON.stringify(goodPlan())];
  const seen = [];
  let call = 0;
  const r = await producePlan({
    spec: "S", template: "{{spec}}|{{errors}}", settings: SETTINGS,
    ask: async (prompt) => { seen.push(prompt); return answers[call++]; },
    validate: async () => (call === 1 ? { ok: false, errors: ["no tasks"] } : { ok: true, errors: [] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempts.length, 2);
  assert.ok(!seen[0].includes("no tasks"), "the first prompt cannot carry errors that had not happened");
  assert.match(seen[1], /no tasks/, "the retry has to tell the model what was wrong");
});

test("the retries run out LOUDLY, and the plan that comes back is the model's own", async () => {
  const answer = JSON.stringify(goodPlan());
  const r = await producePlan({
    spec: "S", template: "{{spec}}{{errors}}", settings: { ...SETTINGS, retries: 1 },
    ask: async () => answer, validate: badValidator,
  });
  assert.equal(r.ok, false);
  assert.equal(r.attempts.length, 2, "one attempt plus one retry");
  assert.deepEqual(r.errors, ["task `first`: no verification"]);
  // THE ASSERTION THIS FILE EXISTS FOR: the returned plan is the model's answer
  // plus the metadata stamp, and nothing else has been touched.
  assert.deepEqual(r.plan.tasks, goodPlan().tasks);
});

test("`llm_retries: 0` means one attempt and no retry", async () => {
  let calls = 0;
  const r = await producePlan({
    spec: "S", template: "{{spec}}{{errors}}", settings: { ...SETTINGS, retries: 0 },
    ask: async () => { calls++; return JSON.stringify(goodPlan()); }, validate: badValidator,
  });
  assert.equal(calls, 1);
  assert.equal(r.ok, false);
});

test("an unreachable model is one clear failure, not a retry storm", async () => {
  let calls = 0;
  const r = await producePlan({
    spec: "S", template: "{{spec}}{{errors}}", settings: SETTINGS,
    ask: async () => { calls++; throw new Error("ECONNREFUSED"); }, validate: okValidator,
  });
  assert.equal(calls, 1, "a network that is not there will not be there next time either");
  assert.match(r.errors[0], /could not be reached/);
});

test("an answer that is not JSON is retried, with the parse error told to the model", async () => {
  const seen = [];
  let call = 0;
  const r = await producePlan({
    spec: "S", template: "{{spec}}|{{errors}}", settings: SETTINGS,
    ask: async (p) => { seen.push(p); return call++ === 0 ? "here is your plan!" : JSON.stringify(goodPlan()); },
    validate: okValidator,
  });
  assert.equal(r.ok, true);
  assert.match(seen[1], /did not answer with JSON/);
});

// ── The real gate ─────────────────────────────────────────────────────────

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-adapter-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  return dir;
}

test("the gate is the REAL `seed --dry-run`, and it rejects a plan with no verification", async () => {
  const dir = backlog();
  const validate = seedValidator(dir);
  assert.deepEqual(await validate(goodPlan()), { ok: true, errors: [] });

  const bad = await validate({ planVersion: 1, tasks: [{ plan_id: "a", title: "T", goal: "G", verification: [] }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.length, "a rejection with no reason cannot be sent back to the model");
});

test("the dry-run gate writes nothing, however often it runs", async () => {
  const dir = backlog();
  const validate = seedValidator(dir);
  await validate(goodPlan());
  await validate(goodPlan());
  assert.deepEqual(readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md")), []);
});

// ── Both routes ───────────────────────────────────────────────────────────

/** A fake adapter: the whole point of Law 4 here is that somebody else's
 *  producer is a first-class citizen, so the test uses one. */
function fakeAdapter(dir, plan) {
  const path = join(dir, "adapter.mjs");
  writeFileSync(path, "console.log(" + JSON.stringify(JSON.stringify(plan)) + ");\n", "utf8");
  return path;
}

test("a plan on a PIPE seeds the backlog — the surface other people's adapters write to", () => {
  const dir = backlog();
  const adapter = fakeAdapter(dir, goodPlan());
  const produced = spawnSync(process.execPath, [adapter], { encoding: "utf8" });
  assert.equal(produced.status, 0);

  const r = spawnSync(process.execPath, [CLI, "seed", "--dir", dir], {
    encoding: "utf8", input: produced.stdout, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md")).length, 1);
});

test("`seed --from` needs a model, and says so instead of failing obscurely", () => {
  const dir = backlog();
  writeFileSync(join(dir, "spec.md"), "A project that does a thing.\n", "utf8");
  // No `llm_endpoint` is configured in this test environment, so this exercises
  // the message somebody hits on their first try.
  const r = run(["seed", "--dir", dir, "--from", join(dir, "spec.md")]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no model is configured|llm_endpoint/);
});

test("`--from` with no file is a usage error, not a silent no-op", () => {
  const dir = backlog();
  const r = run(["seed", "--dir", dir, "--from"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /`--from` with no file/);
});

test("`plan-from` writes nothing to the backlog even when it fails", () => {
  const dir = backlog();
  writeFileSync(join(dir, "spec.md"), "A project.\n", "utf8");
  run(["plan-from", join(dir, "spec.md"), "--dir", dir]);
  assert.deepEqual(readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md")), []);
});
