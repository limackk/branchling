---
id: TL-63
title: "config.yaml comments should say what a change costs"
type: task
labels: [pre-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "T=\"$PWD/bin/branchling.mjs\"; d=$(mktemp -d); node $T init --dir \"$d\" >/dev/null; for k in statuses priorities labels task_id_prefix owners estimates; do grep -q \"^$k:\" \"$d/config.yaml\" || { echo \"missing key $k in template\"; exit 1; }; done; echo 'all keys present — OK'"
  - bash: "node --test scripts/tests/init-config-comments.test.mjs"
  - manual: "Someone who does not know the tool can, after reading only the generated config.yaml, say which changes are free and which requires a migration."
---

## Goal

Add to the generated `config.yaml` a piece of information that is nowhere
today: **how much it costs to change each key** and what needs to happen when
the backlog is no longer empty.

## Context

The generated `config.yaml` is the main — realistically the only — document
opened by someone adapting the tool to their project. The comments already
there are good, but they answer "what is this", not the question the user
actually asks: **"can I change this now".**

The answer is not uniform, and that is the whole point. Measured on
2026-08-31:

| Key | Cost of change |
|---|---|
| `priorities`, `owners`, `estimates`, `labels`, colors, `title_max_length` | free |
| `statuses`, `types`, `labels_closed`, boards | requires reviewing the tree — existing tasks may hold values outside the new vocabulary |
| `task_id_prefix` | **requires migration**: `worktrail migrate-prefix --to <NEW>`, `--dry-run` first |

For `task_id_prefix` the warning already exists and is good. For `statuses`
there is nothing — and changing `statuses` to a project's own
(`todo`/`doing`/`shipped`) is one of the first things a team does, and it
drags along `archived_statuses` and `dashboard_open_statuses`. Measured: such
a change without fixing these two keys produces a five-line inconsistency
message — correct and readable, only it comes out AFTER the fact, instead of
being written next to the field.

This task is cheap and highly scored precisely because it adds no mechanism.
It changes text in a single template — and here, text is the interface.

A dependency worth knowing about: `worktrail doctor` ([TL-62](TL-62-tasklog-doctor-jedna-odpowiedz-czy-backlog-jest-ustawiony.md))
answers the same question after the fact. This task answers it **before** —
and that is why both make sense, and neither replaces the other.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `CONFIG_YAML`; this is the entire scope of the
   edit.
2. `scripts/config.mjs` — `DEFAULTS` and `validateConfig()`; the
   classification must agree with what the code actually enforces.
3. `backlog/config.yaml` of this repository — an example of configuration
   that has drifted from the default.

## Steps

1. Add a short legend of the three change classes to the `CONFIG_YAML` header.
   Three lines, not a paragraph.
2. Mark each key with its class and — when the class is other than "free" —
   one sentence about what to do when the backlog is not empty.
3. For `statuses`, explicitly name the two keys that must be fixed together
   (`archived_statuses`, `dashboard_open_statuses`). This relationship is
   invisible until it hits you with an error message.
4. For `labels_closed`, say what changes when it is flipped to `true` and that
   it also applies to tasks that already exist.
5. Do not duplicate the documentation — this should be five to ten lines
   total, not a second manual. A comment that keeps growing stops being read.
6. Test `scripts/tests/init-config-comments.test.mjs`: the generated
   `config.yaml` after `init` still parses without issue (the comment must
   not break the narrow parser) and contains the class legend.

## Acceptance criteria

- [ ] The generated `config.yaml` has a legend of the three change classes.
- [ ] Every key has an assigned class.
- [ ] `statuses` names the two dependent keys.
- [ ] The classification agrees with what `validateConfig()` enforces.
- [ ] The generated file still parses without issue.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the onboarding audit
- 2026-08-31 in_progress — agent:claude — implementation started
- 2026-08-31 done — agent:claude — a legend of the three classes in the header
  of the generated `config.yaml`, a class next to each key. For `statuses`,
  both keys to fix alongside it are named EXPLICITLY
  (`archived_statuses`, `dashboard_open_statuses`) — and along the way
  `dashboard_open_statuses` entered the template at all, since it was not
  there before, despite its inconsistency failing the build. For
  `task_id_prefix` a sentence was added saying that on an EMPTY backlog the
  change is free: this is the most common case right after `init`, and the
  bare pointer to `migrate-prefix` looked like overkill.
- 2026-08-31 done — agent:claude — the classification had to be CORRECTED
  along the way, and that result is worth recording. I wanted to mark
  `owners` as "[free] a hint, not a closed vocabulary" — not true:
  `new-task.mjs` checks `--owner` against this list, even though the tree can
  hold any owner (the field is `dynamic`, so `auditVocabulary` skips it).
  This is the same write/read asymmetry as in TL-56, only in the opposite
  direction. The comment now states both halves.
- 2026-08-31 done — agent:claude — test `init-config-comments.test.mjs`, 7
  assertions. Two guard against the comment breaking the narrow parser; three
  are POSITIVE controls for the classification itself — checking that a key
  marked [migration] really fails the build after the change, and one marked
  [free] really does not. A comment saying "free" next to a key that requires
  migration is worse than no comment, so an assertion on the presence of the
  text without an assertion on its truth would defend nothing. 309/309.
