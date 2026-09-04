---
id: TL-151
title: "A session that died mid-task is resumed from one briefing, not from a search"
type: task
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: dev
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail resume <ID>` prints, for a reader with none of the previous
session's conversation, everything that session left behind: the task file,
its history since it was taken, the diff of its branch against `main`, the
result of the last verification run, and, once TL-80 exists, the execution
notes. One command, one document, written in the order a fresh session
should read it.

The autonomous-loop guide already states the principle: the file is the
memory, because context compaction drops reasoning first. What it does not
give is the OTHER half of what a dead session knew — the code it had written
and the last thing the contract said about it. Today a successor
reconstructs that from `git diff`, `history`, and re-running `done
--dry-run` by hand, and each of those is a chance to miss one. Backlog.md
cannot assemble this because it has no history and no contract to re-run.

## Context

**Composition, not a new store (law 2, law 4).** Every part exists as a
command with `--json`: `take` (idempotent under the same actor, re-prints
the file), `history`, `done --dry-run`, and git. `resume` composes their
output; it must not persist anything, and deleting nothing must be
possible because nothing was written.

**Order is the product.** The briefing is read top-down by an agent that
will act on the first thing it understands. Order: (1) the open question or
decision if any (TL-148), (2) the task's Goal, (3) what changed since the
take, from history, with actors, (4) the branch diff, (5) the last contract
result, entry by entry. A wrong order is a wrong briefing.

**The diff is against the merge base, not against `main`'s tip.** `main`
moved while the session was dead; a diff against the tip mixes other
people's work into "what this session did".

**The contract is re-run, not recalled.** The last verification result is
stale by definition; `resume` runs `done --dry-run` NOW and prints that. If
the run is expensive, `--no-verify` skips it and says so at the top of the
briefing; it never prints an old result as if it were current.

**Under the same actor, `resume` does not change the claim.** A different
actor resuming an abandoned task is a takeover, and that path already exists
(`abandoned_after_days`, with the previous owner named); `resume` must not
become a second, quieter one.

## Steps

1. Compose: `take` under the same actor, `history --since <take ts>`,
   `git diff <merge-base>...HEAD`, `done --dry-run`.
2. Render in the fixed order above, plain text and `--json` envelope.
3. `--no-verify` with the disclaimer at the top.
4. Refuse to resume under a different actor; point at the takeover path.
5. Fixture: a task taken, edited on a branch, with one failing contract
   entry; positive control: the briefing MUST show the failing entry, and
   with the entry fixed MUST show it green.

## Acceptance criteria

- [ ] `resume` prints the briefing in the fixed order and nothing is written to disk. [proof: suite-green]
- [ ] The diff is against the merge base, not `main`'s tip. [proof: suite-green]
- [ ] The contract result is from a fresh run; `--no-verify` states the omission first. [proof: suite-green]
- [ ] A different actor is refused and pointed at the takeover path. [proof: suite-green]
- [ ] Positive control: the failing entry is shown, and shows green once fixed. [proof: suite-green]
- [ ] `--json` answers in the envelope. [proof: guards-green]
