/**
 * The public documents carry nothing a reader cannot check (TL-37).
 *
 * THE DECISION BEHIND THE GUARD. The documents were split in two: the
 * measurements and the "why WE decided this" stay in the workspace this tool
 * came out of, and the tool gets the mechanism plus the command a reader can
 * run on their own tree. The variant that was rejected — anonymise the numbers
 * and keep them — was weaker for a reason worth restating: an unverifiable
 * measurement is not evidence for a stranger. A number from a repository nobody
 * can open asks them to trust the author, while still carrying information
 * about it. Zero gain, non-zero cost.
 *
 * WHAT THIS FILE HAS TO RULE OUT.
 *   1. A GUARD THAT CANNOT FIRE. Every rule is tested against text that must
 *      trip it AND text that must not — a detector with no negative case is a
 *      comment.
 *   2. THE REPLACEMENT BEING FORBIDDEN. The fix for a measurement is the
 *      command that reproduces it, and a command routinely prints a big number.
 *      A guard that flagged fenced blocks would forbid its own remedy.
 *   3. A NAME LIST SHIPPED IN THE CODE. A rejected-word list naming the company
 *      IS the company's name, published, in the repository the decision was
 *      made to keep it out of. Since TL-196 the list lives in the USER layer
 *      (`foreign_context_words` in the preferences file), outside every
 *      repository; `isolateHome` keeps this suite from reading the developer's
 *      copy, so the mechanism is tested with a word the TEST supplies.
 *   4. THE REAL TREE REGRESSING. This repository's own documents are audited,
 *      with a positive control that inserts a violation into a copy of the text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALLOW_MARKER, auditText, auditTree, PUBLIC_DOCS, HISTORICAL_RECORD } from "../check-no-foreign-context.mjs";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("foreign-context");

const reasons = (text, words) => auditText(text, words).map((p) => p.reason);

/**
 * "No findings", asserted at a cost that does not grow with the findings.
 *
 * `assert.deepEqual(findings, [])` fails by diffing the inspected array
 * against `[]`, and node's diff keeps one typed array per edit step: memory
 * grows with the SQUARE of the findings' printed lines, off the V8 heap. A
 * mutant that makes every line a finding (`if (PERSONAL_PATH.test(line))` →
 * `if (true)`, TL-727) turns every line of the real tree, tens of thousands,
 * into a finding, and that one failing assertion grew a test process to
 * 30 GB on 2026-11-13 before the kernel stopped the machine. A count with a
 * message fails in milliseconds and still names what was found.
 */
const SHOWN_FINDINGS = 5;
function assertNoFindings(findings, what) {
  assert.equal(findings.length, 0, what + " carries " + findings.length + " finding(s), the first: "
    + JSON.stringify(findings.slice(0, SHOWN_FINDINGS)));
}

// ── personal paths ────────────────────────────────────────────────────────

test("a personal absolute path is caught, and a schematic one is not", () => {
  assert.deepEqual(reasons("Run it in /Users/jane/workspace/thing."), ["personal-path"]);
  assert.deepEqual(reasons("Run it in /home/jane/workspace/thing."), ["personal-path"]);
  assert.deepEqual(reasons("Run it in /path/to/repo."), []);
  assert.deepEqual(reasons("Run it in /Users/x/workspace/thing."), [],
    "`/Users/x` is the documented placeholder, not somebody's login");
});

// ── addresses ─────────────────────────────────────────────────────────────

test("an address is caught unless its domain is reserved for documentation", () => {
  assert.deepEqual(reasons("Write to someone@company.io"), ["email"]);
  assert.deepEqual(reasons("Signed-off-by: Jane Doe <jane@example.com>"), [],
    "RFC 2606 domains exist so a document can show the SHAPE without naming a person");
  assert.deepEqual(reasons("tests@example.invalid"), []);
});

// ── measurements ──────────────────────────────────────────────────────────

test("a count of a corpus the reader cannot open is caught", () => {
  assert.deepEqual(reasons("sorted aggregates of all 1362 tasks"), ["measurement"]);
  assert.deepEqual(reasons("1142 commits in 60 days"), ["measurement"]);
  assert.deepEqual(reasons("78% of commits touching tasks/ also touched views"), ["measurement"]);
});

