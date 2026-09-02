---
id: TL-155
title: "The manual lists JSON payload keys and nothing checks them"
type: bug
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: keys-checked
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: positive-control
    bash: "cp docs/manual.md /tmp/wt-manual.bak && sed -i.tmp 's/`perWeekMean`/`perWeekMeen`/' docs/manual.md && ! node --test scripts/tests/json-envelope.test.mjs >/dev/null 2>&1; rc=$?; cp /tmp/wt-manual.bak docs/manual.md; rm -f docs/manual.md.tmp /tmp/wt-manual.bak; test $rc -eq 0 && echo 'a key the manual misspells FAILS the suite — OK'"
---

## Goal

The key list in the manual's `--json` contract table is checked against
`KINDS` in `scripts/json-envelope.mjs`, so a key added, renamed or removed in
the code cannot stay undocumented — and the table's existing drift is closed.

## Context

`scripts/tests/json-envelope.test.mjs` asserts that every `kind` the code can
emit appears in `docs/manual.md`. It checks the KIND NAME and nothing else,
while the table beside it lists **every payload key** for each kind — a much
stronger promise, with nothing holding it up.

It has already drifted, and this was found by reading rather than by a test:

- `task-list` declares `scan` in `KINDS`; the table lists `tasks`, `total`,
  `limit`.
- `stats` declares `scan` and `divergent`; the table lists `root`, `stats`.

Both are keys a consumer is promised will always be present — that is the
envelope's own rule — and neither is written down. The drift is small today
precisely because nothing has been checking: it grows one commit at a time.

**The obvious fix has a trap in it.** Asserting that every key of every kind
appears somewhere in the section passes trivially, because short key names
(`ok`, `id`, `root`) occur throughout the prose. The assertion has to be
against the TABLE ROW for that kind, not against the section, and it needs a
positive control: a deliberately misspelled key in the table must turn the
suite red, or the test is green with no evidentiary force (CLAUDE.md).

**Direction, not a decision already made:** parse the row for each kind out of
the markdown table, extract the `` `backticked` `` names, and compare the SET
against `Object.keys(KINDS[kind])`. A key in the code and not the row fails; a
key in the row and not the code fails too, because a documented key nobody
emits is a promise the tool does not keep.

## Pre-flight reading

1. `scripts/json-envelope.mjs` — `KINDS` is the contract; the emptiness rule in
   the header is what makes the key list a promise rather than a description.
2. `docs/manual.md`, `## The `--json` contract` — the table this has to check.
3. `scripts/tests/json-envelope.test.mjs`, "the manual documents every kind the
   code can emit" — the assertion this extends. TL-154 repointed it from the
   README to the manual and deliberately did not strengthen it, because that is
   a different thesis.

## Steps

1. Extract the per-kind key sets from the table.
2. Compare both directions against `KINDS`, naming the kind and the key.
3. Close the drift the new check finds — starting with `task-list` and `stats`.

## Acceptance criteria

- [ ] The test compares the table's keys with `KINDS` in BOTH directions. [proof: keys-checked]
- [ ] A key misspelled in the table turns the suite red — the check is not satisfied by prose elsewhere in the section. [proof: positive-control]
- [ ] `scan` on `task-list` and `scan`/`divergent` on `stats` are documented. [proof: keys-checked]

## Notes

- Found while closing TL-154. Deliberately left out of it: that task's thesis
  is that a moved section leaves its test asserting the wrong file, and a
  stronger contract is separate work with a doc migration attached.
