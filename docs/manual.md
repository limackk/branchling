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

**A project contract runs after every task's own.** `closing_contract:` in
`config.yaml` holds entries of the same shape as `verification:`, and `done`
appends them to each task's contract — for the repository-wide guard a module's
tests never reach, stated once instead of in every task file:

```yaml
closing_contract:
  - id: repo-guards
    bash: "npm run check"
```

It never stands in for a task's own contract: a task with an empty
`verification:` is still refused. An `id` a task's own entry also uses refuses
that closing before anything runs, because a `[proof: id]` naming it would be
ambiguous.

`take --probe`, `next --probe` and `check --proofs` read the same contract
through the same function, so a probe before the work and an audit after it see
the red lines the closing will. The one exception is the half of `check
--proofs` that looks for unfalsifiable contracts in tasks nobody has started: it
judges a task by its own entries, because the project's are not the work's to
turn red.

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

# Adds to the generic programs already recognised in verification contracts.
contract_programs: [terraform, helm]
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

### Deployment stages

Whether a task is FINISHED is its status. Whether it has REACHED the test
environment or production is a different question, and it is answered from git
rather than typed: `deploy_targets:` declares what the project deploys and, for
each deployable, its promotion stages as an ordered list of git refs. The
design, and the reasons a hand-kept `environment:` field was rejected, are in
[`release-tracking.md`](release-tracking.md).

```yaml
deploy_targets:
  - name: backend                 # something deployed on its own
    paths: [backend/]             # which commits belong to it; omit for the whole repository
    stages:                       # in promotion order
      - { name: test, ref: origin/main }
      - { name: production, ref: origin/production }
```

- **A commit belongs to a task through the task id in its message**, anywhere
  in it. Only commits reachable from the trunk count, so a squash merge, a
  merge commit and a rebase give the same answer; merge commits themselves are
  skipped. The trunk is the remote's default branch (`origin/HEAD`) when the
  clone has one, otherwise `HEAD` — the same trunk `show` and `deploy status`
  read — and `query` names it, with its source, in its output.
- **A task's targets are the ones whose `paths` its commits touched.** A path
  ending in `/` selects a directory; any other entry selects that file, or the
  directory of that name. There are no globs in `paths`.
- **Per target and stage the answer is `full`, `partial` or `absent`** — all,
  some or none of the task's commits for that target are in the stage. A
  commit cherry-picked onto a stage counts by patch identity (`git cherry`),
  not by SHA.
- **A ref is a ref name or a `refs/…` glob**, and a glob resolves to the newest
  match by version sort, so `refs/tags/v*` picks `v1.10` over `v1.9`.
- **`refs:` instead of `ref:` declares refs deployed in parallel** — regions,
  tenants, maintained release lines. The stage is reached only when every one
  of them holds the task; until then the answer names which ones do.
- **A ref that does not resolve is `unknown`, never empty.** A task whose answer
  depends on it matches neither `--env` nor `--not-env`, and the output says
  which ref it was. Every answer also names each ref it read with its SHA:
  a remote-tracking branch moves only on `git fetch`, and the default refspec
  does not fetch `refs/deploys/*`.
- **A rollback needs no edit.** Move the ref back and the tasks leave the stage.
- **An unknown key fails** at every level, and so do a stage with both or
  neither of `ref` and `refs`, a duplicated name, and a glob that is not a full
  ref name.

Asking:

```bash
branchling query --status done --not-env production   # finished, not yet in production
branchling query --env backend/test                    # in test, for one target
branchling query --text checkout --json                # each task's `deploy` per target and stage
```

**What waits for which environment** is one command, `deploy status`. For each
target it prints the promotion pipeline as buckets, each holding the tasks
between two adjacent steps:

```text
trunk  refs/remotes/origin/main 3f1c2a9b0d4e  (the remote's default branch)
  web/test        origin/main                     3f1c2a9b0d4e
  web/production  refs/deploys/web/production-eu  9a0b1c2d3e4f
  web/production  refs/deploys/web/production-us  9a0b1c2d3e4f

web
  closed, not on the trunk         1
    TASK-12  Export to CSV  done 2026-10-30 · waiting 2d
  on the trunk, waiting for test   0
  in test, waiting for production  1
    TASK-14  Retry failed uploads  done 2026-10-29 · waiting 3d · partial (held by refs/deploys/web/production-eu)
  in production                    41  (counted, not listed)
```

- **A task is placed by the first stage that does not hold it in full**, so
  each bucket answers "what does the next promotion carry". The last stage is
  counted and never listed: it grows with the project's whole history.
- **Closed but not on the trunk** is an archived task whose commits exist only
  off the trunk; its target comes from the paths those commits touched. A
  closed task that no commit names at all cannot be given a target and is
  counted on its own line.
- **The trunk is the remote's default branch** (`origin/HEAD`) when the clone
  knows one, else `HEAD`, and the header says which: on a feature branch `HEAD`
  holds that branch's commits, and a task closed there would read as merged.
