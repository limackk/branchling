---
id: TL-174
title: "Tests that commit fail on a machine with commit signing on"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P2
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 2h
confidence: high
created: 2026-09-02
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: signing-hostile
    bash: "node --test scripts/tests/git-env-isolation.test.mjs"
  - id: whole-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

The suite passes on a machine whose global git configuration signs every commit.
Today about a dozen tests fail there, and the failure names none of the reasons
that are true.

## Context

Measured on 2026-09-02 on this machine. The developer's global configuration
carries `commit.gpgsign=true` with `gpg.format=ssh`; when the ssh agent declines
to sign — a locked key, a confirmation that times out, a non-interactive run —
every `git commit` in a test fixture exits 128 and twelve tests in
`activity.test.mjs` alone go red at the line that creates the fixture:

```
Couldn't sign message (signer): agent refused operation?
fatal: cannot write commit object
```

Two separate defects, and the second is the worse one:

- **The fixtures inherit the developer's git configuration.** `_repo.mjs`
  isolates the HOME the TOOL reads (TL-166) so the suite answers the same on
  every machine. Git's configuration was never isolated, so the same class of
  bug the home isolation closed is still open one layer down: the suite's
  verdict depends on who runs it.
- **The failure is unreadable.** The assertion that fires is
  `assert.equal(git(...).status, 0)` inside a fixture builder, so the message is
  `128 !== 0` at a line that has nothing to do with what is being tested. Eight
  test files already pass `-c commit.gpgsign=false` and the rest do not, which
  is exactly the shape of a convention nothing enforces.

The signing itself is not the problem and must not be turned off for the user: a
fixture repository has no reason to be signed, that is all.

## Pre-flight reading

1. `scripts/tests/history-merge.test.mjs` — the `vcs()` helper that already gets
   this right: `-c user.email -c user.name -c commit.gpgsign=false`.
2. `scripts/tests/activity.test.mjs` — the `git()` helper that does not, and the
   `repo()` builder whose assertion is the one that fires.
3. `scripts/tests/test-hygiene.test.mjs` — the existing guard over test files
   and its positive control; this new rule belongs beside it, written the same
   way.
4. `scripts/tests/_repo.mjs` — where `isolateHome()` lives, and the natural home
   for a shared git helper.

## Steps

1. Isolate git BY ENVIRONMENT inside `isolateHome()`: `GIT_CONFIG_GLOBAL` and
   `GIT_CONFIG_SYSTEM` pointed at an empty file in the throwaway home, identity
   from `GIT_AUTHOR_*`/`GIT_COMMITTER_*`, and `commit.gpgsign=false` plus
   `init.defaultBranch=main` stated outright through `GIT_CONFIG_COUNT`.
2. Add a guard, with a positive control, that fails when a test file spawns
   `git` without setting that up — the eight-of-twenty split above is what an
   unenforced convention looks like.
3. Prove the isolation with a HOSTILE configuration, not with the machine's own:
   a global config demanding a signature from a key that cannot work, and a
   control child run without the isolation which must fail.
4. Make the fixture builders assert with a message that names the git failure,
   so the next environmental difference is readable rather than `128 !== 0`.

## Acceptance criteria

- [x] A test file that spawns git without isolating the environment FAILS the
      guard, and the guard's positive control proves it can fire. [proof: signing-hostile]
- [x] A fixture commits cleanly with a hostile global configuration in place,
      and the same commit WITHOUT the isolation fails. [proof: signing-hostile]
- [x] The whole suite passes on this machine, whose global configuration signs
      every commit. [proof: whole-suite]
- [x] No test writes outside its own throwaway home; the user's signing
      configuration is untouched. [proof: signing-hostile]
- [x] A git failure inside a fixture builder reports what git said, not
      `128 !== 0`. [proof: signing-hostile, whole-suite]

## Decisions

- **By environment, not by a shared `git()` helper**, which is what this task
  was written asking for. A helper would have had to be adopted by twenty files
  and enforced by a guard forever, and even fully adopted it would have covered
  the flags somebody remembered to put on it — signing, here. Emptying
  `GIT_CONFIG_GLOBAL` and `GIT_CONFIG_SYSTEM` neutralises the whole file:
  aliases, `core.hooksPath`, `commit.template`, and whatever the next machine
  carries. It also reaches the git processes the TOOL spawns, which no flag
  written in a test file could.
- **It lives inside `isolateHome()`** rather than beside it. Every test file
  already calls that — `test-hygiene.test.mjs` makes sure of it — so the fix
  reached twenty files without editing twenty files, and a new test file gets
  it by following a rule that already exists.
- The hostile configuration in the control is CONSTRUCTED, not the machine's: it
  demands a signature from a key that cannot work, so the control fails on every
  machine rather than only on one whose ssh agent happens to refuse.
- Not solved by telling contributors to unset `commit.gpgsign`: a suite whose
  result depends on the reader's git configuration is the defect, and a line in
  CONTRIBUTING.md is a guard nothing runs.
- `init.defaultBranch` is folded in because it is the same class of dependency
  and would otherwise be the next one found, in the same way.
