# worktrail

**A queue your agents draw from, and a tool that does not take their word for
it.** Tasks are markdown files in your repository. What makes this different
from every other file-based backlog is what sits on top of them:

- **A queue.** `worktrail next` chooses a task and reserves it in the same
  act, so two sessions asking at the same moment get two different tasks. It
  answers with that one task, so asking "what now" costs your agent the same
  whether the backlog holds forty tasks or four hundred — listing them does
  not.
- **A contract.** `worktrail done` RUNS the task's `verification:` commands
  and refuses to close it if they fail. There is no `--force`. A checkbox
  ticked by whoever did the work carries no information when that whoever is
  an agent.
- **A ledger.** Every change records who made it, through what, and why —
  and the statuses you list in `reason_required_statuses` cannot be entered
  without a stated reason at all.

```bash
worktrail run --agent "claude -p @{task_file}" --max-attempts 2
```

That is the loop: `next` → your agent → `done`, until the queue is empty.
worktrail never starts an agent and never will — `--agent` is *your* command
template, run through *your* shell. A task that fails its contract twice is
parked with the reason, never closed: a run that could not verify a task may
not say it is done. Add `--agent-for <role>=<command>` and one queue feeds
several different hands, with the roles nobody has a command for left waiting
rather than handed out.

Everything that aggregates tasks — the index, the "what now" view, the
archive, the browser page — is **computed** from the files and is not
committed.

Requirements: Node 18+. Zero npm dependencies.

---

## Why files instead of a tracker

Because the state of a task should travel with the branch and go through review
together with the code it describes. That is the whole difference; everything
else follows from it.

| | External tracker | GitHub Issues | **worktrail** |
|---|---|---|---|
| State follows the branch, and `git revert` takes it back | ✗ | ✗ | ✓ |
| A task is readable with no login and no network | ✗ | ✗ | ✓ |
| Bulk edits are `sed` plus `git rebase` | ✗ | ✗ | ✓ |
| Links to files and commits are clickable in the editor | ✗ | ✗ | ✓ |
| An AI agent edits a task with the same tools it edits code | ✗ | partly | ✓ |
| The diff of a task shows up in code review | ✗ | ✗ | ✓ |

There is exactly one cost, and it is not hidden: only people with a clone of the
repository can see the backlog. If yours is read by anyone outside the
development team, this is the wrong tool — and it is better to know that now
than after a migration.

---

## Getting it

The package is not published to the npm registry yet, so the entry point is a
clone.

```bash
git clone <repository-url> ~/tools/worktrail
cd ~/tools/worktrail
npm link                          # puts the `worktrail` binary on your PATH
worktrail --version
```

Two routes that write nothing to your global `node_modules`, if you prefer:
an `alias worktrail="$HOME/tools/worktrail/bin/worktrail.mjs"` in `~/.zshrc`
(not `~/.zprofile` — zsh reads that one only for login shells), or
`npx --yes ~/tools/worktrail`, which leaves nothing behind at all.

---

## The first five minutes

**1. Create a backlog.** `--dir` is mandatory here: `init` is the only command
that creates new files, so a guessed directory would scatter them through
somebody else's tree.

```bash
worktrail init --dir ./backlog
```

It creates `tasks/`, `archive/`, `history/`, `boards/`, `config.yaml`,
`boards.yaml`, `_template.md`, `.gitignore` and `.gitattributes`, plus one
example task you are free to delete. It never overwrites an existing file, and
it prints whatever it skipped.

