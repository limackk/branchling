---
id: TL-159
title: "The branchling-cli skill describes gaps the tool has closed"
type: bug
labels: []
board: main
epic: ""
priority: P3                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
executor: ""
estimate: 30m                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/branchling-cli/SKILL.md
verification:                      # HOW to check that the task is really done
  - id: no-closed-gap-listed
    bash: "for q in 'There is no color anywhere' 'fails for most commands' 'prints the module.s source comment' 'still Polish'; do grep -qi \"$q\" .claude/skills/branchling-cli/SKILL.md && { echo \"the skill still lists a closed gap: $q\"; exit 1; }; done; echo 'no closed gap is listed as open — OK'"
  - id: decision-recorded
    manual: "Read the Decision section: does it say whether a `known gaps` list belongs in a skill at all, and why? A section that only records what was deleted is not a decision."
  - id: the-gaps-really-are-closed
    bash: "node --test scripts/tests/cli-help.test.mjs scripts/tests/ui.test.mjs scripts/tests/public-language.test.mjs"
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

- [ ] No claim in the skill describes as open a gap the tool has closed. [proof: no-closed-gap-listed]
- [ ] The four gaps really are closed — asserted against the suite, not against the prose. [proof: the-gaps-really-are-closed]
- [ ] The wiring description, the contract table and the two colour rules survive unchanged. [proof: no-closed-gap-listed]
- [ ] The decision about whether a "known gaps" section belongs in a skill is written here. [proof: decision-recorded]

## Notes

- Found while working TL-57, which loaded the skill and was told the tool has no
  colour — from a file sitting beside `scripts/ui.mjs`.
- P3 rather than P2: it misleads a session but breaks nothing, and the skill is
  not shipped to users (TL-54 ships only `backlog-workflow`).
