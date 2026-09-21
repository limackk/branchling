---
id: TL-53
title: "CI, CONTRIBUTING and issue templates before publication"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: medium
created: 2026-08-31
updated: 2026-09-02
blocked_by: [TL-112]
blocks: []
related_docs:
  - .claude/skills/branchling-release/SKILL.md
verification:
  - id: workflow
    bash: "ls .github/workflows/*.yml >/dev/null 2>&1 && echo 'workflow present — OK'"
  - id: contributing
    bash: "test -f CONTRIBUTING.md && echo 'CONTRIBUTING present — OK'"
  - id: ci-runs-both
    bash: "grep -q 'node --test' .github/workflows/*.yml && grep -q 'cli.mjs check' .github/workflows/*.yml && echo 'CI runs the tests and guards — OK'"
  - id: node-matrix
    bash: "node -e \"const fs=require('fs'); const y=fs.readFileSync('.github/workflows/test.yml','utf8'); const engines=require('./package.json').engines.node; const min=Number(engines.replace(/[^0-9.]/g,'').split('.')[0]); const m=y.match(/node:\\s*\\[([^\\]]+)\\]/); if(!m) { console.error('no node matrix in the workflow'); process.exit(1); } const versions=m[1].split(',').map(v=>Number(v.replace(/[^0-9]/g,''))); if(!versions.includes(min)) { console.error('engines declares >=' + min + ' and CI never runs it: ' + versions.join(', ')); process.exit(1); } console.log('the matrix covers what engines declares (' + versions.join(', ') + ') — OK');\""
  - id: tarball-gate
    bash: "grep -q 'npm pack --dry-run' .github/workflows/*.yml && echo 'CI checks the tarball contents — OK'"
  - id: contributing-answers-both
    bash: "grep -qi 'node --test' CONTRIBUTING.md && grep -qi 'pull request' CONTRIBUTING.md && grep -q 'license-and-contributions' CONTRIBUTING.md && echo 'CONTRIBUTING answers how to run the tests and whether PRs are accepted — OK'"
  - id: issue-templates
    bash: "test -f .github/ISSUE_TEMPLATE/bug_report.yml && test -f .github/ISSUE_TEMPLATE/feature_request.yml && grep -q 'version' .github/ISSUE_TEMPLATE/bug_report.yml && echo 'both templates present, the bug one asks for a version — OK'"
  - id: guards
    bash: "node scripts/cli.mjs check"
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
3. `.claude/skills/branchling-release/SKILL.md` §8 — what an outside developer looks for.

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

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118).

- [x] CI runs the tests and `worktrail check` on every push and every pull request. [proof: workflow, ci-runs-both]
- [x] CI checks the tarball contents against the allowlist in `files`. [proof: tarball-gate]
- [x] The Node version matrix covers what `engines` declares — asserted against the manifest, not eyeballed. [proof: node-matrix]
- [x] `CONTRIBUTING.md` answers how to run the tests and whether pull requests are accepted. [proof: contributing, contributing-answers-both]
- [x] Issue templates exist, and the bug one asks for the three fields that settle most reports. [proof: issue-templates]
- [x] The repository still passes its own guards after all of it. [proof: guards]

## Decision (2026-09-02)

**The badge and the first publicly visible green run are NOT here, and they were
not dropped.** They are TL-158, blocked on the one fact this repository does not
have: it has no remote. `git remote -v` is empty and `package.json` carries no
`repository` field, so a badge URL — which contains the owner and the repository
name — could only be guessed. The two available guesses are a wrong URL and a
placeholder, and both render as a broken image at the top of the README, which
is worse than no badge. The original contract's `manual:` entry said "a green
run is publicly visible on the first push"; there has been no push, and vouching
for it would be exactly the "I checked" the manual prompt lists as not evidence.
So the contract was split rather than weakened: everything that can be built
without a remote is here and verified, and the half that cannot is a task that
holds it.

**The matrix is asserted against `engines`, not written down beside it.** The
task says `>=18` is unverified if CI tests one version. A workflow listing
18/20/22 in a comment is exactly as unverified — so the contract reads the
minimum out of `package.json` and fails if the matrix does not run it. Either
the declaration is measured or it is narrowed, and now the two cannot drift.

**No `npm install` in the workflow, and its absence is an assertion.** The
package has zero dependencies and the README says so. A workflow that installed
anyway would keep passing on the day that stopped being true, so there is an
explicit step that fails when a runtime dependency appears.

**The tarball step checks both directions.** An allowlist that is not checked
holds only until the first mistake, and `files` in `package.json` is what stops
this project's own backlog — its roadmap, its history, somebody's task list —
being published to npm. The step refuses `backlog/`, `docs/`, `scripts/tests/`
and the generated views, AND requires the six files that make the package
usable: an assertion that only forbids can be satisfied by an empty tarball.

**`CHANGELOG.md` is deliberately not written (step 7).** Hand-written, and it
starts at the first tagged release. Nothing is published, there are no tags, and
a changelog today would have one entry saying "everything" — a document with no
reader. Generating it from tags was rejected for the reason this project rejects
generated prose everywhere else: a list of commit subjects is not an answer to
"what changed for me". Until the first release the change history is `backlog/`
and git, and `LINEAGE.md` says why that is more than usually true here.

**CI is the only place the suite runs on a fresh clone**, with no generated
views, no state directory and no `node_modules` — and with the code NOT
co-located with the data. That last difference is the one that produced the
class of bug `scripts/tests/non-colocated-layout.test.mjs` exists for, and it is
written into the workflow's header so the next person does not delete the
matrix to make it faster.

## Verification

```bash
# 1. The workflow exists and runs both halves — expected: OK messages
ls .github/workflows/*.yml
grep -q 'node --test' .github/workflows/*.yml && grep -q 'cli.mjs check' .github/workflows/*.yml

# 2. The matrix covers what `engines` declares — expected: OK, or a named gap
node -e "const y=require('fs').readFileSync('.github/workflows/test.yml','utf8'); \
  const min=Number(require('./package.json').engines.node.replace(/[^0-9.]/g,'').split('.')[0]); \
  const v=y.match(/node:\s*\[([^\]]+)\]/)[1].split(',').map(x=>Number(x.replace(/[^0-9]/g,''))); \
  if(!v.includes(min)) throw new Error('engines >=' + min + ' is never run: ' + v); \
  console.log('matrix covers engines — OK')"

# 3. The tarball gate is in CI — expected: OK message
grep -q 'npm pack --dry-run' .github/workflows/*.yml && echo 'CI checks the tarball contents — OK'

# 4. CONTRIBUTING answers the two questions a contributor arrives with
grep -qi 'node --test' CONTRIBUTING.md && grep -qi 'pull request' CONTRIBUTING.md

# 5. Issue templates, and the bug one asks for a version
test -f .github/ISSUE_TEMPLATE/bug_report.yml && test -f .github/ISSUE_TEMPLATE/feature_request.yml

# 6. The guards still pass
node scripts/cli.mjs check
```

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the publication-readiness audit
- 2026-09-01 pending — agent:claude — BLOCKED by TL-112. `CONTRIBUTING.md` has to tell a contributor under what terms we accept their code — and those terms are not yet decided (DCO or CLA, and where the open/cloud boundary runs). Written earlier, it would be a commitment that would later have to be walked back in front of people who already relied on it.
</content>
