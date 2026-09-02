---
id: TL-56
title: "The types vocabulary in config.yaml has drifted from the tree"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P2
status: done
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/config-vocabulary.test.mjs"
  - bash: "node scripts/cli.mjs check"
  - bash: "d=$(mktemp -d) && node scripts/cli.mjs init --dir \"$d\" >/dev/null 2>&1 && T=$(node -e \"import('./scripts/config.mjs').then(m=>console.log(m.loadConfig(process.argv[1]).types[0]))\" \"$d\") && node scripts/cli.mjs new --dir \"$d\" --title Sonda --type \"$T\" >/dev/null 2>&1 || { echo 'typ z konfiguracji ODRZUCONY przy zapisie'; exit 1; }; node scripts/cli.mjs new --dir \"$d\" --title Sonda2 --type nie-ma-takiego >/dev/null 2>&1 && { echo 'wartosc spoza slownika PRZESZLA'; exit 1; }; echo \"OK: typ z konfiguracji ($T) przechodzi, wartosc spoza slownika odrzucona\""
---

## Goal

Bring the `types` vocabulary into agreement with the contents of the tree —
and make a drift in ANY vocabulary fail at read time, not only when a write
is attempted.

## Context

Hit on 2026-08-31 while creating tasks from the audit:

```
$ worktrail new --title "…" --type code
[worktrail new] `code` is not an allowed value for field `type`
  allowed: task
```

Meanwhile the tree holds: **43 tasks with `type: code`**, 3 with `type: bug`,
1 with `type: manual` — and not one with `type: task`, the only value
`config.yaml` knows. `worktrail check` and `worktrail build` pass green.

This is an **asymmetry between write and read**: the write path enforces the
vocabulary, the read path does not check it. The consequence is exactly the
opposite of what was intended — 47 files violate the vocabulary without a
word of protest, and the one thing the tool blocks is writing one more file
just like all the existing ones.

