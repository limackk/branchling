# worktrail

A backlog that lives in markdown files and is driven from the terminal. One task
is one file with YAML frontmatter; everything that aggregates them — the index,
the "what now" view, the archive, the browser page — is **computed** from those
files and is not committed.

Requirements: Node 18+. Zero npm dependencies.

```bash
worktrail init --dir ./backlog     # a new backlog
worktrail new --title "…"          # a new task
worktrail query --status blocked   # ask a question instead of reading everything
worktrail                          # the viewer, in your browser
```

> **This file is written in English on purpose.** The repository's own
> documentation and its task files are Polish; `worktrail` is a tool meant to be
> installed into other people's repositories, so everything a user of the tool
> reads is English. The boundary is the directory, not the topic.

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

Two equivalent routes that write nothing to your global `node_modules`:

```bash
alias worktrail="$HOME/tools/worktrail/bin/worktrail.mjs"   # one line in ~/.zshrc
npx --yes ~/tools/worktrail --version                   # nothing persistent at all
```

Put the alias in `~/.zshrc`, not `~/.zprofile`: zsh reads `.zprofile` only for
login shells and `.zshrc` for every interactive one — including your editor's
terminal and tmux panes.

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
$ worktrail query
- {id: TASK-2, priority: P1, status: pending, board: main, title: "Write a README for a new user"}
- {id: TASK-1, priority: P2, status: pending, board: main, title: "Adjust the vocabularies in config.yaml"}

$ worktrail query --status pending --priority P0,P1 --count
1
```

Filters: `--status --priority --board --label --epic --owner --type
--blocked-by --text`. AND between axes, OR inside one axis using commas. Without
`--status` it asks about active tasks only. Output formats: one line per task
(the default), `--json` (in the [envelope](#the---json-contract)), `--files`
(feed it to `xargs`), `--count`.

**A misspelled flag fails** with exit code 2. Zero results caused by
`--prioriti` reads exactly like the answer "there are no such tasks", and it is
not that answer.

**6. Open the viewer.**

```bash
worktrail
```

The server starts on `127.0.0.1:4321` (next port up if that one is taken) and
opens your browser for you. `Ctrl-C` stops it. Details: [Viewer](#viewer).

---

## The task file

A task is markdown: YAML frontmatter for machines, prose for people. The
template ships with the package (`_template.md`) and `worktrail new` copies it for
you; the block below is that same shape, annotated.

```yaml
---
id: TASK-2                  # prefix from config.yaml, number from `worktrail new`
title: ""                   # imperative, short (limit set in config.yaml)
type: task
labels: []                  # your project's vocabulary; empty until you define it
board: main                 # the backlog PARTITION, a CLOSED vocabulary (boards.yaml)
epic: ""                    # free text — the group this task counts towards
priority: P1
status: pending
owner: unassigned
estimate: 2h
confidence: medium          # how much you trust the estimate
created: 2026-08-31
updated: 2026-08-31         # set to today on every status change
blocked_by: []              # ids of tasks that MUST be closed before this one starts
blocks: []                  # ids this task will unblock
related_docs: []            # paths relative to the repository root
verification:               # HOW to check the task is actually done
  - bash: "command to run"
  - manual: "what to click, what to see"
---
```

The body sections: the goal (what will be true once it is done), the context
(what the next person has to know before starting — they were not in the
conversation this task came out of), pre-flight reading (files to read first,
each with a reason), the steps, acceptance criteria (verifiable, not
subjective), and an append-only log of the form
`YYYY-MM-DD status — who — note`.

The template ships with those headings; the tool does not require any particular
set of them.

**`board` versus `epic`** — two different questions, and therefore two different
rules:

| | `board` | `epic` |
|---|---|---|
| the question | which context are we working in | what are we delivering |
| vocabulary | **closed** (`boards.yaml`) | open, free text |
| per task | exactly 1 | 0 or 1 |
| a typo | **fails the build** | passes |

The asymmetry is deliberate. A misspelled epic costs one extra group in the
index; a misspelled board slug pushes the task out of both views anybody
actually opens. `boards.yaml` accepts `paths:` rules, so the board of a new task
can be computed instead of guessed:

```bash
worktrail board backlog/tasks/TASK-2-write-a-readme-for-a-new-user.md
```

It prints the slug on the first line and, underneath, which rule decided — or
that no rule matched and the default was used, in which case the decision is
yours and belongs in the task's log.

---

## Statuses

```
   pending ──► in_progress ──► done
                  │   ▲
                  ▼   │
               blocked ┘

   cancelled — deliberately dropped, with a note saying why
