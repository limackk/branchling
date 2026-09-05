---
id: TL-264
title: "A role is declared but never defined, so every fleet invents its own brief"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-291]
related_docs: []                   # paths relative to the repository root
verification:
  - id: roles-carry-a-brief
    bash: "node --test scripts/tests/role-brief.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A project that declares a role says what the role is for, in the repository,
where the branch carries it. Today `roles:` is a list of bare words and the
meaning of each one lives in whatever the launcher happened to type.

## Context

`backlog/config.yaml` declares `roles: [docs, spec, dev, review]`. Nothing
anywhere in the tree says what any of them may do. The four were driven
through nine waves on 2026-09-04, and the briefs that made them work -
`spec` writes the failing test and never touches production code, `dev`
makes it pass and never touches the test, `docs` corrects a stale fact in a
closed task and never its decisions - existed only as shell scripts in a
temporary directory outside the repository, passed to the vendor with
`--append-system-prompt`. They were edited three times during the runs, as
the hands reported what was wrong with them.

Every one of those edits is now unrecoverable, and they were the part that
worked. The sharpest rule of the set - run your task's own `verification:`
contract BEFORE changing anything, because a contract green from birth
proves nothing - is what caught TL-143 closing on an unfalsifiable proof.
The tool did not catch it, and TL-260 is now open to make the tool catch it;
but the rule itself, which is cheap and general, has no home.

**This is law 1 applied to the thing that runs law 1.** "State divorced from
the branch is the defect that external trackers were rejected for." A role's
brief is state about how this project's work is done. It travels in a `/tmp`
directory that dies with the session, is not reviewed, and cannot be
different on a branch that changes what a role means.

**What this is NOT asking for.** Not a plugin API and not an agent runner -
the fourth law settles both, and `instructions` already shows the shape the
answer takes: the tool holds prose and prints it, and composition does the
rest. `branchling instructions role <name>`, or a `roles:` that maps a name
to a description, would let a launcher pipe the project's own brief into
`--append-system-prompt` instead of writing one from memory.

**Two smaller facts found with this.** The comment above `roles:` said "this
project declares one role" while the list held four - written by the commit
that added the other three, and corrected in passing on 2026-09-04. And the
`instructions` guide for unattended runs does not mention roles at all, which
is TL-263.

## Steps

1. Decide the shape. The candidates: `roles:` becomes a map of name to
   description; a `roles/` directory of markdown briefs; a new
   `instructions role <name>` topic reading either. Record it with
   `branchling decide`. The constraint is the fourth law - whatever is
   chosen must be readable by composition, not by a hook the tool calls.
2. Implement it, and put this project's four briefs in it, including the
   contract-first rule that has already paid for itself once.
3. State what a role does NOT do. Every brief that worked was defined more
   by its prohibition - `spec` may not touch production code - than by its
   task.

## Acceptance criteria

- [ ] A role declared in `config.yaml` can carry a description, and a
      launcher can read it without opening the file, proven by a test that
      fails against today's code. [proof: roles-carry-a-brief]
- [ ] A project that declares roles with no descriptions still works
      unchanged. [proof: suite-green]
- [ ] The choice of shape is a `__decision__` event in
      `backlog/history/TL-264.jsonl`, not prose in this file.
