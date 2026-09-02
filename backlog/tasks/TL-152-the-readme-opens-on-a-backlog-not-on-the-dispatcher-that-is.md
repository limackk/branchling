---
id: TL-152
title: "The README opens on a backlog, not on the dispatcher that is the difference"
type: task
labels: []
board: main
epic: ""
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: ["TL-103"]
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: claims-real
    bash: "node scripts/cli.mjs run --help && node scripts/cli.mjs next --help && node scripts/cli.mjs done --help"
  - id: no-stale-language-note
    bash: "! grep -q 'task files are Polish' README.md"
---

## Goal

The README's first screen states what makes this tool different, and every
claim on it is something the installed tool does today.

It opens instead on "a backlog that lives in markdown files and is driven
from the terminal". That sentence is true and it is the category, not the
difference: it describes Backlog.md, mdtask and half a dozen others equally
well. A reader who has seen one of those closes the tab before reaching the
part that is ours.

What is ours is three layers, and only the middle one was ever advertised:

1. **A queue several agents draw from.** Selection and reservation are one
   atomic act, so two sessions asking at the same moment get two different
   tasks. `run --agent-for <role>=<command>` serves one queue with several
   hands, and a role nobody has a command for waits rather than being
   handed out or failed. Three exit codes are the whole protocol.
2. **A contract.** `done` RUNS `verification:` and refuses. There is no
   `--force`.
3. **A ledger.** Every change carries actor, source and reason, and the
   statuses in `reason_required_statuses` cannot be entered without one.

## Context

**Accuracy is the whole risk here.** A first screen that promises more than
the binary does is worse than the flat one it replaces, because the reader
finds out in five minutes. Two facts to respect:

- `run` is SEQUENTIAL today. Several sessions or several `run` invocations
  may draw from one queue safely — that is what the lock guarantees, across
  every worktree of one clone — but a single `run` does not fan out.
  Parallel workers are TL-149 and must not be implied.
- The lock's boundary is the CLONE, not the machine and not the branch.
  Do not write "no two agents ever collide" without that qualifier.

**A stale claim is removed in passing.** The note under the install snippet
says the repository's documentation and task files are Polish. TL-137
translated both and `CLAUDE.md` now states the opposite rule, so the note is
false. It sits three lines from the edit and its removal is not a decision;
leaving a falsehood in place because it is out of scope would be.

**`blocks: TL-103`** — the launch post's thesis and the README's first
screen have to be the same thesis. TL-103 frames the post as problem →
measurement → mechanism → demo; this task settles the mechanism sentence
that post will point at. Writing the post first would fix the wording in
the harder-to-change artifact.

**What NOT to touch.** The comparison table under "Why files instead of a
tracker" stays: it answers a different question (why not Jira) and it is
honest about its one cost. This task adds the first screen; it does not
rewrite the document.

## Steps

1. Replace the opening paragraph with the three-layer thesis, in prose, not
   as a feature list.
2. Show the dispatcher in the first code block, since it is the claim.
3. Remove the stale language note.
4. Check every verb on the first screen against `--help` of the command it
   describes.

## Acceptance criteria

- [x] The first screen names the queue, the contract and the ledger. [proof: claims-real]
- [x] Every command shown on the first screen exists with the flags shown. [proof: claims-real]
- [x] Nothing on the first screen implies parallel workers inside one `run`. [proof: claims-real]
- [x] The stale note about Polish documentation is gone. [proof: no-stale-language-note]
- [x] The guards pass with the change in the set. [proof: guards-green]
