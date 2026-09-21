---
id: TL-244
title: "Most estimates in this tree sit outside the estimates vocabulary"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # REWRITTEN BY THIS TASK (TL-244). The block it replaces was a single `manual:`
  # entry asking a person to read `branchling query --status
  # pending,in_progress,blocked --json` and compare it against `estimates:` by
  # eye. Three things were wrong with it.
  #   It was a VOUCH for something a command computes exactly, so the answer
  #   depended on who looked.
  #   Its status list was typed out and OMITTED `awaiting_vouch`, a status this
  #   project declares — a task parked there could carry any estimate at all and
  #   the entry would still have been answered yes (TL-260). The statuses are now
  #   read from `archived_statuses` in config.yaml instead of being typed.
  #   `query` reports tasks from sibling branches under the status they hold
  #   THERE: measured on 2026-09-21 in this worktree it answered 40 for `--status
  #   pending` where `stats` said 36, the three extra being tasks closed here and
  #   still pending on main. A contract about THIS tree must not read that set.
  # TL-424 did not apply — the old entry named no test file — but the new suite
  # entry counts the glob before running it, because `node --test <nothing>`
  # exits 0.
  - id: every-open-estimate-has-a-position
    bash: "node -e \"(async()=>{const c=(await import('./scripts/config.mjs')).loadConfigOrExit('backlog');const metas=(await import('./scripts/task-io.mjs')).readTaskMetas('backlog/tasks',c);if(!metas.length){console.error('positive control failed: no task was read');process.exit(1)}const vocab=c.estimates||[];if(!vocab.length){console.error('positive control failed: this backlog declares no estimates');process.exit(1)}const archived=new Set(c.archivedStatuses||[]);if(!archived.size){console.error('positive control failed: no archived statuses, so nothing would count as closed');process.exit(1)}const open=metas.filter(m=>!archived.has(String(m.status||'').trim()));const bad=open.filter(m=>!vocab.includes(String(m.estimate||'').trim()));if(bad.length){console.error(bad.length+' open task(s) carry an estimate with no position: '+bad.map(m=>m.id+'='+m.estimate).join(', '));process.exit(1)}console.log(open.length+' open task(s), every estimate inside ['+vocab.join(', ')+'] — OK')})()\""
  - id: the-gate-did-not-move
    bash: "node -e \"(async()=>{const c=(await import('./scripts/config.mjs')).loadConfigOrExit('backlog');const{isOverSized}=await import('./scripts/next-task.mjs');const bar=c.maxUnattendedEstimate||'';const vocab=c.estimates||[];if(!bar||vocab.indexOf(bar)<0){console.error('positive control failed: the threshold is not a word of the vocabulary, so the gate reads nothing');process.exit(1)}const above=vocab.filter(e=>isOverSized({estimate:e},c));if(above.join(',')!=='1w'){console.error('widening the vocabulary moved the gate: above '+bar+' now sits '+(above.join(', ')||'nothing')+', and 1w alone was gated before');process.exit(1)}console.log('the bar is still '+bar+' and 1w alone is above it, out of ['+vocab.join(', ')+'] — OK')})()\""
  - id: suite-green
    bash: "n=$(ls scripts/tests/*.test.mjs 2>/dev/null | wc -l | tr -d ' '); test \"$n\" -gt 0 || { echo 'no test files matched: node --test would exit 0 over nothing'; exit 1; }; node --test scripts/tests/*.test.mjs > /dev/null && echo \"$n test file(s) green\""
---

## Goal

Every open task in this backlog carries an estimate the `estimates` vocabulary
actually contains, so the size gate TL-211 built can see it.

## Context

TL-211 gates what an unattended run may be handed on the POSITION of a task's
estimate in `estimates: [30m, 2h, 1d, 1w]`. A word the list does not contain has
no position, so it is never gated — deliberately, because inventing an order for
an unknown word is exactly what the design refuses.

