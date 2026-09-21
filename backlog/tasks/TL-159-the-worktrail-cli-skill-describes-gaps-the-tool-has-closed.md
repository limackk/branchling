---
id: TL-159
title: "The branchling-cli skill describes gaps the tool has closed"
type: bug
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
executor: ""
estimate: 30m                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-21
blocked_by: []
blocks: []
related_docs:
  - .agents/skills/branchling-cli/SKILL.md
  - .agents/skills/branchling-cli/references/output-style.md
verification:                      # HOW to check that the task is really done
  # REWRITTEN BY THIS TASK (TL-159), because the block it replaced carried both
  # known defects of an old contract.
  #   TL-424: `node --test <path that does not exist>` EXITS 0. The old entry
  #   `the-gaps-really-are-closed` named scripts/tests/public-language.test.mjs,
  #   a file that has never existed in this tree — so a third of that command
  #   proved nothing and could never go red. Every path is now checked with
  #   `test -f` BEFORE node is asked to run it.
  #   TL-260: the old grep could fail on an unchanged tree, but it read only
  #   SKILL.md — and half of the stale prose was in references/output-style.md,
  #   which no entry looked at. The sweep is now the whole skill directory.
  # The acceptance criterion about the durable parts used to cite the same grep
  # that looked for stale phrases; absence of one sentence is no evidence that
  # another survived, so it has an entry of its own.
  - id: no-closed-gap-listed
    bash: "d=.agents/skills/branchling-cli; for f in $d/SKILL.md $d/references/output-style.md; do test -s \"$f\" || { echo \"missing skill file: $f\"; exit 1; }; done; grep -qF 'Anatomy of an error' $d/references/output-style.md || { echo 'positive control failed: this is not the reference the guard thinks it is reading'; exit 1; }; for q in 'There is no color anywhere' 'fails for most commands' 'prints the module' 'still Polish' 'Suggested surface' 'Target shape' 'aktywnych' 'Copy the shape used in' 'Decide once, at import time' 'check --language'; do grep -rqiF \"$q\" $d && { echo \"the skill still states a closed gap: $q\"; exit 1; }; done; echo 'no closed gap is stated in either skill file — OK'"
  - id: durable-parts-survive
    bash: "d=.agents/skills/branchling-cli; for q in 'How the CLI is wired' '| exit 2 |' 'Color is emphasis, never information' 'Style belongs in one module' 'Anatomy of an error' 'When color is allowed'; do grep -rqF \"$q\" $d || { echo \"a durable part of the skill was lost: $q\"; exit 1; }; done; echo 'wiring, contract table and the two colour rules are still there — OK'"
  - id: gaps-live-in-the-backlog
    bash: "d=.agents/skills/branchling-cli; grep -qF 'branchling query --text' $d/SKILL.md || { echo 'the skill does not point at the backlog for gaps'; exit 1; }; grep -rqi 'Known gaps in the current implementation' $d && { echo 'the snapshot section is back'; exit 1; }; grep -qF '## Decision' backlog/tasks/TL-159-*.md || { echo 'the decision is not written in the task'; exit 1; }; echo 'gaps are asked for, not listed — OK'"
  - id: the-gaps-really-are-closed
    bash: "for f in scripts/tests/cli-help.test.mjs scripts/tests/help-covers-flags.test.mjs scripts/tests/ui.test.mjs scripts/tests/flag-validation.test.mjs scripts/tests/json-output.test.mjs; do test -f $f || { echo \"this contract names a test file that does not exist: $f\"; exit 1; }; done; node --test scripts/tests/cli-help.test.mjs scripts/tests/help-covers-flags.test.mjs scripts/tests/ui.test.mjs scripts/tests/flag-validation.test.mjs scripts/tests/json-output.test.mjs"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: decision-recorded
    manual: "Read the Decision section: does it say whether a `known gaps` list belongs in a skill at all, and why? A section that only records what was deleted is not a decision."
---

## Goal

`.claude/skills/branchling-cli/SKILL.md` describes the CLI as it is, so a session
that loads it is not told to fix things that are already fixed.

## Context

The skill carries a section called **"Known gaps in the current implementation"**
that was accurate when it was written and is now four claims out of date. Read
today it sends a session looking for work that does not exist, and — worse —
teaches it a false picture of the surface it is about to change:

