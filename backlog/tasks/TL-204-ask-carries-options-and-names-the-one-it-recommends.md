---
id: TL-204
title: "ask carries options, and names the one it recommends"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P0
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-205, TL-207]                 # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: options
    bash: "node --test scripts/tests/ask-options.test.mjs"
---

## Goal

`branchling ask` takes the options the asker considered and names the one it
recommends, and `branchling decide` can answer by picking one. A question that
arrives as free text alone makes the person do the analysis the session had
already done and then threw away.

## Context

Asked for on 2026-09-03, after reading the panel on a real backlog. Today
`ask <ID> --question "…"` is the whole surface: one string, recorded as a
`__comment__` nothing answers. Two of the open questions in this repository
read like this one, verbatim:

    a week of work: worktree lifecycle, fast-forward merge, parking a conflict
    and a multi-worker report are four separate designs, and the task's own
    text forbids splitting the merge rule from the dispatcher — it needs its
    own session, not the tail of one

That is a good question and a bad prompt. The session knew what the candidate
answers were — split the task, take it whole in a fresh session, or defer it —
and the reader has to reconstruct them from prose.

**The recommendation is the point, not a convenience.** An agent that asks
without recommending has moved the work rather than done it. Two properties
make a recommendation worth reading and both must be stated in the option
itself:

  - **solid** — the option that survives the most cases, not the quickest one;
  - **composes** — it fits the architecture already here: the four laws, the
    vocabularies in `config.yaml`, the commands that exist. An option that
    requires a new layer, a second source of truth or a plugin API is worse
    than a slower one that does not, and the option text has to say which
    existing pieces it is built from.

**Shape.** `--option "…"` repeatable, `--recommend <n>` naming one of them, and
the option text carrying its own one-line reason. `--question` stays REQUIRED
and stays first: options without the question they answer are a menu with no
subject. Asking with no options stays legal — some questions genuinely have no
enumerable answers — but the event records that none were offered, so a review
can see how often it happens.

**`decide --choose <n>`** answers by number, and records the chosen option's
text as the reason so the log reads the same whether the answer was picked or
typed. `--reason` stays available and stays required when nothing is chosen.

**Where this must NOT go.** Not into the task file. An open question is an
EVENT, and TL-114 settled that deliberately — "nothing is stored in the file:
an open question is a comment no decision answers". Options are part of the
question, so they belong in the same event, and the panel keeps computing from
the log with no second file to keep in step (law 2).

## Pre-flight reading

1. `scripts/ask-task.mjs` and `scripts/decide-task.mjs` — the two commands and
   the event they write.
2. `scripts/task-fields.mjs` — `openQuestions`, `FIELD_COMMENT` and
   `FIELD_DECISION`: the event shape this extends.
3. `backlog/tasks/TL-114-*.md` — why a question is an event and not a field.
4. `branchling instructions task-execution` — where an agent is told what to do
   when a decision is not its to make; the instruction has to change with the
   flag or nothing will use it.

## Steps

1. `--option` (repeatable) and `--recommend <n>` on `ask`, carried in the
   event; refuse `--recommend` without options, and a number out of range.
2. `--choose <n>` on `decide`, recording the option text as the reason.
3. `--json` on both prints the options and which was recommended.
4. Update `instructions task-execution` so an asking session is told to offer
   options and to say why the recommended one is the most solid and how it
   composes with what exists.
5. `scripts/tests/ask-options.test.mjs` over a fixture.

## Decisions

**A question with no options does not warn, and the event records the
absence.** It was the one thing left open above, and warning is the worst of
the three answers: it cannot be acted on by the session that gets it — some
questions genuinely have no menu — so it would train readers to ignore a line
that is sometimes real. `ask` writes `options: []` instead, which is a fact a
review can COUNT. That makes three states rather than two, and each is a
different thing: no `options` key is an event written before this existed, `[]`
is a session that offered none, and a list is a menu.

**`--recommend` is REQUIRED once `--option` is given.** Not in the steps, and
it follows from the goal: an agent that offers a menu and declines to point at
a row has moved the work rather than done it, which is the defect this task
exists to close. It costs nothing where there is no menu, and where there is
one it is the whole point. Options with no recommendation are refused before
anything is written.

**`--choose <n>` requires `--resolves`, and excludes `--reason`.** A bare
number indexes a menu, and which menu is not something the tool may guess: one
task can carry two open questions, and picking "option 2" of the wrong one
records a real answer to a question nobody asked. Deriving it from "the only
open question" was rejected for that reason — `ask`'s `blockingStatus` refuses
to choose between candidates too. `--reason` beside `--choose` is two answers
for one field; an answer not on the menu is a plain `--reason`, and a remark
about a chosen option is a second `decide`, which reads better as one.

**What is recorded is the option's TEXT, in the same `to` a typed answer
fills** — `chose: <n>` is written beside it, never instead of it. A log where
the answer is a number would have to be joined against another event before
anybody could read what was decided, and the history's whole value is that it
reads on its own. The number is kept only so a later review can ask how often
the recommendation was followed.

**Options are numbered from 1**, in the order the flags were given, at every
end: what `ask` prints, what the event stores, what `--choose` takes. A 0-based
index on disk would need translating twice, and one of the two translations is
where the off-by-one lives.

**Not done here:** the viewer and the decision panel still show a waiting
question without its menu — TL-207.