Measured in this tree on 2026-09-04, while TL-211 was being written:

    61 + 30 + 15 tasks   2h      in the vocabulary
    38 + 1 + 6 tasks     1d      in the vocabulary
    49 + 1 + 3 tasks     4h      NOT in the vocabulary
    11 tasks             3h      NOT in the vocabulary
    5 + 2 tasks          1h      NOT in the vocabulary

So roughly one task in four is invisible to the gate, and `4h` — the most common
of the three — is between `2h` and `1d`, which is to say the gate would have
something to say about it if the word had a place in the list.

The vocabulary is FREE by design (`init-backlog.mjs` writes `# [free]
suggestions in the viewer` beside it), so an estimate outside the list is not a
validation failure and `check` correctly says nothing. That is the point: this
is a DATA question about this backlog, not a defect in the tool.

## Pre-flight reading

1. `scripts/next-task.mjs` — `isOverSized()`, and the comment about why an
   unknown estimate is not gated.
2. `backlog/config.yaml` — `estimates:` and `max_unattended_estimate:`.
3. `scripts/estimate.mjs` — `estimateHours()`, which already maps `1h`, `3h`
   and `4h` to hours. It is the reason a rewrite would have been the LOSSY
   answer: every reader but the size gate already understood those words.
   (This entry used to name `scripts/calibration.mjs`, which has never existed
   in this tree — the TL-424 defect in a pre-flight rather than a contract.)

## Steps

1. Decide the direction: either add `1h`, `3h` and `4h` to `estimates` (keeping
   the list ordered, which is what the gate reads), or rewrite the tasks onto
   the four words already declared. The two answers are not equivalent — a
   longer list makes the threshold finer, a rewrite loses information.
2. Apply it to the OPEN tasks at least; closed ones are history and a rewrite
   there changes what `calibration` reports about work already done.
3. Say in the commit which of the two was chosen and why.

## Decision

**The vocabulary grows to fit the tree.** `estimates:` is now
`[30m, 1h, 2h, 3h, 4h, 1d, 1w]`, in order. No task's `estimate:` was rewritten.

Why not the other direction. An estimate is a JUDGEMENT somebody made. `4h`
rewritten to `2h` makes the file assert a judgement nobody ever made, and it
would have to be done in 79 files — 56 carrying `4h`, 12 `3h`, 11 `1h` — most of
them closed, which is what every estimate-weighted report reads. That is the
"rewrite loses information" this task's own step 1 warned about, and the loss is
not recoverable afterwards.

Why growing costs nothing. `estimates` is a FREE vocabulary, so the three words
were never a validation failure, and `scripts/estimate.mjs` already mapped all
of them to hours — the viewer, the critical path and every sum had been treating
them as real durations all along. The one reader that could not see them was
`isOverSized()`, which compares by POSITION in the list precisely so that no
scale is invented by the code. The vocabulary was the only place that had not
caught up with the tree.

Why the gate does not move. All three new words sit below `1d`, and
`max_unattended_estimate` stays `1d`, so `1w` is still the only estimate an
unattended run is refused. What changed is that an open task now HAS a position,
instead of being invisible to the gate — which, as TL-211 records, reads exactly
like an empty queue.

What else was touched. `_template.md` and the 22 OPEN task files whose
`estimate:` line carried the old suggestion comment — two of them offered `1mo`,
a word the vocabulary has never held. Closed task files keep the comment they
were created with; it is a copy made on the day, not an instruction anybody
re-reads.

## Acceptance criteria

- [x] Every open task's `estimate` has a position in `estimates`, so the size
      gate can answer about it, and the set of open tasks is derived from
      `archived_statuses` rather than typed out.
      [proof: every-open-estimate-has-a-position]
- [x] Widening the vocabulary did not change which estimates an unattended run
      is refused. [proof: the-gate-did-not-move]
- [x] The suite is green with the widened vocabulary. [proof: suite-green]
