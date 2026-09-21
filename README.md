# branchling

**A Git-native engineering loop for work done by people and coding agents.**
An agent harness knows how to edit code. branchling owns what must survive the
agent, its context window and even the provider: what work is ready, who claimed
it, why the plan changed and what evidence permits the work to close.

Tasks are markdown files in the repository, so the loop travels with the code:

`plan → claim → execute → capture discoveries → verify → review`

What makes this different from a readable task list is that each transition has
a concrete rule:

- **An executable plan.** `plan.yaml` orders work in dependency-aware waves.
  The queue offers only the active wave when the caller asks it to follow the
  plan; work whose blockers are still open cannot start early.

- **A queue.** `branchling next` chooses a task and reserves it in the same
  act, so two sessions asking at the same moment get two different tasks. It
  answers with that one task, so asking "what now" costs your agent the same
  whether the backlog holds forty tasks or four hundred — listing them does
  not.
- **A contract.** `branchling done` RUNS the task's `verification:` commands
  and refuses to close it if they fail. There is no `--force`. A checkbox
  ticked by whoever did the work carries no information when that whoever is
  an agent.
- **A ledger.** Every change records who made it, through what, and why —
  and the statuses you list in `reason_required_statuses` cannot be entered
  without a stated reason at all.
- **A feedback loop.** The shipped agent instructions say that substantial work
  discovered mid-task becomes its own self-contained task. It is not hidden in
  a final message, left as a `TODO`, or folded into work whose contract never
  covered it.

```bash
branchling run --agent "claude -p @{task_file}" --max-attempts 2
```

That is the loop: `next` → your agent → `done`, until the queue is empty.
branchling does not contain an agent or choose one: `run` starts exactly the
command template you supply, through your shell. A task that fails its contract
twice is parked with the reason, never closed: a run that could not verify a
task may not say it is done. Add `--agent-for <role>=<command>` and the same
contract scales to several hands, with the roles nobody has a command for left
waiting rather than handed out. Review and merge remain ordinary Git; the task
state and its evidence enter that review beside the code.

Everything that aggregates tasks — the index, the "what now" view, the
archive, the browser page — is **computed** from the files and is not
committed.

## What it is not

Two things a reader arrives expecting, pulling in opposite directions. It is
neither, and saying so is cheaper for both of us than finding out in week three.

**It is not a tracker for people outside the repository.** There is no hosted
board, no login, no notification, no status roll-up for somebody who will never
clone this. Tasks are files on a branch and go through review like code; a
stakeholder who needs a weekly summary needs a different tool, and pointing one
at this backlog is a reporting job you would be writing yourself. The browser
page is a read-only window onto the files — it shows current work and cannot
change any of it.

**It is not a managed agent factory.** It does not contain an agent, choose one,
host one, or run your agents for you. `run` starts exactly the command template
you hand it, through your shell, and stops. There is no scheduler, no worker
pool, no queue service and no dashboard of who is busy — and nothing here
measures how fast anybody works. Review, branches and merges stay ordinary Git.

What is left after both denials is the part that has to be in the repository
anyway: what is ready, who holds it, why the plan changed, and what evidence
permits a task to close.

If you want the parts it refuses — scheduling, retries across machines, a pool
of workers, a board somebody outside the repository can read — bring your own.
`branchling next --json` and `branchling done` are a queue and a gate that any
orchestrator, CI job or shell loop can drive, and every reading command answers
in JSON for exactly that reason. This tool holds the evidence; what drives it is
your decision and stays yours.

Requirements: Node 18+. Zero npm dependencies.

---

## Why files instead of a tracker

Because the state of a task should travel with the branch and go through review
together with the code it describes. That is the whole difference; everything
else follows from it.

