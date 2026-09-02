---
id: TL-74
title: "worktrail instructions — the CLI issues workflow instructions, not a file in someone else's repo"
type: code
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P1
status: done
owner: agent:claude
estimate: 1d
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - .claude/skills/backlog-workflow/SKILL.md
verification:
  - id: guides
    bash: "node --test scripts/tests/instructions.test.mjs"
  - id: refusal
    bash: "! node scripts/cli.mjs instructions task-invention 2>/dev/null"
  - id: envelope
    bash: "node --test scripts/tests/json-envelope.test.mjs"
  - id: guards
    bash: "node scripts/cli.mjs check"
  - id: no-regression
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

`worktrail instructions [topic]` prints the backlog workflow instructions
straight from the CLI. An agent outside Claude Code (Codex, Gemini CLI, a bare
API) gets the same workflow without our plugin, the instructions are versioned
with the tool, and their content speaks the vocabulary of the backlog BEING
READ, not ours.

## Context

We have the `backlog-workflow` skill — it works, but only in Claude Code and
only for someone who has our plugin. A user who runs `npm i -g worktrail` gets
nothing: `worktrail --help` says WHAT the commands are, not HOW to work with
them.

Backlog.md solved this by having the CLI issue the instructions, leaving one
line in `CLAUDE.md`/`AGENTS.md`: "run `backlog instructions overview`". The
advantage is structural: a copied instruction file freezes at the version it
was copied from and after six months teaches flags that no longer exist. The
command cannot drift from the tool, because it IS the same artifact.

**Analysis of their `src/guidelines/` (2026-08-31) yielded four construction
elements that matter more than the mere existence of the command.** Without
them we get the same text as today, just printed from a different place:

1. **The instructions do not know the project's vocabulary.** Their files
   never write "In Progress" — they write `<active status>`,
   `<terminal status>`, `{{TASK_ID:123}}`, substituted at render time from the
   config of the backlog being read, and tell the agent to read the allowed
   values from `--help`. This is law III applied to TEXT. Our `SKILL.md`
   writes `pending`, `in_progress`, `P0`, `TL-1234` as literals, which teaches
   THIS repository's values as tool constants — and in someone else's backlog
   every one of them fails.
2. **A dispatcher, not one block.** `overview` does NOT contain the procedure.
   It says when to act, and points to one of three phase guides, with a hard
   "Required: read the matching guide, do not rely on this overview alone".
   Our `SKILL.md` is ~120 lines loaded in full every time. Splitting into
   phases means less context and a sharper instruction at the moment it is
   needed.
3. **A version in the nudge plus a refresh command.** The fragment injected
   into `CLAUDE.md` carries version metadata, and `agents
   --update-instructions` refreshes it. Without this, `init` leaves text in
   someone else's repo that rots.
4. **A single-question heuristic for "should a task even be created":**
   *"Do I have to think about HOW to do this?"*. Our equivalent is a list of
   exceptions. One question applies faster and misleads less often.

Rejected alternative: an MCP server. Their own task `back-349` reads "Publish
Backlog.md as an Agent Skill with bundled guidance, **no MCP resources
required for instructions**" — they themselves moved from MCP to a skill plus
CLI-issued instructions. We are going where they arrived, instead of repeating
their path.

Settled: the instructions are a SINGLE source. After this task the
`backlog-workflow` skill either points to the command or is generated from
it — two texts about the same thing that can drift apart are a defect, not
redundancy.

## Pre-flight reading

1. `.claude/skills/backlog-workflow/SKILL.md` — content to migrate; source
   material, not inspiration. Note the vocabulary literals to remove.
2. `scripts/cli.mjs` — the command table and the shape of `--help`.
3. `scripts/config.mjs` — how to reach the project's vocabulary.
4. `scripts/init-backlog.mjs` — where `init` writes files and what it already
   appends.

## Steps

1. `worktrail instructions` with no argument — lists topics. An unknown topic
   fails, listing the known ones.
2. Topics: `overview` (dispatcher — when to act, where to go),
   `task-creation`, `task-execution`, `task-finalization`. `overview` does NOT
   repeat the procedure.
3. Templating: no status, priority, prefix, or example ID written as a
   literal. Values are substituted from the `config.yaml` of the backlog being
   read.
4. The heuristic from context point 4 at the start of `overview`.
5. `--json` (envelope from TL-72).
6. Resolve the duplication with the skill: it points to the command or is
   generated.
7. `worktrail init` appends a nudge with version metadata to
   `CLAUDE.md`/`AGENTS.md`, preserving existing content. A refresh command for
   an outdated nudge.
8. Decisions from TL-84 (manual editing) and TL-85 (scope policy) must land
   HERE, in one source — not in a skill alongside it.
9. `scripts/tests/instructions.test.mjs`: every topic prints something; an
   unknown topic exits with a nonzero code; **the output contains no status
   outside the fixture config** (positive control — the fixture must use
   NON-DEFAULT vocabulary, so a literal in the code fails the test); the nudge
   is recognizable by version and refreshable.

## Acceptance criteria

- [x] `instructions` lists topics, `instructions <topic>` prints content, an
      unknown one fails with a list. [proof: guides, refusal]
- [x] `overview` is a dispatcher and points to the phase guides; it does not
      repeat their procedure. [proof: guides]
- [x] No topic contains a status, priority, or prefix as a literal.
      [proof: guides]
- [x] The test fails when a value outside the fixture config appears in the
      output. [proof: guides]
- [x] Exactly one source of instruction content exists; the skill points to it
      or is generated from it. [proof: guides]
- [x] The nudge carries a version, can be refreshed, and appending does not
      erase the file's content. [proof: guides]
- [x] The "should a task be created" heuristic is in `overview`. [proof: guides]
- [x] `instructions --json` responds with an envelope carrying `schemaVersion`
      and `kind`, and the README documents this kind. [proof: envelope]
- [x] The guards and the rest of the dry set stay green. [proof: guards,
      no-regression]

## Log

2026-08-31 pending — agent:claude — created from the Backlog.md analysis, point 5.
2026-08-31 pending — agent:claude — rewritten after analyzing `src/guidelines/`: added vocabulary templating, the split into a dispatcher and phase guides, the nudge version, the task-creation heuristic. Estimate 4h → 1d.
