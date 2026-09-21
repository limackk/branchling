---
id: TL-64
title: "init creates a sample task instead of an empty backlog"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P3
status: done
owner: claude
estimate: 2h
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-66]
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - bash: "d=$(mktemp -d); T="$PWD/bin/branchling.mjs"; node $T init --dir \"$d\" >/dev/null && test \"$(ls \"$d/tasks\" | wc -l | tr -d ' ')\" = 1 && echo 'init creates one task — OK'"
  - bash: "d=$(mktemp -d); T="$PWD/bin/branchling.mjs"; node $T init --dir \"$d\" >/dev/null && node $T check --dir \"$d\" && node $T stats --dir \"$d\" | head -3"
  - bash: "d=$(mktemp -d); T="$PWD/bin/branchling.mjs"; node $T init --dir \"$d\" --no-example >/dev/null && test \"$(ls \"$d/tasks\" | wc -l | tr -d ' ')\" = 0 && echo 'can be disabled — OK'"
---

## Goal

Shorten the path from installation to the first visible value: after `init`
there should be something to look at, and the sample should show the shape of
a well-written task.

## Context

Today, after `worktrail init` the backlog is empty: `stats` shows nothing but
zeros, the viewer opens with not a single card, and the only trace of the file
shape is `_template.md`, which nobody is required to open. The user judges the
tool on an empty screen.

The empty state is also a lost teaching opportunity. The hardest convention of
this tool to convey is **`verification:` — a task is not done until there is a
command that proves it.** No paragraph explains this as well as a single file
where it is visible.

**Constraints that must not be broken:**

- The sample must be **generic**. No vocabulary from any existing project
  whatsoever — the same requirement that applies to templates and that a test
  guards.
- It must be **deletable with no consequences**, and it must say so about
  itself, outright.
- It must **pass `worktrail check`** and have a `verification` that can
  actually be run. A sample with a fake command would teach exactly the
  opposite of what is needed.
- It must be possible to **turn off** — `init` is sometimes called by a
  script or by an agent, and then an unexpected file in `tasks/` is a
  surprise.

To be settled in the task: should the sample be a task "about the tool"
(e.g. "Adapt the vocabularies in config.yaml to your project" — a real first
task, with `verification` calling `worktrail check`), or a neutral dummy? The
first is stronger, because the sample is simultaneously a real first step and
closes itself naturally once done. The second is safer, because it does not
assume what the user wants to do.

A variant to consider instead of a flag: `init` builds the views right away,
so after one command both `stats` and the viewer work. Today `init` ends with
the hint `next: worktrail build` — a good one, but it is still a second step
to do by hand.

## Pre-flight reading

1. `scripts/init-backlog.mjs` — `FILES`, `TEMPLATE_MD`, the rule "skip a file
   that already exists".
2. `scripts/new-task.mjs` — how a task comes into being; the sample should be
   created through the same path, not a second generator.
3. `.claude/skills/backlog-workflow/SKILL.md` §"Write a task" — the standard
   the sample is meant to illustrate.
4. `scripts/tests/init-stats.test.mjs` — today's assertions about a fresh
   backlog; they will change.

## Steps

1. Decide the content of the sample (a task about adapting the configuration
   versus a neutral dummy) and record the reason in `## Log`.
2. The sample is created through the same path as `worktrail new` — one
   generator, not two.
3. `--no-example` (or `--bare`) turns it off; add the flag to `init`'s flag
   validation.
4. Consider building the views at the end of `init`, so `stats` and the
   viewer work after one command.
5. Update the "next:" hint so it matches what was actually done.
6. Fix `scripts/tests/init-stats.test.mjs` and add assertions: the sample
   passes `check`, its `verification` is runnable, `--no-example` gives an
   empty directory.

## Acceptance criteria

- [ ] `worktrail init` creates exactly one sample task.
- [ ] The sample passes `worktrail check` and has runnable `verification`.
- [ ] The sample says about itself that it can be deleted.
- [ ] No vocabulary from any existing project whatsoever.
- [ ] `--no-example` gives today's empty behavior.
- [ ] After `init`, `worktrail stats` shows a nonzero count with no extra
      commands.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from an onboarding audit
- 2026-08-31 in_progress — agent:claude — implementation started
- 2026-08-31 pending — agent:claude — unblocked: TL-66 removed the false
  `next-id` warning that fired on the first task and broke the path this task
  is meant to shorten.
- 2026-08-31 done — agent:claude — chosen variant: a task ABOUT
  CONFIGURATION, not a neutral dummy (step 1). Reason: a sample that IS a real
  first step teaches two things at once — the shape of the file, and that
  `verification:` is meant to be runnable — and it closes itself once done.
  Its `verification` is `worktrail doctor`, a command that genuinely answers
  the question posed by this task. A dummy would have taught that this field
  is decorative.
- 2026-08-31 done — agent:claude — "one generator" achieved by extracting
  `createTask()` out of `main()` in `new-task.mjs` (with no printing; `main`
  does the printing). `init` calls the same function, so the number still
  comes from a scan of every branch, and the write is exclusive (`wx`).
  `createTask` accepts `body` (the content below the frontmatter) and
  `fields.verification` (a block, not a line — the template carries a dummy
  there). The sample goes ONLY into an empty tree; a backlog with tasks
  already in it is not new, and adding it a file would be the same kind of
  surprise as overwriting one.
- 2026-08-31 done — agent:claude — `init` builds the views at the end, so
  `stats` and the viewer work after ONE command; the hint changed from
  `next: worktrail build` to `next: worktrail`. `--no-example` restores
  today's behavior and was added to flag validation.
- 2026-08-31 done — agent:claude — seven test fixtures got `--no-example`,
  each with a justification in a comment. This is not a workaround: these
  tests are about numbering, about "wrote nothing", or about an EMPTY tree, so
  the sample would have changed their subject, not their result. Five new
  assertions on the sample itself, with proof of strength through disabling
  the behavior. 318/318.
- 2026-08-31 done — agent:claude — known, deliberately left as is: `init`
  into a directory OUTSIDE a git repository prints a `next-id` warning about a
  narrower source of the number, together with the sample. It is true (the
  backlog really does not sit inside a repo), even though in a fresh directory
  the collision risk is zero. Silencing a true warning for prettier output
  would be the opposite of the rule TL-66 just fixed.
