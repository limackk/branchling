---
id: TL-757
title: "The installed release is named in a --json envelope"
type: task
labels: []
board: main
epic: "Proof core"
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-16
updated: 2026-11-16
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: version-envelope
    bash: "node --test scripts/tests/version-json.test.mjs"
  - id: consumers-doc
    bash: "grep -q -- '--version --json' docs/external-consumers.md"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`--version --json` prints `{ "schemaVersion": 1, "kind": "version", "version": "<x.y.z>" }`, so a consumer checks the release it runs against through an envelope instead of reading a line of text.

## Context

Filed on 2026-11-16 from the branchling-proof workspace (its task PF-23; its architecture section 13 lists this capability as U13). That product reaches branchling only through `--json` envelopes and the writing commands, and a capability that changes what `done` accepts as proven belongs in core, not in a consumer. The shape below is a proposal: it is settled with the maintainer before the work starts.

docs/external-consumers.md (Pinning a version) tells a consumer to check `--version` at startup, but `--version` ignores `--json` (checked on 0.4.0: it prints the same text line either way), and no command's envelope names the release. `mcp`'s initialize answer carries it in `serverInfo.version`, but that is a JSON-RPC answer, not a command-line envelope. The consumer's port therefore reads the exact text line and refuses any other wording, an exception to its own rule that its founder approved only until this ships. The text line stays as it is for people.

## Steps

1. Write scripts/tests/version-json.test.mjs red-first: --version --json prints the envelope with the version package.json declares; --version alone still prints the text line (the positive control)
2. Print the envelope and register the `version` kind
3. Document it under Pinning a version in docs/external-consumers.md

## Acceptance criteria

- [ ] --version --json names the installed release in an envelope, and --version alone is unchanged [proof: version-envelope]
- [ ] the external consumer contract documents --version --json [proof: consumers-doc]
- [ ] the full suite stays green [proof: suite]
