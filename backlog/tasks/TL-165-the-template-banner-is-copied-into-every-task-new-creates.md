---
id: TL-165
title: "The template banner is copied into every task new creates"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
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

- [x] A task created by `new` from a template with a banner does not contain the banner. [proof: banner]
- [x] A comment beside a FIELD survives into the created task. [proof: banner]
- [x] `templateDrift()` still refuses a template whose values are outside the vocabulary. [proof: banner]
- [x] The full suite is green. [proof: banner]

## Decisions

**Candidate 1 — strip the comment block above the first field — and not the
sentinel.** The positional rule is not a heuristic that happens to fit: a
comment standing before the FIRST field has no field to annotate. There is
nothing above it but the opening `---`, so whatever it is about, it is not about
a value in this file. That is exactly the banner's position in both templates,
and it is the only position with that property. A `# note` beside a field is
about that field and survives untouched — which is the half of the test that
matters, because a fix reading "strip every comment" passes the other half and
destroys everything the template teaches.

**The cost, stated rather than discovered later.** A comment somebody
deliberately writes above `id:`, meaning it to annotate `id:`, is deleted with
the banner. The sentinel would have covered that case and would have cost every
template author, forever, one more thing to know — to fix a case nobody has yet
written. A comment meant to reach a task goes BELOW the first field, where it
annotates something.

**Blank lines in the leading block go with it.** A task beginning with the blank
lines the banner was separated by would be a different kind of wrong, not a
smaller one.

**Two degenerate inputs are left ALONE rather than made tidy**: a file with no
frontmatter, and a frontmatter that is nothing but comments. Emptying the second
would turn a broken template into a silently different broken template.

**The strip runs BEFORE the field rewrites, not after.** Every `^key:` pattern in
`createTask()` is anchored per line, so a comment line beginning with one of
those words would otherwise be a rewrite target.

**`templateDrift()` is untouched**, and there is a test saying so. It reads the
file on disk, banner and all; the strip happens on the copy being written.
