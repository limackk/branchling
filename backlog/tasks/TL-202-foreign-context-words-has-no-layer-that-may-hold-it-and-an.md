---
id: TL-202
title: "foreign_context_words has no layer that may hold it, and an agent found out the hard way"
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
  - id: has-a-home
    bash: "node --test scripts/tests/foreign-context-words-home.test.mjs"
---

## Goal

`foreign_context_words` must have exactly one place it can legitimately live,
and the tool must say where. Today it has none: the project layer documents
itself as deliberately empty, and the user layer REFUSES the key.

## Context

Measured on 2026-09-03, and it stopped every command on this machine.

At 14:10, during an unattended run, an agent created
`~/.config/branchling/config.yaml` containing:

    # Names that must never appear in a repository's public documents. Kept
    # here, outside every repository, because a list of names a tree may not
    # contain cannot be stored in that tree — writing it down is the disclosure.
    foreign_context_words: "…"

Every branchling command afterwards exited 2 with `cannot read the user
preferences`, including the run that was in flight, which ended at exit 1
having taken nothing. The file was moved aside by hand to make the tool usable
again.

**The agent's reasoning was right and the tool has no answer for it.** The
project layer says so itself, in `scripts/config.mjs:143`:

    // EMPTY here on purpose: a rejected-word list naming the company is the
    // company's name, published, in the repository the decision was made to
    // keep it out of.

So the values may not go in the repository. Law 3 says the user layer may not
hold a project's vocabulary, and `config.mjs:232` enforces it. The key is
therefore declared, validated, consumed by
`scripts/check-no-foreign-context.mjs:194` — and unfillable. The guard runs on
SHAPES alone and the VALUES half has never been reachable.

**Three ways out, and the choice is the task.** (a) The list is not a project
vocabulary but a fact about the machine's operator, and the user layer's rule
gets an explicit, documented exception. (b) A third location — a path NAMED in
the project config, pointing outside the tree, so the repository records where
the list is without recording what is in it. (c) The key is removed and the
guard is honestly shape-only, which is what it has always been in practice.

None is obviously right. (a) weakens a law to fit one key. (b) adds a layer,
and law 3 exists to stop exactly that. (c) deletes a capability nobody has
ever been able to use — the cheapest, and it must be argued against rather
than assumed wrong.

**The second defect is separate and must not be lost in the first.** An
unattended agent wrote to a machine-level configuration file OUTSIDE every
repository, and nothing stopped it or noticed. The blast radius of a run is
supposed to be a worktree; here it was the operator's home directory, and the
damage was to every future invocation rather than to the task at hand. With
`run --workers N` (TL-149) that radius is shared by every worker at once.
Whether the answer is a guard, a documented boundary in the agent template, or
nothing at all, it has to be DECIDED here rather than discovered again.

## Pre-flight reading

1. `scripts/config.mjs:140-150` — the key, its default, and the comment
   explaining why it is empty.
2. `scripts/config.mjs:225-235` — `KNOWN_KEYS` and the layer split that
   refuses it in the user file.
3. `scripts/check-no-foreign-context.mjs:194` — the only consumer.
4. `docs/branchling-global-tool.md` §3 — law 3, in full, before proposing any
   exception to it.
5. `CLAUDE.md` §Before you change the code — the disjoint-layers rule as this
   project states it.

## Steps

1. Decide between (a), (b) and (c), and write the reasoning and the rejected
   options into Decisions.
2. Implement it, including what the ERROR says when somebody puts the key in
   the wrong layer: today it names the rule and not the way out.
3. Decide separately what a run may write outside its worktree, and record
   that decision even if the answer is "nothing changes".
4. `scripts/tests/foreign-context-words-home.test.mjs` over a fixture: the key
   in its chosen home is read, and in any other layer it fails with a message
   naming the home.

## Decisions

Nothing decided. Note that whichever way (1) goes, the sentence in
`config.mjs` about the disclosure stays true and must survive the change.
