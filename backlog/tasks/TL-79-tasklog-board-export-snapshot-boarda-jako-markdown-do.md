---
id: TL-79
title: "worktrail board export — a snapshot of the board as markdown to paste"
type: code
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P3
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
  - bash: "node --test scripts/tests/board-export.test.mjs"
  - bash: "node scripts/cli.mjs board export --stdout | head -20"
---

## Goal

`worktrail board export` produces readable markdown with the board's state —
to paste into a README, into an issue, or into a commit as a snapshot.

## Context

The backlog lives in the terminal and in the viewer. Anyone without the
tool (a client, a collaborator looking at the repo on GitHub) sees nothing.
Markdown is, in this case, an exchange format, not another view to
maintain.

In line with Law II: the export is entirely computed, so it is fine to
delete it and recreate it with one command. If deleting it ever hurts, it
means someone started editing it by hand, and that is a bug to fix, not to
work around.

The `--readme` variant from Backlog.md: injection between markers in an
existing file, preserving the rest of the content. This is the part that is
easy to get wrong — overwriting someone's README is lost work.

## Pre-flight reading

1. `scripts/build-backlog.mjs` — how boards are computed today; the export
   has to use this, not compute a second time on its own.
2. `scripts/cli.mjs` — the `board` command and its flags.
3. `.gitignore` — what is computed and unversioned; the export belongs to
   the same category by default.

## Steps

1. `worktrail board export [file]` — write to a file; `--stdout` for a
   pipe.
2. `--readme [file]` — replace the content between markers, preserving the
   rest of the file. No markers = fails with instructions, does NOT
   overwrite.
3. An existing file without `--force` = fails. Never a silent overwrite.
4. `scripts/tests/board-export.test.mjs` — the export contains tasks from
   the fixture; `--readme` preserves the text before and after the markers;
   missing markers fail it; an existing file without `--force` fails it.

## Acceptance criteria

- [ ] `board export` writes markdown with the board's state; `--stdout`
      writes to output.
- [ ] `--readme` replaces only the area between the markers.
- [ ] Missing markers and an existing file without `--force` fail it, they
      do not overwrite.
- [ ] The export computes from the same code as `build`, not from a second
      implementation.

## Log

2026-08-31 pending — agent:claude — created from the analysis of Backlog.md
(github.com/MrLesk/Backlog.md), point 8.
