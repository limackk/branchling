# branchling as a global tool

## Purpose

Branchling is installed once but operates on one repository-owned backlog per
invocation. Its global presence makes the executable and workflow available in
any checkout; it does not create a portfolio layer above those checkouts.

The repository remains the authority for tasks, configuration, history and
verification. `--dir`, `BACKLOG_DIR`, upward discovery and co-location select
that one repository's backlog. A command either resolves one of these sources
or fails; it never falls back to an index of other projects.

## Machine-local preferences

Some facts belong to the person running the command rather than to a project:
the local preferences file, agent profiles and local launch mappings. They live
under the user configuration directory and contain no project vocabulary.
Deleting those files only removes that user's preferences. It cannot change a
task, status, plan, history record or proof in a repository.

This boundary is intentionally narrower than a project registry. A registry
would make one machine hold pointers to several repositories and tempt commands
to assemble their state into a portfolio view. That view is not reviewable with
the branch that produced the work, and external trackers already solve it.

## What the global executable provides

- A consistent terminal interface for repository-owned markdown tasks.
- Portable discovery of one backlog without installing code in that repository.
- User-owned adapter and profile preferences that are disjoint from project
  configuration.
- JSON reading commands and callable writing commands for composition.

It deliberately does not provide a registry of projects, cross-project query,
project switching, fleet management or a plugin API. Those would add a second
authority outside the branch without improving the evidence attached to a task.

## Consequences

One command produces one answer about one resolved backlog. The answer can be
reviewed, committed and reconstructed from the repository that owns it. A
person who needs a portfolio view may use a tracker or a reporting system that
is explicitly responsible for aggregating repositories.

The global tool is therefore a distribution boundary, not a data boundary:
code may be installed globally, while project truth remains local to git.
