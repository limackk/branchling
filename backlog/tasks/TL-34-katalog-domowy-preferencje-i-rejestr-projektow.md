---
id: TL-34
title: "Home directory — preferences and project registry"
type: code
labels: [post-launch]
board: main
epic: "Backlog — open source publication"
priority: P2
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-30
updated: 2026-09-02
blocked_by: [TL-33]
blocks: [TL-35, TL-36]
related_docs:
  - docs/branchling-global-tool.md
  - docs/backlog-config-and-portability.md
verification:
  - id: home-and-registry
    bash: "node --test scripts/tests/home.test.mjs scripts/tests/registry.test.mjs"
  - id: home-env-wins
    bash: "WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs where --json | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'), d; print('WORKTRAIL_HOME respected — OK')\""
  - id: registry-deletable
    bash: "rm -rf /tmp/worktrail-probe; WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs query --count > /dev/null && echo 'missing registry harmless — OK'"
  - id: wrong-layer-fails
    bash: "rm -rf /tmp/worktrail-probe; mkdir -p /tmp/worktrail-probe/config; echo 'statuses: [foo]' > /tmp/worktrail-probe/config/config.yaml; WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs query --count > /dev/null 2>&1; rc=$?; rm -rf /tmp/worktrail-probe; test $rc -ne 0 && echo 'wrong layer fails — OK'"
  - id: guards
    bash: "node scripts/cli.mjs check"
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
([worktrail-global-tool.md §3](../../docs/branchling-global-tool.md)). Two
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

1. `docs/branchling-global-tool.md` — §3 (the four laws), §5
   (where the directory lives), §7 (the registry as index), §8
   (multi-repository workspace).
2. `scripts/config.mjs` — `DEFAULTS`, `KNOWN_KEYS`, how an unknown key
   is made to fail. The user layer must repeat this rigor, not invent its own.
3. `scripts/paths.mjs` — `looksLikeBacklogDir()`; the registry
   revalidates through this function, not through `existsSync`.
4. `docs/backlog-config-and-portability.md` — why the values
   moved out into configuration.

## Steps

1. `scripts/home.mjs` — resolve the home directory per §5:
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

One line each: the parser reads the `- [ ]` line and nothing under it (TL-118),
so a wrapped `[proof:]` marker is invisible to it.

- [x] `WORKTRAIL_HOME` wins over everything, and is the hook the rest is tested through. [proof: home-env-wins, home-and-registry]
- [x] `XDG_CONFIG_HOME`/`XDG_DATA_HOME` are respected when set, defaulting to `~/.config` and `~/.local/share`. [proof: home-and-registry]
- [x] Config and data are SEPARATE directories — an assertion under every rule, not an intention. [proof: home-and-registry]
- [x] A project-vocabulary key in the user layer FAILS, with a message naming the file it belongs in. [proof: wrong-layer-fails, home-and-registry]
- [x] The user layer cannot override ANY project value — the two key sets are disjoint, and a test says so. [proof: home-and-registry]
- [x] Deleting `projects.yaml` breaks no command that runs inside a repository. [proof: registry-deletable, home-and-registry]
- [x] An entry whose path is gone is reported, never skipped. [proof: home-and-registry]
- [x] The registry's unit is the BACKLOG directory: a workspace of nine repositories around one backlog is ONE project. [proof: home-and-registry]
- [x] `where` reports which RULE resolved the backlog, not only the path. [proof: home-and-registry]
- [x] No command requires `--project` — checked against the command table, not asserted in prose. [proof: home-and-registry]
- [x] The guards still pass over the whole source and the whole backlog. [proof: guards]

## Decision (2026-09-02)

**The contract was rewritten to this repository's paths**, as TL-27, TL-28 and
TL-31 were: it named `backlog/scripts/` and `docs/architecture/`, the layout of
the repository this tool was extracted from. Nothing about its substance
changed, and the checks that stood only in the body's prose — the registry being
deletable, the wrong layer failing, and the guards — were promoted into the
frontmatter rather than invented.

