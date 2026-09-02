---
id: TL-45
title: "Gate on dead links and related_docs in the tool's documents"
type: code
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs: []
verification:
  - bash: "node scripts/cli.mjs check --docs"
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

The consumer (`origin`) has its own `check-docs-links`, and that is
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

- [ ] Dead links and dead `related_docs` are reported with file and target,
      exit ≠ 0.
- [ ] A `<repo>#<path>` reference is skipped deliberately, not by accident.
- [ ] Anchors (`#section`) do not break path validation.
- [ ] Positive control in the test, not just described.

## Notes

- Related to TL-37 (document split), but NOT the same thing: that one is
  about content and the origin project's context, this one is about whether a path leads
  to a file at all.

## Log

- 2026-08-31 created — claude — split out after measuring 61/101 dead links
  while answering "do we have full separation"; links fixed immediately, the
  gate remained as debt
