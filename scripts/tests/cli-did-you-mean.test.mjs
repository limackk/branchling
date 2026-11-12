/**
 * An unknown command or flag names the nearest known one (TL-701).
 *
 * WHAT IS ASSERTED. Both refusals, end to end through the CLI: the line is
 * there when a known name is near, absent when nothing is, and the exit code
 * stays 2 — a suggestion is printed, never executed. The pure functions in
 * `did-you-mean.mjs` are asserted at their boundaries (the distance limit, a
 * tie, an alias whose target the command does not accept), because a refusal
 * that suggests too eagerly is as misleading as one that suggests nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { isolateHome, plainOutput, REPO_ROOT, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("cli-did-you-mean");
plainOutput();

import {
  COMMAND_ALIASES, FLAG_ALIASES, editDistance, maxDistance, nearest, suggestionFor,
} from "../did-you-mean.mjs";
import { failure, refusal } from "../ui.mjs";
import { PRODUCT_NAME as N } from "../product.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const plain = { color: { err: (s) => s, bold: (s) => s, id: (s) => s } };

test("an unknown flag with a listed intent names the flag that does it, and still exits 2", () => {
  const r = run(["query", "--grep", "x"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "");
  assert.match(r.err, /unknown flag: --grep/);
  assert.match(r.err, /→ did you mean --text\?/);
  // The suggestion precedes the `--help` line: it is the shorter way out.
  assert.ok(r.err.indexOf("did you mean") < r.err.indexOf(N + " query --help"));
});

test("a misspelt flag names the nearest flag the command accepts", () => {
  const r = run(["query", "--stauts", "x"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /→ did you mean --status\?/);
});

test("an unknown command with a listed intent names the whole command line, and still exits 2", () => {
  const r = run(["verify", "TL-1"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, "");
  assert.match(r.err, /unknown command: verify/);
  assert.ok(r.err.includes("→ did you mean " + N + " done --dry-run?"), r.err);
});

test("a misspelt command names the nearest command", () => {
  const r = run(["qeury"]);
  assert.equal(r.code, 2);
  assert.ok(r.err.includes("→ did you mean " + N + " query?"), r.err);
});

test("nothing near means no suggestion line — the refusal is otherwise unchanged", () => {
  const flag = run(["query", "--zzz"]);
  assert.equal(flag.code, 2);
  assert.doesNotMatch(flag.err, /did you mean/);
  assert.match(flag.err, /available: /);
  const cmd = run(["frobnicate"]);
  assert.equal(cmd.code, 2);
  assert.doesNotMatch(cmd.err, /did you mean/);
});

test("editDistance counts an adjacent transposition as one edit", () => {
  assert.equal(editDistance("query", "query"), 0);
  assert.equal(editDistance("qeury", "query"), 1);
  assert.equal(editDistance("stauts", "status"), 1);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("abc", ""), 3);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("ab", "ba"), 1);
  assert.equal(editDistance("abc", "acb"), 1);
  assert.equal(editDistance("abcd", "abdc"), 1);
  // Not a transposition: the swapped pair must be adjacent and equal crosswise.
  assert.equal(editDistance("abc", "cab"), 2);
  assert.equal(editDistance("ab", "cd"), 2);
});

test("maxDistance allows a third of the bare name, at least one, and nothing under three characters", () => {
  assert.equal(maxDistance("--x"), -1);
  assert.equal(maxDistance("ab"), -1);
  assert.equal(maxDistance("abc"), 1);
  assert.equal(maxDistance("--abcde"), 1);
  assert.equal(maxDistance("--abcdef"), 2);
  assert.equal(maxDistance("abcdefghi"), 3);
});

test("nearest: within the limit, outside it, ties, prefixes and aliases", () => {
  assert.equal(nearest("--stats", ["--status", "--text"]), "--status");
  assert.equal(nearest("--zzz", ["--ids", "--text"]), null);
  // Three characters may be one edit off, not two.
  assert.equal(nearest("abd", ["abc"]), "abc");
  assert.equal(nearest("axd", ["abc"]), null);
  assert.equal(nearest("--abx", ["--abc", "--abd"]), "--abc or --abd");
  assert.equal(nearest("--abx", ["--abc", "--abd", "--abe", "--abf"]), "--abc or --abd or --abe");
  // The closer candidate wins over one seen first.
  assert.equal(nearest("--statux", ["--stat", "--status"]), "--status");
  // A truncated word is offered only when one candidate starts with it.
  assert.equal(nearest("--prio", ["--priority", "--owner"]), "--priority");
  assert.equal(nearest("--pri", ["--priority", "--private"]), null);
  // The word itself is never its own suggestion, nor a duplicate twice.
  assert.equal(nearest("--text", ["--text"]), null);
  assert.equal(nearest("--texx", ["--text", "--text"]), "--text");
  assert.equal(nearest("", ["--text"]), null);
  assert.equal(nearest("--text", []), null);
  assert.equal(nearest("--text", null), null);
  assert.equal(nearest("--x", ["--y"]), null);
  // An alias is offered only when its target is available.
  assert.equal(nearest("--grep", ["--text", "--json"], FLAG_ALIASES), "--text");
  assert.equal(nearest("--grep", ["--json"], FLAG_ALIASES), null);
  assert.equal(nearest("verify", ["done", "query"], COMMAND_ALIASES), "done --dry-run");
  assert.equal(nearest("verify", ["query"], COMMAND_ALIASES), null);
  // An inherited property is not an alias.
  assert.equal(nearest("toString", ["done"], COMMAND_ALIASES), null);
});

test("suggestionFor reads the event and the available line, nothing else", () => {
  const avail = ["available: --text --json --root <path>"];
  assert.equal(suggestionFor("unknown flag: --grep", avail), "did you mean --text?");
  assert.equal(suggestionFor("unknown flag: --grep=foo", avail), "did you mean --text?");
  assert.equal(suggestionFor("unknown flag: --rot", avail), "did you mean --root?");
  // `<path>` is a placeholder, not a candidate.
  assert.equal(suggestionFor("unknown flag: --pat", ["available: --text <path>"]), null);
  assert.equal(suggestionFor("unknown command: qeury", ["available: query done -h"], "tool"),
    "did you mean tool query?");
  assert.equal(suggestionFor("unknown command: qeury", ["available: query"]), "did you mean query?");
  // A command is never suggested for a flag, nor a flag for a command.
  assert.equal(suggestionFor("unknown flag: --query", ["available: query"]), null);
  assert.equal(suggestionFor("unknown command: tex", ["available: --text"]), null);
  assert.equal(suggestionFor("unknown command: verify", ["available: done"], "tool"),
    "did you mean tool done --dry-run?");
  assert.equal(suggestionFor("unknown flag: --texx", ["see: --text"]), null);
  assert.equal(suggestionFor("unknown flag: --texx", ["more", "available: --text"]), "did you mean --text?");
  assert.equal(suggestionFor("unknown flag: --texx", undefined), null);
  assert.equal(suggestionFor("unknown role: texx", avail), null);
  assert.equal(suggestionFor("an unknown flag: --texx", avail), null);
  assert.equal(suggestionFor(undefined, avail), null);
});

test("refusal() and failure() carry the line between the details and the next steps", () => {
  assert.equal(
    refusal("tool query", "unknown flag: --grep", "--text --json", plain),
    "✗ tool query: unknown flag: --grep\n  available: --text --json\n  → did you mean --text?\n  → tool query --help");
  assert.equal(
    failure("tool", "unknown flag: --zzz", ["available: --text"], ["tool --help"], plain),
    "✗ tool: unknown flag: --zzz\n  available: --text\n  → tool --help");
});
