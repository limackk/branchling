---
id: TL-143
title: "TL-121's premise is stale: backlog/_template.md is now English"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: template-still-english
    bash: "! grep -qE '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]' backlog/_template.md"   # language-guard: allow — its own alphabet
---

## Goal

TL-121 (`status: pending`) is re-scoped, or explicitly closed as moot, so a
future reader is not sent to translate a file that is already translated.

## Context

Found while doing TL-137 (translating `backlog/tasks/` and `docs/` to
English). TL-121's `## Context` and `## Steps` are built entirely on the
premise that `backlog/_template.md` is in Polish and must STAY in Polish:

> **What must NOT be done.** Do not translate `backlog/_template.md` into
> English — CLAUDE.md states outright that `backlog/` is in Polish and that
> the guard does not read it.

and its acceptance criteria include:

> - [ ] The prose in `backlog/_template.md` stays in Polish.

Both are now false. CLAUDE.md's language rule was broadened on 2026-09-01 —
before TL-121 was even created, but TL-121 was written against the OLDER
state it happened to still observe — and `backlog/_template.md` itself was
translated to English as part of that same 2026-09-01 pass (confirmed by
reading the file directly: it now has `## Goal`/`## Context`/`## Steps`
headings, not `## Cel`/`## Kontekst`/`## Kroki`).

**What is still true and still unfixed in TL-121** — this task does NOT
re-litigate these, only the language premise:

- `backlog/_template.md` is missing `confidence:`, the `verification:` entry
  has no `id:`, there is no `## Pre-flight reading` section, and its `id:
  BL-NNN` placeholder still carries the prefix from before the TL-111
  migration instead of `TL-NNN`. All four are confirmed still present by a
  direct read of the file on 2026-09-02.
- TL-121's actual technical goal — bringing `backlog/_template.md`'s SHAPE
  into parity with the shipping `_template.md`, with a test that derives the
  field list from the shipping file — is unaffected by the language change
  and still needs doing.

**Not done here, deliberately.** TL-137 translates file CONTENT; it does not
re-open TL-121's own decision-making, which is a separate task with its own
scope. Fixing the stale premise is this task's whole job — not a fix folded
into TL-137's own commit.

## Steps

1. Read TL-121 in full and update its `## Context`, `## Steps`, and
   `## Acceptance criteria` so none of them assert or require that
   `backlog/_template.md` stays in Polish — its own quoted heading names
   (`## Cel`, `## Kontekst`, `## Kroki`) are now historical, not current.
2. Keep TL-121's still-valid technical content (the shape-parity test, the
   `id: BL-NNN` fix, the missing fields) intact — this is an edit, not a
   rewrite from scratch.
3. Re-run `node scripts/cli.mjs check --language` to confirm the repaired
   TL-121 itself reads as English (it will, once the stale Polish quote is
   updated or replaced with an English gloss).

## Acceptance criteria

- [ ] TL-121 no longer asserts that `backlog/_template.md` is or must stay in
      Polish.
- [ ] TL-121's still-open technical goal (shape parity between the two
      templates) is preserved, not dropped. [proof: template-still-english]
- [ ] `backlog/_template.md` itself is untouched by this task — it was
      already translated; this task only corrects TL-121's description of it.
