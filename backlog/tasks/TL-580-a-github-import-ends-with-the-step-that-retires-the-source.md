---
id: TL-580
title: "A GitHub import ends with the step that retires the source issues"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: help-names-retirement
    bash: "node scripts/cli.mjs import --help | grep -q 'gh issue close'"
  - id: guide-names-retirement
    bash: "grep -q 'gh issue close' docs/guide.md"
  - id: import-tests
    bash: "node --test scripts/tests/import-github.test.mjs"
---

## Goal

After a GitHub import has been committed, the team learns from the tool itself how to close the source issues that were still open, with a comment that names the task each one became. The procedure exists in `import --help`, in the report of a real run and in `docs/guide.md`. The import itself still makes no network request.

## Context

`scripts/import-github.mjs` stands on TL-67 decision 2: "One-off, never synchronous", copy and forget. Today it only copies. Every issue that was OPEN in GitHub stays open after the import, so the team keeps commenting, relabelling and closing it there, and the backlog now has a twin outside the branch. That is the second source of truth Law 1 rejects, and nothing in the import mentions it: USAGE ends at what is not brought over, the human-readable report ends at the `verification:` warning, and the "Bringing your team over" section of `docs/guide.md` says "It is a one-off copy, not a synchronisation" but never says what to do with the original.

The data needed to retire the source is already almost all there. A real run with `--json` returns `created[]` entries carrying `id`, `file`, `title` and `source` (the issue URL), and `gh issue close <url> --comment …` accepts a URL. What is missing is the issue's STATE. Without it a caller cannot tell an issue that was open (and must be retired) from one that was already closed. `wouldCreate[]` in a dry run carries the derived `status`, but `created[]` carries nothing equivalent. A new key in a `created[]` entry has to respect the `--json` contract in `docs/manual.md` and the kind declared in `scripts/json-envelope.mjs`. Check whether nested entry shapes are declared there.

Surfaced on 2026-11-05 while assessing whether branchling should have a GitHub connector. That assessment concluded against any synchronisation (Law 1, TL-67 decision 2, the verification contract of `done`) and found this as the one real gap in the existing integration.

Rejected, and NOT part of this task:
- A `--close-source` flag that spawns `gh`. TL-67 decision 1 keeps the command free of network side effects. Closing issues in somebody else's tracker is an outward-facing act a person should run deliberately. At import time the new task files also exist only in the working tree, so a closing comment written then would point at something nobody else can see. Retirement belongs AFTER the import is committed to the branch the team reads.
- Any synchronisation, mirror or status push back to GitHub.
- Handling `skipped` issues from an earlier run. A re-import already skips them by URL. Retiring an earlier run's leftovers is a separate question if it ever comes up.

TL-577 edits the neighbouring omission line in the same USAGE array. Whichever of the two lands second rebases onto the other.

## Steps

1. Expose the source issue's state in each `created[]` entry of `import --json` (for example `sourceState: "open" | "closed"`), as the envelope contract allows.
2. Add a short retirement paragraph to USAGE in `scripts/import-github.mjs`: run it after the import is committed, and give a copyable pipeline from `import --json` to `gh issue close <url> --comment` that selects only issues that were open. The pipeline belongs in the user's shell; jq there is the user's choice, not a dependency of the tool.
3. In the human-readable report of a real (non-dry-run) import, print one pointer to that step only when at least one created task came from an open issue.
4. Describe the step in the "Bringing your team over" section of `docs/guide.md`, next to the one-off-copy paragraph.
5. Add tests to `scripts/tests/import-github.test.mjs`. `created[]` carries the state for both an open and a closed fixture issue. The report prints the pointer for a fixture with an open issue and does NOT print it for one where every issue was closed (the positive and negative controls).

## Acceptance criteria

- [ ] `import --help` gives the procedure that closes the source issues after the import is committed. [proof: help-names-retirement]
- [ ] The guide's section on bringing a team over tells the reader to retire the source issues. [proof: guide-names-retirement]
- [ ] `created[]` carries each source issue's state, and the report points at retirement exactly when an open issue was imported, without changing the import's other behaviour. [proof: import-tests]
