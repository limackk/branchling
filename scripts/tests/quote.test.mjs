/**
 * The forecast, and the five ways one becomes a promise it cannot keep (TL-88).
 *
 * A FORECAST IS READ AS A PROMISE, which is why every rule §11 wrote for the
 * backward-looking report is tested again here rather than assumed to carry
 * over. The failure mode is not a wrong number — it is a number at all, where
 * "not enough data" was the truth.
 *
 *   1. A NUMBER BELOW THE THRESHOLD. Paired: the same bucket one sample later
 *      must speak, or the threshold is untested from the side that matters.
 *   2. A POINT INSTEAD OF A RANGE. p20 < median < p80, always.
 *   3. A SILENT FALLBACK. When estimate x type is too thin the answer widens to
 *      the estimate alone — and SAYS SO. A fallback nobody can see is
 *      indistinguishable from a narrower answer than the tool actually has.
 *   4. ZEROES WHERE THERE IS NO ADAPTER. No token column is `null`, not an
 *      empty list and never a column of zeroes.
 *   5. MODELS AVERAGED TOGETHER. Two models are two cells; one thin cell says
 *      so instead of borrowing the other's samples.
 *
 * ON FIXTURES (CLAUDE.md): every sample here is built by hand, so the suite
 * answers the same on this backlog today and in a year.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { BUCKET_ORDER, forecast, rangeLabel } from "../quote.mjs";

import { isolateHome } from "./_repo.mjs";

isolateHome("quote");

/** `n` closed tasks in one bucket, each measuring `minutes`. */
function closed(estimate, type, minutes, n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: "TL-" + type + "-" + estimate + "-" + i,
    estimate, type, actual_minutes: minutes, unknown_ratio: 0, models: [], ...extra,
  }));
}

const TARGET = { id: "TL-1", estimate: "2h", type: "code" };

// ── an input error, not an empty answer ───────────────────────────────────

test("a task with no estimate is an input error, not `not enough data`", () => {
  const f = forecast([], { id: "TL-1", type: "code" }, { minN: 8 });
  assert.equal(f.ok, false);
  assert.equal(f.why, "no-estimate");
  assert.match(f.message, /needs an estimate/);
});

test("an unparseable estimate is the same error, and names the value", () => {
  const f = forecast([], { id: "TL-1", estimate: "soon", type: "code" }, { minN: 8 });
  assert.equal(f.ok, false);
  assert.match(f.message, /`soon`/);
});

// ── the threshold ─────────────────────────────────────────────────────────

test("below the threshold the forecast refuses, and reports the n it would have had", () => {
  const f = forecast(closed("2h", "code", 150, 7), TARGET, { minN: 8 });
  assert.equal(f.insufficient, true);
  assert.equal(f.n, 7);
  assert.equal(f.time, null);
  assert.match(f.message, /8 needed/);
});

test("one sample more and the same bucket answers", () => {
  const f = forecast(closed("2h", "code", 150, 8), TARGET, { minN: 8 });
  assert.equal(f.insufficient, false);
  assert.equal(f.bucket, "estimate+type");
  assert.equal(f.degraded, false);
});

// ── always a range ────────────────────────────────────────────────────────

