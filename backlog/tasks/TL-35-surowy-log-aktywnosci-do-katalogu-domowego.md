---
id: TL-35
title: "Raw activity log moves to the home directory"
type: code
labels: [post-launch]
board: main
epic: "Backlog — work-time measurement"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-28, TL-34]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/activity-location.test.mjs"
  - bash: "test -z \"$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')\" && echo 'no raw log is tracked — OK'"
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

1. `docs/architecture/worktrail-global-tool.md` — §6 (why we are moving
   this), §5 (config vs. data separation).
2. `docs/architecture/backlog-time-tracking.md` — §5 (data model), §9
   (privacy, retention, correction).
3. `backlog/scripts/home.mjs` (TL-34) — resolving the data directory.
4. `backlog/scripts/activity.mjs` (TL-27) — the only place that knows the log
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

- [ ] Raw heartbeats land in the user's **data** directory, not in the
      repository — there is a test for this with `WORKTRAIL_HOME`.
- [ ] `git ls-files backlog/activity` returns **no** file besides those
      under `rollup/` — gate in Verification.
- [ ] Two different unregistered projects do not merge into a shared
      directory — test on two backlog paths.
- [ ] `activity migrate --dry-run` touches nothing; `migrate` run twice
      produces the same state.
- [ ] The `rollup/` aggregate remains versioned and unchanged in shape.
- [ ] `worktrail where` shows the activity log path.
- [ ] `backlog-time-tracking.md` §5 and §9 describe the post-change state;
      §6 of the global-tool document is marked as implemented.
- [ ] `prune` and `forget` work at the new location (or TL-31 has a note, if
      it does not exist yet).

## Verification

```bash
# 1. Location tests — expected: pass
node --test backlog/scripts/tests/activity-location.test.mjs

# 2. Nothing raw is tracked by git — expected: OK message
test -z "$(git ls-files backlog/activity | grep -v '^backlog/activity/rollup/')" \
  && echo 'no raw log is tracked — OK'

# 3. Writes go to the home directory — expected: file OUTSIDE the repo
WORKTRAIL_HOME=/tmp/worktrail-act node backlog/scripts/cli.mjs activity record --task TL-35 --kind tool
find /tmp/worktrail-act -name 'TL-35.jsonl' | head -1
test -z "$(find backlog/activity -name 'TL-35.jsonl' 2>/dev/null)" && echo 'nothing landed in the repo — OK'
rm -rf /tmp/worktrail-act

# 4. Migration is idempotent — expected: second count identical
node backlog/scripts/cli.mjs activity migrate --dry-run | tail -1
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
