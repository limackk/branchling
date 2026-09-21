/**
 * Nothing the viewer writes into a stranger's browser is named after the
 * project this tool was extracted from (TL-178).
 *
 * WHY THESE KEYS ARE DIFFERENT FROM PROSE. TL-37 cleared the originating
 * project's name out of the documents; six keys survived that pass because they
 * are not prose — they are ON-DISK KEYS in browsers nobody can reach. Renaming
 * one does not move the value it identifies, it abandons it: a stored board
 * selection, an actor, two chart ranges, an IndexedDB database and the directory
 * permission behind a `showDirectoryPicker` id.
 *
 * WHAT THIS FILE HAS TO RULE OUT.
 *   1. A KEY WRITTEN OUT AS A LITERAL. One prefix, from one frozen constant, or
 *      the next key added drifts on its own — and the guard is on the SOURCE,
 *      because a literal that happens to spell the right word today is still a
 *      second place the name lives.
 *   2. THE PREFIX FOLLOWING THE DISPLAY NAME. It must come from
 *      `STORAGE_KEY_PREFIX`, which is frozen for the reason `BLOCK_MARKER_NAME`
 *      is: a rename of the product must not orphan data already stored.
 *   3. THE BUILT PAGE STILL CARRYING THE OLD NAME IN ITS CODE. Asserted on the
 *      page's code region, since the DATA region legitimately contains task
 *      text and filenames that mention it — that is the backlog, which is where
 *      the record of this decision lives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { auditText } from "../check-no-foreign-context.mjs";
import { STORAGE_KEY_PREFIX } from "../product.mjs";
import { buildHtml, readTasks } from "../build-viewer.mjs";
import { BACKLOG_DIR, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-storage-keys");

const VIEWER_SOURCE = readFileSync(join(SCRIPTS_DIR, "build-viewer.mjs"), "utf8");

/** Every place the page reaches for browser storage with a STRING instead of a
 *  constant. PURE, so the positive control can drive it. */
export function literalStorageKeys(source) {
  const patterns = [
    /localStorage\.(?:get|set|remove)Item\(\s*["'`]/g,
    /sessionStorage\.(?:get|set|remove)Item\(\s*["'`]/g,
    /indexedDB\.open\(\s*["'`]/g,
    /showDirectoryPicker\(\s*\{[^}]*id:\s*["'`]/g,
  ];
  const found = [];
  for (const re of patterns) {
    for (const m of String(source).matchAll(re)) found.push(m[0]);
  }
  return found;
}

test("no browser storage key is written out as a literal", () => {
  assert.deepEqual(literalStorageKeys(VIEWER_SOURCE), [],
    "a key spelled out here is a second place the name lives, and the next one added drifts alone");
});

test("POSITIVE CONTROL: a literal key IS caught", () => {
  // Without this the check above passes just as well against a pattern that
  // never matches — which is what a storage-key guard would look like if the
  // call it looks for were ever renamed.
  assert.deepEqual(literalStorageKeys('localStorage.setItem("acme-board", x);'),
    ['localStorage.setItem("']);
  assert.deepEqual(literalStorageKeys('indexedDB.open("acme-viewer", 1);'), ['indexedDB.open("']);
  assert.deepEqual(literalStorageKeys('const k = PREFIX + "-board";'), []);
});

test("the prefix is the FROZEN constant, not the display name", () => {
  assert.equal(STORAGE_KEY_PREFIX, "branchling");
  assert.match(VIEWER_SOURCE, /STORAGE_KEY_PREFIX \+ "-backlog"/,
    "the page's prefix must be derived from the frozen constant in product.mjs");
});

test("the built page declares one prefix, and every key hangs off it", () => {
  const html = buildHtml(readTasks(BACKLOG_DIR));
  const declared = /const STORAGE_PREFIX = "([^"]+)";/.exec(html);
  assert.ok(declared, "the page declares no storage prefix at all");
  assert.equal(declared[1], STORAGE_KEY_PREFIX + "-backlog");
  // THE LIST IS THE SAMPLE, THE RULE IS THE NAMESPACE. `-actor`, `-dash-range`
  // and `-dash-burn` left with the editor and the dashboard (TL-379); keeping
  // them here would have this test insist on a key for a feature that no longer
  // exists. What may not shrink is the rule, so the keys still in the page are
  // read out of it and every one of them is held to the prefix — a page that
  // stopped using storage altogether fails on the count, not silently.
  const keys = [...html.matchAll(/STORAGE_PREFIX \+ ["'](-[a-z-]+)["']/g)].map((m) => m[1]);
  assert.ok(keys.length >= 2, "the page declares " + keys.length + " storage key(s) — too few to be proving a namespace");
  assert.ok(keys.includes("-board"), "the board scope no longer remembers itself");
  const bare = /localStorage\.(?:get|set|remove)Item\(\s*["']/.exec(html);
  assert.equal(bare, null, "a storage key is written as a literal, outside the prefix");
});

test("the page's CODE carries no forbidden word; its DATA is the backlog and may", () => {
  const html = buildHtml(readTasks(BACKLOG_DIR));
  // The data blobs start where the backlog is injected — `HISTORY` comes first,
  // then `ALL_TASKS`. Everything before the EARLIER of the two is the page's own
  // source, and that is what this rule is about. Splitting at the later one
  // would put a whole change log inside the "code" region and audit the backlog
  // by accident.
  const cut = Math.min(...["let HISTORY", "let ALL_TASKS"].map((k) => html.indexOf(k)).filter((i) => i > 0));
  assert.ok(cut > 0 && Number.isFinite(cut),
    "the page's data region was not found — the split this test rests on has moved");
  const code = html.slice(0, cut);
  // The word is SYNTHETIC on purpose. This asserts the MECHANISM — that a
  // storage key carrying a foreign name is caught — and a test that had to
  // spell the real name would put it back into the tree the guard protects.
  assert.deepEqual(auditText(code, ["acme", "sync-layer"]).map((p) => p.reason), []);
  assert.deepEqual(auditText('const K = "acme-backlog-board";', ["acme"]).map((p) => p.reason), ["word:acme"],
    "POSITIVE CONTROL: the same check must fire on a key shaped like the one this task removed");
});

test("no state is silently carried over, and that is the decision", () => {
  // A migration would have to read the OLD key, which means shipping the old
  // name in the page — the exact thing this task removes. So the state is not
  // migrated, the loss is one board selection, one actor and two chart ranges
  // per browser, and there is no fallback in the source pretending otherwise.
  assert.doesNotMatch(VIEWER_SOURCE, /"[A-Za-z0-9_-]+-backlog-(?:board|actor|range)"/,
    "a migration fallback would put an old storage key back into every published page");
});
