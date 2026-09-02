---
id: TL-52
title: "Color and consistent CLI messages in a single ui.mjs module"
type: task
labels: [pre-launch]
board: main
epic: "CLI surface"
priority: P1
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-51]
blocks: []
related_docs:
  - .claude/skills/worktrail-cli/SKILL.md
  - .claude/skills/worktrail-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/ui.test.mjs"
  - bash: "grep -q $'\\033' scripts/ui.mjs || { echo 'positive control: ui.mjs has not a single sequence, so the test below would be green on an empty sample'; exit 1; }; test -z \"$(grep -rl $'\\033' scripts --include='*.mjs' | grep -v 'scripts/ui.mjs' | grep -v 'scripts/tests/')\" && echo 'control sequences only in ui.mjs — OK'"
  - bash: "node scripts/cli.mjs stats 2>&1 >/dev/null | wc -c | grep -q '^ *0$' && echo 'stats: diagnostics do not mix with the response — OK'"
  - manual: "Output of `stats`, `check`, `query` reviewed in the terminal and through `| cat` — the same content, no color in a pipe."
---

## Goal

Give the CLI **one style module**: color, symbols, alignment and a uniform
error message shape — so the output is readable, and `NO_COLOR` is a
property of the program, not a promise made separately by every file.

## Context

Measured 2026-08-31 across the whole `scripts/` and `bin/` tree: **zero
control sequences**, zero references to `isTTY`, zero handling of
`NO_COLOR` and `FORCE_COLOR`. The output is correct and completely flat.

On top of that, message prefixes come from file names, not from the command
the user typed:

| Prefix in the code | What the user typed |
|---|---|
| `[build-backlog]` | `worktrail build` |
| `[backlog-viewer]` | `worktrail viewer` |
| `next-backlog-id:` | `worktrail next-id` |
| `suggest-board:` | `worktrail board` |
| `[backlog-history]` | `worktrail history` |
| `[worktrail new]`, `[worktrail stats]` | matching |

The name `build-backlog` does not appear in any help text or user
documentation. A message that introduces itself with it sends the reader
looking for something that does not exist.

**Why this is a task, not cosmetics.** This project is betting that a
developer will like the tool enough to push for adopting it at their
company. The CLI is what they see first. At the same time, the output has
to stay honest: it is read through a pipe, in a CI log, and by people who
cannot distinguish shades.

**The rule that ties this together:** color is an underline, never
information. Whatever color says, a word or a symbol must say too. The full
contract — when coloring is allowed, six palette roles across 16 ANSI
colors, symbols, the anatomy of an error, the layout of help — lives in
`.claude/skills/worktrail-cli/references/output-style.md`, and this task
implements it rather than inventing it anew.

**Order relative to
[TL-51](TL-51-worktrail-komenda-help-oblewa-w-8-z-12-komend.md):** help has
to exist first, then it gets to look good. The reverse order would mean
designing the layout of text that does not exist in eight commands.

## Pre-flight reading

1. `.claude/skills/worktrail-cli/references/output-style.md` — the WHOLE
   thing; this task implements it.
2. `scripts/stats-report.mjs` — today's formatting (`pad`, `line`), to be
   carried over.
3. `scripts/check-backlog-*.mjs` — the `✓`/`✗` messages, the only place
   symbols already exist.
4. `scripts/query.mjs` — what a flag validation error looks like today.

## Steps

1. `scripts/ui.mjs`: `color` (on/off computed ONCE at import), `line`,
   `heading`, `ok`, `warn`, `fail`, `fatal`, `table`. Nothing outside this
   module writes control sequences.
2. Condition for color: `NO_COLOR` unset, `TERM` different from `dumb`, the
   stream is a TTY, no `--no-color`. `FORCE_COLOR` and `--color` force it
   on. Computed separately for stdout and stderr — one can be redirected
   while the other is not.
3. Palette: the 16 basic ANSI colors plus `bold`/`dim`. No hexadecimal
   values — they ignore the user's terminal theme.
