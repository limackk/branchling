---
id: TL-92
title: "worktrail session — report from an agent's session"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P2
status: blocked
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - docs/backlog-field-editing-history.md
verification:
  - bash: "node --test scripts/tests/session-report.test.mjs"
---

## Goal

A black box for agent work:

- `worktrail sessions --since yesterday` — a list of sessions: who, which
  task, how long, how it ended;
- `worktrail session <id>` — the narrative of one session: tasks taken,
  fields changed (from history), activity clusters, tokens/cost when the
  adapter provided them.

Target scenario: in the morning after a night of work by a fleet of agents,
one command says what each session delivered — EMPTY SESSIONS included. A
session with heartbeats and no status transition at all is a signal ("the
agent worked and closed nothing"), not silence.

## Context

Emerged from a review of differentiators against Backlog.md (2026-08-31). The
`session` key already exists in the heartbeat design
([docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §5) —
this task only stitches together two existing logs downstream of it:
`activity/` (heartbeats, clusters, attribution) and `history/` (field changes
with actor). It adds no new record; it is a pure read, like `stats`.

Rules inherited from the source documents:
- clustering and minutes are counted by ONE implementation from TL-28 — do
  not copy the counter (the class of "the same decision in two places");
- `unknown` and single-element clusters are reported explicitly (§6, §8.2);
- raw heartbeats are the private data of the machine (§9) — the per-session
  report shows time and events, but the command runs on the log owner's
  machine; do not build someone's calendar export out of this.

A natural extension for later (not in this task): `worktrail standup` — an
aggregate note across all actors for yesterday.

## Pre-flight reading

- [docs/backlog-time-tracking.md](../../docs/backlog-time-tracking.md) §5–§8
  — heartbeat format, clustering, the attribution chain, the `session` role.
- [docs/backlog-field-editing-history.md](../../docs/backlog-field-editing-history.md)
  §2 — history entries; correlating with a session requires the hook to also
  record a session identifier on a field change — if TL-28 did not provide
  for that, report it there, do not work around it here.
- `scripts/history.mjs` — reading and dedup.

## Steps

1. Reading sessions: group heartbeats by `session`, join with `history/`
   entries of the same actor and time window (or session identifier, if
   TL-28 records it there).
2. `sessions`: a table of sessions with `--since` / `--actor` / `--task`
   filters; sessions without status transitions marked explicitly.
3. `session <id>`: a chronological narrative — focus, field changes,
   clusters with minutes, total tokens (a conditional column) together with
   the `model` field from the activity row — "280k tokens" means something
   different for Sonnet over the API, an agent on a subscription, and a
   local llama on Ollama, so a number without a model is under-interpretable.
   Amount by billing mode from TL-30 (amount / tokens-without-amount / zero
   declared / null).
4. `--json` on both commands.
5. Tests on fixtures: two parallel sessions on one task do not blend
   together; an empty session is visible; missing cost column ≠ zero.

## Acceptance criteria

- [ ] Two parallel sessions on the same task are reported separately.
- [ ] A session without status transitions appears in `sessions` with an
      explicit marker.
- [ ] Minutes are counted by the clustering implementation from TL-28 — this
      task has no second counter.
- [ ] Missing cost data is not reported as 0.
- [ ] The token total in a session narrative always carries a model; a
      session with heartbeats from more than one model reports tokens per
      model, not a single sum.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created from the review of agentic
  differentiators; waiting on heartbeats and the session field from TL-28.
- 2026-08-31 revised — agent:claude — tokens in the narrative always carry a
  model, and are shown per model; amounts follow billing modes from TL-30.
