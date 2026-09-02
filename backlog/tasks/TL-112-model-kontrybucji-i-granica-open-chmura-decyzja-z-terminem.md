---
id: TL-112
title: "Contribution model and the open/cloud boundary — a decision with an expiry date"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: done
owner: agent:session
estimate: 2h
confidence: high
created: 2026-09-01
updated: 2026-09-02
blocked_by: []
blocks: [TL-53]
related_docs:
  - .claude/skills/worktrail-release/SKILL.md
verification:                      # English filename and probes: CLAUDE.md admits no
                                   # directory-shaped exception, and the original contract
                                   # grepped for a Polish stem that English text cannot carry
  - bash: "test -f docs/license-and-contributions.md && echo 'the decision document exists — OK' || { echo 'docs/license-and-contributions.md is missing'; exit 1; }"
  - bash: "for q in 'DCO' 'CLA' 'cloud' 'dual licensing'; do grep -qi \"$q\" docs/license-and-contributions.md || { echo \"the decision does not answer: $q\"; exit 1; }; done; echo 'four questions settled — OK'"
  - bash: "grep -q 'license-and-contributions' README.md CONTRIBUTING.md 2>/dev/null && echo 'the decision is visible to a contributor — OK' || { echo 'the decision is nowhere visible from outside'; exit 1; }"
---

## Goal

Know on what terms we accept someone else's code, and where the boundary runs
between what is public and what powers the cloud service. Settled **before
publication**, because after the first merged PR this decision stops being
possible to make unilaterally.

This is a DECISION task, like
[TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-worktrail-w-npx.md). The
deliverable is a recorded choice with a rationale, not code.

## Context

Surfaced 2026-09-01 during TL-48, from information that **was not in the
backlog**: the owner is considering running worktrail as a cloud service. A
`worktrail query --text "chmur|saas|monetyz"` query returned zero tasks — the
whole publication analysis had until then stood on the assumption that we only
ship the tool.

**Why this has an expiry date, not just a priority.** Without a settled model,
every merged PR is someone else's property under a public license. From that
moment on, changing the license or shipping the code under commercial terms
requires the consent of EVERY contributor individually. The decision does not
get more expensive — it stops existing. Projects that tried to change the
model after the fact paid for it for years.

**What has already been settled and is not the subject of this task.** The
tool's license is MIT (TL-48, decision 2026-09-01). It was also settled there
that MIT and Apache-2.0 are IDENTICAL on the axis of "can a competitor build a
service on our code" — both allow it. Only AGPL or BSL/SSPL would have closed
that off, and both were rejected: AGPL is suicidal for a tool pulled into
OTHER PEOPLE's repositories (part of corporate OSS policy bans it outright),
and BSL/SSPL are not open source and cost exactly the credibility that
publishing is meant to buy.

**The conclusion this task follows from:** protecting the service has to come
from architecture and trademark, not from the CLI's license. That means the
open/cloud boundary must be DRAWN, not assumed — otherwise the first
reasonable PR to the CLI will land on a feature that was meant to be on the
paid side.

## Pre-flight reading

1. `backlog/tasks/TL-48-*.md`, `## Log` section — the full license analysis
   from 2026-09-01, including the arguments that were REJECTED and why. Do
   not repeat that work.
2. [TL-81](TL-81-kanaly-dystrybucji-i-kolizja-nazwy-worktrail-w-npx.md) — the
   name as an asset; with a cloud service, the trademark is the only thing
   protecting against a fork standing next to it.
3. [TL-53](TL-53-ci-contributing-i-szablony-zgloszen-przed-publikacja.md) —
   `CONTRIBUTING.md` is where this decision MATERIALIZES; that is why this
   task blocks it.
4. `.claude/skills/worktrail-release/SKILL.md` §8 — "report gaps, do not
   create them without asking"; every item on this list is a commitment
   someone has to keep.

## Steps

1. **Decide whether we accept external contributions at all.** "No" is a
   fully valid answer and the cheapest to maintain — but then the README has
   to say so outright, instead of staying silent and rejecting PRs after the
   fact.
2. If yes — choose between **DCO** (a `Signed-off-by` signature, lightweight,
   no transfer of rights) and **CLA** (transfer or a broad license grant back,
   the only option that keeps the possibility of shipping the code
   commercially). Record what each of them TAKES AWAY.
3. **Draw the open/cloud boundary**: which features belong to the CLI by
   definition, and which to the service. Without this list, there is no
   honest way to reject a PR.
4. Decide whether we plan **dual licensing** (the same code under MIT and
   under a commercial license). This is possible ONLY with a CLA or with a
   single rights holder.
5. Record the result in `docs/licencja-i-kontrybucje.md` — in Polish, since
   `docs/` is documentation of THIS repository — and link it from the README
   and from `CONTRIBUTING.md` once it exists (TL-53).

## Acceptance criteria

- [ ] `docs/licencja-i-kontrybucje.md` exists and answers all four questions:
      contributions yes/no, DCO or CLA, the open/cloud boundary, dual
      licensing.
- [ ] Each answer records what it TAKES AWAY — a decision with no cost is a
      note, not a decision.
- [ ] The open/cloud boundary takes the form of a list that a concrete PR can
      be decided against, not a general sentence.
- [ ] The document is linked from the README or `CONTRIBUTING.md` — a
      decision invisible to a contributor does not work.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-09-01 created — agent:claude — split out of TL-48 during the license
  analysis. Reason for splitting it out: this is the only thing from that
  analysis with a DEADLINE — it expires at the first merged PR, not at
  publication. Blocks TL-53, because CONTRIBUTING.md cannot be written before
  this decision.
