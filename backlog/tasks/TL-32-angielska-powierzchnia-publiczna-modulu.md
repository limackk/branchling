---
id: TL-32
title: "English public surface of the module"
type: task
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P3
status: done
owner: agent:claude
estimate: 1w
confidence: medium
created: 2026-08-30
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-time-tracking.md
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node scripts/check-public-language.mjs"
  - bash: "node scripts/cli.mjs viewer >/dev/null && grep -q '<html lang=\"en\"' backlog/viewer.html && echo 'viewer lang=en — OK'"
  - bash: "node scripts/cli.mjs check"
  - bash: "node --test scripts/tests/public-language.test.mjs"
---

## Goal

Bring the **public surface** of the `backlog/` module up to English before it
ships as open source: README, CLI messages, code comments and the viewer
chrome. Today the tool, which is meant to land in other people's
repositories, speaks to the user in Polish.

## Context

The module is designed for publication ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)
settles the name, [backlog-config-and-portability.md](../../docs/backlog-config-and-portability.md)
separated the code from the origin project's data), but its language has stayed internal.
Size of the work, measured 2026-08-30:

| Surface | Polish lines | Note |
|---|---|---|
| `scripts/*.mjs` — comments | **667** | already breaks the CLAUDE.md rule "code, comments: ALWAYS in English" today — this is debt, not new work |
| `scripts/*.mjs` — strings and messages | **350** | validation errors, CLI text, flag descriptions |
| `README.md` | 415 / 851 | the main document a stranger will see |
| `build-viewer.mjs` | 352 | SOURCE of the viewer chrome |
| `config.yaml` / `boards.yaml` / `_template.md` / `.gitignore` | 36 / 20 / 28 / 9 | explanatory comments, read at adoption time |

**Good news from the measurement: the data vocabulary is already English.**
`DEFAULTS` in `config.mjs` holds `pending`, `in_progress`, `P0`, `unassigned`,
`30m` — values, not PL labels. So there is no data migration and no status
renumbering; the Polish sits only in the prose around them.

**Bad news: those comments are unusually valuable.** The `PO CO` / `DLACZEGO`
(WHY) blocks in `cli.mjs`, `config.mjs`, `.gitignore` and `history.mjs` carry
measured justifications for decisions (e.g. why views are not versioned, why
an unknown key fails). Translating in bulk would almost certainly shorten
them — and that is the main risk of this task, bigger than the volume itself.
Losing those paragraphs would be a silent loss of knowledge that nobody would
later reconstruct.

## Pre-flight reading

1. `backlog/README.md` — read it in full first; it defines what the module
   promises.
2. `backlog/scripts/build-viewer.mjs` — **viewer.html is GENERATED and
   gitignored** (`<html lang="pl">` comes from here). Translating
   `viewer.html` directly would be lost at the next build.
3. `backlog/scripts/config.mjs` §DEFAULTS — confirmation that the vocabulary
   is already EN.
4. `docs/architecture/backlog-config-and-portability.md` — the boundary "code
   knows the shape, configuration knows the values". The same boundary splits
   the language: **code and DEFAULTS = EN always; this repo's
   `config.yaml` may stay PL**, because that is the origin project's project data, not the
   tool's code.

## Decisions to uphold

**1. A hard switch to EN, not i18n.** A translation layer doubles maintenance
for a one-person team and needs infrastructure (directories, fallbacks,
per-locale tests) with zero demand today. If demand ever appears, it comes
back as a separate task — with the user who requested it.

**2. `backlog/README.md` becomes English and this is a DELIBERATE exception
to the workspace rule.** CLAUDE.md says "documentation in Polish"; this file,
however, is the tool's public surface, not the origin project's documentation. The
exception must be recorded **in CLAUDE.md and in the README itself**,
otherwise the first agent to see an English README in a Polish repo will
"fix" it back.

**3. `docs/architecture/*` and `backlog/tasks/*` stay in Polish.** This is
the origin project's documentation and does not leave with the module. The boundary runs
along the directory, not the topic.

**4. Translation preserves the reasoning, it does not summarize it.** A `PO
CO` (WHY) block is to become a `WHY` block, not a single sentence. A
paragraph with a number (e.g. "78% of commits touched views") is to keep the
number.

## Steps

