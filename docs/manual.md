# branchling — the manual

**This is a reference for using the tool, not a design document.** The other
files in `docs/` record a decision, the measurement behind it, and what would
refute it; this one tells you what the flags do. If the two ever disagree,
the tool's own `--help` wins over both.

The [README](../README.md) is the front door: what this is, how to install it,
and the first five minutes. Everything here is what you reach for afterwards.

**Nothing in this file lists the commands.** `branchling --help` does that, and
`branchling <command> --help` prints one command's flags. A copy of a list the
tool generates is wrong the moment a command is added, in the way that is
hardest to notice — still specific, still confident, no longer true.

## Contents

- [The closed engineering loop](#the-closed-engineering-loop)
- [Statuses](#statuses)
- [Configuration: the code knows the SHAPE, the config knows the VALUES](#configuration-the-code-knows-the-shape-the-config-knows-the-values)
- [The execution order (`plan.yaml`)](#the-execution-order-planyaml)
- [Seeding a backlog from a plan](#seeding-a-backlog-from-a-plan)
- [The dispatcher in full](#the-dispatcher-in-full)
- [Guards](#guards)
- [Viewer](#viewer)
- [What is computed may be deleted](#what-is-computed-may-be-deleted)
- [The `--json` contract](#the---json-contract)

---

## The closed engineering loop

branchling supplies the durable control plane around an agent or a person; it
does not supply the intelligence that edits the code. The stages compose, but
their boundaries stay explicit:

| Stage | What branchling guarantees | What remains outside |
|---|---|---|
| Plan | Dependencies and waves are validated; `--plan` exposes only the active wave | Choosing the product direction |
| Claim | Selection and reservation are one atomic operation across the clone | Coordination between separate clones |
| Execute | `run` invokes the command the user supplied and routes declared roles only to commands that serve them | The provider, model, tools and prompt used by that command |
| Discover | The shipped workflow tells a session to create a separate, self-contained task for substantial work outside the current thesis | Deciding that a thought is substantial; branchling does not inspect an agent's reasoning |
| Verify | `done` executes the task contract and refuses an empty or failing one | Writing a contract that measures the intended outcome |
| Review | Task state, evidence and reasons travel through Git beside the code | Review, merge and remote synchronization remain Git operations |

The distinction matters when a context window ends or a provider changes. The
execution session may disappear; the ready work, decisions, rejected closure
and newly discovered tasks remain in the repository. A single agent uses the
same loop as a role-based run, without needing to learn the role machinery.

---


## Statuses

```
   pending ──► in_progress ──► done
                  │   ▲
                  ▼   │
               blocked ┘

   cancelled — deliberately dropped, with a note saying why
```

Those are the **defaults** written by `branchling init`, not a contract of the
tool: the list of statuses, their order (which is the sort order of the views)
and which of them fall out into the archive are all stated by your project's
`config.yaml`.

There is no "focus" field. `NOW.yaml` is derived from status and priority —
`in_progress` (started), `blocked` (waiting), `pending` P0 (critical,
untouched). You shape it by working, not by declaring: you start a task, you put
it down, you close it, and it leaves on its own.

**You do not mark a task done — you close it with `branchling done <ID>`, and the
command runs its `verification:` first.** Every entry is printed before it runs
and executed from the repository root; the first failure ends the run, exits
non-zero and leaves the task file untouched. A green run sets the status, ticks
the acceptance criteria its entries prove, records the field changes in the
task's append-only history and rebuilds the views.

```bash
branchling done TASK-42 --dry-run    # run the whole contract, change nothing
branchling done TASK-42              # close it, if and only if it passes
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

## Configuration: the code knows the SHAPE, the config knows the VALUES

`scripts/` knows which fields a task has and how they are written. Which
STATUSES, PRIORITIES, LABELS or TYPES exist in your project is stated by
`backlog/config.yaml` and nowhere else. That is what lets the same code serve a
backlog with a completely different process, and it is why no project's
vocabulary has to live inside the tool.

`branchling init` writes that file with a comment on every key, including the
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
[`docs/backlog-config-and-portability.md`](backlog-config-and-portability.md).

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
branchling migrate-prefix --to PROJ --dry-run   # the plan: what becomes what
branchling migrate-prefix --to PROJ             # filenames, ids, blocked_by/blocks,
                                             # history logs and config.yaml
```

The migration **does not touch references inside task prose**, and it tells you
how many it left alone. A number in prose may point at a task in another
repository, and a bulk replace would silently repoint it. On an empty backlog
the change is free: fix the line in `config.yaml` and you are done.

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
executable, which `branchling check --plan` decides:

| Situation | Verdict |
|---|---|
| a task stands before a task its `blocked_by` names | **error** — the order cannot be executed |
| a task shares a wave with its blocker | warning — fine if that wave is a sequence |
| an open blocker the plan never schedules | **error** |
| a `together` group spanning two waves | **error** — a group is done in one wave |
| the same id in two waves | **error** |
| a `done`/`cancelled` task in the plan | fine — a plan keeps its history |
| **no `plan.yaml` at all** | fine — ordering is optional, and the guard says so |

The guard runs inside the plain `branchling check` as well.

**Where the order has got to** is computed, not written down — `branchling plan`
measures the file against `tasks/*.md`:

```
$ branchling plan
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

**A wave that ends on a person says so.** A task carrying `executor: human` is
one no unattended run can take, so `next up` marks its row and the wave carries
`endsOnHuman` — otherwise a wave stalled waiting for somebody prints exactly
like a wave waiting for work, and the fleet's own account of what it could not
take disappears with the run. In `--json` every `nextUp` entry carries
`waitsOnHuman` beside `executors`, which is what a dispatcher decides on when it
asks whether to keep polling. Nothing is filtered, reordered or hidden by any of
it: `executor:` gates the dispatcher, and the plan reports the order somebody
decided.

```
next up (wave 2 — Consumers):
  TASK-18
  TASK-20  — asks for an executor an unattended run is not (human)
  this wave ends on a person — an unattended run cannot close it on its own
```

**Asking the dispatcher to follow it** is `--plan`, on `next` and on `run`. The
queue then holds only what the plan schedules, and only the earliest wave still
holding an open task; inside that wave the tasks are handed out IN THE ORDER THE
WAVE LISTS THEM, which outranks priority and id. A wave is an order, and the
sequence its author wrote is the only place they can say that one member reads
another's correction — `priority:` is a property of a task, not of its position.
Priority still ranks every queue the plan is not being followed for.
`run --plan --dry-run` prints the order under its wave names.

```
$ branchling run --plan --dry-run
  3 task(s) would run, in this order:
    wave 1 — Foundation
      · TASK-17  P3  …
    wave 2 — Consumers
      · TASK-18  P1  …
```

It is a **filter the caller asks for**, exactly like `--board` or `--role`, and
that is deliberate. Making it implicit would mean an unplanned task could never
be handed out while a plan existed — the plan would have become a truth about
state it was never meant to be. Without the flag nothing reads `plan.yaml`, and
the queue is ordered by priority. With the flag and no plan file the call
**fails**: a filter matching everything reads exactly like a plan that schedules
everything.

## Seeding a backlog from a plan

`branchling seed` reads a structured plan on **standard input** and turns it into
a backlog — a task file per item, dependencies wired up, numbers allocated by the
tool. A `--dir` that is not a backlog yet is created first, exactly as `init`
would.

```bash
branchling seed --dir ./backlog --actor agent:claude < plan.json
branchling seed --dir ./backlog --dry-run < plan.json   # what would be created
```

**No model is involved.** Turning prose into a plan is somebody else's program —
which is why the input is a format and not a prompt, and why anybody's adapter
can write to it:

```bash
my-planner spec.md | branchling seed --dir ./backlog --json
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

## The dispatcher in full

The [README](../README.md) shows the loop and where its guarantee ends.
This is the rest of it.

**Some decisions are not an agent's to make.** `executor: human` on a task says
so, whatever its role — the product decision an analyst-agent could phrase but
must not settle. It gates the DISPATCHER and nothing else: `next` and `run`
called by an `agent:` actor skip such tasks and count them by name ("N wait for
a person"), while `take <ID>` still works, because a person naming a task is
themselves the human decision the field asks for. `executor: agent` is the
mirror image, for work nobody should do by hand. The species of the caller is
read off the actor's namespace, so there is nothing to configure; the two values
are the shape of the field and are not in `config.yaml`, because a project that
could invent a third species would leave the dispatcher nothing to compare
against.

**Some tasks are too big for one unattended session.** `max_unattended_estimate`
in `config.yaml` names the largest estimate `next` and `run` may hand to an
`agent:` actor; without the key there is no gate at all. Above means LATER IN
`estimates`, which is an ordered list this project wrote — nothing is parsed
into hours, so a backlog measuring work in `small` and `large` is gated exactly
as well as one measuring it in `1d` and `1w`, and an estimate the list does not
contain has no position and is never gated. A threshold naming a word outside
`estimates` is refused, because it could gate nothing and would read as no gate
at all. Like `executor:`, it gates the DISPATCHER only: the skipped tasks are
counted and named (`skippedSize` in `next --json`, `waitingForSize` in `run
--json`), and `take <ID>` still works — naming a task is the deliberate decision
the threshold asks for.

**One queue, several hands.** A task may ask for a competence in `role:`, and a
run can serve more than one of them: `--agent-for <role>=<command>`, repeatable,
with `--agent` serving the tasks that ask for nobody in particular. A role you
gave no command for is *not* handed out and *not* failed over to the general
one — it waits for a hand this deployment does not have, which is usually a
person, and the report counts those tasks by role and names them. That is the
whole escalation mechanism: an absent entry, not a workflow engine. A role your
`config.yaml` does not declare fails before the loop starts. `next --role r`
asks the same question by hand and hands out that role *or* the tasks with none;
`--role-strict` narrows it to exactly that role. `--plan` on either command
restricts the queue to the wave `plan.yaml` is currently on — see [the execution
order](#the-execution-order-planyaml).

```bash
branchling run --agent "codex exec" \
  --agent-for docs="claude -p @{task_file}" \
  --agent-for analyst="…"      # omit it, and analyst tasks wait for you
```

A task whose contract keeps failing is not retried forever and is never closed:
after `--max-attempts` it is moved to the open status your
`reason_required_statuses` protects, **with the reason** — so the board after a
run says where it stopped and why. Agent output goes to one log file per task
outside the repository, and the report names the path. The process ends with the
queue; nothing is scheduled and there is no daemon.

**An agent that never *started* costs the task nothing.** "Did the agent fail"
and "did the agent run" are different questions, and only the first is a fact
about the task — an expired login is a fact about your machine, and parking a
task as `blocked` over it writes a lie that outlives the session. So an agent
that printed nothing on stdout and left the tree byte-for-byte as it found it
has not made an attempt: the task gets back the status it was taken from, the
run stops rather than handing the rest of the queue to a command that cannot
start, and the exit code is **1** — the command and what it said go to the
report and the log, never into the task file. Both signals are required, and
neither is a guess about exit codes, which every agent uses differently.

Two statuses are never handed out unattended: the one that means *in progress*
(somebody has it) and any status your `reason_required_statuses` protects —
`blocked` was entered by a decision, and an agent must not undo it silently.
`--status` overrides that, because a person asking for exactly that is not
unattended. `init` writes `reason_required_statuses: [blocked, cancelled]` into
the config it generates rather than leaving the key out: absent, it resolves to
`archived_statuses`, and then a brand-new backlog would dispatch `blocked` — the
very status `run` parks a task it could not finish in, which is a queue that
never empties.

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

## Guards

```bash
branchling check     # every guard; exit code = the worst of them
branchling doctor    # is this backlog set up correctly at all
```

`check` answers independent questions, each with its own selector. Run
`branchling check --help` for the current list:

- **One number, one task.** Collisions do not come from carelessness, they come
  from parallelism: each worktree computes "highest + 1" from *its own* view of
  `tasks/`, so two branches hand the same number to different work. Nothing is
  broken in either tree on its own — the defect exists only in the union, which
  means it appears at merge time. Hence `branchling next-id`, which computes from
  the **union of all branches and worktrees** (`--explain` says where the
  maximum came from), and hence `branchling new`, which calls it for you.
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
- **The tool's own public surface is English.** This is a contribution and
  review convention, not a `check` selector: a language-specific heuristic
  cannot establish that arbitrary prose is English.

A clean result reports **how many things it checked**. A checkmark over zero
means "there was nothing to check", not "I checked and it is fine".

`doctor` reads the configuration, compares it against the tree, checks the git
rules and runs the guards. It reports, per check, one of pass / fail / not
applicable, and for anything failing it prints the fix. It takes `--json`;
`check` speaks through its exit code, because that is how a git hook reads it.

## Viewer

```bash
branchling                       # server, plus an open tab
branchling serve --port 4400     # a different port
branchling serve --no-open       # do not open a window
branchling viewer                # just rebuild viewer.html, no server
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
branchling history --actor local:me --source manual
```

The first run against a tree with no reference point only establishes that point
and **writes no entries at all** — history from before the mechanism existed is
not invented.

## What is computed may be deleted

`tasks/*.md` is the **only** source of truth. Everything else is derived from it
and is listed in the `.gitignore` that `branchling init` writes:

| File | What it holds | When to read it |
|---|---|---|
| `NOW.yaml` | `in_progress` + `blocked` + `pending P0`, derived from status | "what are we doing right now" |
| `INDEX.yaml` | every active task, **one line each**, grouped by epic | picking the next piece of work |
| `archive/done.yaml` | closed tasks, minimal entries | grep: "was X already done?" |
| `boards/<slug>/*` | the same, narrowed to one board | working inside one context |
| `viewer.html` | the browser page | `branchling` / `branchling viewer` |

**The views are not committed, and the reason is measured rather than
aesthetic.** `INDEX.yaml` and `archive/done.yaml` are sorted aggregates of
*every* task, so every branch rewrites the same file — two branches that share
**no task at all** still conflict. The consequence you have to know about: a
fresh clone and a new worktree have no views until a generator runs. `branchling
build` recreates them, and starting the viewer does it for you. `branchling query`
does not need them at all.

**The index points, it does not describe.** A row carries only what you choose
work by: `id`, `priority`, `status`, `board`, `labels`, `blocked_by`, `title`.
The rest of the frontmatter stays in the task file, because that file is the
source of truth. A full mirror of the frontmatter would be a second copy of the
data to keep in agreement, and you would pay for its size on every read. Measure
your own: `wc -c backlog/INDEX.yaml`.

## The `--json` contract


`--json` is the extension surface, so its shape is a promise rather than an
implementation detail. Every reading command answers in the same envelope:

```json
{ "schemaVersion": 1, "kind": "task-list", "tasks": [ … ], "total": 12, "limit": null }
```

| Command | `kind` | Payload |
|---|---|---|
| `query` | `task-list` | `tasks`, `total` (matches BEFORE `--limit`), `limit`, `scan`, `modifiedFile`, `elsewhereOnly` (the tasks only another branch has) |
| `stats` | `stats` | `root`, `stats` (the tallies), `scan`, `divergent` (one row per task another branch disagrees with), `elsewhereOnly` (the tasks only another branch has), `context` (null unless `--context`: the measured cost rows) |
| `doctor` | `doctor` | `ok`, `root`, `next`, `checks` |
| `serve --list` | `serve-list` | `servers` (one row per registered viewer, each carrying its own state: running, stale — the entry outlived its process — or elsewhere, meaning another host wrote it and this one may not judge it), `stateDir`, `host` |
| `serve --stop` | `serve-stop` | `stopped` (one result per port asked about, each naming an outcome: stopped, already-gone, not-registered, not-ours, elsewhere or would-not-stop), `requested` |
| `check` | `check` | `ok`, `root`, `failed` (the guards that failed), `guards` |
| `board` | `board` | `board`, `rule`, `matched`, `isDefault`, `reason` |
| `next-id` | `next-id` | `nextId`, `id`, `prefix`, `max`, `source`, `trees`, `branches`, `known` |
| `instructions` | `instructions` | `topics`, `topic`, `role`, `text`, `version` |
| `profile list/show` | `agent-profiles` | `path`, `exists`, `profiles`, `profile` |
| `profile check` | `profile-check` | `ok`, `path`, `live`, `results` |
| `conformance` | `adapter-conformance` | `ok`, `version`, `adapter`, `results`, `failures` |
| `plan` | `plan` | `root`, `exists`, `updated`, `rationale`, `waves`, `activeWave`, `nextUp`, `inProgress`, `unplanned`, `coverage`, `stale`, `inProgressStatus` |
| `seed` | `seed` | `ok`, `root`, `dryRun`, `created`, `errors` |
| `import` | `import` | `ok`, `root`, `dryRun`, `created`, `skipped`, `droppedLabels`, `withoutVerification`, `errors` |
| `<command> --help` | `command-help` | `command`, `summary`, `usage`, `configured`, `flags` |
| `pr-summary` | `pr-summary` | `base`, `scanned`, `reason`, `tasks`, `engaged`, `cost` |
| `audit` | `audit` | `since`, `dayZero`, `tasks`, `findings`, `closedWithoutTrace`, `skippedBeforeSince`, `reopened`, `parked`, `withoutPremise`, `awaitingVouch`, `handedBack`, `vouches`, `advisories` |
| `run` | `run` | `ok`, `dryRun`, `agent`, `profile`, `agentFor`, `profileFor`, `delegation`, `allowUncontrolledDelegation`, `plan`, `order`, `considered`, `stoppedAt`, `stopped`, `agentNeverRan`, `waitingForRole`, `waitingForExecutor`, `waitingForSize`, `tally`, `sharedState`, `ms`, `tasks`, `skippedHandedBack` |
| `take`, `next` | `task-take` | `ok`, `taken`, `id`, `file`, `task`, `from`, `text`, `decisions`, `probe`, `warnings`, `reclaimed`, `tookOver`, `lock`, `refusalKind`, `refusal`, `details`, and — filled in by next — `passedOver`, `considered`, `searchedStatuses`, `skippedBlocked`, `skippedElsewhere`, `closedElsewhere`, `skippedExecutor`, `skippedHandedBack`, `skippedSize`, `skippedByRecord`, `scan`, `plan` |
| `handoff` | `task-handoff` | `ok`, `id`, `file`, `task`, `role`, `owner`, `status` (each a from/to pair), `comment`, `released`, `warnings`, `refusalKind`, `refusal`, `details` |
| `release` | `task-release` | `ok`, `id`, `status`, `owner`, `released`, `comment`, `refusalKind`, `refusal`, `details` |
| `ask` | `task-ask` | `ok`, `id`, `file`, `question` (its event id, timestamp, text and asker), `changes`, `blockedReason`, `refusalKind`, `refusal`, `details` |
| `done` | `verification-run` | `ok`, `task`, `dryRun`, `closed`, `entries` (one per `verification:` entry, with its exit code), `status`, `wouldBe`, `ticked`, `refusalKind`, `refusal`, `details` |
| `resume` | `resume` | `ok`, `id`, `file`, `actor`, `owner`, `base`, `mergeBase`, `verified` (false under --no-verify: the contract was not re-run, which is not the same as a contract with no entries), `decisions`, `goal`, `history`, `diff` (the merge-base range: what this branch COMMITTED), `uncommitted` (what it left on disk in no commit: a patch of tracked edits, a list of untracked paths, and a reason — a null in any of the three means the working tree could not be read, not that it is clean), `verification` — the parts in the order the briefing fixes them — `refusalKind`, `refusal`, `details` |
| `log` | `task-log` | `ok`, `id`, `title`, `file`, `path` (the log the answer came from), `records` (raw entries) and `total` (the exchanges they fold into — the ratio is what the fold is worth), `matched` (the exchanges left after the filter — equal to `total` when there is none) and `decisions` (whether `--decisions` narrowed the answer to what was settled and what is still open), `limit`, `exchanges` (one per write: its time, actor, source, session, role, the reason ONCE, the changes that moved, its events and its messages — a message whose text is null is that reason again, kept for its event id), `refusalKind`, `refusal`, `details` |
| `red` | `red-owners` | `command`, `ran` (a report nobody gave is not an empty one), `reason`, `exitCode`, `files` (each failing test file with the task its commits name), `mine`, `tally` |
| `docs-drift` | `docs-drift` | `documents`, `minSignals`, `flagged`, `tooLittle`, `seeded` (absent unless `--seed-tasks` ran) |

**Adding a kind** (TL-285). A command that answers `--json` is registered in
`scripts/json-envelope.mjs` and nowhere else: its keys go into `KINDS`, and the
invocation that exercises it goes into `KIND_EXERCISE` in the same file —
`{ args, noDir?, refuses?, writes?, input? }`, naming a task through the
`FIRST_TASK` and `ABSENT_TASK` sentinels rather than typing an id. The suite
runs that invocation against an empty backlog and a populated one, and a kind
with no row fails before it can ship. Add the row to the table above in the same
change; the suite compares it against the code in both directions. Nothing under
`scripts/tests/` has to be touched to register a kind.

**`--help --json` describes how to CALL a command** (TL-83), which is the other
half of Law 4: the reading commands answer in JSON, and so does the description
of the writing ones' input. Each entry in `flags` carries `flag`, `arg` (the
value placeholder, or `null` for a switch), `required`, and — for a flag drawing
on a vocabulary — `dictionary` (the `config.yaml` key), `values` (*your*
project's values) and `closed` (whether a value outside them is refused).

`configured: false` means no backlog was found, and then `values` is `null`
rather than `[]`: an empty vocabulary is a decision a project can make, and it
must not read as "nobody looked". The flags are derived from the command's own
`usage`, so `--help` and `--help --json` cannot come to describe different
commands; a flag mentioned only in passing in the prose is not part of the
surface.

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

**A refusal is the same kind with `ok: false`** (TL-119), never a kind of its
own. `kind` answers "which question was asked" and is what a consumer switches
on to know the payload's shape; a separate `refusal` kind would force two
branches per command and would stop `kind` identifying the command at all. The
refusal's own word for what went wrong is `refusalKind`, because `kind` belongs
to the envelope. `take` and `next` share one kind for the same reason: they
answer the same question and hand back the same task, and the keys that say how
`next` CHOSE come back empty for `take`.
