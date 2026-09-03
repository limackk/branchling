---
id: TL-62
title: "worktrail doctor — one answer to whether the backlog is set up"
type: task
labels: [pre-launch]
board: main
epic: "Onboarding"
priority: P2
status: done
owner: claude
estimate: 1d
confidence: medium
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-60]
blocks: []
related_docs:
  - .claude/skills/branchling-cli/SKILL.md
  - .claude/skills/branchling-cli/references/output-style.md
verification:
  - bash: "node --test scripts/tests/doctor.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/branchling.mjs; node $T init --dir \"$d\" >/dev/null && node $T doctor --dir \"$d\" >/dev/null && echo 'a fresh backlog passes doctor — OK'"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/branchling.mjs; node $T init --dir \"$d\" >/dev/null; printf 'statusess: [a]\\n' >> \"$d/config.yaml\"; node $T doctor --dir \"$d\" >/dev/null 2>&1 && { echo 'doctor does not see the broken configuration'; exit 1; }; echo 'doctor catches the typo — OK'"
  - bash: "node scripts/cli.mjs doctor --json | node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('doctor --json parses — OK')})\""
---

## Goal

Give one command that answers a question that cannot be asked today: **"is
my backlog set up correctly, and what's next"**.

## Context

After `worktrail init` the user adapts `config.yaml` to their project and has
no way to check whether they succeeded. They have to invoke a random command
and hope that this particular one notices the problem — and the behavior
measured on 2026-08-31 is inconsistent: a typo in a key passes through
`build` and `check`, but crashes `stats`.

Scattered diagnostics is natural in this project (the guards have
deliberately different scopes), but there is no **single entry point that
collects them and speaks in plain language**. This is a standard in
developer tools for a good reason: a diagnostic command is cheap to maintain
when the checks already exist, and it turns "I don't know if this works"
into a list of sentences.

This project has an unusually good starting position — the checks already
exist. `doctor` has to **call them, not repeat them**; a second set of rules
would drift from the first.

What it has to check, and how we know it — each row corresponds to a real,
measured pitfall:

| Check | Source |
|---|---|
| `config.yaml` parses, keys are known | [TL-60](TL-60-literowka-w-config-yaml-przelatuje-przez-build-i-check.md) |
| vocabularies are consistent (`archived_statuses` ⊆ `statuses`, etc.) | works today, collect it |
| values in tasks fit within the vocabularies | [TL-56](TL-56-slownik-types-w-config-yaml-rozjechal-sie-z-drzewem.md) |
| the prefix from the configuration matches the tree | [TL-61](TL-61-rozjazd-prefiksu-nie-zatrzymuje-tasklog-new.md) |
| views are ignored by git | [TL-59](TL-59-ko-lokacja-widoki-nie-sa-ignorowane-w-istniejacym-repo.md) |
| `history/*.jsonl` has `merge=union` | TL-59 |
| backlog guards (`check`) | exists |
| hooks installed or not | [TL-46](TL-46-tasklog-init-hooks-bramka-ktora-sama-sie-instaluje-u.md) |
| how many tasks, in which statuses, what's next | exists in `stats` |

**A boundary that must not be crossed: `doctor` fixes nothing.** A command
that "incidentally" corrects someone else's configuration stops being a
diagnosis and becomes a change without a decision. What it can do instead is
give the exact fix command next to each row — that is the difference between
`doctor` and `fix`, and the latter is a separate decision, not a step here.

The exit code carries meaning: 0 = everything is fine, 1 = there is an
error. Warnings do not fail the build — otherwise `doctor` in CI would
become noise that everyone disables.

## Pre-flight reading

1. `scripts/cli.mjs` — `COMMANDS`, handling of `check` as a composite
   command (exit code = the worst of the guards); `doctor` has a similar
   shape.
2. `scripts/config.mjs` — `validateConfig()`; the source of most checks.
3. `scripts/stats-report.mjs` — the "arithmetic separate, formatting
   separate" split; `doctor` has to preserve it.
