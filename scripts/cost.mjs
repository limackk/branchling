/**
 * The second axis: tokens, and the amount only where an amount exists (TL-30).
 *
 * WHY A SECOND AXIS AT ALL. Engaged time (TL-28) measures the calendar span of
 * work, not its size: two forty-minute tasks can differ several times over in
 * tokens, and it is that number which says how much work there really was — and
 * what it cost. Time also depends on model speed and on how often a person
 * interrupted; tokens do not.
 *
 * THE CONTRACT THAT SHAPES EVERY FUNCTION HERE: no adapter means `null`, never
 * `0`. Zero says "measured, and it came out free", which is untrue, and it is
 * the same untruth `estimateHours()` refuses when it returns `null` for an
 * estimate it cannot parse. Every total below can be `null`, and every caller
 * has to say so out loud.
 *
 * FOUR DISTINGUISHABLE ANSWERS, NOT TWO (§10, step 4 of TL-30). A user on a
 * Claude Code or Codex subscription, or on a local model, must get a forecast as
 * useful as an API user's — only without fictitious dollars:
 *
 *   amount        `api` with a rate in `model_pricing`
 *   no amount     `subscription` — the marginal dollar cost of one task is
 *                 fiction, so tokens are reported and the reason is stated
 *   declared zero `local` — a rate of zero somebody DECLARED, which is a fact
 *                 about the deployment and not an absence of data
 *   null          no adapter, or a model with no entry in `model_pricing`
 *
 * PRICES ARE DATA. They live in `model_pricing` in config.yaml, never in this
 * file: a rate typed into the code is wrong the week after it is written, and
 * wrong silently. A model the log carries and the pricing does not is counted
 * apart as "no rate" rather than dropped — the tokens are real even when the
 * amount is not knowable.
 *
 * PURE. No disk, no imports. The callers assemble the rows.
 *
 * Tests: `node --test scripts/tests/cost-adapter.test.mjs`
 */

/** How a model is billed. A CLOSED list: each value changes what the report may
 *  say, so a project inventing a fourth would produce rows nothing can weigh. */
export const BILLING_MODES = ["api", "subscription", "local"];

/** Rates are quoted per million tokens, which is how every vendor quotes them.
 *  Writing them per token in a config file invites a misplaced zero that nothing
 *  can catch. */
export const RATE_UNIT_TOKENS = 1_000_000;

/**
 * One entry of `model_pricing`, parsed. PURE.
 *
 *   "3.00/15.00"    → api, $3.00 per million in, $15.00 per million out
 *   "subscription"  → tokens without an amount, and the reason
 *   "local"         → a declared zero
 *
 * An unreadable entry returns `{mode: null, error}` rather than throwing: a
 * typo in one model's rate must not take the whole report down, because the
 * OTHER models' tokens are still true.
 */
export function parseRate(spec) {
  const text = String(spec == null ? "" : spec).trim();
  if (!text) return { mode: null, error: "empty" };
  if (text === "subscription" || text === "local") return { mode: text };
  const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (!m) {
    return {
      mode: null,
      error: "expected `<in>/<out>` per million tokens (e.g. `3.00/15.00`), " +
        "or the word `subscription` or `local` — got `" + text + "`",
    };
  }
  return { mode: "api", inPerMillion: parseFloat(m[1]), outPerMillion: parseFloat(m[2]) };
}

/** The whole `model_pricing` map, parsed, with the unreadable entries named
 *  rather than swallowed. PURE. */
export function parsePricing(map) {
  const rates = Object.create(null);
  const problems = [];
  for (const model of Object.keys(map || {})) {
    const rate = parseRate(map[model]);
    if (rate.mode == null) problems.push(model + ": " + rate.error);
    else rates[model] = rate;
  }
  return { rates, problems };
}

/**
 * Tokens per model across a set of activity rows, and what each is worth. PURE.
 *
 * A ROW WITHOUT TOKENS CONTRIBUTES NOTHING AND IS NOT AN ERROR — that is the
 * normal case for every host without an adapter, and the whole point of the
 * fields being optional.
 *
 * @param {Array<object>} rows   activity rows; only `tokens_in`/`tokens_out`/`model` are read
 * @param {object} rates         the output of `parsePricing().rates`
 */
export function costByModel(rows, rates) {
  const byModel = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    const inTok = Number.isInteger(r.tokens_in) ? r.tokens_in : 0;
    const outTok = Number.isInteger(r.tokens_out) ? r.tokens_out : 0;
    if (!inTok && !outTok) continue;
    const model = String(r.model || "").trim();
    if (!model) continue;
    if (!byModel.has(model)) byModel.set(model, { model, tokens_in: 0, tokens_out: 0, rows: 0 });
    const cell = byModel.get(model);
    cell.tokens_in += inTok;
    cell.tokens_out += outTok;
    cell.rows++;
  }
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model)).map((cell) => {
    const rate = (rates || Object.create(null))[cell.model];
    const tokens = cell.tokens_in + cell.tokens_out;
    if (!rate) {
      // NAMED, NOT DROPPED. The tokens happened; only the amount is unknowable.
      return { ...cell, tokens, mode: null, amount: null, why: "no rate for this model in `model_pricing`" };
    }
    if (rate.mode === "subscription") {
      return { ...cell, tokens, mode: "subscription", amount: null,
        why: "billed by subscription — the marginal cost of one task is not a dollar amount" };
    }
    if (rate.mode === "local") {
      // A DECLARED zero, and the `why` is what distinguishes it from `null`.
      return { ...cell, tokens, mode: "local", amount: 0, why: "a local model — the rate is a declared zero" };
    }
    return {
      ...cell, tokens, mode: "api",
      amount: (cell.tokens_in * rate.inPerMillion + cell.tokens_out * rate.outPerMillion) / RATE_UNIT_TOKENS,
      why: null,
    };
  });
}

/**
 * The whole cost report. PURE.
 *
 * `tokens` is `null` — not `0` — when no row carried any: that is the shape of
 * "nothing measured this", and it is what the contract of this module is about.
 * `amount` is `null` unless EVERY model that contributed tokens has a mode which
 * yields one; a partial sum would be a number smaller than the truth wearing the
 * authority of a total.
 */
export function costReport(rows, pricing) {
  const { rates, problems } = parsePricing(pricing);
  const models = costByModel(rows, rates);
  if (!models.length) {
    return {
      tokens: null, amount: null, models: [], problems,
      why: "no activity row carries tokens — no cost adapter has run against this log",
    };
  }
  const tokens = models.reduce((a, m) => a + m.tokens, 0);
  const priced = models.every((m) => m.amount !== null);
  return {
    tokens,
    amount: priced ? models.reduce((a, m) => a + m.amount, 0) : null,
    models,
    problems,
    why: priced ? null : "some tokens have no amount: " +
      models.filter((m) => m.amount === null).map((m) => m.model + " (" + (m.mode || "no rate") + ")").join(", "),
  };
}

/** A token count in the form people read it in. `null` stays `null` — it is not
 *  a number and must not be printed as one. */
export function tokensLabel(n) {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}

/** An amount, distinguishing "zero because somebody declared it" from "unknown".
 *  The caller decides which it holds; this only formats. */
export function amountLabel(amount) {
  if (amount == null) return "—";
  if (amount === 0) return "$0.00";
  return "$" + (amount < 0.01 ? amount.toFixed(4) : amount.toFixed(2));
}
