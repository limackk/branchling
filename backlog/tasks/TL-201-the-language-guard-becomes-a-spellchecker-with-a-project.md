---
id: TL-201
title: "The language guard becomes a spellchecker with a project dictionary"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:dev
role: dev  # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-03
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-198]                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
  - id: catches-the-hole
    bash: "node --test scripts/tests/public-language.test.mjs"
---

## Goal

`branchling check --language` decides by a DICTIONARY of words the project
accepts, not by a list of shapes one particular other language takes. The rule
it defends does not change: every file a stranger reads when they open this
repository is written in English.

## Context

Decided on 2026-09-03 after TL-198 reported that the guard passes over `Tryb`
— a Polish word carrying no accent and no ending the guard recognises.

**The mechanism cannot be completed, and that is the argument.** Today the
guard is a blocklist: diacritics, a stop-word list, and word shapes
(`scripts/check-public-language.mjs`, 391 lines). Every hole in it is another
word, and there is always another word. A dictionary inverts the question —
an unknown word FAILS — so the check is closed by construction rather than by
however many patterns somebody thought of. It also catches typos, which the
present guard cannot.

    guard today: 391 lines of heuristic, 63 `language-guard: allow` markers
                 (13 in backlog/tasks, 2 in scripts, 2 in scripts/tests, 1 in
                 CLAUDE.md, the rest across docs)

Those 63 markers are the tax being paid: each is a line of noise beside the
line it excuses, and each is a place to be wrong. A dictionary moves them into
one file where a reader can see the whole vocabulary at once.

**What must NOT change.** `PUBLIC_PATHS` stays as it is — `scripts`, `bin`,
`README.md`, `_template.md`, `backlog`, `docs`, `skills`. The boundary was
moved deliberately by TL-137 to "what a stranger reads when they open the
repository", and narrowing it back to the npm tarball would be a different
decision, made quietly, under cover of a mechanism change. `history/*.jsonl`
stays out by file extension, as today.

**The dependency is the real cost.** This project has zero production
dependencies. A spellchecker is a dev dependency at most, and ideally is
invoked without one — the check must keep working from a clean checkout with
`npm test` and no network. Decide between a vendored word list read by our own
code and an external tool run only in CI; a check that a contributor cannot
run locally is a check that fails only for them, in public.

**A migration, not a patch.** TL-198 asked for the hole to be closed or
declared. This closes it by replacing the mechanism, so TL-198 must not be
worked on first: patching the heuristic spends effort on the thing being
removed. It is `blocked_by` this task for that reason.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — the whole guard, and in particular
   the header explaining why it is not only a diacritics grep, why code spans
   and link targets are stripped, and what `PUBLIC_PATHS` covers.
2. `backlog/tasks/TL-198-*.md` — the hole that prompted this, and the sentence
   that settles the direction: a guard that reports "none matching" over a
   line in the wrong language is read as a pass.
3. `CLAUDE.md` §Language — the rule itself, including the three things a guard
   enforces and the parts deliberately left to the rule.
4. `package.json` — the dependency position this project holds today.

## Steps

1. Choose the checker and where it runs, then record that choice in this
   task's Decisions with the reason and the rejected option.
2. Build the dictionary from the current tree, and put it in ONE file.
3. Convert the 63 `language-guard: allow` markers: each one is either a
   dictionary entry or a genuine exception that keeps a marker. Say in the
   commit how many of each.
4. Keep `check --language` as the command name and its output shape; a caller
   parsing it must not have to change.
5. `scripts/tests/public-language.test.mjs` must contain a positive control
   using `Tryb` — the word the old guard passed — over a fixture, never over
   this repository.

## Decisions

**The checker is our own code over a vendored word list** —
`scripts/language-dictionary.txt`, read by `check-public-language.mjs`. No
dependency, no network, one file.

Rejected: an external spellchecker (`cspell`, `hunspell`) as a dev dependency
or a CI-only step. A check a contributor cannot run from a clean checkout is a
check that fails only for them, in public. Rejected too: vendoring a general
English word list — `web2` is 2.4 MB, it would ship in the tarball for a
dev-only guard, and 5,320 of the words this tree writes are not in it anyway,
so the project half would still have to be built.

**The dictionary is a SNAPSHOT of the tree, not a rule derived from one.**
`--update-dictionary` regenerates it; the check never does. A dictionary that
rebuilt itself on every run would accept whatever was written last and answer
with a tick for ever.

**The three blocklists stay, and the dictionary runs after them.** They are
strictly narrower and would be redundant alone, but they name WHY a line is
foreign — `diacritics`, `word`, `words`, `shape`, `label` — and that reason
code is what tells an author whether they wrote the wrong language or
misspelled the right one. Four regular expressions is a cheap price for it.

**What the snapshot inherited.** It was taken from a tree that still carried
Polish inside `scripts/tests/`, so those words are in the file. That debt is
TL-229 and TL-128, and closing either means deleting the words it translated
from the dictionary in the same commit.

**Step 3 was not done.** Not one of the 71 `language-guard: allow` markers
could be converted, because converting a marker means deleting the signal it
excuses, and every one of those signals is asserted by name in
`scripts/tests/public-language.test.mjs`. Five markers were ADDED instead: the
generator skips a marked line, so the marker now also keeps a deliberately
foreign sample out of the vocabulary that would otherwise let the next one
through.