4. `.claude/skills/branchling-cli/references/output-style.md` §5–§6 — the
   layout and anatomy of a message.

## Steps

1. `scripts/doctor.mjs` + an entry in `COMMANDS`. Checks are CALLED from
   existing modules, not rewritten.
2. Each row: a symbol (`✓` / `!` / `✗`), a plain-language sentence, and on a
   problem — a fix command to paste.
3. A closing "what's next" section, dependent on state: empty backlog →
   `worktrail new`; tasks exist, no views → `worktrail build`; everything
   ready → `worktrail` (viewer).
4. `--json` for CI: a list of checks with a status and an identifier, so
   they can be reacted to programmatically.
5. Exit code: 0 when there are no errors (warnings allowed), 1 when there is
   an error.
6. `doctor` also works WITHOUT a backlog — then its answer is "there is no
   backlog here, create one: `worktrail init --dir …`". This is the natural
   place for that hint.
7. Test `scripts/tests/doctor.test.mjs`: a fresh `init` passes; every
   breakage from the table above is detected (a positive control for every
   row — without it the test would be green on a healthy tree and prove
   nothing).

## Acceptance criteria

- [ ] `worktrail doctor` exists and is in `COMMANDS` and in the help.
- [ ] It checks every row in the table, calling existing modules.
- [ ] Every problem has a fix command in its message.
- [ ] It fixes nothing on its own.
- [ ] Exit code: 0 with no errors, 1 with an error; warnings do not fail it.
- [ ] `--json` parses and carries the identifiers of the checks.
- [ ] It works without a backlog and points to `init`.
- [ ] The test has a positive control for every check.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the onboarding audit; collects
  pitfalls from TL-56, TL-59, TL-60, TL-61
- 2026-08-31 in_progress — agent:claude — start of implementation
- 2026-08-31 done — agent:claude — `scripts/doctor.mjs` + an entry in
  `COMMANDS`. Checks CALLED, not rewritten: configuration via `loadConfig`,
  prefix via `detectPrefixMismatch`, guards via spawning `cli.mjs check`,
  counts via `summarize`. Rows: config, vocabulary, prefix, git-ignore,
  git-tracked, git-merge, guards, volume. Exit codes 0/1, warnings do not
  fail it. `--json` with row identifiers. Without a backlog it answers with
  `init --dir`, not an exception. Test `doctor.test.mjs`, 14 assertions, a
  positive control for EVERY row; power checked by disabling two rows —
  exactly their two tests fail. 302/302.
- 2026-08-31 done — agent:claude — two extractions, so that "checks are
  called" would be true, not a declaration: `git-rules.mjs` (pure READS
  about git; `doctor` has nothing it could accidentally write to, because
  writing stayed in `init-backlog.mjs`) and `task-io.mjs` (`readTaskMetas`
  shared by `stats` and `doctor` — two filters would give "65 tasks" and
  "64 tasks", both true). `task-io.mjs` is a separate file because both
  neighborhoods are deliberately closed: `stats.mjs` is explicitly
  disk-free, and the SOURCE `task-fields.mjs` is injected into the viewer
  page, so `import "node:fs"` would break the browser.
- 2026-08-31 done — agent:claude — the "vocabularies vs. tree" row is
  implemented by `auditVocabulary()` in `task-fields.mjs` (`board`
  deliberately skipped — it has its own guard and its own message, and two
  voices about the same file read like two problems). The function is ready
  to be wired into `check` by TL-56; this task does NOT wire it in, because
  the direction of the fix (`types` in config vs. the tree) is the owner's
  decision. Side effect, intentional: `worktrail doctor` in THIS repository
  shows red and points exactly at TL-56.
- 2026-08-31 done — agent:claude — the "hooks installed or not" row
  DELIBERATELY SKIPPED: there is no hook installer yet (TL-46), and
  guessing the installation format would give a row that is wrong in both
  directions. To be added together with TL-46.
