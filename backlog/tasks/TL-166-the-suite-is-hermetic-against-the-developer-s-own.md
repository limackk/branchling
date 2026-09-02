---
# ╭─────────────────────────────────────────────────────────────────────────╮
# │  THIS BACKLOG'S TASK TEMPLATE. `worktrail new --title "…"` copies it,    │
# │  assigns the number and fills in the dates — you do not copy it by      │
# │  hand. The vocabularies below (statuses, priorities, types) come from   │
# │  `config.yaml`; a value outside them FAILS the build rather than        │
# │  becoming a new one.                                                    │
# ╰─────────────────────────────────────────────────────────────────────────╯
id: TL-166
title: "The suite is hermetic against the developer's own preferences"
type: code
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P2                       # P0 blocker | P1 critical | P2 nice | P3 backlog
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-02
updated: 2026-09-02
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: every-file-isolates
    bash: "node --test scripts/tests/test-hygiene.test.mjs"
  - id: suite-under-a-hostile-home
    bash: "d=$(mktemp -d) && mkdir -p \"$d/config\" && printf 'actor: local:hostile\\neditor: /bin/false\\ntheme: dark\\nport: 9999\\ndate_format: local\\nllm_endpoint: http://127.0.0.1:1\\nllm_model: nonexistent\\nllm_retries: 0\\nllm_timeout_seconds: 1\\n' > \"$d/config/config.yaml\" && WORKTRAIL_HOME=\"$d\" node --test scripts/tests/*.test.mjs > /dev/null"
  - id: suite
    bash: "node --test scripts/tests/*.test.mjs > /dev/null"
---

## Goal

The test suite gives the same answer on every machine, whatever is in the
developer's own `<config>/config.yaml`. A guard fails when a new test file
spawns the CLI or records history without isolating the home directory.

## Context

TL-157 wired the user preferences layer into the actor chain: with no `--actor`
and no `BACKLOG_ACTOR`, a command now records the `actor:` from the person's own
config file. That is the feature, and it made the suite depend on the machine it
runs on — every assertion about the default actor `agent:claude` now fails on a
developer who has set `actor: local:me` for themselves.

Eight test files were given `isolateHome()` in TL-157's own commit, because they
assert a default actor and would have broken immediately:
`change-reason`, `config`, `handoff`, `history-duplicate-created`, `pr-summary`,
`history`, `next`, `task-graph`. That was the bounded repair, not the fix.

**What is left is the general case, and it is the dangerous half.** Of 85 test
files only about fifteen isolate the home. The rest are green on a machine with
no preferences file — which is every machine anybody has run this suite on so
far, so the suite has never once been exercised against a hostile home. A test
that passes because the hazard is absent is green with no evidentiary force,
and the next test file somebody writes will inherit that silence.

**Two candidate designs, and the choice is the work.**

1. *A guard test.* Read every `scripts/tests/*.test.mjs`, and fail one that
   spawns `cli.mjs` or writes history without calling `isolateHome()`. Cheap,
   but it is a lint over source text and will need an allow-marker for the
   files that deliberately test a real home (`home.test.mjs`, `registry`).
2. *Isolation by default.* Make `_repo.mjs` isolate the home as an import side
   effect, and have the files that genuinely want a real home opt out. Covers
   every file that imports `_repo.mjs` — 39 of 85 — and does nothing for the
   rest, so it is not a complete answer on its own.

Neither is obviously right; both may be needed. Decide in the file.

**The proof that matters is not the guard.** It is `suite-under-a-hostile-home`:
the whole suite run with `WORKTRAIL_HOME` pointing at a config that sets an
actor. If that is green, the property holds regardless of how it was achieved —
which is why it is a verification entry and not a note.

## Pre-flight reading

1. `scripts/tests/_repo.mjs` — `isolateHome()` and the reasoning already
   written there about a test writing into a real activity log.
2. `scripts/actor.mjs` — the chain, and why the user layer is a source.
3. `scripts/tests/home.test.mjs` — the TL-157 cases, and the two files that
   legitimately read a home directory.

## Steps

1. Run the suite under a home that sets `actor:` and count what breaks. That
   number is the size of the problem and nobody has it yet.
2. Choose between the two designs above, or combine them, and record why.
3. Write the guard with a positive control — it must fail when a file is added
   that does not isolate.

## Acceptance criteria

- [x] The whole suite is green with `WORKTRAIL_HOME` pointing at a config file that sets EVERY user preference, not only `actor:`. [proof: suite-under-a-hostile-home]
- [x] A new test file that spawns the CLI without isolating the home FAILS the guard, and the guard has a positive control proving it can fail. [proof: every-file-isolates]
- [x] The suite stays green on a machine with no preferences at all. [proof: suite]
- [ ] The choice between a guard and isolation-by-default is written in this file, with the reason.

## Notes

- Surfaced while closing TL-157. Deliberately left out of it: wiring a layer in
  and making 85 test files hermetic are two theses, and a blurred task has no
  verification.
- `home.test.mjs` and `registry.test.mjs` read a home on purpose. They are the
  reason a blanket rule needs an opt-out rather than an exception list.

## Decisions

**A guard, with the rule made UNIFORM — every test file isolates.** Neither of
the two candidates was taken as written. The narrow rule ("only the files that
spawn the CLI or touch the activity log") needs the guard to detect "spawns the
CLI" by reading source text, and it misses a file that merely imports a module
which reads the home in-process; a rule with a hole is worse than a broad rule,
because the hole is where the next file lands. Isolation as an import side
effect of `_repo.mjs` was rejected outright: 39 of 88 files import it, so it is
not a complete answer, and a module that changes global state on import
surprises exactly when it is least affordable. 74 files gained one call; `node
--test` runs each file in its own process, so one call per file covers every
case in it and no case can be forgotten individually.

**No exceptions were needed.** `home.test.mjs` and `registry.test.mjs` were
expected to want a real home; they do not — every case in both injects `env`
explicitly, so isolating the process is harmless and strictly safer. The
allow-marker exists anyway, because a rule with no way out gets weakened rather
than exempted, and it is spelled the way the language and product-name guards
spell theirs.

**The contract was STRENGTHENED, not satisfied.** As written, the hostile home
set only `actor:` — and the suite was already green under it before a line was
changed, because most tests pass `--actor` explicitly. A proof that passes
before the work is a proof with no evidentiary force. The entry now sets every
key in `USER_DEFAULTS`, and under that home one test really did fail:
`seed-adapter.test.mjs` asserts the message you get when NO model is configured,
and its own comment said "no `llm_endpoint` is configured in this test
environment" — an assumption about the developer's machine written down as if it
were a fact about the suite. On anyone running a local model it would have
failed, and nothing would have said why. That is the measurement step 1 asked
for: one file, found by making the hazard real.

**The guard checks for the CALL, not the import.** Importing the helper and
never calling it is the shape a careless edit leaves behind, and it satisfies
any rule written about imports. The positive control includes that case.
