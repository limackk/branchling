/**
 * `worktrail <command> --help` works in EVERY command (TL-51).
 *
 * WHAT WAS BROKEN. The main help promises "`worktrail <command> --help` prints
 * that command's flags". Measured before the fix: the promise was false in eight
 * commands out of twelve — `build`, `viewer`, `next-id`, `board`, `history`,
 * `new`, `init` and `stats` answered "unknown flag: --help" with exit code 2. It
 * was not a carelessly missed case but a regression from BL-1417: closing flag
 * validation was right, it simply never put `--help` on the list of known flags.
 *
 * WHY IT ITERATES OVER `COMMANDS` AND NOT OVER A HAND-WRITTEN LIST. A hand-written
 * list guarantees that a new command drops out of the coverage silently — that is,
 * that the same hole comes back at the first opportunity. The test has to ask about
 * EVERY command the tool declares.
 *
 * `spawnSync` with a timeout, because `serve` without `--help` handling does not
 * end in an error but starts listening — and would hang the whole suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, commandHelpText, wantsHelp } from "../cli.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("cli-help");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");
const NAMES = Object.keys(COMMANDS);

function help(name, flag) {
  return spawnSync(process.execPath, [CLI, name, flag || "--help"], {
    encoding: "utf8",
    timeout: 15_000,
  });
}

test("positive control: the command table is not empty", () => {
  // The whole rest of this file iterates over `COMMANDS`. If the table were empty
  // or not imported, every loop would run zero times and be green.
  assert.ok(NAMES.length >= 10, "expecting a dozen or so commands, got " + NAMES.length);
});

test("--help exits zero in EVERY command", () => {
  for (const name of NAMES) {
    const r = help(name);
    assert.equal(r.status, 0, name + " --help fails (code " + r.status + "): " + r.stderr);
    assert.notEqual(r.signal, "SIGTERM", name + " --help did not finish — the command started instead of describing itself");
  }
});

test("the help goes to stdout, not to stderr", () => {
  for (const name of NAMES) {
    const r = help(name);
    assert.ok(r.stdout.trim().length > 0, name + ": empty help");
    assert.equal(r.stderr, "", name + ": help on stderr — that is not diagnostics");
  }
});

test("the help does not leak the module source", () => {
  // `query --help` used to print its own file header, shebang included.
  for (const name of NAMES) {
    const out = help(name).stdout;
    assert.doesNotMatch(out, /#!/, name + ": the help carries a shebang");
    assert.doesNotMatch(out, /^import /m, name + ": the help carries code");
  }
});

test("the help names the command and says what it is for", () => {
  for (const name of NAMES) {
    const out = help(name).stdout;
    assert.ok(out.includes(name), name + ": the help does not name the command");
    assert.ok(out.includes(COMMANDS[name].summary), name + ": the help does not carry the summary from the table");
  }
});

test("-h does the same as --help", () => {
  for (const name of NAMES) {
    assert.equal(help(name, "-h").status, 0, name + " -h oblewa");
  }
});

// ── The rule stays a rule ─────────────────────────────────────────────────

test("an unknown flag STILL fails — BL-1417 untouched", () => {
  // A fix that lets everything through would also make `--help` green.
  const r = spawnSync(process.execPath, [CLI, "stats", "--nieistniejaca"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 2, "a typo in a flag went through");
});

test("the help scan stops at `--`", () => {
  // So that a value beginning with a dash is not mistaken for a flag once
  // separator wejdzie w TL-58.
  assert.equal(wantsHelp(["--help"]), true);
  assert.equal(wantsHelp(["--status", "pending", "-h"]), true);
  assert.equal(wantsHelp(["--", "--help"]), false);
  assert.equal(wantsHelp([]), false);
});

test("a bare `help` in a command's arguments is a VALUE, not a request for help", () => {
  // `worktrail help` has to work, because there the word stands where a command
  // goes. But `worktrail query --text help` has to SEARCH — otherwise the help
  // swallows the query and looks like the tool working, which is exactly the
  // dispatcher (BL-1411).
  assert.equal(wantsHelp(["--text", "help"]), false);

  const r = spawnSync(process.execPath, [CLI, "query", "--text", "help", "--count"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\d+/, "the help came out instead of a count of matches:\n" + r.stdout);

  const bare = spawnSync(process.execPath, [CLI, "help"], { encoding: "utf8", timeout: 15_000 });
  assert.equal(bare.status, 0, "`worktrail help` stopped working");
});

test("a command's help is assembled from the table, not from a second description", () => {
  // PURE — nothing is run. If the help text lived separately it would drift away
  // from the table at the first change to a flag.
  const text = commandHelpText("build", COMMANDS.build);
  assert.ok(text.includes(COMMANDS.build.summary));
  assert.ok(text.includes(COMMANDS.build.usage));
});