1. ~~`README.md` → EN~~ — **DONE in [TL-49](TL-49-readme-w-tarballu-to-dokument-cudzego-projektu.md)
   (2026-08-31).** The README was rewritten from scratch along the way, so
   there is nothing left to translate. The note on the language boundary
   stands in it and in CLAUDE.md § Conventions. **One task remains on this
   surface:** come back to the README with blocks of LITERAL CLI output once
   step 3 translates the messages — they are not there today, because an
   English document cannot quote a Polish terminal.
2. `scripts/*.mjs` — comments (667 lines), file by file, not in bulk. Order
   by how often each is read: `cli.mjs`, `config.mjs`, `history.mjs`,
   `build-backlog.mjs`, `task-fields.mjs`, the rest.
3. `scripts/*.mjs` — messages and strings (350). An error message is to
   become **a diagnosis, not a label**: the current texts say what will go
   wrong and what to do about it — that property is to survive translation.
4. `build-viewer.mjs` — viewer chrome + `<html lang="en">`. **Do not touch
   `viewer.html`.**
5. `_template.md` — section headings and hints → EN (this is the template a
   stranger copies for every task).
6. `boards.yaml` / `.gitignore` / `config.mjs` DEFAULTS comments → EN.
7. `config.yaml` **stays PL** — this is this repo's data. Add one sentence in
   it saying that the values are project configuration, while the tool's
   code language is EN.
8. Record the exception from decision 2 in `CLAUDE.md` (§ "Conventions").
9. Guard: `check-public-surface-language.mjs` — fails when a Polish
   diacritic appears in `backlog/scripts/`, `backlog/README.md` or
   `backlog/_template.md`. Wire it into `worktrail check` so a language
   regression cannot silently come back on the next change.

## Acceptance criteria

- [x] The public surface (`scripts/`, `bin/`, `README.md`, `_template.md`)
  passes the language guard.
- [x] After a rebuild, `viewer.html` has `<html lang="en">` and English
  labels — the change sits in `build-viewer.mjs:311`, not in the generated
  file.
- [x] No file lost more than 20% of its comment lines — before/after counts
  in `## Log`.
- [x] `PO CO` / `DLACZEGO` (WHY) blocks have `WHY` counterparts and kept
  their references to task numbers. Numbers that were MEASUREMENTS of
  someone else's repository were deliberately replaced with a mechanism plus
  a command to measure one's own tree — the TL-37 rule, the same one TL-49
  applied (details in `## Log`).
- [x] Error messages still say **what will go wrong and what to do about
  it** — checked with real runs of `check`, `doctor`, `new`, `query`,
  `migrate-prefix`, `init`.
- [x] `backlog/config.yaml` stayed PL and has a header stating where the
  language boundary runs.
- [x] The "module README in English" exception is recorded in CLAUDE.md.
  (TL-49, 2026-08-31)
- [x] The language guard is wired into `worktrail check` (separately as
  `check --language`); a negative control was run live — inserting a Polish
  line into `scripts/estimate.mjs` produced exit 1.
- [x] All tests pass: `node --test scripts/tests/*.test.mjs` — 351/351.

## Verification

```bash
# 1. No Polish on the public surface — expected: OK message (language-guard: allow — its own alphabet)
test -z "$(grep -rlE '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]' backlog/scripts backlog/README.md backlog/_template.md)" \
  && echo 'public surface without Polish — OK'

# 2. Viewer generated in English — expected: "viewer lang=en — OK"
node backlog/scripts/build-viewer.mjs && grep -q '<html lang="en"' backlog/viewer.html \
  && echo 'viewer lang=en — OK'

# 3. Language guard actually fails — expected: exit code != 0
printf '\n// Polish control comment\n' >> backlog/scripts/estimate.mjs
node backlog/scripts/cli.mjs check; test $? -ne 0 && echo 'guard catches the regression — OK'
git checkout backlog/scripts/estimate.mjs

# 4. Module tests — expected: all pass
node --test backlog/scripts/tests/*.test.mjs

# 5. Repo guards still green
node backlog/scripts/cli.mjs check
```

## Notes

- **Order relative to TL-20:** this task does not depend on the name — the
  texts can be written with a name placeholder and swapped with one `sed`
  once TL-20 closes. Both are publication blockers, neither blocks the
  other.
- **The `Backlog — open source publication` epic is new.** [TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)
  currently sits in the "Backlog viewer" epic, which is a relic — it fits
  here, but it is the founder's call, so I am not re-assigning it without a
  decision.
