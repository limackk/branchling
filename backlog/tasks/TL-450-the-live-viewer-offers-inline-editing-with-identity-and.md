---
id: TL-450
title: "The live viewer offers inline editing with identity and reasons"
type: task
labels: []
board: main
epic: "Backlog viewer"
priority: P1
status: awaiting_vouch  # pending | in_progress | blocked | done | cancelled
owner: ""
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-11-05
blocked_by: [TL-449, TL-458, TL-459] # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: editing-ui
    bash: "node --test scripts/tests/viewer-editing.test.mjs scripts/tests/viewer-url.test.mjs scripts/tests/viewer-ui-language.test.mjs"
  - id: visual-editing
    manual: "Serve a fixture backlog, edit scalar, enum and list fields in light and dark mode, trigger a reason-required refusal, and confirm the task file plus history show the selected user actor and reason."
---

## Goal

A human using the live viewer can edit the supported task fields without opening a terminal, while always seeing which repository tree is being changed, who the change will be attributed to, whether a reason is required and whether the write reached the Markdown file and history.

## Context

This task consumes the narrow server write contract rather than creating another persistence path. Snapshot mode stays read-only and explains how to enter live mode. A user identity is an explicit namespaced actor such as user:kamil; it is not inferred from a browser profile or silently remembered across repositories. Configuration supplies enum values, and the UI must not hard-code this repository statuses, priorities, labels or roles.

## Steps

1. Restore field controls from buildFieldSpecs for title, status, priority, owner, role, estimate, confidence, labels, dependencies, executor and related documents where their shapes permit editing.
2. Keep project-derived and computed fields read-only and explain why they cannot be edited.
3. Make the active backlog path, worktree and editing actor persistent and prominent before the first save.
4. Ask for a reason before a protected transition and render server refusals without optimistic state that looks saved.
5. After a successful write, refresh the task and its history from the server and announce the change accessibly.
6. Encode selection, filters and the open editor state only where a shared URL can reproduce them without carrying identity or credentials.

## Review findings (2026-11-05)

The `visual-editing` check was run against a fixture backlog served by `branchling serve --dir` in the built-in browser, at 1280x860, in light and dark mode. Title, priority, status, labels, estimate, confidence and blocked_by were edited; `blocked` and `cancelled` were attempted without a reason, with the reserved word `unknown`, and with a real reason. Every write reached the task file and `history/<id>.jsonl` with `actor: user:reviewer`, `source: viewer` and, for the protected transition, the typed reason. Cancelling the reason prompt wrote nothing. The page did not report those writes honestly:

1. **Every successful save also shows an error.** `refreshFromServer` calls `refreshInFlight()` (`scripts/build-viewer.mjs`, inside `refreshFromServer`), a function TL-379 deleted. The ReferenceError is caught after `render()`, so the data updates and the toast "Error reading from the server: refreshInFlight is not defined" appears beside it. The same call breaks the SSE-triggered refresh, so a served viewer toasts the error on every task change even without editing.
2. **The reason prompt and every edit message are rendered out of sight.** `.reason-ask` and `.edit-result` sit at the bottom of the detail panel, about 1140px down in an 860px viewport, nothing scrolls them into view and focus is left on `body`. Pressing Save on a protected transition therefore only closes the editor; the reserved-word refusal and the "saved to Markdown and history as …" confirmation are equally invisible. The prompt also clears what was typed when it refuses.
3. **The missing-identity refusal is coloured like a success** (`rgb(5, 150, 105)`), while the success message is muted grey.
4. Minor: the last-change line reads "Blocked by by user:reviewer" — the field label and the connective collide.

Done when: a save shows its confirmation or refusal where the user is looking, the reason prompt receives focus, no server refresh raises a ReferenceError, and the `visual-editing` check is repeated.

## Acceptance criteria

- [ ] The live page exposes configuration-derived editors, reason handling and honest success or refusal states without making snapshot mode writable. [proof: editing-ui]
- [ ] A real user can understand and complete the editing flow in both themes. [proof: visual-editing]
