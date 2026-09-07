# Reference agent adapters

These files are small, ordinary executables. Copy one into a directory you
control, make it executable, and point a local Branchling profile at it. They
are examples of the public process contract, not built-in providers and not a
registry. The `examples/agent-adapters/` directory ships in the npm package.

`claude-code.mjs` delegates work to an already authenticated Claude Code CLI.
It passes the profile's model and effort using that CLI's current flags. Before
choosing a model alias, inspect the version installed on your machine with
`claude --help`.

`aider-api.mjs` delegates to Aider, a coding harness that owns its API request,
authentication, tool loop and edits. It passes model and reasoning effort to
Aider. Install Aider and use `aider --list-models` or its current documentation
to choose a model specification supported by your endpoint.

`codex-cli.mjs` delegates to an already authenticated Codex CLI subscription.
It supports the profile model through `codex exec --model`. Its optional
`effort` is scoped to that one invocation with
`-c model_reasoning_effort="…"`: `low`, `medium`, `high` and `xhigh` are
accepted. Leave it blank to preserve the Codex CLI default; any other value
fails before Codex starts, rather than changing a global Codex configuration.

`ollama.mjs` delegates to a local Ollama model. Pull the model first, for
example `ollama pull qwen2.5-coder:7b`, then set that exact name as the profile
model. It forwards effort to Ollama's `--think` flag when set.

Neither adapter contains credentials. Declare only the environment-variable
name that its harness needs; the value remains in your shell or credential
store. For example, after copying the files:

```bash
chmod +x claude-code.mjs aider-api.mjs codex-cli.mjs ollama.mjs

branchling profile create developer \
  --adapter "$PWD/claude-code.mjs" \
  --model "<a current Claude model alias>" \
  --effort high \
  --prompt "Implement from evidence."

branchling profile create api-reviewer \
  --adapter "$PWD/aider-api.mjs" \
  --model "<a model specification accepted by Aider>" \
  --effort high \
  --prompt "Review from evidence." \
  --secret-env OPENAI_API_KEY

branchling profile create codex-developer \
  --adapter "$PWD/codex-cli.mjs" \
  --model "<a current Codex model alias>" \
  --effort medium \
  --prompt "Implement from evidence."

branchling profile create local-developer \
  --adapter "$PWD/ollama.mjs" \
  --model "qwen2.5-coder:7b" \
  --effort high \
  --prompt "Implement from evidence."
```

For another API provider, retain the adapter contract: read task input from
standard input; read model, effort and paths from the `BRANCHLING_*`
environment variables; keep provider requests, credentials and tool use inside
the adapter; and exit with the harness result. Use the provider's own required
credential-variable name in `--secret-env`. The task remains untrusted input.

Before assigning a copied adapter real work, prove its process behavior without
credentials or network access:

```bash
branchling conformance --adapter "$PWD/aider-api.mjs"
branchling profile check api-reviewer
branchling run --profile developer
branchling run --profile-for review=api-reviewer
```

`profile check --live` is optional. It may contact the selected tool or use its
credentials and quota; ordinary `profile check` and `conformance` do neither.