4. Derive status and priority colors from `config.yaml` (role, index), not
   from names hardcoded into the code. The viewer has done it this way for a
   long time, and thanks to that a new status gets a color without a code
   change.
5. Switch the commands to `ui.mjs`; the message prefix is the command name
   FROM the `COMMANDS` table, not the file name.
6. Unify the anatomy of an error: what happened → what was expected (a
   concrete list) → what to do next (a command to paste).
7. `--json` gets neither color nor a heading — something parses it.
8. `--no-color` added to the flag validation of every command (today an
   unknown flag fails, so without this step the flag would be an error).
9. Tests in `scripts/tests/ui.test.mjs`: `NO_COLOR=1` turns it off,
   `FORCE_COLOR=1` turns it on despite no TTY, the output without color is
   identical in content, `--json` never contains a sequence.

## Acceptance criteria

- [ ] `scripts/ui.mjs` exists and is the only production file with control
      sequences.
- [ ] `NO_COLOR=1` gives clean text in every command; through a pipe too.
- [ ] `FORCE_COLOR=1` turns color on without a TTY.
- [ ] The prefix of every message is the command name the user types.
- [ ] Every error message says what to do next.
- [ ] Status/priority colors come from the configuration, not from
      literals.
- [ ] `--json` without color and without decoration.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from an audit of the CLI surface
- 2026-08-31 done — agent:claude — `scripts/ui.mjs`: `colorAllowed`
  computed ONCE at import and SEPARATELY for stdout and stderr (one can be
  redirected while the other is not), six palette roles across the 16 basic
  ANSI colors, `MARK`, `line`, `table`, `heading`, `failure`/`fail`,
  `statusPaint`/`priorityPaint`. Zero hexadecimal values: the 16-color
  palette is mapped by the terminal's THEME, so it keeps the user's own
  contrast and background — a manually chosen shade only looks good against
  the background it was chosen on.
- 2026-08-31 done — agent:claude — `--no-color`/`--color` handled ONCE, in
  the dispatcher: stripped from the arguments and passed to the child
  through the ENVIRONMENT, which `ui.mjs` already listens to. The
  alternative was adding both flags to the allow-list of twelve commands,
  that is, twelve chances to forget one. Flag validation in the commands
  untouched.
- 2026-08-31 done — agent:claude — 42 occurrences of file-name prefixes
  replaced with the COMMAND name: `[build-backlog]` → `worktrail build:`,
  `next-backlog-id:` → `worktrail next-id:`, `[backlog-serve]` →
  `worktrail serve:`, and eight others. None of those names appear in the
  help or the documentation, so the message sent the reader looking for
  something that does not exist. A test scans the tree so they do not come
  back.
- 2026-08-31 done — agent:claude — in passing: the `check` error stopped
  echoing the whole `usage` text. Now that `check --help` works (TL-51), the
  message names the flag and points the way — a message longer than the
  help stops being a message.
- 2026-08-31 done — agent:claude — test `ui.test.mjs`, 13 assertions. The
  most important one compares `check` run with `NO_COLOR=1` and with
  `FORCE_COLOR=1` after stripping the sequences: the content MUST be
  identical, because color is an underline, never information. The strength
  of both policing assertions was checked by sabotage — an escape added
  outside `ui.mjs` fails the scan, and a "painter" that only appends text in
  color fails the content comparison. The scan recognizes both spellings of
  the sequence (the raw character and the JS escape), because otherwise
  changing the spelling would be enough to smuggle in one's own coloring.
  341/341.
- 2026-08-31 done — agent:claude — STATE CORRECTION. The work was finished
  and committed (39771a4), but the frontmatter stayed at `pending`: the call
  meant to move the status to `in_progress` was rejected in its entirety
  together with the write to `ui.mjs`, and at closing time the substitution
  `in_progress` → `done` found no match and passed silently. The log said
  `done`, the field said `pending` — and no gate saw it. A guard for this
  drift: [TL-68](TL-68-log-mowi-done-frontmatter-mowi-pending-nikt-tego-nie-lapie.md).
