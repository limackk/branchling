---
id: TL-69
title: "After a vocabulary change, the template smuggles in a value outside it"
type: bug
labels: [pre-launch]
board: main
epic: "Data integrity"
priority: P2
status: pending
owner: unassigned
estimate: 2h
confidence: high
created: 2026-08-31
updated: 2026-08-31
blocked_by: []
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "node --test scripts/tests/template-vocabulary.test.mjs"
  - bash: "d=$(mktemp -d); T=/Users/limack/workspace/tasklog/bin/worktrail.mjs; node $T init --dir \"$d\" --no-example >/dev/null; sed -i '' 's/^statuses: .*/statuses: [todo, doing, shipped]/; s/^archived_statuses: .*/archived_statuses: [shipped]/; s/^dashboard_open_statuses: .*/dashboard_open_statuses: [todo, doing]/' \"$d/config.yaml\"; node $T new --dir \"$d\" --title Test >/dev/null 2>&1 && { echo 'saved a task with a status outside the vocabulary'; exit 1; }; echo 'write stopped or corrected — OK'"
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

- [ ] `worktrail new` with no flags does not write a value outside the vocabularies.
- [ ] The message points at `_template.md` as the place to fix.
- [ ] On an unchanged configuration, `new` works with no changes.
- [ ] Frontmatter assessment uses the same measurement as `doctor`.
- [ ] The chosen variant is justified in `## Log`.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — found while working on TL-50, checking whether the new template smuggled in anything. The defect predates that change: the template always carried fixed values, nobody had checked what happens after the vocabularies change.
</content>
