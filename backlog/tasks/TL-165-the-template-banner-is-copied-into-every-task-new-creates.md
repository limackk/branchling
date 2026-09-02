---
id: TL-165
title: "The template banner is copied into every task new creates"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-02
updated: 2026-09-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: banner
    bash: "node --test scripts/tests/new-task.test.mjs scripts/tests/template-shape.test.mjs"
---

## Goal

A task file created by `worktrail new` does not begin with the template's own
banner. The comment block that explains what a TEMPLATE is belongs to the
template and to nothing else; a task carrying it says "TASK TEMPLATE. `worktrail
new` copies this file" about a file nobody will ever copy.

## Context

Found while doing TL-121, which brought `backlog/_template.md` back into shape
parity with the shipping `_template.md` — the banner was one of the fields that
parity restored, and adding it made the leak visible here too.

Reproduce, in any empty directory:

```
worktrail init --dir g --no-example
worktrail new --dir g --title "Banner probe"
head -8 g/tasks/*.md
```

The first eight lines of the new task are the template's banner. This has been
true in every consumer repository since `init` first shipped a template with a
comment block; it is not a regression from TL-121, which only made this
repository share the behaviour.

This very file carried the banner when `new` wrote it; it was taken off by hand
so the tree does not gain a task that lies about what it is. The repro above is
the evidence, not this file.

`createTask()` in `scripts/new-task.mjs` copies the template verbatim and
rewrites individual `^key:` lines. Nothing removes leading comment lines,
because until now nothing had a reason to distinguish a comment that TEACHES
from a comment that ANNOTATES. Both kinds are in the file:

- the boxed banner at the top — about the template as a file, meaningless in a
  task;
- the `# …` notes beside individual fields — about the FIELD, and genuinely
  useful in a task, which is why `stripComment()` exists throughout the parsers
  and why they must survive.

So the decision this task has to make is where the line runs, and it is a
decision rather than a lookup. Two candidates:

1. **Strip comment-only lines that stand BEFORE the first field.** Simple,
   needs no marker, and matches how both templates are actually written today.
   It silently deletes a comment somebody deliberately put above `id:` for
   another reason.
2. **A sentinel** — a marker line the template carries and `createTask` removes
   along with the block it opens. Explicit, and it costs every template author
   one more thing to know.

Whichever is chosen, `templateDrift()` must keep working: it reads the template
BEFORE the write, and it parses the same file.

## Pre-flight reading

1. `scripts/new-task.mjs` — `createTask()`, the copy-and-rewrite path; the
   `templateDrift()` call that runs before the write.
2. `_template.md` and `backlog/_template.md` — both banners, and the per-field
   comments that must survive.
3. `scripts/tests/template-shape.test.mjs` — the TL-121 guard on the shape of
   both templates; a new rule about the banner belongs beside it.
4. `scripts/task-fields.mjs` — `stripComment()`, and why a trailing `# note`
   beside a value is part of this format.

## Steps

1. Settle the rule and write the reason into the code, not only into this task.
2. Implement it in `createTask()`.
3. A test: a task created from a template with a banner does not carry it, and
   a per-field `# note` DOES survive. The second half is the positive control —
   without it the fix could be "strip every comment", which passes the first
   half and destroys the annotations.
4. Check that `worktrail check --vocabulary` and `templateDrift()` still read
   both templates.

## Acceptance criteria

- [ ] A task created by `new` from a template with a banner does not contain the banner. [proof: banner]
- [ ] A comment beside a FIELD survives into the created task. [proof: banner]
- [ ] `templateDrift()` still refuses a template whose values are outside the vocabulary. [proof: banner]
- [ ] The full suite is green. [proof: banner]
