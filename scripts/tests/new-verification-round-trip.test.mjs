/**
 * A `verification:` string from a task document reaches the frontmatter as
 * itself (TL-500).
 *
 * WHAT WAS BROKEN. `new` wrapped each `bash:` and `manual:` string in double
 * quotes and escaped nothing inside them. The document entry
 *
 *   { "bash": "echo \"$f\" | grep -q '\"name\"'" }
 *
 * became `bash: "echo "$f" | grep -q '"name"'"` — not YAML, and not the command
 * its author wrote. Every reader downstream sees a different string, so `done`
 * would run something nobody typed. A second defect sat behind the first: the
 * reader's `stripComment()` did not know the `\"` escape, so even a correctly
 * escaped value was cut at a ` #` that followed an escaped quote.
 *
 * WHAT IS PROVED HERE, as two claims, because either one alone was green
 * against the defect for some input:
 *
 *   well-formed  every written value is a YAML double-quoted scalar. The
 *                tool's own reader is LENIENT — `unquote()` strips the first
 *                and last quote whatever stands between them — so the
 *                reported case read back right through it while any real YAML
 *                parser rejected the file.
 *   round trip   `parseVerification` returns exactly the string the document
 *                carried, which the shape check alone cannot see.
 *
 * The last case goes one step further and lets `done` run the entries,
 * observing the command's EFFECT, because a string that reads back right and a
 * command the shell runs right are two claims too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseVerification } from "../criteria.mjs";
import { setFrontmatterField, splitFrontmatter } from "../task-fields.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("new-verification-round-trip");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const ACTOR = "local:who-ran-new";

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" }, ...opts,
  });
}

function freshBacklog() {
  const dir = fixtureDir(join(tmpdir(), "branchling-round-trip-"));
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, r.stderr);
  return dir;
}

const tasksIn = (dir) => readdirSync(join(dir, "tasks")).filter((f) => f.endsWith(".md"));

// A YAML double-quoted scalar restricted to the two escapes the reader expands
// (`\\` and `\"`): no bare quote or backslash, no control character. Any other
// escape would be valid YAML that this tool reads back as a different string.
const DOUBLE_QUOTED = /^"(?:[^"\\\x00-\x1f]|\\["\\])*"$/;

/** Every `bash:`/`manual:` value in the block, as written. */
function writtenValues(frontmatter) {
  return [...frontmatter.matchAll(/^ +(?:- )?(?:bash|manual): (.*)$/gm)].map((m) => m[1]);
}

/** Create one task from `doc` and return its file and the entries read back. */
function created(doc) {
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Round trip"], { input: JSON.stringify(doc) });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const file = join(dir, "tasks", tasksIn(dir)[0]);
  const { frontmatter } = splitFrontmatter(readFileSync(file, "utf8"));
  const values = writtenValues(frontmatter);
  // The positive control for the loop below: a block it found nothing in
  // would pass every shape check there is.
  assert.equal(values.length, doc.verification.length, frontmatter);
  for (const v of values) assert.match(v, DOUBLE_QUOTED, "not a well-formed double-quoted YAML scalar");
  return { dir, file, id: r.stdout.match(/[A-Z]+-\d+/)[0], parsed: parseVerification(frontmatter) };
}

// The reported case first, verbatim; then one string per character class the
// writer has to survive. `#` follows an UNBALANCED escaped quote on purpose:
// balanced pairs, or an apostrophe after it, happen to keep it inside a quote
// even for a reader that does not understand escapes, so only this shape tells
// the two readers apart.
const STRINGS = [
  "echo \"$f\" | grep -q '\"name\"'",
  "printf '%s\\n' 'back\\slash' \"C:\\\\\"",
  "echo \\\" #literal",
  "grep -q 'key: value' config.yaml",
  "ends with a backslash \\",
  "ends with a quote \"",
  "echo 'it''s' \"#not-a-comment\"",
  "  surrounding spaces  ",
];

test("the reported command reads back as the string the document carried", () => {
  const command = STRINGS[0];
  const { parsed } = created({ goal: "g", verification: [{ id: "v", bash: command, proves: "p" }] });
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].bash, command);
});

test("every `bash:` and `manual:` string reads back unchanged", () => {
  const verification = [];
  STRINGS.forEach((s, i) => {
    verification.push({ id: "bash-" + i, bash: s, proves: "b" + i });
    verification.push({ id: "manual-" + i, manual: s, proves: "m" + i });
  });
  const { parsed } = created({ goal: "g", verification });
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(
    parsed.entries.map((e) => ({ id: e.id, bash: e.bash, manual: e.manual })),
    verification.map((v) => ({ id: v.id, bash: v.bash == null ? null : v.bash, manual: v.manual == null ? null : v.manual }))
  );
});

test("an entry with no id round-trips too", () => {
  const command = STRINGS[0];
  // A plain string is the short form; `new` gives it a generated id.
  const { parsed } = created({ goal: "g", verification: [command] });
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.entries[0].bash, command);
});

test("`done` runs the command the document carried, not a re-quoted one", () => {
  // The first entry is the reported case made runnable: `f` is set, so grep
  // finds the quoted key only if every quote reached the shell. The second
  // writes what the shell parsed, so the comparison below sees every escape.
  const verification = [
    { id: "reported", bash: "f='{\"name\": 1}'; echo \"$f\" | grep -q '\"name\"'", proves: "The reported command passes." },
    {
      id: "effect",
      bash: "printf '%s|' \"say \\\"hi\\\"\" 'back\\slash' \"dollar \\$HOME-free\" ' #hash' 'k: v' > seen.txt",
      proves: "The shell saw every character.",
    },
  ];
  const { dir, file, id } = created({ goal: "g", verification });

  assert.equal(run(["take", id, "--dir", dir, "--actor", ACTOR]).status, 0);
  const closed = run(["done", id, "--dir", dir, "--actor", ACTOR], { cwd: dir });
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  assert.match(readFileSync(file, "utf8"), /^status: done/m);

  const seen = readFileSync(join(dir, "seen.txt"), "utf8");
  assert.equal(seen, "say \"hi\"|back\\slash|dollar $HOME-free| #hash|k: v|");
});

test("rewriting a field keeps its comment, not the tail of an escaped value", () => {
  // The same scan decides where a value ends when a field is REWRITTEN: the
  // comment beside the old value is carried over to the new one. Before the
  // scanners were one, the `\"` closed the value here and ` #1"  # note` was
  // carried over as the comment — a quote and half a title glued to the line.
  const text = '---\ntitle: "Fix \\" #1"  # note\nstatus: pending\n---\nbody\n';
  const out = setFrontmatterField(text, "title", "Renamed");
  assert.match(out, /^title: Renamed  # note$/m);
});

test("a line break in a verification string is refused before anything is written", () => {
  // The frontmatter readers are line-based and leave `\n` literal inside a
  // quoted value, so no spelling of a line break would read back as one. A
  // refusal is the only answer that does not run a different command.
  const dir = freshBacklog();
  const r = run(["new", "--dir", dir, "--title", "Two lines"], {
    input: JSON.stringify({
      goal: "g",
      verification: [
        { id: "bash-break", bash: "true\nfalse" },
        { id: "manual-break", manual: "look\r\nagain" },
      ],
    }),
  });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /verification\[0\].*line break/);
  assert.match(r.stderr, /verification\[1\].*line break/);
  assert.deepEqual(tasksIn(dir), [], "a refused document left a task behind");
});
