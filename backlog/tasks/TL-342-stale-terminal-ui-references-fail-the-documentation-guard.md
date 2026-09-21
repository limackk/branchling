---
id: TL-342
title: "Stale terminal UI references fail the documentation guard"
type: task
labels: []
board: main
epic: "CLI onboarding"              # free text — the group this task counts towards
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:claude
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
estimate: 30m
confidence: medium                 # how much you trust the estimate
created: 2026-09-07
updated: 2026-09-21
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: []                         # ids this task will unblock
related_docs: [scripts/tests/docs-terminal-surface.test.mjs, scripts/ui.mjs, scripts/json-envelope.mjs, docs/manual.md, docs/backlog-field-editing-history.md] # paths relative to the repository root
verification:
  # REWRITTEN BEFORE THE WORK STARTED (TL-260, TL-424). The old block was one
  # entry — `node scripts/cli.mjs check` — and it passed against the unchanged
  # tree: the `related_docs` this task was opened on had already been corrected
  # by TL-363, and not one of the defects found in the sweep is visible to any
  # of the ten release gates. A contract that cannot fail proves nothing, so
  # the proof is now a guard that derives the terminal surface from the code
  # and fails against the documents as they stood at 0d733ac.
  #
  # Every path named below exists in this commit. `node --test <missing path>`
  # EXITS 0, so a contract naming a test nobody wrote is green forever.
  - id: docs-match-the-terminal
    bash: "node --test scripts/tests/docs-terminal-surface.test.mjs"
  - id: seed-names-from
    bash: "node scripts/cli.mjs seed --zzz-not-a-flag 2>&1 | grep -q -- '--from'"
  - id: release-gates
    bash: "node scripts/cli.mjs check"
  - id: suite-green
    bash: "node --test scripts/tests/*.test.mjs"
---

## Goal

Nothing in `docs/` or `README.md` tells a reader to type something the tool
would refuse, and a guard derived from the code — the command table, each
command's own refusal, the `--json` kinds — fails the moment one of them does.

## Context

The task was opened on five pre-flight references to `scripts/terminal-ui.mjs`,
a module that no longer exists. Those `related_docs` entries were corrected by
TL-363 and `check --docs` has been clean since; what remains of the original
sighting is prose inside SEVEN CLOSED tasks (TL-320, TL-321, TL-323, TL-324,
TL-325, TL-326, TL-328). A closed task is a record of its own day (TL-395):
rewriting its pre-flight to name a module that did not exist when the work was
done would make the file assert something that was never true. They are left
alone deliberately.

The real defect is the one that let those references stand: the terminal surface
moves — one refusal anatomy for the whole table (TL-220), flags declared
(TL-217), commands added (TL-256, TL-276, TL-284) and deleted (TL-378, TL-394) —
and nothing compares it against the documents that teach it. The sweep found
three drifts, none of them visible to any release gate:

- `docs/manual.md` listed `time`, `sessions` and `session` in the `--json`
  contract table, for commands deleted with the telemetry. `json-envelope`'s
  suite walks `KINDS` and demands a row for each, which cannot see a row with no
  kind behind it.
- `docs/backlog-field-editing-history.md` told the reader that
  `branchling session <id>` joins the history log to the activity log. Both the
  report and the log it joined are gone; the `session` FIELD remains.
- `README.md` printed `branchling seed --from spec.md`, which `seed` accepts and
  its `--help` declares, while its refusal's `available:` list omitted it. The
  terminal contradicted itself, so the fix belonged in `scripts/seed-backlog.mjs`.

The guard also found `import --json` throwing `unknown JSON kind: import` —
a crashing command, not a documentation drift, so it is TL-425 with a named
exemption here rather than a second thesis inside this task.

## Pre-flight reading

The files to read before the first edit, each with a reason.

1. `scripts/ui.mjs` — `refusal()`: the one anatomy every command answers an
   unknown flag in, and therefore where "what does this command accept" can be
   asked of the process itself.
2. `scripts/cli.mjs` — `COMMANDS`, the table that says which commands exist.
3. `scripts/json-envelope.mjs` — `KINDS`, and the registration the manual
   describes as the only place a kind is declared.
4. `scripts/tests/help-covers-flags.test.mjs` — the same derivation applied to
   `--help`, including the exemption-map idiom this guard reuses.

## Steps

1. Sweep `README.md` and every document in `docs/` for command lines the tool
   would refuse and for `--json` kinds it cannot emit.
2. Fix each: the document where the document is wrong, the command where the
   terminal contradicts itself.
3. Add `scripts/tests/docs-terminal-surface.test.mjs`, deriving the surface from
   the code, with a positive control per rule and a reach control that fails if
   the scanner stops finding invocations at all.

## Acceptance criteria

Each one names the `verification:` entry that PROVES it, and the tool ticks it
after a green run — a checkbox you tick by hand is a claim, not evidence. A
criterion may wrap onto further indented lines; the marker goes at the end of
the last one.

- [x] Every command line written in `README.md` or `docs/` names a command in
      `COMMANDS` and flags that command's own refusal lists, and the guard is
      proved to catch a document that does not.
      [proof: docs-match-the-terminal]
- [x] The manual's `--json` table documents no kind `KINDS` cannot emit, save
      one exemption naming TL-425, which fails once that defect is gone.
      [proof: docs-match-the-terminal]
- [x] The guard cannot pass on a zero sample: it fails unless the real
      documents yield at least fifty invocations across three or more files.
      [proof: docs-match-the-terminal]
- [x] `seed`'s refusal names `--from`, the flag it accepts and `--help`
      declares. [proof: seed-names-from]
- [x] All ten release gates pass. [proof: release-gates]
- [x] The suite is green. [proof: suite-green]
