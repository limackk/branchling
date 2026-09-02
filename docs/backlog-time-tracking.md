# Backlog — measuring time spent on a task

**Status:** PROJECT (2026-08-30, revised 2026-08-30 after adversarial review) — none of this is implemented
**Concerns:** `backlog/` as the future `worktrail` tool ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md))
**Predecessors:** [backlog-field-editing-history.md](backlog-field-editing-history.md) (the field change log), [worktrail-state-and-sync.md](worktrail-state-and-sync.md) (the event log as SSOT), [backlog-config-and-portability.md](backlog-config-and-portability.md) (code knows the shape, configuration knows the values)
**Tasks:** [TL-27](../backlog/tasks/TL-27-pomiar-czasu-fundament-i-uczciwy-punkt-zero.md) · [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md) · [TL-29](../backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md) · [TL-30](../backlog/tasks/TL-30-adapter-tokenow-i-kosztu-sesji.md) · [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md)

---

## 1. The question

The backlog has 1387 tasks, of which 1026 are `done`, and **1019 of those carry
an estimate**. There is not a single number saying how long that work actually
took. Estimates are therefore unverifiable today: `confidence: medium` means
"that's what I thought" and, a year later, means exactly the same thing.

Goal: **collect the AI agent's working time on a task well enough to calibrate
estimates against it** — and do it in a module that goes open source, so over
other people's repositories and other people's people.

## 2. Measurement — why there is no shortcut here

All numbers measured on this repository on 2026-08-30, before a single line of
the module was written. This section exists because three "obvious" sources of
historical data look sufficient until they are actually counted.

| Source hypothesis | Measured result | Verdict |
|---|---|---|
| The field change log (`history/*.jsonl`) already has this | **9 tasks, 13 entries, 1** with an `in_progress` + `done` pair | The log started on 2026-08-30. Coverage ≈ 0.1% |
| Frontmatter `created` → `updated` | 1016 tasks parseable, median **0 days**, **71% completed the same day** | Day-level resolution. Zero for 7 out of 10 tasks |
| Git — the commit span on a task file | median **722 h**, against 71% "same day" in the frontmatter | Contaminated by mass field backfills (`board:` touched 1390 files in one day) |
| Git pickaxe on `-S"status: done"` | **20/20** hits, exactly 1 commit, second-level resolution, ~60 s for 1023 tasks | ✅ The moment of COMPLETION is recoverable |
| Git pickaxe on `-S"status: in_progress"` | **3/20** (15%); values 0.2 h / 142 h / 554 h | The moment of START does not exist in the data |

The last two rows settle the project. An agent usually writes `pending → done`
in a single commit, so **the intermediate state was never produced** — it was
not "lost", it simply never existed. And where it did exist, a spread of
0.2 h to 554 h shows it was calendar time regardless, not effort.

> **A conclusion that changes the plan: history from before day zero does not
> exist and cannot be inferred.** *When* a task finished can be recovered (git,
> exactly); *how long* it took cannot. Any backfill of "time worked" would be a
> pretty untruth — exactly the class that [backlog-field-editing-history.md §6](backlog-field-editing-history.md)
> rejected backfilling authorship from git for.
>
> The distinction kept from here on: **the completion stamp is backfilled**
> (git is evidence), **time worked is not** (git is not evidence).

## 3. What we are actually measuring

"Implementation time" is four different quantities. Mixing them into one
number is the most common mistake in this class of tool.

| Quantity | Definition | Source | Good for |
|---|---|---|---|
| **lead time** | `created` → `done` | git (backfill) + log | queue throughput |
| **cycle time** | `in_progress` → `done` | the event log, from day zero | ⚠️ **worthless** in this repository, see §3.1 |
| **engaged time** | sum of real work sessions, gaps cut out | heartbeats (§6–§7) | **estimation** |
| **cost** | tokens, tool calls, model | host adapter (§10) | budget, immune to model speed |

### 3.1. Cycle time is a trap metric here

At the time of writing **45 tasks are simultaneously `status: in_progress`, 32
of them with `owner: claude`.** That does not mean 32 agents are working at
once — `in_progress` in this repository is a **parking** state: a task stays
in it when a session ends, when work is waiting on a decision, when something
was set aside.

