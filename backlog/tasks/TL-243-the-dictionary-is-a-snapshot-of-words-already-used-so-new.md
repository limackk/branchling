---
id: TL-243
title: "The dictionary is a snapshot of words already used, so new English fails"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-04
updated: 2026-09-04
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: ordinary-english-passes
    bash: "node --test scripts/tests/public-language.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

Writing an ordinary English word this repository has not used before does not
fail a guard. Today it does, because the dictionary is a snapshot of the words
already in the tree.

## Context

TL-201 replaced three blocklists with a spellchecker and a project dictionary —
the right trade, and the reasoning in `check-public-language.mjs` holds. The
dictionary is generated from the tree by `--update-dictionary` and committed,
deliberately not rebuilt on every run, so that a bad word cannot legitimise
itself by being written once.

The consequence showed up within minutes of the guard landing, on the first new
sentence written after it, in this session:

```
✗ language: the public surface is not English
  - backlog/tasks/TL-242-….md:100 (unknown word: alternating)
```

`alternating` is ordinary English. It failed because nobody had used it here
before. The regeneration diff was exactly one line, which is the proof: the
dictionary is not a vocabulary of English, it is an inventory of this tree.

It has now happened five times in one day, on five different sentences:
`alternating`, then `accumulated` and `exchanges`, then `bind` and
`projections`, then `correctable` - the last three while tasks were being
filed about the guard's own cost. Each regeneration diff was one or two
lines. Two of those occurrences cost an agent run: the guard fires at
the end of the work, after the commit is written.

The cost is small per word and unbounded in aggregate: every author meets it,
the fix is a command they have to know, and the natural response to a guard that
fires on correct writing is to stop reading its output. That is how a real
finding gets missed — the same argument TL-236 makes about `check` as a whole.

Nothing here argues for removing the guard. It caught a real Polish word in
`scripts/tests/` (TL-229) that three blocklists had missed for weeks.

## Steps

1. Establish the false-positive rate: run the guard against a corpus of ordinary
   English prose that is NOT this repository, and count. Without a number this
   is an anecdote.
2. Decide whether a base English word list ships beside the project dictionary,
   so the project file holds only what is genuinely local — names, identifiers,
   domain terms. `hunspell`/`aspell` word lists are the obvious source and the
   licensing has to be checked before anything is vendored.
3. Whatever is decided, the refusal must name the remedy in the same breath: it
   currently names the word and the file, and not the command that fixes it.
4. Give the remedy a place on the CLI. `--update-dictionary` lives only on
   `scripts/check-public-language.mjs`; `branchling check --language
   --update-dictionary` is refused as an unknown flag and the known-flag list
   printed beside the refusal does not contain it. The command that fixes a
   branchling refusal is therefore not a branchling command, so step 3 cannot
   be satisfied without this: naming `node scripts/check-public-language.mjs`
   in a CLI message would be the first place the tool sends a user around
   itself. Measured on 2026-09-04.

## Decisions

**The snapshot stays a snapshot.** Rebuilding on every run would let one Polish
word entering the tree teach the guard to accept it, which is the defect the
snapshot exists to prevent.

**Not a per-word allow comment.** `language-guard: allow` beside every unusual
English word would put the escape hatch on the wrong side: the word is correct,
and it is the dictionary that is short.
