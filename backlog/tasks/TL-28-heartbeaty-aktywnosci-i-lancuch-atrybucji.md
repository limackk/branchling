---
id: TL-28
title: "Activity heartbeats and the attribution chain"
type: code
labels: [post-launch]
board: main
epic: "Backlog — work time measurement"
priority: P2
status: done
owner: agent:claude
estimate: 1d
confidence: low
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-27]
blocks: [TL-29, TL-30, TL-31, TL-92]
related_docs:
  - docs/backlog-time-tracking.md
verification:
  - id: cluster-and-attribution
    bash: "node --test scripts/tests/cluster.test.mjs scripts/tests/attribution.test.mjs"
  - id: unknown-share
    bash: "node scripts/cli.mjs time --engaged --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d, 'report missing the unknown share'; print('unknown:', d['unknown_ratio'])\""
  - id: matcher-covers-bash
    bash: "python3 -c \"import json,sys; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; ms=[e.get('matcher','') for e in h]; assert any(m in ('','*') or 'Bash' in m for m in ms), f'activity adapter does not see Bash: {ms}'; print('matcher covers Bash — OK')\""
  - id: unknown-flag-fails
    bash: "node scripts/cli.mjs activity record --frobnicate 2>/dev/null; test $? -eq 2 && echo 'unknown flag fails — OK'"
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

Each criterion is on ONE line, and that is not formatting: the parser reads the
`- [ ]` line and nothing under it, so a `[proof:]` marker wrapped onto a second
line is invisible to it (TL-118). Wrapping them and linking them are mutually
exclusive until that is fixed, and a linked criterion is worth more than a
tidy one.

- [x] The hook matcher covers `Bash` and the rest of the tools, not only `Edit|Write|MultiEdit`. [proof: matcher-covers-bash, cluster-and-attribution]
- [x] Throttling works: N tool calls within one interval produce one row, not N. [proof: cluster-and-attribution]
- [x] A single-element cluster counts as 0 minutes and appears in the report as a separate figure. [proof: cluster-and-attribution]
- [x] A gap exactly equal to `idle_gap_minutes` has a decided and tested behavior. [proof: cluster-and-attribution]
- [x] Heartbeats out of chronological order give the same result as sorted ones. [proof: cluster-and-attribution]
- [x] A session without "closure" (no final heartbeat) does not produce infinite time. [proof: cluster-and-attribution]
- [x] Two parallel sessions on one task give a sum of effort ≠ calendar span; both figures are in the report. [proof: cluster-and-attribution]
- [x] Writing `status: in_progress` sets the session focus — there is a test for this. [proof: cluster-and-attribution]
- [x] Attribution does NOT read global `in_progress` state — there is a negative test: two tasks `in_progress` in two sessions do not mix. [proof: cluster-and-attribution]
- [x] The attribution chain has a test for EACH of the five legs. [proof: cluster-and-attribution]
- [x] `unknown_ratio` is always in the report, even when it is 0. [proof: unknown-share, cluster-and-attribution]
- [x] The `activity record` command works without Claude Code — a test calling the CLI alone. [proof: cluster-and-attribution]
- [x] An unknown flag fails instead of being silently ignored. [proof: unknown-flag-fails, cluster-and-attribution]
- [x] The hook does not trigger a loop and stays silent when there is no match. [proof: cluster-and-attribution]
- [ ] `qa/backlog-time-tracking.yaml` extended with clustering and attribution cases.

## Decision (2026-09-02)

**The contract was rewritten to this repository's paths, and the reason is
recorded here rather than done quietly.** The task was written in the repository
this tool was extracted from, and it names `backlog/scripts/` — the layout where
the code sat above the data. Here the code is in `scripts/` and the data in
`backlog/`, so every command in `verification:` addressed a file that does not
exist, and the contract could not be run at all. Nothing about its SUBSTANCE
changed: the four questions it asks are the ones it always asked, and the fifth
one (an unknown flag fails) was in the body's `## Verification` block and not in
the frontmatter, so it was promoted rather than invented. This is the same
correction TL-27 recorded for the same reason, and it is what TL-138 exists to
stop happening one task at a time.

**One criterion is left unticked on purpose.** `qa/backlog-time-tracking.yaml`
has no counterpart in this repository — the scenario directory did not come
across at extraction, and this repository keeps its evidence in `scripts/tests/`.
Inventing a file to tick a line would be the opposite of what the criterion is
for. TL-27 left the same criterion standing for the same reason.

**The session pointer lives OUTSIDE the repository, not in a gitignored file as
step 4 asks.** Two reasons, and both are the ones `lock.mjs` was moved for under
TL-87. Every worktree has its own checkout, so a pointer written into the
backlog would be a DIFFERENT file in each of them — "which task is this session
on" would then be answered per tree instead of per session, which is precisely
the global-state failure §8.1 disqualifies. And a raw activity log is somebody's
working calendar: keeping its pointer out of every repository this tool is
dropped into is a structural guarantee, where a `.gitignore` entry is a
procedure every future user has to maintain (§9).

**The branch leg now ignores case.** §8.1 records leg 4 as "does not fire at all
in this repository" because branches are named `tl-<number>-<slug>` while the
prefix is `TL`. That was written as an observation about naming; it is a defect
in the leg. An id is an id whichever case a branch spells it in, and the id
returned is always the canonical one from the configuration.

## Verification

```bash
# 1. Cluster math and attribution — expected: pass, including edge cases
node --test scripts/tests/cluster.test.mjs scripts/tests/attribution.test.mjs

# 2. The report ALWAYS gives the unknown share — expected: key present
node scripts/cli.mjs time --engaged --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert 'unknown_ratio' in d; print('unknown:', d['unknown_ratio'])"

# 3. Adapter sees Bash — expected: "matcher covers Bash — OK"
python3 -c "import json; h=json.load(open('.claude/settings.json'))['hooks']['PostToolUse']; \
  ms=[e.get('matcher','') for e in h]; \
  assert any(m in ('','*') or 'Bash' in m for m in ms), f'does not see Bash: {ms}'; print('matcher covers Bash — OK')"

# 4. An unknown flag fails instead of silently passing — expected: exit=2
node scripts/cli.mjs activity record --frobnicate 2>/dev/null; test $? -eq 2 && echo 'unknown flag fails — OK'

# 5. Core without a host — expected: row appended, exit code 0
node scripts/cli.mjs activity record --task TL-28 --kind tool --actor local:founder
tail -1 backlog/activity/TL-28.jsonl
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
