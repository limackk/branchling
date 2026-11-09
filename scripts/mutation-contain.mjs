#!/usr/bin/env node
/**
 * Run one command as the leader of its own process group, and kill whatever is
 * left in that group when it ends (TL-646).
 *
 *   node scripts/mutation-contain.mjs <command> [args…]
 *
 * WHY. `mutation-run.mjs` wraps every test command it hands Stryker in this.
 * A test that spawns git with a `timeout` kills git, not git's hook children:
 * they are reparented to PID 1 and outlive the test, the test file and the
 * Stryker worker. On 2026-11-07 a mutant that dropped a hook's subcommand left
 * hooks running the server for hours. Stryker's own kill walks the process
 * tree by parent, which an orphan has left; the process GROUP is kept across
 * reparenting, so a kill aimed at the group still reaches it.
 *
 * WHAT IT DOES NOT COVER. When Stryker kills this process itself with SIGKILL
 * on a timeout, nothing here runs. `sweepLeftovers()` in `mutation-run.mjs`
 * catches that case when the run ends.
 *
 * The exit status is the command's own, so Stryker's verdict is unchanged.
 * Not shipped: `package.json` excludes it with `mutation-run.mjs`.
 */

import { spawn } from "node:child_process";

import { processTreeDetached, stopProcessTree } from "./process-tree.mjs";

const [command, ...args] = process.argv.slice(2);
if (command) contain(command, args);
else {
  process.stderr.write("usage: node scripts/mutation-contain.mjs <command> [args…]\n");
  process.exitCode = 2;
}

// `process.exitCode`, never `process.exit()`: an exit drops stderr still
// queued on an asynchronous pipe (TL-440). Nothing but the child keeps this
// process alive, so it ends when the child does.
function contain(command, args) {
  const child = spawn(command, args, { stdio: "inherit", detached: processTreeDetached() });
  const reap = () => stopProcessTree(child, "SIGKILL");

  // A signal stops the whole group; the child's `exit` then ends this process.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, reap);

  child.on("error", (e) => {
    process.stderr.write("mutation-contain: cannot run " + command + ": " + e.message + "\n");
    process.exitCode = 1;
  });

  child.on("exit", (code) => {
    // The leader is gone; its group is not, while anything it left is alive.
    reap();
    process.exitCode = code === null ? 1 : code;
  });
}
