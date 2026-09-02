---
id: TL-170
title: "A done refused on a manual entry leaves nothing behind"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 4h
confidence: medium
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
verification:
  - id: suite
    bash: "node --test scripts/tests/verification-gate.test.mjs scripts/tests/audit.test.mjs"
  - id: residue
    bash: "node --test scripts/tests/manual-refusal-residue.test.mjs"
---

## Goal

When `worktrail done` refuses because a `verification:` entry is `manual:` and
nobody vouched, the refusal has to leave a trace the NEXT reader can find. Today
it leaves none, and the task becomes indistinguishable from one that was
abandoned.

Once this is done, a task stopped at a manual gate answers the question "what is
this waiting for?" from the backlog itself — without re-running the gate.

## Context

Found on 2026-09-02 through TL-89. Its code shipped in `3e6ff0e` and is on
`main`; five of its six verification entries pass automatically. The sixth is
`manual:` — the markdown has to be pasted into a real pull-request comment and
looked at. So `done` refused, correctly, and the file stayed `in_progress`.

**The refusal itself is not the defect.** It is this tool's thesis, and TL-102
exists to demonstrate it to a newcomer in sixty seconds. What is wrong is
everything that happens after it.

`scripts/done-task.mjs:495-530` has three refusal paths — `--json`, no terminal,
and an answer that was not the confirmation word. All three return without a
single write; two of them say so out loud ("Nothing was changed", "the task file
was not touched"). The reason therefore exists only in the terminal that printed
it, and dies with that session. This contradicts the rule the project states for
itself: the reason for a change travels with the WRITE. Here there was no write,
so nothing travelled.

What the reader gets instead, measured on TL-89:

- `backlog/history/TL-89.jsonl` — 6 entries, none about verification. The
  refused attempt is absent.
- `worktrail plan` — lists TL-89 under `next up` AND under `in progress`, in the
  same output, with no hint that a person is the blocker.
- `worktrail stats`, the viewer's task list and the Execution view — all read
  `status:`, so they show a task identical in every respect to one somebody is
  actively typing on right now.

The person who asked about this had no way to find out other than re-running
`done` by hand and reading what it printed. That is the defect: the tool knows a
fact — every automatic check is green, one human vouch is missing — and throws
it away.

**The vocabulary for this already exists and is not being reached for.**
`worktrail ask` is documented as "the move an unattended session has for `this
is not mine to decide`": it records the question as an event with an id, moves
the task into a status this project protects with a stated reason, and `next`
passes over it until `worktrail decide --resolves` answers. A manual gate hit by
a session with no terminal is exactly that shape.

## Decisions to make, not to assume

The implementer settles these; do not treat the list below as the design.

1. **Does the refusal WRITE, or only RECORD?** Recording an event in
   `backlog/history/` is the smaller move and keeps the promise "nothing was
   changed" literally true for the task file. Moving the task into a waiting
   status (the `ask` path) is louder and makes `next`, `plan` and every view
   correct for free — but it changes state on a command whose whole point was
   that it refused to. These are different products; pick one and say why.
2. **Which sessions.** The no-terminal path is unambiguous. The path where a
   person typed something other than `confirm` is a deliberate human "no", and
   may deserve different treatment from "there was nobody to ask".
3. **`--json` too.** A program parsing the output is the case least able to
   recover the reason from a terminal it never saw.
4. **Not by inflating `--confirm-manual`.** Making it easier for an agent to
   vouch for a human check would dissolve the guarantee instead of surfacing it.

## Acceptance criteria

- [x] A `done` that refuses on a `manual:` entry with no terminal leaves a
      record naming the task, the manual entry's text, and the fact that every
      automatic entry passed. [proof: residue]
- [x] The same holds under `--json`. [proof: residue]
- [x] A reader who did not run the command can find that reason from the backlog
      alone — no re-run of the gate. [proof: residue]
- [x] `--confirm-manual` still vouches exactly as it does today, and the
      existing refusal messages are not weakened. [proof: suite]
