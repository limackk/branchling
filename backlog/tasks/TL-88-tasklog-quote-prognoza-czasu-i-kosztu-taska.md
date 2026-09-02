---
id: TL-88
title: "worktrail quote — time and cost forecast for a task"
type: task
labels: []
board: main
epic: "Agent-facing differentiators"
priority: P2
status: in_progress
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: [TL-29]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test scripts/tests/quote.test.mjs"
---

## Goal

`worktrail quote TL-NNNN` answers BEFORE a task is handed to an agent: "tasks
with this estimate and type finish in 1.4–4.1 h and 250–400k tokens (n=41)".
The TL-29 calibration computes bias after the fact; this command inverts it
into a forecast — an answer to a question no backlog tool asks: **how much
will running an agent on this task cost**.

## Context

Grew out of a differentiators review against Backlog.md (2026-08-31). All the
mechanics are derived from the calibration: the same buckets (estimate ×
type × board), the same confidence thresholds. The command computes nothing
new — it reads the distribution TL-29 already computed and picks the bucket
for the given task.

Rules carried over verbatim from
[docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11,
because this is where lying is easiest:
- below the `n` threshold the answer is "not enough data", not a number;
- always a range (p20–p80), never a point;
- cost in tokens only when the cost adapter (TL-30) has supplied the column
  — no adapter means no column, not zero;
- **tokens are the forecast's primary axis, the dollar amount is a
  conditional derivative.** An amount appears only when EVERY source row of
  the bucket has an API rate from the price list; data from `subscription`
  mode gives tokens without an amount (with a reason), data from `local`
  mode gives a declared zero (billing modes: TL-30 step 4). A user on a
  Claude Code / Codex subscription, or on Ollama, is to get a forecast just
  as useful as an API user — only without fictitious dollars;
- **a bucket does not mix models.** Sonnet tokens through the API and a
  local llama's tokens are incomparable units of effort; an activity row
  carries a `model` field (TL-30), so with data from more than one model the
  bucket is additionally sliced by model, and cells below the `n` threshold
  say "not enough data" instead of averaging across models;
- the share of `unknown` in the source data is part of the answer: a
  forecast built from data where 60% of the time is unattributed has to say
  so.

Optional extension (a separate task, once quote proves out): a `budget:`
field in the frontmatter and a hook warning when a multiple of the forecast
is exceeded. Do not fold this in here.

## Pre-flight reading

- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §11
  — calibration report format, `n` thresholds, the range rule.
- `backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md` — where
  and in what shape the calibration stores its results; quote IS to read
  them, not recompute them.
- `scripts/task-fields.mjs` — reading the estimate and type of the given
  task.

## Steps

1. Bucket selection: estimate + type of the given task; when no cell meets
   the `n` threshold — degrade to the estimate alone, explicitly stated in
   the output.
2. Text output and `--json`: time range, token range (if data exists), `n`,
   `unknown` share, the bucket used.
3. A task without an estimate: a message stating that the forecast requires
   an estimate — an input error, not an empty answer.
4. Tests on fixtures with a synthetic rollup: a full bucket, a bucket below
   the threshold, data without a token column, a high `unknown_ratio`, data
   from two different models (sliced by model, no averaging across), sources
   in `subscription` and `local` mode (amount not produced / produced as a
   declared zero).

## Acceptance criteria

- [ ] A bucket with `n` below the threshold gives "not enough data", never a
      number.
- [ ] The answer is always a range; never a single average.
- [ ] No cost adapter = no token column in the output.
- [ ] A dollar amount is not produced from `subscription` data; `local` data
      gives a declared zero, distinguishable from missing data.
- [ ] A bucket with data from more than one model does not average tokens
      across models.
- [ ] `--json` carries the same fields as the text output.
- [ ] Tests do not assert values from this project's own data — dedicated
      fixtures (rule from CLAUDE.md).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the agent-facing
  differentiators review; waiting on the TL-29 calibration (and indirectly
  on data from TL-27/25).
- 2026-08-31 revised — agent:claude — billing modes accounted for (API /
  subscription / local model) and bucket slicing by model; tokens as the
  primary axis, amount as a conditional derivative.
</content>