From here on every command finds that directory by itself, as long as you run it
inside the repository — see [Where the data lives](#where-the-data-lives).

**2. Create a task.** The tool assigns the number, not you.

```bash
worktrail new --title "Write a README for a new user" --priority P1 --estimate 2h
```

It prints the path of the file it wrote, the board it chose and why.

**3. Write the task.** Open the file and fill in the goal, the context and
`verification:`. The measure is simple: **can somebody who was not
part of the conversation this task came out of carry it out without asking?**
The shape of the fields is described in [The task file](#the-task-file).

**4. Rebuild the views** — after every frontmatter change.

```bash
worktrail build
```

**5. Ask, instead of reading everything.** `query` reads `tasks/*.md` rather
than the generated views, so it sees a status change before the next rebuild.

```console
$ worktrail query --status pending --priority P0,P1
- {id: TASK-2, priority: P1, status: pending, board: main, title: "Write a README for a new user"}
```

Filters combine with AND between axes and OR inside one; `worktrail query
--help` lists them. **A misspelled flag fails** with exit code 2 — zero results
caused by `--prioriti` reads exactly like the answer "there are no such tasks",
and it is not that answer.

**6. Open the viewer.** `worktrail` with no arguments serves it on
`127.0.0.1:4321` and opens your browser. `Ctrl-C` stops it.

---

## The task file

A task is markdown: YAML frontmatter for machines, prose for people.

```yaml
---
id: TASK-2                  # prefix from config.yaml, number from `worktrail new`
title: ""                   # imperative, short
board: main                 # the backlog PARTITION, a CLOSED vocabulary (boards.yaml)
priority: P1
status: pending
owner: unassigned           # who holds it NOW
role: ""                    # WHO MAY take it (a value from `roles:`); empty = anybody
executor: ""                # human | agent — WHICH SPECIES may be HANDED it
estimate: 2h
blocked_by: []              # ids that MUST be closed before this one starts
verification:               # HOW to check the task is actually done
  - id: the-name
    bash: "command to run"
---
```

`worktrail new` copies `_template.md`, which ships with the package and
carries the rest — `type`, `labels`, `epic`, `confidence`, `created`,
`updated`, `blocks`, `related_docs` — each annotated in place.


The body sections are `## Goal` (what will be true once it is done),
`## Context` (what the next person has to know before starting — they were not
in the conversation this task came out of), `## Pre-flight reading` (files to
read first, each with a reason), `## Steps`, and `## Acceptance criteria`, each
one naming the `verification:` entry that proves it:

```markdown
- [ ] Verifiable, not subjective. [proof: the-name]
```

The tool ticks those boxes after a green run, so a box you tick by hand is a
claim rather than evidence.

**The reason for a change is not one of these sections.** It travels with the
write, as the `reason` field of the record in `history/` — which is why
`worktrail done` asks for nothing and the statuses in
`reason_required_statuses` refuse to be entered without one. The template
ships with the headings above; the tool does not require any particular set of
them.

**`board` versus `epic`** are two different questions, so they have two
different rules: `board` is a CLOSED vocabulary from `boards.yaml`, exactly one
per task, and a typo fails the build; `epic` is free text, optional, and a typo
costs one extra group in the index. `boards.yaml` accepts `paths:` rules, so a
new task's board can be computed rather than guessed — `worktrail board <file>`
prints the slug and which rule decided.

---

## A queue, not just a readable list

Taking a task is a command, because two sessions can want the same one.

```bash
worktrail take TASK-42 --actor agent:claude   # "do TASK-42", with a reservation
worktrail next --actor agent:claude --json    # "what should I do", answered and claimed
```

Both do the same thing to the task — reserve it, set it to the status your
project calls *in progress*, set `owner:`, record the change in the history and
print the whole task file, so whoever runs it has what the task was written to
say. `next` only adds the choice: the highest-priority task whose `blocked_by`
is closed, filtered by the same axes `query` uses. Because that choice and the
reservation are one act, six sessions asking at once get six different tasks,
and the backlog empties itself with no dispatcher process, no server and no
orchestrator:

```bash
while task=$(worktrail next --actor agent:claude --json); do
  # … work on "$task", then: worktrail done <ID>
done   # exits 3 — nothing left to take
```

`0` took a task · `3` nothing to take · `1` refused (held by somebody else,
closed, not yours) · `2` a bad invocation. An empty queue is not an error, and
it does not look like one.

**That loop, with the accounting, is `worktrail run`.** The command is a
template of yours: `{task_file}` and `{id}` are substituted, and the task —
plus, from the second attempt, what `done` refused — arrives on stdin.

```bash
worktrail run --agent "claude -p @{task_file}" --max-attempts 2
worktrail run --dry-run          # the order it would work in; claims nothing
```

**One queue, several hands.** A task may ask for a competence in `role:`, and
`--agent-for <role>=<command>` is repeatable, with `--agent` serving the tasks
that ask for nobody in particular. A role you gave no command for is *not*
handed out and *not* failed over — it waits for a hand this deployment does
not have, usually a person, and the report counts those tasks by role. That is
the whole escalation mechanism: an absent entry, not a workflow engine.

`executor: human` on a task keeps the dispatcher off it entirely — the product
decision an analyst-agent could phrase but must not settle — while
`take <ID>` still works, because a person naming a task is themselves the
human decision the field asks for.

**Where the guarantee ends, said plainly.** The reservation excludes sessions
running at the same moment in every worktree of one clone, and `next` also
reads every branch and worktree of that clone (local refs only, never a
`git fetch`), naming the branch it defers to rather than skipping silently:

```
$ worktrail query --status in_progress
- {id: TASK-42, priority: P1, status: pending, board: main,
   elsewhere: [feature/x: in_progress], title: "…"}
```

Both statuses stand and the branch is named; picking one would be the
one-checkout answer again, only harder to notice. **The boundary is the
clone:** two clones connected only by git can still both take one task and
find out when they merge. That is a property of git, not something this hides.

The whole pattern — one task per session, the exit codes, the hooks, dead
sessions, and the statuses never handed out unattended — is a guide the tool
prints, and [the manual](docs/manual.md#the-dispatcher-in-full) carries the
rest:

```bash
worktrail instructions autonomous-loop
```

---

## Where the data lives

The backlog directory is **an argument, not a property of where the code sits**.
Every command resolves it the same way, in this order:

| # | Source | Notes |
|---|---|---|
| 1 | `--dir <path>` | pointing at something that is not a backlog is an ERROR |
| 2 | `BACKLOG_DIR` | same |
| 3 | walking up from the current directory | needs `tasks/` **plus** one of `config.yaml` / `boards.yaml` / `_template.md` |
| 4 | the directory above the code (co-location) | last resort; it is what lets a backlog sit next to the scripts |

`--dir` works on every command, so one checkout of the tool drives any number
of backlogs: `worktrail query --dir ~/other-project/backlog --status blocked`.

---

## Commands

**`worktrail --help` lists the commands, and `worktrail <command> --help`
prints one command's flags.** There is no table of them here on purpose: a
copy of a list the tool generates is wrong the moment a command is added, and
wrong in the way that is hardest to notice — still specific, still confident,
no longer true.

**An unknown command and an unknown flag both FAIL.** A silent no-op looks like
the tool working, which makes it worse than an error — especially when it has a
side effect.

**You extend this by composition, not through a plugin API.** Every reading
command takes `--json` and answers in a versioned envelope; every writing
command can be called from a script. `next-id` and `board` also keep printing
their one value alone on the first line, so they drop straight into
substitution.

```bash
worktrail query --status blocked --files | xargs $EDITOR
worktrail stats --json | jq '.stats.byStatus.blocked'
worktrail doctor --json | jq -e '.ok'          # a gate in CI
worktrail done TASK-42 --json | jq '.entries[] | select(.ok | not)'
```

The envelope's promises — which keys are guaranteed, what may be reworded, and
what requires a new `schemaVersion` — are in
[the manual](docs/manual.md#the---json-contract).

---

## What does not belong in a backlog

- **Fixes shorter than half an hour** — just do them and commit.
- **`TODO` comments in code** — leave them inline, the editor will surface them.
- **Ideas and notes** — those are not tasks. They belong in a document.
- **Standing operations** (a weekly deploy, running tests) — that is cron or CI.

A task is **discrete, one-off, verifiable work with a concrete outcome**.

**If `verification:` is empty, the task is not ready to be closed.**

It is the single line of defence against "everything is done" turning out not to
be done. If you cannot write down how to check the outcome, the task is badly
formed — fix it before you start. `worktrail done` enforces this rather than
asking for it: a task with no contract is refused, and the message says so in
different words from a verification that ran and failed.

---

## Working with an AI agent

Every task is **self-contained**: the agent reads one file and knows everything,
because the context, the files to read first and the way to verify the result are
all in it rather than in somebody's head.

The protocol around the task — when to open one at all, how to claim it, what to
do before closing it — is printed by the tool:

```bash
worktrail instructions overview
```

`overview` is a switchboard; it sends the reader to `task-creation`,
`task-execution` or `task-finalization`, whichever applies. The text is rendered
with **your** backlog's vocabulary, read from your `config.yaml`, so it never
teaches somebody else's statuses.

It is a command rather than a file on purpose. A guide copied into a repository
freezes on the day it was copied and goes on teaching flags that no longer
exist; a command ships with the tool and cannot drift from it. `worktrail init`
writes one short pointer to that command into `CLAUDE.md` or `AGENTS.md`.

**For editors that load skills**, the same pointer ships as one:

```bash
worktrail skills install     # or `worktrail init --skills` while creating a backlog
```

It writes `.claude/skills/backlog-workflow/SKILL.md` into your repository and
**never overwrites** — the file may be your own edit of it. The skill itself
holds no procedure and no vocabulary; it exists so that an editor loading skills
by description knows a backlog is here and knows to run `worktrail instructions
overview`, which is rendered with *your* `config.yaml`. A skill that listed
statuses would be a second truth about them, wrong the moment you renamed one.

---

## What it records about you

If you wire up the activity hook, the tool measures **how long work took** — and
that measurement is a record of what hour a particular person worked, day after
day. It is worth being exact about it rather than reassuring.

**What is collected.** One row per tool invocation, at most one a minute per
task (`heartbeat_throttle_seconds`): a timestamp, the task, the kind of
evidence, the actor, the session, and which rule decided the task. No file
contents, no commands, no diffs, no keystrokes.

**Where it lives.** `backlog/activity/<ID>.jsonl`, and it is **gitignored by
default** — `activity_privacy: local`. Only the per-task aggregate in
`backlog/activity/rollup/` is committed: minutes, sessions, first, last, and the
share of minutes nothing could attribute. At that resolution it is a fact about
a task rather than about a person, and it is the whole input to estimate
calibration.

**For how long.** `activity_retention_days`, 90 by default. `worktrail activity
prune` deletes raw rows past the window and keeps the aggregate — recomputing it
from the full log *before* deleting anything, so the window does not eat the
history it exists to make safe to keep. It also runs when the viewer starts: a
retention window somebody has to remember to apply is not a retention window.

**How to get rid of it.**

```bash
worktrail activity report --privacy              # what is kept, whose, for how long
worktrail activity forget --actor you --dry-run  # what would go. There is no undo
worktrail activity forget --actor you
```

`forget` deletes the raw rows **and recomputes the aggregates without them**,
because an aggregate left standing over deleted rows is the data coming back at
the next report.

**How to correct it.** An attribution can be wrong, and the log is append-only,
so the fix is a new row rather than an edit:

```bash
worktrail activity reassign --from TASK-1 --to TASK-2 --session <s> [--since <ts>]
```

**What this is not.** It is a set of mechanisms — minimisation, retention,
erasure, correction — and **not a compliance claim**. The legal basis, informing
the people being measured, and any assessment stay with whoever deploys it.
`forget --actor` also acts on a *claim*: nothing here authenticates an actor,
which is the same single-machine boundary the reservation has.

**If you want none of it**, wire no hook. Nothing is recorded unless something
calls `worktrail activity record`, and the tool never installs that for you.

---

## Documentation

**[The manual](docs/manual.md)** is the reference: statuses, configuration,
`plan.yaml`, seeding, the dispatcher in full, guards, the viewer and the
`--json` contract. The documents below record decisions and the measurements
behind them.

- [`docs/worktrail-global-tool.md`](docs/worktrail-global-tool.md) — the tool
  outside a single repository; §3 is the four rules everything else follows from.
- [`docs/backlog-config-and-portability.md`](docs/backlog-config-and-portability.md)
  — the shape/values boundary, and the full list of config keys.
- [`docs/backlog-field-editing-history.md`](docs/backlog-field-editing-history.md)
  — the limits of what the history can be trusted to say.
- [`docs/backlog-time-tracking.md`](docs/backlog-time-tracking.md) — estimates
  and time.
- [`docs/worktrail-state-and-sync.md`](docs/worktrail-state-and-sync.md) — the
  log as the source of truth about state.
- [`docs/license-and-contributions.md`](docs/license-and-contributions.md) — the
  licence, the DCO, and the open/hosted line. Read before opening a pull
  request.
- [`LINEAGE.md`](LINEAGE.md) — where this came from, and why the git history
  starts at a single commit.

The tool tracks itself with itself: its own backlog is in `backlog/`, and the
suite is `node --test scripts/tests/*.test.mjs`.

---

## Contributing

The code is MIT, and a contribution goes out under MIT. Sign your commits off —
`git commit -s`, a [DCO](https://developercertificate.org/) line, no CLA and no
paperwork.

Before writing anything large, read
[`docs/license-and-contributions.md`](docs/license-and-contributions.md) §3. The
tool is deliberately a single-machine one: everything that serves one person in
one clone is open and stays open, and coordination between people and clones is
out of its scope. A patch can be good and still fall on the wrong side of that
line, which is why the line is written down instead of discovered at review.
