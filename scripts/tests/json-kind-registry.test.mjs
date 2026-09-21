/**
 * WHERE A `--json` KIND IS REGISTERED (TL-285).
 *
 * The envelope's coverage rule — every declared kind is exercised end to end, on
 * an empty backlog and on a populated one — is the only thing standing between
 * the contract and a typo that ships. It used to be enforced from two tables
 * inside `scripts/tests/json-envelope.test.mjs`, which made a new `--json`
 * command an edit under `scripts/tests/`: a directory a hand writing production
 * code is kept out of precisely so that it cannot weaken the proof.
 *
 * The rule did not move; the REGISTRATION did. This file guards the property
 * that makes the move worth anything:
 *
 *   1. Every kind carries its invocation in the SAME file that declares it, so
 *      the author of an emitter can reach it.
 *   2. A kind with no invocation still FAILS — checked here against a
 *      deliberately broken pair, because a checker that reports an empty list
 *      when it is looking at nothing is the failure mode of every completeness
 *      test.
 *   3. The registry does not creep back under `scripts/tests/`, under any name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { KINDS, KIND_EXERCISE, registrationGaps } from "../json-envelope.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). Nothing here reads the
// user's configuration, but the rule is uniform on purpose: an exception has to
// be argued per file, and this file has no argument to make.
isolateHome("json-kind-registry");

const ENVELOPE_FILE = "json-envelope.mjs";
const TESTS_DIR = join(SCRIPTS_DIR, "tests");

test("every declared kind carries the invocation that exercises it", () => {
  assert.ok(Object.keys(KINDS).length >= 5, "expecting a kind per command that answers in the envelope");
  assert.deepEqual(registrationGaps(), [],
    "a kind with no command exercising it, or a row naming a kind that does not exist");
});

test("POSITIVE CONTROL: a kind nothing exercises is REPORTED, in both directions", () => {
  // Without this, the assertion above passes just as well against a checker that
  // returns an empty list whatever it is handed — green, with nothing measured.
  const orphanKind = registrationGaps({ ...KINDS, "no-such-kind": {} }, KIND_EXERCISE);
  assert.equal(orphanKind.length, 1, "a kind with no invocation went unreported");
  assert.match(orphanKind[0], /nothing exercises it/);

  const [first] = Object.keys(KINDS);
  const withoutFirst = { ...KIND_EXERCISE };
  delete withoutFirst[first];
  assert.equal(registrationGaps(KINDS, withoutFirst).length, 1,
    "removing a row from the registry went unreported");

  const orphanRow = registrationGaps(KINDS, { ...KIND_EXERCISE, "no-such-kind": { args: ["x"] } });
  assert.equal(orphanRow.length, 1, "a row naming a kind nothing declares went unreported");

  const noCommand = registrationGaps(KINDS, { ...KIND_EXERCISE, [first]: { args: [] } });
  assert.equal(noCommand.length, 1, "a row registered with no command line went unreported");
});

test("the registry is declared where KINDS is, so registering needs no test edit", () => {
  // The whole thesis, read from the source rather than from a habit: both
  // declarations are in one file, and that file is production code.
  const src = readFileSync(join(SCRIPTS_DIR, ENVELOPE_FILE), "utf8");
  assert.match(src, /export const KINDS = \{/, "KINDS is not declared where it is expected");
  assert.match(src, /export const KIND_EXERCISE = \{/, "the invocation registry does not ship beside KINDS");
  // And the sentinels the rows name, so an id is never typed into one (TL-273).
  assert.match(src, /export const FIRST_TASK = /);
  assert.match(src, /export const ABSENT_TASK = /);
});

test("no file under scripts/tests/ holds a table of kinds again", () => {
  // A SHAPE GUARD, NOT A NAME GUARD. The registry moved out of two constants
  // called READING and WRITING; forbidding those two names would be satisfied by
  // the same table under a third one. What no incidental assertion can imitate is
  // the BREADTH: a table has to name every kind, while a test that asserts
  // something about one or two commands names one or two. The threshold is half,
  // which is far above what any honest test file reaches and far below a table.
  const kinds = Object.keys(KINDS);
  const threshold = Math.ceil(kinds.length / 2);
  const mentions = (src) => kinds.filter((k) => src.includes('"' + k + '"') || src.includes("'" + k + "'")).length;

  // POSITIVE CONTROL: the detector really counts, and the file that DOES hold
  // the registry is over the threshold. Without it a broken reader would report
  // no offenders while measuring nothing.
  const envelopeSrc = readFileSync(join(SCRIPTS_DIR, ENVELOPE_FILE), "utf8");
  assert.ok(mentions(envelopeSrc) > threshold,
    "the detector does not recognise the registry it is modelled on");

  const offenders = [];
  for (const file of readdirSync(TESTS_DIR).filter((f) => f.endsWith(".mjs"))) {
    const found = mentions(readFileSync(join(TESTS_DIR, file), "utf8"));
    if (found >= threshold) offenders.push(file + " names " + found + " of " + kinds.length + " kinds");
  }
  assert.deepEqual(offenders, [],
    "a kind-keyed table under scripts/tests/ — register a kind in scripts/" + ENVELOPE_FILE + " instead");
});