Cycle time computed from such a state therefore measures parking, not work,
and grows worse the poorer the backlog's hygiene is. **We report it only as a
measure of queue hygiene (how long a task sits in progress), never as a
measure of effort.** This is the same trap as "number of open tickets"
posing as team workload.

### 3.2. Why engaged time anyway, and not tokens alone

An AI agent's clock depends on the model, on how many times a human
interrupted the session, and on whether two agents worked in parallel.
Tokens are more stable, but they don't convert to human-hours — and
`estimate:` in the frontmatter **is in human-hours**, so calibration has to
be in the same unit.

We therefore collect both, report engaged time by default, and treat whether
this unit holds up at all as an explicit assumption to be falsified (§14
point 1).

## 4. Why not an off-the-shelf tool

The question the first external user will ask. The answer is not "because we
want our own".

| Tool | What it does well | Why it isn't enough |
|---|---|---|
| **WakaTime / Wakapi** | mature heartbeat model, editor plugins, self-hosted (Wakapi) | measures **file and language**, not **task**. Has no notion of "TL-27", so it cannot calibrate estimates — which is the whole point |
| **ActivityWatch** | whole-desktop measurement, local privacy | application/window granularity; needs a daemon on the user's machine; overkill for "how long did this task take" |
| **timetrace / watson / timewarrior** | simple CLI, tags, zero infrastructure | **manual start/stop**. A human remembers or doesn't; nobody reminds an AI agent, and an unstarted timer gives silence indistinguishable from zero |
| **git-time-metric** | zero configuration, reads commits | infers time from gaps between commits. Our measurement (§2) shows commit gaps here are contaminated by mass backfills — median 722 h against 71% "same day" work |
| **Jira / Linear cycle time** | ready-made flow reports | measures status transitions, i.e. exactly the quantity §3.1 just disqualified; also requires giving up files in git as SSOT |

Common denominator: **existing tools measure either activity without a task,
or a task without activity.** The missing piece is attributing activity to a
task (§8) — and that is the only thing this module has to build itself. The
rest (heartbeat clustering, an idle threshold) is a deliberately borrowed
model from WakaTime, not an invention.

Practical consequence: `worktrail activity record` is an **open input** (§7).
Whoever already has WakaTime can feed this log from it, instead of writing a
second collector.

## 5. Data model

```
<data>/activity/<project>/BL-NNNN.jsonl  ← heartbeats, append-only, OUTSIDE every repository
backlog/activity/rollup/BL-NNNN.json     ← aggregate PER TASK, versioned (§9)
backlog/history/BL-NNNN.jsonl            ← unchanged: field changes, versioned
```

> **The raw log moved out of the repository in TL-35 (2026-09-02).** It used to
> be `backlog/activity/*.jsonl`, protected by a `.gitignore` rule — which holds
> exactly until one `git add -A` in somebody else's tree writes a person's work
> calendar into a public history it cannot be taken out of. In the data
> directory that failure is IMPOSSIBLE rather than discouraged, and protection
> stops depending on a correct `.gitignore` in every repository this tool ever
> reaches. **The `rollup/` aggregate stays in the repository, unchanged.**
> `<project>` is `<slug>-<hash of the backlog path>` — keyed by the PATH and
> never by the registry label, because a label is the user's own and mutable,
> and a rename must not orphan somebody's log. Reasoning:
> [worktrail-global-tool.md §6](worktrail-global-tool.md).
>
> The `.gitignore` rule stays as a safety net for logs written before the move;
> `worktrail activity migrate` relocates those, idempotently.

One row = one piece of evidence of activity:

```json
{"id":"01M18TSCBMECG6E6D42E6AE0J6","ts":"2026-08-30T09:14:42.326Z","task":"TL-27",
 "kind":"tool","actor":"agent:claude","source":"hook","session":"85bcc80f","attribution":"focus"}
```

- `id` — a ULID, the same function as in `history.mjs`: lexicographic
  ordering equals time ordering, so it is a ready-made sync cursor.
- `kind` — `tool` | `prompt` | `commit` | `edit` | `reassign`. The class of
  evidence, not a weight.
