---
id: TL-586
title: "An older release reading a newer backlog is told to upgrade"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:impl-tl-586
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-11-06
updated: 2026-11-06
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: requires-version-refuses-with-upgrade
    bash: "node --test scripts/tests/config*.test.mjs"
  - id: declare-raises-requirement
    bash: "node --test scripts/tests/declare*.test.mjs"
---

## Goal

A backlog written by a newer release tells an older release to upgrade instead of calling its own configuration a typo, and a backlog states the oldest release that can read it.

## Context

Measured on 2026-11-06: a backlog created by v0.1.0, then given `releases:` by v0.3.0 (`declare releases 1.0`), makes v0.1.0 and v0.2.0 fail `build`, `check`, `stats` and every other command that loads config.yaml, with `unknown key releases` followed by 'fix the file ... an unknown key is a typo, not a new capability' (scripts/config.mjs, the KNOWN_KEYS branch of the parser). The file is correct; the tool is old. Because the installed pre-commit hook runs `branchling check`, a teammate still on v0.2.0 cannot commit anything at all, including changes unrelated to the backlog. A new optional TASK field (`release:`) does not break older releases; a new config KEY does, and every minor release so far has added some (v0.2.0: conflict_group_from, closing_contract; v0.3.0: deploy_targets, releases, release_gate, release_gate_accept). Releases up to v0.3.0 cannot be fixed retroactively; the point is that from the next release on, the failure names its cause.

## Steps

1. Record, beside each key in DEFAULTS, the release that introduced it, so a writer knows which minimum a key implies.
2. Add a config key (for example `requires_version`) that the parser reads BEFORE rejecting unknown keys; when the running version is older, refuse once with the required and running versions and the npm command that upgrades, instead of listing unknown keys.
3. Make `declare`, and any other command that writes a key, raise `requires_version` to that key's release when it is lower, in the same diff.
4. Without `requires_version`, an unknown key with no near match says it may come from a newer release and prints the running version.
5. State in the next release notes that a backlog whose config uses a key from a release must be read by that release or later, and that teams upgrade together.

## Acceptance criteria

- [x] A config whose requires_version is above the running version fails with both versions and the upgrade command, and no unknown-key list. [proof: requires-version-refuses-with-upgrade]
- [x] Declaring a key introduced in a release raises requires_version to that release when it was lower, and leaves a higher one alone. [proof: declare-raises-requirement]
