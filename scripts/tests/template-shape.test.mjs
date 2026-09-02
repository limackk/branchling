/**
 * The two templates share a SHAPE (TL-121).
 *
 * WHY THERE ARE TWO AT ALL. The root `_template.md` ships in the tarball into
 * other people's repositories; `backlog/_template.md` is the one THIS backlog's
 * `worktrail new` copies. Two files is not the defect — they drifted apart along
 * the one dimension where they must not, and the drift was invisible because
 * every missing field is optional to the parser.
 *
 * Measured when the drift was found (2026-09-01): 106 of 120 tasks carried a
 * `confidence:` the template never offered, so somebody typed it every time; the
 * `verification:` entry had no `id:`, so no criterion had anything to point at
 * and `check --criteria` reported 62 of 63 open tasks unlinked; and
 * `## Pre-flight reading` existed in 89 tasks as a convention the template had
 * never heard of.
 *
 * WHERE THE BOUNDARY RUNS, and it is CLAUDE.md's: the code knows the SHAPE, the
 * data knows the VALUES. The frontmatter KEYS and the structure of a
 * `verification:` entry are shape — `task-fields.mjs` and `criteria.mjs` read
 * them. `## Acceptance criteria` is shape too: `criteria.mjs` hard-codes it in
 * English because it is a FORMAT, not anybody's vocabulary. The prose around it
 * is neither, and this file says nothing about it.
 *
 * THE FIELD LIST IS DERIVED, NEVER TYPED HERE. A list written into this test
 * would be a third place the shape lives, and it would be the one that goes
 * stale silently — the failure mode this whole test exists to catch.
 *
 * The POSITIVE CONTROL at the end is what gives the rest evidential force: the
 * comparison is run against a copy with a field taken out, and it has to fail.
 * Without it a green run proves only that the test ran.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfig } from "../config.mjs";
import { PROOF_ID, parseCriteria, parseVerification } from "../criteria.mjs";
import { BACKLOG_DIR, REPO_ROOT } from "./_repo.mjs";

const SHIPPED = join(REPO_ROOT, "_template.md");
const OWN = join(BACKLOG_DIR, "_template.md");

/**
 * Whether the two paths are the same file.
 *
 * In the CO-LOCATED layout — the one a consumer gets, where the backlog IS the
 * repository root — there is only one template, and every assertion below would
 * compare a file with itself. That is not a passing test, it is a test that
 * asked nothing, so it is SAID rather than quietly enjoyed.
 */
const SAME_FILE = resolve(SHIPPED) === resolve(OWN);

const read = (p) => readFileSync(p, "utf8");
const frontmatterOf = (text) => (text.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [null, ""])[1];
const bodyOf = (text) => text.slice(text.indexOf("\n---\n", 3) + 5);

/** The top-level keys of a frontmatter block, in file order. */
function keysOf(frontmatter) {
  return String(frontmatter)
    .split(/\r?\n/)
    .map((l) => l.match(/^([a-z_][a-z0-9_]*):/))
    .filter(Boolean)
    .map((m) => m[1]);
}

test("positive control: there are two templates and both parse", () => {
  // Everything below iterates over what these two files contain. If either were
  // empty or unreadable, the comparisons would be vacuously true.
  assert.ok(keysOf(frontmatterOf(read(SHIPPED))).length >= 10, "the shipping template has no frontmatter to compare against");
  assert.ok(keysOf(frontmatterOf(read(OWN))).length >= 10, "this backlog's template has no frontmatter");
});

test("the frontmatter keys are identical, and the list comes from the SHIPPING template", () => {
  if (SAME_FILE) {
    // Co-located: one file, so there is nothing to compare. Stated, not skipped
    // silently — a test that quietly asks nothing reads exactly like one that
    // asked and was satisfied.
    assert.equal(resolve(SHIPPED), resolve(OWN));
    return;
  }
  const expected = keysOf(frontmatterOf(read(SHIPPED)));
  const actual = keysOf(frontmatterOf(read(OWN)));
  assert.deepEqual(actual, expected,
    "this backlog's template has drifted from the one that ships; the shipping file is the reference");
});

test("the verification entry carries an `id:`, so a criterion has something to point at", () => {
  for (const path of [SHIPPED, OWN]) {
    const { entries, problems } = parseVerification(frontmatterOf(read(path)));
    assert.deepEqual(problems, [], path + ": the template's own verification block does not parse");
    assert.equal(entries.length, 1, path + ": expecting exactly one example entry");
    assert.ok(entries[0].id, path + ": no `id:` — nothing can be proved by it");
    assert.match(entries[0].id, PROOF_ID, path + ": the example id does not match the shape a proof reference takes");
  }
});

test("the criteria section teaches `[proof: <id>]`, and the example resolves", () => {
  for (const path of [SHIPPED, OWN]) {
    const text = read(path);
    const { present, items } = parseCriteria(bodyOf(text));
    assert.equal(present, true, path + ": no `## Acceptance criteria` section");
    assert.ok(items.length, path + ": the section is empty, so it teaches nothing");
    const ids = new Set(parseVerification(frontmatterOf(text)).entries.map((e) => e.id));
    const linked = items.filter((i) => i.proofs.length);
    assert.ok(linked.length, path + ": no example criterion names a proof");
    for (const item of linked) {
      for (const ref of item.proofs) {
        assert.ok(ids.has(ref), path + ": the example `[proof: " + ref + "]` names no verification entry");
      }
    }
  }
});

test("the `id:` placeholder carries THIS backlog's prefix, not a pre-migration one", () => {
  const prefix = loadConfig(BACKLOG_DIR).taskIdPrefix;
  const line = frontmatterOf(read(OWN)).match(/^id:\s*(\S+)/m);
  assert.ok(line, "the template has no `id:` line");
  assert.ok(line[1].startsWith(prefix + "-"),
    "the placeholder says `" + line[1] + "` while config.yaml says `" + prefix +
      "` — it does not break `new`, which rewrites the line, but it lies to whoever opens the file");
});

test("POSITIVE CONTROL: the comparison CATCHES a field taken out", () => {
  // The assertion the rest of this file depends on. Run against a copy with one
  // field removed, the key comparison has to fail — otherwise every green run
  // above proves only that the test executed.
  const shipped = keysOf(frontmatterOf(read(SHIPPED)));
  const damaged = frontmatterOf(read(SHIPPED)).replace(/^confidence:.*$/m, "");
  assert.notDeepEqual(keysOf(damaged), shipped,
    "removing a field left the key list unchanged — the comparison is not looking at what it claims to");
  assert.equal(keysOf(damaged).indexOf("confidence"), -1);
});

test("POSITIVE CONTROL: a verification entry without `id:` is caught", () => {
  const damaged = frontmatterOf(read(SHIPPED)).replace(/^\s+- id: .*$/m, "  - ");
  const { entries } = parseVerification(damaged);
  assert.equal(entries[0].id, null, "the check for an `id:` would pass on a template that has none");
});
