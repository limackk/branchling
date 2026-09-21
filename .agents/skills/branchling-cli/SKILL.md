---
name: branchling-cli
description: Add or change a command in the branchling CLI, or change anything it prints. Covers the command table in scripts/cli.mjs, flag validation, --help, --json, --dir, exit codes, error message shape, and the terminal output style (color, symbols, alignment, TTY and NO_COLOR handling). Use this skill whenever work touches scripts/cli.mjs, a scripts/*.mjs command, bin/branchling.mjs, or anything a user reads in the terminal — including requests like "add a command", "the help is wrong", "add colors", "make the output prettier", "this error is unclear", "add --json to X".
---

# Building branchling's terminal surface

The CLI is what a developer meets before anything else, and this project is
betting on developers liking it enough to push for it at work. That makes output
a feature, not decoration. It is also the only surface where a mistake is
invisible: a command that silently ignores a flag looks exactly like a command
that worked.

## How the CLI is wired

`bin/branchling.mjs` is a shim with no logic. `scripts/cli.mjs` holds the `COMMANDS`
table and `resolveCommand()`, which is pure so tests can assert that `frobnicate`
fails without launching anything. Each command is a standalone program in
`scripts/`, spawned as a child process with its exit code propagated.

That boundary is deliberate: **the command table, help and dispatch live in
`cli.mjs`; flag validation and exit codes live in the command.** Keep it. Do not
turn a command into an imported library "while you're in there" — that is a
separate piece of work with its own test surface.

## Adding a command

1. Write `scripts/<name>.mjs` as a program that runs standalone.
2. Register it in `COMMANDS` with a `summary` (one line, lowercase, says what it
   does — this is what `branchling --help` prints) and a `usage` string built from
   the `PRODUCT_NAME` import, never a `"branchling"` literal.
3. Validate flags against an explicit allow-list and exit 2 on anything unknown.
   Print the refusal with `refusal()` from `ui.mjs`, never assembled by hand:
   since TL-220 that is the ONE anatomy the whole table shares, and its wording
   is an interface — `scripts/tests/help-covers-flags.test.mjs` reads the
   accepted set out of the `available:` line, so a command with a private
   wording is a command that guard can ask nothing of.
4. Accept `--dir` via `takeDirFlag()` from `paths.mjs`, and resolve the data
   directory with `resolveBacklogDir()`. Never compute it with your own
   `join(__dirname, "..")` — that is co-location pretending to be a rule, and it
   breaks the moment the tool is installed globally. After `--`, `--dir` is a
   VALUE and not a flag (TL-247); the separator is settled once, in `cli.mjs`.
5. Handle `--help` yourself, printing the same `usage` text the table carries,
   and declare in it every flag you accept. The two lists are compared — what
   the command refuses, against what `describeFlags()` derives from the usage —
   and the exemption list in that guard has been EMPTY since TL-217. Only
   `--dir`, `--help` and `-h` are excluded, because the main help documents them
   once as working everywhere.
6. If the command reads, give it `--json`. If it writes, make every input
   reachable without a keyboard: flags, and — where the input is a whole
   document — stdin or `--body-file`, the way `new` takes one since TL-237
   (`scripts/tests/write-input-surface.test.mjs`). That is the whole
   extensibility model — there is no plugin API.
7. Add a test under `scripts/tests/`. Take the backlog directory from
   `tests/_repo.mjs`, never by walking up from the test file.
8. Update the command table row and any usage line in `README.md`.

Run `node --test scripts/tests/*.test.mjs` before you call it done.

## The contract every command owes the user

| Concern | Rule |
|---|---|
| stdout | The answer, and only the answer. Pipeable. |
| stderr | Diagnostics, warnings, errors. Never the answer. |
| exit 0 | The question was answered — including "zero matches". |
| exit 1 | The operation failed (I/O, guard violation, inconsistent state). |
| exit 2 | The invocation was wrong (unknown flag, missing value, bad argument). |
| `--json` | Same data as the human output, stable field names, nothing else on stdout. |
| `--help` | Exits 0, prints to stdout, shows the command's own flags. |
| unknown flag | Exits 2 and names the alternatives. Never ignored. |

"Zero matches" exiting 0 matters: a script that treats an empty result as a
failure will retry forever, and a person reading `exit 2` will look for a typo
that isn't there.

## Where the gaps are written down — not here

This section used to be a list of four measured gaps. All four were closed, and
for months afterwards it went on sending sessions to fix a `--help` that already
worked, and telling them the tool had no colour from a file sitting beside
`scripts/ui.mjs` (TL-159).

**A skill is read BEFORE the code, so it is believed.** A snapshot of the
tree's defects is the one kind of content a skill cannot carry honestly: it has
no owner, nothing fails when it goes stale, and a reader has no way to date it.
The backlog is where a gap belongs — there it has an id, a verification
contract, and `branchling next` can hand it to somebody. So this file states
what is REQUIRED of the surface, and the tree answers what is missing:

```
branchling query --text cli --status pending     # open work on the command surface
branchling query --text output --status pending
branchling check                                 # the release gate's verdict today
```

The same rule holds for anything else here that a command can be asked
directly. A flag list copied into this file is stale the week after; ask
`branchling <command> --help`, or `--help --json` for the derived flag table.

## Output style

The full contract — palette, symbols, alignment, error anatomy, help layout, and
how to detect whether coloring is allowed — is in
[references/output-style.md](references/output-style.md). Read it before writing
anything that prints, and before adding the first escape sequence to this
codebase.

Two rules worth carrying without opening the file:

**Color is emphasis, never information.** Anything a color says must also be
said by a word or a symbol, because the output will be read through a pipe, in a
CI log, and by people who cannot distinguish the hues.

**Style belongs in one module.** The moment a second file writes its own escape
sequence, `NO_COLOR` becomes a per-file promise nobody can verify. Put it in
`scripts/ui.mjs`, import it, and let the tests assert one thing.

## Language

Everything in this repository is English: code, comments, help text, every
string a user reads, and the git surface. The translation is finished (TL-32,
TL-137) — nothing in `scripts/` is waiting for it, so there is no debt here to
weigh a new message against.

**No automated guard decides whether prose is English**, and `AGENTS.md` says
why: the former detector recognised only Polish, so its green said nothing
about any other language. Language is a review responsibility across the whole
surface. Do not write a message in the expectation that a gate will catch it.

The one thing that IS enforced here is the name: `PRODUCT_NAME` from
`scripts/product.mjs`, never a `"branchling"` literal in `scripts/` or `bin/`
(`branchling check --product-name`).
