---
id: TL-224
title: "regen-hook blocks forever on a stdin nobody closes"
type: bug
labels: []
board: main
epic: ""
priority: P1
status: done
owner: unassigned
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-03
updated: 2026-09-03
blocked_by: []
blocks: []
related_docs: []
verification:
  - id: cli-suite
    bash: "node --test scripts/tests/cli.test.mjs"
  - id: full-suite
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`regen-hook` returns whether or not anybody closes its stdin.

## Context

`readStdin()` used `readFileSync(0, "utf8")`, which reads to EOF. The one caller
the command was written against — an editor's post-edit hook — writes its JSON
and closes, so the read always ended. Nothing else does.

Measured before the fix, in a consumer's repository:

- `( sleep 4 ) | branchling regen-hook` took the whole four seconds.
- Run from a terminal, or from any parent that leaves stdin inherited, it never
  returned at all: no output, no prompt, nothing to distinguish it from slow
  work. A person who typed the command to see what it does had to kill it.

The command is wired as `… regen-hook 2>/dev/null || exit 0`, so the failure had
no voice even in principle. That wiring is right — a hook must not fail the edit
that triggered it — which is exactly why the command itself has to terminate.

**Why a deadline rather than "do not read stdin unless it is a pipe".** A pipe is
not evidence that anybody will write to it, and a TTY is not the only way to be
left waiting: the parent that first hit this held an inherited pipe open and
never wrote. The two cases are answered separately — a terminal is a person and
gets a sentence, everything else gets a bounded wait — because they are different
questions, not two spellings of one.

**Why whatever arrived is kept when the clock runs out.** A caller that writes
its payload and then holds the pipe open has already said everything the hook
needs. Throwing that away at the deadline would be the same mistake pointing the
other way, so the timeout resolves with the bytes in hand rather than with
nothing.

**What this does NOT fix.** It was found while chasing a consumer's missing
history entries, and it is not their cause: with a properly piped payload the
hook already ran to completion, and `history-record` still wrote nothing. That is
a separate defect and needs its own task — see the note in Steps.

## Pre-flight reading

1. `scripts/regen-hook.mjs` — `readStdin`, and the comment block that now states
   why the wait is bounded
2. `scripts/tests/cli.test.mjs` — the `regen-hook` group; the new cases hold the
   child's stdin open from the test process, because `spawnSync` without `input`
   closes it immediately and passes against the broken code

## Steps

1. Bound the wait: a TTY resolves immediately with no payload, anything else
   gets `STDIN_WAIT_MS` and keeps whatever arrived.
2. Say something on the terminal route. The hook is silent on a miss by design,
   but that rule is about files it does not care about; a person who invoked it
   by hand is owed a sentence rather than a freeze.
3. Cover both directions, with the child's stdin genuinely held open, and give
   every such test a kill-backstop — against the old read an unguarded `await`
   on the child's exit hangs the whole suite instead of failing one case.
4. Follow-up, not this task: `history-record` reports "no changes to record" for
   a task whose status really did change, and the snapshot advances anyway. The
   `adopted` reporting added in TL-185 names the same class from the other side.

## Acceptance criteria

- [x] The command returns on a stdin nobody closes, and the test says so by
      name rather than by hanging. [proof: cli-suite]
- [x] A payload that arrives without its writer closing is still acted on —
      the bound must not become "stop reading stdin". [proof: cli-suite]
- [x] The editor route is unchanged. [proof: full-suite]
