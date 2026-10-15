# branchling

[![test](https://github.com/limackk/branchling/actions/workflows/test.yml/badge.svg)](https://github.com/limackk/branchling/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/branchling)](https://www.npmjs.com/package/branchling)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**A Git-native backlog for work done by people and coding agents.**

Tasks are markdown files in your repository. branchling hands them out one at a
time, records who claimed each one and why it changed, and refuses to close a
task until its own verification commands pass:

`plan → claim → execute → capture discoveries → verify → review`

- **A queue.** `branchling next` chooses a task and reserves it in one act, so
  two sessions asking at the same moment get two different tasks.
- **A contract.** `branchling done` runs the task's `verification:` commands
  and refuses to close it if they fail. There is no `--force`.
- **A ledger.** Every change records who made it, through what, and why.
- **An executable plan.** `plan.yaml` orders work in dependency-aware waves.
- **Plain files.** Views, indexes and the browser page are computed from the
  files and never committed. The task state travels with its branch and goes
  through code review beside the code it describes.

```bash
branchling run --agent "claude -p @{task_file}" --max-attempts 2
```

That is the whole loop — `next` → your agent → `done` — until the queue is
empty. `run` starts exactly the command you supply; a task that fails its
contract twice is parked with the reason, never closed.

## What it is not

**It is not a tracker for people outside the repository.** There is no hosted
board, login or notification; only people with a clone can see the backlog. A
generated `viewer.html` snapshot is read-only, and a viewer served on loopback
is the only viewer mode permitted to write.

**It is not a managed agent factory.** It does not contain, choose, host or
schedule agents for you. `branchling next --json` and `branchling done` are a
queue and a gate that any orchestrator, CI job or shell loop can drive.

| | External tracker | GitHub Issues | **branchling** |
|---|---|---|---|
| State follows the branch, and `git revert` takes it back | ✗ | ✗ | ✓ |
| A task is readable with no login and no network | ✗ | ✗ | ✓ |
| An AI agent edits a task with the same tools it edits code | ✗ | partly | ✓ |
| The diff of a task shows up in code review | ✗ | ✗ | ✓ |

## Getting it

```bash
npm install -g branchling
branchling --version
```

To try it without installing anything, `npx branchling --help` runs the same
package once and leaves nothing behind.

Requires Node 18 or newer; no runtime dependencies. CI runs Linux and macOS on
Node 18, 20 and 22, and Windows on Node 22.

## Quick start

```bash
branchling init --dir ./backlog                     # config, template, one example task
branchling new --title "Write a README for a new user" --priority P1
branchling query --status pending --priority P0,P1  # ask; reads the task files directly
branchling next --actor agent:claude                # take the next task, reserved
branchling done TASK-2                              # runs its verification, or refuses
branchling                                          # open the viewer in your browser
```

`init` never overwrites an existing file. After it, every command finds the
backlog by itself from anywhere inside the repository. An unknown command or
flag fails rather than doing nothing, and `branchling <command> --help` prints
the flags of each one.

## A task file

```yaml
---
id: TASK-2
title: "Write a README for a new user"
board: main
priority: P1
status: pending
owner: unassigned
blocked_by: []              # ids that must be closed before this one starts
verification:               # how to check the task is actually done
  - id: links
    bash: "branchling check --docs"
---

## Goal
## Context
## Acceptance criteria
- [ ] Every link in the README resolves. [proof: links]
```

The tool ticks a criterion after its verification entry passes, so a box ticked
by hand is a claim rather than evidence. Statuses, priorities and boards are
your project's vocabulary, declared in `config.yaml`.

## See it work

Each scenario runs offline in a throwaway repository:

```bash
mkdir /tmp/try && cd /tmp/try && git init .
branchling init --dir backlog --no-example
branchling new --dir backlog --title "Work that outlives its session"
branchling new --dir backlog --title "A second piece of work"
```

**One agent stops, another continues from the repository.** A passer-by cannot
clear somebody else's claim; the owner's successor is briefed from the files
alone.

```bash
branchling take TASK-1 --dir backlog --actor agent:first
branchling release TASK-1 --dir backlog --actor agent:second --reason "not mine"
# ✗ TASK-1 is in_progress, owner: agent:first
branchling resume TASK-1 --dir backlog --actor agent:first
branchling release TASK-1 --dir backlog --actor agent:first --reason "the session that held it ended"
```

**Two agents ask at once, and get different work.** With a `plan.yaml`,
`--plan` also keeps work scheduled for a later wave from starting early.

```bash
branchling next --dir backlog --actor agent:a           # TASK-1
branchling next --dir backlog --actor agent:b           # TASK-2, never TASK-1
branchling next --dir backlog --plan --actor agent:c
```

**A finished task that is not finished is refused.** A task with no
verification cannot be closed at all, and one whose verification fails is left
byte-for-byte untouched.

```bash
branchling done TASK-1 --dir backlog
# ✗ TASK-1 has no closing contract
```

The full script, with recorded output, is
[`docs/demo/scenario.md`](docs/demo/scenario.md).

## Working with AI agents

Every task is self-contained: the context, the files to read first and the way
to verify the result are in the file, not in a conversation. The procedure for
claiming, working and closing a task is printed by the tool, in your project's
vocabulary:

```bash
branchling instructions overview
branchling skills install      # a skill pointer for editors that load skills
branchling mcp                 # the same commands over the Model Context Protocol
```

`skills install` never overwrites an existing file. Local profiles connect any
provider through an adapter you own; see [the guide](docs/guide.md#a-queue-not-just-a-readable-list).

## Documentation

- **[The guide](docs/guide.md)** — the task file, the queue and agent profiles,
  where the data lives, composition with `--json`, importing from GitHub Issues,
  pull-request summaries and audits.
- **[The manual](docs/manual.md)** — statuses, configuration, `plan.yaml`,
  seeding, the dispatcher, guards, the viewer and the `--json` contract.
- **[`docs/branchling-global-tool.md`](docs/branchling-global-tool.md)** — the
  four rules every other design decision follows from.
- **[`LINEAGE.md`](LINEAGE.md)** — where this came from. The tool tracks itself
  with itself: its own backlog is in `backlog/`.

## Contributing

Contributions are welcome under the MIT licence with a
[DCO](https://developercertificate.org/) sign-off (`git commit -s`); there is no
CLA. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request,
and [`SECURITY.md`](SECURITY.md) before reporting a vulnerability.

## License

[MIT](LICENSE)
