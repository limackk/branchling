---
id: TL-81
title: "Distribution channels and the worktrail name collision in npx"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P0
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - README.md
verification:
  - bash: "npm view worktrail name version 2>&1 | head -3"
  - bash: "node --test scripts/tests/packaging.test.mjs"
---

## Goal

We know whether the name `worktrail` is free on npm, and we have settled
which channels the tool reaches users through. Settled BEFORE the name
becomes fixed in documentation, addresses, and other people's scripts.

## Context

`package.json` today has `"name": "worktrail"`, `"private": true`, and
`"license": "UNLICENSED"` — nothing has been published yet, so the name is
still freely exchangeable. After publication it stops being so.

A concrete warning from Backlog.md: their package is called `backlog.md`,
but `npx backlog` (without installing) resolves to an UNRELATED package by a
different author. They had to describe this in the README as a trap. This is
a cost paid once and forever, and it is detected with one command before
publication.

To be settled in this task (not to be executed — this is a decision task):

1. Whether `worktrail` is free on npm; if not, what the package name is and
   whether `npx <name>` does not land on someone else's code.
2. Whether the binary name (`bin.worktrail`) and the package name can differ,
   and what the README shows in that case.
3. Which channels besides npm: Homebrew and Nix (Backlog.md has both) —
   decide NOW, whether at all, because it affects what the README promises
   from the start.
4. Whether `scripts/product.mjs` really covers every place the name occurs —
   CLAUDE.md says a name change should be ONE edit. This is a claim to
   check, not to assume.

## Pre-flight reading

1. `package.json` — `name`, `bin`, `files`, `private`, `license`.
2. `scripts/product.mjs` — where the product name in the tool's output comes from.
3. `scripts/tests/packaging.test.mjs` — what is guarded today about the tarball's contents.
4. `.claude/skills/branchling-release/SKILL.md` — the existing pre-publication gate; the findings from this task should feed back into it.

## Steps

1. Check the name's availability on npm (`npm view worktrail`) and separately, what `npx worktrail` resolves to today.
2. Verify the claim "a name change is one edit": `grep` for name literals outside `product.mjs`. Any literals found are either a fix or a new task.
3. Decide the distribution channels and record the decision with its reasoning.
4. Append the findings to the `worktrail-release` gate, so the next publication does not repeat them from scratch.

## Acceptance criteria

- [x] It is known whether the package name is free, and the decision is recorded in the task.
- [x] Checked and recorded what `npx <name>` resolves to without installing.
- [x] The claim about one edit for a name change is checked with `grep`, not assumed.
- [x] The decision about channels (npm / brew / nix) is recorded along with its reasoning.
- [x] The findings made it into the pre-publication gate.

## Log