```

Those are the **defaults** written by `worktrail init`, not a contract of the
tool: the list of statuses, their order (which is the sort order of the views)
and which of them fall out into the archive are all stated by your project's
`config.yaml`.

There is no "focus" field. `NOW.yaml` is derived from status and priority —
`in_progress` (started), `blocked` (waiting), `pending` P0 (critical,
untouched). You shape it by working, not by declaring: you start a task, you put
it down, you close it, and it leaves on its own.

**You do not mark a task done — you close it with `worktrail done <ID>`, and the
command runs its `verification:` first.** Every entry is printed before it runs
and executed from the repository root; the first failure ends the run, exits
non-zero and leaves the task file untouched. A green run sets the status, ticks
the acceptance criteria its entries prove, appends a line to `## Log` and
rebuilds the views.

```bash
worktrail done TASK-42 --dry-run    # run the whole contract, change nothing
worktrail done TASK-42              # close it, if and only if it passes
```

Three things it deliberately does:

- **An empty `verification:` does not close a task.** Neither does the template
  placeholder. A gate that passes on no contract is green with nothing behind it.
- **A `manual:` entry — the one thing no command can check — asks a person, and
  records who vouched.** The prompt names what is *not* evidence: the code being
  present, a grep finding the string, the intention of the implementation, or "I
  checked". That enumeration is the useful part; "verify it properly" is advice
  nobody has ever acted on.
- **Nothing else ever runs `verification:`.** Not `build`, not `check`, not the
  server, not the editor hook. A task arriving in a pull request carries a shell
  command, and it runs only when a person deliberately closes that task.

**The limit, stated rather than left to be discovered.** A task file is a text
file and anybody can set `status: done` in an editor. This gate raises the *cost*
of a lie — it does not make one impossible, and there is no `--force` flag,
because hand-editing is already the bypass and it at least leaves a diff a
reviewer can see.

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
is closed, filtered by the same `--board` / `--label` / `--priority` / `--epic`
that `query` uses.

**The point is that the choice and the reservation are one act.** Six sessions
asking at the same moment get six different tasks. Run one per worktree and the
backlog empties itself, with no dispatcher process, no server and no
orchestrator:

```bash
while task=$(worktrail next --actor agent:claude --json); do
  # … work on "$task", then: worktrail done <ID>
done   # exits 3 — nothing left to take
```

`0` took a task · `3` nothing to take · `1` refused (held by somebody else,
closed, not yours) · `2` a bad invocation. An empty queue is not an error, and
it does not look like one.

**That loop, with the accounting, is `worktrail run`.** It takes a task, hands it
to a command of yours, and closes it through the same gate you would — until the
queue is empty. The tool is still not an agent and will not become one: the
command is a template, `{task_file}` and `{id}` are substituted, and the task —
plus, from the second attempt, what `done` refused — arrives on stdin.

```bash
worktrail run --agent "claude -p @{task_file}" --max-attempts 2
worktrail run --dry-run          # the order it would work in; claims nothing
```

**One queue, several hands.** A task may ask for a competence in `role:`, and a
run can serve more than one of them: `--agent-for <role>=<command>`, repeatable,
with `--agent` serving the tasks that ask for nobody in particular. A role you
gave no command for is *not* handed out and *not* failed over to the general
one — it waits for a hand this deployment does not have, which is usually a
person, and the report counts those tasks by role and names them. That is the
whole escalation mechanism: an absent entry, not a workflow engine. A role your
`config.yaml` does not declare fails before the loop starts. `next --role r`
asks the same question by hand and hands out that role *or* the tasks with none;
`--role-strict` narrows it to exactly that role.

```bash
worktrail run --agent "codex exec" \
  --agent-for docs="claude -p @{task_file}" \
  --agent-for analyst="…"      # omit it, and analyst tasks wait for you
```

