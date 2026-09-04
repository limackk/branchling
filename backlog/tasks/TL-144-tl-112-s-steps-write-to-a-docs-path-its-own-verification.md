---
id: TL-144
title: "TL-112's steps write to a docs path its own verification does not check"
type: task
labels: []
board: main
epic: ""
priority: P3
status: in_progress  # pending | in_progress | blocked | done | cancelled
owner: agent:docs
role: docs
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs:
  - docs/license-and-contributions.md
verification:                      # HOW to check that the task is really done
  - id: no-stale-path
    bash: "! grep -q 'licencja-i-kontrybucje' backlog/tasks/TL-112-model-kontrybucji-i-granica-open-chmura-decyzja-z-terminem.md"
---

## Goal

TL-112's own text does not point a future reader at a filename that has never
existed under that name.

## Context

Found while doing TL-137 (translating `backlog/tasks/` to English). TL-112 is
`status: done`, and its `verification:` block correctly checks
`docs/license-and-contributions.md` — the real, English-named file that
exists and was the actual deliverable.

TL-112's own `## Steps` and `## Acceptance criteria`, however, still say:

> 5. Record the result in `docs/licencja-i-kontrybucje.md` — in Polish, since
>    ...
> - [ ] `docs/licencja-i-kontrybucje.md` exists and answers all four
>       questions: ...

`docs/licencja-i-kontrybucje.md` never existed — the work was actually done
under the English name from the start (consistent with CLAUDE.md's language
rule, which predates TL-112). This is a pre-existing inconsistency in the
task's own prose, unrelated to translation: nothing in `backlog/tasks/` was
mistranslated here — TL-137 left the (already-English) frontmatter and this
Polish path exactly as found, per its rule to never alter a file path.

**Why this is worth a task and not a drive-by fix.** The task is CLOSED and
its `## Log`/history already record how it was actually done; editing a
finished task's Steps/Acceptance criteria is a content correction to closed
history, which deserves its own small, reviewable diff rather than being
folded into an unrelated migration's commit.

## Steps

1. In TL-112, correct the two references from `docs/licencja-i-kontrybucje.md`
   to `docs/license-and-contributions.md`, matching what the `verification:`
   block actually checks and what was actually delivered.
2. Leave everything else in TL-112 untouched — this is a one-fact correction,
   not a re-review of the decision itself.

## Acceptance criteria

- [ ] TL-112 no longer names `docs/licencja-i-kontrybucje.md` anywhere. [proof: no-stale-path]
- [ ] TL-112's `status`, `## Log`, and decision content are unchanged.
