---
id: TL-456
title: "Windows joins the supported compatibility matrix"
type: task
labels: []
board: main
epic: "Backlog — open source publication"
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-26
updated: 2026-09-26
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: windows-contract
    bash: "node --test scripts/tests/windows-ci.test.mjs scripts/tests/non-colocated-layout.test.mjs scripts/tests/process-tree-interrupt.test.mjs"
  - id: windows-run
    manual: "Inspect the public GitHub Actions run for the task commit and confirm the Windows job completed the full suite and branchling check on the declared Node version."
---

## Goal

The Node 18+ portability promise is measured on Windows as well as Linux and macOS, or any deliberately unsupported command is named precisely instead of leaving Windows users to discover the boundary after installation.

## Context

The public issue template asks for Windows versions, but CI currently exercises only Ubuntu and macOS. A Git-native CLI that manipulates paths, signals, shells, hooks and process trees has platform-specific behavior even with zero npm dependencies. The attractive open-source claim is not that JavaScript is portable; it is that supported workflows are continuously proven.

## Steps

1. Add Windows to the CI matrix for the complete suite and guards, with a supported Node version matrix that remains affordable.
2. Audit path separators, executable lookup, shell commands, process termination, symlinks, hooks and temporary-directory assumptions exposed by the run.
3. Fix portable behavior where it belongs and isolate tests only when the operating system genuinely cannot provide the contract.
4. Document any remaining platform-specific limitations beside installation rather than in a buried troubleshooting section.
5. Add a positive workflow test so Windows cannot disappear from CI while the public support claim remains.

## Acceptance criteria

- [ ] The repository declares and tests a Windows job plus the path and process contracts most likely to differ. [proof: windows-contract]
- [ ] Windows support is demonstrated by a public runner rather than inferred from local code. [proof: windows-run]
