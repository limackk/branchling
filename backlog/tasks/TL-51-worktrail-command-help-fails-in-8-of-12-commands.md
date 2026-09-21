---
id: TL-51
title: "worktrail <command> --help fails in 8 of 12 commands"
type: bug
labels: [pre-launch]
board: main
epic: "CLI surface"
priority: P1
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-52]
related_docs:
  - .claude/skills/branchling-cli/SKILL.md
  - .claude/skills/branchling-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/cli-help.test.mjs"
  - bash: "node scripts/cli.mjs stats --help >/dev/null 2>&1 && echo 'stats --help — OK' || { echo 'still fails'; exit 1; }"
  - bash: "node scripts/cli.mjs query --help | head -1 | grep -q '#!' && { echo 'help still prints the source'; exit 1; }; echo 'query --help without a shebang — OK'"
---

## Goal

The promise from the main help — "`worktrail <command> --help` shows the
command's flags" — has to be true for every command.

## Context

Measured on 2026-08-31, `node scripts/cli.mjs <command> --help` for all
twelve commands in the `COMMANDS` table:

| Behavior | Commands |
|---|---|
| fails: "unknown flag: --help", exit code 2 | `build`, `viewer`, `next-id`, `board`, `history`, `new`, `init`, `stats` |
| works | `check`, `migrate-prefix` |
| works, but prints the module's source comment — including the `#!/usr/bin/env node` line | `query` |
| not checked (would start a server) | `serve` |

**Where this came from.** [TL-25](TL-25-closing-the-flag-validation-gap-in-5-worktrail-commands.md)
closed off flag validation in five commands — rightly, because a silent
no-op looks like it worked. But the list of allowed flags did not include
`--help`, so a good change turned the help flag into a usage error. This is a
regression of that task, not a separate hole: exactly the same mechanism that
protects against a typo also blocks the one flag a user types when they DO
NOT KNOW what flags exist.

**Why this hurts more than it looks.** `--help` is typed at a moment of
uncertainty. An "unknown flag" response with exit code 2 teaches that the
tool has no help — when the main help just promised that it does. A program
that breaks its own promise costs more trust than one that promised nothing.

`query --help` is a separate case: it prints its own module header via
`readFileSync(import.meta.url).split("*/")`. The content is valuable, but it
is a note for a fellow contributor, not help for a user — it starts with the
shebang and talks about token costs.

`serve --help` needs care during testing: if it is not handled, the command
will start the server and the test will hang. That is why verification goes
through `node --test` with `spawnSync` and a timeout, not through a shell
loop.

## Pre-flight reading

1. `scripts/cli.mjs` — `COMMANDS` (the `usage` field is already in the table), `HELP_FLAGS`, `runScript`.
2. `scripts/query.mjs` — the flag validation pattern and today's `--help` handling.
3. [TL-25](TL-25-closing-the-flag-validation-gap-in-5-worktrail-commands.md) — why an unknown flag fails; this rule stays.
4. `.claude/skills/branchling-cli/references/output-style.md` §7 — the help layout.

## Steps

1. Decide where a command's help lives. The `COMMANDS` table already holds `usage` — cheapest is for `cli.mjs` to intercept `--help`/`-h` BEFORE spawning and print the command's `usage`. Then no command has to remember this flag, and the promise from the main help is fulfilled from a single place.
2. If a command has more to say than one `usage` line (`check` already does), let the table allow multi-line text — the way `CHECK_USAGE` does today.
3. `--help` in every path: output to stdout, exit code 0. This is not a usage error.
4. `query.mjs` — stop printing its own module header; print the same thing as the table, possibly with a list of flags.
5. `serve` — handle `--help` without starting the server.
6. Test `scripts/tests/cli-help.test.mjs`: for EVERY command in `COMMANDS` (iterating over the table, not a manual list — otherwise a new command would slip past the test) `--help` exits with code 0, writes to stdout, does not write to stderr, and does not contain the shebang. `spawnSync` with a `timeout`, so `serve` does not hang the suite.

## Acceptance criteria

- [ ] `worktrail <command> --help` exits with code 0 for every command in `COMMANDS`.
- [ ] `--help` output goes to stdout, not to stderr.
- [ ] `query --help` does not print the shebang or the source comment.
- [ ] `serve --help` does not start the server.
- [ ] The test iterates over the `COMMANDS` table, so a new command without help fails.
- [ ] An unknown flag STILL fails with code 2 — the rule from TL-25 is untouched.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the CLI surface audit
- 2026-08-31 in_progress — agent:claude — implementation started
- 2026-08-31 done — agent:claude — resolution from step 1: `cli.mjs` intercepts `--help` BEFORE spawning and assembles help from the table (`summary` says WHAT FOR, `usage` says HOW — both fields already existed, what was missing was a path for the user to see them). No command has to remember this flag, and a new one gets help just by being entered into `COMMANDS`. The dead `--help` handler in `runCheck` removed. 13/13 commands, code 0, stdout.
- 2026-08-31 done — agent:claude — the two direct-invocation paths fixed too, because `node scripts/<x>.mjs` bypasses the dispatcher: `query.mjs` stopped printing its own file's header (along with the shebang and the paragraph about token costs) — the flag list is now DERIVED from the same sets it uses to validate input, so it cannot drift from them; `serve-backlog.mjs` handles `--help` before binding the port.
- 2026-08-31 done — agent:claude — A REGRESSION CAUGHT ON ITSELF, worth recording. The first version scanned arguments against `HELP_FLAGS`, which also contains the bare word `help` — which meant `worktrail query --text help --count` printed help instead of counting matches. So the fix for a silent no-op itself introduced a silent no-op, in the same command. Inside a command's arguments, only `--help` and `-h` count as help; `worktrail help` stays, because there that word stands in the command's position. Separate test.
- 2026-08-31 done — agent:claude — test `cli-help.test.mjs`, 10 assertions, iterates over `COMMANDS`, not a manual list: a manual list means a new command silently drops out of coverage, i.e. the same hole comes back at the first opportunity. `spawnSync` with a time limit, because `serve` without `--help` handling does not fail, it starts listening. A positive control on the table's non-emptiness, and an assertion that an unknown flag STILL fails — a fix that let everything through would also make `--help` green. 328/328.