- `session` — the host's session identifier. Without it, two agents working
  in parallel on one task blur into one session and time is counted once
  instead of twice. It is also the **attribution scope key** (§8).
- `attribution` — **which leg of the chain (§8) settled the task.** This is
  metadata about the row's reliability, exactly like `source` next to the
  author in the field change log.

### 5.1. Why a separate file, not `history/`

`history/` is the semantic "who changed what" log and the viewer renders it
next to fields. Heartbeats run into the thousands per task. Dropping them in
there would flood the UI and slow down `readHistory()`. Same discipline
(ULID, actor namespaces, append-only, dedup by `id`), a different file.

### 5.2. Why an aggregate PER TASK, not one `rollup.json`

Because a single collective file would be a second `INDEX.yaml` — and this
module already paid for that once. `backlog/.gitignore` carries the measured
reasoning: an aggregate of all tasks means **every branch rewrites the same
file**, `git merge-tree` on two branches **with not a single task in common**
produced a conflict, and 78% of commits touching `tasks/` also touched views.

The time aggregate has exactly the same profile: it grows with every task,
changes with every session, and merges badly. `activity/rollup/BL-NNNN.json`
means a branch touches only the files of its own tasks — a conflict is then a
real conflict, not a side effect of aggregation.

### 5.3. Why heartbeats, not start/stop pairs

A pair loses the failure case: a session killed, a laptop put to sleep,
`Ctrl-C` — the interval never closes and the task reports infinite time. A
heartbeat is **complete at the moment it is written**; the absence of the
next one is information, not damage.

### 5.4. Concurrent writes

`history.mjs` uses `appendFileSync`. For rows of this size (~200 B), POSIX
guarantees the atomicity of an append below `PIPE_BUF`, so parallel sessions
won't interleave their lines — but **this guarantee is limited and has to be
named**, because it does not hold in this form on Windows. Hence the
requirement that the reader survive a corrupt row (skip it and keep counting)
instead of assuming corruption never happens.

## 6. From heartbeats to minutes

We **do not record** time — we derive it, the same way `INDEX.yaml` is
derived from tasks, and `estimateHours()` from the estimate text.

```
cluster  := the longest run of heartbeats in the same session,
            where neighbours are less than idle_gap apart (10 min default)
minutes  := Σ (last(cluster) − first(cluster))
```

Three rules that must have tests, because each of them is a place where a
counter of this kind quietly lies:

1. **A single-heartbeat cluster counts as 0** and is reported separately as a
   count. We do not tack on a "nominal 5 minutes" — that would be invention
   proportional to how fine-grained the work was.
2. **A gap exactly at the threshold** belongs to the previous cluster (`<`
   vs `≤` settled explicitly, not by accident).
3. **Parallel sessions sum.** Two agents × 30 min is 60 minutes of effort and
   30 minutes of calendar time. The report shows both numbers, because they
   answer two different questions.

The thresholds (`idle_gap_minutes`, `min_session_minutes`) go into
`config.yaml` — code knows the shape, configuration knows the values.

## 7. Where heartbeats come from — and why from EVERY tool

The core is `worktrail activity record --task BL-N --kind tool` — an ordinary
CLI reading flags and stdin. Adapters are thin plugins on top of it: a Claude
Code hook, a git hook, WakaTime, a shell prompt. **The core must not require
any of them**, because the module has to work over someone else's process.

One decision that looks like a detail but is a condition for the data making
sense at all:

> **A heartbeat must fire on every tool invocation, not on a subset.**

The existing backlog hook has an `Edit|Write|MultiEdit` matcher
(`.claude/settings.json`). If the activity adapter followed the same path,
**it would see not a single test run, build, git command, read or search.**
The result would not be a uniform undercount — it would be an undercount
**correlated with the kind of work**: a task spent running tests would come
out nearly free, and a task spent writing files expensive. A correlated
undercount is worse than a uniform one, because it looks like signal and
directly skews calibration (§11).

Hence: a matcher covering all tools + **throttling** (no more than one
heartbeat per `heartbeat_throttle_seconds`, 60 by default, per session).
Throttling is mandatory here, not an optimisation — without it the log grows
linearly with the agent's chattiness, and resolution is bounded anyway by the
clustering threshold from §6.

