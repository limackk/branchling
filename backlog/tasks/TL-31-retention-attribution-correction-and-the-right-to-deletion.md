---
id: TL-31
title: "Retention, attribution correction, and the right to deletion"
type: task
labels: [post-launch]
board: main
epic: "Backlog — time tracking"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-28]
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - origin#docs/architecture/legal-and-compliance.md
verification:
  - id: retention-and-correction
    bash: "node --test scripts/tests/retention.test.mjs scripts/tests/reassign.test.mjs"
  - id: dry-run-is-dry
    bash: "find backlog/activity -name '*.jsonl' | sort | xargs shasum > /tmp/wt-before.txt; node scripts/cli.mjs activity forget --actor local:test --dry-run >/dev/null; find backlog/activity -name '*.jsonl' | sort | xargs shasum > /tmp/wt-after.txt; diff /tmp/wt-before.txt /tmp/wt-after.txt && echo 'dry-run clean — OK'"
  - id: privacy-report
    bash: "node scripts/cli.mjs activity report --privacy | grep -q 'activity_retention_days' && echo 'the window is on the report — OK'"
  - id: guards
    bash: "node scripts/cli.mjs check"
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

1. `docs/backlog-time-tracking.md` — §9 (privacy, retention,
   correction), §5 (row shape, `kind: reassign`), §13 (what this mechanism is
   NOT).
2. `docs/license-and-contributions.md` §3 — the open/hosted line. There is no
   `legal-and-compliance.md` in this repository; it stayed in the workspace this
   tool was extracted from.
3. `scripts/activity.mjs` (TL-27) and `scripts/attribution.mjs` (TL-28).
4. `scripts/config.mjs` — `activity_retention_days` and
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
   [TL-20](TL-20-close-the-tool-s-name-before-open-source-publication.md).

## Acceptance criteria

One line each, because the parser reads the `- [ ]` line and nothing under it
(TL-118), so a wrapped `[proof:]` marker is invisible to it.

- [x] `prune` deletes only rows older than the window and does NOT touch the aggregates. [proof: retention-and-correction]
- [x] The aggregate is recomputed BEFORE deletion; minutes from before the window do not disappear from the calibration. [proof: retention-and-correction]
- [x] `forget --actor` deletes raw rows and recomputes aggregates; afterwards the report does not reconstruct the actor's data. [proof: retention-and-correction]
- [x] `forget --dry-run` touches nothing — the activity files' bytes are identical before and after. [proof: dry-run-is-dry, retention-and-correction]
- [x] `reassign` is an appended event, not an edit — the old rows are untouched on disk. [proof: retention-and-correction]
- [x] Two `reassign` events on the same session compose in deterministic order, by ULID. [proof: retention-and-correction]
- [x] Minutes carry over completely after `reassign`: nothing is lost and nothing is duplicated. [proof: retention-and-correction]
- [x] `report --privacy` prints the retention window, the mode, and the list of versioned paths. [proof: privacy-report, retention-and-correction]
- [x] The README describes the data collected, the retention, and the deletion path. [proof: retention-and-correction]
- [x] The guards still pass over the whole backlog and the whole source. [proof: guards]
- [ ] `qa/backlog-time-tracking.yaml` extended with retention, `forget`, and `reassign` cases.

## Decision (2026-09-02)

**The contract was rewritten to this repository's paths.** It named
`backlog/scripts/` and `docs/architecture/`, the layout of the repository this
tool was extracted from, so not one command in it addressed a file that exists.
Nothing about the SUBSTANCE changed: the four checks it asks for are the ones it
always asked for, and two that stood only in the body's prose — the privacy
report actually printing the window, and the guards still passing — were
promoted into the frontmatter rather than invented. Same correction TL-27 and
TL-28 recorded; TL-138 is what stops it happening one task at a time.

**`qa/backlog-time-tracking.yaml` is left unticked, again.** The scenario
directory did not come across at extraction; this repository keeps its evidence
in `scripts/tests/`, and inventing a file to tick a line is the opposite of what
the criterion is for.

**`prune` and `forget` differ by ONE line, and that line is the whole
semantics.** `prune` recomputes the aggregates BEFORE deleting, `forget`
recomputes them AFTER. Expiry keeps the summary, because time passing does not
revoke anything and the summary is the entire input to estimate calibration;
erasure does not, because an aggregate left standing over deleted rows is the
data coming back at the next report. Both directions have a test, and the
`prune` one asserts the surviving MINUTES rather than the surviving files —
recomputing after the delete would have halved the history while every file
count stayed right.

**A `reassign` row written by the erased actor survives `forget`.** It is a
statement about somebody else's rows; dropping it would silently un-correct an
attribution that person fixed, restoring a claim about them in the very act of
erasing them.

**`--session` is REQUIRED on `reassign`, and that is a refusal rather than a
default.** Without it the correction would move every row ever recorded on the
task, which is a merge and not a correction. The command fails instead of
guessing the scope of somebody's mistake.

**`--since` deliberately does not conserve minutes, and the test says so.**
Splitting one run in two loses the gap that spanned the split, because after the
split no cluster contains both sides of it. Asserting equality there would be
asserting a lie; what the test holds to is that nothing is DUPLICATED.

**Two things the task listed that are not commands.** `prune` at viewer startup
is wired into `serve-backlog.mjs` beside the view rebuild, silently and best
effort — a retention window somebody has to remember to apply is a paragraph in
a document, not a mechanism. And `HEARTBEAT_KINDS` moved into `activity.mjs`:
three readers need it, and two of them disagreeing would mean the terminal and
the committed aggregate reporting different numbers for the same task.

## Verification

```bash
# 1. Retention and correction — expected: pass, including reassign on reassign
node --test scripts/tests/retention.test.mjs scripts/tests/reassign.test.mjs

# 2. forget --dry-run touches nothing — expected: identical checksums
# (no `-exec … \;` — a backslash in a YAML double-quoted scalar reaches the
# shell verbatim here, so the contract in the frontmatter uses xargs instead.)
find backlog/activity -name '*.jsonl' | sort | xargs shasum > /tmp/wt-before.txt
node scripts/cli.mjs activity forget --actor local:test --dry-run
find backlog/activity -name '*.jsonl' | sort | xargs shasum > /tmp/wt-after.txt
diff /tmp/wt-before.txt /tmp/wt-after.txt && echo 'dry-run clean — OK'

# 3. The user sees what the tool holds about them — expected: window, mode, paths
node scripts/cli.mjs activity report --privacy

# 4. Module guards still green
node scripts/cli.mjs check
```

## Notes

- **This does not make the module GDPR-compliant "out of the box"**, and the
  README must not suggest that. It gives the deployer mechanisms
  (minimization, retention, deletion, correction); the legal basis, informing
  data subjects, and impact assessment remain with whoever deploys it.
- Deliberately out of scope: actor authentication (without it, `forget
  --actor` relies on a claim, not proof — the same limitation that
  [worktrail-state-and-sync.md §6.1](../../docs/branchling-state-and-sync.md)
  names as the local-version boundary), log encryption, exporting a person's
  data.
- `--dry-run` on `forget` is required, not optional: this command deletes data
  with no trash bin.

## Log

- 2026-08-30 created — claude — from an adversarial review of the time-tracking project; three gaps (retention, deletion, attribution correction) blocking release of the module beyond a single machine