test("a small number is an example, not a claim about somebody's tree", () => {
  assert.deepEqual(reasons("two branches with no task in common"), []);
  assert.deepEqual(reasons("12 of 44 closed tasks"), [],
    "below three digits a number is illustrating a rule, not doing the arguing");
});

test("a fenced block is exempt — the command IS the replacement", () => {
  const doc = [
    "Measure it yourself:",
    "```bash",
    "branchling query --status done --count   # prints 1362 tasks",
    "```",
  ].join("\n");
  assert.deepEqual(reasons(doc), [],
    "flagging the fix would leave nothing to replace a measurement with");
});

// WHICH LINES ARE A FENCE is the CommonMark rule in `markdown-fence.mjs`, the
// one the criteria parser and the importer read by (TL-708). The guard used to
// toggle on any line starting with ```, so a tilde block was prose and an inner
// ``` closed a ```` block. Each case pairs the line inside the block with the
// SAME line outside it: an exemption proved only by silence would also pass a
// guard that had stopped reporting measurements altogether.
const MEASURED = "branchling query --status done --count   # prints 1362 tasks";
const measuredAt = (text) => auditText(text, []).filter((p) => p.reason === "measurement").map((p) => p.line);

test("POSITIVE CONTROL: the line the fence cases exempt is a measurement in prose", () => {
  assert.deepEqual(reasons(MEASURED), ["measurement"]);
});

test("a tilde fence is a fenced block, and the same line after it is prose again", () => {
  const doc = ["Measure it yourself:", "~~~bash", MEASURED, "~~~", MEASURED].join("\n");
  assert.deepEqual(measuredAt(doc), [5],
    "line 3 is code inside `~~~`; line 5 is the same text in prose after the block closed");
});

test("a ```` fence holds an inner ``` line, and the same line after it is prose again", () => {
  // A document that SHOWS how to write a fenced block: the outer four-backtick
  // fence closes only on a line of at least four backticks.
  const doc = ["How to write it:", "````markdown", "```bash", MEASURED, "```", "````", MEASURED].join("\n");
  assert.deepEqual(measuredAt(doc), [7],
    "line 4 is code — the inner ``` opens nothing; line 7 is prose after the ```` closed");
  // An inner ``` with no partner of its own: a toggle closes the block on it and
  // reopens it on the ````, which judges line 3 as prose and hides line 6.
  const unpaired = ["````markdown", "```bash", MEASURED, "````", "", MEASURED].join("\n");
  assert.deepEqual(measuredAt(unpaired), [6]);
});

test("a name inside a fence is still caught — a fence exempts numbers, not identity", () => {
  const doc = ["```bash", "cd /home/jane/acme", "```"].join("\n");
  assert.deepEqual(reasons(doc), ["personal-path"]);
});

// ── the configured word list ──────────────────────────────────────────────

test("a forbidden word comes from the configuration, and none is shipped in the code", () => {
  assert.deepEqual(reasons("Northwind's workspace made this necessary."), [],
    "the code ships no name list: a rejected-word list naming a company IS that name, published");
  assert.deepEqual(reasons("Northwind's workspace made this necessary.", ["northwind"]), ["word:northwind"]);
  assert.deepEqual(reasons("A northwindish approach", ["northwind"]), [],
    "matching on a word boundary, so an unrelated word is not a false positive");
});

// ── the exception ─────────────────────────────────────────────────────────

test("the marker excuses the line it is on, and the line below it", () => {
  assert.deepEqual(reasons("1362 tasks  <!-- " + ALLOW_MARKER + " -->"), []);
  assert.deepEqual(reasons("<!-- " + ALLOW_MARKER + " -->\n1362 tasks"), []);
  assert.deepEqual(reasons("1362 tasks\n<!-- " + ALLOW_MARKER + " -->"), ["measurement"],
    "a marker BELOW the line excuses nothing — otherwise it would be unclear which line it covers");
});

// ── the real tree, with a positive control ────────────────────────────────

