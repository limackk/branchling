---
id: TL-581
title: "Jira issues import from stdin like GitHub issues"
type: task
labels: []
board: main
epic: ""                           # free text — the group this task counts towards
release: ""                        # the release it is PLANNED for (a value from `releases:` in config.yaml). Empty = none
target: []                         # the deploy targets in ANOTHER repository it ships from (`deploy_targets` with `repository:`). Empty = none
priority: P2
status: done  # pending | in_progress | blocked | done | cancelled
owner: agent:loop-2
role: ""                           # WHO MAY take it (a value from `roles:` in config.yaml); `owner:` is who holds it NOW. Empty = anybody
executor: ""                       # human | agent — WHICH SPECIES may be HANDED it. `next` and `run` skip what they are not; `take <ID>` still works. Empty = either
conflict_group: [import]  # the AREA it touches (e.g. a module): `next` and `run` hold it back while a task of the same group is in progress. Empty = `conflict_group_from`, or none
estimate: 1d
confidence: medium                 # how much you trust the estimate
created: 2026-11-05
updated: 2026-11-07
blocked_by: []                     # ids of tasks that MUST be closed before this one starts
blocks: [TL-582]  # ids this task will unblock
related_docs: []                   # paths relative to the repository root
verification:
  - id: jira-import-tests
    bash: "node --test scripts/tests/import-jira.test.mjs"
  - id: help-names-jira
    bash: "node scripts/cli.mjs import --help | grep -q -- '--from jira'"
  - id: github-import-unchanged
    bash: "node --test scripts/tests/import-github.test.mjs"
---

## Goal

`branchling import --from jira` brings Jira issues into the backlog the way `--from github` brings GitHub issues: JSON on stdin, no network request, numbers allocated locally, `verification:` left empty and counted, and a link back to each ticket that also identifies it on a re-run. A team whose tickets live in Jira can pull new ones repeatedly with a JQL filter, and nothing already imported is imported twice.

## Context

TL-65 settled that the tool accepts tasks from an existing tracker by one-off import, never by synchronisation. TL-67 built the GitHub source in `scripts/import-github.mjs`, and its `SOURCES` comment says a second source is a second task. This is that task. On 2026-11-05 an assessment of a Jira integration concluded for two one-directional pipes and against any synchronisation. This task is the inbound pipe; the outbound one (proof comments on the ticket) is a separate task that depends on the link this one writes.

The six TL-67 decisions carry over unchanged: no network, one-off, empty `verification:` counted in the report, the conversation stays behind a link, local numbers, mapping as an argument. Jira differs from GitHub in three places, and each needs a decision of its own:

- **The body is not markdown.** Jira Cloud REST API v3 returns `fields.description` in Atlassian Document Format (ADF), a JSON tree. The tool has zero dependencies, so it needs a small converter for the common nodes: paragraph, heading, bullet and ordered lists, code block, blockquote, rule, hard break, and text with strong/em/code/link marks. A node it does not know must keep its text content and be counted in the report, never dropped silently. Decide whether the v2 API's wiki-markup string is also accepted, or refused with a message naming v3.
- **Statuses belong to each project's workflow.** Every Jira status has `statusCategory.key` (`new`, `indeterminate` or `done`). The default mapping goes by category onto this project's statuses (first status, the in-progress status, the first archived status). A `--status <from>=<to>` argument maps a named status more precisely, by the same rule as `--label`: an argument, not a `config.yaml` key (Law 3).
- **Identity.** The issue's `self` is an API URL. The link a person follows, and the one a re-import recognises, is `<site>/browse/<KEY>`, derived from `self` and `key`. The marker line follows the GitHub one (`Imported from GitHub: <url>`): `Imported from Jira: <browse url>`. The outbound task reads this line, so its shape is a contract once it ships.

There is no Jira equivalent of `gh` that every team has. `--help` should show one pipeline with `curl` against the current Jira Cloud search endpoint, which pages its results. Check the endpoint and its paging against Atlassian's documentation at implementation time rather than copying it from memory. The tests use a fixture captured from a real Jira Cloud response, because this repository does not use Jira and dogfooding will never exercise the shape.

The product layer's concept (branchling-proof, module 7 Adapters) plans a Jira adapter that turns acceptance criteria into a branchling contract through `branchling import`. That adapter can build on this source and only map criteria; this task does not try to extract criteria from ticket bodies.

Not part of this task: writing anything back to Jira, closing or transitioning tickets (unlike TL-580 for GitHub, the ticket stays open because people outside the repository still use it), comments and attachments, a shared importer abstraction beyond what two concrete sources actually share, and a `source:` frontmatter field (TL-67 explains why that is a schema change of its own).

## Steps

1. Read `scripts/import-github.mjs` and its tests; decide what is shared now that two concrete sources exist (parsing stays per source, planning and writing are likely shared), and extract only that.
2. Add `jira` to `SOURCES`, with parsing of the Jira REST search response (`issues[]` with `key`, `self`, `fields.summary`, `fields.description`, `fields.status`, `fields.labels`, `fields.priority`) and the refusals for malformed input.
3. Write the zero-dependency ADF-to-markdown converter, counting unknown nodes.
4. Map status by `statusCategory.key`, with `--status <from>=<to>` overrides; map labels with the existing `--label` and `--label-map`.
5. Write the `Imported from Jira: <site>/browse/<KEY>` marker and dedupe on it.
6. Update `import --help`, the `import` row in `docs/external-consumers.md`, and the "Bringing your team over" section of `docs/guide.md`.
7. Add `scripts/tests/import-jira.test.mjs` with a real-shaped fixture: an open and a done ticket, ADF with a known and an unknown node, a re-run that skips what is already imported, a status override, and malformed input refused with every complaint at once.

## Acceptance criteria

- [x] Jira issues import from stdin with ADF converted, status mapped by category or override, the browse-URL marker written, and a re-run skipping what is already imported. [proof: jira-import-tests]
- [x] `import --help` shows how to bring Jira issues in. [proof: help-names-jira]
- [x] The GitHub source behaves as before after the shared parts are extracted. [proof: github-import-unchanged]
