---
id: TL-35
title: "Raw activity log moves to the home directory"
type: task
labels: [post-launch]
board: main
epic: "Backlog — work-time measurement"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-28, TL-34]
blocks: []
related_docs:
  - docs/branchling-global-tool.md
  - docs/backlog-time-tracking.md
verification:
  - id: location
    bash: "node --test scripts/tests/activity-location.test.mjs"
  - id: nothing-raw-tracked
    bash: "test -z \"$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')\" && echo 'no raw log is tracked — OK'"
  - id: writes-go-home
    bash: "rm -rf /tmp/worktrail-act; WORKTRAIL_HOME=/tmp/worktrail-act node scripts/cli.mjs activity record --task TL-35 --kind tool --actor local:probe --no-throttle > /dev/null; test -n \"$(find /tmp/worktrail-act -name 'TL-35.jsonl')\" && test -z \"$(find backlog/activity -name 'TL-35.jsonl' 2>/dev/null)\" && echo 'the row went home, not into the repo — OK'; rc=$?; rm -rf /tmp/worktrail-act; exit $rc"
  - id: migrate-idempotent
    bash: "node scripts/cli.mjs activity migrate --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['rows'] == 0, d; print('nothing left to migrate — OK')\""
  - id: guards
    bash: "node scripts/cli.mjs check"
---

## Goal

Move the **raw heartbeats** from `backlog/activity/` to the user's home
directory. The per-task aggregate stays in the repository unchanged. After
this task, private timestamps **physically cannot** end up in someone else's
git history.

## Context

[backlog-time-tracking.md §5](../../docs/backlog-time-tracking.md) places the
raw log at `backlog/activity/*.jsonl` and protects it with a gitignore rule.
That works exactly until the first `git add -A` in someone else's
repository — at which point a record of **what hour a specific person worked**,
day after day, lands in public history and **cannot be removed from there**.
Undoing it requires rewriting history, an operation nobody will perform in a
repository that is not theirs.

The difference is qualitative, not gradual: in the home directory this
failure mode is **impossible**, not merely discouraged. Protection stops
depending on the correctness of `.gitignore` in every repository the tool
ever ends up in.

The division of roles stays the same as in the measurement design — raw data
stays with the person, the aggregate travels with the project:

```
<data>/activity/<project>/BL-NNNN.jsonl        ← raw heartbeats, outside any repo
<repo>/backlog/activity/rollup/BL-NNNN.json    ← per-task aggregate, versioned (unchanged)
```

This is a **revision of a freshly designed mechanism**, not a new idea:
[TL-31](TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md) builds
`prune` and `forget` on this location, so both need to know about the
change. Until this task is closed, the version from TL-28 works correctly on
a single machine — but is not fit for release.

## Pre-flight reading

1. `docs/branchling-global-tool.md` — §6 (why we are moving
   this), §5 (config vs. data separation).
2. `docs/backlog-time-tracking.md` — §5 (data model), §9
   (privacy, retention, correction).
3. `scripts/home.mjs` (TL-34) — resolving the data directory.
4. `scripts/activity.mjs` (TL-27) — the only place that knows the log
   paths; it must remain so after this change.

## Steps

1. `activityPath()` reads the **data** directory from `home.mjs`, not from
   `backlogPaths()`. One place, one change — if more than one file needs
   touching, the paths have already leaked and that is a separate problem to
   fix first.
2. Per-project segregation in the home directory:
   `<data>/activity/<project>/`. Project name from the registry (TL-34); an
   unregistered project gets a **stable hash derived from the backlog path**,
   not "default" — otherwise two projects silently merge into one and
   minutes get summed together without anyone noticing.
3. The `rollup/BL-NNNN.json` aggregate **stays in the repository** and
   remains versioned. This task does not touch it.
4. `backlog/.gitignore`: the rule on `activity/*.jsonl` **stays** — as a
   safety net for logs from before the migration and for anyone who sets
   `full` mode.
5. Migration of existing logs: a one-time `worktrail activity migrate`
   moving `backlog/activity/*.jsonl` into the home directory, idempotent,
   with `--dry-run`. For this repository that is at most a few files, but
   without this step the data simply disappears from view.
6. Update `prune` and `forget` from
   [TL-31](TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md) to work
   at the new location — **if TL-31 is already done**; if not, leave a note
   there about the location.
7. `worktrail where` (TL-34) also prints the activity log path — the user
   has one place to check what the tool holds about them.
8. Update `backlog-time-tracking.md` §5 and §9 to the new location.