test("this repository's public documents pass", () => {
  const { findings, filesChecked } = auditTree(REPO_ROOT, []);
  assert.ok(filesChecked > 5, "the walk read " + filesChecked + " documents — it is looking at the wrong tree");
  assertNoFindings(findings, "the public documents");
});

test("a tree in which every line is a finding fails by assertion, not by memory (TL-727)", () => {
  // The shape the runaway mutants produced: one finding per line of the real
  // tree. The failure has to be an AssertionError whose message stays the
  // same size however many findings there are — the diff it replaced needed
  // more than the 4 GiB per-process cap for this many.
  const { linesChecked } = auditTree(REPO_ROOT, []);
  assert.ok(linesChecked > 10000, "the walk read " + linesChecked + " lines — not the tree the runaway was measured on");
  const everyLine = Array.from({ length: linesChecked }, (_, i) =>
    ({ file: "docs/x.md", line: i + 1, text: "a line", reason: "personal-path" }));
  assert.throws(() => assertNoFindings(everyLine, "the tree"), (err) => {
    assert.equal(err.name, "AssertionError");
    assert.match(err.message, new RegExp("carries " + linesChecked + " finding"));
    assert.ok(err.message.length < 1000, "the message grew to " + err.message.length + " characters");
    return true;
  });
});

test("POSITIVE CONTROL: a violation inserted into a real document IS caught", () => {
  // The document is not touched on disk: the violation goes into a COPY of the
  // text. A guard proved only against hand-written strings could still be
  // failing to read the files it claims to read.
  const text = readFileSync(join(REPO_ROOT, "docs", "branchling-global-tool.md"), "utf8");
  assertNoFindings(auditText(text, []), "docs/branchling-global-tool.md");
  assert.deepEqual(reasons(text + "\nThe backlog holds 1363 tasks.\n"), ["measurement"]);
  assert.deepEqual(reasons(text + "\nSee /Users/jane/workspace.\n"), ["personal-path"]);
  // `northwind` and not `acme`: this document already uses `acme` as its
  // placeholder project name, and a control word the fixture already contains
  // would be testing the fixture rather than the rule.
  assert.deepEqual(reasons(text + "\nNorthwind decided this.\n", ["northwind"]), ["word:northwind"]);
});

// ── the perimeter itself (TL-196) ─────────────────────────────────────────

test("POSITIVE CONTROL: the backlog is inside the perimeter", () => {
  // The defect this replaces: the guard read 12 documents, skipped 197 task
  // files, and reported green while the backlog named another project 101
  // times. If `backlog` ever leaves this list the guard goes back to answering
  // a question it did not ask, so the assertion is on the list itself.
  assert.ok(PUBLIC_DOCS.includes("backlog"),
    "the backlog left the perimeter — the guard now passes over the larger half of what a stranger reads");
  const { filesChecked } = auditTree(REPO_ROOT, []);
  assert.ok(filesChecked > 100,
    "the walk read " + filesChecked + " documents; with the backlog in scope this repository has hundreds");
});

test("a dated record is not an argument: the measurement rule stops at the backlog", () => {
  // A task's `## Log` says what was true on a date. Auditing it as if it were
  // prose meant to persuade produced 124 findings against entries CLAUDE.md
  // asks for — "337 tasks", "1375 references rewritten". A guard that flags the
  // practice it protects gets silenced, so the rule is scoped instead.
  assert.ok(HISTORICAL_RECORD.includes("backlog"));
  const line = "- 2026-09-01 done — agent:claude — migration of 1145 tasks";
  assert.deepEqual(auditText(line, []).map((p) => p.reason), ["measurement"]);
  assert.deepEqual(auditText(line, [], { measurements: false }), []);
});

test("the detectors that name somebody run EVERYWHERE, the record included", () => {
  // Scoping the measurement rule must not become a hole: a name and a personal
  // path are wrong in a dated log exactly as they are in a document.
  const opts = { measurements: false };
  assert.deepEqual(auditText("- 2026-09-01 — see /Users/jane/workspace", [], opts).map((p) => p.reason),
    ["personal-path"]);
  assert.deepEqual(auditText("- 2026-09-01 — measured in northwind", ["northwind"], opts).map((p) => p.reason),
    ["word:northwind"]);
});
