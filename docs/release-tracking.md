# Release tracking across environments

**Status:** IMPLEMENTED 2026-11-02 (TL-501, TL-502, TL-503, TL-504, TL-505, TL-506, TL-507, TL-508, TL-516)

The question this answers: of the tasks that are finished, which are waiting
for the test environment, which are waiting for production, and which have
reached users. It has to answer it for projects that release in very different
ways, so this document starts from the approaches and derives one model that
covers all of them.

## 1. Intent is written, deployment is observed

Every tracker studied keeps the two apart. Jira separates the workflow status
and the planned `fixVersion` from a Deployments panel that CI feeds, linking
deployments to issues through issue keys in the commit messages of the
deployed branch. Linear's Releases documentation states that issue status
alone does not show whether work reached staging or production, and creates a
release from CI with a commit SHA. GitLab marks merge requests deployed to an
environment; Sentry associates commits with a release and records deploys per
environment.

Here that division falls on the laws (`docs/branchling-global-tool.md` §3):

- **What a person decides is task data** and travels with the branch (Law 1):
  the status, and the release a task is planned for (TL-505).
- **Where a change is deployed is observed** and therefore computed (Law 2).
  An `environment:` field typed by hand was rejected: a rollback would never
  update it, and the stale value would read exactly like a fact.

The link between the two already exists: the task id in a commit message,
which `scripts/modified-files.mjs` (TL-75) reads.

## 2. The shapes of product the model must cover

No kind of product is assumed. A mobile app is one shape among several, and
the same three mechanisms — a ref git moves, a ref CI moves, a ref the tool
moves on somebody's word — cover all of them:

| Product shape | Typical stages | How each stage is declared |
|---|---|---|
| Web application or API, a branch per environment | trunk → test → production | `ref: origin/main`, `ref: origin/production` |
| Web application, trunk-based, CI deploys a SHA | trunk → staging → production | CI moves `refs/deploys/<target>/<stage>`: `git push --force origin <sha>:refs/deploys/web/production` |
| Web application with a canary or blue/green switch | … → canary → production | the canary is a stage of its own, moved by CI or recorded |
| Desktop application (installers, auto-update channels) | tag → beta channel → stable channel → staged rollout 100% | `ref: "refs/tags/desktop-v*"`, then recorded stages |
| Mobile application | tag → store review → staged rollout 100% | `ref: "refs/tags/mobile-v*"`, then recorded stages |
| Library or CLI published to a registry | tag → published | `ref: "refs/tags/v*"`; publication is recorded, or is the tag itself when CI publishes every tag |
| GitFlow release branches | trunk → `release/x.y` → production | `ref: "refs/remotes/origin/release/*"`, newest by version |
| Several regions or tenants deployed separately (eu, us) | … → production in each | one stage with several refs (§3) |
| Several maintained release lines (1.x and 2.x both patched) | per line | one stage with several refs (§3), one per line |
| Self-hosted installations run by customers | … → published → installed per customer | published is a ref; installed per customer is a recorded stage with one ref per customer, or not tracked at all |
| Several deployables in one repository (web plus desktop, API plus worker) | per deployable | one `deploy_targets` entry each, selected by paths |
| A deployable whose code lives in another repository | its own, not observable here | `repository:` instead of `paths` and `stages`, and the task names it in `target:`; its tasks are unobservable (§6) |
| A project with no environments at all | — | the key is absent and nothing changes |

Continuous delivery and scheduled release trains need no separate mechanism:
the stages are the same, only how often a ref moves differs. What a train adds
is a planned scope, which is TL-505.

## 3. The model

```yaml
deploy_targets:
  - name: web
    paths: [web/, api/]
    stages:
      - { name: test,    ref: origin/main }
      - { name: staging, ref: refs/deploys/web/staging }
      - name: production
        refs: [refs/deploys/web/production-eu, refs/deploys/web/production-us]
  - name: desktop
    paths: [desktop/]
    stages:
      - { name: tagged,  ref: "refs/tags/desktop-v*" }
      - { name: beta,    ref: refs/deploys/desktop/beta,   recorded: true }
      - { name: stable,  ref: refs/deploys/desktop/stable, recorded: true }
```

- **A target** is something deployed on its own. `paths` selects which
  commits belong to it; a project with one deployable omits `paths` and the
  whole repository is one target.
- **Stages are ordered** — the order is the promotion order — and every
  stage is a git ref: a ref name, or a tag glob resolved to the newest match
  by version sort. One mechanism, so a rollback (a ref moved back) removes
  tasks from a stage without anybody editing anything.
