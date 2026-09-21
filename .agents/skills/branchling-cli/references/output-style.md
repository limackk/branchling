# branchling terminal output style

Contents:

1. [When color is allowed](#1-when-color-is-allowed)
2. [The palette](#2-the-palette)
3. [Symbols](#3-symbols)
4. [The `ui.mjs` module](#4-the-uimjs-module)
5. [Layout and alignment](#5-layout-and-alignment)
6. [Anatomy of an error](#6-anatomy-of-an-error)
7. [Help layout](#7-help-layout)
8. [Worked example: the stats report](#8-worked-example-the-stats-report)
9. [Testing output](#9-testing-output)

---

## 1. When color is allowed

Decide in one module, and decide at the moment of PAINTING rather than at import
(TL-238: frozen at import, the decision belonged to whoever imported first, and
twelve tests were asserting the observer's terminal instead of the function).
Color is on only when **all** of these hold:

- `process.env.NO_COLOR` is unset (any value, including empty, means off — this
  is the [no-color.org](https://no-color.org) convention and users expect it),
- `process.env.TERM` is not `dumb`,
- the target stream is a TTY (`process.stdout.isTTY` for stdout, checked
  separately for stderr — one can be redirected while the other is not),
- `--no-color` was not passed.

`FORCE_COLOR` overrides the TTY check upward, for CI logs that render ANSI on
purpose. `--color` does the same explicitly. Both switches are taken off the
argument list ONCE, in `cli.mjs`, before dispatch — after `--` they are text,
like every other global flag (TL-247).

This ordering matters: a user who pipes output into `grep` gets clean text
without asking, and a user who wants color in a captured log can insist. Both
are one condition, not a special case sprinkled through the code.

Truecolor is not worth detecting here. The 16 standard ANSI colors are the ones
that respect the user's terminal theme; a hand-picked hex value that looks good
on your background is unreadable on someone else's. **Use the basic 16, plus
bold and dim.**

## 2. The palette

Six roles, no more. Adding a seventh means the output is carrying more
distinctions than a reader can hold. They are `ROLES` in `scripts/ui.mjs`; the
table below is here for the third column — what each one is FOR — which the code
cannot state:

| Role | Style | Used for |
|---|---|---|
| `ok` | green | a guard passed, a file was written, a task closed |
| `warn` | yellow | it worked, but you should know something |
| `err` | red | it did not work |
| `id` | cyan | task IDs, file paths, commands to run — the things you copy |
| `dim` | dim | units, hints, counts of zero, generated-file notices |
| `bold` | bold | headings and the one number a line is about |

Status and priority get their color from meaning, never from a hardcoded name:
the vocabulary lives in `config.yaml` and a project may define statuses this
code has never heard of. Map by index or by role (`archived_statuses` → dim,
`P0`/first priority → red), the same way the viewer derives its badge palette
from the config lists.

## 3. Symbols

`✓` success · `✗` failure · `!` warning · `·` a neutral bullet · `→` a
consequence or a suggested next command.

They carry the meaning when color is off, which is the point. Keep them ASCII-
adjacent and single-width; box drawing and emoji break alignment in terminals
that measure them differently, and a misaligned table is worse than a plain one.

## 4. The `ui.mjs` module

One module, imported by every command. It EXISTS — this section used to propose
it, and a proposal read as a description for as long as it took somebody to
notice (TL-159). Do not copy its surface into this file; a signature list here
is a second place to be wrong. Read the real one:

```
grep '^export' scripts/ui.mjs
```

Three things about it are worth knowing before you open it: the painters
(`color` for stdout, `errColor` for stderr) decide at the moment they PAINT and
not at import (TL-238), so a test may set `NO_COLOR` after importing; `plain` is
the painter that never paints, for tests and `--json`; and `refusal()` is the
one shape for "you passed something I do not accept" (see §6).

Every function returns or prints plain text when color is off. Nothing outside
this module writes an escape sequence — that is what makes `NO_COLOR` a property
of the program rather than a promise each file makes separately.

`--json` bypasses all of it. JSON output is never colored and never has a
decorative line above it; something is parsing it.

## 5. Layout and alignment

- **Numbers right-align in a fixed column** so magnitudes are comparable at a
  glance. `stats-report.mjs` already does this with `padStart`.
- **Labels left-align** in a column sized to the widest label, computed rather
  than hardcoded — a config with longer status names must not break the table.
- **Never truncate an identifier.** Truncating a title is fine (add `…`);
  truncating an ID produces something the user cannot paste back.
- **Two-space indent per level**, at most two levels. A third level means the
  output wants to be two commands.
- **One blank line between sections**, never two.
- Respect `process.stdout.columns` when wrapping prose; fall back to 80 when it
  is undefined (piped output).

## 6. Anatomy of an error

Three parts, in this order, on stderr — **and they are a function, not a
convention you retype**: `failure()` composes them, and `refusal()` is the
special case for an argument a command does not accept. Written as a convention
this anatomy produced four wordings across the table (`available:`, `known
flags:`, `known:`, a bare `usage:`, and in one command nothing at all); TL-220
replaced all of them with the one call, because the wording is what
`help-covers-flags.test.mjs` reads the accepted set out of.

```
✗ branchling query: unknown flag: --statu
  available: --blocked-by --board --count … --text --type -h
  → branchling query --help
```

(The list is elided here on purpose: the real one comes from the command, and
`branchling query --statu` prints today's.)

1. **What went wrong**, prefixed with the command *as the user typed it* — not
   the script's filename. `branchling build`, not `[build-backlog]`.
2. **What was expected**, concretely. A list of valid values beats the word
   "invalid".
3. **What to do next**, as a command that can be pasted.

The first sentence names the EVENT, and three events are kept apart: `unknown
flag:` for a word beginning with `-`, `unknown subcommand:` where a subcommand
was expected, `unexpected argument:` where nothing was. Collapsing them costs
the reader the one word that says which mistake they made.

The best error names the thing the user can act on. Compare:

- `Error: Cannot find backlog directory` + a stack trace
- what `branchling query` actually prints outside a backlog: `✗ branchling
  query: no backlog here: /home/me`, then how to point at an existing one
  (`--dir`, `BACKLOG_DIR`, a directory with `backlog/tasks/`), then how to
  start one (`branchling init --dir <path>`)

The second one costs three lines and turns a first-contact failure into an
onboarding step. A stack trace tells the user the tool crashed; a predicted,
documented state should never be presented as a crash.

## 7. Help layout

Run `branchling --help`; this is its shape, and the summaries are not repeated
here because they are one `summary` field away in `COMMANDS`:

```
branchling — <one line, from the package description>

usage:
  branchling                 run the viewer (the same as `branchling serve`)
  branchling <command> [flags]

commands:
  serve           run the viewer on 127.0.0.1 (the default command)
  query           ask about tasks — reads tasks/*.md, so it sees changes …
  …

`branchling <command> --help` prints that command's flags.
`--dir <path>` points at a different backlog; it works on every command.
```

Examples earn their space where a command has them: they are the fastest path
from reading help to a working command, and they show flag combinations that a
flag list cannot.

The top-level help promises `branchling <command> --help`, and every command
honours it — that is asserted, per command, by `scripts/tests/cli-help.test.mjs`
(exit 0, on stdout), and what it prints must declare the flags the command
accepts (`help-covers-flags.test.mjs`). A promise the program breaks is worse
than no promise, so both promises have a test rather than a paragraph.

## 8. Worked example: the stats report

This section once held a "current" shape and a "target" shape; the target was
built (`scripts/stats-report.mjs`) and the "current" half went on quoting a
Polish label that no longer exists (TL-159). Run `branchling stats` for today's
output. Its shape:

```
branchling — /home/me/project/backlog

  tasks in total           422
  active                    39
  archived                 383

status (all):
    pending                 38
    …

  waiting on other tasks     5  non-empty blocked_by
  work to be done       81 h (10 working days)
```

Why it is built that way, which is the part worth carrying: a heading names the
backlog the numbers came from, because a session with several trees open cannot
otherwise tell; numbers right-align in one column so magnitudes compare at a
glance; zero counts are printed and dimmed rather than dropped, since a missing
row reads as a missing category; units are dim so the number stays the thing you
see. Nothing here needs color to be understood.

## 9. Testing output

Assert on structure, not on escape sequences. Run the command with `NO_COLOR=1`
and assert the text; assert separately that `color.enabled` is false under
`NO_COLOR` and true under `FORCE_COLOR`. That keeps the tests readable and stops
a palette change from breaking twenty assertions.

Two guards that used to be "worth having" now exist, and a new command joins
them rather than re-deriving them: `json-output.test.mjs` asserts that every
reading command's `--json` parses and that stdout carries the document and
nothing else, and `json-pipe.test.mjs` pins the same answer through a pipe,
where `process.exit` once truncated it at 64 KB.
`suite-is-terminal-independent.test.mjs` is the third: the suite must answer the same at a keyboard as through
a pipe, which is why the painters decide when they paint and take the painter as
an argument.

A test that would still pass against an empty backlog is green without proving
anything — give it a positive control.
