---
id: TL-726
title: "A runaway mutant's test process dies at a per-process memory cap"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-3
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 3h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: command-carries-cap
    bash: "node --test scripts/tests/mutation-run.test.mjs"
  - id: runaway-dies-at-cap
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

Every test process a mutation run starts carries a per-process data cap (RLIMIT_DATA), so a mutant that allocates without bound dies alone within seconds instead of exhausting its cgroup or the whole machine.

## Context

2026-11-13 08:09 CET: a whole-module run of scripts/check-no-foreign-context.mjs (253 mutants, --concurrency 2) stopped at 107/253 when one `node` test process reached 30 GB anon-rss (total-vm 39.8 GB) in under a minute. The memory was off the V8 heap, so --max-old-space-size would not have stopped it, and Stryker's 30 s timeout came too late. The global OOM killer then removed the terminal unit (OOMPolicy=stop) and every session running in it. A session cgroup (`systemd-run --scope -p MemoryMax=32G`) now keeps the kill local, but the runaway still takes the whole session budget before it dies and starves every other suite in that session. The cap is currently applied only by a `node` wrapper on PATH that lives outside this repository, so nobody else running `npm run mutation` has it.

Measured on main afff7d2, 2026-11-13 09:25-09:33 CET, with `ulimit -d 4194304` (4 GiB): the full suite is green (3483 pass, 0 fail, 2 skipped, 297 s) and its largest process peaked at ~121 MB VmData; `npm run mutation -- --named-only --files scripts/product.mjs --concurrency 4` finished 19/19 killed, and the largest sampled process (mutation-run.mjs) peaked at ~175 MB. The Stryker parent process was not sampled, because its process name is not `node`, but it ran to completion under the cap. A runaway Buffer allocation died at 3.75 GiB (`Array buffer allocation failed`) in 0.7 s; a V8-heap runaway died at about 4 GiB (SIGABRT, `JavaScript heap out of memory`) in 2.2 s. RLIMIT_DATA counts only writable private mappings, so V8's PROT_NONE address-space reservations do not trip it; RLIMIT_AS would, which is why it is not the tool for node. Linux enforces RLIMIT_DATA for mmap; macOS does not, so there the cap is advisory and --help has to say so.

## Steps

1. Prefix the test command that sandboxCommand in scripts/mutation-run.mjs builds with `ulimit -d <KiB>` so the cap reaches every test process of every worker and the processes they spawn.
2. Add a --memory-cap <size> flag with a default well above the measured peak (4G is about 30 times the suite's largest process); 0 or `none` disables it; an unparsable value fails.
3. Say in --help and the run header what the cap is and that macOS does not enforce it.
4. Report, after the run, the mutants whose test process died at the cap (an allocation failure in its output), because those were detected by the cap, not by an assertion.

## Acceptance criteria

- [x] the command sandboxCommand builds sets the data cap before node --test, and --memory-cap none leaves it out [proof: command-carries-cap]
- [x] a process started under the command's cap that allocates beyond it exits with an allocation failure instead of growing (positive control on Linux, skipped where RLIMIT_DATA is not enforced) [proof: runaway-dies-at-cap]
