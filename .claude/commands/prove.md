---
description: Run the gate that stands between finished work and a commit
---

Run all three, in this order, and read the output rather than the exit code:

```
node --test scripts/tests/*.test.mjs
node scripts/cli.mjs check
node scripts/cli.mjs doctor
```

The suite is the only thing entitled to say how many tests there are. `check`
covers the guards over the tree — id collisions, boards, references, criteria
links, vocabularies, the plan against the tree, the product name. `doctor` asks
whether the backlog is set up correctly at all.

If a task's frontmatter changed, rebuild the views before reading them, because
they are computed and a view still shows the state from before your edit:

```
node scripts/cli.mjs build
```

Closing a task is `node scripts/cli.mjs done`, which RUNS the task's own
`verification:` entries and refuses on the first failure. That refusal is the
answer, not an obstacle: work that did not pass its own verification is not
finished, and it is committed with an honest body and without closing the task.

A topic that surfaced while you worked and does not fit this task's thesis
becomes its own task now — `node scripts/cli.mjs new --title "…"` — not a
sentence in the commit body and not a `TODO`.