- **A stage may have several refs in parallel** (`refs:` instead of `ref:`):
  regions, tenants or maintained release lines that are deployed separately
  but stand at the same step of the promotion. A task has reached such a stage
  when it is in every one of them; until then the answer names which ones
  hold it, because "production" while one region still runs the old code is
  exactly the gap this tool exists to show.
- **A task's targets are computed** from the paths its commits touched. A task
  touching two targets has reached users only when it is in the last stage of
  both.
- **Per task and stage the answer is full, partial or absent.** Partial means
  some of the task's commits are in the stage and later ones are not; it is a
  state of its own, never rounded either way.
- **A ref that does not resolve is unknown, never empty.** An unresolvable
  production ref must not read as "nothing is deployed".
- **The answer is only as fresh as the refs it read.** A remote-tracking
  branch moves only on `git fetch`, and the default refspec fetches
  `refs/heads/*` and tags only, so `refs/deploys/*` written by CI or by a
  recorded stage reaches no other clone until the remote's fetch refspec
  includes it. Every report therefore names the SHA of each ref it resolved,
  and `doctor` reports a declared ref namespace the remote does not fetch
  (TL-508). A stage declared by a short name is judged by what it resolves to
  in the clone: one that reads a ref outside `refs/heads/`, `refs/remotes/` and
  `refs/tags/` is checked under that full name, and one that resolves to
  nothing while naming no remote is a warning (TL-510).

## 4. Recorded stages

Some stages have no git event: a store approves a build, an update channel
is promoted, a staged rollout reaches 100%, a customer installs a version,
somebody signs off a feature on the test environment. Querying
those systems would make the tool depend on each of them; Law 4 points the
other way — a callable input. The `deploy record` command, given a
target, a stage, a commit or tag and a reason, moves the stage's ref and
writes an annotated tag object carrying the actor, the time and the reason, so a
recorded stage is still a ref, is shared by `git push`, and its history is
inspectable. A CI step or a person calls it; the tool never polls (TL-506).

The two commands are `deploy status` and `deploy record`, not subcommands of
`release` (decided by the owner on 2026-11-02, TL-513): `release <ID>` already
returns a claimed task to the queue, and one word naming both that and
shipping software was an ambiguity, while the configuration key was already
`deploy_targets`. No alias was kept, because neither old spelling shipped in a
published version; `release status` and `release record` fail and name the new
command. `release:` (the release a task is planned for), `releases:`,
`check --release` and the `--json` kinds `release-status` and `release-record`
keep their names.

### A release that has shipped

TL-505 bounded the unplanned list to work still in the pipeline, so once a
release went out, the unplanned work that went with it disappeared from the
report. Decided by the owner on 2026-11-02 (TL-516): an entry of `releases:`
may be `{name, ref}` beside the plain slug, `ref` naming the ref or tag where
the release ends — one point, so a glob is refused. Both shapes are accepted in
one list; `config.releases` stays the list of names, normalised once in
`scripts/release-entries.mjs`, so every reader of the vocabulary works on both,
and only the scope report and the current release read `releaseEntries`.

- **The range** of a release with a ref begins at the ref of the nearest earlier
  entry that names one, and at the root for the first. An earlier entry without
  a ref is skipped rather than read as the root, which would hand that release's
  work to this one. The commits carried are `<begin>...<end>` with
  `--cherry-pick --right-only`, so a patch the previous release already carried
  is not counted again (§5).
- **The scope** (`shippedScope()` in `scripts/release-status.mjs`, read by
  `scripts/release-shipped.mjs`): a planned task not held in full by the ref —
  every trunk commit naming it reachable from it or present by patch, or, for a
  task with no trunk commit, a commit the release carried — is "planned, not
  shipped"; a task named by a commit in the range and planned for another
  release or none is "shipped, unplanned". The pipeline's "carried by the next
  promotion" is `null` for such a release.
- **Unknown is not empty.** An end that does not resolve leaves the release
  unknown; a beginning that does not resolve leaves only the range unknown.
- **The current release** treats a release with a ref as shipped when the ref
  resolves and holds every planned task that is not dropped, and every one is
  closed. A task the release went out without keeps it current until it is
  planned for a later release or dropped — a person's decision, which the gate
  keeps asking for. A release without `ref` is judged by the pipeline, as
  before.

## 5. How commits are matched to tasks

