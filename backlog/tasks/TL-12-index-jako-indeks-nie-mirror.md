---
id: TL-12
title: "INDEX.yaml as an index, not a copy of the frontmatter — 149 KB → 70 KB"
type: task
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
related_docs: []
verification:
  - bash: "node --test backlog/scripts/tests/boards.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs && wc -c backlog/INDEX.yaml"
---

## Goal

`INDEX.yaml` duplicated the whole frontmatter — 337 tasks × ~15 lines = 149
KB, i.e. ~37k tokens on every read. The index should let you **select** a
task, not describe it; the description lives in the task file, which is the
SSOT.

## Context

Measured before the change: `FOCUS.yaml` 14 KB (~3.5k tok), `INDEX.yaml` 149
KB (~37k tok). The conversation started from the question of whether to
remove the `focus` field "to save tokens" — the measurement showed that all
of focus is 3.5k, and ten times that sits in the index, which copies data
already present in the tasks.

What was dropped from the row and why exactly this:

- `type`, `owner`, `estimate`, `confidence`, `created`, `updated` — a description of the task, not a criterion for choosing work;
- `file` — the filename is `tasks/<id>-*.md`, and a glob on the ID alone is unambiguous, because the identity guard (BL-900..903) enforces it;
- `epic` — it stands in the group heading, in the row it was being paid for 337 times;
- `board` in **per-board** views — for the same reason as epic (the file header already states it);
- `blocks` — the inverse of `blocked_by`, derivable from the other rows of the same file.

What is left is what work is actually chosen by: `id`, `priority`, `status`,
`board`, `labels`, `blocked_by`, `title` (+ `focus`, as long as the field
exists).

The row is a YAML flow mapping, not text — the index should stay
machine-readable. This forced separate quoting: inside `{...}` a value ends
not only at the end of the line but also at `,` and `}`, so a title like
"Split IG production into posts and stories, because…" without quotes would
fall apart into two fields (`yFlowStr`, alongside the existing `yStr` for the
block form).

Nobody parses `INDEX.yaml` programmatically besides the generator — checked
with grep across the repo before the change (the viewer and the guards read
`tasks/*.md`), so the format change had no consumer to break. The consumer
is a human and an agent.

## Acceptance criteria

- [x] One line per task, valid YAML (verified with a real parser: 337 + 337 + 55 + 1006 entries across four views).
- [x] `INDEX.yaml` < 75 KB — it is 69.6 KB (~17k tok, was ~37k).
- [x] Per-board views without a `board` column.
- [x] README: §2, §3.3, §5.1 and the quick reference match the new shape.
- [x] Tests: 28/28 green (4 new cases for the INDEX contract).

## Verification

```bash
node backlog/scripts/build-backlog.mjs
wc -c backlog/INDEX.yaml            # < 75 000
node --test backlog/scripts/tests/boards.test.mjs
```

## Notes

The 75 KB threshold in the test is a ratchet: when the backlog grows, it
should fail so that someone **deliberately** decides what comes next
(pagination? a per-board index as the default read?), not so that the index
silently reverts to being a copy.

Two protocols in the README pointed to fields that no longer exist — fixed
in the same commit: §5.1 step 3 said "check `blocks:` in the INDEX" (now:
`grep 'blocked_by:.*BL-NNN'`), and the quick reference showed `yq` with the
`owner` field.

Observed along the way, NOT fixed (data, not format): a few tasks have a
literal `\"` in the title instead of a closing quote (e.g. BL-1157,
BL-1055). The old index carried exactly the same thing — this is a defect
in the source, not a regression.

Next step in the same conversation: a computed `NOW.yaml` instead of the
`focus` field (a separate task, once the founder decides).

## Log

- 2026-08-29 done — claude — single-line row, size threshold in the test, README synchronized
- 2026-08-29 renumbered — claude — collision of BL-1384 with the dashboard task (9 references in mobile code vs 1 here); number 1385 from `next-backlog-id.mjs`, the "fewer references" criterion from backlog/README.md §3.4
