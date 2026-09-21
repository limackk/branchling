---
id: TL-411
title: "Every line of scripts/tests/history.test.mjs is English"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: history-tests-green
    bash: "node --test scripts/tests/history.test.mjs"
  - id: no-polish-left
    bash: "! grep -nE 'Zarezerwowane|duplikatow|wyprodukowal|zglosil' scripts/tests/history.test.mjs"
---

## Goal

No Polish prose remains in scripts/tests/history.test.mjs; every comment and assertion message in it is English, and each translated assertion still claims exactly what it claimed before.

## Context

Found while working on TL-387. AGENTS.md states without exception that every file in this repository is written in English, and names scripts/ explicitly. scripts/tests/history.test.mjs still carries Polish: the section heading `// -- Zarezerwowane typy zdarzen (BL-1404 krok 5) --`, the assertion message "bez duplikatow", the assertion message "diffMeta wyprodukowal " + c.field, and the fixture comment text "support: klient zglosil ponownie" (that last one is a comment's CONTENT inside a fixture, so replacing it changes no claim the test makes). A failing assertion's message is the only sentence a reader gets, so a stranger cannot read what these tests say when they break. The append-only backlog/history/*.jsonl logs are explicitly OUT of scope: AGENTS.md freezes them.

## Steps

1. Translate the four occurrences in scripts/tests/history.test.mjs, preserving what each assertion claims.
2. Grep the rest of scripts/tests/ for the same shape of leftover; if other files carry it, name them in a separate task rather than widening this one.

## Acceptance criteria

- [ ] the translated assertions still hold [proof: history-tests-green]
- [ ] the four measured occurrences are gone [proof: no-polish-left]
