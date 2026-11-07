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
 * The exit code is 1 from EVERY command (TL-546): the code `check --json`
 * gave this state in TL-541 and the code "no backlog here" exits with: the
 * invocation is well built, the directory it names is not usable. 2 stays for
 * a wrongly built invocation. The sweeps hold every command that prints the
 * refusal to that code, so a command added tomorrow with an exit of its own
 * fails here the day it is written; the case lists prove each command reaches
 * the resolver at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
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

const base = fixtureDir(join(tmpdir(), "branchling-not-a-backlog-"));
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

/** Commands that validate stdin before resolving the backlog, so an empty
 *  stdin would stop them at the input instead of at the resolver. */
const STDIN = { import: "[]" };

function run(args, env = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 60_000, input: STDIN[args[0]] || "",
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

/** Every command whose output carries the refusal exits 1 with it (TL-546).
 *  A bare `<command> --dir` stops at flag validation for many commands, so
 *  the sweep also counts how many reached the resolver: a sweep in which none
 *  did would pass with no evidentiary force. */
function sweepCodes(invoke) {
  const wrong = [];
  let refused = 0;
  for (const name of Object.keys(COMMANDS)) {
    if (SERVERS.has(name)) continue;
    const r = invoke(name);
    if (!REFUSAL.test(r.stdout + r.stderr)) continue;
    refused++;
    if (r.status !== 1) wrong.push(name + " (exit " + r.status + ")");
  }
  return { wrong, refused };
}

test("every command refusing a --dir that is not a backlog exits 1", () => {
  const { wrong, refused } = sweepCodes((name) => run([name, "--dir", notABacklog()]));
  assert.ok(refused >= 10, "only " + refused + " commands reached the resolver: the sweep proves nothing");
  assert.deepEqual(wrong, [], "a refusal with another exit code from: " + wrong.join(", "));
});

test("every command refusing a BACKLOG_DIR that is not a backlog exits 1", () => {
  const { wrong, refused } = sweepCodes((name) => run([name], { BACKLOG_DIR: notABacklog() }));
  assert.ok(refused >= 10, "only " + refused + " commands reached the resolver: the sweep proves nothing");
  assert.deepEqual(wrong, [], "a refusal with another exit code from: " + wrong.join(", "));
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

const spec = join(base, "spec.md");
writeFileSync(spec, "# A project\n");

/** Commands that resolve with the bare resolver and refuse in their own shape.
 *  Before TL-546 they exited 2 for this state and for "no backlog here" alike,
 *  while the commands above exited 1; they now exit 1 too. */
const DIRECT_CASES = [
  ["take", "X-1", "--actor", "agent:a"],
  ["next", "--actor", "agent:a"],
  ["set", "X-1", "priority", "P1"],
  ["release", "X-1", "--actor", "agent:a", "--reason", "r"],
  ["handoff", "X-1", "--to-role", "dev", "--reason", "r", "--actor", "agent:a"],
  ["ask", "X-1", "--question", "q", "--actor", "agent:a"],
  ["decide", "X-1", "--reason", "r", "--actor", "agent:a"],
  ["body", "X-1", "--reason", "r", "--actor", "agent:a"],
  ["deploy", "status"],
  ["deploy", "record", "--target", "t", "--stage", "s", "HEAD", "--reason", "r", "--actor", "agent:a"],
  ["declare", "releases", "v1", "--reason", "r"],
  ["import", "--from", "github", "--dry-run"],
  ["plan-from", spec],
  ["audit"],
  ["docs-drift"],
  ["pr-summary"],
  ["skills", "install", "--dry-run"],
  ["run", "--dry-run"],
];

/** The writing commands that answer this state with an envelope under
 *  `--json`: the same exit, and `refusalKind` `no-backlog` — not `usage`,
 *  which is a wrongly built call. */
const JSON_CASES = [
  ["set", "X-1", "priority", "P1", "--json"],
  ["release", "X-1", "--actor", "agent:a", "--reason", "r", "--json"],
  ["deploy", "record", "--target", "t", "--stage", "s", "HEAD", "--reason", "r", "--actor", "agent:a", "--json"],
  ["declare", "releases", "v1", "--reason", "r", "--json"],
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
  test("`" + args.join(" ") + " --dir <not a backlog>` refuses with exit 1 and the named message", () => {
    const { r, all } = refusal(args);
    assert.equal(r.status, 1, "exit " + r.status + ":\n" + all);
  });
}

for (const args of JSON_CASES) {
  test("`" + args.join(" ") + " --dir <not a backlog>` answers refusalKind no-backlog with exit 1", () => {
    const r = run([...args, "--dir", notABacklog()]);
    const all = r.stdout + r.stderr;
    assert.equal(r.status, 1, "exit " + r.status + ":\n" + all);
    const envelope = JSON.parse(r.stdout);
    assert.equal(envelope.ok, false, all);
    assert.equal(envelope.refusalKind, "no-backlog", all);
    assert.match(envelope.refusal, REFUSAL, all);
  });
}
