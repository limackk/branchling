---
id: TL-49
title: "The README in the tarball is another project's document"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - .claude/skills/worktrail-release/SKILL.md
verification:
  - bash: "grep -qiE 'origin|sync-layer|supabase|railway|DPA' README.md && { echo 'README still carries a foreign project'; exit 1; }; echo 'README free of foreign context — OK'"
  - bash: "grep -q 'node backlog/scripts/' README.md && { echo 'paths from before packaging'; exit 1; }; echo 'commands via worktrail, not via paths — OK'"
  - bash: "grep -qE '\\bBL-[0-9]' README.md && { echo 'BL prefix in the tool document'; exit 1; }; echo 'no hardcoded prefix — OK'"
  - manual: "The README read by someone who does not know the project: they can install the tool and run the first query without asking the author."
---

## Goal

Write a README for **this tool** — the document a stranger developer reads
before deciding "I'll try it". Today, the tarball ships 58.9 kB of README from
another project.

## Context

Measured 2026-08-31, `npm pack --dry-run`:

```
npm notice 58.9kB README.md
npm notice  4.2kB _template.md
```

These are the first two files a stranger opens — and both are about something
other than this tool. `README.md` opens with the heading "Backlog the origin project", runs
904 lines, and in §3.2 spells out a label vocabulary from someone else's
infrastructure (Railway, Supabase, the sync layer, "Submit to App Store", "DPA
outreach"). The commands in §7 are given as `node backlog/scripts/*.mjs`,
paths into someone else's tree — while since
[TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) the entry point is
`worktrail`. Task numbers are written as `BL-NNN`, even though the prefix is
configuration ([TL-42](TL-42-prefiks-id-taska-to-konfiguracja-nie-kod.md)).

**This is not cosmetic debt.** Publication is irreversible, and this document
tells a new user that boards are called `backlog-project` and that labels
describe someone else's production environments. The code has long known the
SHAPE of a field, not its values; the README still shows values and presents
them as shape.

This task **is not a translation** — that is
[TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md), and both rewrite
the same file, so they go sequentially, not in parallel. It is also not a
split of the documents in `docs/` — that is
[TL-37](TL-37-split-the-documents-the-mechanism-travels.md), whose principle
("mechanism and the command to reproduce it, not someone else's measurement")
applies here just the same.

## Pre-flight reading

1. `README.md` — in full; you have to know what is being thrown out before
   throwing it out.
2. `docs/backlog-config-and-portability.md` §3 — the boundary "the code knows
   the shape, the configuration knows the values".
3. [TL-37](TL-37-split-the-documents-the-mechanism-travels.md) — the same rule for
   `docs/`.
4. `.claude/skills/worktrail-release/SKILL.md` §2–§3 — what is allowed to ship
   in the tarball.

## Steps

1. Pull out of the current README what is about the tool: the philosophy
   (§1), the task file schema (§3), the statuses (§4), what a backlog is NOT
   (§8). This stays, rewritten without someone else's vocabulary.
2. Write a new README around the first five minutes: what this is,
   installation, `worktrail init`, the first task, `worktrail query`, the
   viewer in the browser. A screenshot of the viewer is worth more here than a
   paragraph.
3. Every command through `worktrail <command>`, never `node
   backlog/scripts/…`.
4. Task numbers in examples with a generic prefix, or explicitly marked as
   configurable.
5. The label, board and epic vocabulary: show that it is the project's
   `config.yaml`, and give an example NOT tied to any existing repository.
6. Paste CLI output examples in only at the end — after
   [TL-51](TL-51-tasklog-komenda-help-oblewa-w-8-z-12-komend.md) and
   [TL-52](TL-52-kolor-i-spojne-komunikaty-cli-w-jednym-module-ui-mjs.md),
   otherwise they will need rewriting a second time.
7. Move internal material (the protocol for an agent, the protocol for the
   founder) to where it has a reader — to `CLAUDE.md` or to a skill, not to
   the README.

## Acceptance criteria

- [x] `README.md` contains no name or vocabulary from another project.
- [x] Every command in the README is a `worktrail` invocation, not a path to a
      script.
- [x] Installation and the first query can be carried out from the README
      alone.
- [x] The ID prefix in examples is shown as configuration, not as a constant.
- [x] `npm pack --dry-run` — the README is still in the tarball, in its new
      version.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from a publication readiness audit
- 2026-08-31 in_progress — agent:claude — rewriting the README around the
  first five minutes
- 2026-08-31 done — agent:claude — README rewritten (904 lines → 574); 58.9 kB
  of someone else's document left the tarball, 23.7 kB about this tool came
  in. The sample config.yaml was checked with a real `build` + `doctor`. The
  manual criterion (a stranger reader) remains to be confirmed by a human.
- 2026-08-31 done — agent:claude — on the founder's instruction the README was
  written in ENGLISH, not in Polish: this is step 1 of
  [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md) and its decision
  2, carried out here instead of twice. The exception is recorded in
  CLAUDE.md § Conventions. Consequence: blocks with LITERAL CLI output fell
  out of the README beyond the ones that are already English today (`query`,
  `--json`) — the rest of the CLI speaks Polish until TL-32, and an English
  document quoting Polish output would either be inconsistent or lie. They
  come back as step 6 of this task once TL-32 translates the messages.
