---
id: TL-511
title: "The viewer filters tasks by their planned release"
type: task
labels: []
board: main
epic: "Release tracking across environments"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-01
updated: 2026-11-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: viewer-release-filter
    bash: "node --test scripts/tests/viewer-release-filter.test.mjs"
---

## Goal

The viewer filters and shows tasks by the release they are planned for (`release:` in the frontmatter, from `releases:` in config.yaml, added by TL-505), so a non-technical reader can see a release's planned scope without the terminal.

## Context

TL-505 added `release` to FIELD_SHAPES in scripts/task-fields.mjs as a closed, dictionaryRequired enum, so the viewer's field specs and inline editor already receive it through buildFieldSpecs. What it did NOT do, deliberately, is touch scripts/build-viewer.mjs: the filter bar has no `release` facet, the table and cards show no release, and the URL view state (scripts/viewer-url.mjs) has no key for it. TL-504 works on a release view in the viewer in parallel; coordinate with what it ships rather than duplicating a second release surface. The comparison itself (planned not shipped, unplanned, dropped) is `release status --release <name> --json`, field `release`.

## Steps

1. Add a `release` facet to the viewer filter, values from `releases:` in config.yaml plus an entry for tasks planned for none, hidden when the project declares no releases.
2. Carry the facet in the URL view state so a filtered view can be shared.
3. Test in the viewer test files with a fixture config that declares releases, and a positive control that a project with none shows no facet.

## Acceptance criteria

- [x] The viewer filters tasks by planned release, the facet travels in the URL, and a project with no releases shows no facet. [proof: viewer-release-filter]
