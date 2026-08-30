# worktrail terminal output style

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

Decide once, at import time, in one module. Color is on only when **all** of
these hold:

- `process.env.NO_COLOR` is unset (any value, including empty, means off — this
  is the [no-color.org](https://no-color.org) convention and users expect it),
- `process.env.TERM` is not `dumb`,
- the target stream is a TTY (`process.stdout.isTTY` for stdout, checked
  separately for stderr — one can be redirected while the other is not),
- `--no-color` was not passed.

`FORCE_COLOR` overrides the TTY check upward, for CI logs that render ANSI on
purpose. `--color` does the same explicitly.

This ordering matters: a user who pipes output into `grep` gets clean text
without asking, and a user who wants color in a captured log can insist. Both
are one condition, not a special case sprinkled through the code.

Truecolor is not worth detecting here. The 16 standard ANSI colors are the ones
that respect the user's terminal theme; a hand-picked hex value that looks good
on your background is unreadable on someone else's. **Use the basic 16, plus
bold and dim.**

## 2. The palette

Six roles, no more. Adding a seventh means the output is carrying more
distinctions than a reader can hold.

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

One module, imported by every command. Suggested surface — small enough that no
command is tempted to reach past it:

```js
export const color = { enabled, ok, warn, err, id, dim, bold };  // string → string
export function line(label, value, note);   // aligned "  label      42  note"
export function heading(text);              // section heading
export function ok(msg); export function warn(msg); export function fail(msg);
export function fatal(message, hint, code); // stderr + exit
export function table(rows, columns);       // aligned columns, no borders
```

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

Three parts, in this order, on stderr:

```
✗ worktrail query: unknown flag: --statu
  available: --status --priority --board --label --epic --json --files --count
  → worktrail query --help
```

1. **What went wrong**, prefixed with the command *as the user typed it* — not
   the script's filename. `worktrail build`, not `[build-backlog]`.
2. **What was expected**, concretely. A list of valid values beats the word
   "invalid".
3. **What to do next**, as a command that can be pasted.

The best error names the thing the user can act on. Compare:

- `Error: Cannot find backlog directory` + a stack trace
- `✗ worktrail: no backlog here (looked upward from /home/me)` / `→ worktrail init
  --dir ./backlog` / `→ or point at an existing one: --dir <path>`

The second one costs three lines and turns a first-contact failure into an
onboarding step. A stack trace tells the user the tool crashed; a predicted,
documented state should never be presented as a crash.

## 7. Help layout

```
worktrail — a backlog that lives in markdown files

usage
  worktrail                     start the viewer (same as `worktrail serve`)
  worktrail <command> [flags]

commands
  serve      start the viewer on 127.0.0.1 (default command)
  query      ask the backlog a question
  …

examples
  worktrail query --status blocked
  worktrail new --title "Fix the retry loop" --priority P1
  worktrail check

`worktrail <command> --help` shows that command's flags.
`--dir <path>` points at another backlog; it works in every command.
```

Examples earn their space: they are the fastest path from reading help to a
working command, and they show flag combinations that a flag list cannot.

If the top-level help promises `worktrail <command> --help`, every command has to
honour it. A promise the program breaks is worse than no promise.

## 8. Worked example: the stats report

Current shape (correct, plain):

```
  tasks in total             47
  aktywnych                 14
```

Target shape — same numbers, structure made visible:

```
worktrail · /home/me/project/backlog

  tasks            47      14 active · 33 archived

  status           pending 14   in_progress 0   blocked 0
  priority         P2 7   P3 7
  waiting on others 7      non-empty blocked_by
  work remaining   102 h   ≈13 working days
```

What changed and why: totals and their breakdown sit on one line because they
answer one question; zero counts are dimmed rather than dropped, since a missing
row reads as a missing category; units are dim so the number stays the thing you
see. Nothing here needs color to be understood.

## 9. Testing output

Assert on structure, not on escape sequences. Run the command with `NO_COLOR=1`
and assert the text; assert separately that `color.enabled` is false under
`NO_COLOR` and true under `FORCE_COLOR`. That keeps the tests readable and stops
a palette change from breaking twenty assertions.

Two guards worth having, because both defects are silent:

- stdout carries no diagnostics: capture both streams and assert the answer is
  entirely on stdout.
- `--json` output parses, on every reading command, including when there are
  zero results.

A test that would still pass against an empty backlog is green without proving
anything — give it a positive control.
