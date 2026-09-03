---
id: TL-66
title: "next-id warning lies about git on an empty backlog"
type: bug
labels: [pre-launch]
board: main
epic: "CLI surface"
priority: P2
status: done
owner: claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: [TL-64]
related_docs:
  - .claude/skills/branchling-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/next-id-empty-backlog.test.mjs"
  - bash: "d=$(mktemp -d)/p; mkdir -p \"$d\"; cd \"$d\"; git init -q .; echo x > a; git add -A; git -c user.email=t@t -c user.name=t commit -qm i >/dev/null; T=/Users/limack/workspace/tasklog/bin/branchling.mjs; node $T init --dir ./backlog >/dev/null; node $T new --dir ./backlog --title Test 2>&1 | grep -q 'not in a git repository' && { echo 'still lying'; exit 1; }; echo 'first task without a false warning — OK'"
---

## Goal

The warning about a narrower number source should fire when the source
REALLY IS narrower — not every time a scan across branches finds nothing.

## Context

Measured 2026-08-31 in a normal git repository, with a commit, right after
`worktrail init`:

```
$ worktrail new --dir ./backlog --title "Proba"
<!-- language-guard: allow — verbatim historical CLI transcript, not prose -->
next-backlog-id: numer z LOKALNEGO katalogu — poza repozytorium git
<!-- language-guard: allow — verbatim historical CLI transcript, not prose -->
  nie widzę innych gałęzi ani worktree, więc ten numer może być gdzieś zajęty.
[worktrail new] …/backlog/tasks/TASK-1-proba.md
```

The sentence "outside the git repository" is untrue: we are inside a
repository, the scan across branches and worktrees **ran to completion** and
simply found nothing, because the backlog had been created a second earlier.

The cause is in the condition: `if (sources.size === 0)`. The set of sources
is empty in two different situations that this condition does not
distinguish:

| Situation | Is the answer narrower |
|---|---|
| directory outside a git repository | **yes** — we did not see other branches |
| repository exists, backlog is empty | **no** — we saw all of them and there is nothing |

The intent of the warning is sound and is written into the code: a narrower
source MUST speak up, because a number from a single directory looks just as
credible as a number from a scan of all branches. Only the premise is wrong.

**Why this is P2, not cosmetic.** This sentence appears on the FIRST task of
every new user — the one moment when there are no grounds yet to judge which
of the tool's messages are trustworthy. A warning that lies the first time
teaches people to ignore every subsequent one; and this particular warning is
meant to one day save someone from two tasks with the same number.

## Pre-flight reading

1. `scripts/next-backlog-id.mjs` — the `sources.size === 0` condition and the
   comment above it.
2. `scripts/git-rules.mjs` — `insideGitRepo()`; the question is already asked
   elsewhere.
3. `scripts/new-task.mjs` — `nextId()` forwards this warning on to stderr.

## Steps

1. Separate the premises: warn when the backlog directory is NOT inside a
   git repository, not when the scan came back empty.
2. Use `insideGitRepo()` from `git-rules.mjs` instead of inferring from the
   number of sources.
3. Keep the warning where it is true — its intent is not the bug.
4. Test: an empty backlog INSIDE a repository does not warn; a backlog
   outside a repository does warn. Both sides, because a fix that just
   removed the warning entirely would be "green" on a one-sided test.

## Acceptance criteria

- [ ] Empty backlog inside a git repository: no warning.
- [ ] Backlog outside a git repository: warning still present.
- [ ] The warning's text does not say anything untrue about git.
- [ ] The test covers both sides.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — found while working on TL-64; blocks a
  clean first-run path
- 2026-08-31 in_progress — agent:claude — implementation started
- 2026-08-31 done — agent:claude — the premise is now `insideGitRepo(OWN_ROOT)`
  from `git-rules.mjs`, not the number of sources found. Text corrected:
  "backlog is not inside a git repository" instead of "outside the git
  repository" — because the first is checkable, and the second was a
  statement about the calling context. Test `next-id-empty-backlog.test.mjs`
  checks BOTH sides: an empty backlog inside a repo stays silent, a backlog
  outside a repo still warns. A test for silence alone would also pass for a
  fix that removed the warning entirely. 313/313.
