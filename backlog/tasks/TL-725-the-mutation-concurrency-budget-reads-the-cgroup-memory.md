---
id: TL-725
title: "The mutation concurrency budget reads the cgroup memory limit"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: pending                    # pending | in_progress | blocked | done | cancelled
owner: unassigned
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 2h
confidence: medium                 # how much you trust the estimate
created: 2026-11-13
updated: 2026-11-13
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: cgroup-headroom-budget
    bash: "node --test scripts/tests/mutation-run.test.mjs"
---

## Goal

chooseConcurrency in scripts/mutation-slot.mjs budgets from the memory the run's own cgroup can still take, not only from os.freemem(), so a mutation run inside a memory-capped scope never plans more workers than that scope can hold.

## Context

chooseConcurrency defaults `freeBytes` to os.freemem(), which reports the whole machine. Observed 2026-11-13 09:20 CET: a session started under `systemd-run --user --scope -p MemoryMax=32G` sits in its own transient scope under app.slice with memory.max = 34359738368, while `free -g` reports 55 GiB free on a 60 GiB machine. A run without an explicit --concurrency therefore budgets for 55 GiB inside a 32 GiB cgroup. When the cgroup fills, the kernel's memcg OOM killer (CONSTRAINT_MEMCG) removes the largest process in it, which can be a legitimate Stryker worker: Stryker then reads the killed test run as a killed mutant, so the score is wrong without any visible error. The supervised loops currently avoid this only by passing --concurrency 2 by hand. On cgroup v2 the path is the `0::<path>` line of /proc/self/cgroup; the limit may sit on any ancestor (`max` means none), and the usable headroom is the smallest `memory.max - memory.current` along the path to the root. On a machine without cgroup v2 (macOS, cgroup v1) or with `max` everywhere, the current behaviour stays.

## Steps

1. Read /proc/self/cgroup and walk /sys/fs/cgroup<path> up to the root, taking the smallest finite memory.max - memory.current; take the cgroup root as a parameter so a test can point it at a fixture directory.
2. Pass min(os.freemem(), that headroom) as freeBytes, and make the reason sentence name which of the two set the budget and the cgroup path when it was the cgroup.
3. Keep os.freemem() unchanged when /proc/self/cgroup is missing, is cgroup v1, or every level reads `max`; an unreadable file is not a limit.
4. Test with fixture directories: a limit below free RAM lowers the chosen value; `max` everywhere leaves it as before; a limit on an ancestor, not the leaf, still counts.

## Acceptance criteria

- [ ] a fixture cgroup whose memory.max leaves less headroom than os.freemem() lowers the concurrency chooseConcurrency returns, and its reason names the cgroup limit [proof: cgroup-headroom-budget]