A task whose contract keeps failing is not retried forever and is never closed:
after `--max-attempts` it is moved to the open status your
`reason_required_statuses` protects, **with the reason** — so the board after a
run says where it stopped and why. Agent output goes to one log file per task
outside the repository, and the report names the path. The process ends with the
queue; nothing is scheduled and there is no daemon.

**Where the guarantee ends, said plainly.** Two mechanisms, and they stop in
different places. The reservation is a lockfile in your user state directory,
keyed by the repository, so it excludes sessions running *at the same moment* in
every worktree of it on this machine. It cannot see a decision that was already
written down and committed, because data travels with the branch: a task started
on `feature/x` is still untouched in `main`'s copy of the file. That second case
is what the branch and worktree scan answers, so `next` will not hand out a task
that **every branch and worktree of one clone** — local refs only, never a
`git fetch` — reports in a status it does not hand out, and it names the branch
or the tree it is deferring to instead of skipping it silently. Set
`cross_branch_state: false` and the dispatcher goes back to reading this checkout
alone.

The boundary is therefore the *clone*: two clones connected only by git can
still both take one task and will find out when they merge; that is a property
of git, not something this hides. Merge finished work promptly and the window
closes. A session that dies leaves its lock behind, and the next caller takes it
over after `lock_ttl_minutes` and says whose it was.

Two statuses are never handed out unattended: the one that means *in progress*
(somebody has it) and any status your `reason_required_statuses` protects —
`blocked` was entered by a decision, and an agent must not undo it silently.
`--status` overrides that, because a person asking for exactly that is not
unattended.

**With one exception, and it is the reason the protection can stay strict.** A
task in a protected status that NAMED its condition — a non-empty `blocked_by`
— is handed out once every task it named is closed. The decision has not been
overruled, it has been discharged, by the very tasks it pointed at; the history
entry says which ones. A protected task with an *empty* `blocked_by` is waiting
on something outside the tree that nothing here can observe arriving, and stays
where it is.

**A dead session's claim, and why it is not reclaimed by default.** The lock
frees itself; the claim in the tree — `status: in_progress` and `owner:` — does
not, and that is deliberate: the evidence for "abandoned" is `updated:`, which
has a day's resolution and moves when a *command* runs, not while somebody
thinks. Set `abandoned_after_days` and `next` will hand such a claim out again
— after every untouched task, never before one, and never quietly: the takeover
names the previous owner both on stdout and in the history entry's reason. A
held lock still wins, because a running session is better evidence than a date.
Left at `0`, the default, a claim waits for a person.

The whole pattern — one task per session, the exit codes, the hooks, and where
the guarantee stops — is a guide the tool prints:

```bash
worktrail instructions autonomous-loop
```

**A task started on another branch is not free.** Data travels with the branch,
so a task moved to *in progress* on `feature/x` is still `pending` in what
`main` holds — and a listing computed from one checkout would offer it as work
nobody has. `query`, `stats` and the viewer therefore also read the task from
every active local branch and every other worktree:

```
$ worktrail query --status in_progress
- {id: TASK-42, priority: P1, status: pending, board: main,
   elsewhere: [feature/x: in_progress], title: "…"}
```

**Both statuses stand and the branch is named — nothing is resolved silently.**
Picking one value here would be the one-checkout answer again, only harder to
notice. The scan reads LOCAL refs: no `git fetch`, ever, so it works with no
network. `active_branch_days` (30) bounds how far back a branch counts as
active, a branch checked out in a worktree is always read whatever its age, and
`cross_branch_state: false` turns the whole thing off. Outside a git repository
the command still answers, and says the state is from this tree alone.

---

## Seeding a backlog from a plan

`worktrail seed` reads a structured plan on **standard input** and turns it into
a backlog — a task file per item, dependencies wired up, numbers allocated by the
tool. A `--dir` that is not a backlog yet is created first, exactly as `init`
would.

```bash
worktrail seed --dir ./backlog --actor agent:claude < plan.json
worktrail seed --dir ./backlog --dry-run < plan.json   # what would be created
```

**No model is involved.** Turning prose into a plan is somebody else's program —
which is why the input is a format and not a prompt, and why anybody's adapter
can write to it:

```bash
my-planner spec.md | worktrail seed --dir ./backlog --json
```

