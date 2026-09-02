---
id: TL-95
title: "LLM adapter for seed: a project description into a task plan"
type: task
labels: []
board: main
epic: "Agentic distinguishers"
priority: P2
status: pending
owner: unassigned
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-08-31
blocked_by: [TL-94]
blocks: []
related_docs:
  - docs/worktrail-global-tool.md
verification:
  - bash: "node --test scripts/tests/seed-adapter.test.mjs"
---

## Goal

An adapter that turns a project description (`spec.md`, README, arbitrary
prose) into a JSON plan in `worktrail seed`'s input format (TL-94), using the
model named in the user's configuration. First backend supported:
**Ollama** (`localhost:11434`) with response structure enforced via a
`format` field carrying a JSON schema; the same code handles any
OpenAI-compatible endpoint, so a single adapter covers both local and hosted
models.

User-facing effect: `worktrail seed --from spec.md` with no API key and no
subscription — `ollama pull` is enough for the README demo to work for free.

## Context

Grew out of a product decision (2026-08-31) on the "one prompt → a working
project" scenario. The boundary with TL-94 is firm: the `seed` core
validates and writes, the adapter EXCLUSIVELY produces the plan. The adapter
can be a separate script called by `seed --from` or stand alone (`adapter |
worktrail seed`) — both paths must work, because the second is the surface
for other people's adapters (Law 4).

Decisions and constraints:
- **The endpoint and model are the user layer** (`~/.worktrail/config.yaml`,
  TL-34): a fact about the human's machine, not about the project — per Law 3
  ([docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3).
  No URL and no model name in the code.
- **The prompt template is data** (a file in the package, overridable), not
  a string in the code — the user has to be able to tune it without a fork.
- **The model's output is untrusted**: validating the plan is the job of the
  seed core, and that is the only gate. If seed rejects the plan, the
  adapter may EXPLICITLY retry with the error message (a retry limit in
  configuration); once retries are exhausted, it shows the raw plan and
  errors, instead of silently fixing it with its own heuristic.
- **Local models plan worse than frontier ones** — this is an assumption to
  be disproven by measurement, not to be hidden: the adapter logs the model
  in the plan's metadata, and plan quality per model will be measured later
  from backlog data (share of tasks failing verification, reopens — TL-90).
- Tests do NOT call a real model: the HTTP backend is mocked with response
  fixtures (valid, malformed JSON, a plan with no verification). One manual
  end-to-end test with a live Ollama is described in the task as a
  procedure, not as an automated test.

## Pre-flight reading

- `backlog/tasks/TL-94-worktrail-seed-plan-projektu-jako-wejscie-do-backlogu.md`
  — the plan format and validation behavior; the adapter is its client.
- [docs/worktrail-global-tool.md](../../docs/worktrail-global-tool.md) §3 —
  Law 3 (user layer) and Law 4 (composition).
- `scripts/config.mjs` — how configuration is read; the adapter's keys
  belong to the user layer, not the project layer.

## Steps

1. User configuration keys: endpoint, model, retry limit; missing
   configuration = a readable message with instructions (including
   `ollama pull`), not a traceback.
2. Prompt template as a file: role, plan format (with an example),
   requirement for executable verifications and dependencies; substitution
   of `spec.md`'s content.
3. Backend call: Ollama `format` with a schema / OpenAI-compatible
   `response_format`; timeout and readable network errors.
4. Fix-up loop: plan → `worktrail seed --dry-run` → on rejection, retry with
   the list of errors in the prompt, up to the limit; each attempt reported
   to stderr.
5. Tests on mocked HTTP: happy path, unclosed JSON, a plan rejected by seed
   and fixed on the second attempt, limit exhausted.

## Acceptance criteria

- [ ] The adapter works both through `seed --from` AND as a standalone
      producer on stdout — both cases have a test.
- [ ] No endpoint, model, or prompt hardcoded in the code.
- [ ] Rejection of the plan by seed ends in an explicit retry or an explicit
      failure — never a silent correction of the plan by the adapter.
- [ ] Tests pass without a running Ollama and without network.
- [ ] The plan's metadata carries the model used (input for a future
      measurement of plan quality per model).

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created for the "one prompt → a
  working project" scenario; waiting on the plan format from TL-94. First
  backend: Ollama, the same code for OpenAI-compatible endpoints.
