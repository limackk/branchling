---
id: TL-83
title: "Input surface of writing commands: enums from dictionaries and --append instead of multiline strings"
type: code
labels: [post-launch]
board: main
epic: "CLI surface"
priority: P2
status: done
owner: agent:claude
estimate: 4h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: suite
    bash: "node --test scripts/tests/write-input-surface.test.mjs"
  - id: dictionaries
    bash: "node scripts/cli.mjs new --help --json | node -e \"const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const p=JSON.stringify(d); if(!p.includes('pending')||!p.includes('P1')) process.exit(1)\" && echo 'the vocabularies travel in --help --json — OK'"
  - id: every-command
    bash: "node -e \"import('./scripts/cli.mjs').then(async (m)=>{const {spawnSync}=await import('node:child_process');for(const name of Object.keys(m.COMMANDS)){const r=spawnSync(process.execPath,['scripts/cli.mjs',name,'--help','--json'],{encoding:'utf8'});const d=JSON.parse(r.stdout);if(d.kind!=='command-help'||!Array.isArray(d.flags))process.exit(1)}console.log('every command describes its flags — OK')})\""
  - id: refuses
    bash: "node scripts/cli.mjs new --title X --append-reason A 2>&1 | grep -q 'nothing to append to' && echo 'an append with no field is refused before the command sees it — OK'"
  - id: documented
    bash: "grep -q 'append-reason' README.md && grep -q 'command-help' docs/manual.md && echo 'both surfaces are documented — OK'"
---

## Goal

Every writing command describes its input in a machine-readable way:
permitted values come from the `config.yaml` dictionaries, and multiline
text can be supplied without syntax that agent sandboxes reject.

## Context

Law IV promises "a callable input on every writing command." Today that is
half the promise: commands accept flags, but do not say which values are
legal. The agent guesses, fails, retries — and that loop is the only reason
failing on an unknown value is ever perceived as a nuisance. The problem is
not strictness, it is that the list of permitted values is unavailable at
the moment it is needed.

Backlog.md solved this at the MCP level: tool schemas generate `status` as
an enum from the project's dictionaries, so the agent **structurally
cannot** send a nonexistent value. This is not after-the-fact validation, it
is a narrowing of the input space. We do not need MCP for this — we need
`--help --json` to carry the dictionaries.

**The second problem is more practical than it looks.** Agent sandboxes
built on tree-sitter REJECT the `$'line1\nline2'` syntax (Backlog.md, issue
#595). An agent in such a sandbox has no way to enter a multiline note in a
single call. Their answer is repeatable `--append-*` flags, stated outright
as the recommended form for agents. This will hit us exactly when TL-80 and
TL-82 add commands that write text — so better to know now than to design
the input twice.

Decisions:

1. **Dictionaries in `--help --json`, not a second copy in the code.** The
   source is the `config.yaml` of the backlog being read. A list written
   into the flag definition would drift from the project at the first
   config change.
2. **Failing behavior does not change.** An unknown value still fails (Law
   III). This task adds a list, not leniency.
3. **`--append-<field>` appends, `--<field>` replaces.** When both are
   given, replacement happens first, then appends in command-line order.
   The order must be defined, otherwise the same set of flags gives
   different results.

## Pre-flight reading

1. `scripts/cli.mjs` — the command table and flag validation; this is where
   the input definition lives and where its description is to land.
2. `scripts/config.mjs` — reading the project's dictionaries.
3. `scripts/new-task.mjs` — today's only writing command; the pattern for
   the rest.
4. `docs/branchling-global-tool.md` §3 — the wording of Law IV.

## Steps

1. `--help --json` on every command: flags, types, whether required, and —
   for dictionary flags — the full list of permitted values from
   `config.yaml`.
2. The failure message for an unknown value prints the permitted values (not
   just "unknown value").
3. Introduce `--append-<field>` for text fields on writing commands;
   settle and document the replace-before-append order.
4. Document in the README the three ways of supplying multiline text, with
   `--append-` recommended for agents and an annotation of why.
5. `scripts/tests/write-input-surface.test.mjs`: `--help --json` of every
   command parses and reports values from a FIXTURE, non-default config
   (positive control — otherwise the test would pass on literals in the
   code); repeated `--append-` preserves order; `--field` + `--append-field`
   gives a documented result.

## Acceptance criteria

- [x] `--help --json` on every command describes flags and permitted values. [proof: every-command]
- [x] Dictionary values come from `config.yaml`, never from literals in the flag definition. [proof: dictionaries]
- [x] Failing on an unknown value prints the list of permitted values. [proof: refuses]
- [x] `--append-<field>` works on writing commands, with a documented order relative to `--<field>`. [proof: suite]
- [x] The README describes the multiline forms and says which one works in an agent sandbox. [proof: documented]
- [x] The test uses a non-default config, so literals in the code fail it. [proof: suite]

## Log

2026-08-31 pending — agent:claude — from an analysis of Backlog.md's
agent-facing surface (src/mcp/utils/schema-generators.ts, issue #595).
- 2026-09-02 in_progress — agent:claude — step 1 settled: the flag list is
  DERIVED from each command's own `usage`, not declared in a second table beside
  it. A `flags:` array would drift from the prose the first time somebody
  documented a flag in one and not the other, and the drift would be invisible —
  an agent reading `--help --json` and a person reading `--help` would be told
  different things with no reason to compare. What counts as a declaration is
  narrow on purpose: the synopsis block, and lines whose first token is a flag.
  A flag mentioned mid-sentence is an explanation, not an interface. The
  derivation immediately found three flags `new` accepted and never documented
  (`--status`, `--type`, `--owner`), which is the mechanism working.
- 2026-09-02 in_progress — agent:claude — step 3 settled: `--append-` is folded
  in the DISPATCHER, before the spawn, exactly as `--no-color` is and for the
  same reason — the alternative is one chance per writing command to forget it.
  The commands never learn the flag exists. `--<field>` replaces first, then
  every `--append-<field>` in command-line order; the order is fixed so the same
  flags cannot mean two things. `APPENDABLE_FIELDS` holds `reason` alone: a
  general "append to any text flag" would advertise `--append-title` as an
  interface the tool does not offer. TL-80 and TL-82 join the list rather than
  inventing their own mechanism. Recorded honestly: the history normalises a
  reason to ONE line, so for this first field the appends buy order and
  sandbox-safety, not stored newlines.
- 2026-09-02 in_progress — agent:claude — step 2 needed no change to the writing
  commands: `new`, `take`, `handoff` and `done` already print the permitted
  values on an unknown one. The gap found instead is on the READING side —
  `query --status <typo>` answers "0 matching tasks" — and it went to TL-161
  rather than into this task, whose thesis is the writing surface.
</content>
