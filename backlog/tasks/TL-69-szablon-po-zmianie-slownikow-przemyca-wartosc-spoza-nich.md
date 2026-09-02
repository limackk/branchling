---
id: TL-69
title: "After a vocabulary change, the template smuggles in a value outside it"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P2
status: done
owner: agent:claude
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-09-02
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - id: suite
    bash: "node --test scripts/tests/template-vocabulary.test.mjs"
  - id: measured
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; sed -i '' 's/^statuses: .*/statuses: [todo, doing, shipped]/; s/^archived_statuses: .*/archived_statuses: [shipped]/; s/^dashboard_open_statuses: .*/dashboard_open_statuses: [todo, doing]/; s/^in_progress_status: .*/in_progress_status: doing/; s/^reason_required_statuses: .*/reason_required_statuses: [shipped]/' \"$d/config.yaml\"; node scripts/cli.mjs new --dir \"$d\" --title Test >/dev/null 2>&1 && { echo 'saved a task with a status outside the vocabulary'; exit 1; }; test $(ls \"$d/tasks\" | wc -l | tr -d ' ') -eq 0 && echo 'the write was stopped, and nothing was left behind — OK'"
  - id: template-named
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; sed -i '' 's/^priorities: .*/priorities: [urgent, ordinary, someday]/' \"$d/config.yaml\"; node scripts/cli.mjs new --dir \"$d\" --title Test 2>&1 | grep -q '_template.md' && echo 'the refusal names the file to fix — OK'"
  - id: unchanged
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; node scripts/cli.mjs new --dir \"$d\" --title Test >/dev/null && test $(ls \"$d/tasks\" | wc -l | tr -d ' ') -eq 1 && echo 'an untouched configuration still writes — OK'"
---

## Goal

Do not let `worktrail new` write a task with a value outside the vocabulary
just because that value sits in the template.

## Context

Measured on 2026-08-31 on a fresh backlog, after adjusting statuses to one's
own process — that is, after the most common onboarding step:

```
$ sed -i 's/^statuses: .*/statuses: [todo, doing, shipped]/' config.yaml
$ worktrail new --title "Proba"
worktrail new: …/tasks/TASK-1-proba.md      # not a word of protest
$ grep '^status:' tasks/TASK-1-proba.md
status: pending                            # the value `pending` is not in the vocabulary
```

`new-task.mjs` validates the values it receives THROUGH FLAGS (`--status`,
`--priority`, `--type`, `--owner`) — and does so correctly. What it does not
validate is values that enter the file FROM THE TEMPLATE, and the template is
a copy of the default vocabularies from the moment of `worktrail init`, and
drifts from the configuration once it changes.

The effect is perverse: the command refuses to write when you explicitly pass
`--status pending`, but writes exactly the same thing when you pass nothing at
all.

`worktrail doctor` catches this AFTER the fact (the "vocabularies vs. tree"
row), so the state is not invisible — it is only detected one step too late,
by someone who has by then created a dozen tasks.

Fix variants, to be decided in this task:

| | For | Against |
|---|---|---|
| validate the frontmatter AFTER assembling it from the template | catches every value, not just flags | the refusal concerns a file the user did not write — the message has to point at the template, not at the command |
| substitute the FIRST value from the vocabulary, when the template's is outside it | a task can always be created | silently changes someone else's content; and "first status" does not always mean "new" |
| warn and write anyway | nothing is blocked | a warning on every `new` stops being read |

My recommendation is the first variant, with a message stating outright that
it is `_template.md` that has drifted from `config.yaml` — because that is the
real cause, and the fix is one-off rather than repeated on every task.

## Pre-flight reading

1. `scripts/new-task.mjs` — the `checks` array (flag validation) and `createTask()`.
2. `scripts/task-fields.mjs` — `buildFieldSpecs`, `auditVocabulary`; the latter already knows how to assess a finished frontmatter.
3. `scripts/doctor.mjs` — the "vocabularies vs. tree" row; the same measurement, only after the fact.

## Steps

1. Decide the variant and record the reason in `## Log`.
2. After assembling the content from the template, and BEFORE writing, assess
   the frontmatter with the same measurement `doctor` uses — one measurement,
   not a second set of rules.
3. The message must name the field, the value, the vocabulary and the
   **template file** as the place to fix; otherwise the user will look for the
   error in their own command.
4. `worktrail init` could, in passing, warn when the template in a directory
   has drifted from the configuration — but that is a conclusion to consider,
   not a requirement.
5. Test: after a vocabulary change, `new` with no flags does not write a value
   outside it; positive control — on an unchanged configuration, `new` still
   works.

## Acceptance criteria

- [x] `worktrail new` with no flags does not write a value outside the vocabularies. [proof: measured]
- [x] The message points at `_template.md` as the place to fix. [proof: template-named]
- [x] On an unchanged configuration, `new` works with no changes. [proof: unchanged]
- [x] Frontmatter assessment uses the same measurement as `doctor`. [proof: suite]
- [x] The chosen variant is justified in `## Log`. [proof: suite]

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — found while working on TL-50, checking whether the new template smuggled in anything. The defect predates that change: the template always carried fixed values, nobody had checked what happens after the vocabularies change.
- 2026-09-02 in_progress — agent:claude — variant 1 chosen: validate the ASSEMBLED
  frontmatter before the write and REFUSE. Substituting the first value from the
  vocabulary was rejected because it edits somebody else's content silently and
  "the first status" does not always mean "new". Warning and writing anyway was
  rejected because the warning would fire on every single `new`, and a warning
  that always fires stops being read within a day. Refusal is also the only one
  of the three whose fix is ONE-OFF — one line in one file — rather than a
  decision remade per task. Two consequences were followed rather than worked
  around: `init`'s example task passed a literal `priority: P2` into whatever
  vocabulary it found, which is the same defect one layer up, so it now offers
  its values and lets the template supply what the vocabulary does not hold;
  and three test fixtures replaced `statuses:` while leaving `init`'s default
  template in place, which means they had been silently exercising the defect —
  they now correct the template the way the refusal tells a user to.
- 2026-09-02 in_progress — agent:claude — step 4 (init warning about a drifted
  template) deliberately NOT done as a separate mechanism: `init` now reports it
  where it actually bites, in the line that would have created the example, and
  `doctor` already carries a vocabulary-vs-tree row. A third voice saying the
  same thing would be a third place to be wrong.
</content>