```json
{
  "planVersion": 1,
  "meta": { "produced_by": "my-planner 0.3" },
  "tasks": [
    {
      "plan_id": "skeleton",
      "title": "Set up the project skeleton",
      "goal": "A runnable package with a test command.",
      "context": "Nothing exists yet; the CLI below depends on this.",
      "steps": ["npm init", "add a test script"],
      "verification": [
        { "id": "tests-run", "bash": "npm test", "proves": "The test command exits 0." }
      ],
      "priority": "P1",
      "estimate": "1h"
    },
    {
      "plan_id": "cli",
      "title": "Add the command line entry point",
      "goal": "The tool can be run from a shell.",
      "blocked_by": ["skeleton"],
      "verification": ["node bin/cli.mjs --help"]
    }
  ]
}
```

| Field | | What it is |
|---|---|---|
| `plan_id` | required | this item's **local** key, `[a-z0-9_-]`. Never a task id |
| `title` | required | unique within the plan |
| `goal` | required | why the task exists and what is true once it is done |
| `context` | optional | what the next person needs before their first edit |
| `steps` | optional | array of strings |
| `blocked_by` | optional | `plan_id` values from **this** plan; a cycle fails |
| `verification` | required | non-empty; a command string, or `{ "id", "bash" \| "manual", "proves" }` |
| `estimate` | optional | free text, e.g. `"2h"` |
| `priority` | optional | a value from *your* `config.yaml` |

`proves` becomes the acceptance criterion that points back at the entry, so a
seeded task already has the criterion→proof link `check --criteria` asks for. An
entry with no `proves` still gets one — the criterion is then the check passing,
which is thin but true.

**Three rules make the difference between a plan and a wish list.**

- **A task with no runnable verification fails the whole plan.** Not that one
  item — everything. That field is what lets a task be worked unattended, and a
  half-seeded backlog looks finished while being unfinishable. The template's own
  placeholder counts as missing.
- **Everything is judged before anything is written, and every complaint is
  printed at once.** Unknown keys, duplicate titles, dependencies on items that
  are not in the plan, cycles. An adapter retrying with a model needs the whole
  list, not the first line.
- **The numbers belong to the tool.** A plan refers to its own items by
  `plan_id`; `seed` maps those onto the ids it allocates across every branch and
  worktree. A number free in your tree is not free in somebody else's.

`--json` answers in the usual envelope with `created` — the `plan_id` → task id
mapping your plan cannot compute for itself — or with `errors` in full.

---

## Configuration: the code knows the SHAPE, the config knows the VALUES

`scripts/` knows which fields a task has and how they are written. Which
STATUSES, PRIORITIES, LABELS or TYPES exist in your project is stated by
`backlog/config.yaml` and nowhere else. That is what lets the same code serve a
backlog with a completely different process, and it is why no project's
vocabulary has to live inside the tool.

`worktrail init` writes that file with a comment on every key, including the
**cost of changing it** (`free` / `tree` / `migration`). Here is a made-up
project — a bicycle shop whose process has two extra statuses and a closed set
of labels:

```yaml
project_name: "Bike shop"

statuses: [pending, on_queue, in_progress, review, blocked, done, cancelled]
archived_statuses: [done, cancelled]
dashboard_open_statuses: [pending, on_queue, in_progress, review, blocked]

priorities: [P0, P1, P2, P3]
types: [task, bug]

labels: [storefront, warehouse, service, seasonal]
labels_closed: true            # a typo becomes a build error, not a new label

owners: [unassigned, ann, mark]
estimates: [30m, 2h, 1d, 1w]
title_max_length: 60
```

```yaml
# backlog/boards.yaml
default: main
boards:
  - slug: main
    name: "Main"
    description: "Everything that ships the product."
  - slug: infra
    name: "Infrastructure"
    description: "Servers, backups, monitoring."
    paths: ["deploy/**", "docker/**"]
```

**An unknown key FAILS**, exactly like an unknown flag in `query` — a typo in a
vocabulary is indistinguishable from "that is how this project does it". So does
an inconsistency: an archived status that is not in `statuses`, a board
`default:` that is not in the list, a duplicated slug. The full list of keys:
[`docs/backlog-config-and-portability.md`](docs/backlog-config-and-portability.md).

### The task id prefix

