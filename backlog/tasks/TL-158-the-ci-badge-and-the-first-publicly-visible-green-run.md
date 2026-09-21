---
id: TL-158
title: "The CI badge and the first publicly visible green run"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: pending  # pending | in_progress | blocked | done | cancelled
owner: unassigned
executor: "human"
estimate: 30m                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
created: 2026-09-02
updated: 2026-09-02
blocked_by: [TL-53]
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  - id: badge-in-readme
    bash: "grep -q 'workflows/test.yml/badge.svg' README.md && echo 'the badge is in the README — OK'"
  - id: repository-metadata
    bash: "node -e \"const m=require('./package.json'); if(!m.repository) { console.error('package.json has no repository field'); process.exit(1); } console.log('the repository is named in the manifest — OK');\""
  - id: badge-points-somewhere-real
    bash: "grep -oE 'https://github.com/[^)\\"]*workflows/test.yml/badge.svg' README.md | grep -qv '<' && echo 'the badge URL carries a real owner and repository — OK'"
  - id: looks-right
    manual: "Open the README on the forge and look at the badge: is it green, and does clicking it land on a run of THIS repository? A badge that renders as a broken image is worse than no badge, and only a person looking at the rendered page can tell."
---

## Goal

A stranger who opens the repository sees a green check before they read a word,
and clicking it lands on a real run of this repository's test suite.

## Context

TL-53 built everything this needs and could not finish it. The workflow exists
(`.github/workflows/test.yml`: the suite, the guards, the tarball contents, Node
18/20/22 on Linux and macOS), `CONTRIBUTING.md` exists, the issue templates
exist. What is missing is one fact: **this repository has no remote.** `git
remote -v` is empty and `package.json` carries no `repository` field.

A badge URL contains the owner and the repository name. Without them there are
two options and both are worse than waiting: a guessed URL that renders as a
broken image at the top of the README, or a placeholder that does the same. So
TL-53 stopped, said so, and left this.

**Why it is worth its own task rather than a line in a release checklist.** The
badge is the cheapest signal of trust this project can buy, because the work
behind it is already done — and it is the one deliverable that cannot be
verified by any command in this repository. Only a person looking at a rendered
page can tell a green badge from a broken image, which is why the contract below
carries a `manual:` entry rather than a grep alone.

## Pre-flight reading

1. `.github/workflows/test.yml` — the workflow the badge points at. Its `name:`
   is what appears in the badge URL.
2. TL-53's Decision section — what was delivered and why this half was not.
3. `README.md` — where the badge goes: the first line, above the title's
   subtitle, because a reader who has to scroll for it has already decided.

## Steps

1. Create the remote and push. The first push is what produces a run to link to.
2. Add `repository` (and `bugs`, `homepage`) to `package.json` — the badge URL
   and the npm page read the same fact, and two copies of one fact drift.
3. Add the badge to `README.md`, deriving the owner and repository from the
   same place, not typed a second time.
4. Look at the rendered page.

## Acceptance criteria

- [ ] The README carries a workflow badge. [proof: badge-in-readme]
- [ ] The badge URL names a real owner and repository, not a placeholder. [proof: badge-points-somewhere-real]
- [ ] The badge renders green on the forge and clicking it lands on a run of this repository. [proof: looks-right]
- [ ] `package.json` carries `repository`, so the badge and the npm page read one fact. [proof: repository-metadata]

## Notes

- The open question this task exists to settle is not technical: **where is this
  published, and under whose account.** Nobody but the owner can answer it, and
  guessing it would put a fabricated URL in a public README.
- `CHANGELOG.md` is deliberately NOT here. TL-53 decided it starts at the first
  tagged release: a changelog for a version nobody can install is a document
  with no reader, and until then the change history is `backlog/` and git.
