---
name: worktrail-viewer
description: Change the worktrail browser viewer — the single self-contained HTML page (and the local server behind it) that non-technical readers use to browse, filter, edit and chart the backlog. Covers scripts/build-viewer.mjs, scripts/serve-backlog.mjs, scripts/viewer-url.mjs, the config-derived palette, dark mode, URL view state, inline field editing and change history. Use this skill for any work on the viewer, the dashboard, the board or filter UI, the served page, or requests like "the viewer looks wrong", "add a column", "make the chart clickable", "add a filter", "share this view with someone".
---

# Changing the viewer

The viewer is the only surface most non-technical readers will ever touch. An
analyst or a manager will not run `worktrail query`; they will open a page,
filter it, and send someone a link. That makes the viewer the adoption path into
a team, and it is why breaking it silently costs more than breaking a command.

## Where the page comes from

`backlog/viewer.html` is **generated and gitignored**. Editing it produces work
that the next `worktrail viewer` erases. The source is `scripts/build-viewer.mjs`,
which reads `tasks/*.md`, parses frontmatter, and emits one self-contained file
with all data embedded — no runtime fetch, so it works over `file://` and can be
mailed or dropped in a shared folder.

`scripts/serve-backlog.mjs` serves **the same page from the same renderer**: it
imports `readTasks`, `computeStats` and `buildHtml` rather than holding a second
copy of the template. Keep that import. Two copies of a template diverge on the
first change, and the divergence shows up as "it looks different when served",
which nobody debugs quickly.

After any change: `worktrail viewer` to rebuild, or restart `worktrail serve`.

## Modules are shared by source, not by copy

`readModuleSource()` inlines `viewer-url.mjs` and `task-fields.mjs` into the
page, stripping `export`. The browser and `node --test` therefore execute the
same code, which is the only reason the URL-state and field-normalisation logic
has real tests. Logic written inline in the template string cannot be tested —
the strongest assertion available would be a regex over HTML, which also passes
for a function that returns the wrong answer.

So: **if a piece of view logic deserves a test, it belongs in a module that gets
inlined, not in the template.**

## The palette is derived, not written

Status, priority and label colors are generated from the vocabulary in
`config.yaml` (`varsFor` / `badgesFor` in `build-viewer.mjs`). A project that
invents a status this codebase has never heard of still gets a legible badge,
and nobody has to edit CSS to add one.

Never hardcode a status or label name in a CSS rule. If a rule needs to know
something about a value, that knowledge belongs in the config (as
`archived_statuses` or `statusStrikethrough` already do) so it stays a project
decision.

## Theme

Colors are CSS custom properties on `:root`, redefined under
`@media (prefers-color-scheme: dark)`. Every rule reads a token; no rule carries
a raw hex value. When you add a surface, add its token in both blocks — a color
defined only in the light block turns invisible in dark mode, and that failure is
easy to miss because the page still renders.

## View state lives in the URL

Filters, search, sort, board scope and the open task are encoded in the URL by
`viewer-url.mjs`. This is what makes the viewer a collaboration tool rather than
a personal dashboard: "look at these fourteen tasks" is a link, not a list of
IDs. When you add a control, encode it there too, and add a case to
`viewer-url.test.mjs`. A filter that is invisible to the URL quietly breaks the
promise that a link reproduces what the sender saw.

Encode only what is set. Empty filters must not litter the link.

## Edits and history

Writes from the page go through `task-fields.mjs` — `buildFieldSpecs()`,
`normalizeValue()`, `setFrontmatterField()` — which is the same module that
validates writes on the server and from which the viewer draws its editors. One
definition of a field, three call sites. Adding a field means adding it there,
not adding a branch in the page.

Every write is recorded by `history.mjs` with an actor and a timestamp, and the
server regenerates views afterwards so the generated YAML cannot go stale behind
the user's back. If you add a write path, it records history too — an edit with
no attribution is indistinguishable from a file someone changed by hand, and the
history is what makes the viewer usable by more than one person.

## Writing for the non-technical reader

The audience here has not read `README.md` and will not open a terminal.

- Name things in the reader's language: "waiting on other tasks", not
  `blocked_by`.
- When the page shows a value that comes from config, show the value, not the key.
- If an action has a command-line equivalent, showing the command is helpful;
  requiring it is not.
- Empty states say what would put something here, not "no results".
- The page must stay useful with the server down — that is the `file://` mode,
  and it is what gets forwarded to someone outside the team.

## Constraints that are not negotiable

- **Zero npm dependencies.** The parsers are hand-rolled on purpose; a build step
  or a CDN script would break both `file://` use and the "clone and run" promise.
- **The server binds to loopback only.** If you need to serve to a colleague, that
  is a design decision with an owner, not a default to relax.
- **`viewer.html` stays gitignored.** It is an aggregate of every task, so
  versioning it makes two branches conflict even when they touch different tasks.

## Verifying a change

```bash
worktrail viewer                                   # rebuild
node --test scripts/tests/viewer-url.test.mjs \
             scripts/tests/task-fields.test.mjs \
             scripts/tests/views-not-versioned.test.mjs
worktrail serve                                    # then check both themes and a resize
```

Check dark mode explicitly. It is the half of the theme nobody looks at while
making a change, and the half where a missing token hides.
