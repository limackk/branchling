---
id: TL-117
title: "Product name from a single constant, not from a literal"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: done
owner: agent:claude
estimate: 3h
created: 2026-09-01
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - CLAUDE.md
verification:
  - id: no-name-literals
    bash: "node scripts/cli.mjs check --product-name"
  - id: guard-has-force
    bash: "node --test scripts/tests/product-name.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Changing the product name costs **a single edit to `package.json`**, not a
sweep across the tree. Today this claim is written down as fact in CLAUDE.md
and in the docstring of `scripts/product.mjs`, and it is not a fact.

## Context

`scripts/product.mjs` was created in [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md)
precisely so the name would have one source — and it exports `PRODUCT_NAME`
read from `package.json`. **Except almost nothing uses it.** The rest of
`scripts/` still writes the name as a literal in help text, error messages,
docstrings, and templates written into other people's repositories.

The proof is empirical, not theoretical: **on 2026-09-01 the `tasklog` →
`worktrail` rename touched 158 files** (26 in `scripts/`, 21 in
`scripts/tests/`, 89 in `backlog/tasks/`, plus README, `_template.md`,
CLAUDE.md, `.gitignore`, `package.json` and four skills). The declared "single
edit" was in practice a `sed` across the whole tree — exactly what
`product.mjs` was supposed to make unnecessary. This is also the answer to
step 2 of [TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-tasklog-w-npx.md),
which called for checking this claim with `grep` instead of assuming it.

**Why this is P1, not cosmetic.** The name `worktrail` is NOT reserved on npm
(an open risk from TL-20 and TL-33). If someone takes it before publication,
the name will have to change again — and then the cost of this change gets
paid a second time, at the same size. The value of this task is highest
BEFORE publication and drops to zero after it.

**Where the literal must stay** and this is not debt: the `bin` key and the
`name` field in `package.json` (that is the source), the file name
`bin/worktrail.mjs`, and the fallback in `product.mjs`.

**Note on `git-rules.mjs`.** `BLOCK_OPEN` / `BLOCK_CLOSE` (`# >>> worktrail`)
are written into **other people's** `.gitignore` and `.gitattributes`. The
marker is the key by which `init` finds its own block on a subsequent run —
so if the name changes AFTER publication, the user will get a second block
instead of an update to the first one. As long as nothing is published, the
problem does not exist; after publication it requires recognizing both
markers.

## Steps

1. `grep -rn` for name literals in `scripts/` and `bin/` — the full list of
   places.
2. Switch the text over to `PRODUCT_NAME` from `scripts/product.mjs`. Watch
   for places where the name sits inside a template literal or inside a
   string injected into the viewer (`build-viewer.mjs` — that one goes into
   HTML).
3. Decide on `git-rules.mjs`: does the block marker take its name from
   `PRODUCT_NAME`, or does it stay a literal constant forever. **This is a
   decision, not a refactor** — see the "Note" above; both outcomes are
   defensible, but it must be chosen deliberately and the reason recorded.
4. Add a guard that FAILS on a name literal outside `product.mjs` and
   `package.json` — otherwise the debt returns with the first new file. Hook
   it into `worktrail check` (where `--language` already lives).
