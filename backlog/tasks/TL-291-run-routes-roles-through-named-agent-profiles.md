---
id: TL-291
title: "run routes roles through named agent profiles"
type: task
labels: []
board: main
epic: "Provider-neutral agent execution"
priority: P1
status: pending  # pending | in_progress | blocked | done | cancelled
owner: ""
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-09-05
updated: 2026-09-06
blocked_by: [TL-264, TL-288, TL-289, TL-300]
blocks: [TL-293, TL-294, TL-301]
related_docs:
  - docs/backlog-human-agent-decisions.md
verification:
  - id: profile-routing
    bash: "node --test scripts/tests/run-agent-profiles.test.mjs scripts/tests/run-follows-handoff.test.mjs"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`run` can map each project role to a named user profile. One queue may therefore
send development to Claude, review to Codex and another role to any configured
provider, while unserved roles continue waiting visibly.

## Context

TL-98 already established correct routing with repeatable
`--agent-for <role>=<command>` flags, including missing-role reporting and
handoffs. This task changes only how a user selects the hand: by stable profile
name instead of repeating a raw command.

The project's role vocabulary and briefs belong in the repository; the chosen
provider and model belong to the user. Validate the two layers at their seam.
Do not put profile names into task frontmatter or `backlog/config.yaml`, because
that would make another contributor's local setup part of project truth.

## Pre-flight reading

1. `scripts/run-loop.mjs` — extend the existing role map without changing queue
   selection, handoff or retry semantics.
2. `scripts/tests/run.test.mjs` — preserve the raw command compatibility path.
3. `scripts/tests/run-follows-handoff.test.mjs` — preserve multi-stage routing.
4. `docs/backlog-human-agent-decisions.md` — keep project and deployment
   decisions in their correct layers.
5. `backlog/tasks/TL-264-a-role-is-declared-but-never-defined-so-every-fleet-invents.md`
   — consume the role briefs once that task supplies them.

## Steps

1. Add a repeatable profile-per-role input to `run`; choose and record names
   that remain distinct from the raw-command flags.
2. Resolve every referenced profile and role before claiming the first task.
3. Compose the project role brief, profile prompt and task input in a documented
   order with visible source labels.
4. Preserve missing-role reporting and role-to-role handoffs.
5. Reject ambiguous mixes where a role receives both a raw command and a named
   profile.

## Acceptance criteria

- [ ] One run routes `dev` and `review` to two named profiles with different
      adapters, models, efforts and prompts. [proof: profile-routing]
- [ ] A missing profile, unknown role or duplicate raw/profile assignment fails
      before any task is claimed. [proof: profile-routing]
- [ ] Unserved roles, handoffs and legacy `--agent-for` behavior remain
      unchanged. [proof: suite-green]
