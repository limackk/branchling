---
id: TL-175
title: "query --json truncates when its output is piped"
type: bug
labels: []
board: main
epic: "CLI surface"
priority: P1
status: pending
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: high
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: large-json-survives-a-pipe
    bash: "node --test scripts/tests/json-pipe.test.mjs"
---

## Goal

A `--json` answer larger than the pipe buffer arrives whole. Today it is cut off
mid-string at about 64 KB, and the consumer sees a JSON parse error rather than
an answer.

## Context

Found on 2026-09-03 while measuring `query --all-projects`. Measured:

```
$ worktrail query --all-projects --status in_progress --json | python3 -c "import json,sys; json.load(sys.stdin)"
json.decoder.JSONDecodeError: Unterminated string starting at: line 2048 column 18 (char 65520)
$ worktrail query --all-projects --status in_progress --json > out.json   # 108993 bytes, valid
```

The cause is the shape every command here shares: `console.log(...)` followed by
`process.exit(0)`. On a PIPE, stdout is asynchronous in Node, and `process.exit`
does not wait for the buffer to drain — so anything past roughly one pipe buffer
is lost. Redirecting to a file hides it, because a file descriptor is
synchronous.

**This is worse than an ordinary bug because of what it breaks.** `--json` on
every reading command is law 4 — the extension surface the whole tool leans on —
and the failure appears only above a size threshold, in the pipeline a script
would actually use, and never in the terminal where a person tries it. Every
`--json` command in `cli.mjs` shares the pattern, so this is one fix in one
place, not a fix per command.

## Pre-flight reading

1. `scripts/json-envelope.mjs` — `printJson()`, the single place every envelope
   is written; the fix belongs here rather than in each command.
2. `scripts/query.mjs` — `process.exit(0)` immediately after the print, the
   shape to correct.
3. `scripts/cli.mjs` — how a command's exit code reaches the process, since the
   fix has to keep exit codes intact.

## Steps

1. Reproduce with a test that pipes a large `--json` answer through a child
   process and parses it — a fixture with enough tasks to exceed a pipe buffer.
   Assert on the PARSE, not on the byte count.
2. Stop exiting before the write has drained: set `process.exitCode` and let the
   process end on its own, or await the callback of the write.
3. Sweep every `printJson` caller for the same pattern.
4. Keep the exit codes exactly as they are — a refusal that starts exiting 0
   would be a much worse bug than the one being fixed.

## Acceptance criteria

- [ ] A `--json` answer well above one pipe buffer parses after going through a
      pipe. [proof: large-json-survives-a-pipe]
- [ ] The positive control fails against the old pattern, so the test cannot
      pass against a fix that does nothing. [proof: large-json-survives-a-pipe]
- [ ] Every non-zero exit code the JSON commands give today is unchanged. [proof: large-json-survives-a-pipe]

## Decisions

- Not fixed by making stdout synchronous globally: that changes the behaviour of
  every command, including the interactive ones, to solve a problem that belongs
  to one function.
