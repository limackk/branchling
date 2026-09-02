---
id: TL-160
title: "A file path inside a YAML scalar is read as prose by check --language"
type: bug
labels: []
board: main
epic: "Data integrity"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
estimate: 2h                       # 30m | 2h | 1d | 1w | 1mo
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: suite
    bash: "node --test scripts/tests/public-language.test.mjs"
  - id: tree
    bash: "node scripts/cli.mjs check --language"
---

## Goal

A task file path written inside a `verification:` command must not be reported
by `worktrail check --language` as Polish prose. Today it is, and the only ways
past it are a `language-guard: allow` marker on a line that is not an exception,
or renaming the file the path points at.

## Context

Hit on 2026-09-02 while closing
[TL-68](TL-68-log-mowi-done-frontmatter-mowi-pending-nikt-tego-nie-lapie.md).
A verification entry that greps a task's own file:

```yaml
  - bash: "grep -q 'step 5 settled' backlog/tasks/TL-68-log-mowi-...-lapie.md"
```

fails `check --language`, which reports the line as Polish words. It is not
prose: it is a PATH, and CLAUDE.md settles the principle already — "a task's
filename is data, not prose", and "a filename may therefore still carry a Polish
word forever". TL-137 encoded that for two carriers only: a markdown link's
target and an inline `` `code span` ``. A path inside a YAML scalar is a third
carrier and was never considered, because until now nothing wrote one.

**Why this will recur rather than being a one-off.** `verification:` entries
routinely name the file they are proving something about, and 145 task files in
this repository still carry Polish words in their names (TL-137 deliberately did
not rename them). Every future task whose contract greps its own file meets this.

**The workaround in TL-68 was to glob** — `backlog/tasks/TL-68-*.md` — which
works and costs nothing there, but it is a workaround: it silently narrows what
the command asserts, and it is not available when a path has to be exact.

**What must NOT be done:** widening the guard to skip every quoted string. The
guard's whole value is that it reads the strings a user will see — CLI messages
live in quotes.

## Pre-flight reading

1. `scripts/check-public-language.mjs` — where the markdown-link and code-span
   carriers are excluded; the third carrier goes beside them.
2. `scripts/tests/language-guard.test.mjs` — the existing shape of the proof.
3. `CLAUDE.md`, the language section — the rule this implements, including the
   `language-guard: allow` escape hatch and why filenames are outside the rule.

## Steps

1. Decide what a path is, narrowly enough to be safe: a token with no spaces
   containing a `/` and ending in a known extension is a candidate. Record the
   choice.
2. Exclude such tokens from the word scan, the way link targets already are.
3. Test in both directions. A path with a Polish filename passes; a Polish
   SENTENCE in the same YAML scalar still fails. Without the second half the
   change is indistinguishable from switching the guard off for `verification:`.
4. Restore TL-68's exact path in its verification entry — that is the positive
   control that the reported case is actually fixed.

## Acceptance criteria

- [x] A file path with a Polish filename inside a YAML scalar does not fail the guard. [proof: suite]
- [x] A Polish sentence in the same scalar still fails. [proof: suite]
- [x] The whole tree still passes `check --language`. [proof: tree]

## Decisions

**A path is a token with no whitespace and no quotes, containing at least one
`/`, ending in one of a closed list of extensions.** Three narrowings, each
carrying its own weight. The SLASH is what makes the rule safe: Polish prose has
spaces in it, so a sentence can never be one token, and a single word cannot
reach the two hits every word rule in this guard requires. The CLOSED extension
list is what stops `wiadomo/nie.tak` walking through a rule that accepted
anything after a dot. And a BARE filename with no directory is deliberately not
a path: nothing in the tree writes one, so admitting it would widen the hole for
no gain. `stripDataSpans()` is now exported, because the boundary of the rule is
worth asserting directly rather than only through its effects.

**The contract named a test file that has never existed.** `verification:` said
`scripts/tests/language-guard.test.mjs`; the language guard's tests live in
`scripts/tests/public-language.test.mjs` and always have. The entry was
corrected to name the real file rather than a new file being created to match
the mistaken name — splitting one guard's tests across two files to satisfy a
typo would cost every future reader of either. This is the "the task was never
finished being written" case from `worktrail instructions task-finalization`,
not an edit to get past a failing run: the four cases the contract asks for were
written first, and they are in that file.

**TL-68's exact path is restored**, replacing the glob workaround. That is the
positive control: if the strip stopped working, the tree-wide `check --language`
would fail on a real line rather than on a fixture.

## Notes

Out of scope: renaming task files. TL-137 settled that a rename is a separate,
narrowly scoped concern from a content migration, and nothing here changes that.