`TASK`, `PROJ`, `SHOP` — that is a **project value**, not a fact about the tool,
so it lives in `config.yaml`:

```yaml
task_id_prefix: TASK
```

- **No key means the prefix is read from the tree.** A backlog created before
  this setting existed keeps working with no edit. An explicit setting always
  wins; the tree gets a vote only when the key is absent.
- **A mismatch fails BEFORE anything is written.** `TASK-*.md` files under a
  config that says `PROJ` do not produce an "empty backlog" — they produce an
  error. Without that, `build` would rewrite the views as empty **on real data**
  and print a checkmark: data loss reported as success.
- **Changing the prefix is a command, not a one-line edit:**

```bash
worktrail migrate-prefix --to PROJ --dry-run   # the plan: what becomes what
worktrail migrate-prefix --to PROJ             # filenames, ids, blocked_by/blocks,
                                             # history logs and config.yaml
```

The migration **does not touch references inside task prose**, and it tells you
how many it left alone. A number in prose may point at a task in another
repository, and a bulk replace would silently repoint it. On an empty backlog
the change is free: fix the line in `config.yaml` and you are done.

---

## The execution order (`plan.yaml`)

Which task comes first is a **decision**, not something the tree can recompute —
so it is data: one optional file, `plan.yaml`, versioned next to the tasks and
reviewed with them.

```yaml
updated: 2026-09-01
rationale: "the parser first, both of its consumers after"
waves:
  - name: "Foundation"
    tasks: [TASK-17]
  - name: "Consumers"
    tasks: [TASK-18, TASK-19]
    together: [[TASK-18, TASK-19]]   # one branch, one shared shape
```

It is **not** a board (a board partitions by context and is a closed
vocabulary), and it is **not** a field in the frontmatter — reshuffling the order
would then rewrite every task file at once and conflict with every open branch.
One file, one diff.

The plan is **advisory**: `status:` stays the only truth about what has happened,
and nothing here blocks a task. The single hard rule is that the order must be
executable, which `worktrail check --plan` decides:

| Situation | Verdict |
|---|---|
| a task stands before a task its `blocked_by` names | **error** — the order cannot be executed |
| a task shares a wave with its blocker | warning — fine if that wave is a sequence |
| an open blocker the plan never schedules | **error** |
| a `together` group spanning two waves | **error** — a group is done in one wave |
| the same id in two waves | **error** |
| a `done`/`cancelled` task in the plan | fine — a plan keeps its history |
| **no `plan.yaml` at all** | fine — ordering is optional, and the guard says so |

The guard runs inside the plain `worktrail check` as well.

**Where the order has got to** is computed, not written down — `worktrail plan`
measures the file against `tasks/*.md`:

```
$ worktrail plan
    wave 1  Foundation  0 open  1 closed
  → wave 2  Consumers   2 open  0 closed  active

next up (wave 2 — Consumers):
  together: TASK-18, TASK-19
```

Five definitions, and `--json` returns all of them for an agent that would
otherwise assemble the graph out of every task file: the **active wave** is the
first one holding an open task; **next up** are its open tasks whose every
`blocked_by` is closed, with a `together` group counted as one entry and ready
only when all of it is; **in progress** is every plan task in flight, in any
wave; **unplanned** are the open tasks the plan does not schedule — listed by id,
because that is how a plan rots; **stale** are plan tasks already closed in a
later wave, the sign that the order wants reshuffling.

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

`--dir` works on every command:

```bash
worktrail query --dir ~/other-project/backlog --status blocked
worktrail build --dir ~/other-project/backlog
```

---

## What is computed may be deleted

`tasks/*.md` is the **only** source of truth. Everything else is derived from it
and is listed in the `.gitignore` that `worktrail init` writes:

| File | What it holds | When to read it |
|---|---|---|
| `NOW.yaml` | `in_progress` + `blocked` + `pending P0`, derived from status | "what are we doing right now" |
| `INDEX.yaml` | every active task, **one line each**, grouped by epic | picking the next piece of work |
| `archive/done.yaml` | closed tasks, minimal entries | grep: "was X already done?" |
| `boards/<slug>/*` | the same, narrowed to one board | working inside one context |
| `viewer.html` | the browser page | `worktrail` / `worktrail viewer` |

