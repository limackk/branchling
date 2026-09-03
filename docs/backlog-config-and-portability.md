# Backlog — separating code from data, and configuration

**Status:** IMPLEMENTED 2026-08-29 ([TL-18](../backlog/tasks/TL-18-katalog-danych-backlogu-jako-argument.md), [TL-19](../backlog/tasks/TL-19-slowniki-backlogu-do-konfiguracji.md))
**Code SSOT:** `backlog/scripts/paths.mjs`, `backlog/scripts/config.mjs`, `backlog/config.yaml`
**Tests:** `node --test backlog/scripts/tests/paths.test.mjs backlog/scripts/tests/config.test.mjs`

---

## 1. Why

The `backlog/` module was born inside one product's workspace and had that
baked into its construction in two ways:

1. **The data directory followed from where the code sat** — every script
   computed it as `join(__dirname, "..")`. Code and data were one directory,
   so it was impossible either to point at a different backlog, or to
   install the tool alongside someone else's repository.
2. **The vocabularies were code** — `pre-launch`, `test_env`, `data-gated`,
   `owner: founder|claude`, seven statuses, four priorities and two types
   were hardcoded into `task-fields.mjs`, `build-backlog.mjs` and the
   viewer's CSS.

Both are fine for one company's tool and both are a blocker once this is
meant to be a tool. Two tasks removed these assumptions **without** moving
files and without splitting off a repository — so that extraction would later
be one `git subtree split`, not archaeology.

## 2. Where the data lives (TL-18)

`resolveBacklogDir()` in `paths.mjs`. Order of sources, from most explicit:

| # | Source | `source` | Notes |
|---|---|---|---|
| 1 | `--dir <path>` | `explicit` | pointing at something that isn't a backlog is an **error**, not a fallthrough |
| 2 | `BACKLOG_DIR` | `env` | same |
| 3 | detection upwards from `cwd` (`.` or `./backlog`) | `discovery` | requires a MARKER |
| 4 | the directory above the script file | `colocated` | keeps today's layout and the `backlog` alias |

**Detection requires a marker** (`tasks/` **plus** `boards.yaml` /
`config.yaml` / `_template.md`), not `tasks/` alone. A foreign repo with a
directory of that name is more common than it seems, and silently pointing
at the wrong tree ends in a write landing somewhere it shouldn't — worse than
an error.

Point 4 is what keeps today's behaviour: the `backlog` alias starts the
server from any directory, including outside the workspace.

`backlogPaths(root)` is the only place that knows the internal file names
(`tasks/`, `history/`, `INDEX.yaml`, `viewer.html`…).

## 3. What is configuration (TL-19)

The dividing line to hold to:

- **Code knows the SHAPE** — what fields a task has, of what type, how they
  are written to the frontmatter, how they are compared. That's
  `FIELD_SHAPES` in `task-fields.mjs`.
- **Configuration knows the VALUES** — which statuses, labels, priorities,
  types and boards exist in THIS project.

`buildFieldSpecs(config)` glues the two together into specs the server
validates against and the viewer draws editors from.

### Files

```
backlog/config.yaml   ← project vocabularies (this file is new)
backlog/boards.yaml   ← board registry (unchanged; has its own guard)
```

`config.mjs` reads both and returns **one** object — the rest of the code
does not know it is two files. No `config.yaml` = generic `DEFAULTS` (no
"pre-launch" anywhere), so a fresh repository works with no configuration.

### Keys

| Key | Meaning |
|---|---|
| `project_name` | headers of generated views and the viewer's title |
| `statuses`, `archived_statuses` | workflow; `archived_statuses` decides what drops out of `INDEX.yaml` into `archive/done.yaml` |
| `priorities` | **order = sort order in the views** |
| `types`, `confidence` | field vocabularies |
| `labels`, `labels_closed` | the label vocabulary and whether it is closed |
| `label_axis_timing`, `label_axis_env` | the axes the viewer builds the "Phase" and "Environment" facets from; **an empty axis makes the facet disappear** |
| `roles` | WHO MAY take a task (`role:`), as distinct from `owner:` — who holds it NOW. **An empty vocabulary is an ANSWER**, not missing configuration: the project doesn't use roles, so a non-empty `role:` anywhere in the tree fails the build instead of creating a phantom role no dispatcher serves |
| `owners`, `estimates` | text-field suggestions (not a closed vocabulary) |
| `actors` | suggestions for the "Editing as" switch in the change history |
| `title_max_length` | title validation |
| `epic_aliases` | merging spelling variants of an epic |
| `status_colors`, `priority_colors`, `label_colors`, `status_strikethrough` | presentation; no entry = a color from the cyclic palette |
| `dashboard_open_statuses`, `dashboard_burndown_kind/value` | what "open" means and what the burndown burns down |

`roles` is the only vocabulary whose EMPTY value means something. Every other
enum with no vocabulary degrades, in `buildFieldSpecs`, to free text — a
field that cannot be set to anything is not an enum. For `role`, free text is
exactly the hole the field is meant to close, so it stays an enum whose only
legal value is empty (`dictionaryRequired` in `FIELD_SHAPES`).

