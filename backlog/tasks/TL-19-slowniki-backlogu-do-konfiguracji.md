---
id: TL-19
title: Move the backlog's vocabularies out of the code and into configuration
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 4h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: [TL-18]
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
  - backlog/README.md
  - origin#qa/backlog-config-portability.yaml
verification:
  - bash: "node --test backlog/scripts/tests/config.test.mjs"
  - manual: "backlog --dir <someone else's backlog with a different config.yaml> — the viewer shows THEIR statuses, labels and types, zero the origin project vocabulary"
---

## Goal

`pre-launch`, `test_env`, `data-gated`, `owner: founder|claude`, seven
statuses and four priorities are ONE company's process. As long as they sat
in the code, the module was the origin project's tool, not a tool. After this task the code
knows the SHAPE of a field (enum / list / text, how it is written to
frontmatter), and the VALUES come from `backlog/config.yaml`.

## Context

Step 2 of two preparing the module for extraction (step 1: [TL-18](TL-18-katalog-danych-backlogu-jako-argument.md)).

Along the way, a third `boards.yaml` parser disappears — the same shape was
read independently by `build-backlog`, `build-viewer` and
`check-backlog-boards`; a comment in the guard called this outright "the
price of no dependency".

Full configuration contract, list of keys, and boundaries:
[`docs/architecture/backlog-config-and-portability.md`](../../docs/backlog-config-and-portability.md).

## Steps

1. `backlog/scripts/config.mjs` — DEFAULTS (generic), a narrow `config.yaml`
   parser, one `boards.yaml` parser, consistency validation across
   vocabularies.
2. `backlog/config.yaml` — the origin project's values, one-to-one with what was in the
   code.
3. `task-fields.mjs` — `FIELD_SHAPES` (shape) + `buildFieldSpecs(config)`
   instead of `EDITABLE_FIELDS` with constants.
4. `build-backlog.mjs` — archival statuses, priority ordering, epic aliases,
   the board registry, and view headers from configuration.
5. `build-viewer.mjs` — facet options, label axes, the default burndown axis,
   stat chips, dashboard breakdowns, status/priority/label colors, and the
   page title from configuration.

## Acceptance criteria

- [x] the origin project's `config.yaml` reproduces the pre-change vocabularies value for
      value (parity test).
- [x] DEFAULTS contain not a single word from the origin project's vocabulary.
- [x] A viewer built with a foreign configuration contains no the origin project vocabulary
      (a gate on the resulting HTML).
- [x] An unknown key in `config.yaml` FAILS instead of disappearing.
- [x] Inconsistency between vocabularies (an archival status outside
      `statuses`, a board's `default:` outside the list) fails.
- [x] Generated views are unchanged except for the header, which now names
      the project.
- [x] One `boards.yaml` parser instead of three.

## Verification

```bash
node --test backlog/scripts/tests/config.test.mjs      # 14 tests
node --test backlog/scripts/tests/task-fields.test.mjs # 29 tests
```

Proof: `backlog --dir <foreign directory>` with `statuses: [todo, doing,
shipped]` shows those statuses in the viewer's filters, cards, and field
editor.

## Notes

Deliberately left out of scope:
- extracting the dashboard core out of the template literal (a separate step,
  conditional on `backlog stats` in the CLI),
- `init` (bootstrapping the directory in someone else's repo),
- extracting the repo, `bin/` + `lib/`, English-language documentation.

Change visible to the naked eye: the stats chip now says "N closed (X%)" and
counts `archived_statuses` (done + cancelled), not just `done`.

## Log

- 2026-08-29 done — claude — config.mjs + config.yaml + migration of all consumers
