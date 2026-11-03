---
id: TL-543
title: "set describes its fields as data and names an unknown value"
type: task
labels: []
board: main
epic: "External UI contract"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 4h
confidence: medium                 # how much you trust the estimate
created: 2026-11-03
updated: 2026-11-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: set-fields
    bash: "node --test scripts/tests/set-field.test.mjs"
---

## Goal

`set` describes the fields it edits as data, every field it edits is readable, and a value outside the vocabulary is a refusal kind of its own.

## Context

Found by branchling-ui (its UI-39) while building field edits on 0.3.0; checked against 7af44b6 and still open. (1) No command returns the fields `set` edits; a consumer hard-codes the list and can only compare it, in a test, with the prose 'editable: …' detail line of the usage refusal. (2) `confidence` and the declared `blocks` appear in no read (query rows, show --json), so an edit box for them cannot start from the current value. (3) A value outside the vocabulary comes back as refusalKind `usage`, the same as an unknown field or a malformed actor, so a UI cannot offer the declared values as the fix; `reason-required` already has its own kind and is not part of this. The vocabularies themselves are TL-532.

## Steps

1. Add `set --fields --json` (kind task-set-fields): fields [{ name, list, clearable, vocabulary }] where vocabulary names the config.yaml key the value must come from, or null
2. Add `confidence` and `blocks` to query rows and to show --json
3. Give an out-of-vocabulary value refusalKind `unknown-value` with `rejected` and `declared`, still exit 1; keep `usage` for an unknown field
4. Document the kind, the keys and the refusal in docs/external-consumers.md

## Acceptance criteria

- [x] set --fields --json lists every editable field with its vocabulary key; a value outside the vocabulary answers refusalKind unknown-value with the declared values; query and show carry confidence and blocks. [proof: set-fields]
