---
id: TL-223
title: "A run of specialists is refused because --agent is mandatory"
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
created: 2026-09-03
updated: 2026-09-03
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:                      # HOW to check the task is really done
  - id: specialists-only
    bash: "node --test scripts/tests/run-roles.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
  - id: guards-green
    bash: "node scripts/cli.mjs check"
---

## Goal

A run that serves only named roles can be invoked. Today it cannot: `run`
refuses before the loop starts unless `--agent` is given, so a fleet of
specialists with no generalist — the exact arrangement `--agent-for` exists for
— is unreachable.

## Context

`scripts/run-loop.mjs`, in `run()`:

```js
plan.agent = plan.agent || process.env[AGENT_ENV] || null;
if (!plan.agent && !plan.dryRun) {
  // "no agent command - this tool does not have one of its own"
```

The test does not consider `plan.agentFor`. Reproduced:

```
$ branchling run --dir <backlog> --agent-for maker=<cmd> --actor agent:fleet
X branchling run: no agent command - this tool does not have one of its own
```

`run --help` describes the opposite model: "`--agent-for <role>=<command>` names
a command per role, repeatable; `--agent` then serves the tasks that ask for no
role." A reader takes that to mean `--agent` covers the roleless remainder, and
that a queue whose every task carries a role needs no remainder. The refusal
says otherwise, and only at the point of invocation.

Found while writing `scripts/tests/history-role.test.mjs` for TL-222: both of
its run tests have to pass a generalist command that is then asserted never to
have been reached, purely to get past this check.

## Steps

1. Decide the question below and record it with `branchling decide` before
   touching code.
2. Make the refusal consider `agentFor`.
3. `scripts/tests/run-roles.test.mjs`: a run with only `--agent-for` serves the
   task that asks for that role; the positive control is that a run with NO
   command of any kind is still refused.
4. Whatever is decided in 1, `run --help` must state it.

## Open question

**What happens to a task with no role in a run that serves only roles?**

1. *(recommended)* It is never handed out, and the report counts it the way an
   unserved ROLE is already counted — "N task(s) ask for no role in particular
   — no `--agent` was given". This reuses the escalation that already exists,
   keeps "the dispatcher must not hand out what this invocation cannot serve",
   and makes the roleless remainder one more unserved audience rather than a
   special case.
2. The run stops when it meets one. Loud, but it turns an ordinary backlog —
   where most tasks carry no role — into a run that dies on its first task.
3. `--agent-for` implies a generalist that refuses. Rejected on sight: it
   invents a hand nobody asked for.

## Decisions

Not to be settled here: whether `--agent` should also become optional when the
plan's active wave happens to be entirely roleless. That is the same question as
1 above and is answered by it.
