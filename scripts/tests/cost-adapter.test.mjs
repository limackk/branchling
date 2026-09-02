/**
 * The cost axis, and the one untruth it exists to avoid: `0` (TL-30).
 *
 * WHAT EVERY GROUP RULES OUT.
 *   1. A ZERO STANDING IN FOR "NOT MEASURED". A host with no adapter is the
 *      NORMAL case — the module goes open source and has to run over somebody
 *      else's process — so a log with no cost fields must report `null` and a
 *      sentence, not a table of zeroes that reads as "it came out free".
 *   2. FOUR OUTCOMES COLLAPSING INTO TWO. An amount, tokens-without-an-amount
 *      because of a subscription, a DECLARED zero from a local model, and `null`
 *      are four different facts. A test that only checked "there is a number"
 *      would pass against code that confuses the last three.
 *   3. AVERAGING ACROSS MODELS. Sonnet tokens through an API and a local
 *      llama's tokens are incomparable units of effort, so the breakdown is per
 *      model and the total refuses an amount unless every model has one.
 *   4. A PRICE TYPED INTO THE CODE. Rates come from `model_pricing`, and a model
 *      the log carries and the pricing does not is counted apart as "no rate" —
 *      never dropped, because the tokens are real even when the amount is not.
 *   5. THE ADAPTER BECOMING A DEPENDENCY. Nothing in `scripts/` may import it;
 *      that is what makes the cost axis a plugin, and it is asserted as an
 *      IMPORT check rather than a grep for the word, so a comment naming the
 *      file does not fail it and an import hidden behind an alias does.
 *
 * ON FIXTURES, NEVER ON THIS PROJECT'S DATA (CLAUDE.md): a synthetic transcript
 * and a synthetic log, so the suite answers the same on an empty tree and on a
 * measured one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { activityEntry } from "../activity.mjs";
import { amountLabel, costByModel, costReport, parsePricing, parseRate, tokensLabel } from "../cost.mjs";
import { usageFromTranscript } from "../cost-adapter.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("cost-adapter");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// ── no adapter is not zero ────────────────────────────────────────────────

test("a log with no cost fields reports null and says why — never 0", () => {
  const r = costReport([{ kind: "tool" }, { kind: "prompt" }], {});
  assert.equal(r.tokens, null, "0 would mean `measured, and it came out free`");
  assert.equal(r.amount, null);
  assert.deepEqual(r.models, []);
  assert.match(r.why, /no cost adapter has run/);
});

test("`time --cost --json` on a tree with no adapter gives tokens: null", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-cost-none-"));
  assert.equal(spawnSync(process.execPath, [CLI, "init", "--dir", ".", "--no-example"],
    { cwd: dir, encoding: "utf8" }).status, 0);
  const out = spawnSync(process.execPath, [CLI, "time", "--cost", "--json", "--dir", "."],
    { cwd: dir, encoding: "utf8" });
  assert.equal(out.status, 0);
  const payload = JSON.parse(out.stdout);
  assert.equal(payload.tokens, null);
  assert.equal(payload.cost.amount, null);
});

// ── the four outcomes ─────────────────────────────────────────────────────

const ROWS = (model) => [{ kind: "session", model, tokens_in: 1_000_000, tokens_out: 100_000 }];

test("api with a rate produces an amount", () => {
  const [cell] = costByModel(ROWS("m-api"), parsePricing({ "m-api": "3.00/15.00" }).rates);
  assert.equal(cell.mode, "api");
  assert.equal(cell.amount, 3 + 1.5);
  assert.equal(cell.why, null);
});

test("subscription produces tokens WITHOUT an amount, and the reason", () => {
  const [cell] = costByModel(ROWS("m-sub"), parsePricing({ "m-sub": "subscription" }).rates);
  assert.equal(cell.mode, "subscription");
  assert.equal(cell.amount, null);
  assert.equal(cell.tokens, 1_100_000);
  assert.match(cell.why, /subscription/);
});

test("a local model produces a DECLARED zero, distinguishable from missing data", () => {
  const [cell] = costByModel(ROWS("m-local"), parsePricing({ "m-local": "local" }).rates);
  assert.equal(cell.mode, "local");
  assert.equal(cell.amount, 0, "a declared zero is a number; missing data is null");
  assert.match(cell.why, /declared zero/);
});

test("a model the pricing has never heard of is counted apart as `no rate`", () => {
  const [cell] = costByModel(ROWS("m-unknown"), parsePricing({ "m-api": "3.00/15.00" }).rates);
  assert.equal(cell.mode, null);
  assert.equal(cell.amount, null);
  assert.equal(cell.tokens, 1_100_000, "the tokens are real even when the amount is not knowable");
  assert.match(cell.why, /no rate/);
});

test("the three outcomes are distinguishable from each other and from null", () => {
  const seen = ["m-api", "m-sub", "m-local", "m-unknown"].map((m) =>
    costByModel(ROWS(m), parsePricing({ "m-api": "3.00/15.00", "m-sub": "subscription", "m-local": "local" }).rates)[0]);
  assert.deepEqual(seen.map((c) => [c.mode, c.amount]),
    [["api", 4.5], ["subscription", null], ["local", 0], [null, null]]);
});

// ── no averaging across models ────────────────────────────────────────────

test("two models are two rows, and the total refuses an amount unless both have one", () => {
  const rows = [
    { model: "m-api", tokens_in: 1_000_000, tokens_out: 0 },
    { model: "m-local", tokens_in: 500_000, tokens_out: 0 },
  ];
  const r = costReport(rows, { "m-api": "3.00/15.00", "m-local": "local" });
  assert.equal(r.models.length, 2, "a single averaged row would make two units of effort into one");
  assert.equal(r.tokens, 1_500_000);
  assert.equal(r.amount, 3, "a local declared zero still yields an amount, so the total has one");

  const partial = costReport([rows[0], { model: "m-sub", tokens_in: 1_000_000, tokens_out: 0 }],
    { "m-api": "3.00/15.00", "m-sub": "subscription" });
  assert.equal(partial.amount, null, "a partial sum would be smaller than the truth with the authority of a total");
  assert.match(partial.why, /m-sub \(subscription\)/);
});

// ── prices are data ───────────────────────────────────────────────────────

test("a rate is read from its config spelling, and a bad one is named not thrown", () => {
  assert.deepEqual(parseRate("3.00/15.00"), { mode: "api", inPerMillion: 3, outPerMillion: 15 });
  assert.equal(parseRate("subscription").mode, "subscription");
  assert.equal(parseRate("local").mode, "local");
  assert.equal(parseRate("free").mode, null);
  const { rates, problems } = parsePricing({ good: "1/2", bad: "free" });
  assert.ok(rates.good, "one model's typo must not cost the others their report");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^bad: /);
});

// ── the transcript ────────────────────────────────────────────────────────

const TRANSCRIPT = [
  JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
  JSON.stringify({ type: "assistant", message: { model: "opus", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } } }),
  JSON.stringify({ type: "assistant", message: { model: "opus", usage: { input_tokens: 20, output_tokens: 7 } } }),
  JSON.stringify({ type: "assistant", message: { model: "haiku", usage: { input_tokens: 1, output_tokens: 1 } } }),
  '{"type":"assistant","message":{"model":"opus","usage":{"input_to',
].join("\n");

test("usage is summed per model, cache tokens included, and a half-written line is skipped", () => {
  const usage = usageFromTranscript(TRANSCRIPT);
  assert.deepEqual(usage, [
    { model: "haiku", tokens_in: 1, tokens_out: 1 },
    { model: "opus", tokens_in: 130, tokens_out: 12 },
  ]);
});

test("a transcript with no usage yields nothing rather than a row of zeroes", () => {
  assert.deepEqual(usageFromTranscript('{"type":"user","message":{"content":"hi"}}'), []);
  assert.deepEqual(usageFromTranscript(""), []);
});

// ── the row shape ─────────────────────────────────────────────────────────

test("tokens without a model are refused — the number would be unusable", () => {
  assert.throws(() => activityEntry({ task: "TL-1", kind: "session", actor: "agent:x", tokens_in: 5 }),
    /model/);
});

test("a row with no cost fields carries none — absence is not a zero", () => {
  const e = activityEntry({ task: "TL-1", kind: "tool", actor: "agent:x" });
  assert.equal("tokens_in" in e, false);
  assert.equal("model" in e, false);
});

// ── the adapter stays a plugin ────────────────────────────────────────────

test("nothing in scripts/ IMPORTS the adapter", () => {
  const offenders = readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".mjs") && f !== "cost-adapter.mjs")
    .filter((f) => /^\s*import[^;]*from\s+["'][^"']*cost-adapter\.mjs["']/m.test(readFileSync(join(SCRIPTS_DIR, f), "utf8")));
  assert.deepEqual(offenders, [],
    "the cost adapter is a plugin: a module that imports it makes Claude Code a condition of running the tool");
});

test("POSITIVE CONTROL: the import check catches a file that does import it", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-cost-import-"));
  writeFileSync(join(dir, "guilty.mjs"), 'import { usageFromTranscript } from "./cost-adapter.mjs";\n', "utf8");
  const offenders = readdirSync(dir)
    .filter((f) => f.endsWith(".mjs") && f !== "cost-adapter.mjs")
    .filter((f) => /^\s*import[^;]*from\s+["'][^"']*cost-adapter\.mjs["']/m.test(readFileSync(join(dir, f), "utf8")));
  assert.deepEqual(offenders, ["guilty.mjs"],
    "without this the check above would pass against a pattern that never matches");
});

// ── formatting says `unknown` and `zero` differently ──────────────────────

test("null prints as a dash and a declared zero prints as a zero", () => {
  assert.equal(tokensLabel(null), "—");
  assert.equal(tokensLabel(950), "950");
  assert.equal(tokensLabel(12_345), "12k");
  assert.equal(amountLabel(null), "—");
  assert.equal(amountLabel(0), "$0.00");
  assert.equal(amountLabel(4.5), "$4.50");
});
