---
id: TL-130
title: "The server's reconcile signs someone else's changes as unknown/external before a session can attribute them"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: attribution-race
    bash: "node --test scripts/tests/history.test.mjs"
---

## Goal

A change made by hand and attributed to itself by a session (`worktrail
history --actor <ns:name> --source manual --reason "…"`) must land in the
history WITH that author and that reason — even when `worktrail serve` is
running in the background. Today it loses the race and lands as `actor:
unknown`, `source: external`, `reason: unknown`, while the attributing command
says "no changes to record".

## Context

Measured during TL-97 (2026-09-01). A session changed `status: blocked` →
`pending` in TL-99 and TL-100, then followed the documented path:

```
worktrail history --actor agent:claude-code --source manual --reason "…"
→ worktrail history: no changes to record
```

Yet `backlog/history/TL-99.jsonl` holds an entry at 16:28:28 with
`"actor":"unknown","source":"external","reason":"unknown"`. It was written by
`scripts/serve-backlog.mjs:252` — the `scheduleReconcile()` loop of the
running viewer server. Reconcile updates the snapshot, so the next `history`
call no longer sees a DIFFERENCE and stays silent: the attribution is lost
irrecoverably, because the log is append-only and is never rewritten.

**Why this is not cosmetic.** `worktrail instructions task-execution` gives
`worktrail history --actor … --source manual` as the path for manually made
changes. In a repository with a running server, this path DOES NOT WORK and
reports that it had nothing to do — that is, it looks like it succeeded. The
effect is the opposite of the whole mechanism's purpose: `actor` was supposed
to have one-hundred-percent presence precisely because it is enforced on
write.

The comment at `serve-backlog.mjs:238-244` shows the problem was anticipated:
`RECONCILE_DELAY_MS = 2500` exists so an agent hook has time to write its
entry first. That works for a HOOK, which writes within milliseconds, and does
not work for a human, or for a session that edits the file and attributes the
change to itself a minute later. The delay is a bet on timing, not a rule.

Directions to consider (none is settled — this is exactly the design decision
this separate task exists for):

1. **Defer instead of guessing**: reconcile sees the difference but writes it
   only after a grace window much longer than 2.5 s, and the viewer shows it
   as "unattributed" until it is written.
2. **An entry to attribute**: `external/unknown` stays, but `worktrail history
   --actor … --reason …` can APPEND an attribution entry to an already
   recorded event (a new entry pointing at the `id` of the previous one),
   instead of looking for a difference in the tree. The log stays
   append-only.
3. **Server reconcile stays read-only**: the server detects the difference and
   signals it over SSE, but it is written ONLY by whoever knows the author.

## Pre-flight reading

1. `scripts/serve-backlog.mjs` — `scheduleReconcile()`, `RECONCILE_DELAY_MS`
   and the comment above them (238-265).
2. `scripts/history.mjs` — `reconcile()`, especially the snapshot update,
   since that is what closes the path for a second writer.
3. `scripts/history-record.mjs` — the `--actor … --source manual` path.
4. `docs/backlog-field-editing-history.md` — why `actor` and `source` exist at
   all.

## Acceptance criteria

- [ ] Positive control: a test reproduces the race — a change in the file,
      "server" reconcile, then `history --actor … --reason …` — and today it
      FAILS. [proof: attribution-race]
- [ ] After the fix, the author and reason given by the session are in the
      history, not `unknown/unknown`. [proof: attribution-race]
- [ ] The log stays append-only: no existing entry is rewritten or removed.
      [proof: attribution-race]
- [ ] `worktrail history` does not say "no changes to record" in a situation
      where a change exists but only lacks attribution. [proof: attribution-race]