## 8. Attribution — the priority chain and an honest `unknown`

The hardest question is not "how much" but **"on what"**. This is where such
systems lie most often, because attribution to the wrong task looks identical
to attribution to the right one.

Order, first match wins:

| # | Leg | `attribution` | Note |
|---|---|---|---|
| 1 | `worktrail focus BL-NNNN` — an explicit session marker, or `BACKLOG_TASK` in the environment | `focus` | also set AUTOMATICALLY — §8.1 |
| 2 | the most recent transition to `status: in_progress` in this **session** by this actor | `session-state` | §8.1 |
| 3 | the edited file's path, when it is `backlog/tasks/BL-NNNN-*.md` | `path` | |
| 4 | a regex on the branch/worktree name (`task_id_pattern` from configuration) | `branch` | |
| 5 | **`unknown`** | `unknown` | recorded, not guessed |

### 8.1. Why legs 1 and 2 must be automatic

Without this the chain does not work — and this is measured, not predicted:

- **Leg 3 fires twice per task.** It only triggers on editing
  `backlog/tasks/BL-*.md`, i.e. on taking and on closing. All the real work
  happens in sub-repo files this leg cannot see.
- **Leg 4 does not fire at all in this repository.** Branches are named
  `claude/task-<description>`, without a BL number. It remains useful for
  other repositories, where the convention may differ.

That leaves leg 1 — and a manual `worktrail focus` at the start of every
session is exactly the same failure that disqualifies `timetrace` (§4): a
mechanism that depends on someone remembering.

Solution: **the agent already declares what it is working on.** The protocol
requires it, on taking a task, to set `status: in_progress` + `owner:`, and
the hook already captures this and writes it to `history/`. This is a free,
existing `focus` signal — it only needs the `in_progress` write to also set
the session's focus.

**Critical condition: the scope is the SESSION, never global state.**
Globally, right now, `in_progress` covers 45 tasks, 32 with `owner: claude` —
the question "which task is in progress" has no single answer globally and
never will. It has an unambiguous answer within one session, because one
session takes one task (one session = one worktree). The same number that
breaks cycle time (§3.1) would break attribution — if counted globally.

### 8.2. `unknown` is a number, not a failure

**The `unknown` share is a first-class number in every report.** If 60% of
measured time is unattributed, the metric is not trustworthy and the report
has to say so, instead of showing a pretty sum. The same principle as
`estimateHours()` returning `null` instead of zero, and `sumHours()`
returning `{hours, unknown}`.

## 9. Privacy, retention and correction — the condition without which this cannot go open source

An activity log is a record of **what hour a specific person worked**, day
after day. In a public repository that is surveillance metadata, not project
telemetry. In a company repo it is employee data, and in the EU — personal
data with everything that entails.

Three mechanisms, all in [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md):

**Minimisation.** Raw stamps stay on the machine that produced them, and since
TL-35 they do so **structurally**: they live in the user's data directory,
outside any repository, so no `.gitignore` in anybody's tree has to be correct
for the guarantee to hold. The gitignore rule remains only as a safety net for
logs written before the move. Only the per-task aggregate (§5.2) is versioned:
`minutes`, `sessions`, `first`, `last`, `unknown_ratio`. That is enough for
calibration and does not reconstruct anyone's calendar.
`activity_privacy: local | aggregate | full` — `full` exists for teams that
deliberately want it, and is never the default.

**Retention.** `activity_retention_days` (90 by default, following the
retention of diagnostic snapshots in this workspace). Raw heartbeats older
than the window are deleted; **the aggregate survives**, because it is no
longer personal data at that resolution. Without this the log grows forever
and there is no answer to "how long do you keep this".

**The right to deletion and to correction.** `worktrail activity forget
--actor <a>` deletes an actor's raw rows and recomputes the aggregates.
Separately, `worktrail activity reassign --from BL-A --to BL-B --session S`
appends a `kind: "reassign"` event — the log is append-only, so a correction
is a **new event, not an edit to history**. Without this path the first
attribution mistake stays forever, and that is a guaranteed first bug report.

