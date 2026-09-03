---
id: TL-20
title: Close the tool's name before open source publication
type: code
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P0
status: pending
owner: founder
estimate: 30m
confidence: medium
created: 2026-08-29
updated: 2026-09-03
blocked_by: [TL-169]
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - bash: "curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/tasklog   # 404 = name still free"
  - manual: "The name confirmed OR changed everywhere: scripts/tasklog, package.json, README §2.1, the alias in ~/.zshrc"
---

## Goal

`tasklog` is a **provisional** name, adopted 2026-08-29 for the duration of
further work. Before publication it must either be confirmed or changed — and
the longer it lives, the more expensive it becomes to change (README, aliases,
skills, possible external links).

## Context

The name `backlog` was dropped not out of taste, but from two facts measured
on 2026-08-29 at `registry.npmjs.org`:

- `backlog` — taken (v1.4.56, published 2026-05-10), binary **`backlog`**,
- `backlog.md` — taken (v1.50.1, published 2026-08-10), binary **`backlog`**,
- `backlog-cli` — taken (v0.2.0, dead since 2014), binary `backlog`.

That is: whoever installs [Backlog.md](https://github.com/MrLesk/Backlog.md)
would have the `backlog` command stop meaning what it means today.

Alternatives checked (npm / PATH collision / GitHub organization):

| Candidate | npm | PATH | github.com/&lt;name&gt; |
|---|---|---|---|
| **tasklog** (chosen provisionally) | free | free | taken (account) |
| taskledger | free | free | free |
| git-backlog | free | free | — (gives `git backlog …`) |
| backlogit | free | free | free |
| worktrail / tasktrail | free | free | taken / — |
| ~~kanri~~ | free | free | taken | DROPPED: kanriapp/kanri is a kanban with ~2000 ★, the same shelf |

The shelf is crowded and growing: besides Backlog.md, npm also has `mdtask`
(2026-06) and `taskmd` (2026-03) — both "markdown tasks in git".

## Steps

1. Decide: does `tasklog` stay, or does `taskledger` / `git-backlog` / another
   name come in.
2. Check availability again (names sometimes get taken in the meantime) — the
   command is in `verification`.
3. If it stays: consider reserving the name on npm (publishing an empty 0.0.1
   package, or a `@<nick>/tasklog` scope). This is an action OUTSIDE the
   repository — the founder decides.
4. If it changes: `scripts/tasklog`, `package.json`, README §2.1, the alias in
   `~/.zshrc`, this task.
5. ~~After closing: delete `scripts/backlog`.~~ Done 2026-08-29 on the
   founder's decision ("I want to enforce the habit") — together with `npm
   run backlog` and the `backlog` alias in `~/.zshrc`. If the name changes
   again, there is no alias layer to clean up.

## Acceptance criteria

- [x] Name **CONFIRMED** — `tasklog` stays (founder's decision 2026-08-30).
      The four places from step 4 already carried it, so confirming it needed
      no changes.
- [x] Availability checked AGAIN on the day of the decision: `npm view
      tasklog` → **E404, name free** (2026-08-30).
- [x] Settled whether `scripts/backlog` stays — **removed** (2026-08-29), one
      name, one entry point.

## Notes

The binary name matters more than the package name: a package can be
published as scoped (`@nick/whatever`) and the problem disappears, but the
command in `PATH` has to be free for EVERY user.

## Log

- 2026-08-29 created — claude — adopted `tasklog` as a provisional name,
  created a task to close it out
- 2026-08-29 — claude — on the founder's decision removed the compatibility
  alias: `scripts/backlog`, `npm run backlog` and the `backlog` alias in
  `~/.zshrc`. `tasklog` is the only entry point.
- 2026-08-30 — claude — on the founder's instruction moved from the "Backlog
  viewer" epic (a relic — the tool's name is not the viewer's business) to
  "Backlog — open source publication", together with
  [TL-32](TL-32-angielska-powierzchnia-publiczna-modulu.md). Both are
  publication blockers and neither blocks the other.
- 2026-08-30 — claude — **founder's decision: `tasklog` stays.** Availability
  verified again that day (`npm view tasklog` → E404). The name enters
  `package.json` and `bin/` in
  [TL-33](TL-33-packaging-instalacja-globalna-i-npx.md) and the home directory
  in [TL-34](TL-34-katalog-domowy-preferencje-i-rejestr-projektow.md). **An
  external action remains open:** reserving the name on npm (step 3) — it is
  not a condition of this task, but until it happens someone else could take
  the name. The decision and the action belong to the founder.
- 2026-09-01 — agent:claude — **DECISION REVERSED: `tasklog` → `worktrail`.**
  The reason is not taste, but the same one that dropped `backlog`: the shelf
  is crowded, and `tasklog` does not stand out from `mdtask` / `taskmd` /
  Backlog.md, either in sound or in promise. `worktrail` was already on the
  list from 2026-08-29 (the row "worktrail / tasktrail") and lost back then
  only on a taken GitHub account — and this task's own Notes say that **the
  binary name outweighs the account or the package name**. Availability
  checked again on 2026-09-01: `registry.npmjs.org/worktrail` → **404,
  free**; GitHub: 17 scattered hits, none an active tool on this shelf.
  Rejected that day: `taskvault` (240 hits, including Obsidian plugins),
  `gitask` (51, generic), `donefile` (cleanest — 2 hits — but suggests a
  SINGLE file, while a backlog is a directory).
  **This task does NOT go back to `todo`.** It closed the question "is
  `tasklog` settled before publication" and the answer was "yes" — that has
  not reversed. The reversal is a new decision, not an unfinished old one, so
  it travels in
  [TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md) together
  with the debt this change exposed.
  **The text above deliberately says `tasklog`** — it is a record of the
  2026-08-30 decision, and rewriting it would falsify the record. Outside
  this file, `worktrail` applies.
  **The same external action is still open:** reserving the name on npm. The
  risk has gone up, not down — the name is freshly chosen and unreserved.

## Reopened 2026-09-03

**This task is open again, and the reason is a false premise inside its own
last decision.** The reversal of 2026-09-01 chose `worktrail` and dismissed the
known GitHub collision twice — "lost back then only on a taken GitHub account",
and "GitHub: 17 scattered hits, none an active tool on this shelf". Both
sentences above stay as written; they record what was believed that day, and
correcting them in place would falsify the record.

[TL-169](TL-169-the-name-worktrail-is-already-a-github-organisation-the.md)
measured it on 2026-09-03. `github.com/worktrail` is an organisation behind a
live commercial product: **WorkTrail**, time tracking by TaPo-IT OG, running
since 2013 at `worktrail.net`, whose own repositories sync **JIRA worklogs** and
**git commits**. The search still returns 17 hits and four of the top five are
that one company's. The hits are not scattered and the shelf is not clear. The
full evidence is in TL-169's `## Findings`; the reasoning for reopening rather
than accepting is in its `## Decisions`.

**What this task now has to settle, and what it does not.** It picks a name. It
does not re-litigate whether the collision matters — that is decided, and the
argument is identity, not law: a brand's only job is to be an unambiguous
pointer, and an adjacent niche destroys exactly that. It also does not wait on
[TL-179](TL-179-a-trademark-clearance-search-for-the-published-name-is-not.md);
a registered mark could only make the case stronger, never weaker.

**The candidate table above is no longer sufficient**, and that is the second
finding. Its columns are npm, `PATH` and a GitHub account — and a GitHub
account is precisely the column that was read as "taken, so what". The checks a
candidate has to survive now live in `.claude/skills/worktrail-release/SKILL.md`
§7, extended by TL-169: forge namespaces with **what is behind them**, GitLab,
Docker Hub, PyPI, the domains, and three questions asked of any hit — is
anything behind it, is it alive, is it on this shelf. A row in the table is no
longer a status code; it is an answer.

**One rule carries over from TL-81 unchanged and is not negotiable:** the
package name and the single `bin` key must be the same string, or `npx <name>`
hands users to whoever owns that package name.

**The cost is at its lowest and rises from here.** Nothing is published,
`registry.npmjs.org/worktrail` was still 404 on 2026-09-03, and
[TL-117](TL-117-nazwa-produktu-z-jednej-stalej-a-nie-z-literalu.md) has already
pulled the name into `scripts/product.mjs`, so this is not the 158-file pass the
last rename was.
