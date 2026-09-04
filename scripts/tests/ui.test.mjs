/**
 * Output style: colour is emphasis, never information (TL-52).
 *
 * THREE THINGS THIS FILE DEFENDS, each of which can be broken without noticing:
 *
 *   1. The content without colour is COMPLETE. This output is read by a pipe, a
 *      CI log and a person who does not tell shades apart — in each of those
 *      cases the colour is gone.
 *   2. `NO_COLOR` is a property of the PROGRAM, not a promise made by each file
 *      separately. Which is why the test enforces that ONLY `ui.mjs` writes
 *      escape sequences.
 *   3. `--json` is never coloured — something parses it.
 *
 * The assertions are made on the CONTENT and on the presence of a sequence, never
 * on specific codes: a test pinned to "green is 32" would fail on every change of
 * palette while checking nothing more than it checks today.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { colorAllowed, failure, line, plain, priorityPaint, statusPaint, table } from "../ui.mjs";

import { isolateHome, plainOutput } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("ui");
// Assert against plain text, not against the observer's terminal (TL-238).
plainOutput();

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");
const ESC = "\u001b";
const SEQ = /\u001b\[[0-9;]*m/g;

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd: join(SCRIPTS, ".."),
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, ...env },
  });
}

// ── When colour is allowed ────────────────────────────────────────────────

test("NO_COLOR switches it off — ANY value, including an empty one", () => {
  const tty = { isTTY: true };
  assert.equal(colorAllowed(tty, { NO_COLOR: "1" }), false);
  assert.equal(colorAllowed(tty, { NO_COLOR: "" }), false, "an empty value is still a declaration");
  assert.equal(colorAllowed(tty, { NO_COLOR: "0" }), false, "no-color.org knows no value `0`");
});

test("with no TTY we do not colour, unless FORCE_COLOR says otherwise", () => {
  const pipe = { isTTY: false };
  assert.equal(colorAllowed(pipe, {}), false, "a pipe gets plain text without having to ask");
  assert.equal(colorAllowed(pipe, { FORCE_COLOR: "1" }), true, "a CI log that renders ANSI");
  assert.equal(colorAllowed(pipe, { FORCE_COLOR: "0" }), false, "`0` is a switch-off, not a forcing");
});

test("TERM=dumb does not colour, an ordinary terminal does", () => {
  assert.equal(colorAllowed({ isTTY: true }, { TERM: "dumb" }), false);
  assert.equal(colorAllowed({ isTTY: true }, { TERM: "xterm-256color" }), true);
});

test("NO_COLOR beats FORCE_COLOR — whoever switched it off, switched it off", () => {
  assert.equal(colorAllowed({ isTTY: true }, { NO_COLOR: "1", FORCE_COLOR: "1" }), false);
});

// ── The content is complete without colour ────────────────────────────────

test("the same call with and without colour carries IDENTICAL content", () => {
  const bare = run(["check"], { NO_COLOR: "1" });
  const tinted = run(["check"], { FORCE_COLOR: "1", NO_COLOR: undefined });
  assert.equal(bare.status, tinted.status);
  assert.ok(tinted.stdout.includes(ESC), "FORCE_COLOR did not colour anything — the test has nothing to compare");
  assert.equal(tinted.stdout.replace(SEQ, ""), bare.stdout,
    "the colour carries content that the black-and-white version does not have");
});

test("the symbol carries meaning without colour too", () => {
  const bare = run(["check"], { NO_COLOR: "1" });
  assert.match(bare.stdout, /✓/, "success is unrecognisable once the colour is removed");
});

test("--no-color works like the variable, through the dispatcher", () => {
  const r = run(["stats", "--no-color"], { FORCE_COLOR: "1", NO_COLOR: undefined });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(ESC), "the flag lost to FORCE_COLOR");
});

// ── --json belongs to the machine ─────────────────────────────────────────

test("--json is NEVER coloured and always parses", () => {
  for (const args of [["stats", "--json"], ["query", "--json"], ["doctor", "--json"]]) {
    const r = run(args, { FORCE_COLOR: "1", NO_COLOR: undefined });
    assert.ok(!r.stdout.includes(ESC), args.join(" ") + ": sekwencje w JSON-ie");
    assert.doesNotThrow(() => JSON.parse(r.stdout), args.join(" ") + ": does not parse");
  }
});

// ── A rule, not a one-off fix ─────────────────────────────────────────────

/**
 * A sequence can be written in the source in two ways: as a control CHARACTER or
 * as a JS escape. The scan has to see both — otherwise changing the notation is
 * enough to smuggle in colouring alongside `ui.mjs` while the test stays green.
 */
