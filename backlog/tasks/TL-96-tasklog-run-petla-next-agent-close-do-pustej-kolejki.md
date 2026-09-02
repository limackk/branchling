---
id: TL-96
title: "worktrail run — a next, agent, close loop to an empty queue"
type: task
labels: []
board: main
epic: "Agentic differentiators"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: [TL-87, TL-93]
blocks: [TL-98]
related_docs:
  - docs/worktrail-global-tool.md
  - docs/worktrail-state-and-sync.md
verification:
  - id: loop
    bash: "node --test scripts/tests/run.test.mjs"
---

## Goal

`worktrail run` drives the backlog to an empty queue: in a loop it takes a
task (`next`, TL-87), runs the agent command from the configuration, and
after it exits tries to close the task through the verification gate
(`done`, TL-93); a task that fails verification `run_max_attempts` times goes
to `blocked` with a reason in the log, and the loop takes the next one. At
the end, a run report: closed / blocked / untouched, time, and — when the
cost adapter is active — tokens per model.

Closes the "one prompt → a working project" scenario: `seed` (TL-94/05)
creates the backlog, `run` executes it, and after the run there is a
receipt — per-field history, verification evidence, sessions. The
distinguishing claim is not "it got built", but "it got built and everything
is accounted for".

## Context

Came from a product decision (2026-08-31). The boundaries that keep this task
within the four laws:

- **worktrail is not an agent.** The agent command is a template in the
  configuration (e.g. `run_agent_command: "claude -p @{task_file}"`,
  `"codex exec …"`, `"aider --model ollama/qwen2.5-coder …"`), run per task.
  The tool provides the queue, the lock, the gate and the bookkeeping; the
  hands are interchangeable (Law 4). No knowledge of any specific host in the
  loop's code.
- **This is not a daemon**: the process lives only during the run and ends
  with an empty queue or when only blocked tasks remain; the "no daemon"
  decision ([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md)
  §10) stays intact.
- **Honest failure instead of an infinite loop**: exhausted attempts =
  `blocked` with an entry stating which verifications failed. After the run,
  the board shows where and why it stalled — this is a promise that holds up
  when a local model gets stuck on task 7 of 20.
- **Sequential in v1.** Parallelism (N `run` processes on a shared tree, or
  one worktree per agent) rests on the lock from TL-87 and is a separate
  task — do not fold it in here; the first version should be reasonable to
  think about.
- Agent output goes to a per-task log file (path in the report), not to the
  screen — a run of 20 tasks has to stay readable.
- An interrupt (Ctrl-C) leaves the current task in `in_progress` with a lock
  that expires per the TTL from TL-87 — to be noted in the output, not to be
  given special handling.

## Pre-flight reading

- `backlog/tasks/TL-87-tasklog-next-atomowy-przydzial-taska-dla-agenta.md`
  — the `next` contract: selection, lock, exit codes.
- `backlog/tasks/TL-93-bramka-weryfikacji-w-tasklog-close.md` — the
  `close` contract: when the status stays untouched, the verification event.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3, §10 —
  Law 4 and the "no daemon" decision.

## Steps

1. Configuration keys: `run_agent_command` (a template with the task file
   path and ID substituted in), `run_max_attempts`, a timeout for a single
   agent run. Layer: the agent command is a fact about the user's machine —
   the user layer.
2. The loop: `next` → agent (output to a per-task log) → `done`; a
   verification failure appends its result to the next agent attempt (the
   agent needs to know WHAT failed); exhausted attempts → `blocked` + an
   entry in the task's `## Log`.
3. Stop conditions: empty queue, only blocked tasks remain, `--max-tasks N`,
   `--dry-run` (shows the order without running the agent).
4. Final report (text + `--json`): per task, result and number of attempts,
   totals, run time; cost columns conditionally, per the billing modes from
   TL-30.
5. Tests with a stand-in agent (a script in a fixture, not an LLM): the happy
   path, a task failing to `blocked` after the attempt limit (positive
   control: the status is NOT done), agent timeout, `--max-tasks`.

## Acceptance criteria

- [x] The loop does not know any specific agent host; tests pass with a stand-in that is a plain script. [proof: loop]
- [x] A task with exhausted attempts is `blocked` with a reason, never `done`. [proof: loop]
- [x] The result of a failed verification lands in the input of the next agent attempt. [proof: loop]
- [x] The run also ends when only blocked tasks remain — no spinning on an empty selection. [proof: loop]
- [x] The `--json` report carries, per task: result, number of attempts, log path. [proof: loop]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created for the "one prompt → a
  working project" scenario; waiting on the dispatcher (TL-87) and the
  verification gate (TL-93). Parallelism deliberately out of scope for v1.
