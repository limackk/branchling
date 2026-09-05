/**
 * `CLAUDE.md` states no count of this tree that nothing keeps current (TL-172).
 *
 * WHY A GUARD AND NOT JUST A CORRECTION. The file said `693/693, green` while
 * the suite stood at 1440 — wrong by roughly a factor of two, for long enough
 * that nobody could say when it stopped being true. Editing the digits would
 * have restored the claim for exactly one commit, and the next test to land
 * would have made it false again with nothing to notice. The number was never
 * the defect; a sentence that ages without anybody being told is.
 *
 * It is the failure this repository names elsewhere and had in its own
 * instructions: still specific, still confident, no longer true — sitting in
 * the file every session reads before touching anything.
 *
 * WHAT IS AND IS NOT FORBIDDEN. Only a tally of the CURRENT tree, written as a
 * literal. `TL-137 translated both (145 files)` stays, and must: it is a fact
 * about one finished migration, fixed in the past, and it cannot rot. The
 * distinction is not stylistic — a claim about a past act stays true forever,
 * and a claim about the tree is falsified by the next commit.
 *
 * THE POSITIVE CONTROL IS THE POINT (CLAUDE.md). A guard that only ever reads
 * the corrected file is green with no evidentiary force, so the detection is a
 * pure function and it is fed the exact sentence that was there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("frozen-tally");

/**
 * The `<n>/<n>` shape — a count of the tree stated as a literal.
 *
 * Deliberately narrow. "Any number in prose" would catch the line width, the
 * laws and every task id, and a guard that cries about those is one somebody
 * turns off. This catches the shape that actually rotted, and a wider net can
 * be cast when a wider failure is observed rather than imagined.
 */
export function frozenTallies(text) {
  const found = [];
  String(text || "").split("\n").forEach((line, i) => {
    // A fenced command may legitimately contain one; the claim is prose.
    if (line.startsWith("    ") || line.startsWith("\t")) return;
    const m = line.match(/\b\d+\/\d+\b/);
    if (m) found.push({ line: i + 1, text: line.trim(), tally: m[0] });
  });
  return found;
}

test("the detector fires on the sentence that was actually there", () => {
  const found = frozenTallies("693/693, green. Two rules keep it that way:");
  assert.equal(found.length, 1, "a guard that cannot see the original defect proves nothing");
  assert.equal(found[0].tally, "693/693");
});

test("SILENT: a date, a task id and a path are not tallies", () => {
  assert.deepEqual(frozenTallies("On 2026-09-01 TL-1303 moved to scripts/tests/_repo.mjs — 72 chars"), []);
});

test("SILENT: a count of a FINISHED act is not a claim about the tree", () => {
  assert.deepEqual(frozenTallies("TL-137 translated both (145 files) and is why the guard covers them"), []);
});

test("CLAUDE.md states no tally that nothing keeps current", () => {
  const text = readFileSync(join(REPO_ROOT, "CLAUDE.md"), "utf8");
  assert.ok(text.length > 0, "a positive control: an unreadable file must not pass this");
  assert.deepEqual(
    frozenTallies(text),
    [],
    "a count of this tree written into the instructions every session reads — it will be wrong by the next commit"
  );
});
