---
id: TL-45
title: "Gate on dead links and related_docs in the tool's documents"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: guard-behaviour
    bash: "node --test scripts/tests/docs-links.test.mjs"
  - id: this-tree
    bash: "node scripts/cli.mjs check --docs"
  - id: in-the-default-run
    bash: "node scripts/cli.mjs check --help | grep -q -- '--docs' && echo 'the selector is documented — OK'"
---

## Goal

A link in a document, or a `related_docs` entry, pointing to a file that does
not exist, **fails**. Today nothing guards this, and this is the navigation
an agent moves through — a dead link produces no error, just a silent dead
end.

## Context

Measured 2026-08-31, after the tool was moved to its own repository:
**61 of 101 `.md` links were dead** (60%), plus **27 `related_docs`
entries** pointing at a directory layout that does not exist in this
repository (`docs/architecture/…`, `qa/…` — the shape of the project this
module came out of).

Fixed by hand in the same session, but **a fix without a gate rots the same
way**: every documentation-file move reproduces this state, and nobody finds
out.

**The class is broader than links.** A path in `related_docs` is the one
place a task says "read this before you start". When it points into a void,
the agent doesn't get an error — it gets less context, and doesn't know it.

The consumer (`<origin>`) has its own `check-docs-links`, and that is
exactly the class it catches there; the tool came out from under that gate
and didn't bring it along.

## Steps

1. `check --docs`: markdown links in `README.md`, `CLAUDE.md`, `docs/**`,
   `backlog/tasks/**` + all `related_docs` entries from frontmatter.
2. Decide the form of a reference to ANOTHER repository. Today it's written
   as `origin#docs/architecture/…` — the gate must **recognize and
   skip it**, not try to resolve it as a local path.
3. Decide whether `check --docs` becomes part of the argument-less `check`.
4. Positive control: a repository with one dead link fails, and passes after
   the fix. Without this step the gate may have no evidentiary force.

## Acceptance criteria

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] Dead links and dead `related_docs` are reported with the file, the line and the target, and exit non-zero. [proof: guard-behaviour]
- [x] A `<repo>#<path>` reference is skipped by a RULE that names itself, not by a resolution that happened to fail. [proof: guard-behaviour]
- [x] An anchor does not break path validation, and an anchored path is not mistaken for a cross-repository reference. [proof: guard-behaviour]
- [x] Positive control in the test: one dead link fails, and the same tree passes once the file exists. [proof: guard-behaviour]
- [x] The guard runs in a bare `check`, and `--docs` selects it alone. [proof: guard-behaviour, in-the-default-run]
- [x] This repository passes its own guard. [proof: this-tree, guard-behaviour]

## Decision (2026-09-02)

**Yes to step 3: it joins the argument-less `check`.** A guard wired to nothing
passes every test of its own, and this repository already has a test with that
name. The cost was paid here rather than deferred — see below.

**It judges the REPOSITORY holding the backlog, not this installation**, which
is the opposite of `--language` and `--product-name`. Those two are about the
tool's own code and rightly read the installation. A `related_docs` entry
resolves against the CONSUMER's tree, and a task's link to `../../docs/x.md`
means their document — so any other scope would be answering a different
question. The set is deliberately narrow: top-level `*.md`, everything under
`docs/`, and the task files. Not the whole tree, because a repository's source
directories are full of markdown belonging to somebody else's tooling, and
`node_modules` is excluded by name.

**A defect the guard found in ITSELF, and the reason the skip rules have as many
tests as the finding does.** The first draft reported 179 dead targets, of which
135 were not dead: it resolved `related_docs` relative to the FILE, while
`_template.md` says on the line beside the field that those paths are relative
to the repository ROOT. A link guard fails in two directions and only one is
visible — a missed dead link costs a reader context they never learn they are
missing, while a FALSE finding costs the guard its credibility, and a guard
people have learned to ignore is worse than none. Every skip rule is therefore
asserted by the REASON it fired, not by the absence of a finding, because a
guard that silently failed to resolve something looks identical from outside.

**44 real dead links were fixed to make the gate green, in two classes.**
Sixteen were task-to-task links carrying the product's NEW name in a filename
that was never renamed: the tool became `worktrail` on 2026-09-01 and TL-137
deliberately renames no files, so `TL-22-worktrail-dispatcher-komend.md` is a
link to a file that is really `TL-22-tasklog-dispatcher-komend.md`. Each was
repointed at the file that exists, by task id. Twenty-two were `related_docs:
backlog/README.md` — a document that never existed in this repository; it
belonged to the workspace this tool was extracted from. Those entries were
REMOVED rather than repointed: inventing a successor reference would be a claim
about each task's context that nobody can check, and a dead pointer removed is
strictly better than a wrong one added. Prose mentions of that file in the body
of old tasks stay, because they are historical sentences, not navigation.

**A link inside a code fence is checked, deliberately.** It is still a link a
reader will follow, and the 61/101 originally measured included examples in
fences.

## Verification

```bash
# 1. The guard's rules and its end-to-end behaviour — expected: pass
node --test scripts/tests/docs-links.test.mjs

# 2. This tree passes — expected: every target leads to a file
node scripts/cli.mjs check --docs

# 3. The selector is documented — expected: OK message
node scripts/cli.mjs check --help | grep -q -- '--docs' && echo 'the selector is documented — OK'
```

## Notes

- Related to TL-37 (document split), but NOT the same thing: that one is
  about content and the origin project's context, this one is about whether a path leads
  to a file at all.

## Log

- 2026-08-31 created — claude — split out after measuring 61/101 dead links
  while answering "do we have full separation"; links fixed immediately, the
  gate remained as debt
