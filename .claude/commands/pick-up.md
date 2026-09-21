---
description: Take a task and brief yourself on it before the first edit
argument-hint: "[task id — omitted means: let the queue choose]"
---

Read the procedure from the tool before you decide anything. It is rendered from
this project's own configuration, so it is the only copy that cannot be stale:

```
node scripts/cli.mjs instructions
```

Then claim exactly one task. With an id in `$ARGUMENTS`, claim that one; with no
argument, let the queue pick the closest executable one:

```
node scripts/cli.mjs take $ARGUMENTS
node scripts/cli.mjs next
```

Both reserve the task outside the repository, so a second session cannot be
handed it while you hold it. The reservation only excludes sessions running at
the same moment — it knows nothing about another branch.

Work in a branch named `tl-<number>-<short-english-slug>`. Read the task file
itself, including its `## Pre-flight reading`, before touching any other file.

If the task turns out to rest on a question only a person can settle, stop on it
rather than guessing — `node scripts/cli.mjs ask --help`.
