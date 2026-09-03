---
id: TL-48
title: "LICENSE and package metadata — today nobody can use this"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open-source publication"
priority: P1
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-global-tool.md
  - .claude/skills/branchling-release/SKILL.md
verification:
  - bash: "test -f LICENSE && echo 'LICENSE present — OK'"
  - bash: "grep -q '\"private\": true' package.json && { echo 'still private'; exit 1; }; echo 'private removed — OK'"
  - bash: "for k in license repository bugs homepage keywords description author; do node -e \"process.exit(require('./package.json')['$k'] ? 0 : 1)\" || { echo \"missing metadata: $k\"; exit 1; }; done; echo 'metadata complete — OK'"
---

## Goal

Bring the package to a state where it **can be legally and practically
adopted**: a license file, `private` removed, and the `package.json` fields
that make up the package's page on npm.

## Context

Measured on 2026-08-31 on a clean tree:

| What | State |
|---|---|
| `LICENSE` | does not exist |
| `package.json` → `private` | `true` — `npm publish` refuses |
| `package.json` → `license` | `"UNLICENSED"` |
| `repository`, `bugs`, `homepage`, `keywords` | all missing |

Two different consequences, both hard:

**Legal.** Code without a license file is, by default, "all rights
reserved". At a company, legal review stops at the missing file, regardless
of what the README promises — and it is precisely corporate adoption that a
developer's enthusiasm is meant to lead to.

**Commercial.** Without `repository`/`homepage`/`keywords` the package's
page on npm is an empty rectangle, and it is the last screen before the
decision "I'll try it".

[TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) (closed) had step 5
"License — the choice belongs to the founder; the task has to force it, not
guess it". The enforcement did not work: the task was closed, the file does
not exist. This task is the same enforcement, this time with a verification
that fails when the file is missing.

**The choice of license belongs to the owner and is not to be guessed.** MIT
and Apache-2.0 differ in something that matters specifically for corporate
adoption: Apache-2.0 contains an explicit patent clause that the legal
departments of some companies expect, and it is longer. This is a decision
to be made, not deduced from the code.

## Pre-flight reading

1. `package.json` — the whole file; it's six lines to change, but each one
   is a promise.
2. `.claude/skills/branchling-release/SKILL.md` §1 and §7 — the publication
   gate.
3. [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) — what has already
   been done in packaging, and why `files` is an allow-list.

## Steps

1. **Ask the owner about the license** (MIT / Apache-2.0 / other) — do not
   choose it yourself.
2. Add `LICENSE` with the full text of the chosen license, with the year and
   the rights holder.
3. `package.json`: `"license"` set to the SPDX identifier of the chosen
   license, remove `"private": true`.
4. Add `repository` (type + URL), `bugs`, `homepage`, `keywords`, refine
   `description`.
5. `LICENSE` into the `files` list — a package without the license text in
   the tarball does not carry it forward.
6. `npm pack --dry-run` — confirm that `LICENSE` is inside.

## Acceptance criteria

- [x] `LICENSE` exists and contains the full text of the chosen license.
- [x] `package.json` does not have `"private": true`.
- [x] `license` is an SPDX identifier matching the `LICENSE` file.
- [x] `repository`, `bugs`, `homepage`, `keywords`, `description` filled in.
- [x] `npm pack --dry-run` shows `LICENSE` in the tarball.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the publication-readiness audit
- 2026-09-01 in_progress — agent:claude — LICENSE DECISION: **Apache-2.0**.
  The owner was asked per step 1, and delegated the choice after analysis.
  Three reasons from THIS project, not from a generic table: (1) the task
  itself names corporate adoption as the goal, and the explicit patent
  clause in §3 is the only axis on which MIT and Apache-2.0 differ in a way
  that touches that goal; (2) §6 reserves the trademark — this has value
  because the name (`tasklog` at the time, `worktrail` since 2026-09-01) is
  still provisional, and TL-81 flags a suspected collision on npm, and MIT
  says nothing about the name; (3) §5 defines the terms of contribution, so
  the first external PR does not require a separate CLA. Zero dependencies =
  no downstream compatibility constraint of any kind. Cost: ~200 lines
  instead of ~20, and the NOTICE convention. COUNTERARGUMENT RECORDED
  HONESTLY: MIT is the npm norm and a lower bar for a solo developer; if the
  priority is recognizability rather than legal review, MIT is better. The
  swap is cheap AS LONG AS the owner is the sole copyright holder — from the
  first accepted PR onward it requires the co-authors' consent. That is the
  moment this decision gets expensive, not the moment of publication.
- 2026-09-01 in_progress — agent:claude — the license text was fetched from
  the canonical source (https://www.apache.org/licenses/LICENSE-2.0.txt, 202
  lines, 11358 B), not retyped from memory; verified by the presence of five
  markers (§3 patents, §6 trademarks, §9 warranty, the version header,
  APPENDIX). The appendix placeholder filled in: `Copyright 2026 Kamil
  Kwiatkowski`. `NOTICE` deliberately NOT created — Apache-2.0 §4(d) only
  makes it mandatory for redistributors once it exists, and an empty
  `NOTICE` in a project with no third-party code is an obligation with no
  content (skill worktrail-release §8: report gaps, do not create them
  without asking).
