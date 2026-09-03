---
id: TL-95
title: "LLM adapter for seed: a project description into a task plan"
type: task
labels: []
board: main
epic: "Agentic distinguishers"
priority: P2
status: done
owner: agent:claude
estimate: 1d
confidence: low
created: 2026-08-31
updated: 2026-09-02
blocked_by: [TL-94]
blocks: []
related_docs:
  - docs/branchling-global-tool.md
verification:
  - id: suite
    bash: "node --test scripts/tests/seed-adapter.test.mjs"
  - id: both-routes
    bash: "node scripts/cli.mjs plan-from --help | grep -q 'plan-from spec.md' && node scripts/cli.mjs seed --help | grep -q -- '--from <spec>' && echo 'both the pipe and the shortcut are documented surfaces — OK'"
  - id: nothing-hardcoded
    bash: "grep -q 'llm_endpoint' scripts/home.mjs && ! grep -q '11434' scripts/config.mjs && test -f templates/seed-plan.md && echo 'the endpoint is the user layer and the prompt is a file — OK'"
  - id: no-network
    bash: "grep -qE 'node:(http|https|net|tls)' scripts/seed-adapter.mjs && exit 1; node --test scripts/tests/seed-adapter.test.mjs >/dev/null 2>&1 && echo 'the suite passes with no Ollama and no network — OK'"
  - id: model-recorded
    bash: "grep -q 'model: settings.model' scripts/seed-adapter.mjs && echo 'the plan metadata carries the model that produced it — OK'"
  - id: unconfigured
    bash: "d=$(mktemp -d); node scripts/cli.mjs init --dir \"$d\" --no-example >/dev/null; echo 'A project.' > \"$d/spec.md\"; node scripts/cli.mjs plan-from \"$d/spec.md\" --dir \"$d\" 2>&1 | grep -q 'no model is configured' && test $(ls \"$d/tasks\" | wc -l | tr -d ' ') -eq 0 && echo 'an unconfigured machine gets a message, not a traceback, and nothing is written — OK'"
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
  ([docs/branchling-global-tool.md](../../docs/branchling-global-tool.md) §3).
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

- `backlog/tasks/TL-94-tasklog-seed-plan-projektu-jako-wejscie-do-backlogu.md`
  — the plan format and validation behavior; the adapter is its client.
- [docs/branchling-global-tool.md](../../docs/branchling-global-tool.md) §3 —
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

- [x] The adapter works both through `seed --from` AND as a standalone producer on stdout — both cases have a test. [proof: both-routes]
- [x] No endpoint, model, or prompt hardcoded in the code. [proof: nothing-hardcoded]
- [x] Rejection of the plan by seed ends in an explicit retry or an explicit failure — never a silent correction of the plan by the adapter. [proof: suite]
- [x] Tests pass without a running Ollama and without network. [proof: no-network]
- [x] The plan's metadata carries the model used (input for a future measurement of plan quality per model). [proof: model-recorded]

## The manual end-to-end run

TL-95 asks for this as a PROCEDURE rather than an automated test, because a test
that needed a running model would be a test nobody can run. Anybody with Ollama
can repeat it:

1. `ollama pull llama3.1`
2. In your own preferences file (`worktrail where` prints its path):
   `llm_endpoint: http://localhost:11434` and `llm_model: llama3.1`
3. Write a `spec.md` of a few paragraphs describing a small project.
4. `worktrail plan-from spec.md` — a plan on stdout, and nothing written.
5. `worktrail seed --from spec.md --dry-run` — the same plan, judged, with the
   numbers it would take.
6. Drop `--dry-run` to write it.

What to look at: whether the retries appear on stderr when the model's first
plan is rejected, and whether `meta.model` in the plan names the model you
configured rather than whatever the model called itself.

## Log

Append-only. Format: `YYYY-MM-DD status — who — note`.

- 2026-08-31 blocked — agent:claude — task created for the "one prompt → a
  working project" scenario; waiting on the plan format from TL-94. First
  backend: Ollama, the same code for OpenAI-compatible endpoints.
- 2026-09-02 in_progress — agent:claude — the four model settings went into the
  USER layer as one set (`llm_endpoint`, `llm_model`, `llm_retries`,
  `llm_timeout_seconds`), for the reason that layer's own comment gives: two
  people on one repository can reasonably run a local model and a hosted one and
  both be right, so a value they can disagree about is theirs, not the
  project's. Declared together rather than one per task, because an unknown key
  fails and staggering them would reject a file written for the next one.
- 2026-09-02 in_progress — agent:claude — `--from` is a SHORTCUT FOR A PIPE and
  not a second way in: `seed --from` spawns the adapter exactly as a stranger's
  would be spawned and reads its stdout, and both routes then share one body
  (`seedFromText`) so they cannot drift. That is the whole of Law 4 here — the
  interface is a JSON document, and somebody else's adapter in somebody else's
  language is a first-class citizen rather than a plugin.
- 2026-09-02 in_progress — agent:claude — the one forgiveness in the parser is
  stripping a code fence, and it is deliberately the only one: that is reading
  the TRANSPORT, not repairing the plan. Malformed JSON inside is reported and
  handed back to the model. Of retry, fail and quietly patch, only the third is
  dangerous — it produces a plan nobody wrote and nobody can trace — so it does
  not exist, and the test that matters asserts the plan returned on a failure is
  the model's own answer byte for byte.
- 2026-09-02 in_progress — agent:claude — the model is stamped into
  `meta.model` by the ADAPTER, overwriting whatever the answer claimed: an
  answer cannot be trusted about its own identity, and this field is the input
  to a measurement (plan quality per model) that cannot be reconstructed
  afterwards from data that does not carry it.
