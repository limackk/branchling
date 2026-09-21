---
id: TL-169
title: "The name worktrail is already a GitHub organisation — the free-on-npm check was not enough"
type: task
labels: [pre-launch]
board: main
epic: "Backlog — open source publication"
priority: P1
status: done
owner: agent:claude
role: ""
executor: ""
estimate: 2h
confidence: medium
created: 2026-09-02
updated: 2026-09-03
blocked_by: []
blocks: [TL-20]
related_docs:
  - docs/license-and-contributions.md
verification:
  - id: the-finding
    bash: "curl -sf -o /dev/null -w '%{http_code}\\n' https://api.github.com/users/worktrail"
---

## Goal

Know whether the pre-existing `worktrail` GitHub organisation is a live product
under that name or a dormant handle, and record what that means for the name
this project has already committed to. The deliverable is a recorded decision
with its reasoning, not code.

## Context

Surfaced 2026-09-02 while answering the open question left on
[TL-158](TL-158-the-ci-badge-and-the-first-publicly-visible-green-run.md) (under
whose account is this published). Checking the owner candidates turned up a
fact nobody had looked for: **`github.com/worktrail` exists.**
`api.github.com/users/worktrail` returns 200 — `"type": "Organization"`,
`"name": "WorkTrail"`, created 2013-04-05, 6 public repositories.

[TL-81](TL-81-distribution-channels-and-the-worktrail-name-collision-in.md) settled the
name against ONE registry. It measured npm thoroughly — `worktrail` 404, zero
search hits, the typo neighbourhood free, no Homebrew formula — and concluded
the name was clear. That check was necessary and is not being reopened: `npx
worktrail` remains safe by construction, because the package name and the only
`bin` key are the same string. What TL-81 did not check is any namespace
OUTSIDE npm, and the same task is the one that argued the name had stopped
being cosmetic: with a cloud service under consideration, MIT does not stop a
competitor from running a service on this code, so **the name — not the
licence — is the only asset that stops them running it under this identity**.
An organisation that has held the name on the largest forge since 2013 is
directly on that axis.

This is not automatically a blocker. Three outcomes are all plausible and the
task is to find out which:

1. A dormant handle with no product behind it. Then nothing changes: the
   repository lives under a personal account (the badge URL and the
   `repository` field name the account, never the bare word) and the finding is
   recorded so it does not get rediscovered at the next release.
2. A live product in an unrelated field. Coexistence is normal, the name stays,
   and the finding is recorded together with the reason it was accepted.
3. A live product in developer tooling or project management. Then the name
   costs more than it returns, and this task hands a rename back to the
   decision that chose it ([TL-20](TL-20-close-the-tool-s-name-before-open-source-publication.md)).

The window is the same one TL-81 named: the name is exchangeable until the
first publication, and only until then.

## Pre-flight reading

1. `backlog/tasks/TL-81-distribution-channels-and-the-worktrail-name-collision-in.md` — what was measured about the name, and the reasoning that made it a business asset rather than a label.
2. `docs/license-and-contributions.md` §3 — where the open/cloud line runs, which is why the name matters commercially.
3. `.claude/skills/branchling-release/SKILL.md` §7 — the pre-publication name checks as they stand; this task's finding belongs there.

## Steps

1. Look at what `github.com/worktrail` actually is: the 6 public repositories, their last activity, any linked site.
2. Check the same name outside npm and GitHub where it costs one request each: a `worktrail.com` / `.dev` lookup and a plain web search for the product.
3. Record the outcome as a decision with its reasoning — including, if the name stays, the reason it was accepted rather than "nothing was found".
4. Extend the checks in the release gate so a future name is checked against forges and the web, not just against a package registry.

## Acceptance criteria

- [x] The task records what the `worktrail` organisation is, with the evidence it was read from. [proof: the-finding]
- [x] The decision — keep the name or reopen it — is recorded with its reasoning, not just the finding. Recorded in `## Decisions`: REOPENED, and handed back to TL-20.
- [x] The release gate's name checks cover a namespace beyond npm. `.claude/skills/branchling-release/SKILL.md` §7 now checks forges, GitLab, Docker Hub, PyPI and the domains, and says what to ask of a hit.

## Findings

Measured 2026-09-03. Every line below is a request anyone can repeat; the
commands are in the verification block and in the release gate.

**`github.com/worktrail` is not a handle, it is a product.**
`api.github.com/users/worktrail` → 200, `"type": "Organization"`,
`"name": "WorkTrail"`, created 2013-04-05, `"blog": "https://worktrail.net/"`.
The six public repositories say what it is without any interpretation:

| repository | description | last push |
|---|---|---|
| `worktrail-app-api` | Java client for the WorkTrail Developer API | 2014-09-19 |
| `worktrail-app-hub-sync` | syncs JIRA activity streams **and git commits** into WorkTrail | 2014-09-19 |
| `worktrail-app-jira-worklog` | syncs WorkTrail time entries into the JIRA worklog | 2014-09-10 |
| `odoo-addons-worktrail` | WorkTrail in Odoo HR | 2016-01-20 |
| `worktrail-garmin-connect-iq` | Garmin Connect IQ app for WorkTrail | **2024-02-08** |
| `django-social-auth` | a fork, unrelated | 2018-04-13 |

