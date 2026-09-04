---
id: TL-143
title: "TL-121's premise is stale: backlog/_template.md is now English"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P3
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:docs
role: docs
estimate: 30m                      # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-04
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: tl-121-premise-corrected
    bash: "! grep -nE '(is|are|stays|stay) in Polish' backlog/tasks/TL-121-*.md"
  - id: shape-parity-preserved
    bash: "node --test scripts/tests/template-shape.test.mjs"
---

## Goal

No sentence in TL-121 claims that `backlog/_template.md` is, or must stay, in
Polish, so a future reader is not sent to preserve a file that is already
English.

## Context

Found while doing TL-137 (translating `backlog/tasks/` and `docs/` to
English). TL-121 was written on the premise that `backlog/_template.md` was in
Polish and had to STAY that way — it said outright that translating the file
was what must NOT be done, and one of its acceptance criteria required the
prose to remain Polish.

The premise had already expired when it was written: CLAUDE.md's language rule
was broadened on 2026-09-01, and `backlog/_template.md` was translated in that
same pass. TL-121 happened to observe the older state and was written against
it.

**What TL-121's own execution had already repaired.** TL-121 has since been
executed and closed (`status: done`). Whoever ran it removed the "do not
translate" paragraph, restated the language acceptance criterion as what is
actually checked — that `check --language` stays green — and added a paragraph
to `## Context` recording that the premise had expired. Its four technical
defects (missing `confidence:`, a `verification:` entry with no `id:`, no
`## Pre-flight reading`, an `id: BL-NNN` placeholder from before the TL-111
migration) are all fixed, and `scripts/tests/template-shape.test.mjs` guards
the parity.

**What was left for this task.** Three sentences elsewhere in TL-121 still
asserted the dead premise in the present tense, contradicting the paragraph
that admits it expired: the `## Goal` said the two templates "differ ONLY in
the language of the prose", `## Context` said `backlog/_template.md` "is in
Polish", and it named `## Cel`, `## Kontekst` and `## Kroki` as the file's
current headings. Even the expiry paragraph was written in the present tense
("`backlog/` is in Polish", "`check --language` does not read it"), which
reads as a live claim rather than a superseded one.

**The contract this task arrived with proved nothing.** Its single
`verification:` entry grepped `backlog/_template.md` for Polish letters — a
file this task is forbidden to touch, and one that had been English since
2026-09-01. It was green before any work started and would have stayed green
had nothing been done at all. It is replaced by a guard over the text this
task actually changes.

**Not done here, deliberately.** TL-121 is closed, so this task corrects
stale FACTS in it and nothing else: its status, its decisions, its acceptance
of what was delivered and its history log are history. The `worktrail` name
in its acceptance criteria is the tool's former name and is stale too, but it
belongs to TL-259, which covers that rename across the whole backlog.

## Steps

1. Correct the three present-tense assertions in TL-121's `## Goal` and
   `## Context` so none of them claims `backlog/_template.md` is or must stay
   in Polish. Keep the Polish heading names as a historical parenthesis —
   they record what the file looked like when the task was written.
2. Put the expiry paragraph into the past tense, keeping its closing sentence
   — the restated criterion — verbatim: that is a decision, not a fact.
3. Touch nothing else in TL-121. It is closed: its `## Acceptance criteria`,
   its `## Steps` and `backlog/history/TL-121.jsonl` stay as delivered.
4. Re-run `node scripts/cli.mjs check` and the suite.

## Acceptance criteria

- [x] No sentence in TL-121 asserts that anything is, are or stays in Polish;
      historical statements in the past tense are what remains.
      [proof: tl-121-premise-corrected]
- [x] TL-121's technical result — shape parity between the two templates — is
      untouched by this edit. [proof: shape-parity-preserved]
- [ ] `backlog/_template.md` itself is untouched by this task: it was already
      translated, and this task only corrects TL-121's description of it.
