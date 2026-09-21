---
id: TL-82
title: "worktrail done — closing a task runs its verification and refuses on failure"
type: task
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P0
status: done
owner: agent:claude
estimate: 1d
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-86]
blocks: []
related_docs:
  - CLAUDE.md
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - id: gate-tests
    bash: "node --test scripts/tests/verification-gate.test.mjs"
  - id: readme-limit
    bash: 'grep -q "raises the \*cost\*" README.md && grep -q "there is no .--force. flag" README.md'
  - id: skill-refers
    bash: "grep -q 'worktrail done <ID>' .claude/skills/backlog-workflow/SKILL.md"
  - id: red-run-observed
    manual: "On a fixture with a `verification` entry that fails: `worktrail done <ID>` exits with code !=0, prints the command's output, and the task file STILL has `status: pending`"
---

## Goal

`worktrail done <ID>` runs every entry from this task's `verification:` block, shows
the output, and SETS `status: done` only when all of them pass. After this
task, "done" stops being a declaration by the executor and becomes the exit code
of a process.

## Context

`verification:` is the only feature that distinguishes this tool from Backlog.md
and from every other markdown-based tracker. There, the closing contract is
checkboxes (acceptance criteria + Definition of Done), ticked off by the same
party who did the work. When the work is done by an agent, that agent is at
the same time the sole witness and has a structural interest in declaring the
work finished: its context is running out, and "almost works" looks from its
side identical to "works". Backlog.md's answer is three HUMAN checkpoints,
i.e. scaling by human attention — by the very resource their own README calls
a bottleneck.

**Problem: for us this advantage does not exist today as a mechanism.** Verified
in the code: `verification` is validated as a field (`scripts/task-fields.mjs:146`),
filled in when a task is created (`scripts/new-task.mjs:172`), and explained in
onboarding (`scripts/init-backlog.mjs:157`) — but NO script runs it. Execution
today is carried by the `backlog-workflow` skill, i.e. an instruction for the
very agent it was supposed to police. This is a convention of discipline
masquerading as a guarantee, and that is why it is P0: until it exists, every
other task adds features to a tool whose one distinguishing feature does not
work.

Six things settled before starting — each one a place where a naive
implementation turns the gate into a decoy:

1. **An empty `verification:` does NOT close the task.** A guard that passes on
   a zero sample is green with no evidentiary force (CLAUDE.md). No entries, an
   empty list, and the template literal (`"command to run"`) are all to FAIL,
   with a message saying the task has no closing contract.
2. **`manual:` is the only loophole and it must hurt.** If `manual:` passes
   silently, everyone will start writing `manual: "checked"` and the gate dies
   within a week. It requires explicit confirmation, and the confirmation lands
   in the history with a namespaced actor — so it is known WHO vouched for it.
3. **`verification` never runs on its own.** Not in `build`, not in `check`, not
   in `serve`, not in `regen-hook`. Only on an explicit `worktrail done`. A task
   arriving in someone else's pull request carries a shell command; it should
   run only when a human consciously closes that task, and only after its
   contents are printed before running.
4. **This raises the *cost* of a lie, it does not make it impossible.** A task
   file can always be edited by hand. The gate is meant to stop optimism, not
   bad faith — and it is to be described that way in the README. Promising more
   would be the same kind of untruth this task was created against.
5. **The working directory for commands is the repository root**, not the
   backlog directory. In a co-located layout that is not the same path — take
   it from `resolveBacklogDir()`/git, never from your own counting upward.
6. **`manual:` must say what COUNTS as proof, not merely require confirmation.**
   The enumeration from Backlog.md is better here than our silence and goes
   directly into the confirmation message: the presence of code, a grep result,
   and the intent of the implementation itself are NOT proof. For interactive
   work, proof is a pass through the browser, a script against the DOM, a test
   runner, or a described result of manual interaction — not "I checked". A
   generic "verify it properly" does not work; a concrete enumeration of what
   does not count does.
7. **`--force` either exists or it does not, but never quietly.** If it does: a
   loud warning plus a history entry with actor and reason. A silent escape
   hatch flag is worse than not having one, because it gives the appearance of
   a guarantee.

## Pre-flight reading

1. `scripts/task-fields.mjs:146` — how `verification` is validated today and
   its shape (`bash:` / `manual:`).
2. `scripts/new-task.mjs:172-178` — the template literal that must fail.
3. `scripts/init-backlog.mjs:157-222` — why the example task from `init` has
   RUNNABLE `verification`; that decision is already made, do not second-guess
   it.