**The views are not committed, and the reason is measured rather than
aesthetic.** `INDEX.yaml` and `archive/done.yaml` are sorted aggregates of
*every* task, so every branch rewrites the same file — two branches that share
**no task at all** still conflict. The consequence you have to know about: a
fresh clone and a new worktree have no views until a generator runs. `worktrail
build` recreates them, and starting the viewer does it for you. `worktrail query`
does not need them at all.

**The index points, it does not describe.** A row carries only what you choose
work by: `id`, `priority`, `status`, `board`, `labels`, `blocked_by`, `title`.
The rest of the frontmatter stays in the task file, because that file is the
source of truth. A full mirror of the frontmatter would be a second copy of the
data to keep in agreement, and you would pay for its size on every read. Measure
your own: `wc -c backlog/INDEX.yaml`.

---

## Guards

```bash
worktrail check     # every guard; exit code = the worst of them
worktrail doctor    # is this backlog set up correctly at all
```

`check` answers four questions, and each has its own selector
(`--id-collisions`, `--boards`, `--refs`, `--language`):

- **One number, one task.** Collisions do not come from carelessness, they come
  from parallelism: each worktree computes "highest + 1" from *its own* view of
  `tasks/`, so two branches hand the same number to different work. Nothing is
  broken in either tree on its own — the defect exists only in the union, which
  means it appears at merge time. Hence `worktrail next-id`, which computes from
  the **union of all branches and worktrees** (`--explain` says where the
  maximum came from), and hence `worktrail new`, which calls it for you.
- **Boards come from the registry.** A slug that is not in `boards.yaml` stops
  the build.
- **`blocked_by` / `blocks` point at tasks that exist.** Dangling references are
  produced by deleting or moving a task, so they appear on every backlog split
  and every migration between repositories. Two things this guard distinguishes
  on purpose: a reference to a `done` task is CORRECT — that is how a dependency
  normally ends, not a loss — while a dependency on another repository is
  REJECTED, because the tool has no way to check whether that one is finished,
  so the field would stop answering "can I start this?". Record that kind of
  dependency in prose, in the task's log.
- **The tool's own public surface is English.** Everything a user of the tool
  reads — CLI messages, `--help`, the comments in `scripts/`, the viewer chrome,
  `README.md` and `_template.md`. Two signals, because a grep for accented
  letters alone passes over every word that has no accent. This guard judges the
  installed CODE rather than your data, so it ignores `--dir`: what language your
  own backlog is written in is your business. A deliberate exception is marked in
  the source, one line at a time.

A clean result reports **how many things it checked**. A checkmark over zero
means "there was nothing to check", not "I checked and it is fine".

`doctor` reads the configuration, compares it against the tree, checks the git
rules and runs the guards. It reports, per check, one of pass / fail / not
applicable, and for anything failing it prints the fix. It takes `--json`;
`check` speaks through its exit code, because that is how a git hook reads it.

---

## Viewer

```bash
worktrail                       # server, plus an open tab
worktrail serve --port 4400     # a different port
worktrail serve --no-open       # do not open a window
worktrail viewer                # just rebuild viewer.html, no server
```

The server listens **on 127.0.0.1 only**, validates every field it writes with
the same schema the CLI uses, and resolves a task file by listing the directory
rather than by concatenating a path out of input. Starting it while it is
already running only opens a tab; an `/api/ping` probe checks the identity of
the process, so a stranger's service on that port is not mistaken for ours.

**What the server adds over opening `viewer.html` from disk:** editing fields
(click a value in the detail panel — status, priority, owner, epic, labels,
dependencies), writes that go straight into the `.md` with the views regenerated
automatically, changes pushed from disk over SSE (a task edited by an agent or by
`git checkout` appears without a reload), and support for every browser. Under
`file://` the fields are read-only: a second write path would mean a second set
of validation rules.

**A board is a scope, not a filter.** The `Board:` bar switches the scope of the
whole viewer — the lists, the counters in the header AND the dashboard. A filter
would narrow only the cards, and the dashboard would go on computing throughput
across both boards underneath the heading of one.

**A set of tasks can be sent as a link.** Every filter, the search phrase, the
sort order, the scope and the selected task all live in the hash, so the address
bar always shows what you are looking at:

```
viewer.html#tasks?board=main&status=blocked&status=in_progress&q=sync&sort=id_desc&id=TASK-2
```

A repeated key is another value (`status=blocked&status=done`), not a
comma-separated list — an epic name containing a comma would fall apart into two
filters. A parameter that is absent from the link means "the default", not
"keep whatever you had": otherwise a recipient with their own filters would get
a different set and the link would have lied.

**The dashboard** (the second tab, its state also fully in the URL) shows
throughput, the queue, the distribution across epics and a burndown of the range
you pick.

**Field history** is a separate, committed file — `history/<ID>.jsonl`,
append-only, one line per field change:

```json
{"id":"01M174H5H6T1622A7KGR4ZR3W9","ts":"2026-08-29T13:17:10.970Z",
 "task":"TASK-2","field":"status","from":"pending","to":"in_progress",
 "actor":"local:me","source":"viewer"}
```

`actor` has a **mandatory namespace**: `local:<nick>` (declared on somebody's
machine, unverified), `agent:<name>` (an automated write), `user:<id>` (an
authenticated account), `unknown` (the only value without a namespace). The
namespace says how much the attribution is worth, and `source` says which route
it arrived by. The code does not guess it: a bare name is rejected loudly rather
than quietly promoted to an identity. **`unknown` means `unknown`** — the server
sees a changed byte, not a hand. This is the journal of a local tool, not an
audit log.

Changes made outside the viewer while the server was down are recorded by you:

```bash
worktrail history --actor local:me --source manual
```

The first run against a tree with no reference point only establishes that point
and **writes no entries at all** — history from before the mechanism existed is
not invented.

---

## Commands

`worktrail --help` is the source of truth; the same list, with an example each:

| Command | What it does | Example |
|---|---|---|
| `serve` *(default)* | the viewer on 127.0.0.1 | `worktrail` |
| `query` | ask about tasks — reads `tasks/*.md` | `worktrail query --status blocked --priority P0,P1` |
| `build` | rebuild the views from `tasks/*.md` | `worktrail build` |
| `viewer` | rebuild `viewer.html` without a server | `worktrail viewer` |
| `take` | claim ONE named task — reserve it and print it | `worktrail take TASK-42 --actor agent:claude` |
| `next` | take the closest executable task | `worktrail next --actor agent:claude --json` |
| `handoff` | pass a task to another role, with the reason | `worktrail handoff TASK-42 --to-role analyst --reason "…"` |
| `new` | a task from the template, numbered across branches | `worktrail new --title "…" --priority P1` |
| `init` | a new backlog in an empty directory | `worktrail init --dir ./backlog` |
| `seed` | a whole backlog from a plan on stdin | `worktrail seed --dir ./backlog < plan.json` |
| `instructions` | the workflow, printed by the tool | `worktrail instructions overview` |
| `next-id` | the next free number | `worktrail next-id --explain` |
| `board` | which board a task belongs to | `worktrail board backlog/tasks/TASK-2-….md --json` |
| `stats` | the state of the backlog, in the terminal | `worktrail stats --json` |
| `plan` | where the execution order has got to | `worktrail plan --json` |
| `doctor` | is the backlog set up correctly | `worktrail doctor` |
| `done` | close a task by RUNNING its verification | `worktrail done TASK-42 --dry-run` |
| `check` | the backlog guards | `worktrail check --refs` |
| `migrate-prefix` | renumber onto a different id prefix | `worktrail migrate-prefix --to PROJ --dry-run` |
| `history` | record changes made without the server | `worktrail history --actor local:me --source manual` |
| `regen-hook` | entry point for an editor hook (stdin: JSON) | — |

`worktrail <command> --help` prints that command's flags. `--dir <path>` works
everywhere.

**An unknown command and an unknown flag both FAIL.** A silent no-op looks like
the tool working, which makes it worse than an error — especially when it has a
side effect.

**You extend this by composition, not through a plugin API.** Every reading
command takes `--json`; `next-id` and `board` also keep printing their one value
alone on the first line, so they still drop straight into substitution.

```bash
worktrail query --status blocked --files | xargs $EDITOR
worktrail stats --json | jq '.stats.byStatus.blocked'
worktrail query --json | jq -r '.tasks[] | select(.blocked_by | length > 0) | .id'
worktrail doctor --json | jq -e '.ok'          # a gate in CI
worktrail done TASK-42 --json | jq '.entries[] | select(.ok | not)'
```

