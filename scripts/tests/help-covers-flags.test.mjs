/**
 * A flag a command ACCEPTS is a flag its `--help` declares (TL-194).
 *
 * WHAT WAS BROKEN. `query` accepted `--text`, `--limit`, `--sort`, `--type`,
 * `--owner`, `--role`, `--executor`, `--blocked-by` and `--tasks`, and named
 * none of them in `query --help`. They worked; nobody reading the help could
 * know they existed. That matters most for `--text` and `--limit`, the two
 * flags that make `query` answerable inside a context budget — which is what
 * `CLAUDE.md` and `instructions context-budget` tell every session to do.
 *
 * WHERE THE TWO LISTS COME FROM, so that neither is hand-written here:
 *
 *   - what a command ACCEPTS: the command's own refusal. An unknown flag prints
 *     `available: …`, so the process already knows the answer and a test may
 *     simply ask it. A list copied into this file would be a third place to be
 *     wrong, and it would go stale the first time a flag is added.
 *   - what a command DECLARES: `describeFlags()`, the same derivation
 *     `--help --json` publishes. A flag merely MENTIONED mid-sentence does not
 *     count — an explanation is not an interface, and `query` documented
 *     `--tasks` that way for as long as it was undocumented.
 *
 * `--dir`, `--help` and `-h` are excluded because they are documented ONCE, in
 * the main help, as working on every command. The exclusion is not assumed: the
 * test below fails if the main help stops saying so.
 *
 * THE EXEMPTIONS ARE NAMED, not silent. Six commands carry the same defect;
 * they are listed with the task that will settle them, so a seventh cannot
 * appear without this guard failing.
 *
 * ITS REACH IS NOW THE WHOLE TABLE (TL-220). Until every command refused in one
 * shape this guard could only ask the eleven that printed `available:`, and it
 * SKIPPED the rest — which is to say it was green while thirty-one commands
 * could not be asked what they accept at all. The positive control below fails
 * if a single command stops answering, because a command dropping out of reach
 * looks from here exactly like a command with nothing to hide.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS, describeFlags } from "../cli.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it.
isolateHome("help-covers-flags");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");
const NAMES = Object.keys(COMMANDS);

/** Documented once in the main help as working everywhere, so a command that
 *  does not repeat them is not hiding anything. */
const GLOBAL_FLAGS = new Set(["--dir", "--help", "-h"]);

/**
 * Flags accepted but not yet declared, per command. EMPTY since TL-217, and the
 * case at the bottom of this file fails on an entry that outlives its defect —
 * so an exemption can be granted again, but only with an argument, and only for
 * as long as the defect it names is real.
 *
 * The six it held were closed in two moves rather than one. Five commands got
 * the prose their flags never had. `plan-from` needed the opposite: it LISTED
 * `--from` and `--json` in its refusal and answered `unknown flag:` to both, so
 * documenting them would have written down a promise the command does not keep
 * — its accepted set was corrected to what it takes.
 */
const UNDOCUMENTED = {};

/**
 * The flags a command accepts, taken from its own refusal — or `null` when the
 * command does not answer with a list, which since TL-220 is a DEFECT rather
 * than a gap in this guard's reach: every command in the table names its
 * accepted set in one wording, and `refusal-shape.test.mjs` holds that. The
 * positive control below turns a `null` into a failure here too, so a command
 * cannot leave this comparison by changing its own error message.
 */
function accepted(name) {
  const r = spawnSync(process.execPath, [CLI, name, "--zzz-not-a-flag"], {
    encoding: "utf8", timeout: 20_000, input: "",
  });
  const line = ((r.stdout || "") + (r.stderr || "")).match(/available:([^\n]*)/);
  if (!line) return null;
  // `<path...>` and `<boards.yaml>` are value placeholders, not flags; the
  // lookbehind keeps the scan off anything inside one.
  const flags = [...line[1].matchAll(/(?<![\w<-])--[a-z0-9][a-z0-9-]*/g)].map((m) => m[0]);
  return [...new Set(flags)].filter((f) => !GLOBAL_FLAGS.has(f));
}

/** What the command's `--help` declares, by the same rule `--help --json` uses. */
function declared(name) {
  return new Set(describeFlags(COMMANDS[name].usage).map((f) => f.flag));
}

// ── Positive controls, first ──────────────────────────────────────────────

test("positive control: EVERY command answers an unknown flag with a list", () => {
  // The loop below skips a command that answers `null`. If the refusal format
  // changed, or the parse broke, this whole file would iterate over nothing and
  // pass while proving nothing — and before TL-220 it iterated over a quarter of
  // the table for exactly that reason. Silent, because a skipped command and a
  // clean command are indistinguishable from inside the loop.
  const silent = NAMES.filter((n) => accepted(n) === null);
  assert.deepEqual(silent, [],
    "commands out of this guard's reach — their refusal names no available set:\n  " +
    silent.join("\n  "));
  assert.ok(NAMES.length >= 20, "expecting a table of commands, got " + NAMES.length);
});