| | External tracker | GitHub Issues | **branchling** |
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
git clone <repository-url> ~/tools/branchling
cd ~/tools/branchling
npm link                          # puts the `branchling` binary on your PATH
branchling --version
```

Two routes that write nothing to your global `node_modules`, if you prefer:
an `alias branchling="$HOME/tools/branchling/bin/branchling.mjs"` in `~/.zshrc`
(not `~/.zprofile` — zsh reads that one only for login shells), or
`npx --yes ~/tools/branchling`, which leaves nothing behind at all.

---

## The first five minutes

**1. Create a backlog.** `--dir` is mandatory here: `init` is the only command
that creates new files, so a guessed directory would scatter them through
somebody else's tree.

```bash
branchling init --dir ./backlog
```

It creates `tasks/`, `archive/`, `history/`, `boards/`, `config.yaml`,
`boards.yaml`, `_template.md`, `.gitignore` and `.gitattributes`, plus one
example task you are free to delete. It never overwrites an existing file, and
it prints whatever it skipped.

From here on every command finds that directory by itself, as long as you run it
inside the repository — see [Where the data lives](#where-the-data-lives).

**2. Create a task.** The tool assigns the number, not you.

```bash
branchling new --title "Write a README for a new user" --priority P1 --estimate 2h
```

It prints the path of the file it wrote, the board it chose and why.

**3. Write the task.** Open the file and fill in the goal, the context and
`verification:`. The measure is simple: **can somebody who was not
part of the conversation this task came out of carry it out without asking?**
The shape of the fields is described in [The task file](#the-task-file).

A program that already knows all that does not open the file: the task arrives
whole, as one JSON document on stdin — the same shape `seed` reads for one plan
item, minus the keys that belong to a plan.

```bash
echo '{"goal":"A stranger can run the tool in five minutes.",
       "steps":["Write the quick start","Read it as a stranger"],
       "verification":[{"id":"links","bash":"branchling check --docs",
                        "proves":"Every link in the README resolves."}]}' \
  | branchling new --title "Write a README for a new user" --priority P1
