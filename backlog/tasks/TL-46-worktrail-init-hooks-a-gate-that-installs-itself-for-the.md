---
id: TL-46
title: "worktrail init --hooks — a gate that installs itself for the user"
type: task
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: hooks-behaviour
    bash: "node --test scripts/tests/hooks-install.test.mjs"
  - id: print-writes-nothing
    bash: "node scripts/cli.mjs hooks print | grep -q 'Nothing was written'"
---

## Goal

Decide whether the tool should be able to **install a git hook for its
user**, and if so — do it in a way that never overwrites someone else's hook
and can be undone with one command.

## Context

The gates (`check-backlog-id-collisions`, `check-backlog-boards`,
`check-backlog-refs`) **already ship with every installation** — they live
in `scripts/`, covered by `files` in `package.json`, and are exposed as
`worktrail check`. What is missing is the moment when someone runs them.
Today whoever remembers runs them.

The distinction this task grew out of at all
([worktrail-global-tool.md §10.1](../../docs/branchling-global-tool.md)): a
hook in a consumer's repo is their own file, a dogfooding hook here does not
ship in the package, and so **neither of the two solves the user's
problem.** The missing piece is a command, not a config file on our side.

**Why this is a decision, not a given.** A tool that writes to a stranger's
`.git/` does something unexpected. Three traps, each of which has already
happened to someone:

1. **Overwriting an existing hook.** Repositories have their own
   `pre-commit` (husky, lefthook, pre-commit.com). Forcing our way in erases
   someone else's gate.
2. **`core.hooksPath` already set.** In that case `.git/hooks/` is dead and
   a silent write there **will not work, let alone say so** — the worst
   variant: the user thinks they have a gate.
3. **No way back.** An install without `--uninstall` is an install someone
   will remove by hand, learning distrust along the way.

## Steps

1. Decide the form: a dedicated hook file vs. **appending a line** to an
   existing one vs. simply printing the line to copy (least invasive, zero
   magic).
2. Detect `core.hooksPath` and an existing `pre-commit` BEFORE writing; on
   conflict **do not write** and say why.
3. `--uninstall` removing exactly what the command installed — and nothing
   more.
4. Decide whether this is a subcommand of `init` or a separate one
   (`worktrail hooks install`). `init` sets up a backlog in an EMPTY
   directory; a hook concerns a repository that already exists — these can
   be two different moments in the user's life.

## Acceptance criteria

- [x] An existing `pre-commit` is NOT overwritten — the command refuses and
      names the file. [proof: hooks-behaviour]
- [x] A set `core.hooksPath` is recognized; the command writes to the right
      place or refuses, but **never writes to a place git does not read**. [proof: hooks-behaviour]
- [x] `uninstall` restores the pre-install state — tested byte for byte. [proof: hooks-behaviour]
- [x] A repository without `.git` → a readable error, not a stack trace. [proof: hooks-behaviour]
- [x] Positive control: after installation, a commit with an ID collision
      **fails**. Without this step the test only proves the file was
      created. [proof: hooks-behaviour]
- [x] `print` is the default answer and writes nothing at all. [proof: print-writes-nothing, hooks-behaviour]

## Decisions

- **The form is all three, with `print` as the modest default.** The Notes
  called `--print` "90% of the problem for 10% of the risk", and that is right —
  so it is the subcommand somebody reaches first, it writes nothing, and it
  works even outside a repository. `install` exists because the alternative is a
  paragraph in a README, which is a gate nothing runs.
- **A separate command, not a flag on `init`.** `init` creates a backlog in an
  empty directory; a hook concerns a repository that already exists. Those are
  two different moments in somebody's life, and a flag would tie the second to
  the first.
- **REFUSE, never merge.** Appending to an existing `pre-commit` means guessing
  where in somebody's gate this belongs and what their `exit` does to it. The
  refusal prints the block, so the person is not left stuck — the choice stays
  with whoever wrote the file.
- **The path is asked of git: `git rev-parse --git-path hooks`.** It is the one
  answer right in every layout — it honours `core.hooksPath`, and inside a
  WORKTREE it names the common directory rather than
  `.git/worktrees/<name>/hooks`, which git never reads. Assembling the path from
  `--absolute-git-dir` looks correct and installs a hook nothing runs: trap 2
  arrived at from a second direction, and it is now a test of its own.
- **`core.hooksPath` is a statement, not a refusal.** The path is somebody's
  deliberate choice, often another hook manager's, and writing there is
  legitimate as long as the person is told whose directory it is. What would not
  be legitimate is writing to `.git/hooks/` while it is set.
- **The block is fenced by the same markers `init` uses in a `.gitignore`**, so
  `uninstall` removes exactly what was installed. A file left holding only a
  shebang is DELETED rather than left empty: an executable `pre-commit` that
  does nothing is a gate that always passes.

## Notes

- Worth considering the most modest variant: `worktrail hooks --print`,
  which prints the ready-made line and leaves installation to a human.
  Solves 90% of the problem for 10% of the risk, and does not touch anyone
  else's `.git/`.

## Log

- 2026-08-31 created — claude — split out of a conversation about gates, in
  which my first proposal (a dogfooding hook in this repo) was **rejected
  as unjustified**: it would not have caught any of the four bugs from that
  session. The founder's question "will these gates land in the open-source
  project, or are they the origin project's own gates?" showed I was conflating three
  different things — and that the only one that concerns the user is
  exactly the one that does not exist yet.
</content>
