---
id: TL-27
title: "Work time measurement — foundation and an honest point zero"
type: code
labels: [post-launch]
board: main
epic: "Backlog — work time measurement"
priority: P2
status: done
owner: agent:session
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-09-02
blocked_by: []
blocks: [TL-28, TL-31]
related_docs:
  - docs/backlog-time-tracking.md
verification:                      # paths corrected to THIS repository: see Decision
  - id: unit-tests
    bash: "node --test scripts/tests/activity.test.mjs"
  - id: stamps-recovered
    bash: "node scripts/cli.mjs backfill-completions && node scripts/cli.mjs time --json | node -e \"let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const d=JSON.parse(s);if(!(d.completed>0))throw new Error('no completion stamps: '+s);if(d.unstamped.length)throw new Error('closed tasks with no stamp: '+d.unstamped.join(','));console.log('stamped:',d.completed)})\""
  - id: idempotent
    bash: "node scripts/cli.mjs backfill-completions --dry-run | grep -q 'would stamp 0 of' && echo 'a second pass writes nothing — OK'"
  - id: privacy-both-ways
    bash: "git check-ignore -q backlog/activity/TL-27.jsonl && ! git check-ignore -q backlog/activity/rollup/TL-27.json && echo 'raw log out of git, rollup in it — OK'"
---

## Goal

Put in place the data layer for work time measurement (`backlog/activity/`) and close off the only part of history that can be reconstructed honestly: the **moment of completion** of tasks. After this task, `worktrail time` answers questions about throughput across 1023 closed tasks, and the foundation for engaged time (TL-28) stands.

## Context

The backlog has 1016 `done` tasks with an estimate recorded and **zero** numbers saying how long that work actually took. Estimates are unverifiable.

A measurement done on 2026-08-30, before the design (full table: [`backlog-time-tracking.md §2`](../../docs/backlog-time-tracking.md)), disproved three "obvious" sources of historical data:

- the field-change log (`history/*.jsonl`) started on 2026-08-30 — 9 tasks, 13 entries, **1** with an `in_progress`+`done` pair;
- frontmatter `created`→`updated` has day-level resolution, and **71% of tasks** finish on the same day they were created — zero for 7 out of 10;
- the commit span on a task file is contaminated by mass field backfills (median 722 h against 71% "same day" — two orders of magnitude of divergence, so neither of the two measures the work).

What the measurement CONFIRMED: `git log -S"status: done"` hits **20/20** at second-level resolution, ~60 s for the whole directory. But `-S"status: in_progress"` hits only **3/20** — the agent usually commits `pending → done` in one move, so the intermediate state never existed.

Hence this task's boundary, and it is deliberate: **we backfill the completion stamp, we do NOT backfill work time.** Work time from before day zero does not exist, and inferring it would be the same class of a nice-sounding lie for which [`backlog-field-editing-history.md §6`](../../docs/backlog-field-editing-history.md) rejected backfilling authorship from git.

## Decision (2026-09-02)

**The contract was rewritten to this repository's paths, and the reason is
recorded here rather than done quietly.** The task was written in the repository
this tool was extracted from: it names `backlog/scripts/`, `docs/architecture/`
and `qa/`, none of which exist here, and asserts `completed > 900` against a
backlog of 1023 closed tasks. This one holds 83. Every one of those numbers and
paths was corrected; nothing about the SUBSTANCE of the contract changed — the
four questions it asks (do the unit tests pass, are the stamps recovered, is a
second pass idempotent, is the raw log out of git while the rollup is in it) are
the ones it always asked.

Two acceptance criteria named files that do not exist in this repository and
were not created to satisfy a checkbox: `docs/architecture/backlog-time-tracking.md`
is `docs/backlog-time-tracking.md` here, and it gained a §12 saying what is
implemented; `qa/backlog-time-tracking.yaml` has no counterpart — this repository
keeps its evidence in `scripts/tests/`, and inventing a directory to tick a line
would be the opposite of what the criterion is for.

**A measurement of this repository, recorded because it is uncomfortable.** The
git history was flattened to one commit at extraction (`LINEAGE.md`), so for
every task closed before that commit the pickaxe finds the flattening rather
than the work — here, all 83 stamps land in one week. The stamps are truthful
about the files and misleading about the calendar, and the tool cannot tell the
difference. It is written into §12 of the document instead of being left for
somebody to discover in a chart.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §2 (measurement), §4 (data model), §7 (privacy). Without §2, this task's scope looks artificially trimmed.
2. `backlog/scripts/history.mjs` — `eventId()`, `appendEntries()`, `readHistory()` with dedup by `id`. The new module should repeat these patterns, not invent its own.
3. `backlog/scripts/estimate.mjs` — the "`null`, never zero" contract and `sumHours()` returning `{hours, unknown}`. This is the reporting pattern `worktrail time` follows.
4. `backlog/scripts/cli.mjs` — the `COMMANDS` table, how a subcommand is added.
5. `backlog/.gitignore` — where and how local artifacts are excluded.