This class of bug already has a name in this project. The ID prefix was
settled so that **a drift between configuration and tree FAILS before the
write** (`detectPrefixMismatch` in `task-id.mjs`, `CLAUDE.md` §"Before you
change the code"). The same principle was not applied to the other
vocabularies, so `types` could drift silently — and there is no way to know
without checking whether it is the only one.

**What needs deciding is the direction of the fix, not the fact of it.**
Either `config.yaml` is wrong and should list `[code, bug, manual]` (in which
case the tree is the truth), or the tree gets migrated to `task`. The first is
almost certainly correct — 47 files is documented practice, and `types:
[task]` looks like a default value nobody updated — but this is the owner's
decision, because `type` is a project vocabulary.

The reason this ships before publication: a stranger will hit the same effect
on their own backlog, except without knowing there is even a configuration
file that settles this.

## Pre-flight reading

1. `scripts/config.mjs` — `DEFAULTS`, loading and validating `config.yaml`.
2. `scripts/task-fields.mjs` — `buildFieldSpecs()` / `normalizeValue()`, the
   place where the write path enforces the vocabulary.
3. `scripts/task-id.mjs` — `detectPrefixMismatch()`, the pattern "a drift
   fails before the write".
4. `backlog/config.yaml` — `types: [task]`.

## Steps

1. Measure the drift across ALL vocabularies: `type`, `status`, `priority`,
   `owner`, `estimate`, `label`, `board`. Record the result in `## Log` — do
   not assume `types` is the only one.
2. Settle the direction for each drift with the owner.
3. Fix `config.yaml` (or the tree, if that is the decision).
4. Add a guard that compares vocabularies against the tree and FAILS — on
   the pattern of `detectPrefixMismatch`. The message should name the field,
   the out-of-vocabulary values, and the number of files carrying them.
5. Wire the guard into `worktrail check`, so it runs alongside the others.
6. A positive control in the test: a fixture with an out-of-vocabulary value
   MUST fail. Without it the test would pass on a clean tree and be green
   with no evidentiary force.

## Acceptance criteria

- [x] `config.yaml` and the tree agree on every vocabulary.
- [x] A vocabulary drift fails `worktrail check`, not just a write.
- [x] The message names the field, the values, and the number of files.
- [x] The test has a positive control — a fixture with an out-of-vocabulary
      value fails.
- [x] The result of reviewing all vocabularies is recorded in `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — hit while running `worktrail new
  --type code`; 43 tasks `code`, 3 `bug`, 1 `manual`, the vocabulary only
  knows `task`
- 2026-08-31 pending — agent:claude — TL-62 added `auditVocabulary(metas,
  config)` in `task-fields.mjs` and surfaces the result in `worktrail
  doctor`. This task therefore already has a ready-made measurement: what
  remains is the direction decision (fix `types` in config or the tree) and
  wiring the function into `check` with a positive control. Measured today
  by doctor: `type` — code ×43, bug ×10, manual ×1, against the vocabulary
  `[task]`.
- 2026-09-01 done — agent:claude — review of ALL vocabularies, since step 1
  forbade assuming `types` was the only one. Closed enums: `type` — the only
  drift; `status` (5 values) and `priority` (4) are clean. `owner` (`claude`,
  `agent:claude`, `founder` outside `owners:`) and `estimate` (`4h` ×41,
  `3h`, `1h` outside `estimates:`) are NOT a drift — these are `kind: "text"`
  fields with `suggestFrom`, i.e. suggestion lists, not vocabularies.
  `labels` is open via `labels_closed: false`. `board` has its own guard and
  is deliberately excluded from `auditVocabulary` so the same file is not
  reported twice.
- 2026-09-01 done — agent:claude — direction: the TREE is the truth. `types:
  [task]` had been in the file since the first commit (aa6d49e) AT THE SAME
  TIME as tasks with `type: code` — meaning it was never true; it is the
  tool's default value, not a project decision. `types: [task, code, bug]`.
- 2026-09-01 done — agent:claude — `manual` ×1 was NOT added to the
  vocabulary: it is a leftover from a different axis. `manual` is a kind of
  VERIFICATION (`VERIFICATION_KEYS` in `criteria.mjs`), and its only carrier
  — TL-20 — has a `manual:` entry in its `verification:` and purely code
  work (a name in `scripts/`, `package.json`, README). Fixed to `code`: one
  file, not a migration. Across the entire git history there were only four
  `type` values, so there are no typos.
- 2026-09-01 done — agent:claude — `code` (59) and `task` (48) are synonyms
  and both are written on the same day; collapsing them is a 59-file
  migration and a vocabulary decision, so it is deferred as TL-123, rather
  than done quietly in passing.
- 2026-09-01 done — agent:claude — guard: `check-backlog-vocabulary.mjs` +
  `--vocabulary`, in the default `check` run. The verdict comes from
  `auditVocabulary()` — the same function `doctor` uses — and only adds
  pairing values with files so the message says WHERE to go. Along the way,
  a gap in `auditVocabulary` itself was closed: a CLOSED list with an empty
  vocabulary (`labels_closed: true`, `labels: []`) was being skipped, even
  though the write path rejects every label in that case — exactly the
  asymmetry this task closes.
- 2026-09-01 done — agent:claude — a fixture in `cli.test.mjs` carried
  `type: code`, i.e. THIS project's vocabulary, while running under the
  built-in defaults (`types: ["task"]`). The new guard flagged it, and
  correctly so — the fixture was fixed, not the guard.
- 2026-09-01 done — agent:claude — the third probe in `verification:` had
  been broken FROM THE START and could not pass under any state of the
  code: `sed 's/.*\[//'` is greedy, so on `types: [task]                      # [tree]`
  it reached the LAST `[` and pulled out `tree`, after which `new --type`
  received garbage. Replaced with a variant that reads the value through
  `loadConfig()` instead of sed, with both controls: a type from the
  vocabulary MUST pass, a value outside it MUST be rejected. A probe that
  measures its own parsing instead of the tool is green with no evidentiary
  force — here it was red with no evidentiary force.
