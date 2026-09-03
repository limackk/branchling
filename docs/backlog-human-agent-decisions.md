# Backlog — human/agent executor, decision log, panel and graph

**Status:** PLANNED 2026-09-01
([TL-113](../backlog/tasks/TL-113-pole-executor-wymog-czlowieka-egzekwowany-w-dyspozytorze.md),
[TL-114](../backlog/tasks/TL-114-zdarzenie-decision-i-komenda-tasklog-decide.md),
[TL-115](../backlog/tasks/TL-115-panel-decyzyjny-w-viewerze-co-czeka-na-czlowieka.md),
[TL-116](../backlog/tasks/TL-116-graf-zmian-taska-w-viewerze-z-osi-historii.md))
**Builds on:** roles and handoff
([TL-97](../backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md),
[TL-98](../backlog/tasks/TL-98-role-w-dyspozytorze-i-petli-next-role-agent-per-rola.md),
[TL-99](../backlog/tasks/TL-99-tasklog-handoff-przekazanie-taska-z-powodem-i-sladem.md))
and the history mechanism ([backlog-field-editing-history.md](backlog-field-editing-history.md)).

---

## 1. The problem

In a workflow involving agents, some decisions can be made by an agent (the
answer is in the documentation), and some MUST be made by a human (a product
decision) — independent of role: the same "analyst" is sometimes an agent,
sometimes a human. On top of that, two visibility needs: every decision
should be recorded and viewable as a graph of the task's course, and a human
should have one place to see what is waiting on their decision and be able
to unblock the work.

## 2. Human vs. agent is a third axis, not a new role

Four questions, four different owners — conflating them was this project's
main risk:

| Question | Owned by | Where |
|---|---|---|
| What COMPETENCE does the task require? | the task (data) | `role:` — a project vocabulary (TL-97) |
| Does THIS decision require a human? | the task (data) | `executor: human` (TL-113) |
| Do I have an agent for this role? | the user's deployment | the `run_agent_commands` map (TL-98) |
| Who actually recorded the change? | history | `actor` with the `agent:`/`local:`/`user:` namespace (TL-21) |

Decisions (2026-09-01):

- **Rejected: `analyst-human`/`analyst-agent` roles.** A cartesian blow-up of
  the vocabulary; the dispatcher loses "any analyst"; competence and the
  kind of executor are different axes.
- **Rejected: escalation triggered solely by a missing entry in the `run`
  map.** A missing entry is a fact about the deployment ("I have no
  analyst agent"), a human requirement is a fact about a specific task — it
  travels in that task's frontmatter through review (Law 1). The layers are
  disjoint (Law 3); one does not replace the other.
- **`executor` has a fixed `human|agent` shape in the code, with no
  vocabulary in `config.yaml`** — it is the shape of a field, like the
  closed actor namespaces, not the project's vocabulary.
- **The dispatcher knows the caller's kind from the actor's namespace** —
  `agent:` vs. everything else; zero new configuration.
- **Enforcement lives only in the dispatcher** (`next`/`run`): a skip with an
  explicit count ("N tasks waiting on a human"), never silence. An explicit
  `take` still works and is recorded — a human who tells an agent to do a
  given task is themselves that human decision (the rule from TL-97).

## 3. A decision as a first-class event

Handoff (TL-99) records a QUESTION as a `__comment__`. An answer gets its own
event type, `__decision__` (TL-114), because a comment and a decision differ
in machine terms: the panel counts "questions with no decision", the graph
draws decisions as nodes.

```json
{"ts":"…","task":"TL-1234","field":"__decision__",
 "to":"We're going with variant B, because…","resolves":"<question ULID>",
 "actor":"local:me","source":"viewer","id":"<ULID>"}
```

- **Open question** := a question event that no `__decision__.resolves`
  points to. That is the entire definition of the "waiting on a decision"
  state — computable from history, with no new state file (Law 2).
- `resolves` is optional (a decision with no question is legal); pointing at
  a ULID outside the task's history fails before the write.
- An agent's decision and a human's decision share an identical schema —
  the actor namespace tells them apart; auditing "agent decisions" is one
  filter.
- Inputs: `branchling decide` (CLI, Law 4) and an action in the viewer — both
  through the same write path; both also leave a human-readable line in the
  task's `## Log`.

## 4. The "waiting on you" panel

A pure view computed from three queries (TL-115):

1. open, unblocked `executor: human` tasks + tasks with a role missing from
   the agent map;
2. open questions (definition from §3), with the asker and the question's
   age;
3. for each entry — the transitive `blocks`: "unblocks N tasks" is the
   priority unit and the panel's default sort.

Decisions: the panel computes from live `tasks/*.md` and history (never from
generated views); actions write exclusively through existing endpoints (one
write path — the lesson from [backlog-field-editing-history.md](backlog-field-editing-history.md)
§5); the "assigned to me" filter works on the actor's declaration until hard
identity exists (that document's §7 point 2); in `file://` mode the panel is
visible with no actions; filter state lives in the URL.

## 5. The task change graph

A second rendering of the existing history axis (TL-116), zero new data:
nodes are significant events (creation, status transitions, handoffs,
questions, decisions), other field changes are collapsed; a question→decision
pair is linked via `resolves`; color distinguishes `agent:`, a human, and
`unknown`. The history fold is shared with the board time-lapse
([TL-91](../backlog/tasks/TL-91-time-lapse-boardu-odtwarzany-z-logu-zdarzen.md))
— two separate folds would drift in their definitions. The data boundary is
explicit: history starts on 2026-08-30 and the graph does not hide that.

## 6. Rollout order

TL-113 (field + dispatcher) → TL-114 (event + `decide`) →
TL-115 (panel) ∥ TL-116 (graph). All by composing existing
primitives; there is deliberately no workflow engine (the decision from
TL-97 — "roles are not a workflow").