- **The wait is measured from the newest commit** of the task for that target,
  because git records no deploy time — or, when the stage the task already
  stands in is an annotated tag, from the tag's date.
- **A ref that does not resolve makes its bucket and every later one
  `unknown`**, never zero: no task can be placed past a stage nobody could read.
- **An empty bucket prints as `0`**, and the header names every ref with its
  SHA, because the answer is only as fresh as the refs it read.

```bash
branchling deploy status                       # every target, every bucket
branchling deploy status --env production      # only what waits for production
branchling deploy status --target web --count  # counts only, inside a context budget
branchling deploy status --json                # the same buckets, kind `release-status`
```

**What a release planned, against what shipped.** A task names the release it
is planned for in `release:`, a value from the closed `releases:` list in
config.yaml — the intent, written by a person, as opposed to deployment, which
is observed. A value outside the list fails `new --release`, `query --release`
and `check --vocabulary`; an empty list means the project plans no releases.
`deploy status --release <name>` compares the plan with the last stage of
each target:

```text
release 2026.11  4 planned · 1 shipped (counted, not listed) · 1 dropped
  the current release — the first in `releases:` not fully shipped
  planned, not shipped                      2
    TASK-21  Checkout redesign  done · P1 · web: in test, waiting for production
    TASK-24  Fraud check        pending · P0 · no commit on the trunk names it
  planned, still open                       1
    TASK-24  Fraud check        pending · P0
  unplanned, carried by the next promotion  1
    TASK-30  Logging tweak      done · P2 · web: in test, waiting for production
  planned, then dropped                     1
    TASK-22  Gift cards         cancelled · P2
```

- **Not shipped** is a planned task not yet in full in the last stage of every
  target its commits touched — a task with no commit yet included, named as
  such. These are the launch blockers.
- **Unplanned** is a task on the trunk or in an earlier stage, not yet in the
  last one, that this release did not plan — the scope the next promotion
  carries without anybody having planned it. What already reached the last
  stage is not listed: it is the project's whole history.
- **Dropped** is a planned task closed in an archived status other than the
  first of `archived_statuses:`; it never blocks.
- **`releases:` is chronological**, oldest first. The **current release** is
  computed, never configured: the first entry not yet fully shipped — every
  planned task that is not dropped is closed and in full in the last stage of
  every target it touched. A last stage that does not resolve keeps a release
  current, because unknown is never shipped; a release with nothing left to
  ship does not. A closed task whose commits touch no target's paths (docs or
  backlog only) touched no target, so it does not hold its release, although
  the report still lists it; a closed task no trunk commit names does hold it,
  because nothing was measured. The report names it on the line under the
  header (`the current release`, `not the current release, which is …`, or
  `no current release` once every one has shipped). When deployment was not
  read — outside git, or with an unresolved trunk — nothing is judged and the
  line says so instead. Append the next release to the list; reordering it
  changes which release is current. No date is read from it.
- **A release that has shipped names the ref that marks it.** An entry of
  `releases:` may be `{name, ref}` beside the plain slug — `ref` is a ref name
  or tag, never a pattern, because a release ends at one point — and both
  shapes live in one list:

  ```yaml
  releases: [{ name: 1.0, ref: v1.0 }, { name: 1.1, ref: v1.1 }, 1.2]
  ```

  Such a release is compared with its ref instead of the pipeline. **Planned,
  not shipped** is then a planned task the ref does not hold in full; **shipped,
  unplanned** replaces "carried by the next promotion" and lists the tasks named
  by a commit the release carried — reachable from its ref and not from the
  previous release's ref, the first one beginning at the root — that were
  planned for another release or none. A patch the previous release already
  carried is not counted again. The header names the ref, its SHA and where the
  release began. A ref that does not resolve is unknown, never an empty release;
  an unresolvable beginning leaves only the shipped-unplanned list unknown. For
  the current release such a release is shipped when its ref resolves and holds
  every planned task that is not dropped: a task it went out without keeps it
  current until somebody plans that task for a later release or drops it. A
  release without `ref` behaves exactly as above. The name keeps the slug rules
  of every release, and `new`, `query`, `check --vocabulary` and the viewer read
  the names alone.

  ```text
  release 1.0  3 planned · 1 shipped (counted, not listed) · 0 dropped
    the current release — the first in `releases:` not fully shipped
    shipped at v1.0 4f2a9c1e07b3, since the root — the first release that names a ref
    planned, not shipped   1
      TASK-12  Export to CSV  done · P2 · not in v1.0
    shipped, unplanned     1
      TASK-15  Retry banner   done · P3 · in v1.0
  ```
- `--env` is refused beside `--release`, because the comparison is with the
  last stage by definition.

```bash
branchling deploy status --release 2026.11 --count   # counts only
branchling query --release 2026.11                     # every task planned for it
branchling query --release ""                          # open tasks planned for none
```

