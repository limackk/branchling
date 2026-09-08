---
id: TL-269
title: "The friction an agent reports dies in its log unless a person mines it"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: cancelled                  # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-08
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: friction-harvested
    bash: "node --test scripts/tests/run-friction.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

What an agent reports about the tool getting in its way reaches the
backlog without a person reading every agent log. `run` collects a marked
section from each agent's output into one file per run, and can print it,
so the loop that improves the harness is a command and not a habit.

## Context

Every hand run in this repository on 2026-09-04 was told to end its reply
with a FRICTION LOG: every place the tool got in the way, with the command
and its output. Fifteen such logs were written across waves 8 and 9. They
were the source of TL-247, TL-248, TL-254, TL-255, TL-259, TL-261, TL-262
and TL-263 — eight tasks, several of them P1 — and of three corrections to
the charters themselves during the runs.

Every one of those was extracted by a person, with:

    awk '/FRICTION LOG/{f=1} f' <log>

read in full, and re-typed as a task. The mechanism that turns agent
experience into backlog items is that person remembering to do it. When
they do not, the log stays in a temporary directory and the finding dies
with the session — the failure CLAUDE.md names for topics left in prose.

**Two hands reported the same defect independently** (TL-261, `check
--task-state` showing the session's own work and an abandoned closing in
one shape). That coincidence was visible only because one person read both
logs the same evening. A tool that collected the sections would have shown
the two side by side.

**Why the tool and not the charter.** The charter can ask for the section;
only the loop sees every agent's output and knows which task each belongs
to. `run` already writes one log per task outside the repository. The
harvest is a second file beside them: the marked section, the task id, the
role, the attempt number.

**What it is not.** Not a parser of prose and not a task generator. The
section is text; the tool keeps it, attributes it, and prints it on
request. Turning a friction entry into a task stays a person's decision —
`new` exists for that, and a `--from-friction <run> <n>` that pre-fills
the title and context is the most the tool should offer.

**Weak models benefit most.** A weaker model is worse at deciding what is
worth reporting and better at answering a fixed question. "End with a
FRICTION LOG, one entry per command that surprised you, with the command
and its output" is a fixed question. The value is in aggregating the
answers, which the model cannot do and the loop can.

## Steps

1. Decide the marker. A heading the charter names (`## FRICTION LOG`) is
   the obvious choice; the tool should look for it, not require it, since
   an agent that writes none has nothing to report. Record with
   `branchling decide`.
2. `run` writes `<log-dir>/friction.jsonl`, one record per attempt that
   carried the section: task, role, attempt, the section verbatim.
3. `run --friction` (or `run report --friction <log-dir>`) prints them,
   grouped by task, so two hands reporting one defect land beside each
   other.
4. Say in `run --help` that the section is harvested, so a charter author
   knows the heading to ask for.

## Acceptance criteria

- [ ] An agent whose output carries the marked section has it written to
      the run's friction file with task, role and attempt, proven by a test
      whose fake agent prints one. [proof: friction-harvested]
- [ ] An agent that prints no such section adds nothing and fails nothing.
      [proof: friction-harvested]
- [ ] The per-task agent logs are unchanged. [proof: suite-green]
