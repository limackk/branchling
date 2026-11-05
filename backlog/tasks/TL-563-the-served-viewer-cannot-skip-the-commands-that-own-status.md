---
id: TL-563
title: "The served viewer cannot skip the commands that own status and owner"
type: bug
labels: []
board: main
epic: "Backlog viewer"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [serve]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-566]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: route-refuses
    bash: "node --test scripts/tests/viewer-dedicated-fields.test.mjs scripts/tests/viewer-write-api.test.mjs scripts/tests/set-field.test.mjs"
---

## Goal

A status or owner change made from the served viewer goes through the same checks as the commands that own those fields: above all, no task reaches an archived status from the viewer without the verification `branchling done` runs. The comment on the write route in `scripts/serve-backlog.mjs` describes the policy that is actually in force.

## Context

`branchling set` refuses `status` and `owner` because dedicated commands own them (`DEDICATED_FIELDS` in `scripts/field-write.mjs`): `done` runs the verification, `take` reserves, `handoff` and `release` record the exchange, `ask` records the question. The served route `POST /api/task` (`handleFieldEdit` in `scripts/serve-backlog.mjs`) calls the same `writeTaskField` core WITHOUT `refusedFields`, so it writes both. Verified on 2026-11-05 against a fixture backlog: a POST setting a pending task to `done` returned 200, wrote `status: done` and a history entry with `source: viewer`, and ran no verification.

TL-521 promised that every field the viewer writes can be set by a command; for these two fields the command that can is not `set` but one with checks the viewer skips. TL-450 step 1 lists status and owner among the editors to restore, so the outcome here changes that task's editor list.

Alternatives to weigh: (a) refuse `status` and `owner` on the route as `set` does, and have the viewer print the command instead of offering an editor, as it already does for decisions; (b) allow transitions between non-archived statuses only, and keep `owner` refused; (c) route each status change through the core of its dedicated command, which for `done` means running verification inside the server and still cannot answer a `manual:` entry.

Separately, the comment beneath the route (the block beginning 'This server used to answer `/api/field`') still argues, from TL-379, that a second write path should not exist at all. It must be rewritten to state whichever policy is chosen.

## Decision

Settled in the spec stage on 2026-11-05: **alternative (a).** The route refuses `status` and `owner` exactly as `set` does, by passing `refusedFields: Object.keys(DEDICATED_FIELDS)` to `writeTaskField`, so the refusal, its message and the list of refused fields are the shared core's and cannot drift between the two callers. The viewer keeps showing both values but offers no editor for them; in place of the edit affordance the row names the commands that change the field (`DEDICATED_FIELDS[key]`), as the decisions view already names `decide`.

Why not (b). The non-archived statuses have owning commands too: `in_progress` is entered through `take`, which reserves the task under the session lock (TL-87); `blocked` through `ask`, which records the question; a return to `pending` through `release` or `handoff`, which record the exchange. A viewer write between them skips each of those checks, so (b) narrows the defect without closing it, and a transition table kept beside the route is a second policy that drifts from the commands. `owner` would be refused under (b) anyway.

Why not (c). Running `done`'s verification inside the server executes arbitrary `bash:` entries on a request of a long-lived process, still cannot answer a `manual:` entry, and re-implements five commands behind HTTP — a second write surface for exactly the decisions the CLI exists to own.

Where the rule lives. The page needs the same list the route uses, and the page is built from inlined modules (`readModuleSource`), not from `field-write.mjs`, which imports `build-viewer.mjs`. `DEDICATED_FIELDS` therefore moves to `scripts/task-fields.mjs` — already inlined into the page and already the source of the field specs — and `field-write.mjs` re-exports it, so `set` and every existing import keep working.

Consequence, deliberately not handled here. Every value in `reason_required_statuses` is a status, so after this change no viewer write can require a reason: the page's reason prompt and the route's `needsReason` answer stay wired but unreachable. Removing or repurposing them is TL-566.

## Steps

1. Decide between the alternatives in Context and record the decision in this task's body before changing code.
2. Enforce it in `handleFieldEdit`, passing `refusedFields` or the chosen transition rule to `writeTaskField`, so the route and `set` cannot drift apart.
3. Make the viewer's status and owner editors match the route: no editor offers a value the route refuses.
4. Rewrite the comment under the write route in `scripts/serve-backlog.mjs` so that it describes the route that exists.
5. Add `scripts/tests/viewer-dedicated-fields.test.mjs`: serve a fixture, post `status: done` and an owner change with a valid capability, assert the chosen refusal and an unchanged file, and keep a positive control that a plain field such as `priority` is still written.

## Acceptance criteria

- [x] No viewer write archives a task or changes its owner without the checks of the command that owns that field, and plain fields are still written. [proof: route-refuses]