const ESC_IN_SOURCE = "\\u001b";

function writesSequences(file) {
  const text = readFileSync(join(SCRIPTS, file), "utf8");
  return text.includes(ESC) || text.includes(ESC_IN_SOURCE);
}

test("escape sequences are written ONLY by ui.mjs", () => {
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs") && f !== "ui.mjs");
  const offenders = files.filter(writesSequences);
  assert.deepEqual(offenders, [],
    "these files write their own escape, so NO_COLOR stops being a property of the program: " + offenders.join(", "));

  // A positive control: if the scan read the wrong path, the above would be
  // green and would mean nothing.
  assert.ok(writesSequences("ui.mjs"),
    "the scan does not see a sequence even in ui.mjs — it is measuring the wrong tree, or does not know the notation");
});

test("messages introduce themselves by the COMMAND name, not by a filename", () => {
  // `[build-backlog]` or `next-backlog-id:` appear in no help text and in no
  // document — the user typed `branchling build` and has never heard of those.
  const leaked = ["[build-backlog]", "[backlog-viewer]", "next-backlog-id:", "suggest-board:",
    "[backlog-history]", "[backlog-serve]", "check-backlog-refs:"];
  // `ui.mjs` is excluded deliberately: its comment LISTS those prefixes as an
  // example of what we no longer do. The ban applies to messages, not to prose.
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs") && f !== "ui.mjs");
  const bad = [];
  for (const f of files) {
    const text = readFileSync(join(SCRIPTS, f), "utf8");
    for (const p of leaked) {
      if (text.includes('"' + p) || text.includes("`" + p)) bad.push(f + " → " + p);
    }
  }
  assert.deepEqual(bad, [], "filenames leaked: " + bad.join(", "));
});

// ── Shape ─────────────────────────────────────────────────────────────────

test("the anatomy of an error: what happened, what was expected, what to do", () => {
  // The painter is stated, so this asserts the SHAPE and not the terminal (TL-238).
  const text = failure("branchling query", "unknown flag: --statu", ["available: --status --board"], ["branchling query --help"], { color: plain });
  const lines = text.split("\n");
  assert.match(lines[0], /branchling query: unknown flag: --statu/);
  assert.match(lines[1], /available: --status --board/);
  assert.match(lines[2], /branchling query --help/, "the command to paste is missing");
});

test("numbers right-aligned, the table aligned to the widest value", () => {
  assert.equal(line("status", 7, "", { color: plain }), "  status                     7");
  assert.equal(table([["a", "bbbb"], ["cccc", "d"]]), "a     bbbb\ncccc  d");
});

test("the colour of a status and a priority comes from the CONFIGURATION, not from names in the code", () => {
  // A project may have statuses this code has never heard of.
  const cfg = {
    statuses: ["todo", "doing", "shipped"],
    archivedStatuses: ["shipped"],
    priorities: ["blocker", "high", "low"],
  };
  const ps = statusPaint(cfg, plain);
  const pp = priorityPaint(cfg, plain);
  assert.equal(ps("doing"), "doing", "without colour the content has to stay untouched");
  assert.equal(ps("shipped"), "shipped");
  assert.equal(pp("blocker"), "blocker");
  assert.equal(pp("unknown"), "unknown", "a value outside the vocabulary must not disappear");
});
