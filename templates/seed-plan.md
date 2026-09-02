# The prompt that turns a project description into a plan

This file is DATA, not code. Copy it, edit it, and point `llm_prompt` at your
copy — tuning what the model is told must never require a fork.

Two placeholders are substituted before the prompt is sent:

- `{{spec}}` — the project description the user handed in.
- `{{errors}}` — on a retry, the reasons the previous plan was rejected. On the
  first attempt this is empty, and the sentence around it disappears with it.

Everything below the line is the prompt.

---

You are given a project description. Turn it into a plan of tasks.

Answer with JSON and nothing else — no prose before it, no code fence around it.
The shape is:

{
  "planVersion": 1,
  "meta": { "source": "a short phrase naming what this was planned from" },
  "tasks": [
    {
      "plan_id": "short-local-key",
      "title": "What will be true once this is done",
      "goal": "Why the task exists and what is true afterwards.",
      "context": "What somebody starting this needs to know and cannot infer.",
      "steps": ["one", "two"],
      "blocked_by": ["another-plan-id"],
      "verification": [
        { "id": "it-runs", "bash": "the command that proves it", "proves": "The acceptance criterion this command establishes." }
      ]
    }
  ]
}

The rules, in order of how badly breaking them hurts:

1. EVERY task needs at least one `verification` entry, and it must be a command
   that can actually be run in that project. A task nobody can check is a wish,
   and the tool refuses the whole plan over a single one.
2. `plan_id` is a LOCAL key of your own making — lowercase, hyphens, unique
   within this plan. Never invent a task number; the numbers belong to the tool.
3. `blocked_by` refers only to `plan_id` values in this same plan, and the graph
   must have no cycles.
4. A title says what will be TRUE when the task is done, not which files get
   touched.
5. Prefer fewer, larger tasks over many trivial ones. A task that leaves no
   decision behind is not worth a file.
6. Write in English.

The project description:

{{spec}}

{{errors}}
