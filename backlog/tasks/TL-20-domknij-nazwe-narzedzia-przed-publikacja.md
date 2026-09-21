---
id: TL-20
title: Close the tool's name before open source publication
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P0
status: done
owner: agent:claude
estimate: 30m
confidence: medium
created: 2026-08-29
updated: 2026-09-03
blocked_by: [TL-169]
blocks: []
related_docs:
  - docs/backlog-config-and-portability.md
verification:
  - id: the-name-is-free
    bash: "test 404 = $(curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/branchling)"
  - id: the-name-is-everywhere
    bash: "test \"branchling\" = \"$(node -e 'import(\"./scripts/product.mjs\").then(m=>console.log(m.PRODUCT_NAME))')\" && node scripts/cli.mjs check --product-name"
  - id: the-old-name-is-gone
    bash: "! grep -rniq worktrail scripts bin docs .claude skills templates examples *.md .gitignore --exclude=product.mjs"
  - id: the-suite
    bash: "node --test scripts/tests/*.test.mjs"
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
candidate has to survive now live in `.claude/skills/branchling-release/SKILL.md`
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

## Candidates, second round — measured 2026-09-03

Every candidate went through the pass the release gate now prescribes, with
the script kept beside the task's verification: npm, PyPI, Homebrew, GitHub
user or organisation (with what is BEHIND it), GitHub repository search (count
and top three by stars), GitLab group, Docker Hub, and DNS across `.com .net
.org .io .dev .app .sh`. A generic word is rejected on sight — `backlog`,
`task`, `todo`, `worklog` are the crowded shelf — so the field is coined
compounds, which is what `worktrail` was and the quality worth keeping.

| candidate | npm | PyPI | GitHub user | GitHub repos | DNS | verdict |
|---|---|---|---|---|---|---|
| **branchtrail** | free | free | free | 2, both empty (2021, 2024) | none resolves | **clean** |
| **worktally** | free | free | free | **0** | `.com` parked (domainrenter) | **clean** |
| tallyfile | free | free | free | 1, unrelated | `.com` → folderly.com | clean, weak meaning |
| backlogit | free | free | free | 2; `softwaresalt/backlogit` pushed **today** | `.com .app` | same shelf, and the crowded word |
| tasktrail | free | free | free | 72; "TaskTrail productivity app" ×3 | 4 TLDs live | same shelf |
| taskledger | free | taken | free | 33; a "SaaS platform for task tracking" | 4 TLDs live | same shelf |
| workledger | free | free | org, empty | 54; `gruberb/workledger` ★79 "engineering notebook" | all 6 TLDs | adjacent, active |
| branchwork | free | free | org, 1 repo | 44; two agent-work tools pushed this month | 5 TLDs | same shelf |
| gitledger | taken | taken | org | 6; "git-native memory for agents" | 3 TLDs | taken |
| donetrail | free | free | free | 4; a "DoneTrail" app with a privacy policy | `.com .app` | a product exists |
| waylog | free | free | user | 17; `waylog-cli` ★86 | 5 TLDs | active tool |
| branchlog | free | taken | free | 12 | `.com` | PyPI taken |
| worktrace | taken | taken | org | 95; three active tools | 4 TLDs | taken |
| cairn, waymark, spoor, milepost, trailmark, backtrail, worklane, queuefile, tallylog, branchbook | — | — | — | generic or taken on at least two axes | — | rejected |

For the two clean ones the TL-81 checks were repeated: `npx` lands nowhere
(registry 404, npm search **0 results** for either), the typo neighbourhood is
free (`-cli`, plural, hyphenated), nothing on `PATH`. Neither word appears as a
product anywhere the pass reaches.

**Recommendation: `branchtrail`.** It says the thesis — a task travels with its
branch and leaves a trail — where `worktally` says only the verification half.
It keeps the `trail` half of the current name, so every document, skill and
habit that says "trail" survives the rename. And it has no domain at all
resolving, which is a better position than a parked `.com` held for resale.
Against it: eleven characters to `worktally`'s nine, and `branch` is a git word,
which narrows the story to git — but the tool IS git-bound by its first law, so
that is a description, not a limit.

