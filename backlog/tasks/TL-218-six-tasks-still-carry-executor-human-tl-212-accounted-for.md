---
id: TL-218
title: "Six tasks still carry executor: human; TL-212 accounted for four"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN BY THIS TASK (TL-218). The block it replaces was one `manual:`
  # entry, justified by a claim that turns out to be false: "a `grep | wc -l`
  # over the marks would exit 0 whatever it counted". A grep that counts exits 0;
  # a grep that ASKS A QUESTION does not. The question here — does the file
  # carrying the mark state the act — is answerable by reading the file, and the
  # entry handed it to a person anyway, so the answer depended on who looked
  # (TL-260). What the old comment was right about is that no command can judge
  # whether the sentence is TRUE; that stays a human reading. What it can judge
  # is whether the sentence is THERE, and a mark with no stated act is exactly
  # the defect this task exists to remove.
  #
  # The set of open tasks is derived from `archived_statuses` rather than typed,
  # and the sweep carries two positive controls: a tree it could not read, and a
  # tree in which nothing carries an `executor` at all, both fail it.
  # TL-424 does not apply — no entry here names a test file — but the suite entry
  # counts its glob before running it, because `node --test <nothing>` exits 0.
  - id: every-open-mark-names-its-act
    bash: "node -e \"(async()=>{const fs=require('fs');const path=require('path');const c=(await import('./scripts/config.mjs')).loadConfigOrExit('backlog');const io=await import('./scripts/task-io.mjs');const dir='backlog/tasks';const names=io.listTaskFileNames(dir,c);const metas=io.readTaskMetas(dir,c);if(!names.length||names.length!==metas.length){console.error('positive control failed: the tree was not read');process.exit(1)}const withField=metas.filter(m=>String(m.executor||'').trim()).length;if(!withField){console.error('positive control failed: no task carries an executor at all, so this guard reads nothing');process.exit(1)}const archived=new Set(c.archivedStatuses||[]);if(!archived.size){console.error('positive control failed: no archived statuses');process.exit(1)}const bad=[];let marked=0;for(let i=0;i<metas.length;i++){const m=metas[i];if(archived.has(String(m.status||'').trim()))continue;if(String(m.executor||'').trim()!=='human')continue;marked++;const text=fs.readFileSync(path.join(dir,names[i]),'utf8');if(!/Why .executor: human. \\(TL-218\\)/.test(text))bad.push(m.id)}if(bad.length){console.error(bad.length+' open task(s) carry the mark without naming the act a person must perform: '+bad.join(', '));process.exit(1)}console.log(marked+' open task(s) carry executor: human, each naming the act in its own file — OK')})()\""
  - id: the-vouch-state-exists
    bash: "node -e \"(async()=>{const c=(await import('./scripts/config.mjs')).loadConfigOrExit('backlog');const st=c.statuses||[];const vouch=String(c.awaitingVouchStatus||'').trim();if(!st.length){console.error('positive control failed: this backlog declares no statuses');process.exit(1)}if(!vouch){console.error('no vouch state is declared, so a contract ending in a manual: entry has nowhere to go but the executor mark');process.exit(1)}if(st.indexOf(vouch)<0){console.error('the vouch state '+vouch+' is not one of the declared statuses: '+st.join(', '));process.exit(1)}console.log('a contract ending in a manual: entry has its own state, '+vouch+', out of ['+st.join(', ')+'] — OK')})()\""
  - id: suite-green
    bash: "n=$(ls scripts/tests/*.test.mjs 2>/dev/null | wc -l | tr -d ' '); test \"$n\" -gt 0 || { echo 'no test files matched: node --test would exit 0 over nothing'; exit 1; }; node --test scripts/tests/*.test.mjs > /dev/null && echo \"$n test file(s) green\""
---

## Goal

Every task still marked `executor: human` in this backlog is marked because a
person must DO it, and its own file says which act that is. The mark stops
being the place two different questions are answered.

## Context

Surfaced while closing TL-212, on 2026-09-03.

TL-212 undid the mark on the five tasks that only need a person to VOUCH —
TL-89, TL-55, TL-77, TL-122, TL-159 — because the run now parks such a task in
`awaiting_vouch` instead of failing it. Its own Context named the split it was
working from as five against four:

    a person must DO it     TL-203, TL-102, TL-179, TL-123

