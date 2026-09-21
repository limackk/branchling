# Contributing

**Pull requests are welcome, under a DCO.** Sign your commits off — `git commit
-s` — and that is the whole formality: no CLA, no paperwork, nothing to sign
before your first typo fix. The reasoning, and what accepting a DCO costs this
project, is in
[`docs/license-and-contributions.md`](docs/license-and-contributions.md).

The code is MIT, and your contribution goes out under MIT.

---

## Running it

Node 18 or newer. **There are no dependencies**, so there is nothing to install:

```bash
git clone <repository-url> branchling
cd branchling
node --test scripts/tests/*.test.mjs   # the suite
node scripts/cli.mjs check             # the guards
node scripts/cli.mjs --help            # what the tool does
```

`npm link` puts a `branchling` binary on your PATH if you would rather type that
than `node scripts/cli.mjs`.

CI runs both of the above on Node 18, 20 and 22, on Linux and macOS, on every
push and every pull request. It also asserts that the published tarball carries
the tool and not this project's own backlog — and that no runtime dependency has
appeared, because the absence of one is a promise the README makes.

---

## This repository tracks itself with itself

`backlog/` is branchling's own backlog, kept in the tool's own format. It is not
a demo: it is the development history, because the git history was flattened
when the project was extracted ([`LINEAGE.md`](LINEAGE.md)). If you want to know
why something is the way it is, the task that decided it is usually a better
answer than the diff.

```bash
node scripts/cli.mjs query --status pending --priority P0,P1
node scripts/cli.mjs instructions overview
```

An issue that turns into work gets a task file in `backlog/tasks/`, which is how
it becomes something anyone can pick up.

---

## What a change has to carry

Four things, and each of them is a rule this project has paid for:

1. **A test, and one that could fail.** A guard that passes on an empty sample
   is green with no evidentiary force — so an assertion about a refusal is
   paired with the run that must succeed. Look at any `scripts/tests/*.test.mjs`
   header for what that means in practice.
2. **Whatever the user reads.** `--help` for a new flag, the error message for a
   new refusal, and `docs/manual.md` for a new contract. An unknown command and
   an unknown flag must FAIL — a silent no-op looks exactly like the tool
   working.
3. **`node scripts/cli.mjs check` passing.** The guards judge the SET: a change
   that passes its own test can still leave a dangling reference, a board that
   no longer exists, or a link into a void.
4. **The reasoning, in the commit body.** Including what you decided against.
   The title says what is now TRUE rather than what you did — `an unexecutable
   plan fails` rather than `add plan guard` — because that is the difference
   between a `git log` that answers questions and one that lists files.

Everything in the repository is written in English, including the backlog,
filenames and commit messages. Task files use lowercase English slugs after
their immutable ids — TL-385 renamed the last 134 that did not. No guard
decides whether prose is English; the one that tried recognised a single
language and was removed for it, so the language of a sentence, a filename or a
commit title is settled in review. `node --test
scripts/tests/task-filename-shape.test.mjs` enforces the SHAPE a filename must
have, and that `new` generates one.

---

## Before writing anything large

Read [§3 of `docs/license-and-contributions.md`](docs/license-and-contributions.md).
The CLI is deliberately a **single-machine** tool: everything that serves one
person in one clone is open and stays open, and coordination between people and
between clones is out of its scope. A patch can be good and still fall on the
wrong side of that line, which is why the line is written down instead of
discovered at review.

Two other places worth reading first, because they are where the project's
opinions live rather than its code:

- [`docs/branchling-global-tool.md`](docs/branchling-global-tool.md) §3 — the four
  rules everything else follows from. Data in the repository and pointers
  globally; what is computed may be deleted; configuration layers are disjoint
  rather than ranked; extension by composition and not a plugin API.
- [`CLAUDE.md`](CLAUDE.md) — written for an agent working in this repository,
  and just as true for a person: how the data directory is resolved, why the id
  prefix is never a literal, and why session state lives outside the tree.

---

## Reporting something

An issue template asks for `branchling --version`, your Node version and your
operating system. They are asked for because the three of them settle most
questions before anybody has to guess, not as ceremony — and a report without
them usually costs a round trip.
