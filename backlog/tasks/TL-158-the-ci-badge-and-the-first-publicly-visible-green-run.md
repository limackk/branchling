---
id: TL-158
title: "The CI badge and the first publicly visible green run"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: blocked  # pending | in_progress | blocked | done | cancelled
owner: ""
executor: ""
estimate: 30m                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
created: 2026-09-02
updated: 2026-09-22
blocked_by: [TL-53, TL-433, TL-434, TL-435, TL-436]
blocks: []
related_docs: []
verification:                      # HOW to check that the task is really done
  # REWRITTEN 2026-09-22, against the two defects a verification block is known
  # to carry.
  #
  # TL-260 (an entry green against an UNCHANGED tree). `repository-metadata`
  # asked only whether `repository` was present, and TL-48 had put it there
  # months before — so the entry was already green on the day this task was
  # taken and could never say anything about it. What no earlier task
  # established, and what this one is actually for, is that the badge and the
  # manifest name ONE repository; that is what is measured now, and it fails
  # the moment either side is edited alone.
  #
  # TL-424 (an entry that cannot fail). `badge-points-somewhere-real` grepped a
  # string out of the README and never fetched it, so a badge pointing at a
  # deleted repository passed it; `looks-right` said "the forge" and named no
  # address, which is the same defect in prose. Both are replaced by entries
  # that FETCH — the run's conclusion through `gh`, and the SVG the forge
  # actually serves — and the manual entry now names the two URLs it judges,
  # both of which answered 200 on 2026-09-22. Every `node --test` entry is
  # guarded by `test -f`, because `node --test <path that does not exist>`
  # exits 0.
  #
  # The network entries are deliberate and not a weakness: this task publishes
  # a claim about a server, and no assertion made inside a checkout can see it.
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
  - id: badge-guard
    bash: "test -f scripts/tests/readme-badge.test.mjs && node --test scripts/tests/readme-badge.test.mjs"
  - id: badge-agrees-with-manifest
    bash: "node -e \"const p=require('./package.json'); const s=/github[.]com[/:]([^/]+\\/[^/.]+)/.exec(p.repository.url)[1]; const u='https://github.com/'+s+'/actions/workflows/test.yml/badge.svg'; if(!require('fs').readFileSync('README.md','utf8').includes(u)) { console.error('the README carries no badge naming '+s); process.exit(1); } console.log('the badge and the manifest both name '+s+' — OK');\""
  - id: workflow-run-is-green
    bash: "gh run list --workflow test.yml --branch master --limit 1 --json conclusion --jq '.[0].conclusion' | grep -qx success && echo 'the newest run of test.yml on master concluded success — OK'"
  - id: badge-served-green
    bash: "node -e \"const p=require('./package.json'); const s=/github[.]com[/:]([^/]+\\/[^/.]+)/.exec(p.repository.url)[1]; const u='https://github.com/'+s+'/actions/workflows/test.yml/badge.svg'; fetch(u).then(r=>r.text()).then(t=>{ const w=(t.match(/>(passing|failing|no status|cancelled)</)||[])[1]; if(w!=='passing') { console.error('the forge serves a badge saying '+w+' at '+u); process.exit(1); } console.log('the forge serves a passing badge at '+u+' — OK'); });\""
  - id: looks-right
    manual: "Open https://github.com/limackk/branchling and look at the badge above the subtitle - green, and clicking it lands on https://github.com/limackk/branchling/actions/workflows/test.yml, a run of THIS repository. Both URLs were fetched on 2026-09-22 and answered 200, so this entry judges only what a fetch cannot - that the badge renders as an IMAGE, in that place, above the fold."
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

- [ ] The whole suite is green. [proof: suite]
- [ ] The guard that measures badge-against-manifest agreement is in the suite, with its own positive controls. [proof: badge-guard]
- [ ] The README carries a workflow badge whose owner and repository are the ones `package.json` names, so editing either side alone fails. [proof: badge-agrees-with-manifest]
- [ ] The newest run of the workflow on the default branch concluded success. [proof: workflow-run-is-green]
- [ ] The forge serves a PASSING badge at the URL the README carries. [proof: badge-served-green]
- [ ] It renders as an image, above the fold, and clicking it lands on a run of this repository. [proof: looks-right]

## What happened on 2026-09-22, and why the badge is not in the README yet

**Step 1 is done and was not done by this session.** The repository is published
at <https://github.com/limackk/branchling>, `origin` points at it over SSH (`git remote -v`), and `package.json` already carried
`repository`, `bugs` and `homepage` — TL-48 put them there as the brake that
replaced `"private": true`. So the open question this task was parked on ("where
is this published, and under whose account") is answered.

**The default branch is `master`, not `main`** — locally and on the forge
(`gh repo view` says `default=master`). AGENTS.md and many task files say
`main`. Nothing was renamed here; the entries above name the branch that
exists.

**The workflow is RED, so the badge was withheld.** Run
<https://github.com/limackk/branchling/actions/runs/35697131745> for commit
12bacb6 concluded `failure` on ALL SIX matrix jobs, while the same suite is
green locally on Node 24 (1896 tests, 0 fail). Four distinct causes, each now
its own task and each a blocker of this one:

- TL-433 — `docs-links` fails on all six: TL-343 cites
  `node_modules/@clack/prompts/README.md`, which no fresh clone has.
- TL-434 — under `FORCE_COLOR` on Node 18 and 20, `an empty backlog INSIDE a
  repository` fails, so `suite-is-terminal-independent` fails with it.
- TL-435 — on the macOS runners the MCP `initialize` handshake over a pipe
  dies on `Unexpected end of JSON input`.
- TL-436 — on Node 18 the API harness exhausts its attempts and closes nothing.

Adding the badge now would put a `failing` image at the top of a public README,
and adding it while intending to fix CI afterwards is the exact order this wave
was placed last to prevent. **The badge is one line, and it is written down so
the next session pastes it rather than composing it:**

```
[![test](https://github.com/limackk/branchling/actions/workflows/test.yml/badge.svg)](https://github.com/limackk/branchling/actions/workflows/test.yml)
```

It goes between the `# branchling` heading and the bold subtitle. No `?branch=`
query: without one the forge reports the DEFAULT branch, so the badge cannot
drift the day that branch is renamed — which, given the `master`/`main`
discrepancy above, is a live possibility.

**What was delivered instead:** `scripts/tests/readme-badge.test.mjs`, the
answer to "derive the badge from the manifest, do not type the fact twice". A
README is static text and the forge interpolates nothing, so the second copy
cannot be removed — it can only be MEASURED. The guard fails when a badge names
a repository other than the manifest's, when it names a workflow this tree does
not have, or when `bugs` and `homepage` drift from `repository`. It is written
conditionally ("every badge in the README…") so that it is already in force on
the day the badge is pasted in, and it carries fixture positive controls
because the tree sample is empty until then.


## Notes

- The open question this task exists to settle is not technical: **where is this
  published, and under whose account.** Nobody but the owner can answer it, and
  guessing it would put a fabricated URL in a public README.
- `CHANGELOG.md` is deliberately NOT here. TL-53 decided it starts at the first
  tagged release: a changelog for a version nobody can install is a document
  with no reader, and until then the change history is `backlog/` and git.
