---
id: TL-174
title: "Tests that commit fail on a machine with commit signing on"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P2
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: high
created: 2026-09-02
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: signing-hostile
    bash: "node --test scripts/tests/git-env-isolation.test.mjs"
  - id: suite-under-signing
    bash: "git -c commit.gpgsign=true -c gpg.format=ssh -c user.signingkey=/dev/null config --get commit.gpgsign >/dev/null && node --test scripts/tests/*.test.mjs"
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

1. Put ONE git helper in `_repo.mjs`, with the isolating flags on it: identity,
   `commit.gpgsign=false`, and a default branch name so the fixture does not
   depend on the machine's `init.defaultBranch`.
2. Move every test file that shells out to git onto it.
3. Add a guard, with a positive control, that fails when a test file invokes
   `git` without going through the helper — the eight-of-twenty split above is
   what an unenforced convention looks like.
4. Make the fixture builders assert with a message that names the git failure,
   so the next environmental difference is readable rather than `128 !== 0`.

## Acceptance criteria

- [ ] A test file that shells out to git without the shared helper FAILS the
      guard, and the guard's positive control proves it can fire. [proof: signing-hostile]
- [ ] The whole suite passes with `commit.gpgsign=true` in force. [proof: suite-under-signing]
- [ ] No test turns the user's own signing configuration off outside its own
      fixture directory. [proof: signing-hostile]

## Decisions

- Not solved by telling contributors to unset `commit.gpgsign`: a suite whose
  result depends on the reader's git configuration is the defect, and a line in
  CONTRIBUTING.md is a guard nothing runs.
- `init.defaultBranch` is folded in because it is the same class of dependency
  and would otherwise be the next one found, in the same way.
