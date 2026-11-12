---
id: TL-724
title: "The viewer's field editors are executed by tests that kill their mutants"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-12
updated: 2026-11-12
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: editor-tests-green
    bash: "node --test scripts/tests/actor-shape-diagnosis-readers.test.mjs scripts/tests/viewer-editing.test.mjs"
---

## Goal

Every function in scripts/viewer-field-editors.mjs is executed by a test that asserts its result, so a mutation run over the module kills its mutants instead of reporting them survived.

## Context

TL-704 moved the viewer's field editors (fieldLabel, dynamicOptions, startEdit, cancelEdit, editorHtml, saveSelected, saveText, saveLines, saveChips, saveField) out of the page template in scripts/build-viewer.mjs into scripts/viewer-field-editors.mjs, which the page pastes by source. A mutation run became possible, and its first result shows how little the module's tests assert: `npm run mutation -- --named-only --changed-lines --concurrency 2 --files scripts/viewer-field-editors.mjs` on 2026-11-12 made 250 mutants and killed 29 (score 11.6%), 221 survived. The only test that executes the module is scripts/tests/actor-shape-diagnosis-readers.test.mjs, which runs startEdit() for actor diagnosis; the other editing tests (viewer-editing.test.mjs, viewer-no-edit-state.test.mjs) match the built page's text with regular expressions and do not name the module, so they are not selected. Survivors inside startEdit(): the `!CAN_EDIT || DEDICATED_FIELDS[field]` guard, the renderDetail() calls, the `editingActor` and `[data-editor-focus]` focus targets. fieldLabel, dynamicOptions, editorHtml and saveField (its fetch body, the 409 refresh, the actor-required focus, the HISTORY append and the success and failure messages) are executed by no test at all. The way to execute them is the one the actor test uses: take the pasted module from the built page and evaluate it with `Function` in the test realm, supplying the page names as parameters (node:vm hides the active mutant from Stryker's switch).

## Steps

1. Write a test file that names scripts/viewer-field-editors.mjs and runs each function through the page's paste with stub page names (state, ALL_TASKS, HISTORY, FIELDS from buildFieldSpecs, a fetch stub returning ok, 409 and actor-required answers)
2. Rerun the mutation run over the module and write the assertion each remaining survivor names, or name it as an equivalent mutant

## Acceptance criteria

- [ ] The field editors' tests pass against the module the page pastes [proof: editor-tests-green]