**This is a recommendation, not the decision.** The decision is the founder's,
as it was on 2026-08-30 and 2026-09-01; the difference this time is that the
column that was read as "taken, so what" now carries what stands behind it.

## Candidates, third round — coined and figurative, measured 2026-09-03

Asked for on the founder's request after the second round: names that carry a
metaphor rather than a compound of two shelf words. Same pass as above. The
figurative field is narrower than it looks — a good metaphor has usually
already been taken by somebody who liked it first (`cairn`, `waymark`,
`vestige`, `spoor`, `portage`, `strider`, `lodestar`), so what survives is the
metaphor bound to a second word.

| candidate | the figure | npm | GitHub repos | DNS | verdict |
|---|---|---|---|---|---|
| **taskcairn** | a cairn is a stack of stones left to mark a trail — evidence that somebody passed, placed on purpose | free | **0** | **none resolves** | **clean** |
| **branchling** | a small branch; the diminutive says one branch, one task | free | **0** | `.com` a 114-byte blank page, held by somebody | **clean** |
| **workwake** | a wake is the trail left in water — the work is what remains behind the ship | free | 1, unrelated | `.com` for sale (HugeDomains) | clean |
| trailhand | a hand on the trail crew; "hand" is a worker | free | 1, empty | all 6 TLDs resolve, `.com` for sale | held widely |
| lodeline | a lode is the vein worth following | free | 2, empty | `.com .app` | clean, obscure |
| trailwright | a wright makes things (shipwright) | free | 3, small | `.com .net` | clean, heavy |
| doneline | — | free | 4 | 5 TLDs | held widely |
| taskwright | wright, as above | **taken** | 6; a Go job scheduler pushed yesterday | 5 TLDs | taken |
| crumbtrail | breadcrumbs | taken | 17 | 5 TLDs | taken |
| tallyho | the huntsman's cry, with "tally" inside | free | 89; a user with that name | all 6 TLDs | a word everybody owns |
| towline, keelwork, treadline, worktrek, markstone, stoneline, wayfile | — | mixed | held or unrelated on two axes | — | rejected |
| vestige, ledgerly, portage, strider, furrow | — | taken | thousands | — | rejected |

**Where this leaves the shortlist — four names, three clean on every axis:**

- `branchtrail` (round two) — says the thesis literally.
- `taskcairn` — says the thesis figuratively: a task is a marker placed on the
  trail, and the closing evidence is the stone that proves it. The only
  candidate with nothing resolving on any TLD and nothing on any forge.
- `branchling` — the smallest and the most playful; it says *branch* and
  nothing about trail or proof.
- `worktally` (round two) — the verification half only.

The recommendation from round two stands unless the founder prefers the
figure over the statement, in which case `taskcairn` is the one — it is the
only metaphor in the field that is also a description of what `worktrail done`
actually does.

## Candidates, fourth round — short, pronounceable, industry-catchy, measured 2026-09-03

Asked for on the founder's request: names that are easy to say and land in the
trade. Two families were tried, and both produced a result worth recording
because it is a negative one with a clear shape.

**Family one — a single real word or a near-word (`baton`, `errand`, `stint`,
`remit`, `ambit`, `bramble`, `dibs`, `docket`, `tasko`, `tasklet`, `twiggy`,
`branchy`, `wayline`, `trailo`): every one is taken**, on npm and PyPI both, with
hundreds to thousands of repositories behind it, and every TLD resolving. A
word short enough to be catchy has already been liked by somebody who moved
first. `gitdone` — the best pun in the field — has three tools under that name,
one pushed today.

