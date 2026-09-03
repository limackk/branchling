/**
 * The input surface a program sees: `--help --json` and `--append-<field>`
 * (TL-83).
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The vocabularies in `--help --json` come from `config.yaml`. Proved
 *      against a fixture whose statuses, priorities and types share NOTHING
 *      with the defaults — a literal in the code would then produce the
 *      default words and fail here. Against the default configuration the
 *      assertion would pass either way, which is to say it would prove nothing.
 *   2. The flags are DERIVED from each command's own help, so the two cannot
 *      disagree. Tested on the derivation, because that is the claim.
 *   3. `--append-<field>` preserves command-line order, and `--<field>` plus
 *      `--append-<field>` has ONE defined result.
 *   4. `--append-` on a command with no such field is refused here, rather
 *      than reaching the command as a flag the user never typed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { APPENDABLE_FIELDS, COMMANDS, commandHelpJson, describeFlags, foldAppendFlags } from "../cli.mjs";
import { alignTemplate, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("write-input-surface");


const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;
function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

/** A vocabulary sharing nothing with the defaults — see the header. */
const OWN = {
  statuses: ["icebox", "surveying", "charted"],
  archived: ["charted"],
  priorities: ["urgent", "ordinary", "someday"],
  types: ["survey", "expedition"],
  roles: ["cartographer", "surveyor"],
  owners: ["nobody-yet"],
};

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-input-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8")
    .replace(/^statuses:.*$/m, "statuses: [" + OWN.statuses.join(", ") + "]")
    .replace(/^archived_statuses:.*$/m, "archived_statuses: [" + OWN.archived.join(", ") + "]")
    .replace(/^dashboard_open_statuses:.*$/m, "dashboard_open_statuses: [icebox, surveying]")
    .replace(/^reason_required_statuses:.*$/m, "reason_required_statuses: [charted]")
    .replace(/^priorities:.*$/m, "priorities: [" + OWN.priorities.join(", ") + "]")
    .replace(/^types:.*$/m, "types: [" + OWN.types.join(", ") + "]")
    .replace(/^owners:.*$/m, "owners: [" + OWN.owners.join(", ") + "]"), "utf8");
  // APPENDED rather than replaced: `init` does not write these two keys, so a
  // substitution would match nothing and the fixture would quietly be a
  // different project from the one the test describes.
  appendFileSync(p, "\nroles: [" + OWN.roles.join(", ") + "]\nin_progress_status: surveying\n", "utf8");
  alignTemplate(dir);
  return dir;
}

