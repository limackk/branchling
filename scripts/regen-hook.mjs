#!/usr/bin/env node
/**
 * The `regen-hook` command — entry point for an editor's post-edit hook (BL-1450).
 *
 * WHAT IT REPLACES. The same job used to be done by `regen-on-task-edit.sh`
 * (deleted in BL-1450),
 * which located its siblings through `$BASH_SOURCE`. That works — including
 * from inside `node_modules` — and that is exactly the trap: it makes the
 * consumer depend on the package's internal layout. A command does not.
 *
 * WHY THE BACKLOG DIRECTORY COMES FROM THE FILE PATH. The edited task lives at
 * `<backlog>/tasks/BL-*.md`, so the path names the data directory exactly. The
 * old script relied on co-location with the code and the new one must not rely
 * on the cwd either: a hook fires wherever the editor happens to be.
 *
 * SILENT ON A MISS, BY DESIGN. The hook is wired to fire after EVERY edit, so
 * the common case is a file that has nothing to do with the backlog. Anything
 * printed there would be noise on every keystroke of unrelated work.
 *
 * Tests: `node --test scripts/tests/cli.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { backlogForTaskPath } from "./paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// backlogForTaskPath lives in paths.mjs (TL-44) — the guards now make the same
// choice of root, so a second copy would mean two definitions of "this is a task".
export { backlogForTaskPath };

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    // A malformed payload is the editor's problem, not the user's; failing the
    // hook here would turn every edit into an error banner.
    return 0;
  }

  const filePath = payload && payload.tool_input && payload.tool_input.file_path;
  const target = backlogForTaskPath(filePath);
  if (!target) return 0;

  const build = spawnSync(
    process.execPath,
    [join(HERE, "build-backlog.mjs"), "--dir", target.root],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
  if (build.status === 0) {
    console.log("↻ backlog: rebuilt NOW/INDEX/archive from the edited task");
  }

  // History is best-effort: a task edited before its history file exists must
  // not fail the edit that created it.
  spawnSync(
    process.execPath,
    [
      join(HERE, "history-record.mjs"),
      "--file", filePath,
      "--actor", resolveActor(""),
      "--source", "hook",
    ],
    { stdio: ["ignore", "ignore", "ignore"] }
  );

  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("regen-hook.mjs")) {
  process.exit(main());
}
