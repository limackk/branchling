---
id: TL-203
title: "The origin project's name is gone from the tree but not from the git objects"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open-source publication"
priority: P0
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1h
confidence: high
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs:
  - LINEAGE.md
verification:
  - id: no-name-in-any-object
    bash: "test \"$(git cat-file --batch-all-objects --batch --buffer 2>/dev/null | LC_ALL=C grep -acowE \"$(git config branchling.foreignwords || echo 'zzzznevermatches')\" || echo 0)\" = 0 && echo 'no forbidden token in any git object — OK'"
  - id: scan-can-actually-fail
    bash: "printf 'zzzznevermatches\\n' | LC_ALL=C grep -qw zzzznevermatches && echo 'POSITIVE CONTROL: the scan matches when there is something to match — OK'"
  - id: history-is-not-lost
    bash: "test \"$(git rev-list --all --count)\" -ge 250 && echo 'the commits survived the rewrite — OK'"
  - id: tree-still-passes
    bash: "node scripts/cli.mjs check --foreign-context"
---

## Goal

The origin project's name must not be recoverable from this repository by
anybody who clones it — not from the working tree, and not from the objects of
its history.

## Context

TL-196 removed the name from every tracked file: 101 findings to zero, the
guard widened to read the backlog, and the forbidden-word list moved to the
user layer so the repository stopped storing the thing it forbids.

That is the half a reader sees. The other half is the object database. Measured
on 2026-09-03 on `main`: the name appears **250 times across the objects of 257
commits**, plus 9 records in five `backlog/history/*.jsonl` files that are
tracked and therefore travel with any clone. `git log -S` finds all of it in one
command.

**Why this is a task and not a footnote.** Nothing has been pushed yet, and
`github.com/limackk/branchling` is still empty. A rewrite today costs nothing:
no remote, no clone in anybody's hands, no hash anybody has cited. After the
first push the same operation stops being possible without invalidating other
people's clones — the cost does not rise gradually, it steps.

**Two rules in `CLAUDE.md` say not to do this**, and the owner overrode both on
2026-09-03, knowingly:

1. `backlog/history/*.jsonl` is append-only. The nine records are machine-written
   `related_docs` field changes with `actor: unknown, source: external` — not a
   person's sentence, which is what that rule was written to protect.
2. "From here on the history is immutable again" (written when the 2026-09-01
   squash closed the previous window). That window is reopened once, for this,
   and **the rule has to be re-stated in the same commit** — a rule contradicted
   by the history of the repository it governs is worse than no rule.

## Pre-flight reading

1. `LINEAGE.md` — the vocabulary the rewrite substitutes INTO (`origin#<path>`,
   "the origin project"). The replacements must land on the same words the tree
   already uses, or the history and the tree will read differently.
2. TL-196 — what was replaced with what in the working tree.

## The procedure, already tested

Tested on 2026-09-03 against a clone of `main`: 163 commits preserved, zero
occurrences left in any object or commit message, with a positive control
proving the scan can fail. `git-filter-repo` was installed for it
(`brew install git-filter-repo`); `git filter-branch` was tried first and left
211 occurrences behind, because a hand-written `--tree-filter` misses old blobs
in ways that are hard to see.

The replacement list is NOT reproduced here — writing it down is the disclosure
this task exists to undo. It is the same list as `foreign_context_words` in the
user preferences file, plus the old slug of TL-37's filename, in the form
`regex:<from>==>the origin project`.

```
git bundle create <somewhere outside the repo>/pre-rewrite.bundle --all
git filter-repo --force \
  --replace-text <list> --replace-message <list> \
  --path-rename <TL-37's old filename>:<its current filename>
```

`--replace-message` is not optional: without it two commit messages keep the
name, and that was only visible because the check counted objects rather than
trusting the tool.

## Steps

1. **Every other session stops first.** On 2026-09-03 there were four worktrees
   and one of them was committing. A rewrite changes every hash, so an
   unfinished branch elsewhere ends up on an orphaned base — and merging it back
   afterwards restores the name along with its ancestors.
2. Bundle all refs outside the repository. The bundle is the only way back.
3. Run the rewrite in the MAIN checkout.
4. `git reset --hard <branch>` in every remaining worktree, then rebuild views.
5. Re-state the immutability rule in `CLAUDE.md`, in the same commit, naming
   this second and last window.
6. Full suite, and the guard on the whole tree.

## Acceptance criteria

- [ ] No forbidden token in any object or commit message of any ref.
- [ ] The commit count is unchanged — this is a substitution, not a squash.
- [ ] `check --foreign-context` green.
- [ ] `CLAUDE.md` says when the window was reopened, why, and that it is closed.
- [ ] The pre-rewrite bundle is kept until the first push succeeds.