const helpJson = (dir, command) => {
  // With no `--dir`, the run happens in a directory that is NOT a backlog and
  // has none above it — otherwise resolution walks up into this repository's own
  // backlog and "no configuration" is never actually tested.
  const r = dir
    ? run([command, "--help", "--json", "--dir", dir])
    : run([command, "--help", "--json"], { cwd: mkdtempSync(join(tmpdir(), "branchling-nobacklog-" + counter++ + "-")) });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

const flag = (doc, name) => doc.flags.find((f) => f.flag === name);

// ── The description ───────────────────────────────────────────────────────

test("every command answers --help --json in the envelope", () => {
  for (const name of Object.keys(COMMANDS)) {
    const doc = helpJson(null, name);
    assert.equal(doc.kind, "command-help", name + " did not answer in the envelope");
    assert.equal(doc.command, name);
    assert.ok(doc.summary, name + " has no summary");
    assert.ok(Array.isArray(doc.flags), name + " describes no flags");
  }
});

test("the values come from THIS project's config.yaml, not from the defaults", () => {
  const dir = backlog();
  const doc = helpJson(dir, "new");
  assert.equal(doc.configured, true);
  assert.deepEqual(flag(doc, "--status").values, OWN.statuses);
  assert.deepEqual(flag(doc, "--priority").values, OWN.priorities);
  assert.deepEqual(flag(doc, "--type").values, OWN.types);
  assert.deepEqual(flag(doc, "--owner").values, OWN.owners);

  // The control that gives the three above their force: a literal in the code
  // would answer with these words instead.
  const text = JSON.stringify(doc);
  for (const word of ["pending", "in_progress", "P0", "P1"]) {
    assert.ok(!text.includes('"' + word + '"'), "a default vocabulary value leaked in: " + word);
  }
});

test("a role vocabulary reaches the commands that hand work over", () => {
  const dir = backlog();
  assert.deepEqual(flag(helpJson(dir, "handoff"), "--to-role").values, OWN.roles);
  assert.deepEqual(flag(helpJson(dir, "take"), "--role").values, OWN.roles);
});

test("with no backlog the flags are still described, and the absence is named", () => {
  // `--help` is exactly what somebody types before they have a backlog.
  const doc = helpJson(null, "new");
  assert.equal(doc.configured, false);
  assert.equal(flag(doc, "--status").values, null, "`null` says nobody looked; `[]` would say the vocabulary is empty");
  assert.equal(flag(doc, "--status").dictionary, "statuses", "the source is named even when it could not be read");
});

test("an OPEN vocabulary is marked as such — an empty list means two different things", () => {
  const dir = backlog();
  const open = flag(helpJson(dir, "next"), "--label");
  assert.deepEqual(open.values, []);
  assert.equal(open.closed, false, "labels are open here, so an empty list means `invent your own`");

  appendFileSync(join(dir, "config.yaml"), "\n", "utf8");
  writeFileSync(join(dir, "config.yaml"),
    readFileSync(join(dir, "config.yaml"), "utf8").replace(/^labels_closed:.*$/m, "labels_closed: true"), "utf8");
  assert.equal(flag(helpJson(dir, "next"), "--label").closed, true);
});

// ── The derivation ────────────────────────────────────────────────────────

test("a flag in the synopsis is required unless it stands in brackets", () => {
  const flags = describeFlags('x go --to <r> [--json] [--dir <path>]');
  assert.deepEqual(flags.map((f) => [f.flag, f.required]), [["--dir", false], ["--json", false], ["--to", true]]);
});

test("an alternation inside ONE bracket does not make its later members required", () => {
  // `[--json|--files|--count]` — a naive test for a `[` right before the flag
  // reports the last two as required, i.e. the tool demanding flags it does not
  // want.
  const flags = describeFlags("x ask [--json|--files|--count]");
  assert.deepEqual(flags.filter((f) => f.required), []);
});

test("a flag explained in prose is not an interface; a flag on its own line is", () => {
  const usage = ["x go [--json]", "", "  --json   answer as a document", "  It also honours --dir, which is not declared here."].join("\n");
  assert.deepEqual(describeFlags(usage).map((f) => f.flag), ["--json"]);
});

test("a wrapped synopsis contributes its second line too", () => {
  const usage = ["x go --to <r> [--reason \"<text>\"]", "        [--json] [--dir <path>]", "", "  prose"].join("\n");
  assert.deepEqual(describeFlags(usage).map((f) => f.flag).sort(), ["--dir", "--json", "--reason", "--to"]);
});

test("the value placeholder is read, quoted or not", () => {
  const flags = describeFlags('x new --title "<text>" [--estimate <2h>]');
  assert.equal(flags.find((f) => f.flag === "--title").arg, "<text>");
  assert.equal(flags.find((f) => f.flag === "--estimate").arg, "<2h>");
});

test("the description is derived from the SAME usage a person reads", () => {
  // Not a restatement: it is the claim that there is one source, which is why
  // there is no second flag table to drift from this one.
  for (const [name, spec] of Object.entries(COMMANDS)) {
    const doc = commandHelpJson(name, spec, null);
    assert.equal(doc.usage, String(spec.usage || ""), name);
    for (const f of doc.flags) {
      assert.ok(String(spec.usage || "").includes(f.flag), name + " describes " + f.flag + ", which is not in its usage");
    }
  }
});

// ── Appending ─────────────────────────────────────────────────────────────

test("repeated --append-<field> keeps command-line order", () => {
  const { argv, error } = foldAppendFlags(["--append-reason", "A", "--append-reason", "B", "--append-reason", "C"]);
  assert.equal(error, null);
  assert.deepEqual(argv, ["--reason", "A\nB\nC"]);
});

test("--<field> replaces first, then the appends follow — whichever order they are typed in", () => {
  const before = foldAppendFlags(["--reason", "A", "--append-reason", "B"]).argv;
  const after = foldAppendFlags(["--append-reason", "B", "--reason", "A"]).argv;
  assert.deepEqual(before, ["--reason", "A\nB"]);
  assert.deepEqual(after, ["--reason", "A\nB"], "the same flags must not mean two different things");
});

test("the base flag is rewritten in place, so the argument order is otherwise untouched", () => {
  const { argv } = foldAppendFlags(["TL-1", "--reason", "A", "--actor", "local:me", "--append-reason", "B"]);
  assert.deepEqual(argv, ["TL-1", "--reason", "A\nB", "--actor", "local:me"]);
});

test("nothing to append to is refused here, not passed on as a flag nobody typed", () => {
  const r = foldAppendFlags(["--append-reason", "A"], () => false);
  assert.match(r.error, /nothing to append to/);
  assert.deepEqual(r.argv, ["--append-reason", "A"], "the arguments are left alone when refused");
});

test("only the declared fields are appendable — the rest is an unknown flag", () => {
  assert.deepEqual(APPENDABLE_FIELDS, ["reason"]);
  assert.match(foldAppendFlags(["--append-title", "A"]).error, /unknown flag: --append-title/);
});

test("a missing value is an error, not a silently empty line", () => {
  assert.match(foldAppendFlags(["--append-reason"]).error, /requires a value/);
});

test("after `--` nothing is folded — a value may look like a flag", () => {
  const { argv, error } = foldAppendFlags(["--", "--append-reason", "A"]);
  assert.equal(error, null);
  assert.deepEqual(argv, ["--", "--append-reason", "A"]);
});

test("the fold reaches a real command, and the appended lines arrive in order", () => {
  const dir = backlog();
  const created = run(["new", "--dir", dir, "--title", "Handed over"]);
  assert.equal(created.status, 0, created.stderr);
  const id = created.stdout.match(/[A-Z]+-\d+/)[0];
  assert.equal(run(["take", id, "--dir", dir, "--actor", "local:me"]).status, 0);

  const r = run(["handoff", id, "--dir", dir, "--actor", "local:me", "--to-role", "surveyor",
    "--reason", "First.", "--append-reason", "Second.", "--append-reason", "Third."]);
  assert.equal(r.status, 0, r.stderr);

  const log = readFileSync(join(dir, "history", id + ".jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const reasons = log.map((e) => e.reason).filter((x) => x && x !== "unknown");
  assert.ok(reasons.length, "the handoff recorded no reason at all");
  // The history stores a reason as ONE line — that normalisation predates this
  // flag. What must survive is the ORDER.
  assert.match(reasons[0], /First\.\s+Second\.\s+Third\./);
});

test("--append- on a command that takes no such field fails with exit 2 and writes nothing", () => {
  const dir = backlog();
  const r = run(["new", "--dir", dir, "--title", "X", "--append-reason", "A"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--append-reason has nothing to append to/);
});

test("--help --append-reason asks about the interface rather than using it", () => {
  const r = run(["handoff", "--help", "--append-reason", "A"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /usage:/);
});