**An unknown key FAILS.** A typo in a vocabulary is indistinguishable from
"this project just works that way" — the same rule as an unknown flag in
`query.mjs`.

**Inconsistency between vocabularies fails**: an archived status outside
`statuses`, `dashboard_open_statuses` outside `statuses`, a board's `default:`
outside the list, a duplicate slug, an axis label outside the closed
vocabulary.

### Parser

Narrow, and deliberately so: a scalar, an inline list, a block list, a block
map. The module has no dependencies, and "almost YAML" fails worse than a
parser that simply fails to find a field. Structures nested deeper than one
level **are not supported** — that's why keys are flat
(`dashboard_burndown_kind`, not `dashboard: { burndown: {...} }`).

Along the way, a **third** `boards.yaml` parser disappeared: the same shape
used to be read independently by `build-backlog`, `build-viewer` and
`check-backlog-boards`.

## 4. How this is proven

Three kinds of evidence, because each catches something different:

1. **Parity with the code before the change** — a test checks that the
   originating project's `config.yaml` reproduces, value for value, the
   vocabularies that used to be hardcoded. In addition: views generated after
   the change are **byte-identical** apart from the header, which now names the
   project. Reproduce the shape of this check on your own tree: rebuild, keep
   the output, change one value in `config.yaml`, rebuild again, and diff.
2. **Genericness of the defaults** — a test walks `DEFAULTS` and fails if any
   word belonging to one project turns up in them.
3. **A gate on the output** — `buildHtml()` with a foreign configuration is
   searched for the vocabulary of the project it was NOT given. This one
   assertion catches **every** new hardcode in the viewer, including ones that
   do not exist yet.

End-to-end proof (done by hand on 2026-08-29): a directory with
`statuses: [todo, doing, review, shipped]`, `priorities: [now, next, later]`,
`types: [feature, bug, chore]`, `labels: [ui, api]` run through
`backlog --dir` — the viewer showed those statuses in filters, on cards and
in the field editor, the stats chips said `now / next / feature / bug /
chore`, and the "Phase" and "Environment" facets disappeared, because that
project has no such axes.

## 5. What this does NOT do

- **Does not move files.** Code still lives in `backlog/scripts/`, data in
  `backlog/`. The `bin/` + `lib/` split arrives together with the CLI.
- **No `init`** — assembling a backlog directory in a foreign repo today
  still has to be done by hand (`tasks/`, `config.yaml`, `boards.yaml`).
- **Does not split off a repository** and does not translate the
  documentation.
- **Does not touch the dashboard's core** — `computeDashboard` still lives in
  the viewer's template literal, so it cannot be run outside the browser.
  Its breakdowns (hours per phase, per type) already read the configuration,
  but the function itself awaits extraction; that is a condition for a
  future `stats` command.
- **Does not change `suggest-board.mjs`** beyond the registry path — the
  `paths:` routing rules still live in `boards.yaml`, i.e. in data.

## 6. The tool's name — tentatively `worktrail`

The module is meant to eventually live outside this repository, at which
point the name stops being cosmetic: **the binary has to be free for every
user.** Measured on 2026-08-29 against `registry.npmjs.org`:

| Package | State | Binary |
|---|---|---|
| `backlog` | taken (v1.4.56, 2026-05-10) | `backlog` |
| `backlog.md` | taken (v1.50.1, 2026-08-10) | `backlog` |
| `backlog-cli` | taken (2014, dead) | `backlog` |

So the `backlog` command on a machine with [Backlog.md](https://github.com/MrLesk/Backlog.md)
already installed means something else entirely. Hence **`worktrail`** (free
on npm, no PATH collision) as a working name: the same number of characters
as the previous command, and it names the distinguishing feature — an
append-only field change history with an author, which none of the
neighbouring tools have (`backlog.md`, `mdtask`, `taskmd`).

Implementation state: `scripts/worktrail` is the only wrapper. The
compatibility alias `scripts/backlog`, the `npm run backlog` script and the
`backlog` shell alias were removed on 2026-08-29 by the founder's decision —
two names for one tool would have kept the old one alive in documents and
muscle memory. The name is **not settled** — the decision and a possible npm
reservation: [TL-20](../backlog/tasks/TL-20-domknij-nazwe-narzedzia-przed-publikacja.md).
The `backlog/` directory, file names and `project_name` in the configuration
were left untouched; `project_name` describes A BACKLOG, not the tool.

## 7. The class of bug this closes

"The same vocabulary in two places" — this module's most common silent
defect. Before the change, the status list lived in `serve-backlog.mjs`, in
the viewer's client, and in the README; the board registry had three
parsers; one project's labels were in `task-fields.mjs` **and** in the CSS
**and** in filter predicates. Every such place drifts on the first vocabulary change
and doesn't report it — one surface simply stops showing a value the other
still accepts.
