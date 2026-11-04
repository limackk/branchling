/**
 * A `--dir` or `BACKLOG_DIR` naming a directory that is not a backlog is a
 * refusal, never a JavaScript stack trace (TL-545).
 *
 * TL-47 and TL-478 made "no backlog here" a named refusal; the sibling state,
 * a directory named EXPLICITLY that does not look like a backlog, has its own
 * type (`NotABacklogError`, TL-541) but only `check --json` turned it into a
 * message. Every other command printed `throw new NotABacklogError` and a
 * stack — the answer a person gets for mistyping a path.
 *
 * TWO HALVES, as in `no-backlog-message` and `no-backlog-refusal`:
 * - the command table is swept, so a command added tomorrow is covered the day
 *   it is written; a command that refuses `--dir` as an unknown flag passes
 *   that half, which is why the second half exists;
 * - a list of invocations valid for each command proves the run reaches the
 *   resolver and prints the named refusal, so a usage error cannot pass for
 *   one.
 *
 * The exit code is 1 wherever `resolveBacklogDirOrExit` answers, the code
 * `check --json` gave this state in TL-541 and the code "no backlog here"
 * exits with there: the invocation is well built, the directory it names is
 * not usable. 2 stays for a wrongly built invocation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { COMMANDS } from "../cli.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("not-a-backlog-dir");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/** Servers do not return, so "what does it print and exit with" has no answer
 *  for them. Named here rather than skipped silently. */
const SERVERS = new Set(["serve", "mcp"]);

const STACK = /^\s+at .+:\d+:\d+\)?$/m;
const SOURCE = /^file:\/\//m;
const REFUSAL = /does not look like a backlog/;

const base = mkdtempSync(join(tmpdir(), "branchling-not-a-backlog-"));
const cwd = join(base, "cwd");
mkdirSync(cwd);
spawnSync("git", ["init", "-q", "."], { cwd });

/**
 * A FRESH directory for every invocation. One shared directory let `init`,
 * which the sweep reaches like any other command, turn it into a backlog, and
 * every command after it then passed against a real one — green with no
 * evidentiary force.
 */
let fresh = 0;
function notABacklog() {
  const dir = join(base, "plain-" + ++fresh);
  mkdirSync(dir);
  return dir;
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 60_000, input: "",
    env: { ...process.env, BACKLOG_STATE_DIR: join(base, ".state"), ...env },
  });
}

test("the command table is not empty — the sweep below has something to check", () => {
  const checked = Object.keys(COMMANDS).filter((c) => !SERVERS.has(c));
  assert.ok(checked.length > 20, "only " + checked.length + " commands: the table was not read");
});

test("no command dumps a stack trace for a --dir that is not a backlog", () => {
  const offenders = [];
  for (const name of Object.keys(COMMANDS)) {
    if (SERVERS.has(name)) continue;
    const r = run([name, "--dir", notABacklog()]);
    const out = r.stdout + r.stderr;
    if (STACK.test(out) || SOURCE.test(out)) offenders.push(name + " (exit " + r.status + ")");
  }
  assert.deepEqual(offenders, [], "a stack trace reached the user from: " + offenders.join(", "));
});

test("no command dumps a stack trace for a BACKLOG_DIR that is not a backlog", () => {
  const offenders = [];
  for (const name of Object.keys(COMMANDS)) {
    if (SERVERS.has(name)) continue;
    const r = run([name], { BACKLOG_DIR: notABacklog() });
    const out = r.stdout + r.stderr;
    if (STACK.test(out) || SOURCE.test(out)) offenders.push(name + " (exit " + r.status + ")");
  }
  assert.deepEqual(offenders, [], "a stack trace reached the user from: " + offenders.join(", "));
});

/** Invocations valid for each command, so the run reaches the resolver instead
 *  of stopping at flag validation. These go through `resolveBacklogDirOrExit`
 *  (or, for `doctor` and `check`, answer the state themselves) and exit 1. */
const RESOLVER_CASES = [
  ["show", "X-1"],
  ["query", "--count"],
  ["stats"],
  ["plan"],
  ["new", "--title", "X"],
  ["done", "X-1"],
  ["resume", "X-1"],
  ["log", "X-1"],
  ["build"],
  ["doctor"],
  ["check"],
];

/** Commands that resolve with the bare resolver and already refused in their
 *  own shape before TL-545, with exit 2 for this state and for "no backlog
 *  here" alike. Whether they move to 1 is a contract question for JSON
 *  consumers, tracked as its own task; here they are held to the part TL-545
 *  is about — a refusal that names the directory, never a stack. */
const DIRECT_CASES = [
  ["take", "X-1", "--actor", "agent:a"],
  ["next", "--actor", "agent:a"],
  ["set", "X-1", "priority", "P1"],
  ["release", "X-1", "--actor", "agent:a", "--reason", "r"],
  ["handoff", "X-1", "--to-role", "dev", "--reason", "r", "--actor", "agent:a"],
  ["ask", "X-1", "--question", "q", "--actor", "agent:a"],
];

function refusal(args) {
  const r = run([...args, "--dir", notABacklog()]);
  const all = r.stdout + r.stderr;
  assert.match(r.stderr, REFUSAL, "the named refusal is missing:\n" + all);
  assert.doesNotMatch(all, STACK, "a stack trace reached the user:\n" + all);
  assert.doesNotMatch(all, SOURCE, "a source location reached the user:\n" + all);
  return { r, all };
}

for (const args of RESOLVER_CASES) {
  test("`" + args.join(" ") + " --dir <not a backlog>` refuses with exit 1 and the named message", () => {
    const { r, all } = refusal(args);
    assert.equal(r.status, 1, "exit " + r.status + ":\n" + all);
  });
}

for (const args of DIRECT_CASES) {
  test("`" + args.join(" ") + " --dir <not a backlog>` refuses with the named message", () => {
    const { r, all } = refusal(args);
    assert.notEqual(r.status, 0, "it succeeded against a directory that is not a backlog:\n" + all);
  });
}