**One task at a time** is `show <ID>`. It prints the facts computed about a
task that its file does not hold — the deployment state per target and stage,
the task's status on other branches and worktrees where it differs from this
tree, and each `blocked_by` task with its status — under a one-line header. The
body is never reprinted; the file is one `cat` away.

```text
TASK-14  Retry failed uploads  done · P1

deploy
  trunk      refs/remotes/origin/main 3f1c2a9b0d4e  (the remote's default branch)
  web        test full, production partial (refs/deploys/web/production-eu)
  frontend   unobservable — deployed from `acme-frontend`, which is not read here
  refs read  web/test  origin/main  3f1c2a9b0d4e
             web/production  refs/deploys/web/production-eu  9a0b1c2d3e4f
             web/production  refs/deploys/web/production-us  1b2c3d4e5f6a

elsewhere
  feature/retry-backoff: in_progress

blockers  not blocked — every blocker is closed
  ✓  TASK-9  done  Upload queue persists across restarts
```

- **The trunk is chosen as in `deploy status`**: the remote's default branch,
  else `HEAD`, and the line says which.
- **A task no commit names says so**, and a target in another repository is
  `unobservable` — neither reads as "deployed nowhere".
- **A blocker is resolved when its status is archived**, the rule `next`
  dispatches on; an id that names no task in this tree still blocks.
- **An unknown id exits 1**; `--json` carries the same three sections, kind
  `task-show`.

One declaration per product shape:

```yaml
# Web application or API, a branch per environment
deploy_targets:
  - name: web
    stages:
      - { name: test, ref: origin/main }
      - { name: production, ref: origin/production }
```

```yaml
# Web application, trunk-based: CI moves a ref after each deploy, e.g.
#   git push --force origin <sha>:refs/deploys/web/production
deploy_targets:
  - name: web
    stages:
      - { name: trunk, ref: origin/main }
      - { name: staging, ref: refs/deploys/web/staging }
      - { name: canary, ref: refs/deploys/web/canary }
      - { name: production, ref: refs/deploys/web/production }
```

```yaml
# Desktop or mobile application: releases are tags
deploy_targets:
  - name: desktop
    paths: [desktop/]
    stages:
      - { name: tagged, ref: "refs/tags/desktop-v*" }
  - name: mobile
    paths: [app/]
    stages:
      - { name: tagged, ref: "refs/tags/mobile-v*" }
```

```yaml
# Library or CLI published to a registry, where CI publishes every tag
deploy_targets:
  - name: package
    stages:
      - { name: published, ref: "refs/tags/v*" }
```

```yaml
# GitFlow: release branches, newest by version
deploy_targets:
  - name: app
    stages:
      - { name: trunk, ref: origin/develop }
      - { name: release, ref: "refs/remotes/origin/release/*" }
      - { name: production, ref: origin/main }
```

```yaml
# Regions deployed separately, or maintained release lines patched in parallel
deploy_targets:
  - name: api
    stages:
      - { name: test, ref: origin/main }
      - name: production
        refs: [refs/deploys/api/production-eu, refs/deploys/api/production-us]
  - name: lib
    paths: [lib/]
    stages:
      - name: maintained
        refs: [origin/release-1.x, origin/release-2.x]
```

```yaml
# Several deployables in one repository
deploy_targets:
  - name: api
    paths: [api/]
    stages:
      - { name: production, ref: refs/deploys/api/production }
  - name: worker
    paths: [worker/, shared/]
    stages:
      - { name: production, ref: refs/deploys/worker/production }
```

A project with no environments omits the key, and nothing changes.

**A deployable whose code lives in another repository is unobservable.** A
backlog in one repository whose tasks are partly implemented in another — a
separate frontend repository, a desktop client in its own — cannot see those
commits from its own git, and the tool does not read the other repository.
Declare such a target with `repository:`, and name it on each task implemented
there in the task's own `target:` field:

```yaml
deploy_targets:
  - name: api
    stages:
      - { name: test, ref: origin/main }
      - { name: production, ref: refs/deploys/api/production }
  - name: frontend
    repository: acme-frontend     # the other repository's name, as in `acme-frontend#src/app.ts`
