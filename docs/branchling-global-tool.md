# branchling as a global tool — home directory, project registry, extensibility

**Status:** PROJECT (2026-08-30) — none of this is implemented
**Concerns:** `backlog/` as the `branchling` tool ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md) — working name)
**Predecessors:** [backlog-config-and-portability.md](backlog-config-and-portability.md) (the data directory as an argument), [branchling-state-and-sync.md](branchling-state-and-sync.md) (where the truth lives), [backlog-time-tracking.md](backlog-time-tracking.md) (time tracking — its log's location is about to change)
**Tasks:** [TL-33](../backlog/tasks/TL-33-packaging-instalacja-globalna-i-npx.md) · [TL-34](../backlog/tasks/TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) · [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md) · [TL-36](../backlog/tasks/TL-36-widok-przekrojowy-nad-wieloma-projektami.md)

---

## 1. The question

Should `branchling` be a **global** tool — installed once for the user, with
its own home directory and project registry — or remain a module living
inside a single repository?

Answer: **global, but only as a program and pointers. Task data stays in the
repositories.** This document records the boundary between the two, the laws
that guard it, and the extension points through which the tool is meant to
grow without breaking compatibility.

## 2. Existing state — most of this work is already done

| Capability | State | Where |
|---|---|---|
| The data directory is an **argument**, not a property of where the code sits | ✅ done (TL-18) | `paths.mjs`: `--dir` → `BACKLOG_DIR` → detection upwards from cwd → co-location |
| Detection requires a **marker**, not `tasks/` alone | ✅ done | `looksLikeBacklogDir()` — a foreign repo with a `tasks/` directory is more common than it seems |
| Code knows the SHAPE, configuration knows the VALUES | ✅ done (TL-19) | `config.yaml`, an unknown key FAILS |
| `init` into a foreign directory, with no guessing and no overwriting | ✅ done (TL-23) | `init --dir` mandatory, an existing file skipped and reported |
| **Installation** — `package.json`, `bin/`, `npx branchling` | ❌ **MISSING** | the documentation promises `npx branchling`, but the module is not installable |
| A user home directory, a project registry | ❌ missing | not a single `homedir()` or `XDG_` anywhere in the module |

> Conclusion: "making this a global tool" is 80% **packaging what already
> works**, not a rebuild. The one hard gap on this path is packaging.

## 3. Four laws

Extensibility comes from a small number of rules that hold across every new
feature — not from a plugin API. These four are this module's contract, and
every future change should rest on them.

### Law 1 — data in the repository, pointers globally

Tasks, field history and project configuration live in the repo, next to the
code. The home directory holds **only**: user preferences, a registry of
paths to projects, and data private to the machine (§6).

Why not the other way round: a task in git travels with its branch, goes
through review in a PR, clones with the repository, and `git log` on its file
is its history. Moving tasks to `~/.branchling/projects/foo/` reproduces
exactly the defect that [branchling-state-and-sync.md §4.3](branchling-state-and-sync.md)
rejected Jira and Linear for: **state divorced from the branch.** Files being
local instead of in someone else's cloud only changes who owns the
divergence, not the divergence itself.

### Law 2 — what is computed may be deleted

Views (`INDEX.yaml`, `NOW.yaml`, `boards/`), a future SQLite index, the
project registry, activity aggregates — **every one of them must be
deletable with nothing lost.** Rebuilding is a command, not a recovery.

This is a correctness test, not a declaration: if deleting the registry
hurts, it means the registry has become a truth, and then the defect is in
the design, not in the user who deleted it.

**Computed is not the same as reconstructible** (TL-86). A checked checkbox
in `## Acceptance criteria` is COMPUTED — the tool sets it after a green
`verification` run, not a human — and yet it travels in a versioned file and
must not be deleted. This is not a breach of this law, but the boundary it
runs along: a view can be **rebuilt from the task files alone in one
command**, while the result of a run that already happened can only be
recreated by running it again — against a tree that has since moved on. That
is not the same question and does not have the same answer.

The deciding criterion, then: *is it enough to reconstruct this from the task
files?* If yes — it is a view, delete it freely. If it also needs the TIME at
which something happened — it is an event record, the same class as a line in
`## Log` or an entry in the field history, and falls under law 1, not law 2.

### Law 3 — a layer adds only what the other cannot know

Two configuration layers are a guaranteed drift, as long as both can speak
about the same thing. The boundary is therefore **disjoint, not
prioritised**:

| Layer | Holds | Examples |
|---|---|---|
| **user** (`~/.branchling/config.yaml`) | what is a fact about the HUMAN and their machine | actor identity, editor, theme, default port, date format |
| **project** (`<repo>/backlog/config.yaml`) | what is a fact about the PROJECT | statuses, priorities, types, labels, boards, colors, `title_max_length` |

**The user layer has no right to override the project's vocabulary.** If it
could, two people would see different boards for the same repository, and
the module just finished moving these values into `config.yaml` precisely so
they would be one truth. A key declared in the wrong layer **FAILS**, exactly
like an unknown key fails today — a typo in the layer is indistinguishable
from "this project just works that way".

### Law 4 — extensibility through composition, not a plugin API

A plugin API is a compatibility contract that cannot be broken once the first
external user exists, and one person maintains it. Instead:

- **every reading command has `--json`** — this is the extension surface.
  Since TL-72 the response is an ENVELOPE (`schemaVersion`, `kind`, payload),
  not a bare array: a bare array has nowhere to hold metadata, so every added
  field would be a breaking change. The envelope shape is declared by
  `scripts/json-envelope.mjs`, the contract is written up in the README;
- **every writing command has a form callable from outside**
  (`activity record`, `new`, `set`), so an outside script, hook or other
  host feeds `branchling` without knowing its internals;
- the subcommand vocabulary (`COMMANDS` in `cli.mjs`) stays **closed**,
  because an unknown command should fail, not stay silent.

Effect: integrating with WakaTime, someone else's CI, or any editor is a
script over a stable input/output, not a plugin inside someone else's
process. The paid/hosted version from
[branchling-state-and-sync.md §6](branchling-state-and-sync.md) enters the same way.

## 4. Breaking the idea down — two good parts, one bad one

| Component | Verdict | Reason |
|---|---|---|
| A global binary (`npm i -g`, `npx`) | ✅ YES | the missing piece; needed for publication regardless |
| `~/.branchling/` — preferences + a registry of **pointers** | ✅ YES | unlocks the cross-project view and time-tracking attribution |
| Tasks moved into the home directory | ❌ NO | breaks Law 1 |

### 4.1. What the registry does NOT buy

**It does not buy "finding the backlog".** Detection upwards from cwd already
does that, and does it well. A registry built for that would be a second
answer to a question that already has one — exactly the divergence Law 3
warns against.

### 4.2. What the registry genuinely buys

1. **A cross-project view** — "what am I working on across all projects".
   Impossible today, because no single place knows there is more than one
   project.
2. **Attributing time tracking outside the repo.** The heartbeat from
   [TL-28](../backlog/tasks/TL-28-heartbeaty-aktywnosci-i-lancuch-atrybucji.md)
   has to know not only *which task*, but *which project*. Without a
   registry, `activity record` needs `--dir` on every call; with one, it maps
   cwd → project.
3. **Privacy for the raw activity log** — §6. This is the single strongest
   argument for a home directory.

## 5. Where this directory lives

Not a hardcoded `~/.branchling`. An order consistent with what Linux users
expect, and that doesn't hurt anyone else:

```
1. BRANCHLING_HOME                                  → explicit, wins over everything (and this is the test hook)
2. $XDG_CONFIG_HOME/branchling  + $XDG_DATA_HOME/branchling   → when the variables are set
3. ~/.config/branchling + ~/.local/share/branchling    → Linux/macOS default
4. %APPDATA%\branchling                             → Windows
```

The **config vs. data** split matters here, and isn't cosmetic: preferences
are a file a human edits and backs up, while the activity log is machine
data nobody wants sitting among their dotfiles.

The directory name comes from **one constant**, because `branchling` is a
working name ([TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md))
— renaming the tool must not require searching through the code.

## 6. The raw activity log moves into the home directory

> **Implemented 2026-09-02 (TL-35).** `<data>/activity/<slug>-<hash>/BL-NNNN.jsonl`,
> keyed by the backlog PATH and never by the registry label — a label is the
> user's own and mutable, so deriving the directory from it would orphan
> somebody's log the first time they relabelled a project. `branchling activity
> migrate` moves logs written before the change, idempotently by row id.

[backlog-time-tracking.md §5](backlog-time-tracking.md) currently places it
in `backlog/activity/` and protects it with gitignore. That works until
someone runs `git add -A` in a foreign repository — at which point one
person's private time stamps land in public history and **cannot be removed
from there**.

In the home directory this accident is **impossible**, not merely
discouraged:

```
<data>/activity/<project>/BL-NNNN.jsonl   ← raw heartbeats, outside any repo
<repo>/backlog/activity/rollup/BL-NNNN.json ← per-task aggregate, versioned (unchanged)
```

The split of roles stays the same as in the time-tracking project: raw data
stays with the human, the aggregate travels with the project. The only
change is that "stays with the human" stops depending on a correct
`.gitignore`. Scope: [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md).

## 7. Project registry — an index, not the truth

```yaml
# <config>/projects.yaml
projects:
  - name: myproject
    path: /path/to/myproject/backlog
  - name: acme-api
    path: /Users/x/code/acme/backlog
```

Rules, all following from Law 2:

- **An entry is revalidated on use** (`looksLikeBacklogDir()`), never taken
  on faith.
- **A missing path is REPORTED, not silently skipped.** A silent skip turns
  "you moved the repo" into "this project has no tasks", which is the same
  shape of defect as a silent no-op in the CLI.
- **Deleting `projects.yaml` is harmless** — commands within a repo keep
  working through detection; only the cross-project view is lost. This is
  Law 2's test.
- **`init` registers the project**, but registration is not a condition for
  the tool to work.
- A project's name is **local to the user** (their own label on their own
  machine), not the project's identity. The repo path is the identity; two
  people can name the same project differently and nothing follows from
  that.

## 8. An edge case that must be tested: a multi-repository workspace

This workspace is one: the root is a repository **with no remote** holding
`backlog/`, and inside it are nine separate repositories with their own
`.git`. Running `branchling` from a sub-repo walks upwards and lands on the
workspace's backlog — and **that is correct**.

A naive registry assuming "one repo = one project" would clash with this
layout, yielding nine projects with no backlog and one that has one. Hence
the requirement: the registry's unit is the **backlog directory**, not the
git repository. A test on this layout is mandatory, because it is not an
exotic case — monorepos and multi-repository workspaces are more common than
a single repo with one `.git` at the top.

## 9. Order

| Step | Task | What it delivers | Risk |
|---|---|---|---|
| 1 | [TL-33](../backlog/tasks/TL-33-packaging-instalacja-globalna-i-npx.md) | `package.json` + `bin/` + `npx branchling` | low, decides nothing |
| 2 | [TL-34](../backlog/tasks/TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md) | home directory, preferences, registry | medium — Law 3 is at risk of being broken here |
| 3 | [TL-35](../backlog/tasks/TL-35-surowy-log-aktywnosci-do-katalogu-domowego.md) | raw stamps outside the repo | depends on TL-28 |
| 4 | [TL-36](../backlog/tasks/TL-36-widok-przekrojowy-nad-wieloma-projektami.md) | cross-project view | the only step that changes the product |

Steps 1–3 clear away things that block publication regardless. Step 4 is the
only one that gives the user something new — and that is why it comes last,
not first.

## 10. What we deliberately do NOT do

- **A background daemon.** The registry and heartbeats do not need a
  resident process; introducing one adds a lifecycle, logs, restarts and
  crashes to save reading a YAML file.
- **Syncing the home directory between machines.** This is the same problem
  [branchling-state-and-sync.md §6](branchling-state-and-sync.md) assigns to
  the hosted version. Locally: the home directory is local, full stop.
- **A plugin API** — Law 4.
- **Migrating existing installs.** There are no external users; the only
  install is this one. When there are, migration becomes a separate task
  with a real contract.
- **A pre-commit hook in THIS repository** (decision 2026-08-31). Tempting by
  symmetry with the consumer, but symmetry is a bad reason. The test that
  disproved this proposal: of four mistakes made in the session that raised
  it, **none** would have been caught by any of the three `check` gates —
  because what broke was prose, a regex, links and untracked files, not id
  collisions, boards or references. The gates earn their keep through SCALE —
  thousands of tasks, several parallel worktrees, and id collisions that can
  survive on `main` for months before anybody notices. A repository with one
  writer and no parallel sessions has none of those conditions.

  **The one specific condition that reverses this decision:** when more than
  one session starts writing in this tree at once. An id collision arises
  only that way: two sessions ask for a number, both get the same one. Until
  then, `branchling check` is one command and a human sees its result.

  This is **not** a decision about gates in the product — they already ship
  in the package (§10.1).

### 10.1. Three different things easily mistaken for one

Distinction recorded because in the 2026-08-31 conversation they collapsed
into one word, "gates":

| | Where it lives | Who gets it |
|---|---|---|
| **Gate code** — `check-backlog-{id-collisions,boards,refs}.mjs` | `scripts/`, covered by `files` in `package.json` | **every install**, as `branchling check` |
| **The consumer's `.githooks/pre-commit`** | the consumer's repository | nobody but them; of ~25 steps, two call `branchling check` |
| **A dogfooding hook here** | would live in this repo, OUTSIDE the package | only someone cloning the source — deliberately not done (§10) |

The conclusion that follows, and is a separate product decision: since the
gates ship to every install and the hook to none, the missing piece is not a
hook for us, but the **tool's ability to install a hook for its own user**.
Everyone has this problem, not just us. Recorded as TL-46.

## 11. Assumptions to be falsified

1. **That the registry will ever hold more than one entry.** Today there is
   one project. If after a quarter there is still one, step 4 had no
   audience and is better left unbuilt — and steps 1–3 justify themselves
   regardless.
2. **That detection upwards from cwd is enough in practice**, so the registry
   never becomes the main path. Falsification: if commands start requiring
   `--project`, it means the registry has quietly become the truth and
   Law 2 has been broken.
3. **That the config/data split (§5) will not surprise anyone.** A simpler
   `~/.branchling/` for everything is easier to explain; XDG is more correct.
   If the first reports are about "where is this even stored", the answer is
   `branchling where`, not abandoning XDG.

---

## 12. What is implemented (2026-09-02, TL-34)

The home directory and the registry. Until this, there was not one `homedir()`
in the module.

- `scripts/home.mjs` — the four rules of §5, PURE, with `process.platform`
  injected so the Windows branch is reachable from a test. **`config` and `data`
  are separate under every one of them**, and there is an assertion per rule
  rather than an intention: preferences are a file a human edits and backs up,
  the activity log is machine data, and the two want opposite answers to
  "should this sync between machines". `home` collapses onto `config` where the
  two are split — only an explicit `BRANCHLING_HOME` gives a real root — and that
  is stated rather than left to be discovered.
- **The user layer is loaded in `loadConfig()`, in ONE place, and joined
  DISJOINTLY.** Not per command: a user file holding a project key has to FAIL
  everywhere, because a `statuses:` in the wrong file that merely does nothing
  is the worst available outcome — the person believes they changed the
  vocabulary. The preferences land under `config.user`, a namespace nothing
  above ever reads from, so there is no precedence rule to get wrong. The test
  for Law 3 is structural: the two key sets are asserted DISJOINT, because a
  case-per-key test could only ever cover the keys somebody thought of.
- `scripts/registry.mjs` and `branchling project add|list|remove` — §7. The unit
  is the BACKLOG directory, and §8's layout has a test: nine repositories around
  one backlog are ONE project, and a command run inside one of the nine still
  finds the workspace's backlog by walking upwards. A missing path is REPORTED,
  never skipped. `init` registers, best effort — creating a backlog is what the
  user asked for, and an index entry is the tool's convenience.
- **Law 2 has a test rather than a paragraph.** With `projects.yaml` deleted,
  `query`, `stats`, `build`, `next-id`, `where` and `check` all still pass — and
  nothing recreates the file behind the user's back, because a read that writes
  turns "I deleted that" into "it came back".
- `branchling where` — the backlog this run would use, the RULE that found it,
  and this machine's own directories. The source is the half of the answer
  nobody can reconstruct afterwards. It creates nothing.
- **`no command takes `--project`` is a test**, checked against the command
  table (§11 point 2). The first command that needs it is the moment the index
  stopped being an index, and that drift would otherwise only be visible to
  somebody who remembered this paragraph.

**Deliberately NOT done: the preferences are not yet consumed by the commands.**
`actor` is resolved in eight separate places, each with its own chain, and two of
them already disagree about the fallback. Threading a ninth source through eight
copies is a refactor with its own thesis — the actor chain having one home — and
it is TL-157.
