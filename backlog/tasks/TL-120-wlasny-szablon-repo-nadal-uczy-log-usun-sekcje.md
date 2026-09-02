---
id: TL-120
title: "This repo's own template still teaches ## Log — remove the section"
type: task
labels: []
board: main
epic: "History and attribution"
priority: P2
status: done
owner: agent:claude
estimate: 30m
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-field-editing-history.md
verification:
  - id: no-log-in-templates
    bash: "node --test scripts/tests/change-reason.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

A task created by `worktrail new` in THIS repository does not contain a
`## Log` section, and the guard for this fact evaluates EVERY template on
disk, not one named by a path.

## Context

TL-105 moved "why" from a sentence in the task file to the `reason` field of
a record in `backlog/history/`. It removed `## Log` from the template — but
from ONE of them. That task's verification read:

```
grep -q '## Log' _template.md && { echo 'template still teaches ## Log'; exit 1; }
```

That is the path to the template that SHIPS IN THE TARBALL and that
`worktrail init` copies into other people's repositories. Meanwhile
`new-task.mjs:181` reads `join(root, "_template.md")`, where `root` is the
resolved backlog directory — here that is `backlog/_template.md`. That is a
SECOND file, with different content (Polish, 932 B versus 2.5 kB), and it
kept the section.

Result: the guard was green, and the tool spent this whole time writing
"Append-only. Format: `YYYY-MM-DD status — who — note`." into every task
created in this repository. This very file is the proof — it came from the
faulty template and was born with a `## Log` section.

**What does NOT need to change.** `scripts/init-backlog.mjs` does not hold
its own copy of the template: `TEMPLATE_PATH = join(HERE, "..", TEMPLATE_FILENAME)`
and `readTemplate()` read the root `_template.md` — a decision from TL-50, so
the second copy would not drift from the first. Other people's repositories
therefore already get the clean template, and the change does not concern
them. The removal applies ONLY to `backlog/_template.md`.

**What must NOT be touched.** Existing tasks with a `## Log` section stay
(CLAUDE.md): those are sentences nobody will reconstruct. This task removes
the template, not the history.

**A bug class, not a typo.** A guard naming a single path is exactly what
CLAUDE.md warns about: green with no evidentiary force, because it passes on
a sample that skips the file actually in use. That is why the list of
templates has to be ENUMERATED — repository root and backlog directory,
collapsed into one in the co-located layout — rather than written by hand.

## Pre-flight reading

1. `backlog/_template.md` — the file to change; the section at the end.
2. `_template.md` — the shipped template, ALREADY clean; the reference point
   for content.
3. `scripts/new-task.mjs:181` — proof that `new` reads the template from the
   backlog directory.
4. `scripts/init-backlog.mjs:132-150` — proof that `init` does not hold a
   second copy.
5. `scripts/tests/change-reason.test.mjs` — the header of the file names the
   convention being replaced; the guard belongs here, not in a new file.
6. `scripts/tests/_repo.mjs` — the backlog directory comes from here; do not
   compute it yourself.

## Steps

1. Remove `## Log` along with the "Append-only…" line from
   `backlog/_template.md`.
2. In `scripts/tests/change-reason.test.mjs`, add a guard: the list of
   templates enumerated from `REPO_ROOT` and `BACKLOG_DIR` (`_repo.mjs`),
   deduplicated with a `Set`, the pattern matching the HEADING
   (`/^##[ \t]+Log[ \t]*$/m`), not the word.
3. Add an end-to-end test: for each template, set up a temporary backlog via
   `init --no-example`, overwrite its `_template.md` with the file under
   test, run `new` and check the CREATED task. Reading the template does not
   prove what `new` writes.
4. Add a positive control: put the section back in a sandbox template and
   check that the same pattern DOES SEE it.
5. Fix a stale comment in `scripts/tests/new-task.test.mjs` (it mentions
   `YYYY-MM-DD` "in the ## Log section", which no longer exists).
6. Do not touch existing tasks.

## Acceptance criteria

- [x] `backlog/_template.md` does not contain a `## Log` heading. [proof:
      no-log-in-templates]
- [x] A task from `worktrail new` has no `## Log` — for every template on
      disk. [proof: no-log-in-templates]
- [x] The guard FAILS when the section returns to a template (positive
      control). [proof: no-log-in-templates]
- [x] The full test suite is green. [proof: suite-green]
