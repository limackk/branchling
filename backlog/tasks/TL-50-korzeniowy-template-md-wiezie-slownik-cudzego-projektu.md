---
id: TL-50
title: "The root _template.md carries someone else's project vocabulary"
type: bug
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: done
owner: claude
estimate: 30m
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - .claude/skills/branchling-release/SKILL.md
verification:
  - bash: "printf 'send DPA\\nboard: backlog-project\\n' > /tmp/tl1460-probe && grep -qwiE 'DPA|backlog-project|pre-launch|Legal compliance|Mobile redesign' /tmp/tl1460-probe || { echo 'positive control: pattern does not catch even an obvious match'; exit 1; }; grep -qwiE 'DPA|backlog-project|pre-launch|Legal compliance|Mobile redesign' _template.md && { echo 'template still carries a foreign vocabulary'; exit 1; }; echo 'template is generic — OK'"
  - bash: "grep -q 'node backlog/scripts/' _template.md && { echo 'paths from before packaging'; exit 1; }; echo 'no script paths — OK'"
  - bash: "npm pack --dry-run 2>&1 | grep -q '_template.md' && echo 'template still in the tarball (co-location marker) — OK'"
---

## Goal

The template that ships in the package should show the **shape of a task
file**, not another project's values.

## Context

There are two `_template.md` files in the repository, and their content
differs:

| File | Role | State |
|---|---|---|
| `backlog/_template.md` | read by `worktrail new` (`join(root, "_template.md")`) | generic, short, fine |
| `_template.md` (root) | **ships in the tarball** (`files` in `package.json`) | old template from someone else's project |

The root template contains (measured 2026-08-31): `id: BL-NNN`, an example
title "Send DPA to Anthropic", `board: main | backlog-project`, `labels:
[pre-launch]` with a comment about other environments, `related_docs:
docs/architecture/<feature>.md`, and `node backlog/scripts/suggest-board.mjs`
as a way to choose a board.

**A caveat so the task is not fixed in the wrong place:** this file is not
read as content today. `init-backlog.mjs` keeps its own `TEMPLATE_MD` in
code, and the root `_template.md` plays the role of a **co-location marker**
— `looksLikeBacklogDir()` recognizes a backlog directory by it, which is
checked in `scripts/tests/packaging.test.mjs`. Do not delete it, replace its
content.

Even though nobody reads it, **it is published**, and published content is
public regardless of whether the program ever reaches for it. On top of
that, it says `BL-NNN`, while this repository's `config.yaml` says
`task_id_prefix: TL` — so as documentation it is also false.

Along the way: the prefix in the template should be **neutral**, not swapped
from `BL` to `TL`. The prefix is configuration
([TL-42](TL-42-prefiks-id-taska-to-konfiguracja-nie-kod.md)), so a template
that hardcodes a specific one teaches a bad habit in the very first file a
new user sees.

## Pre-flight reading

1. `_template.md` and `backlog/_template.md` — compare both (`diff`).
2. `scripts/tests/packaging.test.mjs` — why the root file has to exist.
3. `scripts/init-backlog.mjs` — `TEMPLATE_MD`, i.e. the template a new
   backlog receives.

## Steps

1. Replace the root `_template.md` content with a generic version (based on
   `backlog/_template.md`).
2. Write the ID prefix in the template neutrally (e.g. `<PREFIX>-NNN`) with
   a comment that the value comes from `config.yaml`.
3. Check whether `TEMPLATE_MD` in `init-backlog.mjs` has the same problem —
   it is what lands in another user's backlog.
4. Decide whether two copies of the template make sense: if not, one of them
   should be derived from the other, not live in parallel.
5. `npm pack --dry-run` — the template is still in the tarball.

## Acceptance criteria

- [ ] The root `_template.md` contains no names, boards, or labels from
      another project.
- [ ] The ID prefix in the template is neutral, neither `BL` nor `TL`.
- [ ] `scripts/tests/packaging.test.mjs` passes (co-location marker kept).
- [ ] `TEMPLATE_MD` in `init-backlog.mjs` checked for the same issue.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the release-readiness audit
- 2026-08-31 in_progress — agent:claude — implementation started
- 2026-08-31 done — agent:claude — the root `_template.md` rewritten: zero
  vocabulary from another project, a NEUTRAL prefix (`<PREFIX>-NNN` pointing
  to `task_id_prefix`), a heading saying the values are just `init`'s
  defaults, and the dictionaries come from YOUR backlog's `config.yaml`.
  Size in the tarball dropped from 4.2 kB to 2.3 kB.
- 2026-08-31 done — agent:claude — step 4 resolved: two copies do NOT make
  sense. The `TEMPLATE_MD` hardcoded in `init-backlog.mjs` is gone — `init`
  now READS `_template.md` from the package. This file ships there anyway,
  because it is the co-location marker, so a second copy of the same content
  in code could have drifted from it, and the drift would have been
  invisible: one version would reach new backlogs, the other would reach a
  human opening the file in `node_modules`. A missing file means a broken
  install and says so plainly — a silent fallback template would produce
  backlogs different from those made by a normal install.
- 2026-08-31 done — agent:claude — THIS TASK'S OWN VERIFICATION WAS FLAWED,
  and I fixed the MEASUREMENT, not the text. The `DPA` pattern without a word
  boundary matched inside "odpadły" [Polish: "fell off"] in the template's <!-- language-guard: allow — the Polish word being discussed is the evidence -->
  prose, so the guard failed on a correct file. Now `grep -w` plus a positive
  control on a probe with an explicit hit — without it, a pattern that
  catches nothing would be green and useless at the same time.
- 2026-08-31 done — agent:claude — two defects found along the way, both
  older than this change: the `doctor` hint appended an "s" to the field name
  and pointed to `statuss:` instead of `statuses:` (fixed here — the
  dictionary key now comes from `FIELD_SHAPES`, not from guessing); and
  `worktrail new` writes a template value unchecked after a dictionary
  change, even though the same value passed via a flag would be rejected —
  [TL-69](TL-69-szablon-po-zmianie-slownikow-przemyca-wartosc-spoza-nich.md).
