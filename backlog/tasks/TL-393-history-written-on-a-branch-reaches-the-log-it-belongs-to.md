---
id: TL-393
title: "History written on a branch reaches the log it belongs to"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P1
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 1h
confidence: high
created: 2026-09-21
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: stranded-records-landed
    bash: "for u in 01M1NM5SRCK8RVV2X2NH00468H 01M1NM5SRCN8Z8EWH2E8T71KW1 01M1NM7CS0T6SDRZSH52CGZ72V 01M1NM7CS0JCJ1A9XNT58RHSVC; do grep -q $u backlog/history/TL-80.jsonl || exit 1; done; for u in 01M1NKY9G8V4M1T6SBRTDA0YZN 01M1NKY9G8SZ14TAGX837HQVZF 01M1NM7CNMQVGSXFQ699SSB1SH 01M1NM7CNM8HS5A2MJATKH46AD; do grep -q $u backlog/history/TL-91.jsonl || exit 1; done"
  - id: the-tree-still-agrees
    bash: "node scripts/cli.mjs check"
---

## Goal

Eight history records that were written by the tool, and never left the worktree
they were written in, are in the logs of the tasks they describe.

## Context

On 2026-09-04 a session in `.claude/worktrees/autonomous-flow-tasks-35273f` took
TL-91 and TL-80 and released both within five minutes, as a live demonstration
for TL-122 — whether an open viewer page learns of a take made in another
worktree. Each `take` and each release wrote a pair of records, eight in all,
with a `reason` stating what they were for.

They were never committed. The branch was merged, the tree moved on — TL-80 is
cancelled, TL-91 is done, and their logs grew to twelve and twenty-one records —
and the eight sat in an uncommitted diff in a worktree nobody had opened since.
They were found while retiring the stale worktrees in that directory, at the
point where removing one would have deleted them.

WHY THEY ARE NOT DISCARDED. AGENTS.md draws the line without leaving room: the
log is append-only, and a `reason` written by a person is their sentence, not a
field a later pass may correct. The single exception in the project's history
was a name that could not lawfully be published, and it explicitly did not touch
a `reason`. "It was only a demonstration" is not that kind of reason — the
demonstration happened, and the records are what happened.

WHY APPENDING IS SAFE AND NOT A GUESS. The eight records were checked against
the logs they belong to before anything was written: none of their ULIDs was
present. Their timestamps fall before every record main holds for either task,
and their `from`/`to` chains close — each task goes out of the queue and back
into it, leaving the field exactly where the next record expects to find it. The
logs merge by union of lines, so this is the operation the format is built for,
not a repair around it.

WHY THE ORDER IN THE FILE IS NOT CHRONOLOGICAL. They are appended at the end,
after records with later timestamps, because that is the order in which they
ARRIVED and the file is append-only. `TL-91.jsonl` was already unsorted for the
same reason. Anything that reads the log sorts by `ts`.

## Pre-flight reading

1. AGENTS.md, "What was written in Polish before this rule STAYS" — the clause
   that makes an append-only log something other than a file that can be tidied.
2. `backlog/history/TL-80.jsonl` and `TL-91.jsonl` — the chains the eight
   records have to close without contradicting.

## Steps

1. Extract the uncommitted records from the worktree's diff.
2. Prove each ULID is absent from the log it is going into.
3. Append, then check the tree against the tool rather than by eye.

## Acceptance criteria

- [x] All eight records are in the logs of TL-80 and TL-91.
      [proof: stranded-records-landed]
- [x] The tree's own guards still pass over the enlarged logs.
      [proof: the-tree-still-agrees]
