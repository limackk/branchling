/**
 * The harness configurations in this repository describe things that exist
 * (TL-391, TL-392).
 *
 * WHY A TEST AND NOT A CAREFUL EDIT. `b5ade06` removed twenty files and every
 * test that named them, and still left two JSON references to
 * `scripts/activity-hook.sh` behind — one in `.claude/settings.json`, one in
 * `.codex/hooks.json`. Both fired on EVERY tool call and exited 127 for two
 * weeks without anybody noticing, because a hook that fails and a hook that ran
 * with nothing to say look identical from the session. Nothing pointed at those
 * files, so nothing could fail.
 *
 * WHAT IT REFUSES TO ASSERT. Not the harnesses' tool names: `Edit`, `Write` and
 * their neighbours are somebody else's vocabulary, they change without asking
 * this repository, and a list of them here would be a second truth that goes
 * stale silently. The test asks only about things THIS tree owns — a path under
 * `scripts/`, a subcommand of its own CLI, a symlink it commits, a value in its
 * own `config.yaml`.
 *
 * THE NEGATIVE CONTROL IS NOT DECORATION. Every assertion below is of the form
 * "nothing in this tree is wrong", which is exactly the shape that passes on an
 * empty sample. Each test therefore counts what it examined and fails at zero,
 * and `the checker can fail` proves the resolver itself reports a missing file
 * rather than quietly finding nothing to look at.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { BACKLOG_DIR, isolateHome, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

// The CLI subprocess below reads the developer's own configuration otherwise,
// and `--help` renders differently once it finds one.
isolateHome("agent-hooks");

/** The harness configurations this repository commits, and nothing else. */
const HOOK_FILES = [join(REPO_ROOT, ".claude", "settings.json"), join(REPO_ROOT, ".codex", "hooks.json")];

/**
 * Every `command` string a `PostToolUse`-style configuration will run.
 *
 * The shape is the harnesses' own — `hooks.<event>[].hooks[].command` — and it
 * is walked structurally rather than by named event, so an event added later is
 * covered without this file being edited.
 */
function hookCommands(config) {
  const out = [];
  for (const event of Object.values(config.hooks ?? {})) {
    for (const matcher of event) {
      for (const hook of matcher.hooks ?? []) if (hook.command) out.push(hook.command);
    }
  }
  return out;
}

/**
 * The repository paths a command names, whatever root it resolves them against.
 *
 * `.claude` spells the root `$CLAUDE_PROJECT_DIR`, `.codex` spells it
 * `$(git rev-parse --show-toplevel)`, and a third harness will spell it a third
 * way. What they cannot vary is the tail — a path under this repository's own
 * `scripts/` or `bin/` — so that is what is matched.
 */
function repoPathsIn(command) {
  return [...command.matchAll(/\/(scripts|bin)\/([A-Za-z0-9._-]+)/g)].map((m) => join(REPO_ROOT, m[1], m[2]));
}

test("every hook command names a file that is in the tree", () => {
  let checked = 0;
  for (const file of HOOK_FILES) {
    assert.ok(existsSync(file), file + " is committed and therefore has to be readable");
    const commands = hookCommands(JSON.parse(readFileSync(file, "utf8")));
    assert.ok(commands.length > 0, file + " registers no hook at all — the sample is empty, not green");
    for (const command of commands) {
      const paths = repoPathsIn(command);
      assert.ok(paths.length > 0, "a hook in " + file + " runs something outside this repository: " + command);
      for (const path of paths) {
        assert.ok(existsSync(path), "a hook in " + file + " runs a file that is not here: " + path);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, "no hook target was examined — this test proved nothing");
});

test("the checker can fail", () => {
  const invented = repoPathsIn("node $ROOT/scripts/activity-hook.sh");
  assert.equal(invented.length, 1, "the resolver has to FIND the path before its absence can mean anything");
  assert.equal(existsSync(invented[0]), false, "if this file comes back, TL-391 is being undone rather than revisited");
});

test("a hook that calls the CLI calls a subcommand the CLI has", () => {
  let checked = 0;
  for (const file of HOOK_FILES) {
    for (const command of hookCommands(JSON.parse(readFileSync(file, "utf8")))) {
      const after = command.match(/cli\.mjs"?\s+([a-z][a-z-]*)/);
      if (!after) continue;
      const help = spawnSync(process.execPath, [join(SCRIPTS_DIR, "cli.mjs"), after[1], "--help"], {
        encoding: "utf8", timeout: 30_000, env: { ...process.env, NO_COLOR: "1" },
      });
      assert.equal(help.status, 0, "a hook in " + file + " calls `" + after[1] + "`, which the CLI does not have");
      checked += 1;
    }
  }
  assert.ok(checked > 0, "no CLI-calling hook was examined — this test proved nothing");
});

test("every committed skill symlink resolves", () => {
  const dir = join(REPO_ROOT, ".claude", "skills");
  const entries = readdirSync(dir);
  assert.ok(entries.length > 0, ".claude/skills is empty — the sample is empty, not green");
  for (const entry of entries) {
    const target = join(dir, entry);
    assert.doesNotThrow(() => statSync(target), entry + " is a dangling symlink, so the harness loads nothing");
    assert.ok(existsSync(join(target, "SKILL.md")), entry + " resolves, but to something with no SKILL.md in it");
  }
});

/**
 * A slash command may encode the ORDER of invocations, because the tool does not
 * know it. It may not encode the VALUES, because the tool does — rendered from
 * this project's `config.yaml`, which a copy here would contradict the moment
 * somebody renames a status.
 *
 * The threshold is three and not one on purpose. `done` and `blocked` are both
 * statuses AND ordinary English, and a command file is entitled to say
 * `branchling done`; what no command file has a reason to do is enumerate the
 * vocabulary, and an enumeration is what three of them in one file means.
 */
test("no slash command copies a vocabulary out of config.yaml", () => {
  const dir = join(REPO_ROOT, ".claude", "commands");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  assert.ok(files.length > 0, ".claude/commands holds no command — the sample is empty, not green");
  const config = loadConfig(BACKLOG_DIR);
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    for (const [field, values] of [["status", config.statuses], ["priority", config.priorities]]) {
      const found = values.filter((v) => new RegExp("\\b" + v + "\\b").test(text));
      assert.ok(found.length < 3, file + " lists the " + field + " vocabulary (" + found.join(", ") + ") — ask the tool instead");
    }
  }
});

/**
 * Three commands are deliberately absent from the allowlist, and each absence is
 * a rule in AGENTS.md rather than caution: `git push` is named there as needing
 * an explicit request, `git worktree remove` destroys a tree whose contents only
 * a person can judge, and `done` closes a task by running its verification.
 * Pre-approving any of them deletes the rule without saying so.
 */
test("the allowlist stops short of the decisions AGENTS.md reserves", () => {
  const settings = JSON.parse(readFileSync(join(REPO_ROOT, ".claude", "settings.json"), "utf8"));
  const allow = settings.permissions?.allow ?? [];
  assert.ok(allow.length > 0, "the allowlist is empty — the sample is empty, not green");
  for (const reserved of ["git push", "git worktree remove", "cli.mjs done"]) {
    const hit = allow.filter((rule) => rule.includes(reserved));
    assert.deepEqual(hit, [], "`" + reserved + "` is pre-approved by " + hit.join(", ") + ", which AGENTS.md does not allow");
  }
});