**The service is live, and it is stale.** `worktrail.net` → 200, "Time Tracking
made easy", with Tour / Pricing / Login / Sign Up, "Manage your projects &
tasks", CSV and Excel export, reports and time sheets; operated by TaPo-IT OG
(Austria), also trading as CodeUX.design. Its TLS certificate was renewed
2026-08-02, so somebody still runs it. Against that: the last blog post is
2015-02-19, the footer says "© 2012-2019", the last code activity anywhere is
2024-02-08, and the iOS app is **gone** — `itunes.apple.com/lookup?id=625741099`
returns zero results, while the Play Store listing (`at.tapo.worktrail.android`,
released 2013-03-11) survives with the same 2024-02-08 date. There is a Capterra
page and a LinkedIn showcase. This is an incumbent in maintenance, not a corpse
and not a competitor in motion.

**Which of the task's three outcomes this is: the third.** Not a dormant handle
(outcome 1) and not an unrelated field (outcome 2). Time tracking with project
and task management, whose own integrations are JIRA and git commits, is the
same shelf this tool is on — and it is the shelf the paid side of
[`docs/license-and-contributions.md`](../../docs/license-and-contributions.md)
§3 is aimed at: work entries, reports, time sheets, team management.

**The collision was already known, and was discounted on a premise that is
false.** [TL-20](TL-20-close-the-tool-s-name-before-open-source-publication.md)'s candidate
table of 2026-08-29 records the row `worktrail / tasktrail | free | free |
taken / —`. The reversal of 2026-09-01 named that fact and dismissed it twice:
`worktrail` "lost back then only on a taken GitHub account", and "GitHub: 17
scattered hits, **none an active tool on this shelf**". The search count still
returns 17 today — and four of the top five hits are this one company's
(`worktrail/*` plus `tapo-it/odoo-addons-worktrail`), all describing one
commercial time-tracking product. The hits are not scattered and the shelf is
not clear. **What is new in this task is not the collision; it is that the
reason for accepting it does not hold.**

**The name outside npm and GitHub.** `worktrail.net` is theirs and live.
`worktrail.com` and `worktrail.dev` do not resolve at all — no DNS, so neither
is even parked. `worktrail.io` is a domain freshly registered through Namecheap
and parked for resale. On registries the name is still free everywhere it was
free before: npm 404, PyPI 404, Homebrew 404, GitLab group 404, Docker Hub 404
(crates.io answers 403 to an unauthenticated request and was not established).

**What was NOT established: the trademark.** Whether TaPo-IT OG holds a
registered mark on "WorkTrail" is the fact that decides whether this name can
ever be the business asset [TL-81](TL-81-distribution-channels-and-the-worktrail-name-collision-in.md)
argued it must be — and it could not be checked from here. The registers are
not machine-queryable without credentials: USPTO's search API refuses POST,
Justia is behind a Cloudflare challenge, WIPO's Global Brand Database serves
only its single-page shell, and both `euipo.europa.eu` and `tmdn.org` reset the
connection. That is a gap, not an absence of a mark, and it is
[TL-179](TL-179-a-trademark-clearance-search-for-the-published-name-is-not.md).

## Decisions

- **The name is REOPENED, and this task does not choose a new one.** Outcome 3
  is what the evidence says, and the task's own framing sends outcome 3 back to
  [TL-20](TL-20-close-the-tool-s-name-before-open-source-publication.md). Choosing a name is
  that task's work, with the criteria the release gate now carries; doing it
  here would settle in passing the one thing this task exists to hand over.
- **The decisive argument is identity, not law.** It holds whether or not
  TaPo-IT OG holds a registered mark, which is why [TL-179](TL-179-a-trademark-clearance-search-for-the-published-name-is-not.md)
  does not gate this decision: a brand's only job is to be an unambiguous
  pointer, and in an ADJACENT niche the pointer is ambiguous exactly where it
  has to work. Every query that should find this tool — "worktrail time
  tracking", "worktrail jira", "worktrail export" — lands on thirteen years of
  their content. The canonical address of an open-source project is
  `github.com/<name>/<name>` and that address is theirs, so every link this
  project ever publishes reads as a workaround. A name that needs a sentence of
  explanation has stopped being a name.
- **A trademark would only sharpen it, never soften it.** Likelihood of
  confusion turns on similarity of GOODS, and here they are the same goods:
  work entries, reports, time sheets, JIRA and git integration, team
  management. That is the worst configuration available, and it is the exact
  territory `docs/license-and-contributions.md` §3 reserves for the paid side.
  So the unchecked register is a risk that can only be worse than assumed — it
  cannot rescue the name.
- **Dormancy was weighed and rejected as a reason to keep it.** The incumbent is
  in maintenance: 2015 blog, delisted iOS app, last commit 2024-02. Two things
  make that irrelevant. A live checkout page and a renewed certificate mean
  somebody is still selling, and — separately from them entirely — the search
  results, the Capterra page and the Play Store listing do not decay on the
  timetable of the company that made them. Their SEO outlives their roadmap.
- **`worktrail.com` and `worktrail.dev` do not resolve, and that changed
  nothing.** No DNS is not the same fact as unregistered, and even a free `.com`
  would not undo a forge namespace, a store listing and a review-site profile
  already pointing elsewhere.
- **The cost of reopening is at its historical minimum and only rises.** Nothing
  is published, npm is still 404, and [TL-117](TL-117-product-name-from-a-single-constant-not-from-a-literal.md)
  has already pulled the name into `scripts/product.mjs`, so this is no longer
  the 158-file change the `tasklog` → `worktrail` pass was. The window TL-81
  named closes at the first publish, and it is still open.
- **The gate was extended even though the name is being reopened**, because the
  defect it fixes is not about `worktrail`. A clear package registry was read as
  a clear name, and no check looked anywhere else. Whatever name TL-20 picks
  next would have been cleared by the same insufficient pass.