```

```yaml
# in the task's frontmatter
target: [frontend]                # or `new --target frontend`
```

- **Its tasks are the ones naming it in `target:`**, because a task
  implemented elsewhere has no commit here whose paths could assign it. The
  field is a list (a task may span two other repositories) and its vocabulary
  is the names of the targets carrying `repository:`, closed even when empty:
  an undeclared name or a target of THIS repository fails `new --target`,
  `check --vocabulary` and the viewer — a local target's tasks are computed
  from the paths their commits touch, and a membership typed by hand would
  contradict that. A label never selects a target's tasks: a label is a
  category. `labels:` on a target fails the configuration with a hint naming
  `target:`.
- **`paths` and `stages` are refused on it**: both are read against THIS
  repository's git, so a path would hand this repository's commits to the
  other one, and a stage ref would resolve in the wrong repository and read
  like an answer about the right one.
- **`deploy status` gives it a lane of one bucket, `unobservable here`**,
  naming the repository and listing its tasks with their status — never in a
  stage, never as waiting for one. A closed task of such a target is not
  counted among the closed tasks no commit names. With `--release`, a planned
  task of it is listed under `planned, unobservable here` rather than as not
  shipped, unless a target of this repository it also touched still lacks it.
- **The gate reports no gap on its account.** `done-not-on-trunk` and the
  every-target fallback of `planned-blocker-open` skip its tasks; commits this
  repository does hold are judged as always, so a task split across both
  repositories is still judged on this half. The report says how many tasks
  each such target holds, so what was not looked at is named.
- **`--env`, `--target … --env` and `deploy record` refuse it**: it has no
  stage that can be read or moved here. Reading the other repository's refs is
  deliberately not done.
- **`query` names it.** In `--json` every task's `deploy` carries
  `unobservable`, the targets in another repository it belongs to (`[]` for
  none), so a task implemented elsewhere does not read as "no commits, deployed
  nowhere". A stage typed without a target (`--env production`) asks about every
  target the task belongs to, so such a task matches neither `--env` nor
  `--not-env` when the other repository's half would decide the answer: when
  this repository holds nothing of it, or holds it in that stage in full. A half
  here that is not in the stage still matches `--not-env`, and `target/stage`
  for a target of this repository is unaffected. The tasks held out are named
  per target — in the text output, on stderr beside `--count` and `--files`, and
  in `--json` as `deploy.unobservable`.

**A stage git cannot observe is recorded.** Store review, an update channel, a
staged rollout reaching 100%, a customer's installation, a sign-off on the test
environment: nothing in git moves when they happen, and the tool does not query
stores, flag systems or CI providers. Declare the stage `recorded: true`, and
whoever knows — a CI step or a person — calls `deploy record`:

```yaml
deploy_targets:
  - name: mobile
    paths: [app/]
    stages:
      - { name: tagged, ref: "refs/tags/mobile-v*" }
      - { name: review, ref: refs/deploys/mobile/review, recorded: true }
      - { name: rollout, ref: refs/deploys/mobile/rollout, recorded: true }
  - name: server
    stages:
      - { name: published, ref: "refs/tags/v*" }
      - name: installed                       # one ref per customer
        refs: [refs/deploys/server/acme, refs/deploys/server/globex]
        recorded: true