4. `scripts/history-record.mjs` — how to append an event with an actor.
5. `scripts/paths.mjs` — `resolveBacklogDir()` and the repository root.
6. `.claude/skills/backlog-workflow/SKILL.md`, "Close a task" section — today
   it describes a manual procedure; after this task it should point to the
   command.

## Steps

1. `worktrail done <ID>`: read the task, print the `verification` entries BEFORE
   running them, execute them in order at the repository root.
2. Stream the output of each command. The first failure ends the run, exits
   with code !=0, and does NOT touch the task file.
3. An empty list, a missing field, and the template literal — all fail with a
   separate message (this is a different error from "verification failed").
4. `manual:` — explicit confirmation, recorded in the history with an actor.
   The confirmation message enumerates what does NOT count as proof (context
   point 6).
5. Tick off acceptance criteria from the link introduced in TL-86 and refuse to
   close when a criterion has no green proof. Without this the gate would let a
   task through with dead checkboxes — measured: 12 out of 44 closed tasks.
6. Once everything is green: `status: done`, `updated:` set to today, an entry
   in `## Log`, an entry in the history, `build`. One command closes the whole
   ritual from SKILL.md.
7. `--json` (envelope from TL-72): each entry's result, exit code, timing.
8. `--dry-run`: run the verifications, do not change the status. This is the
   mode in which an agent checks itself BEFORE announcing it is ready.
9. README: describe the gate together with its boundary from context point 4.
10. `scripts/tests/verification-gate.test.mjs`, a fixture for every case: all
   green → status changed; one failure → status UNTOUCHED; empty
   `verification` → fails; template literal → fails; `manual:` without
   confirmation → does not close; confirmed `manual:` → history entry with
   actor.

## Acceptance criteria

- [x] `worktrail done <ID>` closes a task only after a green set of `verification`. [proof: gate-tests]
- [x] Failure leaves the task file unchanged and exits with code !=0. [proof: gate-tests, red-run-observed]
- [x] Missing, empty list, and the template literal all FAIL, with a message distinguishable from a verification failure. [proof: gate-tests]
- [x] `manual:` requires explicit confirmation recorded in the history with a namespaced actor. [proof: gate-tests]
- [x] The `manual:` confirmation message enumerates what does NOT count as proof (presence of code, grep, intent). [proof: gate-tests]
- [x] Acceptance criteria are ticked off from proofs; a criterion without green proof blocks closing. [proof: gate-tests]
- [x] No other command (`build`, `check`, `serve`, `regen-hook`) runs `verification`. [proof: gate-tests]
- [x] Commands start at the repository root even in a co-located layout. [proof: gate-tests]
- [x] `--dry-run` checks without changing status; `--json` returns the result of each entry. [proof: gate-tests]
- [x] The README names the boundary: the gate raises the *cost* of a lie, it does not eliminate it. [proof: readme-limit]
- [x] The `backlog-workflow` skill points to the command instead of describing a manual procedure. [proof: skill-refers]
- [x] The test has a fixture for EACH of the six cases, including a positive control on an empty `verification`. [proof: gate-tests]

## Log

