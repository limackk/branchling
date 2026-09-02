---
id: TL-28
title: "Activity heartbeats and the attribution chain"
type: code
labels: [post-launch]
board: main
epic: "Backlog — work time measurement"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-27]
blocks: [TL-29, TL-30, TL-31, TL-92]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - bash: "node --test backlog/scripts/tests/cluster.test.mjs backlog/scripts/tests/attribution.test.mjs"
  - bash: "node backlog/scripts/cli.mjs time --engaged --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d, 'report missing the unknown share'; print('unknown:', d['unknown_ratio'])\""
  - bash: "python3 -c \"import json,sys; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; ms=[e.get('matcher','') for e in h]; assert any(m in ('','*') or 'Bash' in m for m in ms), f'activity adapter does not see Bash: {ms}'; print('matcher covers Bash — OK')\""
---

## Goal

Start measuring **engaged time** — the real time spent working on a task,
with breaks cut out, attributed to the right task. Without this, estimate
calibration (TL-29) has no input, and that is the goal of the whole epic.

## Context

After TL-27 a data layer and completion timestamps exist, but there is still
**zero** information about how long the work took. The measurement in §2 of
the document showed that this number cannot be recovered from the past — it
has to start being collected.

Three decisions that have to be upheld, because all of them are
counterintuitive, and the last two only emerged from an adversarial review of
the design:

**Heartbeats, not start/stop pairs.** A pair loses a crash: a killed session,
a laptop put to sleep, `Ctrl-C` — the interval never closes and the task
reports infinite time. A heartbeat is complete the moment it is written; the
absence of the next one is information, not corruption.

**A heartbeat from EVERY tool, not a subset.** The existing backlog hook has
the matcher `Edit|Write|MultiEdit` (`.claude/settings.json`). If the activity
adapter took the same path, it would not see a single test run, build, git
command, read, or search. The result would not be a uniform underestimate,
but an underestimate **correlated with the kind of work**: a task spent
running tests would come out almost free, and a task spent writing files —
expensive. A correlated underestimate is worse than a uniform one, because it
looks like a signal and directly skews the calibration.

**Attribution is harder than measurement** and has to be automatic.
Attributing time to the wrong task looks identical to attributing it to the
right one. Measured limitations of the chain in this repository:

- the "file path" leg fires **twice per task** (take, close) — all the work
  happens in sub-repo files;
- the "branch regex" leg **does not fire at all** — branches are named
  `claude/task-<description>`, without a BL number;
- that leaves `focus`, and a manual `worktrail focus` at the start of a
  session is the same flaw that disqualifies `timetrace`: a mechanism
  dependent on someone remembering.

That is why the focus sets **itself** the moment the agent writes `status:
in_progress` — the hook already runs at that point and already writes it to
`history/`. **The scope has to be the SESSION, not global state:** globally
there are 45 tasks `in_progress`, 32 with `owner: claude`, so globally that
question has no single answer. Within a session it does, because one session
takes one task.

## Pre-flight reading

1. `docs/architecture/backlog-time-tracking.md` — §5.3 (why heartbeats), §6
   (clustering, three rules), §7 (why all tools + throttling), §8
   (attribution chain), §13 (what this does not measure).
2. `backlog/scripts/activity.mjs` — read/write from TL-27.
3. `backlog/scripts/regen-on-task-edit.sh` + `.claude/settings.json` — the
   existing hook and its matcher. The new adapter goes alongside it,
   following the same convention (silent when there is no match, no loop),
   but with a **wider** matcher.
4. `backlog/scripts/estimate.mjs` — `sumHours()` returning `{hours,
   unknown}`. The engaged-time report holds to the same contract.

## Steps

1. `backlog/scripts/cluster.mjs` — a PURE function over the heartbeat list →
   clusters and minutes. No disk access and no imports from outside the
   module (the same rigor as `estimate.mjs`, so it can be pasted into the
   viewer).
2. Three rules from §6, each with its own test: a single-element cluster = 0
   minutes and a separate figure in the report; a gap exactly at the
   threshold belongs to the previous cluster; parallel sessions sum up
   (effort) and separately give a calendar span.
3. `backlog/scripts/attribution.mjs` — the five-leg chain from §8, returning
   `{task, attribution}`: `focus` → `session-state` → `path` → `branch` →
   `unknown`. It never returns a task without saying which leg established
   it.
4. `worktrail focus BL-NNNN` / `--clear` — a session pointer in a local file
   (gitignored) + reading `BACKLOG_TASK` from the environment.