- **The id may stand anywhere in the message** — title, body or a trailer —
  because the scanner from `scripts/task-id.mjs` reads the whole message.
- **Only commits reachable from the trunk count.** Branch commits that a
  squash merge never brought to the trunk are ignored, so squash merges, merge
  commits and rebases give the same answer.
- **A cherry-picked hotfix counts by patch identity**, not by SHA (`git
  cherry`), so a fix picked onto `production` is seen there — and if it is
  missing from the trunk, the gate reports it, because the next ordinary
  deploy would revert it.
- **A repository whose commits carry no ids gets an empty answer with an
  explanation**, never "nothing is deployed".

## 6. What is deliberately not tracked

- **Per-pull-request preview environments.** They are ephemeral and belong to
  a branch, not to a step of the promotion; the pull request is already the
  unit there.
- **Commits that live in another repository.** A backlog in one repository
  whose tasks are implemented in another (a separate frontend repository, for
  instance) cannot see those commits from its own git. Decided by the owner on
  2026-11-01 (TL-507): such a deployable is declared as a target with
  `repository:` — the other repository's name, in the shape of the `<repo>`
  half of a `<repo>#<path>` reference — and a task names it in its own
  `target:` field, because such a task has no commit here whose paths could
  assign it. TL-507 carried that link in the task's labels; the owner moved it
  to a field of its own on 2026-11-02 (TL-514), because a label is a category
  and letting it also mean "this task ships from that repository" gave one
  value two roles. `target:` is a list — a task may span two other
  repositories — whose vocabulary is the names of the targets carrying
  `repository:`, closed even when empty; a local target is outside it, since
  its tasks are computed from commit paths and a membership typed by hand
  would contradict that computation. `labels:` on a target is refused with a
  hint naming `target:`. Every reader — `deploy status`, the gate, the viewer,
  `query`, `show` — asks one helper, `externalTargetsOf()` in
  `scripts/deploy-targets.mjs`. The target may declare neither `paths` nor
  `stages`, both of which would be read against this repository's git. Its
  tasks are reported as **unobservable**, never as undeployed: `deploy status`
  and the viewer give the target a lane of one bucket naming them, and no gap
  detector reports them on its account — `done-not-on-trunk` and the
  every-target fallback of `planned-blocker-open` skip them, and the gate
  states how many tasks each such target holds. `query` names them as well
  (TL-512): on each task's `deploy` in `--json`, and as the reason `--env` /
  `--not-env` hold a task out when the other repository's half would decide
  the answer. Commits this repository does hold are judged as everywhere else.
  Reading the other repository's refs — a local clone or a remote fetched
  read-only — was weighed and deliberately deferred: Law 1 keeps the task here
  either way, and only the evidence would move.

- **Whether a feature flag is on.** Code being deployed is not the feature
  being live. If a project needs that stage, it is a recorded stage; the tool
  does not read flag systems.
- **Adoption** — how many users run which build — is live telemetry, not
  history.
- **Work that must wait for old versions to expire** (the contract half of an
  expand/contract change) is a task that is `blocked` with a reason; the
  condition is a measurement outside git.

## 7. The gaps the gate refuses

The release mode of `check` (`check --release`, TL-503), run by CI before a
promotion, reports: a deployed commit naming no task; a deployed task that is still open; a
partially deployed task; a commit in a later stage missing from the trunk or
an earlier stage; a `done` task whose commits never reached the trunk; a
task id that does not exist; a commit touching no target's paths; and, from
the plan side (TL-505), an open task at the top of `priorities:` planned for
the current release, against the last stage of its targets (decided by the
owner on 2026-11-01). The current release is computed, not configured: the
order of `releases:` is chronological, and the current one is the first not yet
fully shipped — every planned task that is not dropped closed and in full in
the last stage of every target it touched, an unknown last stage counting as
not shipped, and a task whose commits touched no target satisfying it
vacuously. Releases after it never block, and when every release has shipped
nothing planned does; when deployment was not read, no release is judged
current at all (decided by the owner on 2026-11-02, TL-515; a
`current_release:` key was rejected as a pointer somebody must remember to
move). A project
that knowingly accepts one of these names it in configuration
(`release_gate_accept`); an unknown gap name fails. Whether a gap blocks is
`release_gate`: `report`, the default, prints and exits 0; `require` exits
non-zero on any gap not accepted (decided by the owner on 2026-11-01, because
version-bump commits carry no task id). The usage is in
[`manual.md`](manual.md#the-release-gate).