The tree disagrees. After the revert, SIX tasks carry the mark:

    TL-102  TL-103  TL-123  TL-158  TL-179  TL-203

TL-103 (launch material) and TL-158 (the CI badge and the first publicly
visible green run) are in neither of TL-212's two lists. They were marked on
2026-09-03 in the same sweep and were not examined when the sweep was partly
undone — TL-212's scope was the five it named, and widening it would have
blurred a task already in flight.

TL-158 is the one worth looking at first: "watching a badge appear" is
verbatim one of the acts TL-212 lists under *a person must VOUCH*, and the
neighbouring number, TL-159, was reverted. If TL-158 belongs on the vouch side
too, it is being kept out of the fleet's queue for a reason that no longer
exists.

**This is not a request to remove marks.** `executor: human` is correct for
work a machine cannot perform, and TL-203 (a history rewrite with every session
stopped) and TL-179 (searches in three trademark registers) are the clearest
cases. What is missing is that each remaining mark states WHICH question it
answers, so the next sweep does not have to reconstruct it.

## Pre-flight reading

1. `backlog/tasks/TL-212-*.md` — the Context section, for the criterion that
   separates *must do* from *must vouch*, and why the second is no longer a
   reason to keep a task away from the fleet.
2. `backlog/history/TL-158.jsonl` and `backlog/history/TL-103.jsonl` — what was
   recorded when the mark was written, and by whom.
3. `scripts/next-task.mjs` — `servesExecutor()`, for what the field actually
   gates: who may be HANDED the task, never who may close it.

## Steps

1. Read each of the six task files against TL-212's criterion: can every line
   of its work be written by an agent, with only a check left for a person?
2. Revert the mark on any that only need a vouch, recording the reason with
   `branchling history --file <task.md> --actor <you> --reason "…"` — the same
   route TL-212 used, so the change is not a silent edit.
3. For each mark that STAYS, write the reason into that task's own `## Context`
   in one sentence: what the person has to do that no agent can.

## Decision

**The mark is not wrong; it was unaccounted for — and the rule binds where the
field does something.**

`executor:` gates who may be HANDED a task: `next` and `run` read it, and both
only ever consider OPEN work. On an archived task the field answers no live
question, and rewriting it would edit a record rather than a rule. So the
requirement "the mark names the act" is scoped to open tasks, and the three
archived carriers — TL-103 (cancelled), TL-123 and TL-203 (done) — keep theirs
as written.

**TL-158's mark is reverted.** TL-218's own Context was right about it: three of
its four verification entries are `bash`, every line of its work — the badge in
the README, the repository field in the manifest, the URL pointing somewhere
real — belongs to the fleet, and what is left is "open the README on the forge
and look at the badge", which is verbatim one of the acts TL-212 lists under *a
person must VOUCH*. `awaiting_vouch` exists now, so the mark was keeping the
task out of the fleet's queue for a reason that no longer exists.

**TL-102 and TL-179 keep theirs**, and each now states the act in its own
`## Context`: recording a TTY session an unattended run has no terminal for, and
running register searches whose four machine routes were all refused, ending in
a dated clearance that is a judgement with a name attached.

**TL-103 was in neither of TL-212's lists and stays marked**, because it is
cancelled: it is not work any more, and nothing is dispatched from an archived
status.

**What TL-123 turned out to be worth recording.** TL-212 filed it under *a
person must DO it* — "a vocabulary decision". On 2026-09-21 an agent performed
every line of it: the measurement, the decision recorded with `branchling
decide`, the migration of 81 files, the history entries and the close. The
criterion was applied wrongly there, and the mark on the file is left alone
precisely because the file is now a record. This is the evidence that the mark
was never a reliable statement about an archived task, which is the same reason
the rule is scoped to open ones.

## Acceptance criteria

- [x] Every OPEN task still carrying `executor: human` names, in its own file,
      the act a person must perform. Whether the sentence is TRUE is a reading;
      that it is THERE is checked. [proof: every-open-mark-names-its-act]
- [x] No task carries the mark solely because its contract ends in a `manual:`
      entry — that case is now `awaiting_vouch`, and this backlog declares that
      state. [proof: the-vouch-state-exists]
- [x] The suite is green after the revert. [proof: suite-green]
