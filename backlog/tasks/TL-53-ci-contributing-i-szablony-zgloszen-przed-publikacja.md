---
id: TL-53
title: "CI, CONTRIBUTING and issue templates before publication"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending
owner: unassigned
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-112]
blocks: []
related_docs:
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "ls .github/workflows/*.yml >/dev/null 2>&1 && echo 'workflow present — OK'"
  - bash: "test -f CONTRIBUTING.md && echo 'CONTRIBUTING present — OK'"
  - bash: "grep -q 'node --test' .github/workflows/*.yml && grep -q 'cli.mjs check' .github/workflows/*.yml && echo 'CI runs the tests and guards — OK'"
  - manual: "A green run is publicly visible on the first push; the badge in README links to it."
---

## Goal

Turn "263 tests pass" from an author's claim into a green badge that a
stranger can see — and say plainly what a good contribution looks like.

## Context

State on 2026-08-31: no `.github/`, no workflow, no `CONTRIBUTING.md`, no
`CHANGELOG.md`, no remote repository. The test suite is strong (263 tests,
green, ~2.4s, no dependencies) — nobody but the author has any way to see
that.

For a developer evaluating an unfamiliar tool, the order looks like this:
repository page → is CI green → README → code. A green run is the cheapest
signal of trust this project can buy, because the work behind it **is
already done**.

Two things to settle along the way, because both are commitments that will
later have to be honored:

- **Whether we accept pull requests**, and if so, under what terms. No
  answer is also an answer, just one given by silence.
- **The Node version matrix.** `engines` says `>=18`; if CI only tests one
  version, `>=18` is unverified. Either we measure it, or we narrow the
  declaration.

A narrow benefit that is easy to forget: CI is the only place where tests run
in the **non-co-located** layout — on a fresh clone, with an empty cache, with
no generated views. Exactly the difference that caught the class of bugs
described in `scripts/tests/non-colocated-layout.test.mjs`.

## Pre-flight reading

1. `scripts/tests/_repo.mjs` — why the tests cannot assume a single directory layout.
2. `.gitignore` — views are generated; a fresh clone has none and CI confirms it.
3. `.claude/skills/worktrail-release/SKILL.md` §8 — what an outside developer looks for.

## Steps

1. `.github/workflows/test.yml`: `node --test scripts/tests/*.test.mjs` plus
   `node scripts/cli.mjs check` on a fresh clone. No `npm install` — there
   are no dependencies, and CI is meant to prove that.
2. Node version matrix matching `engines` (18 / 20 / 22), on Linux and macOS.
3. An `npm pack --dry-run` step with an assertion that the tarball does not
   contain `tasks/`, `history/`, `archive/`, `boards/`, `config.yaml`,
   `viewer.html`. An allowlist that is not checked holds only until the
   first mistake.
4. `CONTRIBUTING.md`: how to run the tests, what this repository's backlog
   is, that the tool tracks itself with itself, and what a change must
   carry (a test, a help update, `worktrail check`).
5. Badge in the README.
6. Issue templates: bug report (with version, system, `worktrail --version`
   output) and feature request.
7. Decide on `CHANGELOG.md` — hand-written or generated from tags.

## Acceptance criteria

- [ ] CI runs the tests and `worktrail check` on every push.
- [ ] CI checks the tarball contents.
- [ ] The Node version matrix covers what `engines` declares.
- [ ] `CONTRIBUTING.md` answers how to run the tests and whether PRs are accepted.
- [ ] The README badge links to the run.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the publication-readiness audit
- 2026-09-01 pending — agent:claude — BLOCKED by TL-112. `CONTRIBUTING.md` has to tell a contributor under what terms we accept their code — and those terms are not yet decided (DCO or CLA, and where the open/cloud boundary runs). Written earlier, it would be a commitment that would later have to be walked back in front of people who already relied on it.
</content>
