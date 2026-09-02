---
id: TL-153
title: "The README is a manual that duplicates --help, and it has already drifted"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 1d                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: ["README.md"]
verification:                      # HOW to check that the task is really done
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: no-command-table
    bash: "! grep -q '^| `migrate-prefix`' README.md"
  - id: readme-is-a-front-door
    bash: "test $(wc -l < README.md) -lt 400"
---

## Goal

The README stops being a manual and becomes a front door: what this is, who
it is for, how to install it, one worked example, and where to go for the
rest. Reference material that the binary already prints is deleted rather
than moved; reference material the binary does not print moves to a
user-facing document under `docs/`.

## Context

**The measurement that settles it.** The README is 1014 lines. Its command
table is hand-maintained beside the line "`worktrail --help` is the source
of truth", and it has already drifted: `run`, `decide` and `renumber` are in
the CLI and absent from the table. `run` is the dispatcher — the first code
block on the first screen shows it, and the command list omits it. A reader
who trusts the table concludes the tool cannot do the thing the opening
paragraph advertises.

That is not a typo to patch. It is the predictable outcome of keeping a copy
of a list the tool generates, and the project already has this rule written
down for a different artifact: `.claude/skills/backlog-workflow/SKILL.md`
deliberately holds no procedure, because "a copy in a skill file freezes on
the day it was written, and it is then wrong in the way that is hardest to
notice: still specific, still confident, no longer true." The README broke
that rule for commands, statuses and guards.

**Three classes of content, three destinations.**

1. *The tool already prints it.* The command table (`--help`), the workflow
   sections (`instructions`), the guard list (`check`), the statuses (a
   project's own `config.yaml`). These are DELETED and replaced by the
   command that prints them. Deleting is the point; moving them to `docs/`
   would relocate the drift, not end it.
2. *The tool does not print it, and a user needs it.* The `--json` envelope
   contract, `config.yaml`'s schema, `plan.yaml`, the viewer, `seed`. These
   are a user MANUAL and move to one document under `docs/`.
3. *The front door.* Thesis, install, first five minutes, one task file, one
   worked loop, where the data lives, pointers. Stays.

**`docs/` today holds DESIGN documents** — a decision, its measurement, and
what would refute it. A user manual is a different kind of document and must
not be mixed into that set, or the "assumptions to be falsified" sections
start looking like caveats on a feature list. Give it its own file and say
at the top of it which kind it is.

**Do not compare the tool to named competitors.** A comparison table ages
badly, reads as defensive, and forces this repository to track somebody
else's release notes. The existing "why files instead of a tracker" table
compares to a CATEGORY, which is durable; keep that shape if any comparison
survives at all.

**What the front door must still earn.** A stranger decides in thirty
seconds whether this is for them, and reaches a first success in five
minutes. Any section that serves neither is a candidate for class 1 or 2.

## Steps

1. Delete the command table, the statuses section and the guards section;
   replace each with one line naming the command that prints it.
2. Move the `--json` contract, configuration, `plan.yaml`, viewer and `seed`
   sections into a new user manual under `docs/`, and link it once.
3. Compress "a queue, not just a readable list" to the one worked loop; it
   is the thesis and it earns space, but not 154 lines.
4. Re-check the front door against the thirty-second and five-minute tests.
5. Add a guard, or a verification entry here, that fails if a hand-copied
   command table returns.

## Acceptance criteria

- [x] The README is under 400 lines. [proof: readme-is-a-front-door]
- [x] No hand-maintained command table remains in the README. [proof: no-command-table]
- [x] Every section the tool can print is replaced by the command that prints it. [proof: no-command-table]
- [x] The user manual exists under `docs/` and states that it is a manual, not a design document. [proof: guards-green]
- [x] No named competitor appears anywhere in the README. [proof: guards-green]
- [x] The guards pass with the change in the set. [proof: guards-green]