```

`goal` and a non-empty `verification` are required, `--body-file <path>` reads
the same document from a file, and a document that is refused writes nothing and
reports every complaint at once.

**4. Rebuild the views** — after every frontmatter change.

```bash
branchling build
```

**5. Ask, instead of reading everything.** `query` reads `tasks/*.md` rather
than the generated views, so it sees a status change before the next rebuild.

```console
$ branchling query --status pending --priority P0,P1
- {id: TASK-2, priority: P1, status: pending, board: main, title: "Write a README for a new user"}
```

Filters combine with AND between axes and OR inside one; `branchling query
--help` lists them. **A misspelled flag fails** with exit code 2 — zero results
caused by `--prioriti` reads exactly like the answer "there are no such tasks",
and it is not that answer.

**6. Open the viewer.** `branchling` with no arguments serves it on
`127.0.0.1:4321` and opens your browser. `Ctrl-C` stops it.

---

## Three things worth seeing before you commit to it

Each runs offline, in a throwaway directory, with no account and no network. Any
prefix works — these use the default `TASK`. They are the three failures this
tool exists to prevent, shown happening.

```bash
mkdir /tmp/try && cd /tmp/try && git init .
branchling init --dir backlog --no-example
branchling new --dir backlog --title "Work that outlives its session"
```

`git init` first because the tool is Git-native, and says so: outside a
repository `new` warns that it is numbering from the local directory alone,
since it cannot see the tasks on anybody else's branch.

### 1. One agent stops, another continues from the repository

The first hand claims the work, then its process is gone — a crash, a quota, a
closed laptop. Nothing was written down anywhere except the repository.

```bash
branchling take TASK-1 --dir backlog --actor agent:first
```

A passer-by cannot tidy the claim away. The refusal is the feature: the claim
says who is responsible, and clearing it silently would lose that.

```bash
branchling release TASK-1 --dir backlog --actor agent:second --reason "not mine"
# ✗ TASK-1 is in_progress, owner: agent:first
```

The successor is a different process filling the same slot, and is briefed from
the files alone — no transcript, no memory of the session that died.

```bash
branchling resume TASK-1 --dir backlog --actor agent:first
branchling release TASK-1 --dir backlog --actor agent:first --reason "the session that held it ended"
branchling next --dir backlog --actor agent:second
```

### 2. Two agents ask at once, and get different work

Selection and reservation are one act, so there is no window between "choose"
and "claim" for a second caller to fall into.

```bash
branchling next --dir backlog --actor agent:a   # TASK-1
branchling next --dir backlog --actor agent:b   # TASK-2, never TASK-1
```

With a `plan.yaml`, `--plan` makes the wave a boundary rather than a suggestion:
work scheduled later cannot be started early, however idle the asker is.

```bash
branchling next --dir backlog --plan --actor agent:c
```

### 3. A finished task that is not finished is refused

`done` RUNS the task's `verification:` commands. There is no `--force`.

```bash
branchling done TASK-1 --dir backlog
# ✗ the verification failed — the task file was not touched
```

The file is byte-for-byte unchanged, which is the point: a run that could not
verify a task may not record that it did. Fix the work, run the same command
again, and the criterion is ticked from the run rather than by hand.

The full script for the third one, with the output as it is recorded, is
[`docs/demo/scenario.md`](docs/demo/scenario.md).

---

## The task file

A task is markdown: YAML frontmatter for machines, prose for people.

```yaml
---
id: TASK-2                  # prefix from config.yaml, number from `branchling new`
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

`branchling new` copies `_template.md`, which ships with the package and
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
`branchling done` asks for nothing and the statuses in
`reason_required_statuses` refuse to be entered without one. The template
ships with the headings above; the tool does not require any particular set of
them.

**And a reason that is written down can be read back.** `branchling log <ID>`
prints that task's recorded exchanges — one row per *write*, not per field, with
the fields that moved beside it and the reason printed once:

```
branchling log TASK-1
branchling log TASK-1 --limit 3 --json
```

The log itself stores one entry per field, so a single handoff keeps the same
paragraph on `status`, on `owner`, on `role` and on the comment it leaves
behind. That is right for something append-only and expensive to read: `cat`-ing
the file makes you pay for one sentence four times over. Nothing is rewritten —
this is a read.

### Editing a task by hand

**Editing a task file by hand is supported, not merely tolerated: the file is
the truth, and this tool's job is to notice what changed, not to be the only way
to change it.** Open the file, fix the typo, change the status in a code review
— all of that is a normal way to use this.

That is a deliberate decision rather than an omission, and it is the opposite of
what most file-based trackers choose. Requiring the CLI for every write would
keep the history perfect and cost the thing files were chosen for: a backlog you
cannot fix without the tool installed is not plain markdown, and a task in
somebody else's pull request stops being editable content.

**What it costs you**, measured rather than assumed:

| | |
|---|---|
| The views go stale | Run `branchling build`. They are computed and unversioned, so this is a rebuild, not a repair |
| The change misses the history | Run `branchling history --actor <ns:name> --source manual`; it diffs the tree against its own reference point and records what changed |
| The **reason** cannot be recovered | A change the tool merely *saw* is recorded as `unknown`, and no later pass can fill it in |
| `updated:` is not touched | Nothing rewrites it for you — the field says what the last tool write set |

Only the third of those is permanent, and it is why the writing commands still
earn their place: a transition into a status listed in
`reason_required_statuses` is refused without a reason precisely because
afterwards there is nobody left to ask. Everything the tool *can* work out on
its own it does — `branchling check --vocabulary` and `branchling doctor` both
catch a hand-written value that is outside your vocabulary, and they catch it
without anybody remembering to ask.

---

**`board` versus `epic`** are two different questions, so they have two
different rules: `board` is a CLOSED vocabulary from `boards.yaml`, exactly one
per task, and a typo fails the build; `epic` is free text, optional, and a typo
costs one extra group in the index. `boards.yaml` accepts `paths:` rules, so a
new task's board can be computed rather than guessed — `branchling board <file>`
prints the slug and which rule decided.

---

## A queue, not just a readable list

Taking a task is a command, because two sessions can want the same one.

```bash
branchling take TASK-42 --actor agent:claude   # "do TASK-42", with a reservation
branchling next --actor agent:claude --json    # "what should I do", answered and claimed
```

Both do the same thing to the task — reserve it, set it to the status your
project calls *in progress*, set `owner:`, record the change in the history and
print the whole task file, so whoever runs it has what the task was written to
say. That state means the work is claimed; it does not prove that an agent or
process is currently running. `next` only adds the choice: the highest-priority
task whose `blocked_by`
is closed, filtered by the same axes `query` uses. Because that choice and the
reservation are one act, six sessions asking at once get six different tasks,
and the backlog empties itself with no dispatcher process, no server and no
orchestrator:

```bash
while task=$(branchling next --actor agent:claude --json); do
  # … work on "$task", then: branchling done <ID>
done   # exits 3 — nothing left to take
```

`0` took a task · `3` nothing to take · `1` refused (held by somebody else,
closed, not yours) · `2` a bad invocation. An empty queue is not an error, and
it does not look like one.

**That loop, with the accounting, is `branchling run`.** The command is a
template of yours: `{task_file}` and `{id}` are substituted, and the task —
plus, from the second attempt, what `done` refused — arrives on stdin.

```bash
branchling run --agent "claude -p @{task_file}" --max-attempts 2
branchling run --dry-run          # the order it would work in; claims nothing
```

**Profiles make the provider boundary explicit.** Store a local profile with
one wrapper executable, a prompt and optional model and effort, then run it by
name. The wrapper receives those values through a stable environment contract;
it can call a CLI or an API for Claude, Codex, Kimi, GLM or a provider that does
not exist yet.

### Quick start: one generalist

Write or install an adapter you control, then name that executable in one local
profile. Branchling does not copy, update or discover provider adapters; the
adapter owner chooses its provider invocation, model catalogue and credentials.

```bash
branchling profile create generalist --adapter "$PWD/branchling-agent.mjs" \
  --model "<provider model alias>" --effort high \
  --prompt "Implement the task with evidence."
branchling profile check generalist
branchling run --profile generalist --dry-run
```

Choose execution authority per run, never by guessing from a provider name:
`--delegation provider` is the normal mode for one generalist and permits its
harness to use bounded helpers; `--delegation branchling` is the recommended
mode for a specialist fleet, where Branchling alone claims backlog tasks; and
`hybrid` is an explicit advanced exception. An adapter's local
`delegation_control` states whether that boundary is enforced, instruction-only
or unsupported. Run the agent in the foreground in a working tree you prepared;
your shell or orchestrator owns detached execution, supervision and cancellation.

`--dry-run` lists the queue without starting an adapter or claiming work. When
it looks right, remove that flag to run the queue. One `--profile` is the
generalist path: it serves roleless work and every declared role that has no
more specific profile mapping.

To correct or remove a local choice, use `branchling profile update <name> …`
or `branchling profile remove <name>`. These change only your local profile
store; they never edit the backlog.

### Fleet: one profile per role

The repository owns the role names and optional reviewed briefs; each person
owns which local profile serves them. This example sends development to a
subscription-backed CLI and review to an API-backed coding harness:

```bash
branchling profile create developer --adapter "$PWD/claude-code.mjs" \
  --model "<current Claude model alias>" --effort high \
  --prompt "Implement from evidence."
branchling profile create reviewer --adapter "$PWD/aider-api.mjs" \
  --model "<model specification accepted by Aider>" --effort medium \
  --prompt "Review from evidence." --secret-env OPENAI_API_KEY

branchling profile check developer
branchling profile check reviewer
branchling run --profile developer --profile-for review=reviewer --dry-run
```

For a role with a reviewed brief, adapter stdin is composed in this order: the
repository role brief, the local profile prompt, then the task. The adapter also
receives model, effort, actor, task and repository paths in the stable
environment contract. `--profile-for review=reviewer` overrides the generalist
only for `review`; every other eligible task remains with `developer`.

Each profile attempt also leaves a local execution receipt. `branchling run
--json` exposes the profile, role, requested model and effort, and a content
fingerprint of its adapter — read it there, at the moment of the run, because
nothing reads it back for you afterwards: the commands that did were removed
with the rest of the session reporting. Requested settings and provider
confirmation are deliberately separate: without provider-produced evidence,
`confirmed.model` is `null`, never a claim that an alias was used. Receipts are
outside the repository and contain no prompt, credential, account identifier or
local adapter path.

Kimi, GLM, a local runner such as Ollama, or another API service use the same
shape: provide an executable adapter and a local profile. The adapter owns the
provider request format, authentication and tool loop. Name required credential
variables with `--secret-env`; never put their values in profiles or task files.

If `profile check` reports an unavailable adapter or a missing named credential,
`run` refuses before it claims a task. `profile check --live` is an explicit
reachability/authentication probe and may consume quota. Timeouts and failed
verification stay visible in the run report and its local log; they do not
silently close a task.

The profile is user data, not repository configuration, so contributors can
choose different providers without changing the project. Raw `--agent` commands
remain available for existing scripts. With no `--profile-for` mapping, that one
profile is the generalist: it serves both roleless work and every declared role.

`profile check` is read-only and local by default: it does not start the
adapter, send a prompt or contact a provider. `run` performs the same
deterministic checks before it claims a task. Use `profile check --live` only
when you explicitly want the wrapper to probe authentication or reachability;
it may use provider credentials or quota and reports an outcome separately from
task work.

Before publishing a wrapper, its author can prove the provider-neutral boundary
without credentials, network access or a real task:

```bash
branchling conformance --adapter "$PWD/bin/developer-agent"
branchling conformance --adapter "$PWD/bin/developer-agent" --json
```

The command builds a disposable repository and asks the adapter for a
test-only JSON response for success, failure, availability, authentication,
quota, cancellation and timeout. This handshake is enabled only by
`BRANCHLING_CONFORMANCE=1`; ordinary `branchling run` keeps its stdin,
environment and exit-code contract unchanged. The adapter guide is therefore
one small executable boundary rather than a provider registry or plugin API.

For each requested `BRANCHLING_CONFORMANCE_SCENARIO`, the adapter writes one
JSON object to stdout: `{"version":1,"scenario":"…","outcome":"…"}`.
The scenario must be echoed and the outcome must match it. The `cancelled`
scenario additionally returns `childPid` for a child it has already terminated;
the harness verifies that the process is gone. Adapter stderr is deliberately
not replayed, so a provider diagnostic cannot leak a credential into the
conformance report.

**Branchling ships no provider adapters.** The executable named by a profile is
user-owned. It receives the documented neutral contract, while its provider
arguments, model selection and credentials remain outside Branchling core. Run
`branchling conformance --adapter <path>` before giving a new adapter a real
queue.

**One queue, several hands.** A task may ask for a competence in `role:`, and
`--agent-for <role>=<command>` or `--profile-for <role>=<name>` is repeatable,
with `--agent` or `--profile` serving the tasks that ask for nobody in
particular. A role you gave no command for is *not* handed out and *not* failed
over — it waits for a hand this deployment does not have, usually a person, and
the report counts those tasks by role. That is the whole escalation mechanism:
an absent entry, not a workflow engine.

`executor: human` on a task keeps the dispatcher off it entirely — the product
decision an analyst-agent could phrase but must not settle — while
`take <ID>` still works, because a person naming a task is themselves the
human decision the field asks for.

**Where the guarantee ends, said plainly.** The reservation excludes sessions
that ask at the same moment in every worktree of one clone, and `next` also
reads every branch and worktree of that clone (local refs only, never a
`git fetch`), naming the branch it defers to rather than skipping silently:

```
$ branchling query --status in_progress
- {id: TASK-42, priority: P1, status: pending, board: main,
   elsewhere: [feature/x: in_progress], title: "…"}
```

Both statuses stand and the branch is named; picking one would be the
one-checkout answer again, only harder to notice. **The boundary is the
clone:** two clones connected only by git can still both take one task and
find out when they merge. That is a property of git, not something this hides.
An `in_progress` value, owner or modification time is durable task state, not a
liveness probe. Current execution requires a separately pollable runtime handle.

The whole pattern — one task per session, the exit codes, the hooks, dead
sessions, and the statuses never handed out unattended — is a guide the tool
prints, and [the manual](docs/manual.md#the-dispatcher-in-full) carries the
rest:

```bash
branchling instructions autonomous-loop
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
of backlogs: `branchling query --dir ~/other-project/backlog --status blocked`.

---

## Commands

**`branchling --help` lists the commands, and `branchling <command> --help`
prints one command's flags.** There is no table of them here on purpose: a
copy of a list the tool generates is wrong the moment a command is added, and
wrong in the way that is hardest to notice — still specific, still confident,
no longer true.

**An unknown command and an unknown flag both FAIL.** A silent no-op looks like
the tool working, which makes it worse than an error — especially when it has a
side effect.

**You extend this by composition, not through a plugin API.** Every command that
takes `--json` answers in the same versioned envelope — the writing ones
included, refusals included — and every writing command can be called from a
script. `next-id` and `board` also keep printing their one value alone on the
first line, so they drop straight into substitution.

```bash
branchling query --status blocked --files | xargs $EDITOR
branchling stats --json | jq '.stats.byStatus.blocked'
branchling doctor --json | jq -e '.ok'          # a gate in CI
branchling done TASK-42 --json | jq '.entries[] | select(.ok | not)'
branchling next --actor agent:worker --json | jq -r '.refusalKind // .id'
```

### One description, a whole backlog

```bash
branchling seed --from spec.md --dry-run     # what it would create
branchling plan-from spec.md | branchling seed --dir ./backlog
```

The first is the convenience; **the second is the interface.** `plan-from`
prints a plan on stdout and writes nothing, `seed` validates it and writes, and
the two halves only ever meet through a JSON document on a pipe — so somebody
else's adapter, in somebody else's language, calling somebody else's model, is a
first-class citizen here rather than a plugin.

**The model is yours and lives in your own preferences file**, not in the
project's `config.yaml`: two people working on one repository can reasonably run
a local model and a hosted one, and both be right.

```yaml
llm_endpoint: http://localhost:11434
llm_model: llama3.1
```

With [Ollama](https://ollama.com) that is `ollama pull llama3.1` and nothing
else — no key, no account. Any OpenAI-compatible endpoint goes through the same
code. **The prompt is a file** (`templates/seed-plan.md`), not a string in the
source: tuning what the model is told must not need a fork.

**A plan is never repaired for you.** It goes to `seed --dry-run`, and a
rejected one goes back to the model with the errors attached, `llm_retries`
times. After that the plan and the complaints are printed and the command
fails. Of the three things a tool could do here — retry, fail, or quietly patch
the JSON — only the last is dangerous: it produces a plan nobody wrote and
nobody can trace.

---

### Is the "done" actually done

`branchling check` judges structure and fails a commit. `branchling audit` judges
something else — whether a declaration left the trace it should have — and is a
report a person reads:

```bash
branchling audit                 # 0 = nothing found, 1 = findings
```

It names four disagreements between what the files declare and what the history
recorded: a task standing in a closed status that no transition ever put there;
a task reopened after being closed, counted per the actor who *closed* it; a
task in progress with nothing recorded for `audit_stale_days`; and a status you
may not enter without saying why, carrying an empty `blocked_by`.

Three things keep the report from being a lie of its own. A task closed before
the log first recorded a status transition is not accused — it left no trace for
a reason that is nobody's fault, and the number dropped is stated rather than
hidden. A rework bucket with fewer than `min_report_n` closings says how many it
has and no rate at all, because a percentage over three closings reads exactly
like one over three hundred. And it is **a tool for backlog hygiene, not for
judging people**: the per-actor table is there to find a process that keeps
producing rework.

---

### The backlog diff, in the pull request

A pull request shows the code diff. It does not show which tasks the branch
touched or which statuses moved — the half of the change a reviewer cannot
reconstruct from the diff:

```bash
branchling pr-summary --base main        # markdown on stdout
```

Copy [`examples/pr-summary.yml`](examples/pr-summary.yml) into
`.github/workflows/` and that markdown becomes one pull-request comment,
updated in place. The job is checkout, run, comment: every decision is in the
command, so the same invocation works unchanged in GitLab CI, in a git hook, or
typed into a terminal.

Both sources are git — `git diff --name-status` over the task files says *which*
tasks, and the lines added to `history/*.jsonl` in the same range say *what
happened*. Never a computed view: on CI nothing has been rebuilt, so a view
would answer for a state that does not exist there.

A section with no data does not appear as zeros, a branch that touched no task
says so rather than posting an empty comment, and cost information is opt-in —
`--cost` only, because the comment lands somewhere public and token counts,
model names and amounts are facts about your spend and your stack rather than
about the change.

---

### Calling it from an agent

**`<command> --help --json` describes the input surface** — every flag, whether
it takes a value, whether it is required, and for a flag drawing on a vocabulary
the values *this* project allows:

```bash
branchling new --help --json | jq '.flags[] | select(.dictionary) | {flag, values}'
```

The lists come from your `config.yaml`, so nothing has to be guessed. An unknown
value still fails — this adds the list, not leniency. The point is that failing
on a value you could not have known was wrong is what makes strictness feel like
an obstacle; the strictness itself is what keeps a vocabulary a vocabulary.

`closed: false` on a flag means a value outside the list is accepted (open
labels); `values: null` with `configured: false` means no backlog was found, not
that the vocabulary is empty.

**Multiline values have three forms, and only two of them work everywhere:**

```bash
branchling handoff TASK-42 --to-role reviewer --reason "First line.
Second line."                                    # a real newline: fine in a shell

branchling handoff TASK-42 --to-role reviewer --reason $'First line.\nSecond line.'
                                                 # rejected by some agent sandboxes

branchling handoff TASK-42 --to-role reviewer \
  --reason "First line." --append-reason "Second line."   # works everywhere
```

**`--append-<field>` is the form to use from an agent.** Sandboxes built on
tree-sitter reject `$'a\nb'` outright, which leaves an agent inside one unable to
express any value with a newline in it. Repeating `--append-reason` builds the
value up one argument at a time instead.

The order is defined so the same flags always mean the same thing: `--<field>`
replaces and is applied first, then every `--append-<field>` in command-line
order, each on its own line. A command that has no `--<field>` refuses
`--append-<field>` rather than passing on a flag you never typed.

One honest note: `--reason` is stored in the history as a single line, so its
newlines are collapsed there. `--append-reason` still preserves your order, and
the field is the first of several — the commands that write longer prose join
the same mechanism rather than inventing their own.

**An agent that is not a shell reaches it over MCP.** `branchling mcp` speaks the
Model Context Protocol on stdio, and every tool it offers is one of the commands
above — the adapter validates nothing of its own, so an unknown flag, a bare
actor and a `done` whose contract fails come back as the same refusals a shell
gets. The phase guides are exposed as MCP resources, rendered with *your*
backlog's vocabulary.

Claude Code:

```bash
claude mcp add branchling -- branchling mcp --dir /path/to/repo/backlog
```

Codex, Gemini CLI, Kiro and the editors that read a JSON config take the same
two lines:

```json
{
  "mcpServers": {
    "branchling": { "command": "branchling", "args": ["mcp", "--dir", "/path/to/repo/backlog"] }
  }
}
```

`--dir` is optional: without it every call resolves the backlog the way the CLI
does, starting from the directory your client launched the server in.

---

### Why does this file look like this

`git log <file>` says who changed a file and when. It does not say **as part of
what** — and that is the question you actually have while reading somebody
else's code. The answer is already in the backlog, in the task's `## Goal` and
`## Context`:

```bash
branchling query --modified-file scripts/cli.mjs --status done
branchling query --modified-file scripts/            # a whole directory
```

**There is one data source and it is the commit messages.** A task's files are
COMPUTED from every commit whose message names its id — the convention this
tool already asks for, so there is no field to fill in and nothing that can go
stale. Paths are relative to the repository root, not to the backlog directory;
those differ whenever the backlog is not co-located with the code.

A repository whose commits do not name task ids gets told so, rather than being
handed an empty list that reads like an answer. This is the one thing an
external tracker cannot do at all: it needs the tasks and the code in one tree.

The envelope's promises — which keys are guaranteed, what may be reworded, and
what requires a new `schemaVersion` — are in
[the manual](docs/manual.md#the---json-contract).

---

## Bringing your team over

If your tasks are already in GitHub Issues, you do not have to retype them.

```bash
gh issue list --state all --limit 500 --json number,title,body,state,labels,url \
  | branchling import --from github --dry-run
```

`--dry-run` prints what it would create and writes nothing; drop the flag to
write. Nothing here touches the network — the issues arrive as JSON on standard
input, so authentication stays inside `gh` where it already works, and you can
pipe in a file instead if you prefer to look at it first.

**It is a one-off copy, not a synchronisation.** Two-way sync would put your
task state back outside the branch, which is the thing files were chosen over a
tracker to avoid.

**What it does not bring over**, so that nobody discovers it later: comments,
attachments, status history and assignees. Those are the conversation *around* a
task rather than the task, and every imported file carries a link back to the
issue, so none of it is lost. Issue numbers are not carried either — `#412`
becomes whatever number is free here, because a number that is free in your
repository is not free on somebody else's branch.

**And `verification:` arrives empty**, because no tracker has that field. The
import says how many tasks it left in that state rather than filling it with a
placeholder: those tasks are readable and searchable straight away, and
`branchling done` will refuse them until somebody writes down how to check the
outcome.

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
formed — fix it before you start. `branchling done` enforces this rather than
asking for it: a task with no contract is refused, and the message says so in
different words from a verification that ran and failed.

---

## Working with an AI agent

Every task is **self-contained**: the agent reads one file and knows everything,
because the context, the files to read first and the way to verify the result are
all in it rather than in somebody's head.

**When work discovers more work, the plan grows without blurring the task in
progress.** The rule is one question: does doing it now fit the current task's
thesis? A neighbouring typo does. A separate design decision, missing guard or
refactor does not, so the agent creates a new task whose goal, context and
verification stand on their own. A later session can receive it through
`branchling next` without access to the conversation that found it.

This rule is part of the workflow printed by the tool. branchling does not try
to classify an agent's thoughts or scrape its final response; the instruction
makes the write explicit, and the new task then becomes ordinary repository
state with the same history, dependencies and review path as every other task.

The protocol around the task — when to open one at all, how to claim it, what to
do before closing it — is printed by the tool:

```bash
branchling instructions overview
```

`overview` is a switchboard; it sends the reader to `task-creation`,
`task-execution` or `task-finalization`, whichever applies. The text is rendered
with **your** backlog's vocabulary, read from your `config.yaml`, so it never
teaches somebody else's statuses.

It is a command rather than a file on purpose. A guide copied into a repository
freezes on the day it was copied and goes on teaching flags that no longer
exist; a command ships with the tool and cannot drift from it. `branchling init`
writes one short pointer to that command into `CLAUDE.md` or `AGENTS.md`.

**For editors that load skills**, the same pointer ships as one:

```bash
branchling skills install     # or `branchling init --skills` while creating a backlog
```

It writes `.claude/skills/backlog-workflow/SKILL.md` into your repository and
**never overwrites** — the file may be your own edit of it. The skill itself
holds no procedure and no vocabulary; it exists so that an editor loading skills
by description knows a backlog is here and knows to run `branchling instructions
overview`, which is rendered with *your* `config.yaml`. A skill that listed
statuses would be a second truth about them, wrong the moment you renamed one.

---

## Activity telemetry

Branchling does not record work time, heartbeats, sessions, token cost or actor
scorecards. It owns the durable task ledger — who changed a task, why and what
verification permitted it to close — rather than productivity analytics.

Older versions may have left local activity data or versioned rollups. Upgrading
never deletes them; the current binary ignores them. Their owner may remove
local data deliberately after inspecting it. See
[the telemetry migration note](docs/backlog-time-tracking.md).

---

## Documentation

**[The manual](docs/manual.md)** is the reference: statuses, configuration,
`plan.yaml`, seeding, the dispatcher in full, guards, the viewer and the
`--json` contract. The documents below record decisions and the measurements
behind them.

- [`docs/branchling-global-tool.md`](docs/branchling-global-tool.md) — the tool
  outside a single repository; §3 is the four rules everything else follows from.
- [`docs/backlog-config-and-portability.md`](docs/backlog-config-and-portability.md)
  — the shape/values boundary, and the full list of config keys.
- [`docs/backlog-field-editing-history.md`](docs/backlog-field-editing-history.md)
  — the limits of what the history can be trusted to say.
- [`docs/backlog-time-tracking.md`](docs/backlog-time-tracking.md) — the
  telemetry removal and migration note.
- [`docs/branchling-state-and-sync.md`](docs/branchling-state-and-sync.md) — the
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
