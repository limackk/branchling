/**
 * A task reservation is removed only when it is the file judged expired
 * (TL-487).
 *
 * `acquireLock` used to read an ABSENT reservation as an expired one and
 * unlink whatever stood under the name by the time the removal ran — by then,
 * possibly another session's fresh reservation, so two sessions held the same
 * task. Sixteen processes taking and releasing one id measured 15 to 19
 * overlaps in 6400 attempts. It is the shape TL-481 closed in `withMutex`, and
 * the same identity rule applies: inode AND bytes, because Linux reuses a freed
 * inode number at once (TL-494).
 *
 * Timing does not reproduce this on demand, so these tests force each
 * interleaving through the `interleave` seam of `acquireLock`. The last two
 * tests are the positive control — an expired reservation, or one nobody can
 * read, is still taken over; a guard that refused every takeover would pass
 * the others and leave a killed session's task out of the queue for good.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { acquireLock } from "../lock.mjs";
import { isolateHome, isolateState } from "./_repo.mjs";

isolateHome("lock-takeover");
const STATE = isolateState("lock-takeover");
const ENV = { BACKLOG_STATE_DIR: STATE };
// A fixed scope keeps git out of the test: the key is all `acquireLock` needs.
const SCOPE = { origin: "/lock-takeover", key: "locktakeover0000" };
const DIR = join(STATE, "locks", SCOPE.key);
const ROOT = "/lock-takeover/backlog";
const TTL = 60;

function seed(taskId, content) {
  mkdirSync(DIR, { recursive: true });
  const path = join(DIR, taskId + ".lock");
  writeFileSync(path, content, "utf8");
  return path;
}

function reservation(taskId, actor, ts = new Date().toISOString()) {
  return JSON.stringify({ task: taskId, actor, pid: 1, host: "elsewhere", tree: "/other", ts }) + "\n";
}

const EXPIRED = "2000-01-01T00:00:00.000Z";

function take(taskId, interleave) {
  return acquireLock({ root: ROOT, taskId, actor: "agent:contender", ttlMinutes: TTL, env: ENV, scope: SCOPE, interleave });
}

const strays = () => readdirSync(DIR).filter((f) => f.endsWith(".stale") || f.endsWith(".tmp"));

test("a reservation released and re-taken before the read is not removed", () => {
  const path = seed("T-1", reservation("T-1", "agent:first"));
  const steps = [];
  const result = take("T-1", (step) => {
    steps.push(step);
    if (steps.length !== 1) return;
    // The first holder releases; a third session takes the task before this
    // contender reads the name again.
    unlinkSync(path);
    writeFileSync(path, reservation("T-1", "agent:third"), "utf8");
  });
  assert.equal(steps[0], "contended", "the forced interleaving did not happen");
  assert.equal(result.ok, false, "the contender took a task the third session holds");
  assert.equal(result.holder.actor, "agent:third");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).actor, "agent:third");
  unlinkSync(path);
});

test("a reservation absent at the read is never judged expired", () => {
  const path = seed("T-2", reservation("T-2", "agent:first"));
  const steps = [];
  const result = take("T-2", (step) => {
    steps.push(step);
    // Released between the failed create and the read: the read finds nothing.
    if (steps.length === 1) unlinkSync(path);
  });
  assert.equal(steps[0], "contended", "the forced interleaving did not happen");
  assert.ok(!steps.includes("judged-expired"),
    "an absent reservation was judged expired, so a removal would have run against whatever replaced it");
  assert.equal(result.ok, true);
  assert.equal(result.lock.tookOver, undefined, "a released reservation was reported as taken over");
  unlinkSync(path);
});

test("an expired reservation replaced by a fresh one before its removal keeps the fresh one", () => {
  const path = seed("T-3", reservation("T-3", "agent:dead", EXPIRED));
  let judged = false;
  const result = take("T-3", (step) => {
    if (step !== "judged-expired" || judged) return;
    judged = true;
    // Another session settles the expired reservation first and takes the task.
    unlinkSync(path);
    writeFileSync(path, reservation("T-3", "agent:live"), "utf8");
  });
  assert.equal(judged, true, "the expired reservation was never judged expired");
  assert.equal(result.ok, false, "the contender removed a live session's reservation and took the task");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).actor, "agent:live");
  assert.deepEqual(strays(), [], "the file moved aside to compare it was left behind");
  unlinkSync(path);
});

test("a fresh reservation that reuses the expired file's inode is kept (TL-494)", () => {
  const path = seed("T-4", reservation("T-4", "agent:dead", EXPIRED));
  let judged = false;
  const result = take("T-4", (step) => {
    if (step !== "judged-expired" || judged) return;
    judged = true;
    // Rewriting in place keeps the inode, which is what Linux hands a file
    // created right after the expired one was unlinked: same `(dev, ino)`, a
    // different holder.
    writeFileSync(path, reservation("T-4", "agent:live"), "utf8");
  });
  assert.equal(judged, true, "the expired reservation was never judged expired");
  assert.equal(result.ok, false, "the contender removed a live session's reservation and took the task");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).actor, "agent:live");
  assert.deepEqual(strays(), []);
  unlinkSync(path);
});

test("an expired reservation is still taken over", () => {
  const path = seed("T-5", reservation("T-5", "agent:dead", EXPIRED));
  const result = take("T-5");
  assert.equal(result.ok, true);
  assert.equal(result.lock.actor, "agent:contender");
  assert.equal(result.lock.tookOver.actor, "agent:dead");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).actor, "agent:contender");
  assert.deepEqual(strays(), []);
  unlinkSync(path);
});

test("a reservation nobody can read is still taken over", () => {
  const path = seed("T-6", "{ not json");
  const result = take("T-6");
  assert.equal(result.ok, true);
  assert.equal(result.lock.tookOver, null);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).actor, "agent:contender");
  unlinkSync(path);
});
