/**
 * `quote <ID>` — what this task will probably cost, BEFORE it is
 * handed to an agent (TL-88).
 *
 * WHAT THIS IS AND IS NOT. Calibration (TL-29) looks backwards: what did tasks
 * of this size actually take. `quote` inverts exactly that distribution into a
 * forecast for one task, and computes nothing of its own — same buckets, same
 * thresholds, same refusals. If the two ever disagreed, one of them would be
 * lying, and there would be nothing to say which.
 *
 * THE QUESTION NO BACKLOG TOOL ASKS is the second half: how much will RUNNING an
 * agent on this cost. That is why tokens are the primary axis here and the dollar
 * amount is a conditional derivative — a user on a subscription or a local model
 * must get a forecast as useful as an API user's, only without fictitious
 * dollars (§10, TL-30).
 *
 * THE RULES ARE §11's, CARRIED OVER WORD FOR WORD, because this is where lying
 * is easiest — a forecast is read as a promise:
 *   - below the `n` threshold the answer is "not enough data", never a number;
 *   - always a RANGE (p20-p80), never a point;
 *   - no cost adapter means NO token column, not a column of zeroes;
 *   - a bucket does not mix models: Sonnet tokens through an API and a local
 *     llama's tokens are incomparable units of effort, so each model is its own
 *     cell and a thin cell says so instead of being averaged away;
 *   - the share of `unknown` in the source data travels with the answer. A
 *     forecast built from data where most of the time was unattributed has to
 *     say so, or it is a number asserting its own trustworthiness.
 *
 * DEGRADING IS STATED, NEVER SILENT. The first bucket tried is estimate x type,
 * because a `bug` of two hours and a `code` task of two hours are not obviously
 * the same animal. When that cell is too thin the forecast falls back to the
 * estimate alone and SAYS which bucket it used — a fallback nobody can see is
 * indistinguishable from a narrower answer than the tool actually has.
 *
 * PURE. Only `calibration.mjs` and `cost.mjs`, both of which are themselves
 * pure. The caller reads the disk.
 *
 * Tests: `node --test scripts/tests/quote.test.mjs`
 */

import { DEFAULT_MIN_N, percentile, spanLabel } from "./calibration.mjs";
import { parsePricing } from "./cost.mjs";
import { estimateHours } from "./estimate.mjs";

/** The buckets tried, narrowest first. The ORDER is the policy: a narrower
 *  bucket is a better answer when it can be afforded, and the first one that
 *  clears the threshold wins. */
export const BUCKET_ORDER = [
  { key: "estimate+type", fields: ["type"] },
  { key: "estimate", fields: [] },
];

function matches(sample, target, fields) {
  if (estimateHours(sample.estimate) !== estimateHours(target.estimate)) return false;
  return fields.every((f) => (sample[f] || "") === (target[f] || ""));
}

function measured(s) {
  return typeof s.actual_minutes === "number" && isFinite(s.actual_minutes) && s.actual_minutes > 0;
}

/**
 * The forecast for one task. PURE.
 *
 * @param {Array<object>} samples  from `forecastSamples()` — closed tasks with
 *                                 an estimate, measured minutes and per-model tokens
 * @param {{id, estimate, type, board}} target  the task being quoted
 * @param {{minN?: number, pricing?: object}} opts
 */
