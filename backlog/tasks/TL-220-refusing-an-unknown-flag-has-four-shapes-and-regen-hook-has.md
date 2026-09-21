---
id: TL-220
title: "Refusing an unknown flag has four shapes, and regen-hook has none"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude-opus-5
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
# REWRITTEN BEFORE THE WORK BEGAN (TL-260's finding about this block). The old
# second entry, help-covers-flags, PASSED against the unchanged tree and proved
# nothing about this task: that guard SKIPS every command whose refusal it
# cannot parse, so the thirty-one commands that name no flags left it green.
# The old first entry did fail, but it was an inline check of ONE command, and
# the task's thesis is the SHAPE shared by forty. `refusal-shape.test.mjs` is
# the entry that fails today: it asks every command in the table for its
# refusal and asserts one anatomy, and `regen-hook` answers exit 0 in silence.
verification:                      # HOW to check the task is really done
  - id: one-refusal-shape
    bash: "node --test scripts/tests/refusal-shape.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: every-command-lists-its-flags
    bash: "node --test scripts/tests/help-covers-flags.test.mjs"
---

## Goal

`CLAUDE.md` opens with "an unknown command and an unknown flag **fail** — a
silent no-op looks like it worked". One command breaks that outright, and the
commands that keep it say so in four different shapes, which is why a machine
cannot ask most of them what they accept.

Once this is done, `regen-hook` refuses an unknown flag with exit 2, every
command's refusal names the flags it WOULD have accepted in ONE wording, and
`scripts/tests/help-covers-flags.test.mjs` reaches every command in the table
instead of the eleven it reaches today.

## Context

Measured on 2026-09-03 while closing TL-194, whose guard needs exactly this
list. Four wordings, all for the same event:

    $ node scripts/cli.mjs query --zzz
    unknown flag: --zzz
      available: --all-projects --blocked-by --board ...

    $ node scripts/cli.mjs take --zzz
    branchling take: unknown flag: --zzz
      known flags: --dir --actor --role --reason --json

    $ node scripts/cli.mjs new --zzz
    branchling new: unknown flag: --zzz
      usage: branchling new --title "..." [--board b] ...

    $ node scripts/cli.mjs mcp --zzz
    branchling mcp: unknown argument: --zzz
      usage: branchling mcp [--dir <path>]

`available:` against `known flags:` against `usage:`; "unknown flag" against
"unknown argument" against "unknown subcommand" against "unexpected argument";
and the failure mark present in `query` and `take`, absent in `new`,
`migrate-prefix` and `mcp` — that mark is how a reader scanning a terminal finds
a failure at all.

Worse, one command does not refuse:

    $ node scripts/cli.mjs regen-hook --zzz-not-a-flag </dev/null
    $ echo $?
    0

It is the hook an editor invokes after a task edit, so a typo in an installed
hook's arguments looks exactly like a hook that ran.

**Why this is a task and not a tidy-up.** TL-194's guard compares what a command
ACCEPTS with what its `--help` DECLARES, and it takes the first list from the
command's own refusal. Only the eleven commands printing `available:` can be
asked; the other thirty-one are outside its reach — not because they are
correct, but because nothing can interrogate them. A uniform refusal is what
turns that guard from a spot check into a rule.

## Pre-flight reading

1. `scripts/tests/help-covers-flags.test.mjs` — `accepted()`, which parses the
   refusal, and the header explaining why the refusal is the source rather than
   a list written into the test.
2. `scripts/query.mjs` (the `VALUE_FLAGS` / `BOOL_FLAGS` refusal near the top)
   and `scripts/next-task.mjs` — two of the four shapes, side by side.
3. `scripts/ui.mjs` — `MARK` and `failure()`, the existing vocabulary for what a
   refusal looks like, which this should reuse rather than invent beside.
4. `scripts/regen-hook.mjs` — the command with no validation at all.

## Steps

1. Settle ONE refusal shape: the mark, the sentence, and the word introducing
   the list. `available:` is the majority and is what the guard already parses.
2. Bring the other commands to it. A command whose arguments are subcommands
   rather than flags still has a list to name.
3. Give `regen-hook` the validation, in the `invokedDirectly` branch only — the
   trap `flag-validation.test.mjs` documents for `build-viewer.mjs` applies here
   too: a module imported under `node --test` must not read the runner's argv.
4. Empty the `UNDOCUMENTED` map in `help-covers-flags.test.mjs` of anything the
   widened reach now proves documented, and file whatever new gaps the other
   thirty-one commands turn out to have.

## Acceptance criteria

- [x] `regen-hook` with an unknown flag exits 2 and writes nothing.
      [proof: one-refusal-shape]
- [x] Every command in the table answers an unknown argument in ONE anatomy —
      the failure mark, the command as the user typed it, the sentence naming
      which event it was, `available:` introducing the list, and the `--help`
      that prints more. [proof: one-refusal-shape]
- [x] `help-covers-flags.test.mjs` reaches every command in the table instead of
      the eleven it reached, and says so in a positive control.
      [proof: every-command-lists-its-flags]
- [x] The suite stays green. [proof: suite-green]
