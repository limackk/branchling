---
id: TL-283
title: "An agent killed by its own quota leaves work uncommitted and blames the contract"
type: bug
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
priority: P1
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 2h                       # 30m | 2h | 1d | 1w
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  # REWRITTEN BEFORE THE WORK STARTED. The first entry named a file that did not
  # exist; `node --test` ignores a missing path silently, so the block was green
  # against an unchanged tree and proved nothing. The file now exists and its
  # first test fails on the old loop, where `row.repeatedOutput` is undefined
  # and the park names nothing but the entry. `run-help-hand-did-not-run` is the
  # second half of the thesis — the
  # uncommitted work is named where a reader meets it — and would pass on the
  # old tree only if the paragraph were already there, which it was not.
  - id: quota-is-not-an-attempt
    bash: "node --test scripts/tests/agent-refusal-not-an-attempt.test.mjs"
  - id: run-help-hand-did-not-run
    bash: "node scripts/cli.mjs run --help | grep -q 'STAYS IN YOUR TREE, uncommitted' && node scripts/cli.mjs run --help | grep -q 'REPEATS ITSELF IS REPORTED'"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

When an agent is cut off by its own vendor mid-task, the run says so. Today
it reports that the contract failed, parks the task on that reason, and
leaves the agent's uncommitted work in the tree for the next `git add -A`
to sweep into an unrelated commit.

## Context

Measured on 2026-09-05, TL-150, and CORRECTED the same day — the first
version of this task said "no commit, no file touched", and that was
wrong. What the log shows is the agent's stdout, which for `claude -p` is
its final message only:

    === attempt 1: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1
    === attempt 2: …/hand-spec.sh
    You've hit your session limit · resets 12:10pm (Europe/Warsaw)
    === done: exit 1

What it does NOT show is that the hand had already written
`scripts/tests/actor-record.test.mjs` — 
TL-150's whole spec deliverable, a failing test for a command that does not
exist yet. It was cut off before it could commit and hand on. So the tree
DID change, TL-184's guard correctly did not fire, and the two attempts
were real work rather than nothing.

**Three consequences, all measured.**

The park blames the wrong thing. TL-150 was left with `no verification
after 2 agent attempts: suite-green`, which a later reader takes as a
finding about the work. The truth — the hand ran out of quota with the
deliverable written and uncommitted — is one line at the end of the log
and nowhere else.

The second attempt was pure cost. The contract, an 80-second suite, ran
twice to learn what the first run had already established, against a hand
that could not start.

The uncommitted work is a trap for the next commit. It was swept into an
unrelated commit here by `git add -A` and reached `main` as a red test with
no implementation, which is exactly the hazard TL-276 records two hands
warning about.

**Measured again the same afternoon, from the other side.** TL-150's
closing run: the spec hand added the last registry row and handed on; the
dev leg's entire output was `You've hit your session limit · resets
5:10pm`; the loop then ran `done`, the contract passed — the work was
already complete — and the task closed, credited in the history to the
`dev` role with 204 seconds against it. The closing is sound, because
`done` proved it. The attribution is not: a hand that printed one line
and touched nothing is on the record as the one that finished the task.
Same cause, opposite outcome, and only the second is visible in a report.

**What the tool must not do.** Parse the vendor's wording. "Session limit"
is a literal about somebody else's product and the next vendor phrases it
differently.

**What it can see without guessing.** That the agent exited far faster than
its previous attempt on the same task; that the tree changed but nothing
was committed, while the charter it was given ends in a commit; that two
attempts produced byte-identical output, which no working agent does.

## Steps

1. Decide, with `branchling ask`, what the loop may conclude. The
   candidates: two attempts with identical output are one attempt and the
   run stops; an exit code convention the caller's wrapper uses to say "I
   could not start"; nothing at all, and the report simply quotes the
   agent's last line beside the parked reason so a reader is not misled.
   The third changes no behaviour and removes the false diagnosis.
2. Whatever is decided, a task parked after an agent could not run must not
   carry a reason naming its contract.
3. Say in `run --help` that an agent's uncommitted work is left in the tree
   and belongs to whoever reads the report, since that is where TL-276's
   hazard actually bites.

## Acceptance criteria

- [x] A task whose every attempt printed byte-identical output is parked with
      a reason that quotes the HAND beside the entry, and says so in `--json`,
      proven by a test that fails against today's loop.
      [proof: quota-is-not-an-attempt]
- [x] A hand whose output DIFFERS between attempts carries no such
      observation, and an EMPTY transcript is still TL-184's ending.
      [proof: quota-is-not-an-attempt]
- [x] `run --help` says what a repeating hand means and what it cannot mean,
      and that whatever the hand wrote is left uncommitted in the tree.
      [proof: run-help-hand-did-not-run]
- [x] No ending, attempt budget or parked entry anywhere else in the loop
      changed. [proof: suite-green]

## Decided

Recorded with `branchling decide` on 2026-09-21; a first decision the same day
was SUPERSEDED, and both are in the log.

**The first decision was wrong, and this repository is what proved it.** It
said: two consecutive attempts with byte-identical, non-empty output end the
task as `agent-repeated-itself`, park it with a reason naming only the hand,
and stop the run. Three of the tool's own positive controls fail against that
rule, and they fail because they are right:
`scripts/tests/contract-scope.test.mjs:151` and
`scripts/tests/run-agent-launch.test.mjs:198` each pin a hand that prints the
same non-empty line on every attempt, fails its contract, and MUST spend every
attempt and be parked naming the entry it failed;
`scripts/tests/run-awaiting-vouch.test.mjs:281` pins the tally. A vendor
cutting an agent off and a hand that gives up the same way every time are the
same bytes, and this task's own warning — do not let a false positive turn a
real contract failure into "quota" — is exactly what that rule would have done.

**What was decided instead**, which is the third candidate this task listed and
the one its author marked as changing no behaviour. The repetition is an
OBSERVATION, reported beside the unchanged ending:

- the park's reason still names the entry that failed — a red contract is a
  fact whatever the hand was doing — and now adds that every attempt printed
  byte-identical output and quotes the hand's last line, so
  `no verification after N agent attempts` is no longer read as a finding about
  work nobody measured;
- `--json` carries `repeatedOutput` and `said` on the task row, for the
  unattended caller that never sees the terminal;
- the terminal report adds a paragraph per such task, saying what was seen and
  that whatever the hand wrote STAYS IN YOUR TREE, uncommitted;
- `run --help` says the same, including what the evidence cannot mean.

**What this does NOT do, and why.** It does not cut the attempt budget short,
so the second attempt's contract cost — one of the three consequences measured
here — is NOT recovered. That saving requires acting on the evidence, and the
evidence cannot be told apart from a genuine repeated failure. Paying for a
contract twice is cheap beside renaming a real failure as a quota.

**What the observation cannot distinguish, on the record.** A vendor quota, a
wrapper failing fast, a crash before the prompt is reached and a deterministic
refusal all look identical from here. A hand cut off on its ONLY attempt is not
seen at all, and neither is one whose message carries a clock or a request id
that differs between attempts. That is why nothing is named for a cause.

**The empty transcript stays TL-184's.** Two attempts that print nothing are
identical too; requiring non-empty output keeps a silent hand on the path that
gives the claim back rather than parking the task.

**The uncommitted work is pointed at, not duplicated.** The report names
`resume <ID>`, which TL-272 gave an `uncommitted` section the same day. A
second, poorer listing inside `run` would be a second place to be wrong.
