---
id: TL-479
title: "A backlog checked out with CRLF works like one with LF"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 1h | 2h | 3h | 4h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-10-21
updated: 2026-10-30
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: crlf-backlog
    bash: "node --test scripts/tests/crlf-backlog.test.mjs"
---

## Goal

A backlog whose task, config and history files were checked out with CRLF line endings reads, closes and checks exactly like the same backlog with LF.

## Context

TL-463 made this repository check out LF everywhere with `* text=auto eol=lf` in its own .gitattributes, which removed 58 Windows failures that were line endings alone. That fixes THIS repository only. A user's repository on Windows with Git's default `core.autocrlf=true` checks its backlog out with CRLF, and `init` writes no eol rule into the .gitattributes block it manages (scripts/init-backlog.mjs, GITATTRIBUTES). Parsers written against `\n` then meet `\r\n`: the measured cases in TL-463 were frontmatter and template-banner patterns, fenced-block regexes and the template strip in scripts/new-task.mjs. Some readers already accept `\r?\n` (scripts/check-backlog-refs.mjs frontmatter()), most do not. Decide between (a) making every reader line-ending agnostic, and (b) having `init` and `doctor` declare `eol=lf` for the backlog directory in the managed .gitattributes block; (b) alone does not help a backlog already checked out, so say what happens to one.

## Steps

1. Reproduce: clone a repository with a backlog using `git clone -c core.autocrlf=true` and run query, new, done and check against it.
2. List every reader that fails, and choose (a), (b) or both, with the reason.
3. Add scripts/tests/crlf-backlog.test.mjs: a fixture backlog written with CRLF goes through query, new, done and check, with a positive control that the fixture really contains CRLF.

## Acceptance criteria

- [x] A CRLF backlog reads, closes and checks like an LF one. [proof: crlf-backlog]