test("positive control: a flag removed from the help is CAUGHT", () => {
  // The guard is only worth its run time if it fails on the defect it names.
  // Done on a copy of the real usage, so this proves the comparison itself and
  // not a hand-made string that happens to break.
  const real = describeFlags(COMMANDS.query.usage).map((f) => f.flag);
  assert.ok(real.includes("--text"), "the fixture below assumes query declares --text");

  const mutilated = COMMANDS.query.usage.split("\n")
    .filter((l) => !l.includes("--text"))
    .join("\n");
  const after = new Set(describeFlags(mutilated).map((f) => f.flag));
  assert.equal(after.has("--text"), false,
    "removing --text from the usage left it declared — the derivation is not reading the help");

  const missed = (accepted("query") || []).filter((f) => !after.has(f));
  assert.deepEqual(missed, ["--text"],
    "a flag accepted but absent from the help was not reported as missing");
});

test("positive control: the main help still carries the global flags", () => {
  // GLOBAL_FLAGS above is an exemption granted because the main help documents
  // them for every command at once. If that sentence goes, the exemption has to
  // go with it, or --dir becomes undocumented everywhere and nothing notices.
  const main = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", timeout: 20_000 });
  assert.equal(main.status, 0, main.stderr);
  assert.match(main.stdout, /--dir <path>.*every command/s,
    "the main help no longer says --dir works on every command");
  assert.match(main.stdout, /--help.*prints that command's flags/s,
    "the main help no longer promises a per-command --help");
});

// ── The rule ──────────────────────────────────────────────────────────────

test("every flag a command accepts is declared in its own --help", () => {
  const offenders = [];
  for (const name of NAMES) {
    const accepts = accepted(name);
    if (accepts === null) continue;
    const has = declared(name);
    const exempt = new Set(UNDOCUMENTED[name] || []);
    const missing = accepts.filter((f) => !has.has(f) && !exempt.has(f));
    if (missing.length) offenders.push(name + ": " + missing.join(" "));
  }
  assert.deepEqual(offenders, [],
    "accepted but absent from `<command> --help`:\n  " + offenders.join("\n  "));
});

test("query declares every one of the flags TL-194 found hidden", () => {
  // Named one by one rather than left to the loop above: these nine are the
  // measurement the task was opened on, and a future exemption must not be able
  // to quietly take one of them back.
  const has = declared("query");
  for (const flag of ["--text", "--limit", "--sort", "--type", "--owner", "--role",
    "--executor", "--blocked-by", "--tasks"]) {
    assert.ok(has.has(flag), "query --help does not declare " + flag);
  }
});

/**
 * What is wrong with an exemption map, entry by entry — empty when every
 * exemption still names a real defect.
 *
 * A FUNCTION because the real map is empty since TL-217, and a loop over
 * nothing passes while proving nothing (`AGENTS.md`: a guard green on a zero
 * sample has no evidentiary force). The positive control below runs it over a
 * map that lies.
 */
function exemptionProblems(map) {
  const problems = [];
  for (const [name, flags] of Object.entries(map)) {
    if (!COMMANDS[name]) { problems.push("exemption for a command that no longer exists: " + name); continue; }
    const accepts = new Set(accepted(name) || []);
    const has = declared(name);
    for (const flag of flags) {
      if (!accepts.has(flag)) problems.push(name + ": exempting " + flag + ", which it no longer accepts");
      if (has.has(flag)) problems.push(name + ": " + flag + " is documented now — remove it from the exemption list");
    }
  }
  return problems;
}

test("positive control: an exemption that lies about the tool IS caught", () => {
  // `query` is the command TL-194 documented in full, so every flag of it is a
  // lie in this map — and a flag no command accepts is the other way to be wrong.
  assert.deepEqual(exemptionProblems({ query: ["--zzz-not-a-flag"] }).length, 1,
    "an exemption for a flag nothing accepts passed");
  assert.deepEqual(exemptionProblems({ query: ["--text"] }).length, 1,
    "an exemption for a flag that IS documented passed");
  assert.deepEqual(exemptionProblems({ "no-such-command": ["--x"] }).length, 1,
    "an exemption for a command that does not exist passed");
});

test("the exemption list does not outlive the defect it records", () => {
  // An exemption for a flag that IS documented now is a lie about the state of
  // the tool, and it would hide a genuine regression on that same flag.
  assert.deepEqual(exemptionProblems(UNDOCUMENTED), []);
});
