---
description: Merge a committed task into main, refresh the views, retire the worktree
argument-hint: "[branch — omitted means: the current one]"
---

A commit does not finish a task; merging does. Until the branch reaches `main`,
the task is still open everywhere else: each worktree has its own `backlog/`,
and the queue picks candidates from the tree it stands in. This has already cost
this project one task done twice, two minutes apart.

Run it in the main checkout, not in the worktree:

```
git -C <main checkout> merge --ff-only <branch>
```

No fast-forward means `main` has moved. Use a merge commit and settle conflicts
by task id rather than by file — `backlog/history/*.jsonl` merges by union, so
two branches appending to the same log is not a conflict to resolve by hand.

Then rebuild the views in the main checkout. They are computed and unversioned,
so after a merge they still show the state from before it:

```
node scripts/cli.mjs build
```

Then retire the worktree the branch was made in:

```
git worktree list
git worktree remove <path>
```

Two refusals are part of this command. A session does not remove the worktree it
is standing in — report the path and leave the command for someone else to run.
And `git push` is a separate decision that needs an explicit request; landing a
task never publishes it.