export function forecast(samples, target, opts = {}) {
  const minN = opts.minN > 0 ? opts.minN : DEFAULT_MIN_N;
  const all = Array.isArray(samples) ? samples : [];

  // AN INPUT ERROR, NOT AN EMPTY ANSWER. A task with no estimate names no
  // bucket, so there is nothing to look up — and "not enough data" would blame
  // the backlog for a field somebody has not filled in.
  if (estimateHours(target && target.estimate) == null) {
    return {
      ok: false, why: "no-estimate",
      message: "a forecast needs an estimate — " + (target && target.id) +
        " has " + (target && target.estimate ? "`" + target.estimate + "`, which is not a countable estimate" : "none"),
    };
  }

  // NARROWEST FIRST, and the first cell that clears the threshold wins. If none
  // does, the loop ends on the WIDEST — so the `n` reported with a refusal is
  // the best case that exists, not the first cell we happened to look in.
  let used = BUCKET_ORDER[BUCKET_ORDER.length - 1];
  let pool = [];
  for (const bucket of BUCKET_ORDER) {
    used = bucket;
    pool = all.filter((s) => matches(s, target, bucket.fields) && measured(s));
    if (pool.length >= minN) break;
  }

  const base = {
    ok: true,
    task: target.id, estimate: target.estimate, type: target.type,
    bucket: used.key,
    degraded: used.key !== BUCKET_ORDER[0].key,
    n: pool.length,
    minN,
  };

  if (pool.length < minN) {
    return { ...base, insufficient: true, time: null, tokens: null, unknownRatio: null,
      message: "not enough data: " + pool.length + " closed task(s) in this bucket, " + minN + " needed" };
  }

  const hours = pool.map((s) => s.actual_minutes / 60).sort((a, b) => a - b);
  const known = pool.map((s) => s.unknown_ratio).filter((r) => typeof r === "number");

  return {
    ...base,
    insufficient: false,
    time: { p20: percentile(hours, 20), median: percentile(hours, 50), p80: percentile(hours, 80) },
    // THE SHARE OF UNATTRIBUTED MINUTES IN THE SOURCE DATA, averaged over the
    // bucket. `null` when no sample carried one — an unknown unknown is not 0.
    unknownRatio: known.length ? known.reduce((a, b) => a + b, 0) / known.length : null,
    tokens: tokenCells(pool, minN, opts.pricing),
  };
}

/**
 * Token ranges per model, or `null` when no adapter has ever run.
 *
 * `null` AND NOT AN EMPTY LIST: "no column" and "a column with nothing in it"
 * are read differently, and only the first is true when the cost axis was never
 * recorded. Each model is its own cell with its own `n`, and a cell below the
 * threshold says so rather than borrowing another model's samples.
 */
function tokenCells(pool, minN, pricing) {
  const { rates } = parsePricing(pricing);
  const byModel = new Map();
  for (const s of pool) {
    for (const m of s.models || []) {
      const total = (m.tokens_in || 0) + (m.tokens_out || 0);
      if (!total) continue;
      if (!byModel.has(m.model)) byModel.set(m.model, []);
      byModel.get(m.model).push({ total, in: m.tokens_in || 0, out: m.tokens_out || 0 });
    }
  }
  if (!byModel.size) return null;

  return [...byModel.keys()].sort().map((model) => {
    const rows = byModel.get(model);
    if (rows.length < minN) {
      return { model, n: rows.length, insufficient: true };
    }
    const totals = rows.map((r) => r.total).sort((a, b) => a - b);
    const cell = {
      model, n: rows.length, insufficient: false,
      p20: percentile(totals, 20), median: percentile(totals, 50), p80: percentile(totals, 80),
    };
    const rate = rates[model];
    if (!rate) return { ...cell, mode: null, amount: null, why: "no rate for this model in `model_pricing`" };
    if (rate.mode === "subscription") {
      return { ...cell, mode: "subscription", amount: null,
        why: "billed by subscription — the marginal cost of one task is not a dollar amount" };
    }
    if (rate.mode === "local") {
      return { ...cell, mode: "local", amount: { p20: 0, median: 0, p80: 0 },
        why: "a local model — the rate is a declared zero" };
    }
    // The in/out SPLIT is the bucket's, not this task's — a forecast cannot know
    // its own split, and applying the bucket's is the only honest reading.
    const inShare = rows.reduce((a, r) => a + r.in, 0) / rows.reduce((a, r) => a + r.total, 0);
    const perToken = (inShare * rate.inPerMillion + (1 - inShare) * rate.outPerMillion) / 1_000_000;
    return {
      ...cell, mode: "api", why: null,
      amount: { p20: cell.p20 * perToken, median: cell.median * perToken, p80: cell.p80 * perToken },
    };
  });
}

/** The bucket a forecast used, in words. Used by the terminal and by nothing
 *  else — the shape a machine reads is `bucket` itself. */
export function bucketLabel(key) {
  return key === "estimate+type" ? "estimate x type" : "estimate alone";
}

/** A time range, in the same words `stats --calibration` uses. */
export function rangeLabel(range) {
  if (!range) return "—";
  return spanLabel(range.p20) + " - " + spanLabel(range.p80) + " (median " + spanLabel(range.median) + ")";
}
