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
 * THE WAIT FOR THE PAYLOAD IS BOUNDED (TL-224). Reading stdin to EOF is correct
 * for the one caller this was written against — an editor writes its JSON and
 * closes — and it is a trap for every other one. A terminal never sends EOF, and
 * neither does a parent that leaves stdin inherited, so the command waited for
 * something that was never coming: no output, no prompt, nothing to tell it
 * apart from slow work. Measured at the time: `( sleep 8 ) | regen-hook` took
 * the whole eight seconds, and a terminal took forever.
 *
 * Tests: `node --test scripts/tests/cli.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActor } from "./actor.mjs";
import { backlogForTaskPath } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { STDIN_WAIT_MS, readStdinText } from "./stdin.mjs";
import { failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// backlogForTaskPath lives in paths.mjs (TL-44) — the guards now make the same
// choice of root, so a second copy would mean two definitions of "this is a task".
export { backlogForTaskPath };

/** The bounded read lives in `stdin.mjs` (TL-237), because `new` reads a
 *  document the same way and the reasoning above must not exist twice. The
 *  constant is re-exported: the guard that proves this command does not block
 *  asks this module for the window it promises. */
export { STDIN_WAIT_MS };

export async function main() {
  const raw = await readStdinText();
  if (raw === null) {
    // Reached only by a person: the hook wiring always pipes. Saying so costs
    // one line and replaces the silence that used to look like a freeze.
    console.error(
      `${N} regen-hook: expects an editor hook's JSON on stdin — nothing arrived.`
    );
    return 0;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
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

  // A first sighting is a valid history result: history-record creates its
  // reference point without an entry. An actual recorder failure is different:
  // the rebuild has made the edit visible, so reporting success while discarding
  // the missing audit trail would leave the two views disagreeing silently.
  //
  // `--dir` for the same reason `build` gets one (TL-195): the root is already
  // known from the file, and a spawn that withholds it sends the child back to
  // `BACKLOG_DIR` and discovery from cwd. Those agree with the file's own tree
  // only by coincidence — a session standing in another worktree, or a stray
  // export, and the reconcile diffs a DIFFERENT directory, advances ITS snapshot
  // and loses the change from both trees. `stdio: ignore` makes that silent.
  const history = spawnSync(
    process.execPath,
    [
      join(HERE, "history-record.mjs"),
      "--dir", target.root,
      "--file", filePath,
      "--actor", resolveActor(""),
      "--source", "hook",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  if (history.error || history.status !== 0) {
    const diagnostic = String(
      history.stderr || history.stdout || history.error?.message ||
      "history-record ended without an exit status"
    ).trim();
    const details = diagnostic
      ? diagnostic.split("\n").filter(Boolean).map((line) => "history-record: " + line)
      : [];
    console.error(failure(
      `${N} regen-hook`,
      "history could not be recorded after rebuilding",
      details,
      ["fix the history error, then save the task again"],
      1
    ));
    return 1;
  }

  return 0;
}

/**
 * The arguments this command accepts — which is NONE (TL-220).
 *
 * WHY IT MATTERS MOST HERE. This is the one command a person does not type: it
 * is wired into an editor's hook and fires after every save. A typo in that
 * wiring used to exit 0 in silence, so an installed hook that had never once
 * rebuilt anything was indistinguishable from one that worked — the exact
 * silent no-op `AGENTS.md` opens by forbidding.
 *
 * WHY NOT `--dir`. The backlog root comes from the edited file's own path, which
 * is the point of the command (see the header). A `--dir` here would be a second
 * answer to a question already settled by the payload, and the two would
 * disagree the first time an editor fired the hook from another tree.
 *
 * PURE, and separate from `main`, for the reason `flag-validation.test.mjs`
 * records about `build-viewer.mjs`: a module imported under `node --test` must
 * never read the RUNNER's argv, so the call lives in the direct-invocation
 * branch alone.
 *
 * @returns {string|null} the offending argument, or null when there is none
 */
export function unknownArgument(argv) {
  const rest = (argv || []).filter((a) => a !== "--help" && a !== "-h");
  return rest.length ? rest[0] : null;
}

if (process.argv[1] && process.argv[1].endsWith("regen-hook.mjs")) {
  const offender = unknownArgument(process.argv.slice(2));
  if (offender !== null) {
    console.error(refusal(
      `${N} regen-hook`,
      (offender.startsWith("-") ? "unknown flag: " : "unexpected argument: ") + offender,
      "--help -h   # it takes no other argument: the payload arrives on stdin"
    ));
    process.exit(2);
  }
  main().then((code) => process.exit(code));
}