**Family two — a document that TRAVELS WITH THE WORK in some trade**, which is
this tool's first law said in somebody else's vocabulary: `waybill` (the paper
that rides with the shipment), `docket`, `punchlist` (construction: the list to
close before handover), `snaglist`, `callsheet` (film: the day's schedule),
`workorder`, `jobcard`, `runsheet`, `signoff`, `checkoff`. **Every one is taken
on npm**, and the two best fits have a neighbour on this exact shelf:
`wardmos/waybill` (★23, 2026-08-31) is "continue unfinished work across coding
agents", and `basecamp/gh-signoff` (★2024) is "local CI, sign off on your own
work". The trade vocabulary was the right idea; the trade got there first.

| candidate | npm | GitHub repos | note |
|---|---|---|---|
| waybill | taken | 527; an agent-handoff tool ★23 | the best metaphor in four rounds, and gone |
| punchlist | taken | 205 | `apiology/punchlist` is a task lister |
| signoff | taken | 541; `basecamp/gh-signoff` ★2024 | same shelf, large |
| docket | taken | 2482; a Python task system ★143 | |
| callsheet | taken | org with a product (joincallsheet.com) | |
| snaglist | taken | 16 | free-ish on GitHub, taken on npm |
| checkoff | free | 670; an Asana CLI | |
| trailkit, taskkit, runsheet, jobcard, workorder, worksheet, trailmix | taken | — | |
| cairnly | free | org "Cairnly" exists; 381 hits on `cairn` | held |

**Conclusion of round four.** Catchy-and-free does not exist as a single word
in 2026; it exists only as a coined compound, which is what rounds two and
three found. The shortlist is unchanged — `branchtrail`, `taskcairn`,
`branchling`, `worktally` — and of those the two that are easiest to say aloud
are `branchling` (three light syllables, no consonant cluster) and `taskcairn`
(two syllables, though `cairn` has to be learnt once by anybody who has not
hiked). `branchtrail` has the `-chtr-` cluster in the middle, which is the one
pronunciation cost in the field.

## Candidates, fifth round — coined two-syllable, no meaning, measured 2026-09-03

Asked for on the founder's request, on the `vercel` / `deno` / `bun` pattern:
a short pronounceable string that means nothing and lets the brand carry it.
Sixteen were run: `tralo varno brenno lodra tavo velto dravo brilo tarvo kelno
jarvo morvo savo zelto fenlo harvo`.

**The result is negative and its shape is the point: a coined five-letter word
buys npm and nothing else.** Fourteen of sixteen were free on npm — and in
fifteen of sixteen the GitHub handle was already somebody's, because strings of
that shape read as first names and nicknames. The `.com` resolved every single
time. The three cleanest show what is behind it:

| candidate | npm | GitHub | what the `.com` actually is |
|---|---|---|---|
| lodra | free | user, 0 repos | for sale (HugeDomains); `lodra.dev` is **LodraDev, a software studio** |
| morvo | free | user, 0 repos | **BrandBucket** — the name is itself listed for sale as a brand |
| zelto | free | user, 1 repo | **Zelto, a tech company** |
| kelno | free | an active user, 48 repos | held |
| tralo | free | active user; `TraLo` is a training logger | `.app` only |

That is the same error TL-169 was opened for, one layer down: a free registry
read as a free name. The space of pronounceable five-letter strings has already
been swept — by domain brokers, by BrandBucket, and by everybody whose first
name it resembles. And the cost is real: a name with no meaning has to be
carried entirely by the brand, which is precisely what a broker's parked page
or somebody's studio at the same string makes expensive.

**This round closes the direction.** Every clean candidate here is worse than
`branchling` or `taskcairn` on every axis except length, and has no meaning to
make up for it.

## DECISION 2026-09-03 — the name is `branchling`

Chosen by the founder from the shortlist, on the criteria the founder set:
easy to say, catchy in the trade.

**Why it beat `taskcairn`, which was the other finalist.** `cairn` is
/kɛərn/ — it cannot be spelled from hearing it, so a name passed across a
standup arrives as `taskkern` or `taskcarn`. And `cairn` already has a crowd on
the adjacent shelf: 1,727 repositories, among them `cairn-dev/cairn` (★215, a
background agent system for software work) and `plune-ai/cairn` ("an AI that
walks your system and leaves a trail"), plus an org called `Cairnly`. That is
the `worktrail` mechanism again, half a word further along.

**What `branchling` gives.** Three light syllables with no consonant cluster,
unambiguous from hearing it, and both halves already known — every developer
knows `branch`, every English speaker knows `-ling` from `duckling` and
`seedling`. It states the first law without translation: one branch, one task,
small and travelling. And nothing stands behind it — zero repositories, a free
handle, npm/PyPI/Homebrew free, and the only domain is a 114-byte blank page
with no sale offer. It is not a dictionary word, so there is nothing for a
search to collide with.

**The known weakness, accepted:** the name says nothing about EVIDENCE, which
is what `done` enforces. That is the tagline's job, not the name's — the name
is a pointer, the tagline carries the thesis. `taskcairn` tried to carry both
in one word and paid for it in pronunciation.

**Measured the day of the decision** (the full pass is in the round-two table):
npm 404, PyPI 404, Homebrew 404, GitHub user free, GitHub repository search 0
results, GitLab 404, Docker Hub 404, npm search 0 results, the typo
neighbourhood (`-cli`, plural, hyphenated) free, nothing on `PATH`. Package name
and the single `bin` key are the same string, so the `npx` trap TL-81 closed
stays closed.

## The rename, executed 2026-09-03

**What moved.** `package.json` name and the single `bin` key, `bin/worktrail.mjs`
→ `bin/branchling.mjs`, `docs/worktrail-*.md` → `docs/branchling-*.md`, the three
project skills `.claude/skills/worktrail-{cli,release,viewer}`, and the name in
every document, comment, test and template — 119 files plus the seven renames.
`npm pack --dry-run` reports `branchling-0.1.0.tgz`, 104 files.

**What deliberately did NOT move: `backlog/tasks/`.** 134 task files still say
`worktrail` and 33 still say `tasklog`, and that is the precedent the previous
rename set — those files are this project's development history (see
`LINEAGE.md`), and rewriting a record of what was decided in August would
falsify it. What WAS updated inside them is the 68 files carrying a PATH to a
renamed file: a path is data pointing at a file, not a sentence, which is the
same distinction `check --language` draws when it skips link targets and code
spans.

**The three frozen on-disk keys were moved once, and the freeze starts at the
first publish.** `BLOCK_MARKER_NAME`, `STORAGE_KEY_PREFIX` and `HOME_ENV` are
frozen because they identify data in places the tool cannot reach — a block in
somebody's `.gitignore`, keys in somebody's browser, a variable in somebody's
shell profile. Nothing is published, so the set of unreachable holders was
empty, and holding a dead name forever to defend an empty set is a cost with no
payer. After the first publish they never move again, whatever `PRODUCT_NAME`
becomes.

**That decision had a consequence that had to be paid, not just noted.**
`BLOCK_MARKER_NAME` also names the home directory and the lock directory, so
changing it orphaned a real registry: the tool reported `projects known 0` while
929 projects sat in `~/.config/worktrail/projects.yaml`. Migrated on this
machine — the registry, 43 activity trees, 1,270 locks and 1,148 session files.
Two activity logs and five session files existed under both names because this
session had already written under the new one; the append-only logs were merged
by entry id and ordered by timestamp, and the session snapshots resolved to the
newer file. `where` now reports `projects known 929`. Nothing was left behind.

**The verification block was replaced, and it is worth saying why rather than
letting it look like a test bent to pass.** It carried a `manual:` entry naming
`scripts/tasklog` and an alias in `~/.zshrc` — the first renamed away, the
second deliberately deleted on 2026-08-29 by this task's own log. An entry
naming things that do not exist cannot be vouched for honestly, and vouching
with `--confirm-manual` would have recorded a person's word for a check nobody
could run. The four entries that replace it prove the same intent by execution:
the name is free on npm, `PRODUCT_NAME` is `branchling` and no literal escapes
`product.mjs`, the old name survives nowhere in the shipped surface, and the
suite is green.

**Still open and unchanged by this:** the name is free but NOT reserved, and
[TL-179](TL-179-a-trademark-clearance-search-for-the-published-name-is-not.md)
is the trademark clearance nobody has run.
