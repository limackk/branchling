---
id: TL-102
title: "First-contact demo — worktrail done's refusal in 60 seconds"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: in_progress
owner: agent:claude
estimate: 3h
confidence: medium
created: 2026-09-01
updated: 2026-09-01
blocked_by: [TL-82, TL-49]
blocks: [TL-103]
related_docs:
  - docs/funkcjonalnosci.md
verification:
  - bash: "test -f docs/demo/scenario.md && grep -q 'exit' docs/demo/scenario.md"
  - manual: "A recording (asciinema or GIF) is linked in the README header, runs up to 60 seconds and ends with a RED refusal from `worktrail done`, followed by a fix and a green close"
---

## Goal

A stranger sees, in 60 seconds, the one thing that exists nowhere else:
`worktrail done` REFUSES to close a task because verification failed — it
shows the test's output, the task stays `pending`. Then a fix and a green
close. The recording hangs in the README header as the first contact with
the tool.

## Context

In the "markdown backlog CLI" category, the leader's first contact is a
kanban board in the terminal — nice, but generic. Our distinguisher is
photogenic in a different way: **the refusal is more interesting than the
success.** The scene "an agent says done, the tool says no" names the pain
that everyone working with agents knows from everyday experience — and no
other tool in this category can show it.

Developers do not read scope documents; they watch the GIF in the README
and decide within a dozen seconds. Without this task, all the work on the
mechanism (TL-86, TL-82) is invisible to anyone who does not read the code.

Settled up front:

1. **The scenario is a script in the repo, not an improvisation.**
   `docs/demo/scenario.md` with exact commands — the recording must be
   reproducible after every CLI change, otherwise it rots like any
   screenshot.
2. **Dramaturgy: failure first.** init → a task with `verification:` → work
   "almost finished" → `worktrail done` → RED refusal with the test's output
   → fix → `worktrail done` → green. We are not showing a command tour.
3. **60 seconds is a hard limit.** Anything that does not serve the refusal
   scene is cut.
4. Format: asciinema as the source (text, lightweight, copyable), GIF as a
   fallback for the README on GitHub, which does not embed asciinema.

The blockers are real, not procedural: without TL-82 there is nothing to
record (the `done` command does not exist), without TL-49 there is no
README for the recording to hang in.

## Pre-flight reading

1. `backlog/tasks/TL-82-*.md` — the exact behavior of `done` on failure; the
   scenario is to show real messages, not invented ones.
2. `backlog/tasks/TL-49-*.md` — the shape of the new README; the demo has to
   land in its header.
3. Backlog.md's README (github.com/MrLesk/Backlog.md) — what their
   first-contact GIF looks like; ours has to be recognizably DIFFERENT, not
   just prettier than theirs.

## Steps

1. Write `docs/demo/scenario.md`: commands step by step, with expected
   output.
2. Walk through the scenario by hand on a fresh directory; time it.
3. Record with asciinema; generate a GIF.
4. Link it in the README header; keep the recording file out of the npm
   tarball (package size is part of the first impression).
5. Add a gate to `worktrail-release`: the scenario passes on the current
   CLI.

## Acceptance criteria

- [x] The scenario in `docs/demo/scenario.md` is reproducible command by
      command.
- [ ] The recording runs ≤60s and contains the refusal scene BEFORE the
      success scene.
- [ ] The recording is visible from the README header with no clicking.
- [x] The npm tarball does not carry the recording files.
- [x] The release gate checks that the scenario is current.

## Log

2026-09-01 pending — agent:claude — created from a competitiveness analysis: the mechanism without a demo is invisible; the refusal is more photogenic than the success.
- 2026-09-01 in_progress — agent:claude — taken up; TL-82 and TL-49 closed, blockers gone.
- 2026-09-01 in_progress — agent:claude — **NOT CLOSED: only the recording itself is missing.** I walked the scenario LIVE on a fresh directory (`git init` → `init` → `new` → a contract in the frontmatter → refusal → fix → green close); every "expected output" block in `docs/demo/scenario.md` is transcribed from the real run, not invented. Step 3 (asciinema/GIF) cannot be done here: this machine has no `asciinema`, `agg`, `vhs`, or `ttyrec`, and recording needs a TTY. It is left for a human, and the `manual:` entry describes exactly that.
- 2026-09-01 in_progress — agent:claude — README **DELIBERATELY UNTOUCHED**. The criterion "recording visible from the header" needs a file that does not exist; a placeholder link in the header would be a dead link on the very first screen — exactly the opposite of this task's goal. A condition recorded for later: the link must be an ABSOLUTE URL — `files` in `package.json` is an allowlist with no `docs/`, so the README in the tarball has nothing to show at a relative path.
- 2026-09-01 in_progress — agent:claude — the gate from step 5 was made AS A TEST, not as an item on a human checklist: `scripts/tests/demo-scenario.test.mjs` replays the scenario on every test run and asserts the three beats the recording rests on — a non-zero exit code for the refusal, the REAL test output in the message (not a summary), and the task file byte-for-byte untouched after the refusal. Scene 4 has a positive control: it first asserts that the first run FAILS, so the test cannot pass on a scenario that was never red. The `worktrail-release` skill got a §6b, which invokes this test and adds three more things to check by eye.
- 2026-09-01 in_progress — agent:claude — A SHARP EDGE FOUND, worth recording outside this task: a nested `node --test` INHERITS `NODE_TEST_CONTEXT` and reports its result to the outer runner, ending with exit code 0. The gate test was therefore GREEN despite failing verification — exactly the kind of false green this whole tool exists to prevent. Fixed by clearing `NODE_TEST_CONTEXT` and `NODE_OPTIONS` in the child process's environment, with a comment at the spot. This affects EVERY task whose `verification:` calls `node --test`, when `worktrail done` is invoked from inside a test; in a normal user shell the problem does not occur.
- 2026-09-01 in_progress — agent:claude — 419/419 green, `check --language` green (20845 lines, 72 public files). I refused `--confirm-manual`: there is no recording, so manual attestation would be exactly the "I checked" that this mechanism exists to rule out as NOT proof.
