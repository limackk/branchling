---
id: TL-67
title: "Import from GitHub Issues — one-off, from stdin, with dry-run"
type: task
labels: [post-launch]
board: main
epic: "Onboarding"
priority: P2
status: pending
owner: unassigned
estimate: 1w
confidence: medium
created: 2026-08-31
updated: 2026-09-01
blocked_by: []
blocks: []
related_docs:
  - docs/worktrail-state-and-sync.md
  - docs/worktrail-global-tool.md
  - .claude/skills/worktrail-cli/SKILL.md
verification:
  - bash: "node --test scripts/tests/import-github.test.mjs"
  - bash: "cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir $(mktemp -d) --dry-run | grep -q 'nothing was written' && echo 'dry-run does not write — OK'"
  - bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir \"$d\" >/dev/null; cat scripts/tests/fixtures/gh-issues.json | node scripts/cli.mjs import --from github --dir \"$d\" >/dev/null; test $(ls \"$d/tasks\" | wc -l | tr -d ' ') -eq 3 && echo 'the second import does not duplicate — OK'"
  - bash: "node scripts/cli.mjs check --dir <directory-after-import>"
---

## Goal

Give a team that has its tasks in GitHub Issues **a one-off path to bring them
here** — without turning the tool into a client of someone else's API and
without disarming the rules it stands on.

## Context

Owner decision 2026-08-31 ([TL-65](TL-65-rozstrzygnij-import-z-istniejacego-trackera-zadan.md)):
the importer is to be built, but built solidly and not now. This task is the
record of what "solidly" needs to settle — so that whoever picks it up in six
months does not draw the same conclusions from scratch.

**Audience.** A team that already exists somewhere. All the work so far on
onboarding lowers the friction of SETTING UP a new backlog; this is the one
item that answers "I have two hundred tasks, how do I bring them here". That is
the difference between "nice, I'll get to it" and adoption.

**Why GitHub Issues as the first and only source for this task.** `gh issue
list --json` gives clean JSON with no authentication configuration on our
side, and it is the tracker where the developers who will be the first to like
the tool already sit. Jira needs tokens, an instance address, and mapping of
its own types — that is a separate task, for when a team that uses it shows
up. **Do not build an "importer" in the plural**: an adapter for two systems
at once starts from an abstraction nobody needs yet.

### Six decisions this task has to make

**1. The tool DOES NOT TOUCH THE NETWORK. Ever.** Import reads JSON from
STDIN:

```bash
gh issue list --state all --limit 500 --json number,title,body,state,labels,assignees,url \
  | worktrail import --from github --dry-run
```

