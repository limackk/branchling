---
id: TL-46
title: "worktrail init --hooks — a gate that installs itself for the user"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/hooks-install.test.mjs"
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
([worktrail-global-tool.md §10.1](../../docs/worktrail-global-tool.md)): a
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

- [ ] An existing `pre-commit` is NOT overwritten — the command refuses and
      names the file.
- [ ] A set `core.hooksPath` is recognized; the command writes to the right
      place or refuses, but **never writes to a place git does not read**.
- [ ] `--uninstall` restores the pre-install state — tested byte for byte.
- [ ] A repository without `.git` → a readable error, not a stack trace.
- [ ] Positive control: after installation, a commit with an ID collision
      **fails**. Without this step the test only proves the file was
      created.

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
