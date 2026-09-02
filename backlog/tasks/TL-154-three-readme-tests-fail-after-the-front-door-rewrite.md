---
id: TL-154
title: "Three README tests fail after the front-door rewrite"
type: bug
labels: []
board: main
epic: ""
priority: P1                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: readme-contracts
    bash: "node --test scripts/tests/json-envelope.test.mjs scripts/tests/plan-command.test.mjs scripts/tests/instructions.test.mjs"
  - id: whole-suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: decision-recorded
    manual: "Read the Decision section of this task: does it say README or manual, and WHY? A section that only records what was done is not a decision."
---

## Goal

The suite is green again: `node --test scripts/tests/*.test.mjs` passes with no
failures, and the README carries the three things those tests assert it carries.

## Context

Three tests have been failing since the README was rewritten as a front door
(TL-152, TL-153, commits `c54ce12` and `96c46bc`). They are not flaky and they
are not about the code — each one asserts that a specific section of
`README.md` exists, and the rewrite removed all three:

- `scripts/tests/json-envelope.test.mjs` — "the README documents every kind the
  code can emit". It fails with *the README has no `--json` contract section to
  check*, so it cannot even begin comparing the documented kinds against
  `KINDS` in `scripts/json-envelope.mjs`.
- `scripts/tests/plan-command.test.mjs` — "the README describes the plan
  format".
- `scripts/tests/instructions.test.mjs` — "the guarantee is stated as a CLONE,
  in the README and in the instructions". The `instructions` half of that
  sentence still passes; the README half does not.

**The decision this task has to make is which side is wrong**, and it is a real
decision rather than a formality. The rewrite deliberately moved reference
material out of the README and into `docs/manual.md`, on the argument that a
front door is not a manual. If that argument holds, the tests are asserting the
old shape and should be pointed at the manual instead. If the three sections
belong on the front page after all, the README is what changes. What is NOT
acceptable is a third option: deleting the assertions. They exist because a
`--json` kind added to the code and never documented is an undocumented public
contract, and the test is the only thing that notices.

Whichever way it goes, **the sections must live somewhere a test can check**,
and the test has to fail when the code grows a kind, a plan key or a different
guarantee. A test relocated to a file that does not contain the sections either
would pass for the wrong reason.

## Pre-flight reading

1. `README.md` — what the front-door rewrite left, and where each of the three
   subjects went.
2. `docs/manual.md` — the reference the material was moved into, if it was.
3. `scripts/tests/json-envelope.test.mjs`, around the failing test — it reads
   the README's `--json` section and compares it with `KINDS`. That comparison
   is the part worth keeping whatever file it reads.
4. `git show c54ce12 96c46bc -- README.md` — the two commits that removed the
   sections, and their reasoning in the commit bodies.

## Steps

1. Decide, and record the decision in this file: README or manual.
2. Move the assertions or restore the sections, accordingly.
3. Run the whole suite and confirm nothing else was resting on those sections.

## Acceptance criteria

- [ ] `node --test scripts/tests/*.test.mjs` passes with zero failures. [proof: whole-suite]
- [ ] The three tests still FAIL when the documented list and the code disagree — the assertion was moved, not deleted. [proof: readme-contracts]
- [ ] The decision (README or manual) is written in this task, with its reason. [proof: decision-recorded]

## Notes

- Found while closing TL-28, which added two test files of its own; the three
  failures predate that work and are unrelated to it.
- CLAUDE.md states the suite is green. It has not been since the README
  rewrite, which is why this is P1: a suite with known failures stops being
  read, and the next real regression hides among them.