## Steps

1. `backlog/scripts/activity.mjs` — write/read `backlog/activity/BL-NNNN.jsonl`: `appendActivity()`, `readActivity()` (dedup by `id`, a corrupted row does not wipe out the rest), `activityPath()`. ULID and actor namespaces imported from `history.mjs`, not copied.
2. Row shape from §4 of the document: `{id, ts, task, kind, actor, source, session, attribution}`. `kind` ∈ `tool|prompt|commit|edit` — unknown fails.
3. `backlog/scripts/backfill-completions.mjs` — a single pass of `git log --format --name-only` over the directory + pickaxe `-S"status: done"` per `done` task. Writes `kind: "commit"`, `source: "git-backfill"`, `attribution: "path"`. **Writes nothing about duration.**
4. Idempotency guard: a repeated backfill does not add a second stamp (dedup by `id` is not enough — the ULID is random; the key is `(task, kind=commit, ts)`). The `--dry-run` flag prints how many rows it WOULD have appended, and does not touch any files — this is the gate that Verification checks.
5. `backlog/scripts/time-report.mjs` + a `time` subcommand in `cli.mjs`: lead time (median/p80/p95), throughput per week, count of tasks WITHOUT a stamp. The last number is mandatory — a total without it pretends to be complete.
6. `backlog/.gitignore`: `activity/*.jsonl` (raw stamps stay local). The `activity/rollup/` directory stays **versioned** — the aggregate is PER TASK (`rollup/BL-NNNN.json`), never one combined file, because a combined file would be a second `INDEX.yaml` (the reasoning is measured, comment in the same `.gitignore`).
7. `config.yaml` — the full set of epic keys added at once, because an unknown key FAILS and splitting this across four tasks would mean four schema changes: `activity_privacy: local`, `idle_gap_minutes: 10`, `heartbeat_throttle_seconds: 60`, `min_report_n: 8`, `activity_retention_days: 90`. They are only used starting with TL-28/1426/1429.
8. Tests `backlog/scripts/tests/activity.test.mjs` — red-first, test author ≠ code author.

## Acceptance criteria

- [ ] `node backlog/scripts/cli.mjs time` prints lead time and throughput on the real backlog.
- [ ] The report states the count of `done` tasks WITHOUT a completion stamp (does not silently omit them).
- [ ] Backfill run twice in a row yields the same state (idempotency) — there is a test for this.
- [ ] `activity/*.jsonl` is gitignored, and `activity/rollup/` is NOT; `git check-ignore` confirms both directions.
- [ ] An unknown `kind` fails the write instead of landing in the file.
- [ ] A corrupted JSONL row does not break the read — there is a test for this.
- [ ] The new field in `config.yaml` does not fail `config.mjs` (an unknown key fails — it has to be ADDED to the schema).
- [ ] `docs/architecture/backlog-time-tracking.md` §10 updated with the "implemented" status.
- [ ] `qa/backlog-time-tracking.yaml` created.

## Verification

```bash
# 1. Unit tests — expected: all pass
node --test backlog/scripts/tests/activity.test.mjs

# 2. Backfill + report — expected: >900 tasks with a stamp (1023 done, some predating the convention)
node backlog/scripts/backfill-completions.mjs
node backlog/scripts/cli.mjs time

# 3. Idempotency — expected: second number identical to the first
node backlog/scripts/backfill-completions.mjs --dry-run | tail -1

# 4. Privacy — expected: raw data outside git, aggregate IN git
git check-ignore -q backlog/activity/TL-27.jsonl && echo 'raw log: outside git — OK'
git check-ignore -q backlog/activity/rollup/TL-27.json || echo 'aggregate: versioned — OK'

# 5. Module guards still green
node backlog/scripts/cli.mjs check
```

## Notes

- Deliberately out of scope: heartbeats (TL-28), calibration (TL-29), tokens (TL-30), retention and attribution correction (TL-31).
- Backfilling `in_progress` is NOT done — 15% coverage and a spread of 0.2 h ÷ 554 h make it noise pretending to be data.
- `min_report_n` and `idle_gap_minutes` land in the configuration here already, so TL-28 does not have to touch the config schema while implementing clustering logic.

## Log

- 2026-08-30 created — claude — drafted from the time-measurement analysis (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — after an adversarial review: aggregate per task instead of a combined `rollup.json`, the full set of config keys in one place, `--dry-run` spelled out in the steps (the gate called for it, the spec had not ordered it)
