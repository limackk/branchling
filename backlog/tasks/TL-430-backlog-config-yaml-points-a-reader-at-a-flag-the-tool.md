---
id: TL-430
title: "backlog/config.yaml points a reader at a flag the tool refuses"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P3
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-21
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  # The entry does not look for one flag by name: the defect is the CLASS, a
  # comment naming an interface that no longer exists. It reads every flag
  # mentioned anywhere in config.yaml and asks the CLI itself whether some
  # command still offers it, so the same entry catches the next one (TL-424).
  - id: no-refused-flag-in-the-config-comments
    bash: "test -f backlog/config.yaml || { echo 'config.yaml is not where this entry looks'; exit 1; }; cmds=$(node scripts/cli.mjs --help | sed -n '/^commands:/,/^$/p' | sed -n 's/^  \([a-z][a-z-]*\) .*/\1/p'); test -n \"$cmds\" || { echo 'positive control failed: the command list could not be read'; exit 1; }; all=''; for c in $cmds; do all=\"$all $(node scripts/cli.mjs \"$c\" --help 2>&1)\"; done; echo \"$all\" | grep -q -- '--dry-run' || { echo 'positive control failed: the help corpus is empty'; exit 1; }; bad=0; for f in $(grep -o -- '--[a-z][a-z-]*' backlog/config.yaml | sort -u); do echo \"$all\" | grep -q -- \"$f\" || { echo \"config.yaml names $f, which no command offers\"; bad=1; }; done; test \"$bad\" = 0 || exit 1; echo 'every flag named in config.yaml is offered by some command — OK'"
---

## Goal

No comment in `backlog/config.yaml` tells its reader to run a command the tool
refuses.

## Context

Surfaced on 2026-09-21 while TL-123 was rewriting the `types:` block of
`backlog/config.yaml`.

The file's header comment, at line 8, reads: "`branchling check --language`
enforces this over the source (TL-32)". That flag no longer exists. Running it
today gives:

    ✗ branchling check: unknown flag: --language

The guard was withdrawn — AGENTS.md now states outright that "no automated guard
determines whether prose is English", because the former detector looked only
for Polish-specific characters and word shapes, so a green result said nothing
about any other language. The withdrawal was correct; the pointer to it was left
behind.

This is the same defect TL-208 found in a task's `verification:` block, which
also named `check --language`, and which was deleted there. `config.yaml` is
read by more people than one task file: it is the file a stranger opens to learn
this project's vocabulary, and the comment sends them to a command that refuses.

**What the fix is not.** It is not reinstating the guard — that decision is
recorded in AGENTS.md and is not reopened here. The sentence should say what is
true: the language rule is a review responsibility, stated in AGENTS.md, with no
guard behind it.

## Pre-flight reading

1. `backlog/config.yaml` — the header comment, lines 5-9.
2. `AGENTS.md`, the section "Language: everything in this repository is
   English" — the paragraph explaining why the detector was withdrawn, which is
   the sentence the comment should defer to.
3. `backlog/tasks/TL-208-*.md` — the same stale name found in a contract, and
   how it was dealt with.

## Steps

1. Rewrite the sentence in `backlog/config.yaml` so it names AGENTS.md rather
   than a flag.
2. Check the rest of the file for any other command or flag named in a comment,
   and confirm each one still exists.

## Acceptance criteria

- [ ] No flag named in a comment in `backlog/config.yaml` is refused by the
      command it is named under.
      [proof: no-refused-flag-in-the-config-comments]
