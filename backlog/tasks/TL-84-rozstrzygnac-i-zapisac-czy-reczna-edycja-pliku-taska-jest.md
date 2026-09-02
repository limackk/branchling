---
id: TL-84
title: "Decide and record: is manually editing a task file a supported path"
type: task
labels: [pre-launch]
board: main
epic: "worktrail — the tool"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
  - docs/worktrail-global-tool.md
verification:
  - id: one-sentence
    bash: "grep -q 'Editing a task file by hand is supported, not merely tolerated' README.md && node scripts/cli.mjs instructions overview | grep -qi 'EDITING A TASK FILE BY HAND IS SUPPORTED, not merely tolerated' && echo 'the same sentence stands in the README and in the instruction source — OK'"
  - id: one-source
    bash: "node scripts/cli.mjs instructions task-execution | grep -q 'SUPPORTED path, not a fallback' && test $(grep -c 'instructions overview' .claude/skills/backlog-workflow/SKILL.md) -ge 1 && echo 'the agent instructions come from the tool, so there is nothing to keep in step — OK'"
  - id: measured
    bash: "grep -q 'measured rather than assumed' README.md && grep -q 'check --vocabulary' README.md && echo 'what breaks was measured, and what already catches it is named — OK'"
  - id: separate-task
    bash: "test -n \"$(node scripts/cli.mjs query --text 'hand edit' --status pending --files)\" && echo 'drift detection is its own task — OK'"
---

## Goal

Have a recorded, explicit answer to the question "is it allowed to edit a
task file by hand" — one and the same answer in the README, in the agent
instructions, and in the tool's behavior.

## Context

Backlog.md answers this question firmly and repeats the answer in three
places (nudge, overview, execution guide): *"Do not edit Backlog markdown
files directly. Use the CLI so metadata, relationships, and history stay
consistent."* For them the CLI is the only legal write path.

We have the opposite model, and we have it **implicitly**. The file IS the
truth; `worktrail history --source manual` exists precisely to handle changes
made outside the tool; `_template.md` is a template meant to be filled in by
hand. Nowhere, however, is it written that this is a SUPPORTED path, not a
merely tolerated one — so every new writing command re-litigates the question
from scratch, differently each time.

This is not a task about code. It is a task about recording a decision before
TL-80, TL-82 and TL-83 start settling it quietly and inconsistently.

What needs to be weighed so the answer is not wishful thinking:

1. **The cost of our model.** Manual editing drifts computed fields and
   bypasses history. `history --source manual` patches this after the fact,
   and only when someone remembers to run it.
2. **The cost of their model.** The backlog stops being plain markdown —
   without the tool installed you cannot fix a typo, and a task in someone
   else's pull request stops being readable, editable content.
3. **A third option:** manual editing supported, but the tool detects the
   drift and reports it itself (`doctor` / `check`), instead of requiring
   someone to remember `history`. Check how much of this `doctor` already
   does.
4. Whatever comes out of this has to land in the **single** instruction
   source from TL-74 — not in three texts that can drift apart.

## Pre-flight reading

1. `scripts/history.mjs` and `scripts/history-record.mjs` — what today
   catches a change made outside the tool, and what it does not.
2. `scripts/doctor.mjs` — how much of the drift detection already exists.
3. `.claude/skills/backlog-workflow/SKILL.md`, the "Editing outside the
   viewer" section.
4. `docs/worktrail-global-tool.md` §3 — the four laws; check whether any of
   them already implies this answer, instead of inventing it from scratch.

## Steps

1. List out what actually breaks with manual editing (not hypothetically —
   check it on a file: computed fields, history, `updated`).
2. Check how much of this `doctor`/`check` detects today without needing
   `history` to be remembered.
3. Decide: supported / tolerated / unsupported. Record the justification.
4. Write the answer into the README and into the instruction source from
   TL-74 — one sentence, the same in both places.
5. If option 3 wins: open a separate task for drift detection. Do not do it
   here.

## Acceptance criteria

- [x] The decision is recorded along with its justification and a list of what actually breaks. [proof: measured]
- [x] The README and the agent instructions say the same thing, in one sentence. [proof: one-sentence]
- [x] It has been checked (not assumed) how much drift `doctor`/`check` detects today. [proof: measured]
- [x] Any work on drift detection is a separate task, not tacked on here. [proof: separate-task]

## Log

2026-08-31 pending — agent:claude — from an analysis of Backlog.md: they
forbid manual editing and repeat that in three places; we have the opposite
model and have never written it down anywhere.
- 2026-09-02 in_progress — agent:claude — MEASURED first, on a real tree, rather
  than reasoned about. A hand edit costs four things and only one of them is
  permanent. (1) The views go stale — a rebuild, not a repair, and exactly what
  Law 2 says a view is for. (2) The change misses the history until somebody
  runs `history --source manual`: `build` does NOT reconcile, and neither does
  `query`, `stats` or `check`. (3) The REASON is unrecoverable — a change the
  tool merely saw is recorded as `unknown`, and no later pass can fill it in.
  (4) `updated:` is not touched by anything, so it keeps saying what the last
  tool write set. What is ALREADY caught without anybody remembering a command:
  `check --vocabulary` and `doctor`'s vocabulary row both fail on a hand-written
  value outside the vocabulary (verified: `priority: URGENT` exits 1 and names
  the file), and `check --reasons` reports the `unknown` reasons.
- 2026-09-02 in_progress — agent:claude — step 3 settled: SUPPORTED, not
  tolerated. Reason: the file is the truth (Law 1), and the tool's job is to
  notice what changed rather than to be the only way to change it. The opposite
  model buys a perfect history at the cost of the thing files were chosen for —
  a backlog nobody can fix without the tool installed is not plain markdown, and
  a task in somebody else's pull request stops being editable content. The one
  thing that genuinely justifies a command is the reason, which is why
  `reason_required_statuses` refuses at write time: afterwards there is nobody
  left to ask. Option 3's other half — the tool NOTICING an unrecorded change —
  went to TL-162, per step 5, rather than being tacked on here.
- 2026-09-02 in_progress — agent:claude — step 4 needed no coordination between
  three texts: since TL-74 the agent instructions come from `worktrail
  instructions`, and the skill file only points at that command. The sentence
  therefore has ONE source in the tool and one copy in the README, which is the
  smallest number that can exist while the README is still a document a stranger
  reads before installing anything.