5. **Auto-focus:** writing `status: in_progress` through the hook sets the
   focus of THAT session. Decide and test what happens when one session
   takes a second task — the latest one wins, and the previous one stays in
   the log with its own rows (we do not rewrite backward).
6. Adapter `backlog/scripts/activity-hook.sh` (PostToolUse) — emits `kind:
   tool`. **The matcher covers all tools**, not `Edit|Write|MultiEdit`.
7. **Throttling is mandatory** — at most one heartbeat per
   `heartbeat_throttle_seconds` (default 60) per session. Without it the log
   grows linearly with the agent's chattiness, and the clustering threshold
   limits the resolution anyway.
8. `worktrail activity record` — a CLI accepting flags/stdin, so that any
   other host (a git hook, Cursor, WakaTime, a shell prompt) can feed the
   same log. The core must not depend on Claude Code.
9. `worktrail time --engaged` — minutes per task, per period, plus the
   **`unknown` share as a first-class field** and the count of
   single-element clusters (this is what will settle the assumption in §14
   point 4).

## Acceptance criteria

- [ ] The hook matcher covers `Bash` (and the rest of the tools), not only
      `Edit|Write|MultiEdit` — there is a gate for this in Verification.
- [ ] Throttling works: N tool calls within one interval produce one row,
      not N.
- [ ] A single-element cluster counts as 0 minutes and appears in the report
      as a separate figure.
- [ ] A gap exactly equal to `idle_gap_minutes` has a decided and tested
      behavior.
- [ ] Heartbeats out of chronological order give the same result as sorted
      ones.
- [ ] A session without "closure" (no final heartbeat) does not produce
      infinite time.
- [ ] Two parallel sessions on one task give a sum of effort ≠ calendar
      span; both figures are in the report.
- [ ] Writing `status: in_progress` sets the session focus — there is a test
      for this.
- [ ] Attribution does NOT read global `in_progress` state (45 tasks) —
      there is a negative test for this: two tasks `in_progress` in two
      sessions do not mix.
- [ ] The attribution chain has a test for EACH of the five legs.
- [ ] `unknown_ratio` is always in the report, even when it is 0.
- [ ] `worktrail activity record` works without Claude Code (a test calling
      the CLI alone).
- [ ] The hook does not trigger a loop and stays silent when there is no
      match.
- [ ] `qa/backlog-time-tracking.yaml` extended with clustering and
      attribution cases.

## Verification

```bash
# 1. Cluster math and attribution — expected: pass, including edge cases
node --test backlog/scripts/tests/cluster.test.mjs backlog/scripts/tests/attribution.test.mjs

# 2. Adapter sees Bash — expected: "matcher covers Bash — OK"
python3 -c "import json; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; \
  ms=[e.get('matcher','') for e in h]; \
  assert any(m in ('','*') or 'Bash' in m for m in ms), f'does not see Bash: {ms}'; print('matcher covers Bash — OK')"

# 3. Core without a host — expected: row appended, exit code 0
node backlog/scripts/cli.mjs activity record --task TL-28 --kind tool --actor local:founder
tail -1 backlog/activity/TL-28.jsonl

# 4. The report ALWAYS gives the unknown share — expected: key present
node backlog/scripts/cli.mjs time --engaged --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d; print('unknown:', d['unknown_ratio'])"

# 5. An unknown flag fails instead of silently passing — expected: exit=2
node backlog/scripts/cli.mjs activity record --frobnicate 2>/dev/null; test $? -eq 2 && echo 'unknown flag fails — OK'
```

## Notes

- The 10-minute threshold comes from WakaTime practice, not from a
  measurement on this data — it is the least justified number in the design
  (§14 point 3). After a few weeks of collecting data it has to be tuned from
  the distribution of gaps, and the result recorded in the document.
- If after the first month `unknown_ratio` exceeds ~30%, the attribution
  chain is at fault, not the data (§14 point 2).
- 60-second throttling can lose very short sessions (single-element cluster
  = 0 minutes). The count of such clusters is reported precisely so that
  this can be settled with data, not opinion (§14 point 4).
- Deliberately out of scope: tokens (TL-30), calibration (TL-29), retention
  and `reassign` (TL-31). **TL-31 must not fall behind by more than one
  iteration** — this task is where personal data starts being produced.

## Log

- 2026-08-30 created — claude — written up from the time-tracking analysis
  (docs/architecture/backlog-time-tracking.md)
- 2026-08-30 revised — claude — after adversarial review: matcher on all
  tools (underestimate correlated with the kind of work), auto-focus on
  `in_progress` scoped to the session (45 global `in_progress` tasks make
  global state useless), throttling changed from optional to required
