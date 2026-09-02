---
id: TL-18
title: Detach the backlog data directory from the code's location
type: code
labels: [pre-launch]
board: main
epic: "Backlog viewer"
priority: P2
status: done
owner: claude
estimate: 3h
confidence: high
created: 2026-08-29
updated: 2026-08-29
blocked_by: []
blocks: [TL-19]
related_docs:
  - docs/backlog-config-and-portability.md
  - backlog/README.md
  - origin#qa/backlog-config-portability.yaml
verification:
  - bash: "node --test backlog/scripts/tests/paths.test.mjs"
  - bash: "node backlog/scripts/build-backlog.mjs --dir /tmp/inny-backlog"
  - manual: "backlog --dir <inny katalog> — viewer pokazuje TAMTEN backlog, kod zostaje ten sam"
---

## Goal

Every script computed the data directory from its own location
(`join(__dirname, "..")`). This works for exactly as long as the code and
the data are the same directory — that is, until the first attempt to run
the module over a different repository. After this task, the data directory
is an argument, not a property of where the `.mjs` file happens to sit.

## Context

Step 1 of two that prepare the module to be extracted as a separate tool
(conversation with the founder, 2026-08-29, the "open source + CLI" thread).
Step 2 is [TL-19](TL-19-slowniki-backlogu-do-konfiguracji.md).

We are not extracting the repo here, nor moving files — the goal is to
remove the ASSUMPTION, so that the extraction later is one `git subtree
split`, not archaeology.

Full justification and boundaries:
[`docs/architecture/backlog-config-and-portability.md`](../../docs/backlog-config-and-portability.md).

## Steps

1. `backlog/scripts/paths.mjs` — `resolveBacklogDir()` with source order:
   `--dir` → `BACKLOG_DIR` → detection upward from cwd → co-location;
   `backlogPaths()` as the only place that knows the file names in the
   directory.
2. All scripts (`build-backlog`, `build-viewer`, `serve-backlog`, `query`,
   `history-record`, `suggest-board`, both guards) move to the resolver;
   `--dir` is accepted the same way everywhere.
3. `readTasks(root)` / `buildHtml(tasks, stats, config)` — the exported
   functions take the directory and configuration as arguments, instead of
   reading module-global constants.

## Acceptance criteria

- [x] No script derives the data directory from `__dirname` other than as a
      LAST fallback.
- [x] `--dir` works in every script that touches data.
- [x] Detection requires a marker (`tasks/` plus `boards.yaml` /
      `config.yaml` / `_template.md`), not `tasks/` alone.
- [x] A directory pointed to explicitly that is not a backlog is an ERROR,
      not a silent fall-through to the next source.
- [x] The `backlog` alias, run from any directory, still hits this backlog
      (co-location).
- [x] Views generated after the change are byte-identical (apart from the
      header from TL-19).

## Verification

```bash
node --test backlog/scripts/tests/paths.test.mjs   # 9 tests
```

Proof of the separation: `node backlog/scripts/build-backlog.mjs --dir
<foreign directory>` generates views for THAT tree, and `git diff` in this
repository is empty.

## Log

- 2026-08-29 done — claude — resolver plus migration of every script