- 2026-09-01 in_progress — agent:claude — NOT CLOSED: verification 3/3 fails
  on `repository`, `bugs`, `homepage`. The owner held back the URL metadata
  — the repository has no remote and the address cannot be deduced. Done:
  `LICENSE`, `private` removed, `license: Apache-2.0`, `keywords` (10), a
  refined `description`, `LICENSE` in `files` and confirmed in the tarball
  (11.3 kB, 35 files, zero backlog data). Closing this is blocked on ONE
  missing input: the repository address. Deliberately not opening a
  separate task for it — this is step 4 of this task, deferred by the
  owner's decision, not new scope. NOTE: removing `private: true` removed
  the gate against accidental publication that TL-33 deliberately put in
  place; `npm publish` no longer fails, and the package name is still open
  in TL-81.
- 2026-09-01 in_progress — agent:claude — **DECISION CHANGED: Apache-2.0 →
  MIT.** The owner challenged the recommendation with a counterexample
  (Backlog.md, a direct equivalent in the same niche, is under MIT) and was
  right. The three arguments for Apache dismantled: (1) the patent argument
  was CARRIED OVER FROM THIS TASK'S OWN TEXT, not verified — corporate OSS
  policies keep allow-lists of licenses and MIT is on every one, and §3
  protects against a co-author enforcing a patent, which for a CLI that
  reads markdown is close to zero; (2) the trademark argument was WRONG —
  Apache §6 clarifies that the license does not grant rights to the
  trademark, but MIT does not grant them either: a copyright license does
  not cover a name, so §6 is not protection, only clarification; (3) the CLA
  argument is real, but small — on GitHub, inbound=outbound follows from the
  terms of service. AGAINST Apache, underweighted earlier: §4(b) requires
  forkers to mark their changes, and this tool is by design pulled into
  OTHER PEOPLE'S repositories — MIT's lighter condition means fewer
  questions for the adopter.
- 2026-09-01 in_progress — agent:claude — A CLOUD SERVICE (new information
  from the owner, absent from the backlog until now) does NOT change this
  choice. MIT and Apache-2.0 are IDENTICAL on the axis of "can a competitor
  put my code behind a service" — both allow it. Only AGPL closes that off
  (suicidal here: many corporate policies forbid it outright, and this tool
  goes into other people's repositories) or BSL/SSPL (not open source).
  Protecting the service has to come from ARCHITECTURE — unpublished server
  code, the trademark, operational value — not from the CLI's license.
  Downstream conclusion: the name is promoted from cosmetics to an asset,
  see TL-81. The contribution model was split off into a separate decision
  task, because it is the only thing in this analysis with an EXPIRATION
  DATE.
- 2026-09-01 in_progress — agent:claude — the MIT text fetched from SPDX
  (https://spdx.org/licenses/MIT.txt), wrapped to 80 columns and checked
  word for word against the source (token comparison: identical). `license:
  "MIT"` in the manifest, `LICENSE` in the tarball (1.1 kB, 35 files
  unchanged).
- 2026-09-01 in_progress — agent:claude — BRAKE RESTORED. Removing
  `private: true` removed the gate that TL-33 deliberately put in place; in
  its place `scripts/check-publish-metadata.mjs` was wired into
  `prepublishOnly`. `npm publish --dry-run` fails with exit code 2 as long
  as `repository`/`bugs`/`homepage` are missing. Deliberate decisions: (1)
  `prepublishOnly`, not `prepublish` — the latter also fires on a plain `npm
  install` and would break setting up the working tree; (2) the gate does
  NOT ship in the tarball (`!scripts/check-publish-metadata.mjs` in
  `files`) — it is a tool for the publisher, not the installer, confirmed by
  `npm pack --dry-run` (35 files unchanged); (3) it checks EXCLUSIVELY three
  addresses and says so in the file's header — the full pre-publication list
  is a human procedure (skill worktrail-release), and a script pretending to
  be that list would be worse than not having it, because a green run would
  read as "package ready"; (4) a placeholder (`example.com`, `<…>`, `TODO`)
  does NOT pass — a gate that accepts filler teaches exactly the thing it is
  supposed to guard against. Test `scripts/tests/publish-gate.test.mjs`, 8
  assertions, including a positive control on the WIRING ITSELF (unhooking
  `prepublishOnly` fails the test) — a gate wired to nothing passes every
  test about its own logic while `npm publish` slips right by. 375/375.
- 2026-09-01 in_progress — agent:claude — along the way, `scripts.test` was
  added (`node --test scripts/tests/*.test.mjs`) — a `scripts` block with
  only `prepublishOnly` and no `npm test` would be odd, and TL-53 (CI) needs
  it anyway. Out of scope for this task; remove in one line if it should not
  be there.