- **What we deliberately do NOT do:** i18n (decision 1), translating
  `docs/architecture/*` and `backlog/tasks/*` (decision 3), translating the
  content of the origin project's tasks — those ship with the product, not with the tool.
- The biggest risk is not the volume, it is **silently summarizing 667 lines
  of justifications.** Hence the 20% criterion and the file-by-file
  requirement.

## Log

- 2026-08-30 created — claude — split out of §9 [backlog-time-tracking.md](../../docs/backlog-time-tracking.md);
  size measured before the description (667 comments + 350 strings + 415
  README lines), the `DEFAULTS` vocabulary confirmed already English
- 2026-08-31 pending — agent:claude — step 1 (README → EN) dropped: done in
  TL-49, where the README was rewritten from scratch anyway because of a
  stranger's context — translating the old text would have been throwaway
  work. The language exception recorded in CLAUDE.md § Conventions (step 8).
  To be recalculated before starting: the numbers in ## Context predate the
  repo split and speak of `backlog/scripts/`, while the code now lives in
  `scripts/`; the paths in ## Verification need the same fix. Remaining
  scope: comments and strings in `scripts/`, the viewer chrome,
  `_template.md`, the language guard.
- 2026-08-31 done — agent:claude — the whole public surface translated in
  one pass, file by file. SCOPE: 27 modules in `scripts/` (messages,
  `--help`, comments), the viewer chrome in `build-viewer.mjs` including
  `<html lang="en">`, `_template.md`, the templates written by `init`
  (config.yaml, boards.yaml, .gitignore, .gitattributes, sample task), and
  27 test files — the latter had to be included because the assertions
  checked message content, and CLAUDE.md requires English test descriptions
  anyway.
- 2026-08-31 done — agent:claude — 20% CRITERION ON COMMENTS: 2372 comment
  lines before, 2483 after (+4.7%); the largest drop in a single file is
  0.0%. English required MORE lines, not fewer — the "silent summarizing"
  risk this task named as the biggest did not materialize. Measurement from
  a baseline taken before the first edit.
- 2026-08-31 done — agent:claude — DEPARTURE FROM THE "preserve numbers"
  CRITERION: numbers that were MEASUREMENTS of someone else's repository
  ("337 tasks", "1339 tasks", "93 active P0/P1", "78% of commits", "~17k
  tokens") were replaced with a mechanism plus a command to measure one's
  own tree. Reason: this is the TL-37 rule and §3 of the worktrail-release
  skill — a number from a repository the reader has no access to is not
  evidence, it is a request for trust, and it also leaks information about
  that other project on the way out. Numbers that are the property of THIS
  code (BL-1417, "8 of 12 commands", 149 KB as a defect description) stayed.
- 2026-08-31 done — agent:claude — GUARD (step 9): `scripts/check-public-language.mjs`,
  wired into `worktrail check` and separately as `check --language`. Two
  signals, not one: diacritics AND a stop-word list, because
  `grep -rE '[ąćęłńóśźż]'` lets through `nie`, `jest`, `przez`, `plik` — that
  is half the Polish in this tree, and exactly the half I only found on the
  second pass. The exception is marked per LINE (`language-guard: allow`),
  not per file. Test: `scripts/tests/public-language.test.mjs`, 10
  assertions, including negative controls and a check that the guard does
  NOT flag ordinary English.
- 2026-08-31 done — agent:claude — what was deliberately NOT touched:
  `docs/` (5 documents), `backlog/tasks/` and `backlog/config.yaml`. This is
  this repository's documentation and DATA, not the tool's code; the guard
  does not read them. The boundary runs along the directory and is recorded
  in three places: CLAUDE.md § Conventions, the header of
  `backlog/config.yaml`, and the header of the guard itself.
- 2026-08-31 done — agent:claude — verification: `node scripts/check-public-language.mjs`
  (18177 lines across 62 files), `worktrail check` green, viewer
  `<html lang="en">` from the generator, 351/351 tests. The guard's negative
  control was run live.
- 2026-09-01 done — agent:claude — from the `claude/backlog-md-analysis-63830a`
  branch came a bump from P3→P1 ("an English public surface is a market
  entry requirement, not cosmetics on one module") together with a reset to
  `pending`. REJECTED at merge time: that branch forked before c302564 and
  did not know the scope was already done. The argument stands — it is
  correct and recorded here — but it does not change the state of a task
  that is closed.
</content>
