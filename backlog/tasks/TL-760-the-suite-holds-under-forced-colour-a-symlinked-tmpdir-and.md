---
id: TL-760
title: "The suite holds under forced colour, a symlinked tmpdir and a translated git"
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
estimate: 1h
confidence: medium                 # how much you trust the estimate
created: 2026-11-21
updated: 2026-11-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: colour-forced
    bash: "FORCE_COLOR=1 node --test --test-name-pattern='template literal is refused|text run names each survivor|Stryker is handed its configuration|plan refused after the write|failing git is named' scripts/tests/mutation-template-text.test.mjs scripts/tests/mutation-run.test.mjs scripts/tests/new-json-refusals.test.mjs"
  - id: colour-absent
    bash: "env -u FORCE_COLOR node --test scripts/tests/mutation-template-text.test.mjs scripts/tests/new-json-refusals.test.mjs"
---

## Goal

Four tests stop asserting the environment of whoever runs them: the colour CI forces, the symlinked temporary directory macOS hands out, and the language git answers in. Every Linux job of the test workflow is red on mutation-template-text alone, and the macOS jobs on three more; until they hold, no release commit can satisfy step 6 of docs/releasing.md.

## Context

Observed on run 44324012719 (main, 08e258e3, 2026-11-18) and on every main run since 56d495d5. (1) scripts/tests/mutation-template-text.test.mjs spawns mutation-run.mjs with the inherited environment; test.yml sets FORCE_COLOR=1, so the refusal arrives with a bold escape and the plain-text assertion fails on all six POSIX jobs. The file asserts plain text, so it declares that with plainOutput() from _repo.mjs (TL-238) rather than stripping escapes per assertion. (2) On macOS tmpdir() is /var/folders/…, a symlink to /private/var/folders/…; git rev-parse --show-toplevel and process.cwd() in a child answer with the real path, so mutation-run.test.mjs ('a text run names each survivor…', 'Stryker is handed its configuration…') and new-json-refusals.test.mjs ('without --json, the plan refused after the write…') compare a real path with an unresolved one. The fixtures resolve their own root with realpathSync once, which is what every consumer of that root sees. (3) 'a failing git is named with its own words…' matched git's English sentence; on a machine whose git speaks another language it fails although the tool did what the test means. The assertion keeps what it proves — git's own detail after the command — without naming the language. Rejected: setting LC_ALL=C on the child, which this machine's git ignores because LANGUAGE wins. Not covered here: the macOS ulimit refusal, the Node 18 signal race and the Windows regressions, each a task of its own.

## Steps

1. Call plainOutput() at the top of scripts/tests/mutation-template-text.test.mjs.
2. Return realpathSync(root) from fixture() in scripts/tests/mutation-run.test.mjs.
3. Compare the written path against realpathSync(dir) in the plan-refused text test of scripts/tests/new-json-refusals.test.mjs.
4. Match git's detail as 'fatal: ' followed by text, not the English sentence.
5. Run the three files under FORCE_COLOR=1 and without it.

## Acceptance criteria

- [x] the four tests hold under the colour test.yml forces, on a macOS temporary directory and a translated git [proof: colour-forced]
- [x] the same files hold through a plain pipe [proof: colour-absent]