> **The public surface in English.** This document and the tasks are in
> Polish per the workspace convention, but the public README, the event
> format description and the CLI text must be EN before the module ships —
> including the retention section from this paragraph. Separate task:
> [TL-32](../backlog/tasks/TL-32-angielska-powierzchnia-publiczna-modulu.md)
> (measured: 667 lines of comments + 350 strings + 415 lines of README; the
> `DEFAULTS` vocabulary is already English, so there is no data migration).

## 10. Cost as a second axis (optional)

An adapter that can, adds `tokens_in`, `tokens_out`, `model` to the row.
Cost calibration is then a derivative, not a separate mechanism. No adapter =
**no column, not zero** — zero would mean "measured and it came out free".

## 11. Calibration — the whole point of this

The value is not in the sentence "TL-27 took 3 h". It is in the distribution
per estimate bucket:

```
estimate   n    median    p80    bias
30m        41   0h48m     1h30m  ×1.6
2h         23   2h36m     4h06m  ×1.3
1d          6   —         —      too little data
```

Three rules for the report:

1. Below the `n` threshold (8 by default) the report writes **"too little
   data"**, not a number. A median of three observations is a number, not
   knowledge.
2. Always a range, never a point. "2h tasks land at 1.4–4.1 h" is useful;
   "2h tasks take 2.6 h" is falsely precise.
3. Breakdowns (board, `type`, `owner`) only where every cell meets the `n`
   threshold.

**None of this lands in the frontmatter.** No `actual: 3h` field that drifts
from its source a month later. The frontmatter holds what a human decided
(`estimate`, `confidence`); actuals are computed, like views.

### 11.1. When the buckets will fill up (measured)

The estimate distribution among 1026 closed tasks and the closing pace over
the last 8 weeks:

| estimate | n (done) | | week | closed |
|---|---|---|---|---|
| `1d` | 259 | | 2026-08-03 | 134 |
| `2h` | 238 | | 2026-08-10 | 74 |
| `4h` | 201 | | 2026-08-17 | 95 |
| `3h` | 105 | | 2026-08-24 | 142 |
| `1h` | 62 | | **average** | **~95/week** |

The top five buckets are ~84% of closed tasks, and the pace is ~95 closures a
week. The `n = 8` threshold **for these buckets is reachable within days of
launching phase 1**, not weeks. The tail (`1w`, `2d`, `15m`) will never fill
and should permanently report "too little data" — that is a feature, not a
gap.

## 12. Rollout order

| Phase | Task | What it delivers | Standalone value |
|---|---|---|---|
| 0 | [TL-27](../backlog/tasks/TL-27-pomiar-czasu-fundament-i-uczciwy-punkt-zero.md) | `activity/` + `worktrail time` + backfill of **completion stamps only** from git | velocity and throughput from 1026 tasks |
| 1 | [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md) | heartbeats from ALL tools, clustering, attribution with auto-focus | engaged time starts to exist |
| 1b | [TL-31](../backlog/tasks/TL-31-retencja-korekta-atrybucji-i-prawo-do-usuniecia.md) | retention, `forget`, `reassign` | **condition for releasing this beyond this machine** |
| 2 | [TL-29](../backlog/tasks/TL-29-kalibracja-estymat-z-danych-rzeczywistych.md) | calibration in `worktrail stats` + a viewer column | estimates stop being unverifiable |
| 3 | [TL-30](../backlog/tasks/TL-30-adapter-tokenow-i-kosztu-sesji.md) | a token/cost adapter | a second axis, immune to model speed |

TL-31 is **1b, not 4**: personal data starts being produced the moment phase 1
launches, so the mechanism for deleting it cannot arrive "later". It can stay
behind phase 1 in work order, as long as nothing leaves the one machine
before it closes.

## 13. What this mechanism does NOT guarantee

- **It does not measure thinking.** Time spent by the founder considering a
  problem without touching tools produces no heartbeats. Engaged time is a
  lower bound and should be reported as such.
- **It does not distinguish work from waiting within a session.** An agent
  waiting on `flutter test` produces heartbeats like an agent writing code.
- **It does not see work outside a host with an adapter.** A task done by
  hand in an editor without a hook is `unknown`, not zero.
