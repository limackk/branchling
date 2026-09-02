---
id: TL-11
title: "Pre-commit guard on the board field — a partition must not drift silently"
type: code
labels: [post-launch, ops-hardening]
board: main
epic: ""
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: []
related_docs:
  - backlog/boards.yaml
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/check-backlog-boards.mjs --all"
---

## Goal

Close a gap deliberately left open in TL-9: the `board:` field was guarded
only by a module test, not by a hook. A commit with a missing or misspelled
slug went through, unless someone happened to run the generator along the
way.

## Context

`build-backlog.mjs` has failed on an unknown slug since TL-9 — but the
generator only evaluates what it is asked about. A task with `board:
backlog_project` (an underscore instead of a hyphen) entered the repo without
objection and broke the views only when the next person happened to call the
build. This is the same shape the ID identity guard closed in BL-900..903:
a detector that nothing can fail against is a warning, not a safeguard.

**The scope here differs from the ID guard, and that is a decision, not an
oversight.** ID collision is a property of the SET — it cannot be evaluated
from a single file, so that guard reads the whole tree. Board is a property of
a SINGLE file, and two sessions work in parallel in this tree (during TL-9
there was an uncommitted task from another session sitting alongside; during
this session — BL-1381). A guard reading the whole tree would fail MY commit
because of SOMEONE ELSE's work in progress, which would teach people to use
`--no-verify`. That is why the hook gives the guard the staged files.

**One exception:** when the commit contains `boards.yaml` itself, the whole
tree is checked. Removing or renaming a board would orphan every task
pointing at that slug — and none of them is in the commit. Checking only the
staged files would therefore let through exactly the change that breaks the
most files.

The guard also validates the registry itself (a duplicate slug, `default`
pointing at a non-existent board) — a broken registry crashes the generator,
and it is a single file, so the check is free.

## Acceptance criteria

- [x] `backlog/scripts/check-backlog-boards.mjs` — missing field, unknown
      slug, broken registry → exit 1 with the filename.
- [x] Wired into `.githooks/pre-commit` + declared in `GUARD_MANIFEST` (a
      missing script fails loudly, not a silent skip).
- [x] Staged-only, with an exception for a commit touching `boards.yaml` →
      `--all`.
- [x] Positive control: a real attempt to commit a task without `board:` was
      blocked with the right message.
- [x] Tests: 17/17 green (8 new guard cases).

## Verification

```bash
node --test backlog/scripts/tests/boards.test.mjs
node backlog/scripts/check-backlog-boards.mjs --all       # ✓ real tree
```

Positive control (performed 2026-08-29, not only described): task `BL-9999`
without `board:` → `git commit` rejected with the message "task without a
valid `board:`". The probe file was removed.

## Notes

The guard's tests also assert that the output contains no `MODULE_NOT_FOUND`
— because a missing script exits with code 1 the same way a detected
violation does. Without this, the "duplicate slug" case was green BEFORE the
guard even existed (observed in this session).

Not wired into `pre-merge-commit`: that hook is deliberately narrow and
guards an invariant that arises ONLY when branches meet (ID collision). Board
is a property of a file and was checked at the commit that introduced it —
a merge creates no new violations of this kind.

## Log

- 2026-08-29 done — claude — staged-only guard + `--all` on registry
  changes; positive control on a real commit
