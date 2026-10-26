/**
 * The mutex removes a holder's file only when it is the file judged stale
 * (TL-481).
 *
 * A contender whose create failed used to treat an ABSENT file like a corrupt
 * one and remove whatever stood under the name by the time it got there — by
 * then, possibly a third writer's fresh mutex. Two writers then ran inside one
 * section, and `new` handed two task files the same id under a loaded suite.
 *
 * Timing does not reproduce this on demand, so these tests force each
 * interleaving through the `interleave` seam of `withMutex`: the hook runs at
 * the exact points where another process could change the file. The last two
 * tests are the positive control — a holder that really is stale, or a record
 * nobody can read, is still taken over; a guard that refused every takeover
 * would pass the first two and leave the queue blocked by a dead process.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { withMutex } from "../lock.mjs";
import { isolateHome, isolateState } from "./_repo.mjs";

isolateHome("mutex-takeover");
const STATE = isolateState("mutex-takeover");
const ENV = { BACKLOG_STATE_DIR: STATE };

const mutexFiles = () => {
  try {
    return readdirSync(join(STATE, "mutex")).filter((f) => f.endsWith(".mutex"));
  } catch {
    return [];
  }
};

/** The file a section's mutex lives in, found by entering it once: the one name
 *  that exists only while the probe is inside. */
function mutexPath(name) {
  const before = new Set(mutexFiles());
  let found;
  withMutex(name, () => {
    found = mutexFiles().filter((f) => !before.has(f));
  }, { env: ENV });
  assert.equal(found.length, 1, "the probe did not find exactly one mutex file");
  return join(STATE, "mutex", found[0]);
}

function holderRecord(token, ts = new Date().toISOString()) {
  return JSON.stringify({ section: "other", token, pid: 1, host: "elsewhere", ts }) + "\n";
}

function enterBusy(name, interleave) {
  let entered = false;
  assert.throws(
    () => withMutex(name, () => { entered = true; }, { env: ENV, waitMs: 200, interleave }),
    (e) => e.code === "EBUSY",
  );
  return entered;
}

test("a mutex released and re-taken between a failed create and the read is not removed", () => {
  const path = mutexPath("released-then-retaken");
  writeFileSync(path, holderRecord("first-holder"), "utf8");
  const steps = [];
  const entered = enterBusy("released-then-retaken", (step) => {
    steps.push(step);
    if (steps.length !== 1) return;
    // The first holder releases; a third writer takes the section before this
    // contender reads the name again.
    unlinkSync(path);
    writeFileSync(path, holderRecord("third-writer"), "utf8");
  });
  assert.equal(steps[0], "contended", "the forced interleaving did not happen");
  assert.equal(entered, false, "the contender entered a section the third writer holds");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "third-writer");
  unlinkSync(path);
});

test("a stale mutex replaced by a fresh one before its removal keeps the fresh one", () => {
  const path = mutexPath("replaced-before-removal");
  writeFileSync(path, holderRecord("dead-holder", "2000-01-01T00:00:00.000Z"), "utf8");
  let judged = false;
  const entered = enterBusy("replaced-before-removal", (step) => {
    if (step !== "judged-stale" || judged) return;
    judged = true;
    // Another contender settles the stale holder first and takes the section.
    unlinkSync(path);
    writeFileSync(path, holderRecord("live-writer"), "utf8");
  });
  assert.equal(judged, true, "the stale holder was never judged stale");
  assert.equal(entered, false, "the contender removed a live writer's mutex and entered");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "live-writer");
  assert.deepEqual(readdirSync(join(STATE, "mutex")).filter((f) => f.endsWith(".stale")), [],
    "the file moved aside to compare it was left behind");
  unlinkSync(path);
});

test("the holder's stamp is the moment it entered, not the moment it began to wait", () => {
  const path = mutexPath("stamp-on-entry");
  writeFileSync(path, holderRecord("brief-holder"), "utf8");
  const start = Date.parse("2026-10-26T12:00:00.000Z");
  let clock = start;
  let stamp;
  withMutex("stamp-on-entry", () => {
    stamp = JSON.parse(readFileSync(path, "utf8")).ts;
  }, {
    // The clock advances on every reading, so an implementation that never
    // reaches the hook runs into its deadline and fails instead of spinning.
    env: ENV, waitMs: 1000, now: () => clock++,
    interleave: (step) => {
      if (step !== "contended") return;
      clock += 5000;
      unlinkSync(path);
    },
  });
  assert.ok(Date.parse(stamp) - start >= 5000,
    "the holder was stamped " + stamp + ", before the five seconds it waited");
});

test("a holder older than the stale limit is still taken over", () => {
  const path = mutexPath("really-stale");
  writeFileSync(path, holderRecord("dead-holder", "2000-01-01T00:00:00.000Z"), "utf8");
  let entered = false;
  withMutex("really-stale", () => { entered = true; }, { env: ENV, waitMs: 200 });
  assert.equal(entered, true);
});

test("a record nobody can read is still taken over", () => {
  const path = mutexPath("corrupt");
  writeFileSync(path, "{ not json", "utf8");
  let entered = false;
  withMutex("corrupt", () => { entered = true; }, { env: ENV, waitMs: 200 });
  assert.equal(entered, true);
});