- **It does not measure effort through cycle time** — §3.1.
- **It is not a timesheet.** Not for billing, not for evaluating people. The
  resolution and gaps described above make it a tool for calibrating
  estimates and nothing more. Were it ever to serve any other purpose, it
  would need guarantees it does not have today — and §9 exists precisely so
  that it cannot be walked into by accident.

## 14. Assumptions to be falsified

1. **That engaged time correlates with the estimate in human-hours.**
   Estimates were written in the frame of "how long would this take a
   human", and we measure an agent's clock — it is possible there is no
   correlation at all and the only useful axis turns out to be tokens.
   Falsification is cheap and **comes FIRST in TL-29**: if the spread within
   a bucket is larger than the difference between buckets, calibrating on
   time is worthless and a report for it is not worth building.
2. **That `unknown` can be kept low.** If after phase 1 it exceeds ~30%, the
   attribution chain (§8) is broken, not the data.
3. **That the 10-minute threshold is right.** Taken from WakaTime's practice,
   not from measurement on this data. After phase 1 it can be tuned from the
   distribution of gaps between heartbeats — and it must be, since today it
   is the least justified number in this document.
4. **That 60 s throttling does not lose short sessions.** Work shorter than
   one interval yields a single-heartbeat cluster, i.e. zero minutes (§6
   rule 1). If many such clusters turn up, the throttling threshold is too
   high or rule 1 is too strict — settled by the count of single-heartbeat
   clusters, which the report should surface for exactly this reason.

## 15. What is implemented (2026-09-02, TL-27)

This section is in English because it is new text; the rest of the document is
translated by TL-137. What exists now:

- `scripts/activity.mjs` — the append-only row store (§5) and the per-task
  rollup. `kind` and `attribution` are closed sets in the code; an unknown value
  is refused before anything is appended, because the file cannot be edited
  afterwards. A corrupt line is skipped and the rest of the task's rows are
  returned (§5.4).
- `scripts/backfill-completions.mjs` and `worktrail backfill-completions` — the
  completion stamp recovered with `git log -S"status: <archived>"`, written as
  one `commit` row per closed task. Idempotent by EVENT, not by row id: a ULID
  is fresh on every run, so the key is `(task, kind, ts)`.
- `scripts/time-report.mjs` and `worktrail time` — lead time (median, p80, p95
  by nearest rank) and throughput per ISO week, always with the number of closed
  tasks that have NO stamp.
- `backlog/.gitignore` — `activity/*.jsonl` is out of git, `activity/rollup/` is
  in it, and `worktrail init` writes the same rule into a new backlog.
- `config.yaml` — `activity_privacy`, `idle_gap_minutes`,
  `heartbeat_throttle_seconds`, `min_report_n`, `activity_retention_days`. The
  whole set at once, because an unknown key fails: adding them one task at a time
  would be four schema changes, each rejecting a config written for the next.

## 16. What is implemented (2026-09-02, TL-28)

Engaged time. The hole §15 named is closed; what fills it:

- `scripts/cluster.mjs` — §6, as a PURE function with no disk access and no
  imports, so it can be pasted into the viewer by source the way `estimate.mjs`
  is. All three rules are tested as PAIRS — the case that must hold and the
  smallest change that must flip it — because a clusterer with no window at all
  passes every one-sided test of a window.
- `scripts/attribution.mjs` — the five legs of §8, pure, with the leg that
  settled each row written onto the row. **Leg 4 now ignores case**: §8.1
  recorded it as "does not fire at all in this repository" because branches are
  named `tl-<number>-<slug>` while the prefix is `TL`, and that is a defect in
  the leg rather than a fact about branch naming.
- `scripts/focus.mjs` and `worktrail focus` — legs 1 and 2, and the throttle
  window. **The pointer lives outside the repository**, keyed like the locks by
  the shared git directory plus the session, not in a gitignored file: every
  worktree has its own checkout, so a pointer in the backlog would be a
  different file in each of them and would answer per TREE rather than per
  session — the global-state failure §8.1 disqualifies. It also keeps a person's
  working calendar out of every repository this tool is dropped into by
  construction rather than by a `.gitignore` somebody has to maintain (§9).
- **Auto-focus in `take`** — §8.1's condition. Writing `status: in_progress`
  sets THIS session's focus, best effort: a state directory that cannot be
  written loses a leg of the chain, never a claim.