- *"`branchling <command> --help` fails for most commands"* — closed by TL-51.
  `scripts/tests/cli-help.test.mjs` asserts every command answers `--help` with
  exit 0.
- *"`query --help` prints the module's source comment, shebang line included"* —
  closed with the same task; the help text now comes from the command table.
- *"Error prefixes leak internal script names"* — the failures now read
  `branchling <command>:` through `failure()` in `scripts/ui.mjs`.
- *"There is no color anywhere, and therefore no `NO_COLOR` handling either"* —
  `scripts/ui.mjs` exists, with six colour roles, `MARK` symbols and
  `colorAllowed()`, and `scripts/tests/ui.test.mjs` covers it.

The **Language** section is stale in the same direction: it says user-facing
strings "are still Polish across most commands". TL-32 and TL-137 translated
them, and `check --language` now fails on a lapse.

**What must NOT be lost while fixing this.** The skill's genuinely durable
parts are the wiring description, the contract table (stdout/stderr/exit
codes/`--json`/`--help`/unknown flag) and the two rules about colour. Those are
the reason a session reads it at all. This is a correction of one section and
one paragraph, not a rewrite.

**And the question worth asking while there:** a list of "known gaps" inside a
skill is a snapshot, and it will go stale again. Consider whether it belongs
there at all, or whether gaps belong in the backlog — where `branchling next` can
hand them out — with the skill pointing at a query instead of a list.

## Pre-flight reading

1. `.claude/skills/branchling-cli/SKILL.md` — the two stale sections.
2. `scripts/ui.mjs` — the colour and symbol module the skill says does not exist.
3. `scripts/tests/cli-help.test.mjs` — what `--help` is now asserted to do.

## Steps

1. Check each of the four claims against the tree before deleting it — one of
   them may still be true, and deleting a real gap is worse than leaving a stale
   one.
2. Correct or remove the section, and the Language paragraph.
3. Decide, and record here, whether the section should exist at all.

## Acceptance criteria

- [x] No claim in EITHER skill file — `SKILL.md` and `references/output-style.md` — describes as open a gap the tool has closed. [proof: no-closed-gap-listed]
- [x] The gaps really are closed: asserted by running the guards that closed them, each named path checked to exist first. [proof: the-gaps-really-are-closed]
- [x] The suite is green with the skill rewritten. [proof: suite]
- [x] The wiring description, the contract table and the two colour rules survive — asserted by their presence, not by the absence of something else. [proof: durable-parts-survive]
- [x] The skill asks the backlog for gaps instead of listing them, and the snapshot section does not come back. [proof: gaps-live-in-the-backlog]
- [x] The decision about whether a "known gaps" section belongs in a skill is written here. [proof: decision-recorded]

## Decision

**A list of known gaps does not belong in a skill, and the section is gone —
not corrected.** The four claims were all true when written; what made them
harmful was not inaccuracy but the fact that nothing could ever tell a reader
they had expired. A skill has no owner, no verification contract and no date on
it, and it is read BEFORE the code, so its snapshot is believed over the tree it
describes. The backlog is the other half of that: a gap written as a task has an
id, a proof, and `branchling next` to hand it to somebody. So the section was
replaced by the three questions that answer it from the tree today —
`branchling query --text cli --status pending`, the same for `--text output`,
and `branchling check`.

**The same test was then applied to the rest of both files**, which is why this
went wider than one section. Anything a command can be asked directly was
replaced by the asking: the invented `ui.mjs` surface in §4 became `grep
'^export' scripts/ui.mjs`; the flag list inside the error example became an
elision plus `branchling query --statu`; the two "guards worth having" in §9
became the names of the three test files that now hold them. What stayed
restated is what the code cannot say: WHY six colour roles and not seven, why
`available:` is an interface rather than a wording, why zero counts are printed
and dimmed. That is the line — a skill carries the reasoning, the tree carries
the facts.

## Notes

- Found while working TL-57, which loaded the skill and was told the tool has no
  colour — from a file sitting beside `scripts/ui.mjs`.
- P3 rather than P2: it misleads a session but breaks nothing, and the skill is
  not shipped to users (TL-54 ships only `backlog-workflow`).
