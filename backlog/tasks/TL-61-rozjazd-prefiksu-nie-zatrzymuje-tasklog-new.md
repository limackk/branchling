---
id: TL-61
title: "A prefix mismatch does not stop worktrail new"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P1
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/prefix-mismatch-on-write.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" >/dev/null; node $T new --dir \"$d\" --title First >/dev/null 2>&1; sed -i '' 's/^task_id_prefix: .*/task_id_prefix: OTHER/' \"$d/config.yaml\"; node $T new --dir \"$d\" --title Second >/dev/null 2>&1 && { echo 'new still writes despite the mismatch'; exit 1; }; echo 'new refuses on a mismatch — OK'"
---

## Goal

Apply the existing prefix-mismatch gate to the path that actually writes a
task — today it protects only the view rebuild.

## Context

Measured 2026-08-31, a fresh backlog, prefix changed AFTER a task was
created:

```
$ sed -i 's/ACME/OPS/' config.yaml
$ worktrail build
✗ backlog: config says `task_id_prefix: OPS`, but in …/tasks
  there is NOT A SINGLE task with that prefix — instead there is: ACME
  Stopping BEFORE writing. […] or renumber the tree: `worktrail migrate-prefix --to OPS`

$ worktrail new --title "Second"
[worktrail new] …/tasks/OPS-1-second.md
```

The tree now has `ACME-1` and `OPS-1` side by side, two number spaces, and
numbering that started over.

The message from `build` is exemplary — it says what is wrong, why it stops
before writing, and gives two ways out, including `migrate-prefix --dry-run`.
The problem is where it lives: `detectPrefixMismatch()` is called
**exclusively** in `build-backlog.mjs`. `new-task.mjs` never calls it.

**Where the misunderstanding comes from.** The rule written in `CLAUDE.md`
says "a mismatch between config and tree FAILS before anything is written,"
and that is satisfied — but it is talking about writing VIEWS. The write the
user performs is writing a TASK, and that one is not protected. The rule's
name is broader than its implementation, so a reader of the code has every
reason to believe it is safe.

**Why this hits a new user specifically.** Changing the prefix to your own
(`TASK` → `ACME`) is one of the first things a team adapting the tool does.
Done before the first task, it is free and works cleanly — verified. Done
after a few tasks, it silently splits the backlog, and the symptom
(`build` fails) only shows up at the next regeneration, pointing at a
mismatch rather than at the moment a second prefix was just created.

`migrate-prefix` exists for exactly this. What is missing is something to
point to it at the moment it is needed.

## Pre-flight reading

1. `scripts/task-id.mjs` — `detectPrefixMismatch()`, `prefixMismatchMessage()`; the message is ready to be reused.
2. `scripts/build-backlog.mjs` ~215 — the only call to the gate today.
3. `scripts/new-task.mjs` — `main()`, `nextId()`; this is where the check has to land, BEFORE the number is computed.
4. `scripts/migrate-prefix.mjs` — the way out that the message points to.

## Steps

1. In `new-task.mjs`, before computing the number and before writing, check
   for a mismatch with the same function and print the same message. The
   same wording in both places is a feature, not duplication — the user
   should see the same sentence regardless of which command stopped them.
2. Review the remaining write paths (`serve-backlog.mjs` writes fields,
   `history-record.mjs` appends history) and decide whether they need the
   same gate. Write the outcome in `## Log`.
3. Consider whether the message in the `new` context should add one line:
   "if the backlog is still empty, just fix `task_id_prefix`" — because for a
   new user that is the most common case and the cheapest way out.
4. Test `scripts/tests/prefix-mismatch-on-write.test.mjs`: after changing the
   prefix on a tree with tasks, `new` refuses and writes nothing; on an EMPTY
   tree, `new` works unobstructed (positive control — without it the gate
   could block a normal start).

## Acceptance criteria

- [ ] `worktrail new` refuses to write on a prefix mismatch with the tree.
- [ ] Nothing is written when it refuses.
- [ ] On an empty tree, changing the prefix still works unobstructed.
- [ ] The message points to `migrate-prefix --dry-run`.
- [ ] The remaining write paths are reviewed, outcome in `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — measured during an onboarding audit; ACME-1 and OPS-1 ended up side by side
- 2026-08-31 in_progress — agent:claude — starting implementation
- 2026-08-31 done — agent:claude — `detectPrefixMismatch` called in `new-task.mjs` BEFORE `nextId()` (no reason to pay for scanning branches whose result would be discarded). `prefixMismatchMessage` got a `consequence` parameter: `build` talks about empty views, `new` about two number spaces — a shared cause and a shared way out, different consequences. Test `prefix-mismatch-on-write.test.mjs`, 5 assertions, with a positive control "on an empty tree, changing the prefix still works" (a gate that blocks too much would break the most common onboarding step). Strength checked by disabling the condition: 3 of 5 fail, the positive control and `build` stay green. 278/278.
- 2026-08-31 done — agent:claude — review of the remaining write paths (step 2): `history-record.mjs` deliberately does NOT get the gate — history is prefix-agnostic by design (`ANY_TASK_ID`), because the ID has to stay readable precisely after a migration; `migrate-prefix.mjs` by definition operates on a mismatch; `serve-backlog.mjs` edits EXISTING files, so it does not create an ID — on a mismatch it counts tasks prefix-agnostically and prints "build-backlog.mjs did not pass — views may be out of date." The behavior is safe, but the message does not say the prefix is the cause. A separate, minor defect — did not expand scope here.
</content>