- `scripts/activity-record.mjs` and `worktrail activity record` — the callable
  input of §7. Flags are an instruction, a host payload on stdin is a hint. A
  throttled call SUCCEEDS and writes nothing: the adapter fires after every tool
  call, so an error there would be a banner over most of an editing session.
- `scripts/activity-hook.sh` and `.claude/settings.json` — the adapter, wired to
  **every** tool. The throttle is what makes the wide matcher affordable, and it
  lives in the command rather than in the script because the window's value is
  in `config.yaml` and because §7 expects more adapters than this one.
- `worktrail time --engaged` — effort (sessions summed) beside calendar time
  (sessions merged), the count of runs too short to measure, and
  `unknown_ratio`, which `--json` carries whether or not `--engaged` was passed.

**What §8.2 promised, and what it costs.** The unattributed share is printed
first and is never omitted. Minutes are credited interval by interval to the
heartbeat that CLOSES each interval, so a cluster whose rows the chain settled
differently is split exactly rather than rounded to one answer — the parts sum
to the whole, and a test asserts it.

**What is still deliberately NOT implemented:** tokens (TL-30) and calibration
(TL-29). Retention, correction and the right to erasure — §9's condition — are
§17, one iteration behind as required.

## 17. What is implemented (2026-09-02, TL-31)

What the log gives BACK. §9 makes these a condition of the module rather than a
follow-up, and they land one iteration after the collection they answer for.

- `worktrail activity prune` — raw rows past `activity_retention_days` go, the
  per-task aggregate stays. **The aggregates are recomputed from the FULL log
  BEFORE anything is deleted**, and the order is not an implementation detail:
  deleting first would silently rewrite every historical figure to "the last N
  days", the calibration input would shrink every night, and the report would
  look exactly as healthy as before. The test asserts the surviving MINUTES, not
  the surviving files, because that is the only assertion that can tell the two
  orders apart.
- **`prune` runs when the viewer starts**, beside the view rebuild, silently and
  best effort. A retention window somebody has to remember to apply is a
  paragraph in a document, not a mechanism.
- `worktrail activity forget --actor` — one person's raw rows go **and the
  aggregates are recomputed WITHOUT them**. That inversion is the whole
  difference from `prune`: expiry keeps the summary because time passing revokes
  nothing, erasure does not because an aggregate left standing over deleted rows
  is the data coming back at the next report. `--dry-run` is required rather
  than offered — there is no undo — and the test compares the files' BYTES.
- `worktrail activity reassign --from --to --session [--since]` — the log is
  append-only, so a correction is a new row and `applyReassignments()` applies
  it at read time, deterministically by ULID, so corrections compose. Nothing on
  disk is edited, which matters because the person disputing an attribution is
  being asked to trust the tool a second time. `--session` is REQUIRED: without
  it the correction would move every row ever recorded on the task, which is a
  merge.
- `worktrail activity report --privacy` — the window, the mode, how many raw
  rows exist, whose they are, and which paths are versioned. One place a person
  can see what the tool holds about them, and it says in as many words that it
  is a set of mechanisms and not a compliance claim.
- **The README has a section, `What it records about you`** — what is collected,
  where it lives, for how long, how to erase it, how to correct it, and how to
  have none of it. A mechanism nobody can find is not a mechanism, and the
  README is where somebody who has not read this document looks.

**What is still NOT true, and must not be implied.** None of this makes a
deployment compliant with anything. `forget --actor` acts on a CLAIM and not on
proof — there is no actor authentication, the same single-machine boundary the
reservation has. The legal basis, informing the people measured, and any
assessment stay with whoever deploys it.

**A limit that belongs to THIS repository, not to the tool.** The git history was
flattened to a single commit at extraction ([`LINEAGE.md`](../LINEAGE.md)), so
for every task closed before that commit the pickaxe finds the flattening, not
the work. The stamps here are therefore truthful about the file and misleading
about the calendar for anything older than the squash — the numbers are real
measurements of a history that was rewritten. In a repository whose history was
never flattened the same command reads the real dates. The report cannot detect
this and does not pretend to; it is recorded here instead.
