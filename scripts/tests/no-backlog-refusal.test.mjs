/**
 * Every backlog command run where no backlog exists refuses with the named
 * message — never a JavaScript stack trace (TL-478).
 *
 * TL-47 made "no backlog here" a foreseen state with its own error type, so it
 * would never reach a user as a crash. `new`, `done` and `migrate-prefix`
 * still called the bare resolver, and the first thing a newcomer typing `new`
 * in the wrong directory saw was `throw new BacklogNotFoundError` and a stack.
 *
 * The argument lists are valid for each command, so the run reaches the point
 * where the backlog is resolved instead of stopping at flag validation; a
 * usage error would make the case pass without proving anything, which is why
 * each case also requires the refusal text itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("no-backlog-refusal");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

const CASES = [
  ["new", "--title", "X"],
  ["done", "X-1"],
  ["migrate-prefix", "--to", "Y", "--dry-run"],
  ["take", "X-1", "--actor", "agent:a"],
  ["next", "--actor", "agent:a"],
  ["release", "X-1", "--actor", "agent:a", "--reason", "r"],
  ["handoff", "X-1", "--to-role", "dev", "--reason", "r", "--actor", "agent:a"],
  ["decide", "X-1", "--reason", "r", "--actor", "agent:a"],
  ["ask", "X-1", "--question", "q", "--actor", "agent:a"],
  ["resume", "X-1"],
  ["log", "X-1"],
  ["board", "X-1"],
  ["history", "--actor", "agent:a", "--source", "manual"],
  ["renumber", "--dry-run"],
  ["query", "--count"],
  ["stats"],
  ["plan"],
  ["build"],
  ["next-id"],
  ["doctor"],
];

const dir = mkdtempSync(join(tmpdir(), "branchling-no-backlog-"));
spawnSync("git", ["init", "-q", "."], { cwd: dir });

for (const args of CASES) {
  test("`" + args.join(" ") + "` outside a backlog refuses without a stack trace", () => {
    const r = spawnSync(process.execPath, [CLI, ...args],
      { cwd: dir, encoding: "utf8", timeout: 30_000, input: "", env: { ...process.env, BACKLOG_STATE_DIR: join(dir, ".state") } });
    const all = r.stdout + r.stderr;
    assert.notEqual(r.status, 0, "it succeeded where there is no backlog:\n" + all);
    assert.match(r.stderr, /no backlog here/, "the named refusal is missing:\n" + all);
    assert.doesNotMatch(all, /^\s+at .+:\d+:\d+\)?$/m, "a stack trace reached the user:\n" + all);
    assert.doesNotMatch(all, /^file:\/\//m, "a source location reached the user:\n" + all);
  });
}
