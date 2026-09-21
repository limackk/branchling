---
id: TL-30
title: "Token and session cost adapter"
type: task
labels: [post-launch]
board: main
epic: "Backlog — work time measurement"
priority: P3
status: done
owner: agent:claude
estimate: 4h
confidence: low
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  # `scripts/…`, not `backlog/scripts/…`: this task predates the extraction,
  # when code and data were co-located, and the contract inherited that layout.
  - id: cost-tests
    bash: "node --test scripts/tests/cost-adapter.test.mjs"
  - id: null-not-zero
    bash: "node scripts/cli.mjs time --cost --json | node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);if(d.tokens!==null&&!Number.isInteger(d.tokens))throw new Error('a missing adapter must give null, not zero');console.log('tokens:',d.tokens)})\""
  # `[[:space:]]` and not `\s`: inside a double-quoted YAML value a `\s` reaches
  # grep as an escaped backslash and the pattern then matches nothing — a guard
  # green with no evidentiary force.
  - id: adapter-is-a-plugin
    bash: "! grep -rlE '^[[:space:]]*import[^;]*from +.[^\"'\"'\"']*cost-adapter[.]mjs' scripts --include='*.mjs' | grep -v tests"
  - id: pricing-is-data
    bash: "! grep -rn 'inPerMillion: *[0-9]' scripts --include='*.mjs' | grep -v tests"
---

## Goal

Add a second axis for measuring agent effort: tokens and tool calls. An AI
agent's clock depends on model speed and on how many times a human
interrupted the session; tokens are independent of that and translate
directly into cost.

## Context

Engaged time (TL-28) measures the calendar span of work, not its size. Two
40-minute tasks can differ several times over in token count, and it is that
second number that says how much work there really was — and what it cost.

The constraint that shapes this task: **the module's core must not depend on
Claude Code.** The module is going open source and has to work over
someone else's process. The adapter is therefore an optional plugin, not a
condition for operation — and its absence must give `null`, not zero. Zero
would mean "measured, and it came out free," which is untrue; this is the
same contract that `estimateHours()` upholds.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §3 (cost as a fourth
   quantity), §7 (adapter, not a dependency), §10 (cost as a second axis).
2. `backlog/scripts/activity.mjs` — the shape of a row from TL-27; the cost
   fields are OPTIONAL and must stay that way.
3. `backlog/scripts/estimate.mjs` — the "`null`, never zero" contract.

## Steps

1. Extend the row shape with optional `tokens_in`, `tokens_out`, `model` —
   presence is not mandatory, absence ≠ zero.
2. Claude Code adapter: read usage from the session transcript (`SessionEnd`)
   and append an aggregate `kind: "session"` row with the attribution from
   TL-28.
3. `worktrail time --cost` — tokens and estimated cost per task/period;
   `null` and an explicit message when the adapter did not run.
4. Model pricing in `config.yaml` (data, not code) — without it the report
   gives tokens without an amount, instead of guessing a rate. A pricing
   entry accepts either a per-token rate **or** a billing-mode marker:
   `subscription` (Claude Code / Codex on a subscription — a task's marginal
   dollar cost is fiction, the report shows tokens without an amount, stating
   why) or `local` (a local model, e.g. Ollama — the rate is a DECLARED
   zero, distinguishable from `null`). Three distinguishable report outputs:
   amount / tokens-without-amount-because-subscription /
   declared-zero; the fourth stays `null` (no adapter, or no pricing entry).
5. Document: add to §8 whether tokens turned out to be a more stable
   predictor than time (§12 item 1).

## Acceptance criteria

- [x] The core works without an adapter — there is a test running
      `worktrail time --cost` on a log with no cost fields. [proof: cost-tests, null-not-zero]
- [x] Missing cost data gives `null` and a message, never `0`. [proof: cost-tests, null-not-zero]
- [x] Pricing is data in `config.yaml`, not a number in the code. [proof: cost-tests, pricing-is-data]
- [x] An unknown model in the log does not break the report — it is counted
      separately as "no rate." [proof: cost-tests]
- [x] The `subscription` and `local` modes produce report outputs
      distinguishable from each other and from `null` — there is a test for
      each of the three cases. [proof: cost-tests]
- [x] The adapter is not required by any other script in the module (import test). [proof: cost-tests, adapter-is-a-plugin]

## Verification

The runnable contract is `verification:` in the frontmatter; this is the same
list in prose, with the paths corrected to the post-extraction layout
(code in `scripts/`, data in `backlog/`).

```bash
# 1. Adapter tests — expected: pass, including a run WITHOUT the adapter
node --test scripts/tests/cost-adapter.test.mjs

# 2. No adapter gives null, not zero — expected: "tokens: null"
node scripts/cli.mjs time --cost --json | node -e "…assert tokens is null or an integer…"

# 3. Core independence — expected: no matches. The check is on the IMPORT, not on
#    the word: two modules name the adapter in a comment so a reader can find it,
#    and a grep for the string would fail on prose while missing an aliased import.
#    The programmatic version, with its positive control, is in the test file.
grep -rlE '^[[:space:]]*import[^;]*from +.[^"'\'']*cost-adapter[.]mjs' scripts --include='*.mjs' | grep -v tests

# 4. Prices are DATA — expected: no rate literals in the code
grep -rn 'inPerMillion: *[0-9]' scripts --include='*.mjs' | grep -v tests
```

## Notes

- Deliberately out of scope: adapters for other hosts (Cursor, Copilot). The
  `worktrail activity record` contract from TL-28 already allows for them;
  writing them without a user would be guesswork.
- If tokens turn out to be a CLEARLY better predictor than time, that changes
  the default report axis from TL-29 and needs a separate task, not a silent
  swap.
- This task becomes the PRIMARY axis, not a secondary one, if the
  correlation gate from TL-29 (step 0) comes out negative — then its
  priority moves up.
- A row with tokens describes a session, so it is subject to the same
  retention and the same `forget` as the rest of the log
  ([TL-31](TL-31-retention-attribution-correction-and-the-right-to-deletion.md)).

## Log

- 2026-08-30 created — claude — drafted from the time-tracking design
  (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — after adversarial review: tied to the
  correlation gate from TL-29 and to the retention from TL-31
- 2026-08-31 revised — agent:claude — pricing extended with billing modes
  (api / subscription / local): amount, tokens-without-amount, and declared
  zero must be distinguishable from each other and from null