This is not convenience, it is three things at once: zero dependencies stays
zero, authentication stays inside `gh` (we never touch anyone else's tokens),
and a test can hand it a fixture instead of faking a network. An importer that
calls the API itself is untestable without a mock server and breaks with every
change to someone else's API.

**2. ONE-OFF, not synchronous.** Synchronization is a second source of truth,
i.e. state divorced from the branch — the defect external trackers were
rejected for in the first place (Law 1). Import copies and forgets. If a need
for synchronization ever arises, that is a different document and a different
decision:
[`docs/worktrail-state-and-sync.md`](../../docs/worktrail-state-and-sync.md) §6.

**3. `verification` stays EMPTY — and import says so loudly.** No tracker has
this field. It is tempting to insert a placeholder so tasks "look complete" —
and that is exactly the decision that disarms the one line of defense against
"done" that is not done. Import has to say outright, at the end:

```
✓ imported 214 tasks
! 214 of them have no `verification` — they cannot be closed until you write it
  → worktrail query --status pending --json | …
```

The count of incomplete tasks is a RESULT of the import, not a side effect of it.

**4. Fields with no equivalent: import carries the TASK, not the archive.**
The issue's body goes into the file's body. Comments, attachments and status
history do NOT — that is the conversation around the task, not the task
itself; carrying them over turns the task into a dump of someone else's
format. Access to them is preserved through a link to the source, so nothing
is lost for good.

**5. Identity and re-import.** The number is LOCAL and takes the same path as
`worktrail new` — `createTask()` from `new-task.mjs` (scan of all branches,
exclusive `wx` write). `GH-412` does not become `ACME-412`: numbers are unique
within the project, and pretending someone else's number is ours lies at the
first collision.

What remains is where to store the pointer to the source, because idempotency
depends on it (a second import of the same set MUST NOT duplicate):

| Variant | For | Against |
|---|---|---|
| link in `## Notes` | zero schema change | searching by content instead of by field |
| new `source:` field | a first-class field, visible in the viewer and in `query` | changes `FIELD_SHAPES`, the viewer and history — the schema is cheap TODAY, irreversible after the first outside user |

Decide this deliberately and record the reason in `## Log`. If the field
variant is chosen — do it as a separate task BEFORE this one, because a schema
change is not an implementation detail of import.

**6. Vocabulary mapping is an ARGUMENT TO IMPORT, not a key in `config.yaml`.**
GitHub's labels and statuses need not have equivalents. It is tempting to add
`import_label_map:` to the configuration — and that would break Law 3: layers
are DISJOINT, and `config.yaml` knows the PROJECT's vocabulary, not the
instructions for a one-off operation. Mapping travels as a flag or a file
given by a flag, lives as long as the import, and does not stay in the
repository as a dead key.

A value outside the vocabulary has to FAIL before the write, not slip in
quietly — otherwise import introduces exactly the drift between configuration
and tree that
[TL-56](TL-56-slownik-types-w-config-yaml-rozjechal-sie-z-drzewem.md) is
meant to close.

## Pre-flight reading

1. `docs/worktrail-state-and-sync.md` §6 — the boundary between modes; why import is not synchronization.
2. `docs/worktrail-global-tool.md` §3 — Laws 1, 3 and 4; all three are violable here.
3. `scripts/new-task.mjs` — `createTask()`; import MUST go through this path, not its own.
4. `scripts/migrate-prefix.mjs` — the `--dry-run` pattern for a command that changes many files at once.
5. `scripts/task-fields.mjs` — `FIELD_SHAPES`, if the `source:` field variant is chosen.
6. `.claude/skills/worktrail-cli/SKILL.md` — the command's contract: flag validation, `--dir`, exit codes.

## Steps

1. `scripts/import-github.mjs` + an entry in `COMMANDS`. Input: JSON on stdin. No network.
2. `--dry-run` MANDATORY in the first version and the default in the documentation: a command that writes hundreds of files must first show what it will do. It prints a plan (how many tasks, which mappings, how many without `verification`) and ends with "nothing was written".
3. State mapping: `open` → first status from the configuration, `closed` → first from `archived_statuses`. No hardcoded `pending`/`done` — those are project values.
4. Labels: mapping from a flag; an unknown label fails when `labels_closed`, and otherwise is admitted only if it is in the vocabulary.
5. Write through `createTask()`, with `body` composed of the issue's content and a `## Notes` section with a link to the source.
6. Idempotency: a second run on the same input creates not a single file. The decision from context point 5 decides how this is recognized.
7. Final report: how many were imported, how many skipped as already existing, how many without `verification`.
8. Fixture `scripts/tests/fixtures/gh-issues.json` — three issues: open, closed, with a label outside the vocabulary. Test with no network.
9. README: a "bringing your team over" section, with one command and an honest sentence about what import does NOT bring over.

## Acceptance criteria

- [ ] `worktrail import --from github` reads JSON from stdin and makes not a single network request.
- [ ] `--dry-run` writes nothing and says so outright.
- [ ] Statuses and labels mapped from CONFIGURATION and flags, never from literals in the code.
- [ ] A value outside a closed vocabulary fails BEFORE anything is written.
- [ ] `verification` stays empty, and the count of such tasks is in the report.
- [ ] Numbers are local, from `createTask()`; no rewriting of GitHub's numbers.
- [ ] A repeated import of the same input does not duplicate a single task.
- [ ] `worktrail check` passes on the directory after the import.
- [ ] The test runs with no network, on a fixture.
- [ ] The decision about the pointer to the source is recorded in `## Log` with a reason.

## Notes

Deliberately OUT of scope, so it does not come back as "while we're at it":
two-way synchronization, import from Jira, import of comments and
attachments, mapping GitHub users to `owners` (actor namespaces are a separate
matter, see `docs/backlog-field-editing-history.md`).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 created — agent:claude — from the decision in TL-65: the importer is to be built, solidly, not now. The task carries the six decisions so that "solidly" does not mean "work it out again from scratch".
2026-09-01 pending — agent:claude — raised P3→P2 from a competitive analysis — importing from Issues is a way to try the tool with no cost of migration; nobody abandons their existing tracker on day one.
</content>