**The user layer is loaded in `loadConfig()`, in ONE place, and joined
disjointly.** Not per command, because a user file holding a project key has to
FAIL in every command rather than in the two that remembered to look — a
`statuses:` in the wrong file that merely does nothing is the worst available
outcome, since the person believes they changed the vocabulary. The preferences
land under `config.user`, a namespace of their own that nothing above ever reads
from, so there is no precedence rule to get wrong: `parseUserConfig` refuses a
project key before it can reach the object. The test for "cannot override ANY
value" is therefore structural — the two key sets are asserted disjoint — rather
than a case per key, which could only ever cover the keys somebody thought of.

**`home` collapses onto `config` when the two are split, and that is stated
rather than left to be discovered.** Under XDG and under the platform defaults
there is no single root the other two derive from; only an explicit
`WORKTRAIL_HOME` gives one. `where` prints all three plus the rule that decided.

**`process.platform` is injected into `homePaths()`.** The Windows branch is
otherwise unreachable from this suite, and a rule no test can run is a rule
nobody has checked — the same reasoning that makes `spawnSync` injectable in
`lock.mjs`.

**The directory name is `BLOCK_MARKER_NAME`, not `PRODUCT_NAME`**, and
`WORKTRAIL_HOME` is spelled out with a `product-name: allow`. Both are KEYS
rather than display text: a path holding a person's own files, and a variable
they type into a shell profile. Derived from the display name, a rename would
silently move somebody's preferences to a directory the tool then reports as
empty, and would break a variable set in files this project cannot reach.

**A name clash is refused BEFORE the rename branch, not after it.** Registering
a backlog under a label another project holds would otherwise half-apply — the
old entry renamed, the clash found too late, and two entries left sharing what
is supposed to be a lookup key. A test covers it; it was a real defect in the
first draft, found by the test that asserted both names were unchanged after a
refusal.

**What is deliberately NOT done: the preferences are not yet CONSUMED by the
commands.** `actor` is resolved in eight separate places, each with its own
`flag || BACKLOG_ACTOR || default` chain, and threading a ninth source through
all of them is a refactor with its own thesis — the actor chain having one home
— not a side effect of adding a layer. The layer is complete and proven: it
parses, it validates, it refuses the wrong file, and `where` shows it. TL-157
carries the consumption.

## Verification

```bash
# 1. The home directory and the registry — expected: pass
node --test scripts/tests/home.test.mjs scripts/tests/registry.test.mjs

# 2. WORKTRAIL_HOME wins — expected: OK message
WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs where --json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); assert d['home'].startswith('/tmp/worktrail-probe'); print('WORKTRAIL_HOME respected — OK')"

# 3. The registry is deletable — expected: commands keep working
rm -rf /tmp/worktrail-probe
WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs query --count && echo 'missing registry harmless — OK'

# 4. The user layer cannot override vocabulary — expected: nonzero exit code
mkdir -p /tmp/worktrail-probe/config && echo 'statuses: [foo]' > /tmp/worktrail-probe/config/config.yaml
WORKTRAIL_HOME=/tmp/worktrail-probe node scripts/cli.mjs query --count; test $? -ne 0 && echo 'wrong layer fails — OK'
rm -rf /tmp/worktrail-probe

# 5. Module guards
node scripts/cli.mjs check
```

## Notes

- **No daemon.** The registry is a YAML file read at startup; a resident
  process would add a lifecycle, logs, and restarts, just to save one read.
- **No home-directory sync** across machines — that is the hosted version's
  problem ([worktrail-state-and-sync.md §6](../../docs/branchling-state-and-sync.md)).
- An assumption to be disproven: the registry may never gain a second entry
  (§11 point 1). In that case [TL-36](TL-36-widok-przekrojowy-nad-wieloma-projektami.md)
  has no recipient, but this task justifies itself regardless — the
  preferences layer and `where` are needed even with a SINGLE project.

## Log

- 2026-08-30 created — claude — from the global-tool project (docs/architecture/worktrail-global-tool.md); the configuration-layer boundary is disjoint, not prioritized — two layers speaking about the same thing is a guaranteed drift
