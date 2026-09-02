---
id: TL-31
title: "Retention, attribution correction, and the right to deletion"
type: code
labels: [post-launch]
board: main
epic: "Backlog — time tracking"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - origin#docs/architecture/legal-and-compliance.md
verification:
  - bash: "node --test backlog/scripts/tests/retention.test.mjs backlog/scripts/tests/reassign.test.mjs"
  - bash: "node backlog/scripts/cli.mjs activity forget --actor local:test --dry-run"
---

## Goal

Close three things without which the activity log cannot leave a single
machine: **how long we keep it**, **how to get rid of it**, and **how to
correct a wrong attribution**. Without them the module collects personal data
with no expiration and no way out.

## Context

Since TL-28, `backlog/activity/` starts to contain a record of **at what hour
a specific person worked**, day after day. In a public repository this is
surveillance metadata, not project telemetry; in a company repo it is
employee data; in the EU it is personal data.

Three gaps, all identified in an adversarial review of the project, all of the
same nature ("the mechanism collects, nothing gives back"):

1. **No retention.** The log grows without bound and there is no answer to
   "how long do you keep this". This is the first question from any external
   EU user and the first question from any team that deploys this internally.
2. **No deletion.** There is no command for a person to withdraw their data.
   Manually deleting files is not enough, because the aggregates
   (`rollup/BL-NNNN.json`) are computed from the raw rows and would survive
   deleting the source — meaning the data would come back at the first
   report.
3. **No correction.** The log is append-only, so the first attribution mistake
   (work on BL-A recorded under BL-B) stays forever and silently corrupts
   calibration. This is a guaranteed first reported bug, not a hypothetical
   one.

**Why this is phase 1b, not phase 4:** personal data starts being generated
the moment TL-28 ships. The mechanism to delete it cannot come "later" — it
can come after TL-28 in the order of work, but nothing may leave a single
machine before this task is closed.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §9 (privacy, retention,
   correction), §5 (row shape, `kind: reassign`), §13 (what this mechanism is
   NOT).
2. `docs/architecture/legal-and-compliance.md` — the workspace's conventions
   for personal data and retention windows.
3. `backlog/scripts/activity.mjs` (TL-27) and `attribution.mjs` (TL-28).
4. `backlog/scripts/config.mjs` — `activity_retention_days` and
   `activity_privacy` are already in the schema (TL-27 step 7); this task only
   adds their USE.

## Steps

1. `worktrail activity prune` — deletes raw heartbeats older than
   `activity_retention_days` (default 90) and **recomputes the aggregates
   before deleting**, so the retention window does not eat historical
   calibration. The aggregate survives, because at that resolution it is no
   longer data about a person.
2. Running `prune`: at viewer server startup and from a hook, following the
   same convention as `build-backlog.mjs` — a mechanism that must be
   remembered is not a mechanism.
3. `worktrail activity forget --actor <a>` — deletes the actor's raw rows
   **and** recomputes the aggregates, so the data does not come back at the
   next report. `--dry-run` prints what would disappear and touches nothing.
4. `worktrail activity reassign --from BL-A --to BL-B --session S [--since
   TS]` — appends a `kind: "reassign"` event. The log is append-only, so the
   correction is a **new event, not an edit of history**; the reader applies
   it at read time, the same way `readHistory()` applies dedup.
5. The order in which corrections are applied must be deterministic (by
   ULID), and `reassign` on top of `reassign` must compose — there is a test
   for this.
6. `worktrail activity report --privacy` — prints the current retention
   window, the `activity_privacy` mode, and which files are versioned. One
   place where a user checks what the tool holds about them.
7. A section in the public README (EN): what is collected, where it lives,
   for how long, how to delete it. Content in English — public surface, see
   [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md).

## Acceptance criteria

- [ ] `prune` deletes only rows older than the window and does NOT touch the
      aggregates — there is a test for this.
- [ ] The aggregate is recomputed BEFORE deletion; a test checks that minutes
      from before the window do not disappear from the calibration.
- [ ] `forget --actor` deletes raw rows and recomputes aggregates; after it,
      the report does not reconstruct the actor's data.
- [ ] `forget --dry-run` touches nothing — a test compares file checksums
      before and after.
- [ ] `reassign` is an appended event, not an edit of existing rows — a test
      reads the file and checks that old rows are untouched.
- [ ] Two `reassign` events on the same session compose in deterministic
      order (by ULID).
- [ ] Minutes carry over completely after `reassign`: the per-task sum
      matches, nothing is lost and nothing is duplicated.
- [ ] `report --privacy` prints the retention window, the mode, and the list
      of versioned paths.
- [ ] The README (EN) describes the data collected, retention, and the
      deletion path.
- [ ] `qa/backlog-time-tracking.yaml` extended with retention, `forget`, and
      `reassign` cases.

## Verification

```bash
# 1. Retention and correction — expected: pass, including reassign on reassign
node --test backlog/scripts/tests/retention.test.mjs backlog/scripts/tests/reassign.test.mjs

# 2. forget --dry-run touches nothing — expected: identical checksums
find backlog/activity -name '*.jsonl' -exec shasum {} \; | sort > /tmp/before.txt
node backlog/scripts/cli.mjs activity forget --actor local:test --dry-run
find backlog/activity -name '*.jsonl' -exec shasum {} \; | sort > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo 'dry-run clean — OK'

# 3. The user sees what the tool holds about them — expected: window, mode, paths
node backlog/scripts/cli.mjs activity report --privacy

# 4. Module guards still green
node backlog/scripts/cli.mjs check
```

## Notes

- **This does not make the module GDPR-compliant "out of the box"**, and the
  README must not suggest that. It gives the deployer mechanisms
  (minimization, retention, deletion, correction); the legal basis, informing
  data subjects, and impact assessment remain with whoever deploys it.
- Deliberately out of scope: actor authentication (without it, `forget
  --actor` relies on a claim, not proof — the same limitation that
  [worktrail-state-and-sync.md §6.1](../../docs/worktrail-state-and-sync.md)
  names as the local-version boundary), log encryption, exporting a person's
  data.
- `--dry-run` on `forget` is required, not optional: this command deletes data
  with no trash bin.

## Log

- 2026-08-30 created — claude — from an adversarial review of the time-tracking project; three gaps (retention, deletion, attribution correction) blocking release of the module beyond a single machine
