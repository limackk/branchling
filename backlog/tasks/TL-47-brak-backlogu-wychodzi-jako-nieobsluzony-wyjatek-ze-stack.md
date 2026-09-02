---
id: TL-47
title: "A missing backlog exits as an unhandled exception with a stack trace"
type: bug
labels: []
board: main
epic: "Backlog — open source publication"
priority: P3
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "cd /tmp && node <path>/bin/worktrail.mjs query --count 2>&1 | head -3   # expected: message only, no `at ...`"
---

## Goal

A foreseen, documented state ("no backlog here") should exit as a message and
an exit code, not as an exception dump.

## Context

Measured 2026-08-31 from an empty directory:

```
Error: Could not find the backlog directory. Point to it: --dir <path> or
BACKLOG_DIR=<path>, or run from a repository directory that has backlog/tasks/.
    at resolveBacklogDir (file:///…/scripts/paths.mjs:119:9)
    at file:///…/scripts/query.mjs:81:34
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    …
Node.js v24.18.0
```

**The content is good, the packaging is not.** The exit code is 1 and nothing
is written — this behavior is correct. The problem is what it communicates: a
stack trace says "the tool crashed", not "not here, try `--dir`". For a user
who just installed `worktrail` and ran it from their home directory, this is
**the first contact with the tool**.

The same state is described in the documentation as by design, not as a
failure — so the presentation contradicts the design.

**The second half of the problem, measured 2026-08-31 during an onboarding
audit:** the message's content is itself incomplete. It lists three ways to
POINT to an existing backlog (`--dir`, `BACKLOG_DIR`, running from a
repository) and not one for CREATING a new one. A person who just installed
the tool and ran it for the first time is exactly in that second case — and
`worktrail init --dir <path>` never appears in the message. Which hint to give
first can be decided from context: a directory that looks like a repository
root with no backlog → probably `init`; a home directory → probably `--dir`.

## Steps

1. Find ALL entry points where `resolveBacklogDir` can throw outside a `try` —
   not just `query`. A fix in one command would leave the rest untouched.
2. Decide where to catch it: in `cli.mjs` (a single place, but bypassed by a
   direct `node scripts/*.mjs`) or a typed error recognized at each entry
   point. Record the reason for the choice.
3. Keep the exit code and the ABSENCE of any write — this is correct today and
   is to stay that way.
4. Check along the way whether other foreseen states (an unknown flag, an
   unknown command, a missing board registry) also do not exit as exceptions.

## Acceptance criteria

- [ ] A call from a directory with no backlog: a message, a nonzero exit code,
      **zero `at ` lines**.
- [ ] The same for every reading command, not just `query` — the test iterates
      over the `COMMANDS` dictionary, so a new command cannot silently fall
      out of coverage.
- [ ] A genuine programmer error (e.g. `TypeError`) **still** shows a stack —
      silencing everything would be a cure worse than the disease. A negative
      test.
- [ ] The message gives `worktrail init --dir <path>` as a way to create a
      backlog, alongside today's three ways to point to an existing one.

## Log

- 2026-08-31 created — claude — found while running (not reading) the `verification` block of TL-33; that block at the time pointed to a path that no longer exists, and fixing it is what exposed this defect
- 2026-08-31 updated — agent:claude — added the second half: the message does not mention `worktrail init`; task scope expanded instead of creating a duplicate
