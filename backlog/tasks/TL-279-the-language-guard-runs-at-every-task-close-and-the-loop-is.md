---
id: TL-279
title: "The language guard runs at every task close, and the loop is not who it protects"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: blocked  # pending | in_progress | blocked | done | cancelled
owner: ""
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: placement-decided
    bash: "node --test scripts/tests/language-guard-placement.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The language guard runs where the thing it protects can be harmed. Today it
runs at every task close, and the measurement below says nothing is being
caught there.

## Context

The rule is settled and is not reopened here. CLAUDE.md draws the boundary
around "what a stranger reads when they open the repository", and
`LINEAGE.md` is why the backlog counts: the tasks ARE this tool's
development history. The question is WHERE the guard belongs, not whether
the rule holds.

**Measured over 17 agent runs and 292 commits, 2026-09-02 to 09-05.**

The git surface is deliberately unguarded, which makes it a control group:
the same agents, the same instruction, no guard.

    commits examined                    292
    titles with Polish markers            0
    body lines with Polish diacritics     0

Meanwhile 23 of the 32 agent logs are written in Polish. The same agents,
in the same sessions, write Polish wherever nothing asked for English and
English wherever something did. The instruction is what holds, not the
guard.

**Every hit the guard produced during those runs, classified.** Twenty-four
distinct words. Two were Polish, `istnieje` and `powstal`, both in
`scripts/tests/boards.test.mjs`, both pre-existing debt reported during
TL-128 — the task whose whole job was removing that Polish. Not one hit
was text an agent had written. The other twenty-two were ordinary English
absent from the dictionary, which is TL-243.

That source is now exhausted: TL-128 is closed and the file is translated.

**What it costs where it runs.** 368 ms and 46 tokens when it passes,
which is nothing. The cost is the false positives: 9 of 17 hands met one,
21 words in a single day, three agent runs lost outright because the guard
fires after the work and after the commit is written.

**Why this is not simply "delete the check from the contract".** Thirty-two
of the 178 tasks carrying a contract invoke `cli.mjs check`, which runs
every guard including this one. Changing what `check` does by default
changes what all 32 assert, closed tasks included, so whatever is chosen
has to say what those contracts mean afterwards.

**Order matters.** The English in the tree is held today by a sentence in a
charter that lives in a temporary directory (TL-264). A fleet launched
without that sentence has the guard as its only backstop. Whatever is
decided here should land AFTER the role briefs are in the repository, or
the measurement above stops being true the first time somebody runs the
loop with a different charter.

**Not TL-243.** That task makes the guard stop rejecting ordinary English,
and would remove most of the cost measured here wherever the guard runs.
The two are independent: fixing the dictionary does not answer where the
guard belongs, and moving the guard does not fix the dictionary. If TL-243
lands first, the urgency of this one drops but the question stands.

## Steps

1. Ask the question with `branchling ask`, carrying the options below, and
   stop. This is not an unattended session's decision: it changes what a
   guard defends and what 32 existing contracts assert.
2. Implement whatever is decided, with a test that fails against today's
   placement.
3. Say in the autonomous-loop guide (TL-263) where the guard runs and why,
   so a caller building a loop knows what it does and does not cover.

## Acceptance criteria

- [ ] Where the guard runs is a `__decision__` event in
      `backlog/history/TL-279.jsonl`, naming the option chosen.
      [proof: placement-decided]
- [ ] What the 32 contracts invoking `check` assert afterwards is stated in
      that decision. [proof: placement-decided]
- [ ] A Polish word entering the tree is still caught somewhere, and the
      guard's reach is unchanged where it runs. [proof: guards-green]