test("the answer is a range, never a single average", () => {
  const samples = Array.from({ length: 9 }, (_, i) => ({
    id: "TL-" + i, estimate: "2h", type: "code",
    actual_minutes: 60 + i * 30, unknown_ratio: 0, models: [],
  }));
  const f = forecast(samples, TARGET, { minN: 8 });
  assert.ok(f.time.p20 < f.time.median && f.time.median < f.time.p80);
  assert.match(rangeLabel(f.time), /^\dh.* - \dh.* \(median /);
});

// ── the fallback is stated ────────────────────────────────────────────────

test("a thin estimate x type cell widens to the estimate alone, and says so", () => {
  const samples = [
    ...closed("2h", "code", 150, 3),
    ...closed("2h", "bug", 90, 6),
  ];
  const f = forecast(samples, TARGET, { minN: 8 });
  assert.equal(f.bucket, "estimate");
  assert.equal(f.degraded, true, "a fallback nobody can see is a narrower claim than the tool holds");
  assert.equal(f.n, 9, "the wider bucket's n is what the answer rests on");
  assert.equal(f.insufficient, false);
});

test("when neither bucket fills, the n reported is the WIDEST one — the best case that exists", () => {
  const f = forecast([...closed("2h", "code", 150, 2), ...closed("2h", "bug", 90, 3)], TARGET, { minN: 8 });
  assert.equal(f.insufficient, true);
  assert.equal(f.bucket, BUCKET_ORDER[BUCKET_ORDER.length - 1].key);
  assert.equal(f.n, 5);
});

test("a different estimate is a different bucket and contributes nothing", () => {
  const f = forecast(closed("1d", "code", 150, 40), TARGET, { minN: 8 });
  assert.equal(f.n, 0);
  assert.equal(f.insufficient, true);
});

// ── the unattributed share travels with the answer ────────────────────────

test("the share of minutes nothing could place is part of the answer", () => {
  const samples = closed("2h", "code", 150, 8).map((s, i) => ({ ...s, unknown_ratio: i < 4 ? 0.8 : 0.2 }));
  const f = forecast(samples, TARGET, { minN: 8 });
  assert.equal(Math.round(f.unknownRatio * 100) / 100, 0.5);
});

test("no sample carrying a share gives null — an unknown unknown is not 0", () => {
  const samples = closed("2h", "code", 150, 8).map((s) => ({ ...s, unknown_ratio: null }));
  assert.equal(forecast(samples, TARGET, { minN: 8 }).unknownRatio, null);
});

// ── no adapter, no column ─────────────────────────────────────────────────

test("no cost data gives NO token column — null, not an empty list of zeroes", () => {
  const f = forecast(closed("2h", "code", 150, 8), TARGET, { minN: 8 });
  assert.equal(f.tokens, null);
});

// ── models are never averaged ─────────────────────────────────────────────

const withModel = (model, tokens, n) =>
  closed("2h", "code", 150, n, { models: [{ model, tokens_in: tokens, tokens_out: 0 }] })
    .map((s, i) => ({ ...s, id: model + "-" + i }));

test("two models are two cells, and the thin one says so instead of borrowing", () => {
  const f = forecast([...withModel("m-api", 1_000_000, 8), ...withModel("m-other", 500_000, 3)],
    TARGET, { minN: 8, pricing: { "m-api": "3.00/15.00" } });
  assert.equal(f.tokens.length, 2);
  const [api, other] = f.tokens;
  assert.equal(api.model, "m-api");
  assert.equal(api.insufficient, false);
  assert.equal(api.median, 1_000_000);
  assert.equal(other.insufficient, true, "3 samples must not be averaged into the other model's 8");
  assert.equal(other.median, undefined);
});

test("an amount appears for api, is refused for a subscription, and is a declared zero for local", () => {
  const opts = { minN: 8, pricing: { "m-api": "3.00/15.00", "m-sub": "subscription", "m-local": "local" } };
  const cell = (model) => forecast(withModel(model, 1_000_000, 8), TARGET, opts).tokens[0];
  assert.equal(cell("m-api").amount.median, 3);
  assert.equal(cell("m-sub").amount, null);
  assert.match(cell("m-sub").why, /subscription/);
  assert.equal(cell("m-local").amount.median, 0);
  assert.match(cell("m-local").why, /declared zero/);
  assert.equal(cell("m-unpriced").amount, null);
  assert.match(cell("m-unpriced").why, /no rate/);
});

test("a task with no measured minutes is not a sample, however many tokens it carries", () => {
  const unmeasured = closed("2h", "code", 150, 8, { models: [{ model: "m", tokens_in: 1, tokens_out: 0 }] })
    .map((s) => ({ ...s, actual_minutes: 0 }));
  const f = forecast(unmeasured, TARGET, { minN: 8 });
  assert.equal(f.n, 0, "zero minutes means nothing lasted long enough to count, not a measurement of zero");
  assert.equal(f.insufficient, true);
});