### The `--json` contract

`--json` is the extension surface, so its shape is a promise rather than an
implementation detail. Every reading command answers in the same envelope:

```json
{ "schemaVersion": 1, "kind": "task-list", "tasks": [ … ], "total": 12, "limit": null }
```

| Command | `kind` | Payload |
|---|---|---|
| `query` | `task-list` | `tasks`, `total` (matches BEFORE `--limit`), `limit` |
| `stats` | `stats` | `root`, `stats` (the tallies) |
| `doctor` | `doctor` | `ok`, `root`, `next`, `checks` |
| `board` | `board` | `board`, `rule`, `matched`, `isDefault`, `reason` |
| `next-id` | `next-id` | `nextId`, `id`, `prefix`, `max`, `source`, `trees`, `branches`, `known` |
| `instructions` | `instructions` | `topics`, `topic`, `text`, `version` |
| `plan` | `plan` | `root`, `exists`, `updated`, `rationale`, `waves`, `activeWave`, `nextUp`, `inProgress`, `unplanned`, `stale`, `inProgressStatus` |
| `seed` | `seed` | `ok`, `root`, `dryRun`, `created`, `errors` |

**What is promised.**

- `schemaVersion` and `kind` are always present, and `kind` says which keys follow.
- A key of that kind is always present. **An absent scalar is `null`, an absent
  collection is `[]` — never a missing key.** A consumer must not have to tell
  "no value" from "an older version of the tool".
- **Adding** a key is backwards compatible and does not change the version.
  Removing, renaming, or redefining one requires a new `schemaVersion`.

**What is not.** The contents of a task record follow the vocabulary in *your*
`config.yaml`, so statuses, labels and boards are your values, not ours. Text
written for a person — `reason`, `next`, a check's `detail` — may be reworded;
read `kind`, `ok` and `id` instead of matching on prose.

`take`, `next`, `handoff` and `done` still answer with a bare object; the first
three predate the envelope and `handoff` joins them so the four writing commands
agree today — they move together in a separate change. `seed` was written after
the envelope and uses it.

---

## What does not belong in a backlog

- **Fixes shorter than half an hour** — just do them and commit.
- **`TODO` comments in code** — leave them inline, the editor will surface them.
- **Ideas and notes** — those are not tasks. They belong in a document.
- **Standing operations** (a weekly deploy, running tests) — that is cron or CI.

A task is **discrete, one-off, verifiable work with a concrete outcome**.

---

## The first rule

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
freezes on the day it was copied and goes on teaching flags that no longer exist;
a command ships with the tool and cannot drift from it. `worktrail init` writes
one short pointer to that command into `CLAUDE.md` or `AGENTS.md` — a versioned
block it can later refresh in place with `worktrail instructions --update-nudge`,
leaving everything else in the file untouched. `--no-nudge` opts out.

---

## Documentation

These documents are the reasoning behind the design. They are part of this
repository rather than the published package.

- [`docs/worktrail-global-tool.md`](docs/worktrail-global-tool.md) — the tool
  outside a single repository; §3 is the four rules everything else follows from.
- [`docs/backlog-config-and-portability.md`](docs/backlog-config-and-portability.md)
  — the shape/values boundary, and the full list of config keys.
- [`docs/backlog-field-editing-history.md`](docs/backlog-field-editing-history.md)
  — field editing and history: the limits of what it can be trusted to say.
- [`docs/backlog-time-tracking.md`](docs/backlog-time-tracking.md) — estimates
  and time.
- [`docs/worktrail-state-and-sync.md`](docs/worktrail-state-and-sync.md) — the
  target model: the log as the source of truth about state.
- [`docs/license-and-contributions.md`](docs/license-and-contributions.md) — the
  licence, the DCO, and where the line between the open tool and a hosted
  service runs. Read this before opening a pull request.
- [`LINEAGE.md`](LINEAGE.md) — where this came from, and why the git history
  starts at a single commit.

The tool tracks itself with itself: its own backlog is in `backlog/`.

```bash
node --test scripts/tests/*.test.mjs
```

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
