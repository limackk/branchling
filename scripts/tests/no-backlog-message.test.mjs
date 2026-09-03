/**
 * "There is no backlog here" is a MESSAGE, not a crash (TL-47).
 *
 * The state is described in the documentation as by design; the presentation
 * contradicted the design. A stack trace says "the tool crashed", and the person
 * most likely to see it is somebody who has just installed the tool and run it
 * from their home directory — the first contact with it.
 *
 * WHY THE TEST ITERATES THE COMMAND TABLE. Fixing one command leaves the rest,
 * and the next command added would fall out of coverage silently. The subject
 * here is `COMMANDS` itself, so a new entry is covered the day it is written.
 *
 * TWO COMMANDS ARE EXCLUDED BY NAME AND BY REASON, not because they are
 * awkward: `serve` and `mcp` are servers and do not return.
 *
 * THE NEGATIVE TEST IS THE POINT OF THE WHOLE FIX. A genuine programmer error
 * must STILL show its stack — silencing everything would be a cure worse than
 * the disease, and it is the difference between a named type and a `try` that
 * swallows.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../cli.mjs";
import { BacklogNotFoundError, resolveBacklogDirOrExit } from "../paths.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("no-backlog-message");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

/** Servers: they do not return, so "what does it print and exit with" has no
 *  answer for them. Named here rather than skipped silently. */
const SERVERS = new Set(["serve", "mcp"]);

function inEmptyDir(args) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-nobacklog-"));
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: "utf8", timeout: 60_000, input: "",
  });
}

test("the command table is not empty — the loop below has something to check", () => {
  const checked = Object.keys(COMMANDS).filter((c) => !SERVERS.has(c));
  assert.ok(checked.length > 20, "only " + checked.length + " commands: the table was not read");
});

test("no command dumps a stack trace when there is no backlog", () => {
  const offenders = [];
  for (const name of Object.keys(COMMANDS)) {
    if (SERVERS.has(name)) continue;
    const r = inEmptyDir([name]);
    const out = String(r.stdout) + String(r.stderr);
    if (/^\s+at .*:\d+:\d+\)?$/m.test(out)) offenders.push(name + " (exit " + r.status + ")");
  }
  assert.deepEqual(offenders, [],
    "a stack trace says `the tool crashed`; this state is described in the documentation as by design");
});

test("the message says how to point at a backlog AND how to create one", () => {
  const r = inEmptyDir(["query", "--count"]);
  assert.notEqual(r.status, 0, "a missing backlog is still a failure, and still writes nothing");
  const out = String(r.stdout) + String(r.stderr);
  assert.match(out, /--dir/);
  assert.match(out, /BACKLOG_DIR/);
  assert.match(out, /init/,
    "the person most likely to read this has no backlog yet — three ways to point at one is not an answer");
});

test("POSITIVE CONTROL: a genuine programmer error STILL shows its stack", () => {
  // Silencing everything would be a worse cure than the disease. Only the named
  // type becomes a message; a TypeError stays a TypeError, with the trace that
  // makes it findable.
  const dir = mkdtempSync(join(tmpdir(), "worktrail-boom-"));
  const script = join(dir, "boom.mjs");
  writeFileSync(script,
    'import { resolveBacklogDirOrExit } from ' + JSON.stringify(join(dirname(CLI), "paths.mjs")) + ';\n' +
    "resolveBacklogDirOrExit({ get dir() { throw new TypeError('a real bug'); } });\n", "utf8");
  const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: "utf8", timeout: 30_000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /TypeError: a real bug/);
  assert.match(r.stderr, /^\s+at /m, "a programmer error with no stack is a bug nobody can find");
});

test("the helper turns only the named type into a message", () => {
  assert.throws(() => resolveBacklogDirOrExit({ dir: "/definitely/not/a/backlog" }),
    /does not look like a backlog/,
    "naming a directory that is not one is a USAGE error, not `there is none here`");
  assert.ok(new BacklogNotFoundError("/nowhere").details.length >= 2);
});
