---
id: TL-403
title: "check --docs reads documents from outside the backlog it was given"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: check-1
    bash: "node --test scripts/tests/guard-scope.test.mjs"
---

## Goal

`check --docs` judges only the documents of the backlog it was pointed at. Today it reads markdown from the directory ABOVE a co-located backlog, so an unrelated file belonging to somebody else can fail this project's release gate.

## Context

Measured on 2026-09-21 while working on TL-262. With a co-located backlog created by `branchling init --dir /tmp/x/bl --no-example`, a file `/tmp/x/stray.md` containing one dead link makes `branchling check --docs --dir /tmp/x/bl` print `- stray.md:3 -> ./nowhere/missing.md` and fail the gate. The stray file is outside the backlog and outside any repository the command was shown.

It is not theoretical: it turned `scripts/tests/guard-scope.test.mjs` red during a full suite run, because the fixture is created under TMPDIR and another session had left a markdown file in that same directory. The same run was green with an empty TMPDIR, so the suite's result depended on a stranger's file.

The root is resolved for a non-git backlog by walking up from the backlog directory; that is the rule to look at first (`repoRoot()` and its callers, then the docs guard in `scripts/docs-drift.mjs` / `scripts/check-*` that enumerates documents).

## Steps

1. Reproduce: init a co-located backlog in a fresh directory, put a markdown file with a dead link in its PARENT, run `check --docs --dir <backlog>`.
2. Decide what the document set of a backlog is when there is no git repository around it, and make the guard read nothing above that boundary.
3. Add a regression test that puts a dead-link document beside the fixture's root and asserts the guard does not see it.

## Acceptance criteria

- [ ] The guard-scope suite stays green with a stray markdown file sitting in TMPDIR. [proof: check-1]

## Measured again, and the mechanism is settled (2026-09-21)

A second session reported that overriding `TMPDIR` "produces 17 spurious
failures" across the cli, doctor, init, migrate-prefix and new fixtures, and
concluded the override itself was the cause. That conclusion is wrong, and the
correction is the useful part of this record.

What was actually measured, in the main checkout at `f923a90`:

    $ TMPDIR=<that session's own scratch dir> node --test scripts/tests/doctor.test.mjs
      tests 14, pass 13, fail 1
    $ TMPDIR=<a directory created empty> node --test scripts/tests/doctor.test.mjs
      tests 14, pass 14, fail 0

The two runs differ only in what already lay in the directory. That session had
written its own working files there — `probe.mjs`, `regress.mjs`,
`old-manual.md`, `new-manual.md`, `old-hist.md`, `new-hist.md` — and a fixture
backlog created BELOW that directory is then within reach of the document scan.
Its own scratch files were read as if they belonged to the fixture.

So the defect is the one this task already names, and the override is its
remedy rather than its cause: `TMPDIR` pointed at a private directory isolates
a run from OTHER sessions, and is exactly what stopped the first instance. What
it cannot do is isolate a run from the session's own leftovers in that same
directory. Any fix here has to make the scan's reach independent of what lies
above the backlog, rather than relying on the directory being clean — because
"clean" is a property nobody can maintain while working.