2026-08-31 pending — agent:claude — created from the Backlog.md analysis (github.com/MrLesk/Backlog.md), point 10.
- 2026-09-01 pending — agent:claude — RAISED P1→P0 (joins TL-82 and TL-86, which came from merging the analytical branch). The reason is new, not cosmetic: the owner is considering a worktrail cloud service (settled in TL-48). Under MIT — and the same under Apache-2.0 — the license does NOT stop a competitor from standing up a service on this code; the only thing stopping them from standing it up UNDER THIS NAME is the trademark. The name stops being cosmetic and becomes a business asset, and it is still freely exchangeable only until the first publication. The npx collision (described in ## Context as someone else's case) stops being an awkwardness in the README under a commercial service, and becomes routing traffic to someone else's package.
- 2026-09-01 pending — agent:claude — **name changed `tasklog` → `worktrail`** (decision and reasoning in the log of [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)). What this changes in THIS task:
  **Step 2 done and produced a NEGATIVE result.** The claim "a name change is one edit" is FALSE — measured, not estimated: 158 files, including 26 in `scripts/`. `scripts/product.mjs` exports `PRODUCT_NAME`, but the rest of the code does not use it. The finding was moved out to [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md), because it is work, not a decision — this task stays a decision task.
  **Point 1 partially settled:** `registry.npmjs.org/worktrail` → 404 (2026-09-01), the name is free. **The sharper question stays UNSETTLED**, the same one that stung Backlog.md: what `npx worktrail` resolves to WITHOUT installing. A free name in the registry does not guarantee that, and it has to be checked separately.
  **Raised risk:** the name is freshly chosen and still unreserved, so the window between choosing it and publishing is now the only safeguard — and it is open.
  The `## Context` above mentions `"private": true` and `"license": "UNLICENSED"` — **both are stale** regardless of the name (the license was settled in [TL-48](TL-48-license-i-metadane-pakietu-dzis-nikt-nie-moze-tego-uzyc.md), `private` removed).
- 2026-09-01 in_progress — agent:claude — **POINTS 1 AND 2 SETTLED BY MEASUREMENT** (2026-09-01, network). Registry: `registry.npmjs.org/worktrail` → 404, `npm view worktrail` → E404, npm search for `worktrail` → **0 results** (not just no exact name — nothing similar either). The typo neighborhood is free: `work-trail`, `worktrails`, `worktrail-cli` → 404. `which worktrail` → nothing, so no installed binary shadows ours. No Homebrew formula (`formulae.brew.sh/api/formula/worktrail.json` → 404).
  **The sharper question — what `npx worktrail` resolves to — has a STRUCTURAL answer, not just an empirical one.** Empirically: `cd /tmp && npx --yes worktrail --version` → E404, there is nothing to hijack. Structurally, and this is the real safeguard: **`npx` resolves the PACKAGE NAME, never the binary name.** Backlog.md's trap does not come from bad luck, but from a mismatch between these two names — verified at the source: `npm view backlog.md bin` → `{ backlog: 'cli.js' }`, and `npm view backlog` → `backlog@1.4.56`, "Orchestrator for AI coding agents", by a DIFFERENT author. Their `npx backlog` has to land on someone else's code, because the package is named differently than the binary. For us `name` == the only `bin` key == `worktrail`, so this class of bug is CLOSED BY CONSTRUCTION, not just "free today". Condition to maintain: the package name and the binary name must never diverge — if the package ever had to be named e.g. `worktrail.md`, the trap opens immediately.
- 2026-09-01 in_progress — agent:claude — **POINT 4 (the one-edit claim) — the NEGATIVE result from the previous entry confirmed.** `scripts/product.mjs` exports `PRODUCT_NAME` read from `package.json` (a single source for the package name and the name in `--help`), but the rest of `scripts/` still writes the name as a literal — 158 files for the `tasklog` → `worktrail` change. The claim from CLAUDE.md is an INTENTION, not a description of the current state; the work is in [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md) and stays there. This task performs no work here.
- 2026-09-01 in_progress — agent:claude — **POINT 3 — OWNER'S DECISION: npm-only channel.** The README promises `npm i -g worktrail` and `npx worktrail`, nothing more. Reasoning: Homebrew and Nix are two separate release rituals and two places where the version can go stale; a tap lagging behind npm is WORSE than no tap, because it promises a channel it does not deliver on. Backlog.md has both, but it also has users who asked for them — we have zero. They come back as separate tasks when someone asks, not before. Consequence for the README: it must not mention brew/nix even as "coming soon".
- 2026-09-01 in_progress — agent:claude — **NAME RESERVATION — OWNER'S DECISION: the window stays open.** The alternative presented (publish a working `0.1.0` as a reservation, as soon as TL-48 has a repository address) was REJECTED; publication only once everything is ready. **Risk accepted deliberately and recorded so it does not come back as a surprise:** until there is a publication, the name is free for anyone, and given the cloud service under consideration, it is the name — not the license — that is the only thing stopping a competitor from standing up a service UNDER THIS NAME (analysis in [TL-48](TL-48-license-i-metadane-pakietu-dzis-nikt-nie-moze-tego-uzyc.md)). The scoped variant (`@…/worktrail`) was considered and rejected as illusory: it does not reserve the unscoped name, so `npx worktrail` stays free despite the publication. The reservation is still available at any moment — the cost only grows with time, nothing else.
- 2026-09-01 in_progress — agent:claude — findings appended to the pre-publication gate `.claude/skills/branchling-release/SKILL.md` §7: three checking commands (`npm view` / `npx` / `which`) with an explanation of WHY the first does not replace the second, the `backlog.md` precedent as evidence, and the decision about channels. Recorded as a rule to repeat on every future name change, not as a log of this one check.
2026-09-01 done — agent:claude — closed by `worktrail done`: 2 command(s) green.
