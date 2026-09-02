---
id: TL-34
title: "Home directory — preferences and project registry"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-08-30
blocked_by: [TL-33]
blocks: [TL-35, TL-36]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test backlog/scripts/tests/home.test.mjs backlog/scripts/tests/registry.test.mjs"
  - bash: "WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs where --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'), d; print('WORKTRAIL_HOME respected — OK')\""
---

## Goal

Give the tool a **user home directory**: preferences (facts about the person,
not the project) and a project registry as an **index of pointers**. This is
the layer that lets `worktrail` stop being a single repository's module,
without moving data out of that repository.

## Context

Today there is not a single `homedir()` or `XDG_` anywhere in the module — all
configuration lives in the repo. That was correct (TL-19: the code knows the
shape, configuration knows the values), but it leaves three things with no
home: actor identity, machine preferences, and the knowledge that there can be
more than one project.

**This task's biggest risk is not technical — it is Law 3**
([worktrail-global-tool.md §3](../../docs/worktrail-global-tool.md)). Two
configuration layers are guaranteed to drift apart if both can speak about the
same thing. The boundary must therefore be **disjoint, not prioritized**:

| Layer | Holds | May not touch |
|---|---|---|
| user | actor, editor, theme, port, date format | statuses, priorities, labels, boards, colors, `title_max_length` |
| project | project vocabulary | a person's identity |

A key in the wrong layer **FAILS**, the same way an unknown key in
`config.yaml` fails today. A "user overrides project" precedence is
**excluded** here, because it would give two people different boards for the
same repository.

Second risk: a registry that silently becomes a source of truth. Upward
detection from cwd already solves "where is my backlog", and **the registry
must not duplicate that** — it is an index, and deleting it must be harmless
(Law 2).

## Pre-flight reading

1. `docs/architecture/worktrail-global-tool.md` — §3 (the four laws), §5
   (where the directory lives), §7 (the registry as index), §8
   (multi-repository workspace).
2. `backlog/scripts/config.mjs` — `DEFAULTS`, `KNOWN_KEYS`, how an unknown key
   is made to fail. The user layer must repeat this rigor, not invent its own.
3. `backlog/scripts/paths.mjs` — `looksLikeBacklogDir()`; the registry
   revalidates through this function, not through `existsSync`.
4. `docs/architecture/backlog-config-and-portability.md` — why the values
   moved out into configuration.

## Steps

1. `backlog/scripts/home.mjs` — resolve the home directory per §5:
   `WORKTRAIL_HOME` → `XDG_CONFIG_HOME`/`XDG_DATA_HOME` → `~/.config` +
   `~/.local/share` → `%APPDATA%`. The **config vs data** split is part of the
   contract, not a detail.
2. The directory name comes from **one constant** — `worktrail` is a
   provisional name ([TL-20](TL-20-domknij-nazwe-narzedzia-przed-publikacja.md)),
   a rename must not be a grep.
3. `USER_KEYS` — a **closed** list of user-layer keys. A key from the
   project's `KNOWN_KEYS` used in the user layer FAILS with a message saying
   where it belongs (a diagnosis, not a label).
4. Merging the layers: **a disjoint union**, never an override. A negative
   test for an attempt to override `statuses` from the user layer.
5. `<config>/projects.yaml` — the registry: `name` (a local label for the
   user) + `path` (the **backlog** directory, not the git repository — §8).
6. `worktrail project add|list|remove` plus registration from `worktrail
   init`. Registration is **not a precondition** for any other command to
   work.
7. Revalidation on use via `looksLikeBacklogDir()`; **a missing path is
   REPORTED**, never silently skipped.
8. `worktrail where` — prints the config directory, the data directory, the
   backlog found, and **which source** found it
   (`explicit`/`env`/`discovery`/`colocated`/`registry`). This is the answer
   to every new user's first question and to §11 point 3.
9. Tests: `home.test.mjs` (source order, Windows, XDG), `registry.test.mjs`
   (revalidation, missing path, deletability, multi-repository workspace).

## Acceptance criteria

- [ ] `WORKTRAIL_HOME` wins over everything — there is a test for this (and it
      is the test hook for the rest).
- [ ] `XDG_CONFIG_HOME`/`XDG_DATA_HOME` respected when set; default to
      `~/.config` + `~/.local/share`.
- [ ] Config and data are **separate** directories — there is an assertion for
      this, not just intent.
- [ ] A project-vocabulary key (`statuses`, `labels`, `boards`…) in the user
      layer **FAILS** with a message pointing to the right layer — negative
      test.
- [ ] The user layer cannot override ANY value from the project's
      `config.yaml` — a test, not a declaration.
- [ ] Deleting `projects.yaml` does not break any command that runs inside a
      repo — a test (Law 2).
- [ ] An entry with a nonexistent path is reported, not skipped — a test.
- [ ] The registry holds the **backlog** directory; a layout of "repo root +
      9 sub-repos" (this workspace) yields ONE project, not ten — a test on a
      fixture of that shape.
- [ ] `worktrail where` reports the source of the backlog resolution.
- [ ] No command starts REQUIRING `--project` — if one does, the registry has
      become a source of truth and that is a regression (§11 point 2).

## Verification

```bash
# 1. Home directory and registry tests — expected: pass
node --test backlog/scripts/tests/home.test.mjs backlog/scripts/tests/registry.test.mjs

# 2. WORKTRAIL_HOME wins — expected: OK message
WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs where --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'); print('WORKTRAIL_HOME respected — OK')"

# 3. The registry is deletable — expected: commands keep working
WORKTRAIL_HOME=/tmp/worktrail-probe rm -f /tmp/worktrail-probe/config/projects.yaml
node backlog/scripts/cli.mjs query --count && echo 'missing registry harmless — OK'

# 4. The user layer cannot override vocabulary — expected: nonzero exit code
mkdir -p /tmp/worktrail-probe/config && printf 'statuses: [foo]\n' > /tmp/worktrail-probe/config/config.yaml
WORKTRAIL_HOME=/tmp/worktrail-probe node backlog/scripts/cli.mjs query --count; test $? -ne 0 && echo 'wrong layer fails — OK'
rm -rf /tmp/worktrail-probe

# 5. Module guards
node backlog/scripts/cli.mjs check
```

## Notes

- **No daemon.** The registry is a YAML file read at startup; a resident
  process would add a lifecycle, logs, and restarts, just to save one read.
- **No home-directory sync** across machines — that is the hosted version's
  problem ([worktrail-state-and-sync.md §6](../../docs/worktrail-state-and-sync.md)).
- An assumption to be disproven: the registry may never gain a second entry
  (§11 point 1). In that case [TL-36](TL-36-widok-przekrojowy-nad-wieloma-projektami.md)
  has no recipient, but this task justifies itself regardless — the
  preferences layer and `where` are needed even with a SINGLE project.

## Log

- 2026-08-30 created — claude — from the global-tool project (docs/architecture/worktrail-global-tool.md); the configuration-layer boundary is disjoint, not prioritized — two layers speaking about the same thing is a guaranteed drift
