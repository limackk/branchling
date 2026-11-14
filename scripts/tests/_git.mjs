/**
 * Run git from a test so that a timeout takes git's hooks down with it (TL-665).
 *
 * WHY NOT `spawnSync("git", …, { timeout })`. On a timeout Node kills git and
 * only git. A hook git started — `/bin/sh .git/hooks/<name>` and whatever that
 * runs — is reparented to PID 1 and keeps running after the test, the test
 * file and the whole `node --test` run have ended. A hook that regresses into
 * calling the CLI with no subcommand starts the server, which never returns,
 * so a red run on a developer's machine leaves a server and a shell alive that
 * nothing reports.
 *
 * WHAT THIS DOES INSTEAD. git runs under `mutation-contain.mjs`, which leads a
 * process group of its own and kills whatever is left in that group when git
 * ends. The group survives reparenting, so the kill reaches an orphaned hook.
 * The timeout still belongs to `spawnSync`: it sends SIGTERM to the wrapper,
 * whose handler kills the group. The signal is fixed to SIGTERM for that
 * reason — a SIGKILL would end the wrapper before it could reap anything.
 *
 * WHAT THE CALLER SEES CHANGES IN ONE PLACE. A git killed by the timeout comes
 * back as `status: 1`, `signal: null` (the wrapper's own exit) together with
 * `error.code === "ETIMEDOUT"`, rather than `signal: "SIGTERM"`.
 *
 * Windows has no negative-pid process groups, so there git runs directly, as
 * before.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { SCRIPTS_DIR } from "./_repo.mjs";

export const CONTAIN_ENTRY = join(SCRIPTS_DIR, "mutation-contain.mjs");

/** `spawnSync` for a command whose descendants must not outlive it. */
export function containedSpawnSync(command, args, options = {}) {
  if (process.platform === "win32") return spawnSync(command, args, options);
  return spawnSync(process.execPath, [CONTAIN_ENTRY, command, ...args], {
    ...options,
    killSignal: "SIGTERM",
  });
}

/** git in `cwd`, contained, with the suite's usual 30-second ceiling. */
export function git(cwd, args, options = {}) {
  return containedSpawnSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, ...options });
}

/**
 * The pid and process group of a shell run under the containing entry (TL-740).
 *
 * Everything above rests on the contained command leading its own group. When
 * it does not, a hook's orphans hold the wrapper's pipes open, the wrapper
 * catches the timeout's SIGTERM and stays, and `spawnSync` waits for it with
 * no end — a hang, not a failure. This probe runs a command that orphans
 * nothing, under a SIGKILL deadline the wrapper cannot catch, so a caller can
 * assert leadership in seconds before it starts anything that would hang.
 * `pid` and `pgid` are null when the shell's line did not arrive, which is
 * what a wrapper that no longer passes its command's output through shows.
 */
export function containedGroupProbe({ contain = true } = {}) {
  const probe = ["sh", "-c", 'echo "$$ $(ps -o pgid= -p $$)"'];
  const r = contain
    ? spawnSync(process.execPath, [CONTAIN_ENTRY, ...probe], { encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL" })
    : spawnSync(probe[0], probe.slice(1), { encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL" });
  const m = (r.stdout || "").trim().match(/^(\d+)\s+(\d+)$/);
  return { pid: m ? Number(m[1]) : null, pgid: m ? Number(m[2]) : null, status: r.status, output: (r.stdout || "") + (r.stderr || "") };
}
