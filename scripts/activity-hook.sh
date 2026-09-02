#!/bin/sh
# A PostToolUse adapter: one heartbeat per tool invocation (TL-28).
#
# WHY THIS FILE IS FOUR LINES. Everything that decides — which task, whether the
# window has passed, which actor — is in `activity record`, because §7 of
# docs/backlog-time-tracking.md requires the core to work over somebody else's
# process. An adapter that decided anything would be a rule the git hook, the
# shell prompt and the next editor do not have.
#
# WHY IT MUST BE WIRED TO **EVERY** TOOL, not `Edit|Write|MultiEdit` like the
# rebuild hook beside it. A matcher over a subset does not undercount uniformly
# — it undercounts in a way CORRELATED with the kind of work: a task spent
# running tests would come out nearly free and a task spent writing files
# expensive. A correlated undercount looks like signal and goes straight into
# the estimate calibration. The throttle in `activity record` is what makes the
# wide matcher affordable.
#
# WHY IT NEVER FAILS. A hook that exits non-zero paints an error banner over an
# edit that worked. Losing a heartbeat costs a minute of resolution; failing the
# edit costs the user's attention. `|| true` is the whole error policy.
#
# The payload the host writes on stdin carries `session_id`, `tool_name`,
# `tool_input.file_path` and `cwd`; `activity record` reads what it can use and
# ignores the rest.

# No `exec`: it would replace this shell, and the failure policy below would
# then never run.
node "$(dirname "$0")/cli.mjs" activity record --source hook >/dev/null 2>&1
exit 0