## Acceptance criteria

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] Raw heartbeats land in the user's DATA directory, not in the repository — proven with `WORKTRAIL_HOME`. [proof: writes-go-home, location]
- [x] `git ls-files backlog/activity` returns no file outside `rollup/`. [proof: nothing-raw-tracked, location]
- [x] Two different unregistered projects do not share a directory. [proof: location]
- [x] `activity migrate --dry-run` touches nothing, and `migrate` run twice leaves the same state. [proof: migrate-idempotent, location]
- [x] The `rollup/` aggregate stays in the repository, versioned and unchanged in shape. [proof: location]
- [x] `worktrail where` shows the raw activity log's path. [proof: location]
- [x] `backlog-time-tracking.md` §5 and §9 describe the state after the move, and §6 of the global-tool document is marked implemented. [proof: guards]
- [x] `prune` and `forget` work at the new location. [proof: location]

## Decision (2026-09-02)

**The directory is keyed by the backlog PATH, not by the registry name, and this
departs from step 2 on purpose.** The step says "project name from the registry
(TL-34)". TL-34 itself settled that a registry label is the USER'S OWN and
mutable, and that the path is the project's identity — so deriving a data
directory from the label would move somebody's raw log the first time they ran
`project add --name`: silently, into a directory the tool then reports as empty,
with the old one still on disk and unreachable by anything. That is the same
class of mistake `BLOCK_MARKER_NAME` exists to prevent, and it is worse here,
because the data is a person's own.

What is used instead is `<slug>-<hash of the absolute path>`. The hash is what
makes it stable and what keeps two unregistered projects apart — "default" for
anything unregistered would sum two projects into one set of minutes with
nothing able to tell. The slug is what makes the directory legible to somebody
opening it looking for their own data, which §9 requires them to be able to do.
There is a test for the rename case specifically.

**The contract was rewritten to this repository's paths**, as in TL-27, TL-28,
TL-31 and TL-34, and the migration check was made an ASSERTION rather than a
`tail -1` a human reads: `migrate --json` must report zero rows left to move.

**`migrate` is idempotent by ROW ID, not by file.** A file-level "already
moved?" flag cannot answer the question once a partial move has happened, and
the failure it would cause — doubled minutes — is the one thing worse than the
lost measurement this command exists to prevent. It writes the merged set before
removing the source, because this is the one operation whose input cannot be
reconstructed from anywhere else.

**The test suite now redirects its own home directory.** `isolateHome()` in
`scripts/tests/_repo.mjs` points the whole test process at a throwaway
directory. Without it, every fixture row written through the default
`process.env` would land in the machine's REAL activity log, where it is
indistinguishable from somebody's actual working calendar — and it would arrive
there through the functions whose whole purpose is to keep that file private.

## Verification

```bash
# 1. Location, segmentation and migration — expected: pass
node --test scripts/tests/activity-location.test.mjs

# 2. Nothing raw is tracked by git — expected: OK message
test -z "$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')" \
  && echo 'no raw log is tracked — OK'

# 3. Writes go to the home directory — expected: the file is OUTSIDE the repo
rm -rf /tmp/worktrail-act
WORKTRAIL_HOME=/tmp/worktrail-act node scripts/cli.mjs activity record \
  --task TL-35 --kind tool --actor local:probe --no-throttle
find /tmp/worktrail-act -name 'TL-35.jsonl'
test -z "$(find backlog/activity -name 'TL-35.jsonl' 2>/dev/null)" && echo 'nothing landed in the repo — OK'
rm -rf /tmp/worktrail-act

# 4. Migration is idempotent — expected: zero rows left to move
node scripts/cli.mjs activity migrate --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert d['rows'] == 0; print('nothing left to migrate — OK')"

# 5. Module guards
node scripts/cli.mjs check
```

## Notes

- **Why not just leave everything in the repository with a better
  gitignore:** because `.gitignore` is a promise upheld by every future
  user in every future repository, while the home directory is owned by
  the tool. One is a procedure, the other is a structural guarantee.
- **Why the aggregate stays in the repository:** estimate calibration needs
  to travel with the project and go through review — that is the same
  boundary as raw/aggregate in §9 of the measurement document, and it does
  not change here.
- Deliberately out of scope: retention and `forget` (TL-31), the registry
  (TL-34), the cross-project view (TL-36).

## Log

- 2026-08-30 created — claude — revision of the location from
  docs/architecture/backlog-time-tracking.md §5; in the home directory an
  accidental `git add -A` in someone else's repository becomes impossible,
  not merely discouraged
