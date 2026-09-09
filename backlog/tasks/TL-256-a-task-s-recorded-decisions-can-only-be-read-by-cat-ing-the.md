---
id: TL-256
title: "A task's recorded decisions can only be read by cat-ing the raw log"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-09
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: the-name                   # optional; a criterion below points at this id
    bash: "command to run"
---

## Goal

`branchling` can RECORD an event about a task and cannot show one back. A
read-side command prints a task's `backlog/history/<ID>.jsonl` as the exchange
it is — who held the task, what they handed on, and with what reason — so a
session that has to know what was already decided asks for it instead of
reading the file.

## Context

The command table has `history`, and its one-line description says what it is
for: "record changes made outside the tool". There is no counterpart that
reads. `query`, `stats` and `next` answer from the task FILES; none of them
touches the append-only log, and a task file carries only the CURRENT value of
a field, never the reason it got there — which is the whole point of TL-105
moving the "why" out of `## Log` and into the log.

So the only way to see a task's recorded decisions is
`cat backlog/history/<ID>.jsonl`. That is the raw bulk read the context-economy
rule in `CLAUDE.md` exists to prevent, and its cost grows with the number of
events, not with the size of the answer. Measured, not guessed: TL-167 had
accumulated 19 records by 2026-09-04, five of them handoffs whose `reason` is
repeated verbatim across four rows each (`status`, `owner`, `role`,
`__comment__`), so a session reading it to find one answer pays for the same
paragraph four times over. The instruction that sends a session there — "read
`backlog/history/<ID>.jsonl` for a decision before you design anything" — is
therefore an instruction to break the project's own rule, because the tool
offers nothing else.

The one-event-per-FIELD shape is right for an append-only log and wrong for a
reader: what a person wants back is one row per EXCHANGE, with the fields that
moved beside it.

## Steps

1. Decide the surface: a `--json`-carrying read on `history` (`history <ID>
   --show`), or a command of its own. Whichever is chosen, the fourth law
   applies — `--json` on the reading side.
2. Collapse the records into exchanges: rows sharing a `ts`, `actor` and
   `reason` are ONE handoff and print as one, listing the fields that changed.
3. Print the `reason` once per exchange. A reason repeated four times is the
   defect that makes the raw file expensive.
4. Say what it costs, in `stats --context`, beside the other reading commands.

## Acceptance criteria

- [ ] A task's history is readable through the tool, without opening the file.
- [ ] Rows written by one write print as one exchange, with the reason once.
- [ ] The reading command carries `--json`.
- [ ] A task with no log at all is answered as such, not as an error.
- [ ] `stats --context` names what the new command costs.

## Notes

- Surfaced in TL-167, whose spec hand had to `cat` a 19-record log to find out
  that the question it carried had already been answered.
- This is a READ. Nothing about the append-only rule changes: the log is still
  never rewritten, and a `reason` written by a person is still their sentence.