2026-08-31 pending — agent:claude — created after analysis of Backlog.md. Reason P0: `verification:` is today recorded and validated, but not run by any script — the tool's one distinguishing feature exists as a convention, not a mechanism.
2026-08-31 pending — agent:claude — added: dependency on TL-86 (the gate ticks off criteria, not just runs commands) and enumeration of false proofs in the `manual:` confirmation.
2026-09-01 pending — agent:claude — HANDOFF FROM TL-86 (step 6). The linking mechanism is in place; `worktrail done` is to CONSUME it, not design it a second time. What you get ready-made in `scripts/criteria.mjs`: (1) `parseVerification(frontmatter)` → entries `{id, bash, manual}` plus a list of problems — an entry may have a stable `id:`, an unknown key FAILS, a duplicate `id` FAILS; (2) `parseCriteria(body)` → items `{text, checked, proofs}`, where `proofs` come from the `[proof: a, b]` marker at the end of the criterion line; (3) `auditTask({frontmatter, body, policy})` → `{errors, warnings}`; (4) `applyProofs(raw, passedIds)` → `{text, ticked}`, idempotent, ticks off ONLY criteria whose ALL proofs passed, and never unticks. WHAT THE GATE IS TO TICK OFF: criteria whose every referenced `verification` entry came out green — `applyProofs` computes this for you, save the returned text. WHAT IT IS TO REFUSE ON: (a) `auditTask(...).errors` non-empty — this means the link is BROKEN (a criterion references a nonexistent `id`), not merely missing; (b) a criterion that is STILL unticked after the run — this is the AC "a criterion without green proof blocks closing", and it counts the same for a criterion with no proof as for a criterion whose proof failed. WATCH THE MIGRATION: the default policy `criteria_links: warn` (config.yaml) means 69 current tasks have no links — if `done` refused on a missing link, NONE of them could be closed. The refusal follows the policy: under `warn` a missing link does not block, under `require` it does. A broken link ALWAYS blocks. `manual:` is already parsed and can be referenced by a criterion — its "passing" is your decision about confirmation, not mine.
2026-09-01 pending — agent:claude — UNBLOCKED: TL-86 closed. `blocked_by` stays as a record of a dependency that was real — the reference guard counts `done` as existing, so there is no reason to erase the history to get green.
2026-09-01 in_progress — agent:claude — taken; the only actionable P0 (TL-81 is a decision item, TL-48 is waiting on an owner).
2026-09-01 in_progress — agent:claude — SEVEN DECISIONS FROM THE CONTEXT, each implemented and tested.
  (1) EMPTY CONTRACT — a missing field, an empty list, and the `command to run` literal refuse with a "no closing contract" message, explicitly different from "verification failed"; a test compares both messages so they do not merge into one. The positive control on an empty `verification` is the first test in the file, because a gate that closes a task with no contract would pass every other test in this file.
  (2) `manual:` — asks a human with an enumeration of what does NOT count as proof (presence of code, grep, intent of the implementation, "I checked" — including a true one). Confirmation requires typing the word `confirm`, not `y`: a consent that can be given with one finger on the way to something else is not a conscious act. It lands in the history as a new pseudo-field `__verified__` with the actor and the CONTENT of the entry — `diffMeta` will not see this, because the frontmatter does not change, so without its own event the one thing `manual:` has to offer instead of a command — WHO vouched — would leave no trace.
  (3) NOTHING ELSE RUNS `verification` — the test iterates over `build`, `check`, `query`, `stats`, `viewer` and looks for the marker, PLUS a positive control that the same marker does fire under `done`. Without that second half the test would also pass if the marker fired nowhere at all.
  (4) THE BOUNDARY IN THE README — "raises the cost of a lie, does not eliminate it", together with the reason there is no `--force`.
  (5) REPOSITORY ROOT — `repoRootFor()` asks git (`rev-parse --show-toplevel`), and in its absence returns the backlog directory and says so in a comment. The test assumes a REAL repository and checks both layouts: nested and co-located. `join(root, "..")` would give, in the co-located layout, a directory ABOVE the repository.
  (6) ENUMERATION INSTEAD OF A REQUEST — the content from Backlog.md goes straight into the prompt; the test asserts the presence of `grep` and "I checked" in the list, so shortening it fails.
  (7) `--force` DOES NOT EXIST. The reason is not purist: the flag would not add a capability — manual editing of the file is available regardless — it would add something worse, namely a SUPPORTED, scriptable one-word bypass that ends up in a CI job where nobody will ever read it again. A bypass that costs a visible diff in review is the right price. Recorded in `--help`, in the README, and in the skill, so the absence of the flag is a decision, not an oversight.
  DECISIONS OUTSIDE THE LIST: (a) the closing status comes from `archived_statuses`, NEVER from the literal "done" — a backlog that calls it `shipped` should work without a code change; `--status` selects a different archival status (e.g. `cancelled`), but always archival, because `done` closes, and moving to an open status is an edit, not a closing. (b) `--json` refuses to handle an unconfirmed `manual:` instead of injecting a prompt in the middle of the JSON — asking a human for consent when the output is parsed by a program is inherently inconsistent. (c) Refusals are also JSON (`reason`, `refusal`), because a script needs a machine-readable answer to "why not" more than to "yes". (d) Criteria without proof refuse BEFORE running anything (under `criteria_links: require`) — burning time on commands only to then reject the result answers nothing. After a green run there is an assertion-based safeguard against inconsistency between the runner and `applyProofs`: a criterion whose ALL proofs passed but was not ticked off is a tool defect and always refuses.
  MANUALLY MEASURED on a fixture (a `verification` entry failing with code 4): `done` printed the command's output, exited with code 1, and the file was left with `status: pending` — this is exactly this task's own `manual:` entry, and I vouch for it on THIS observation, not on having read the code.
2026-09-01 in_progress — agent:claude — the first attempt to close FAILED on its own `readme-limit` entry: the grep looked for the phrase "raises the *cost* of a lie" on a single line, but the sentence breaks in the README between "*cost*" and "of a lie". Recorded because this is exactly the kind of thing manually ticking a checkbox would let through — the README was correct, the proof was wrong, and without running it nobody would have known which of the two.
2026-09-01 done — agent:claude — closed by `worktrail done`: 3 command(s) + 1 vouched-for entry green.
