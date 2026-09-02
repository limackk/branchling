---
id: TL-161
title: "query accepts a status outside the vocabulary and answers zero"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/query-vocabulary.test.mjs"
  - id: refused
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; node scripts/cli.mjs query --dir \"$d\" --status nope >/dev/null 2>&1 && { echo 'a status outside the vocabulary was accepted'; exit 1; }; echo 'the typo is refused — OK'"
---

## Goal

`worktrail query --status <value>` fails when the value is not in the project's
`statuses:`, instead of answering "0 matching tasks".

## Context

Found on 2026-09-02 while working on
[TL-83](TL-83-wejscie-komend-piszacych-enumy-ze-slownikow-i-append.md), which
made the WRITING commands describe and enforce their vocabularies. The reading
side was left as it was:

```
$ worktrail query --status nope
# 0 matching tasks (check whether the filters exclude one another)
```

That line is not a lie, and that is exactly the problem: **zero results caused
by a typo are indistinguishable from "there is nothing like that"**, and they
read like an answer. `query.mjs` says so about FLAGS in its own comment — "an
unknown flag MUST fail... zero results caused by a typo read like an answer" —
and then does not apply the same reasoning to a flag's VALUE.

The same applies to `--priority`, `--type`, `--board`, `--role` and, when
`labels_closed` is set, `--label`. `next` filters by the same axes through
`task-select.mjs` and has the same gap.

**What makes this more than pedantry.** An agent that queries `--status
in-progress` (a hyphen, not an underscore) is told there is no work in progress
and stops. That is the failure mode this project builds guards against, arriving
through the one command an agent uses most.

**The decision to make**, and to record: `--status` deliberately lifts the
default "active only" restriction, so it is also the flag people use to search
the archive. A refusal must not make that harder. Consider whether the message
should list the vocabulary the way `handoff` and `take` already do — they are
the precedent, and their wording is worth copying rather than reinventing.

**Out of scope:** `--epic` and `--text`, which are substring searches over free
text and have no vocabulary to check against; and `--owner`, whose vocabulary is
observed in the tree rather than declared.

## Pre-flight reading

1. `scripts/query.mjs` — the flag parsing and the `f` object; the comment about
   unknown flags states the principle this task extends to values.
2. `scripts/task-select.mjs` — `filterTasks`, shared with `next`; whichever fix
   is chosen has to cover both callers or deliberately not.
3. `scripts/take-task.mjs` — the wording of an existing "unknown status"
   refusal, and the list of permitted values it prints.

## Steps

1. Validate the vocabulary-bearing filter values against `config.yaml` before
   the scan, and fail with exit 2 naming the permitted values.
2. Decide whether `next` gets the same treatment, and record the reason either
   way.
3. `--tasks <dir>` bypasses the configuration, so there is nothing to validate
   against — that path must keep working rather than refusing everything.
4. Test with a fixture vocabulary of its own, and a positive control: a value
   INSIDE the vocabulary still answers, including zero.

## Acceptance criteria

- [x] `query --status <not in the vocabulary>` exits non-zero and lists the permitted values. [proof: refused]
- [x] A value inside the vocabulary still answers, including with zero matches. [proof: suite]
- [x] `--tasks <dir>`, which has no configuration, is unaffected. [proof: suite]
- [x] The decision about `next` is recorded with its reason. [proof: suite]

## Decisions

**`next` gets the same treatment, and so does `run`.** The reason is not
symmetry, it is that the failure is WORSE there. `query` answers zero, which a
person reads and doubts. `next` answers exit 3 — "nothing to take" — and the
loop protocol in `instructions autonomous-loop` treats that as a legitimate
empty queue and ends the run. A typo in a dispatcher's filter therefore does not
produce a wrong answer, it produces a queue that looks finished. `run` builds
the same filters and hands them to the same selection, so leaving it out would
have made one of the three commands the odd one.

**The check lives in `task-select.mjs`, beside `filterTasks`.** That module
exists because `query` and `next` must not be able to disagree about which
tasks match; a vocabulary check written in each command would be the same
mistake one level up. The three commands print the refusal in their own voices,
which is where the difference between them belongs.

**`--executor` was added to the list the task drew up.** It was not named in the
context, and it is the same class: a closed enum, filtered on, silently
answering nothing. Its vocabulary is the TOOL's rather than a project's, and it
is read from `FIELD_SHAPES` through `buildFieldSpecs()` instead of being written
here a second time.

**`--owner` stays out, although `owners:` exists.** This tree carries seven
distinct owner values and the configuration declares one. Refusing the rest
would make the archive unsearchable by the field people most want to search it
by — the vocabulary is observed in the tree, not declared, which is exactly what
the task said. `--epic` and `--text` are substring searches with nothing to
check against, and `--blocked-by` takes an id.

**An empty value is a question, not a typo.** `--role ""` asks what is open to
anybody and `--executor ""` asks the same of species. Both are values a task can
carry, so they pass whatever the vocabulary says.

**An axis whose vocabulary the project never declared is not checked.**
`roles: []` means this project does not use roles, and there is nothing for a
value to be outside of. `next` keeps its own longer refusal for that case
(TL-97): a dispatcher filtering by a role nobody serves needs to be told the
vocabulary is missing, while a listing does not.

**One test in `next.test.mjs` asserted the old behaviour** — `--board
nonexistent` exiting 3 — and was rewritten rather than worked around. The
narrowing it was there to prove is now proved by a label no task carries, which
is a real question with an empty answer, because labels are an open vocabulary.
