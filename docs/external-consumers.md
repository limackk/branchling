# Building an interface on top of branchling

This document is for a person writing a program that sits on top of
branchling — a separate interface package, an editor panel, a reporting system
that aggregates several repositories. It says what that program may build
against, what it must not, and where the built-in viewer stops so the two do
not duplicate each other.

The short version: **build against the command line, never against
`scripts/`.** The fourth law (`docs/branchling-global-tool.md` §3) makes
`--json` on every reading command and a callable input on every writing command
the only extension surface. There is no plugin API, and the modules under
`scripts/` are internals that move without notice.

The detailed payload of every kind — each key and what its empty value means —
is in [the `--json` contract of the manual](manual.md#the---json-contract).
This document is the map; the manual is the legend.

## The three channels

| Channel | Shape | Use it for |
|---|---|---|
| `branchling <command> --json` | one process per call, one envelope on stdout, an exit code | every read and every write |
| `branchling follow --json` | one long-lived process, one envelope per LINE | learning that something changed, so a view can re-read |
| `branchling mcp` | one long-lived process speaking JSON-RPC 2.0 on stdio | a host that reaches tools through the Model Context Protocol |

**The command line is the contract.** Spawn the installed binary, pass
`--dir <path>` so the answer is about the backlog you mean rather than the one
discovered from the working directory, and read stdout as JSON. Never parse
the text output: it is written for a person and is reworded freely.

**`follow --json` is a signal, not a replica.** A `change` line names the task,
the file and the fields that moved; it does not carry their new values. Re-read
with `show --json` or `query --json` when a line arrives. It watches the files
of one tree only — other worktrees and branches are not reported — and a
`heartbeat` line says the stream is alive when nothing moved.

**`mcp` is the same commands behind a different transport.** Each tool call
spawns the same CLI entry point a shell uses, so a refusal comes back as the
CLI's own refusal and `isError` mirrors a non-zero exit. Pass `json: true` in a
tool's arguments to receive the envelope as the text content; that text is
stdout followed by stderr, so parse the first JSON value rather than the whole
string. A tool call has no stdin, so a write whose input arrives on stdin uses
its file form instead (`body --body-file`, `new --body-file`). The process is
long-lived, but every call is request and response: MCP is not a change stream,
and `serve`, `run`, `mcp`, `regen-hook` and `follow` are deliberately not
exposed as tools. An interface that needs changes pushed to it runs
`follow --json` beside it.

## The envelope

Every `--json` answer is one object:

```json
{ "schemaVersion": 1, "kind": "task-list", "tasks": [], "total": 0, "limit": null }
```

The rules a consumer may rely on, stated in `scripts/json-envelope.mjs`:

- `schemaVersion` and `kind` are always present, and `kind` says which keys
  follow. Switch on `kind`, never on the presence of a key.
- A key declared for a kind is always present. An absent scalar is `null`, an
  absent collection is `[]` — never a missing key.
- Adding a key is backwards compatible and does not move `schemaVersion`.
  Removing, renaming or redefining one does.
- A writing command's refusal is the SAME kind with `ok: false`, carrying
  `refusalKind` (a word to branch on), `refusal` (a sentence for a person) and
  `details`. There is no separate refusal kind.
- Text written for a person — `reason`, `refusal`, a guard's `output` — may be
  reworded. Read `kind`, `ok`, `id` and `refusalKind`.
- Task fields carry THE PROJECT'S vocabulary. Statuses, priorities, labels,
  boards and roles come from that repository's `config.yaml`; read them from
  `vocabulary --json` (all of them at once, in declared order) or from
  `<command> --help --json` (each flag's `values`), never hard-code them.

## The declared kinds

Every kind `scripts/json-envelope.mjs` declares, with the command that emits
it. A test (`scripts/tests/external-consumer-doc.test.mjs`) fails when this
table and the code disagree in either direction.

| `kind` | Emitted by | Role |
|---|---|---|
| `task-list` | `query --json` | read |
| `stats` | `stats --json` | read |
| `doctor` | `doctor --json` | read |
| `check` | `check --json` | read |
| `board` | `board --json` | read |
| `next-id` | `next-id --json` | read |
| `instructions` | `instructions [topic] --json` | read |
| `command-help` | `<command> --help --json` | read — the input surface of a command |
| `plan` | `plan --json` | read |
| `pr-summary` | `pr-summary --json` | read |
| `audit` | `audit --json` | read |
| `docs-drift` | `docs-drift --json` | read |
| `red-owners` | `red --json` | read |
| `task-show` | `show <ID> --json` | read |
| `task-log` | `log <ID> --json` | read |
| `resume` | `resume <ID> --json` | read — composes reads, writes nothing |
| `release-status` | `deploy status --json` | read |
| `vocabulary` | `vocabulary --json` | read — the vocabularies `config.yaml` declares |
| `where` | `where --json` | read — the directories this run resolves |
| `serve-list` | `serve --list --json` | read — machine-local state |
| `agent-profiles` | `profile list --json`, `profile show --json` | read — machine-local state |
| `profile-check` | `profile check --json` | read — machine-local state |
| `adapter-conformance` | `conformance --json` | read — runs in a disposable repository |
| `change-stream` | `follow --json` | stream — one envelope per line |
| `task-take` | `take <ID> --json`, `next --json` | write |
| `task-handoff` | `handoff <ID> --json` | write |
| `task-release` | `release <ID> --json` | write |
| `task-set` | `set <ID> <field> <value> --json` | write |
| `task-body` | `body <ID> --json` | write |
| `task-ask` | `ask <ID> --json` | write |
| `task-decide` | `decide <ID> --json` | write |
| `verification-run` | `done <ID> --json` | write |
| `vocabulary-declare` | `declare <key> <name> --json` | write — `config.yaml` |
| `release-record` | `deploy record --json` | write — a git ref, never the tree |
| `seed` | `seed --json` | write |
| `import` | `import --from github --json` | write |
| `run` | `run --json` | write — dispatches agents |
| `run-stop` | `run --stop --json` | write — the state directory, never the tree |
| `serve-stop` | `serve --stop <port> --json` | write — stops a local process |

**Outside the envelope today.** `new` has no `--json` at all; an interface that
creates a task reads the new id with `query --json` after `new` returns.

**Moved into the envelope by TL-528.** `decide --json` and `where --json` used
to print a bare object. Their payload keys are unchanged, and the root now
carries `schemaVersion` and `kind` beside them. One shape did change: a
`decide` REFUSAL carried its name under `kind` and its sentence under
`message`; `kind` now belongs to the envelope, so they are `refusalKind` and
`refusal`, as in every other writing kind. A consumer that branched on the
old refusal `kind` reads `refusalKind` instead.

## Reading the vocabulary

`vocabulary --json` answers every vocabulary the backlog declares, in the
order `config.yaml` declares it — `statuses`, `priorities`, `types`,
`confidence`, `estimates`, `labels` with `labels_closed`, `boards`, `roles`,
`releases` and `deploy_targets`. Each key is named after the `config.yaml` key
it comes from, so a field description that names a key (`set --fields --json`)
is looked up here without a translation table.

Each status is `{ name, archived, reasonRequired, role, roleSource }`. Colour
and group by `role`, never by `name`: a backlog may rename every status.

| `role` | Meaning | Derived, when `status_roles:` does not name the status, from |
|---|---|---|
| `open` | waiting to be taken | every other active status |
| `active` | somebody holds it | `in_progress_status` |
| `waiting` | stopped on somebody else | `awaiting_vouch_status`, and an active status listed in `reason_required_statuses` |
| `closed` | finished | the first of `archived_statuses` — the one `done` writes |
| `cancelled` | ended without being done | every other archived status |

`roleSource` is `status_roles` when the project declared the role and
`derived` when the tool applied the rule above. A project corrects a derived
role by declaring it; `closed` and `cancelled` may only be given to an
archived status, the other three only to an active one.

## The writing commands

Every write goes through a command, so it is validated against the project's
`config.yaml`, attributed to an actor, and recorded in `backlog/history/`. A
program never edits a task file itself: a hand edit is observed later with the
reserved reason `unknown`, and nothing validates it on the way in.

Common to all of them:

- **`--actor <namespace:name>`** says who acts — `user:` for a person,
  `agent:` for a program acting on its own judgement, `local:` for this
  machine's user. An interface acting for a person passes that person's actor
  explicitly; it does not infer one from a browser or remember one across
  repositories.
- **`--reason "…"`** is required wherever the command says so, and by every
  command entering a status listed in that project's
  `reason_required_statuses`. A command REFUSES rather than prompting. The
  values `unknown` and `proven` are reserved and refused.
- **Exit codes:** `0` the write happened (or was a no-op), and otherwise
  non-zero — for most commands `1` refused and `2` a usage error; `next` adds
  `3` for an empty queue, and `seed` and `import` use `2` for a refused input
  and `1` for a failed write. Each command's `--help` ends with its own `exit:`
  line; branch on `ok` in the envelope rather than on the number alone.

| Command | Required input | Kind |
|---|---|---|
| `new --title "…"` | the title; the body as one JSON document on stdin (`goal`, non-empty `verification`) or the template is written | none (text) |
| `take <ID>` | the id; `--reason` when the target status requires one, and with `--take-over` | `task-take` |
| `next` | nothing; the same filters `query` takes narrow the choice | `task-take` |
| `set <ID> <field> <value>` | a field `set` writes (not `status` or `owner`) and a value from the vocabulary; `--reason` where required | `task-set` |
| `body <ID>` | `--reason`; the new body on stdin or `--body-file`; `--base <hash>` to refuse a stale edit | `task-body` |
| `handoff <ID>` | `--to-role` and `--reason` | `task-handoff` |
| `release <ID>` | `--reason` | `task-release` |
| `ask <ID>` | `--question`; `--recommend` once `--option` is given | `task-ask` |
| `decide <ID>` | `--reason`, or `--resolves <event id> --choose <n>` | `task-decide` |
| `done <ID>` | nothing — the verification contract runs; `--reason` for an archived status that requires one | `verification-run` |
| `declare releases <name>` | `--reason` | `vocabulary-declare` |
| `declare deploy_targets <name>` | `--reason`, and `--repository` or at least one `--stage` | `vocabulary-declare` |
| `deploy record` | `--target`, `--stage`, a commit or tag, `--reason` | `release-record` |
| `seed` | a plan as JSON on stdin | `seed` |
| `import --from github` | issues as JSON on stdin | `import` |

`<command> --help --json` describes each command's flags, which are required,
and which draw on a vocabulary — with that project's values — so an interface
builds its forms from the answer rather than from this table.

## Pinning a version

Two numbers, for two different promises:

- **`schemaVersion`** is the shape of the JSON. Accept the version you were
  written against and refuse any other loudly; a new key under the same
  version is not a reason to refuse.
- **The package version** (`branchling --version`) is the command line: the
  names of commands and flags and what they do. Declare a range on it — a peer
  or regular dependency on `branchling` — and check `--version` at startup.
  While the package is below 1.0, a caret range (`^0.2.0`) pins the minor
  version, and a minor release may rename a flag; pin accordingly.

The two move independently: a release that changes no JSON shape keeps
`schemaVersion`, and the JSON shape never changes without one.

## The built-in viewer and an external interface

Decided in TL-525, so that work on the viewer (TL-450 inline editing, TL-451
the dashboard) and an external interface do not build the same thing twice.

**The built-in viewer is the zero-install view of ONE backlog.** It is one
self-contained HTML page (`scripts/build-viewer.mjs`) and a loopback server
(`scripts/serve-backlog.mjs`), shipped in the package with no dependency. Its
scope is, and stays:

- browsing, filtering, searching and sharing a view of one backlog as a link;
- the dashboard, the board scope and the release board over that backlog;
- inline editing of the fields the server write route supports, in live mode
  only, attributed and recorded in history exactly as `set` records it;
- a read-only snapshot that can be mailed.

**What the built-in viewer will not cover**, and what an external interface is
for:

- several repositories at once — a portfolio view is a reporting system's
  job, as `docs/branchling-global-tool.md` already states;
- hosting, accounts, permissions or more than one person on one server;
- notifications, scheduled reports, or any state kept outside the repository;
- a framework, a build step or a dependency in the package.

**The viewer's HTTP routes are not a contract.** `/api/task`, `/api/ping`, the
SSE channel and the per-process capability exist for the page the server itself
serves; they reject foreign origins on purpose and change with the page. An
external interface uses the three channels above. If it needs something the
command line cannot answer, the fix is a new `--json` kind or a new writing
command — available to every consumer, the viewer included — never a route
added to the viewer's server.
