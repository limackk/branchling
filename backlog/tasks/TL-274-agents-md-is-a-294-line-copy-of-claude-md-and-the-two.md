---
id: TL-274
title: "AGENTS.md is a 294-line copy of CLAUDE.md, and the two already disagree"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:codex
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-05
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: agent-files-agree
    bash: "node --test scripts/tests/agent-file-parity.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

The instructions an agent must follow have ONE source. Today `CLAUDE.md`
and `AGENTS.md` are two 294-line files saying almost the same thing, and
`.claude/skills/` and `.agents/skills/` are two copies of four documents.
The copies have already diverged, on their first day.

## Context

Both trees were tracked on 2026-09-05 (commit "The repository speaks to
Codex as well"), which is what made the duplication visible. As committed:

    $ diff CLAUDE.md AGENTS.md
    293c293
    <   branch named automatically by tooling (`claude/…`) is the one exception
    ---
    >   branch named automatically by tooling (`Codex/…`) is the one exception

    $ diff .claude/skills/branchling-release/SKILL.md \
           .agents/skills/branchling-release/SKILL.md
    ~ 92  … the test count in `CLAUDE.md` … → … the test count in `AGENTS.md` …

Two differences, both a name substitution, both correct for their own
reader. That is the best case and it is still a copy: every future edit to
one file has to be made twice, and nothing fails when it is made once.

**The divergence is not hypothetical, it is already present.** The
`.agents/skills/` tree is MISSING `backlog-workflow`, which
`.claude/skills/` carries as a symlink. A Codex session in this repository
is therefore not told to read `branchling instructions` at all — the one
skill whose whole job is to send an agent to the tool's own procedure.
Nobody decided that; it is what a hand copy leaves out.

**This repository has already settled the principle, twice.** The context
paragraph in `CLAUDE.md` is not prose about the tool — it is `CONTEXT_RULE`
in `scripts/context-budget.mjs`, and a test fails if the copy in the
document falls behind it. `PRODUCT_NAME` lives in `scripts/product.mjs`
and a literal anywhere in `scripts/` or `bin/` fails `check
--product-name`. The rule in both cases is the same: one source, so the two
cannot drift apart. A 294-line hand copy of the binding instructions is the
largest violation of it in the tree.

**What differs legitimately is small and mechanical.** A tool name, the
name of the file the reader is holding, the prefix its tooling gives a
branch. That is a substitution table, not a second document.

**Not a request to drop Codex support.** The opposite: a Codex session
should get the same instructions a Claude session gets, including the ones
the copy lost.

## Steps

1. Decide the shape. The candidates: one source file plus a generator with
   a substitution table, run by a guard; `AGENTS.md` reduced to a pointer at
   `CLAUDE.md` plus the differences; a symlink where the two readers accept
   identical text. Record the answer with `branchling decide` — the choice
   turns on whether Codex reads a symlink and whether a generated file may
   be committed, both of which need checking rather than assuming.
2. Whatever is chosen, `check` gains a guard that FAILS when the two
   disagree outside the substitution table, with a positive control — the
   files agree today except on two lines, so a guard written against them
   as they stand would pass on a zero sample.
3. Restore what the copy dropped: `backlog-workflow` is missing from
   `.agents/skills/`, so a Codex session is never sent to `branchling
   instructions`.
4. Check `.codex/hooks.json` against `.claude/settings.json` for the same
   class of drift before closing.

## Acceptance criteria

- [x] Editing the binding instructions in one place changes what BOTH
      agents read, proven by a test that fails when the two disagree
      outside the substitution table. [proof: agent-files-agree]
- [x] A Codex session is offered the same skills a Claude session is,
      `backlog-workflow` included. [proof: agent-files-agree]
- [x] `check` names the drift rather than reporting it in prose.
      [proof: guards-green]
- [x] The choice of shape is a `__decision__` event in
      `backlog/history/TL-274.jsonl`, not argued in this file.
      [proof: agent-files-agree]