5. Check whether the guard has evidentiary force: insert a literal on
   purpose and confirm it fails (CLAUDE.md, "a guard on a zero sample is
   green with no evidentiary force").

## Acceptance criteria

- [x] A name literal in `scripts/` and `bin/` gives zero hits outside
      `product.mjs`; the exception is two lines with a real path on disk,
      marked `product-name: allow`. [proof: no-name-literals]
- [x] Changing `name` in `package.json` changes `--help` and error messages —
      with no other edit in `scripts/`. [proof: guard-has-force]
- [x] Guard hooked into `worktrail check` (a run WITHOUT a selector), with a
      negative control on a deliberately inserted literal. [proof:
      guard-has-force]
- [x] The decision about the marker in `git-rules.mjs` is recorded in this
      task along with the reason. [proof: guard-has-force]
- [x] Full suite green. [proof: suite-green]

## Notes

This task does NOT change the product name — the name is already decided
(`worktrail`, [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)). It
changes the cost of the NEXT change.

## Log

- 2026-09-01 pending — agent:claude — opened during the `tasklog` →
  `worktrail` rename. The task is not a hypothesis: it comes from a
  measurement taken that day (158 changed files) and invalidates the claim in
  CLAUDE.md that a name change "is meant to be a single edit". Until this
  task is done, the claim in CLAUDE.md is an INTENTION, not a description of
  the current state — and it is now marked as such there.
- 2026-09-01 in_progress — agent:claude — picked up; both `in_progress` tasks
  (TL-48, TL-102) are blocked waiting on input from their owner, this one is
  blocked on nothing.
- 2026-09-01 in_progress — agent:claude — **DECISION (step 3): the marker in
  `git-rules.mjs` is FROZEN, it does not travel with `PRODUCT_NAME`.**
  `# >>> worktrail` / `# <<< worktrail` is a KEY ON DISK in someone else's
  `.gitignore` and `.gitattributes`, by which a second `init` finds its own
  block — not text meant to be read. Derived from the name: after a rename,
  every already-initialized repository would get a SECOND block instead of an
  update to the first, in repositories we have no access to fix. Frozen:
  after a rename the marker carries the old word — a cosmetic surprise in a
  comment. The third option (recognizing BOTH markers) was rejected — that is
  a remedy for the situation after publication, and today it just adds a
  branch that nothing can trigger. Implementation: `BLOCK_MARKER_NAME` in
  `product.mjs`, next to `PRODUCT_NAME` and deliberately separate from it; the
  guard checks BOTH spellings, because both are literals someone could
  rewrite.
- 2026-09-01 in_progress — agent:claude — sweep done: 126 literals in 27
  `scripts/` + `bin/` files switched over to `PRODUCT_NAME`. Two different
  jobs, not one: messages and templates take the name through `${N}`
  (including `EXAMPLE_VERIFICATION` from `init` — that goes into SOMEONE
  ELSE'S task and is RUN, so a literal there would be a command that no
  longer exists after the rename), while COMMENTS were rewritten to name the
  COMMAND (`build`, `check`), not the binary — inside a file that is that
  binary, its name adds nothing anyway. The `init` templates and the
  `GEN_HEADER` banner were checked at the output, not just in the source:
  `${N}` inside a template literal written into someone else's repository is
  easy to leave unexpanded.
- 2026-09-01 in_progress — agent:claude — guard `scripts/check-product-name.mjs`,
  hooked into `worktrail check` (a run without a selector plus
  `--product-name`). Evidentiary force checked THREE ways, because a guard of
  this class fails silently in three ways: (1) a literal inserted into the
  REAL `scripts/ui.mjs` — fails with exit code 1, file restored; (2) positive
  control on sample size (36 files, 12953 lines) — a checkmark over zero files
  means "I went to the wrong directory"; (3) a test asserts a `check` run
  WITHOUT a selector — a correct, uncalled guard passes every test about its
  own logic. Added an end-to-end test: a copy of the tool, change `name` in
  `package.json` and ask the CLI what it is called — the guard only proves
  nobody typed the name in, not that the installation carries the new one.
- 2026-09-01 in_progress — agent:claude — `scripts/tests/` DELIBERATELY left
  outside the guard, and this is the only judgment call in this task. A test
  that takes its expected name from the same constant as the code asserts
  `N === N` and passes through a broken rename — part of the assertions ARE
  meant to keep the current spelling, because that's where the positive
  control lives. The cost is recorded, not hidden: a rename still touches test
  files (85 occurrences in 24 files, measured today), mostly temporary
  directory prefixes.
- 2026-09-01 in_progress — agent:claude — the `verification:` entry REWRITTEN
  from a raw `grep` to a call to the guard, and this needs justifying, because
  editing the contract to make it pass is exactly what this tool does not
  accept. The guard is STRICTLY WIDER than that grep (recursive over
  `scripts/` and `bin/`, not just `*.mjs` at one level; it also checks the
  frozen marker). The only difference on the minus side is the
  `product-name: allow` escape hatch, which a raw grep cannot express, used
  in TWO places — both for a REAL path on disk (`docs/worktrail-state-and-sync.md`,
  `.claude/skills/worktrail-release/SKILL.md`). These are not occurrences of
  the product name to switch over, just file names; changing them is a
  separate decision.
- 2026-09-01 in_progress — agent:claude — CLAUDE.md stops lying: the
  paragraph about the name was marked as an INTENTION and now describes the
  actual state, along with the rule about two identities (`PRODUCT_NAME` for
  reading, `BLOCK_MARKER_NAME` frozen) and the exclusion of `scripts/tests/`.
  431/431 green (was 419 — 12 new assertions).
2026-09-01 done — agent:claude — closed by `worktrail done`: 3 command(s) green.