```

```bash
branchling deploy record --target mobile --stage review mobile-v2.4.0 --reason "approved by the store"
branchling deploy record --target mobile --stage rollout mobile-v2.4.0 --reason "staged rollout at 100%"
branchling deploy record --target mobile --stage rollout mobile-v2.3.1 --reason "rollout halted: crash on start"
branchling deploy record --target server --stage installed --ref acme v1.8.0 --reason "Acme upgraded"
```

- **The ref moves onto an annotated tag object** whose tagger is the actor,
  whose date is the moment of the record, and whose message carries the reason
  and the commit the ref stood at before. So a recorded stage is still a git
  ref: every reader sees the commit, `git push` shares it, and `git cat-file
  tag <ref>` reads the record back. No `refs/tags/` entry is created.
- **`deploy status` names who recorded each stage, when and why**, under the
  ref's line, and in `records` with `--json`.
- **It prints the push command and never pushes.** Another clone sees the
  record only once its fetch refspec carries `refs/deploys/*`; the output and
  `doctor` print the line that adds it.
- **It refuses** a stage not declared `recorded` (moving a ref git observes by
  hand would assert a deployment nobody made), a missing or reserved
  `--reason`, a stage of parallel refs without `--ref`, and a commit the
  previous stage does not hold — or a previous stage that does not resolve,
  because "cannot tell" is not "yes". The first stage has no previous stage to
  ask.
- **A move backwards is accepted** — it is how a halted rollout is recorded —
  and the output names the direction: `first`, `unchanged`, `forward`,
  `backward` or `diverged`.
- **A recorded stage's refs are full names outside `refs/heads/`,
  `refs/remotes/` and `refs/tags/`, never globs**: the tool writes them, and a
  branch, a remote-tracking ref or a tag is moved by something else. By
  convention they live under `refs/deploys/<target>/`.

#### The release gate

`check --release` asks whether a promotion has a gap in its traceability, and
names the commit or task that proves each one:

| Gap | What it means |
|---|---|
| `untracked-commit` | a deployed commit names no task id |
| `open-task-deployed` | a deployed commit names a task that is still open |
| `partial-task` | some of a task's commits are in a ref and later ones are not, or one parallel ref holds it and another does not |
| `stage-only-commit` | a stage holds a commit the trunk or an earlier stage lacks — the next ordinary promotion reverts it |
| `done-not-on-trunk` | a task closed as done whose commits exist only on a branch or remote the trunk never received |
| `unknown-task-id` | a deployed commit names an id no task file carries |
| `untargeted-commit` | a deployed commit touches no declared target's paths |
| `planned-blocker-open` | a task at the top of `priorities:`, planned for the current release (the first in `releases:` not fully shipped), is still open — reported against the last stage of the targets its commits touched, or of every target when it has no commit yet (unless it belongs to a target in another repository) |

In CI it is one line before the deploy step:

```bash
branchling check --release --env production --trunk origin/main
```

- **`release_gate: report`** (the default) prints the gaps and exits 0;
  **`release_gate: require`** exits 1 on any gap `release_gate_accept` does
  not name, on any stage ref that does not resolve, and on a trunk that does
  not resolve in a repository that has commits (a mistyped `--trunk`, a CI
  clone that never fetched the remote default branch) — a gate that could
  not look must not read as one that found nothing. An accepted gap is still
  printed, marked `(accepted)`; an unknown gap name in `release_gate_accept`
  fails the configuration.
- **The trunk is named in every report.** Without `--trunk` it is the remote's
  default branch (`refs/remotes/origin/HEAD`), else `HEAD`. A CI checkout
  often records no remote default, so pass `--trunk` there.
- **Commits older than the first one naming a task id are not judged** — the
  history before a project adopted ids cannot be repaired by any future
  commit — and the report says how many were left out.
- **`--env`** judges one stage (`stage` or `target/stage`); `done-not-on-trunk`
  is a question about the trunk and is asked either way. `--json` carries the
  whole report as the `report` of the `release` guard.
- **It is never part of a bare `check`**, which is the verdict on publishing
  the backlog, not on promoting a deployment.

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
| `verification` | required | non-empty; a command string, or `{ "id", "bash" \| "manual", "proves" }`. Any character is written as itself except a line break or other control character, which is refused: an entry is one line |
| `estimate` | optional | free text, e.g. `"2h"` |
| `priority` | optional | a value from *your* `config.yaml` |
| `epic` | optional | free text, the group the task counts towards |
| `role` | optional | a value from *your* `roles:` |
| `executor` | optional | `human` or `agent` |
| `labels` | optional | array; under `labels_closed: true`, values from *your* `labels:` |
| `related_docs` | optional | array of paths relative to the repository root |
| `wave` | optional | an existing wave of `plan.yaml`; the task is scheduled there as `new --wave` does, and an order the plan guard rejects rolls the whole seed back |

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

**Two loops in one area collide even on two different tasks.** `conflict_group:`
on a task names the area it touches — a module, a migration sequence, any value
your project chooses — as a list. `next` and `run` do not hand a task out while
another task sharing one of its groups is in progress in this tree, or is
reported in progress by another worktree or branch through the same scan that
keeps two sessions off one task. For a backlog that will not acquire a new field
by hand, `conflict_group_from: <field>` in `config.yaml` reads the group from
`epic`, `board`, `labels`, `type` or `role` for every task that names none; a
task's own `conflict_group:` replaces that default rather than adding to it,
and without the key there is no default at all. The skipped tasks are named
with the group and the task holding it (`skippedConflict` in `next --json` and
`run --json`, each `{id, group, heldBy}`); `take <ID>` still works.

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

The server listens **on 127.0.0.1 only**. Starting it while it is already
running only opens a tab; an `/api/ping` probe checks the identity of the
process, so a stranger's service on that port is not mistaken for ours.

There are two modes of the same generated page. **Snapshot mode is read-only:**
opening `viewer.html` from disk reads the data embedded at build time and never
writes a task. **Live mode is the only viewer mode permitted to write:** the
loopback server knows the backlog path, can validate a field through the same
schema as the CLI, can attribute the person and can append history before it
rebuilds computed views. No browser-only or folder-handle write path is part of
the contract.

The served page now receives a short-lived per-process capability for one
`/api/task` mutation route. The server rejects foreign origins and hosts, stale
or guessed capabilities, unknown fields, invalid actors, oversized bodies,
path-shaped ids and status transitions missing a configured reason. A passing
edit is attributed in history, rebuilds the computed views and emits the same
SSE change signal used for edits made outside the viewer. Inline controls are
implemented separately; a mailed snapshot remains read-only and receives no
capability or mutation route.

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

**The Release tab** shows the same answer as `deploy status`, drawn as a
board: one lane per deploy target, and one column per step of its promotion —
closed but not merged, on the trunk, then each stage from `deploy_targets`. A
card sits in the last step it has fully reached; a card whose next stage holds
only some of its commits, or only some of a stage's parallel refs, carries a
**PARTIAL** marker naming which refs hold it. Below the lanes, a panel lists
the gaps `check --release` reports. The state is read from git when the page is
built, so the tab prints the build time and the SHA of every ref it read —
rebuild to see where the refs are now. Environments are not boards: the board
scope and the filters narrow the cards here exactly as they narrow the list, and
the link carries them (`viewer.html#release?board=main&epic=Payments`). A project
with no `deploy_targets` sees no tab. A target whose code lives in another
repository (`repository:`) is a lane of one column, **Unobservable here**,
holding the tasks that name it in `target:` — never placed in a stage.

**The dashboard contract** reserves a URL-addressable view of throughput, queue
health, epics and plan waves. The current page does not expose that tab yet; its
restoration follows the same rule as every other viewer control: state that a
recipient must reproduce belongs in the URL, while identity and write
capabilities never do.

**Field history** is a separate, committed file — `history/<ID>.jsonl`,
append-only, one line per field change. A future live-viewer write uses
`source: "viewer"`; current entries come from the CLI or a reconciled manual
edit:

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
| `query` | `task-list` | `tasks`, `total` (matches BEFORE `--limit`), `limit`, `scope` (active, archived or all — which tasks `--scope` searched; null when `--status` chose the statuses), `scan`, `modifiedFile`, `deploy` (null unless deployment state was computed — then the trunk with its SHA and its source, remote-default or head, and every ref read, each with its SHA, and an unobservable list: per target in another repository, the tasks `--env`/`--not-env` held out because that repository would decide them, empty without such a filter; each task then carries its own `deploy` per target and stage, whose unobservable list names the targets in another repository it belongs to), `elsewhereOnly` (the tasks only another branch has) |
| `stats` | `stats` | `root`, `stats` (the tallies), `scan`, `divergent` (one row per task another branch disagrees with), `elsewhereOnly` (the tasks only another branch has), `context` (null unless `--context`: the measured cost rows), `agentTime` (null unless `--agent-time`: per-estimate buckets from the ledger, the verdict, and what could not be measured) |
| `doctor` | `doctor` | `ok`, `root`, `next`, `checks` |
| `vocabulary` | `vocabulary` | `root`, `statuses` (in declared order, each with its name, whether it is archived, whether entering it requires a reason, its role — open, active, waiting, closed or cancelled — and the role's source: status_roles when declared, derived otherwise), `priorities`, `types`, `confidence`, `estimates` (each in declared order), `labels`, `labels_closed`, `boards` (each with its slug, name and whether it is the default), `roles`, `releases` (each with its name and the ref it ended at, null until shipped), `deploy_targets` (each with its name, its repository — null unless it lives in another one — its paths and its stages, each with its name, refs, whether they are parallel and whether the stage is recorded). Every key is the config.yaml key it comes from |
| `where` | `where` | `home`, `homeSource`, `config`, `data`, `preferences` (path and whether it exists), `agentProfiles` (path and whether it exists), `backlog` (the root and the rule that found it; null when none was found), `error` (why none was found) |
| `serve --list` | `serve-list` | `servers` (one row per registered viewer, each carrying its own state: running, stale — the entry outlived its process — or elsewhere, meaning another host wrote it and this one may not judge it), `stateDir`, `host` |
| `serve --stop` | `serve-stop` | `stopped` (one result per port asked about, each naming an outcome: stopped, already-gone, not-registered, not-ours, elsewhere or would-not-stop), `requested` |
| `check` | `check` | `ok`, `root` (null when no backlog was found — then `failed` is backlog and `guards` holds that one entry, whose output is the sentence the human form prints; exit 1), `failed` (the guards that failed), `guards` |
| `board` | `board` | `board`, `rule`, `matched`, `isDefault`, `reason` |
| `next-id` | `next-id` | `nextId`, `id`, `prefix`, `max`, `source`, `trees`, `branches`, `known` |
| `instructions` | `instructions` | `topics`, `topic`, `role`, `text`, `version` |
| `profile list/show` | `agent-profiles` | `path`, `exists`, `profiles`, `profile` |
| `profile check` | `profile-check` | `ok`, `path`, `live`, `results` |
| `conformance` | `adapter-conformance` | `ok`, `version`, `adapter`, `results`, `failures` |
| `plan` | `plan` | `ok` (false only on a refusal), `root`, `exists`, `updated`, `rationale`, `waves` (each with its index, name, tasks — each task with its id, title, status and blocked-by list, read from closed task files as well, and whether it is known, open and for which executor — together groups, open and closed counts, whether it ends on a person, whether it is active), `activeWave`, `nextUp`, `inProgress`, `unplanned`, `coverage`, `stale`, `inProgressStatus`, `refusalKind` (plan-unparsable, plan-contradicts-blocked-by or plan-contradicts-tree — exit 1; plan-exists from `plan init`), `refusal`, `problems` (every problem, unparsable ones with their line numbers) |
| `seed` | `seed` | `ok`, `root`, `dryRun`, `created`, `errors` |
| `import` | `import` | `ok`, `root`, `dryRun`, `created`, `wouldCreate`, `skipped`, `droppedLabels`, `withoutVerification`, `errors` |
| `<command> --help` | `command-help` | `command`, `summary`, `usage`, `configured`, `flags` |
| `pr-summary` | `pr-summary` | `base`, `scanned`, `reason`, `tasks`, `engaged`, `cost` |
| `audit` | `audit` | `since`, `dayZero`, `tasks`, `findings`, `closedWithoutTrace`, `skippedBeforeSince`, `reopened`, `parked`, `withoutPremise`, `awaitingVouch`, `handedBack`, `vouches`, `contractCapability`, `advisories` |
| `run` | `run` | `ok`, `dryRun`, `agent`, `profile`, `agentFor`, `profileFor`, `delegation`, `allowUncontrolledDelegation`, `plan`, `order`, `considered`, `stoppedAt`, `stopped`, `agentNeverRan`, `waitingForRole`, `waitingForExecutor`, `waitingForSize`, `tally`, `sharedState`, `ms`, `tasks`, `skippedHandedBack`, `skippedDeadlocked`, `skippedConflict`, `spinGuard`, `stopRequested`, `beforeNextRefused`, `stateCommitRefused`, `heldInOtherTrees`, `waited` |
| `run --stop` | `run-stop` | `ok`, `requestedAt`, `by`, `origin` (the clone the request reaches), `path` |
| `take`, `next` | `task-take` | `ok`, `taken`, `id`, `file`, `task`, `from`, `text`, `decisions`, `probe`, `warnings`, `reclaimed`, `tookOver`, `lock`, `refusalKind`, `refusal`, `details`, and — filled in by next — `passedOver`, `considered`, `searchedStatuses`, `skippedBlocked`, `skippedElsewhere`, `closedElsewhere`, `skippedExecutor`, `skippedHandedBack`, `skippedDeadlocked`, `skippedSize`, `skippedByRecord`, `skippedConflict`, `scan`, `plan` |
| `handoff` | `task-handoff` | `ok`, `id`, `file`, `task`, `role`, `owner`, `status` (each a from/to pair), `comment`, `released`, `warnings`, `refusalKind`, `refusal`, `details` |
| `body` | `task-body` | `ok`, `id`, `file`, `changed`, `body` (the from/to pair of `sha256:` body hashes), `lines` (added, removed), `entry` (the history entry's id, ts, actor and reason; null when unchanged), `refusalKind`, `refusal`, `details` |
| `release` | `task-release` | `ok`, `id`, `status`, `owner`, `released`, `comment`, `refusalKind`, `refusal`, `details` |
| `set` | `task-set` | `ok`, `id`, `file`, `field`, `value`, `actor`, `changes` (the history entries the write appended), `refusalKind` (unknown-value for a value outside the field's vocabulary — exit 1; usage for an unknown field or a malformed value), `refusal`, `details`, `rejected` (the field and the value refused as unknown-value), `declared` (the values that field accepts) |
| `set --fields` | `task-set-fields` | `root`, `fields` (each field set edits: its name, whether it is a list, whether it may be cleared, the config.yaml key a value must come from — the key vocabulary answers under, null for free text, task ids or a fixed vocabulary — the key its values are only suggested from, and the values of a vocabulary the tool fixes) |
| `deploy status` | `release-status` | `ok` (false only on a refusal), `trunk` (the ref whose commits count, its SHA, and whether it is the remote's default branch or HEAD), `scan` (every ref read, with its SHA), `explanation` (why an empty answer is empty), `filter`, `targets` (per target its repository — null unless its code lives in another repository, whose lane is one unobservable bucket — and its buckets in pipeline order — each with its kind, stage, label, count, whether it is unknown and which refs made it so, whether it is listed — the last stage is counted, not listed — and its tasks, each with the status, the day it closed, the wait in days, its state in the stage and the parallel refs holding it), `unplaced` (closed tasks no commit names, other than those of a target in another repository), `release` (with `--release`: the release name, how many tasks it plans, how many shipped — counted, not listed — and five lists, notShipped, open, unplanned, dropped and unobservable, each a count and its tasks; every task carries its status, priority, release, commit count, where it stands per target, and a note such as no-commits, unknown or unobservable. Null without the flag), `records` (per recorded stage ref: who recorded it, when and why), `refusalKind` (unknown-name when `--release`, `--target` or `--env` names nothing declared — exit 1), `refusal`, `rejected` (the flag and the value it was given), `declared` (what that flag accepts; empty when nothing is declared) |
| `deploy record` | `release-record` | `ok`, `target`, `stage`, `ref`, `commit`, `tag` (the annotated tag object the ref now points at), `previous` (the commit it stood at before, null on the first record), `direction` (first, unchanged, forward, backward or diverged), `actor`, `reason`, `recordedAt`, `remote`, `push` (the command that shares the record — printed, never run), `fetchFix` (the refspec other clones need, null when the remote fetches the ref), `refusalKind`, `refusal`, `details` |
| `declare` | `vocabulary-declare` | `ok`, `key` (releases or deploy_targets), `name`, `entry` (the entry as written: name and ref for a release; name and repository, or name, paths and stages, for a target; null on a refusal), `reason`, `file` (the config.yaml written, null before one was found), `refusalKind` (usage, undeclared-key, malformed, duplicate, form, unreadable, invalid or disturbed), `refusal`, `details` |
| `ask` | `task-ask` | `ok`, `id`, `file`, `question` (its event id, timestamp, text and asker), `changes`, `blockedReason`, `refusalKind`, `refusal`, `details` |
| `decide` | `task-decide` | `ok`, `id`, `decision` (its event id, timestamp, text, actor, the question it resolves and the option it chose), `chosen` (the option number, the menu's size and its recommendation; null when the answer was typed), `openQuestions` (what is still unanswered, each with its options), `lifted` (the status the decision unblocked, null when nothing waited on it), `actorSource` (which source named the actor: flag, env, config — the user configuration — or default, the agent fallback nobody stated), `refusalKind` (actor-required under `--require-actor` when the actor would be the default), `refusal`, `details` |
| `done` | `verification-run` | `ok`, `task`, `dryRun`, `closed`, `entries` (one per `verification:` entry, with its exit code), `status`, `wouldBe`, `ticked`, `capability`, `refusalKind`, `refusal`, `details` |
| `resume` | `resume` | `ok`, `id`, `file`, `actor`, `owner`, `base`, `mergeBase`, `verified` (false under --no-verify: the contract was not re-run, which is not the same as a contract with no entries), `decisions`, `goal`, `history`, `diff` (the merge-base range: what this branch COMMITTED), `uncommitted` (what it left on disk in no commit: a patch of tracked edits, a list of untracked paths, and a reason — a null in any of the three means the working tree could not be read, not that it is clean), `verification` — the parts in the order the briefing fixes them — `refusalKind`, `refusal`, `details` |
| `show` | `task-show` | `ok`, `id`, `title`, `status`, `priority`, `confidence`, `blocks` (the declared reverse links), `file`, `deploy` (null when the project declares no deploy targets; otherwise whether the scan ran, its reason and explanation, the trunk with its SHA and whether it is the remote's default branch or HEAD, every ref read with its SHA, and the task's own answer: its commit count, the commits touching no target, the targets in another repository it belongs to as an unobservable list, and per target each stage's state with the refs behind it), `elsewhere` (the task's status on other branches and worktrees where it differs), `scan` (whether that scan ran and what it read), `blockers` (each blocked-by task with its title, status, whether it is resolved, whether it exists in this tree, and its own elsewhere), `blocked` (the verdict, by the rule next dispatches on), `body` (with `--body`: the markdown after the frontmatter, verbatim, "" when there is none; null without the flag), `refusalKind`, `refusal`, `details` |
| `follow` | `change-stream` | ONE envelope per line, not one per run: `event` (ready once the watch is armed, then change or heartbeat), `at`, `root` (on every line, so several streams can be told apart), `id`, `file`, `change` (created, modified or deleted), `fields` (the tracked fields that moved, with the history name for the body when it moved; the updated date is never reported) |
| `log --open-questions` | `open-questions` | `root`, `total`, `questions` (every unanswered question on an active task, oldest first, each with the task, its title and status, the event id decide resolves, the question, who asked and when, the options and the recommendation) |
| `log` | `task-log` | `ok`, `id`, `title`, `file`, `path` (the log the answer came from), `records` (raw entries) and `total` (the exchanges they fold into — the ratio is what the fold is worth), `matched` (the exchanges left after the filter — equal to `total` when there is none) and `decisions` (whether `--decisions` narrowed the answer to what was settled and what is still open), `limit`, `exchanges` (one per write: its time, actor, source, session, role, the reason ONCE, the changes that moved, its events and its messages — a message whose text is null is that reason again, kept for its event id; a question carries its options and recommendation), `modifiedFile` and `tasks` (the computed area and its matching tasks when `--modified-file` selects decisions by path; otherwise null and empty), `refusalKind`, `refusal`, `details` |
| `red` | `red-owners` | `command`, `ran` (a report nobody gave is not an empty one), `reason`, `exitCode`, `files` (each failing test file with the task its commits name and, with `--repairs`, open sibling-branch repairers), `mine`, `tally`, `repairScan` (null unless requested; then whether the cross-branch scan ran and which branches it read) |
| `docs-drift` | `docs-drift` | `documents`, `minSignals`, `flagged`, `tooLittle`, `seeded` (absent unless `--seed-tasks` ran) |

**`agent_estimate` is a computed field, not a stored one** (TL-482). Every task
row in `query --json` and the `task` that `next --json` hands over carry it:
what agents took on closed tasks with the same `estimate`, read from
`backlog/history/` on every call — `label` (the p20–p80 range), `median`,
`p20` and `p80` in minutes, `n`, and the `verdict` of `stats --agent-time`.
It is `null` until that estimate has `agent_time_min_n` measured closings, and
it is never written into a task file, so it cannot go stale and never shows in
a diff. The viewer shows the same value as a badge on the card and a row in the
detail panel.

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
