---
id: TL-202
title: "A run that writes outside its worktree breaks every other tree at once"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: the-boundary-is-stated
    bash: "node scripts/cli.mjs instructions autonomous-loop | grep -qi 'outside' && echo 'the guide states what a run may write outside its tree — OK'"
---

## Goal

It is decided, and written where an agent will read it, what an unattended run
may write outside the worktree it was given. Today nothing says, and the first
time it happened every branchling command on the machine stopped working.

## Context

Measured on 2026-09-03. The first half of this task's original premise was
answered by TL-196 while this one was being written, and what is left is the
half that still has no answer.

WHAT HAPPENED. At 14:10 a session working on TL-196 in another worktree moved
`foreign_context_words` from the project layer to the user layer — the right
call, argued in that task: a rejected-word list naming the company IS the
company's name, published in the repository the decision was made to keep it
out of. As part of that it created
`~/.config/branchling/config.yaml` and put the real words in it.

That file is machine-level. Every other tree on this machine was still running
code in which `foreign_context_words` is a PROJECT key, so from that moment
every command in those trees exited 2 with `cannot read the user preferences`
— including a `run` that was in flight, which ended at exit 1 having taken
nothing. The failure looked like a defect in the run and was not.

WHY THIS IS NOT TL-196'S MISTAKE. The decision was correct and the file had to
be written for the feature to work. The problem is that a write outside the
worktree is INSTANT for every other tree, while a write inside it travels with
a branch and arrives only when somebody merges — which is the whole point of
law 1. One session moved a boundary and, for as long as it took to merge, the
other trees were running the old code against the new world. Nothing warned
anybody, in either direction.

WHY IT MATTERS MORE SOON. `run --workers N` (TL-149) puts several sessions on
one machine at once, all sharing this one directory. Today the window was
minutes and one operator noticed. With a fleet the window is every worker's
next command.

WHAT THIS TASK IS NOT. It is not a ban: the user layer exists precisely so
that facts about the person live outside every repository, and a run must be
able to write the lock file, the activity log and this configuration. It is
also not a rollback of TL-196.

WHAT IT HAS TO PRODUCE. A decision, stated in
`branchling instructions autonomous-loop` where an unattended agent will read
it, covering: which paths outside the worktree a session may write (the state
directory and the user configuration are the candidates), and what it owes the
other trees when it does — at minimum saying so in the report, so the operator
of a tree that breaks can tell a shared-state change from a defect in their
own work.

Whether anything is ENFORCED is part of the decision and may honestly be "no".
A guard here is cheap to write and easy to make wrong, and the loop is
composition: it does not own the agent's filesystem access and never will.

## Pre-flight reading

1. `scripts/home.mjs` — the user layer as TL-34 defined it, and the disjoint
   boundary in its header.
2. `backlog/tasks/TL-196-*.md` and commit `639e644` — the decision that moved
   the word list, and why it was right.
3. `branchling instructions autonomous-loop` — the guide this decision has to
   land in, and in particular its existing paragraph on what the claim
   guarantees and where it stops: this is the same shape of argument, about
   state rather than about claims.
4. `scripts/lock.mjs` — the precedent. Session state already lives outside the
   repository on purpose (TL-87), and the reasoning there is the model for
   this one.

## Steps

1. Write down which paths outside the worktree a session may write, with the
   reason for each.
2. Decide what a run reports when it writes one, and implement that much.
3. Put the decision in `instructions autonomous-loop`, not only in a task.
4. Record in Decisions whether anything is enforced, including a deliberate
   "nothing is".

## Decisions

The first half of the original task — that `foreign_context_words` had no
layer that could hold it — was settled by TL-196 on the same day: it is a user
key now, `scripts/home.mjs:169`, and the file that broke this machine is valid
under that code. This task was rewritten rather than closed, because the
breakage it recorded had a second cause that nobody has decided about. The
title changed with it; the filename did not, following TL-137's rule that a
task's filename is data, not part of its content.
