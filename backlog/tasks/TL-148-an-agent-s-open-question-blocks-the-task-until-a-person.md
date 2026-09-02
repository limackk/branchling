---
id: TL-148
title: "An agent's open question blocks the task until a person decides"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: ["TL-114"]
blocks: []
related_docs: ["docs/backlog-human-agent-decisions.md"]
verification:                      # HOW to check that the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

`worktrail ask <ID> --question "…" --actor <ns:name>` records a question
event on the task and moves it to the status this backlog protects with a
stated reason (`blocked`), the reason pointing at the question's ULID.
`next` then passes over it. A person answers with `worktrail decide <ID>
--resolves <ULID> --reason "…"` (TL-114), which lifts the block, and the
next `next` prints the file with the decision placed where the agent reads
first.

Today an unattended loop has no move for "I am not allowed to decide this".
A handoff (TL-99) leaves the task `in_progress` or hands it back; nothing
records that the stop is a QUESTION, so `next` may offer the task to the
following session, which asks the same thing again. The decision panel
(TL-115) shows open questions to a person but does not stop the queue. This
task closes that loop: a question is a blocker, and the machinery that
already refuses `blocked` without a premise treats it as one.

No competitor has this, because it needs three things at once: an event a
decision can point at, a status that cannot be entered without a reason, and
a dispatcher that reads both.

## Context

**"Open question" is computed, not stored (law 2).** TL-114 defines it: a
question event that no `__decision__` resolves. This task adds no field to
the file; the block's reason carries the ULID, and unblocking is the
consequence of a `__decision__` with a matching `resolves`, not a separate
write. If two writes are needed to answer one question, the second one will
be forgotten in exactly the case this exists for.

**The block must survive the guards that exist.** TL-134 fails a `blocked`
task whose `blocked_by` are all closed, and TL-140 keeps `blocked` out of
unattended dispatch. A question-block has an empty `blocked_by` and a reason
naming a ULID; the guard has to recognise that shape as a premise, not as
the empty-premise case it was built to catch. Extend the guard's definition
of a premise; do not exempt the status.

**Where the decision lands in the file.** The agent reads the task file with
none of the conversation. The decision therefore has to be IN the printed
file, in the section read first — the same place a handoff's comment
appears today — not only in the history. Rendering it is `take`/`next`'s
job at print time, computed from the log, so the file on disk is not
rewritten by the answer.

**Idempotence under the same actor.** `ask` twice with the same text is two
questions, by the `__comment__` rule (two sentences said at different times
are two utterances). Do not dedupe questions by content.

**Actor namespaces apply.** A bare actor is refused, as everywhere. A
question from `agent:` and an answer from `user:` or `local:` is the
expected shape, and the history should make that shape visible.

## Steps

1. `ask`: write the question event, transition to `blocked` with the reason
   carrying the ULID, under the ordinary writing path (no hand edit).
2. `decide --resolves`: on a matching ULID, transition back to the status
   the task held before the question (recorded in the history, not
   guessed).
3. Extend the TL-134 guard's notion of a premise.
4. `next`/`take`: render unresolved-then-resolved decisions into the printed
   file at the top.
5. Tests with positive controls: a question blocks; a decision with the
   wrong ULID does NOT unblock; a bare actor is refused.

## Acceptance criteria

- [ ] `ask` moves the task to `blocked` with a reason naming the question ULID, and `next` skips it. [proof: suite-green]
- [ ] `decide --resolves <ULID>` lifts the block and restores the prior status. [proof: suite-green]
- [ ] A decision with a non-matching ULID leaves the task blocked. [proof: suite-green]
- [ ] The next `next` prints the decision inside the task file, above the body. [proof: suite-green]
- [ ] The TL-134 guard accepts a question-block as a premise and still fails an empty one. [proof: suite-green]
- [ ] A bare actor on `ask` is refused. [proof: suite-green]
- [ ] No new field in the task file; open questions are computed from history. [proof: guards-green]
