---
id: TL-763
title: "doctor prints a Windows --dir as a bare word cmd reads back"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: []                 # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: doctor-word
    bash: "node --test scripts/tests/doctor.test.mjs scripts/tests/release-fetch-refspec.test.mjs"
---

## Goal

On Windows a fix printed by `doctor --dir` names the directory as a bare word that PowerShell and cmd read back as the same path. Five tests (doctor.test.mjs and release-fetch-refspec.test.mjs) are red on the Windows job, and a Windows user pasting the fix today gets a --dir that does not exist.

## Context

Run 44324012719, windows-latest: every expected fix naming the runner's temporary directory, a drive path with backslashes and an 8.3 short name, arrived with that path wrapped in single quotes. shellWord in scripts/doctor.mjs leaves a word bare only within a POSIX set of safe characters, which holds neither `\` nor the `~` of an 8.3 short name, so every Windows path was quoted; in cmd single quotes are literal characters. The bare set on win32 now also admits `\` and `~`; elsewhere it is unchanged, because there `\` escapes. shellWord takes the platform as a parameter so both answers are proved on any runner. Not decided here: how a Windows path that genuinely needs quoting (a space, an apostrophe) should be printed — PowerShell and cmd disagree on quote characters — which is filed as its own task. Git Bash reads a bare `C:\…` with the backslashes as escapes; the fix is written for the native shells, which is the trade accepted.

## Steps

1. Export shellWord(s, platform = process.platform) from scripts/doctor.mjs with a win32 bare set that admits `\` and `~`.
2. Add a unit test with a win32 and a linux case, the linux one as the positive control.

## Acceptance criteria

- [x] a Windows path is a bare word for win32 and still a quoted one for POSIX, and every doctor fix test holds on this platform [proof: doctor-word]
