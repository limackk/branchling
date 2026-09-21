/**
 * The viewer's chrome says, word for word, what it is supposed to say (TL-208).
 *
 * WHAT WENT WRONG. The banner across the top of a `file://` page — the first
 * line a non-technical reader sees on a page that was mailed to them — read
 * `Tryb snapshot` for as long as the viewer existed, in a repository whose only
 * language is English. The string carries no diacritics, so the former language
 * detector read it as English and reported the tree clean over it (TL-201).
 *
 * WHY THIS IS NOT A LANGUAGE DETECTOR. That detector was removed under TL-298
 * for the reason it failed here: it enumerated one foreign language's
 * characters, words and word shapes, and a language is not closed by
 * enumeration — a green result said nothing about any other language, and
 * AGENTS.md now states outright that no automated guard decides whether prose
 * is English. Rebuilding it would reproduce the hole this task was filed for.
 *
 * WHAT IS CLOSED BY CONSTRUCTION INSTEAD. The set of strings the viewer's
 * chrome puts in front of a reader is FINITE and lives in one file, so it can
 * be enumerated and asserted verbatim. `SHIPPED_CHROME` below is that
 * enumeration. The claim is not "this text is English" — it is "this text is
 * exactly the text reviewed in English", which a translation, a paraphrase or a
 * deletion all break, whatever language they are in. The enumeration is a
 * sample of the chrome, not all of it; what it costs to extend is one line.
 *
 * WHERE IT LOOKS. The page is one self-contained file whose two data lines
 * carry the whole backlog — including this task, whose title quotes the defect.
 * Auditing the page whole would therefore read the backlog and not the product.
 * `chromeOf()` drops those two lines, and a test below fails if that split ever
 * stops removing anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHtml, readTasks } from "../build-viewer.mjs";
import { BACKLOG_DIR, isolateHome } from "./_repo.mjs";

isolateHome("viewer-ui-language");

/**
 * The reviewed wording of the viewer's chrome: the header tabs and every state
 * of the connection bar, which is the surface this task was filed against.
 * Each entry is the exact substring the built page must contain.
 */
export const SHIPPED_CHROME = [
  { id: "tab-tasks", text: ">Tasks<" },
  { id: "tab-execution", text: ">Execution<" },
  { id: "tab-decisions", text: ">Waiting on you<" },
  { id: "copy-link", text: "⧉ Copy link" },
  { id: "bar-snapshot", text: "Snapshot mode" },
  { id: "bar-snapshot-hint", text: "Data from the moment of the build. Connect to the folder to work on live files and edit statuses." },
  { id: "bar-connect", text: "Connect to the backlog folder" },
  { id: "bar-refresh", text: "Refresh from disk" },
  { id: "bar-disconnect", text: ">Disconnect<" },
  { id: "bar-live-server", text: "Live (local server)" },
  { id: "bar-live-folder", text: "Live (folder connected)" },
  { id: "bar-snapshot-hint-fs", text: "Data from the moment of the build. Connect to the folder to work on live files (editing fields — server mode only)." },
  { id: "toast-disconnected", text: "Disconnected. You are now looking at the snapshot from the build." },
  { id: "bar-no-fs-api", text: "Your browser does not support the File System Access API — use Chrome or Edge for live mode." },
];

/** The page minus the two lines that carry the backlog itself. PURE, so the
 *  positive controls below can drive it with a page of their own. */
export function chromeOf(html) {
  return String(html)
    .split("\n")
    .filter((line) => !line.startsWith("let HISTORY = ") && !line.startsWith("let ALL_TASKS = "))
    .join("\n");
}

/** Which enumerated strings the page no longer says, by id. PURE. */
export function missingChrome(html, expected = SHIPPED_CHROME) {
  const chrome = chromeOf(html);
  return expected.filter((e) => !chrome.includes(e.text)).map((e) => e.id);
}

const PAGE = buildHtml(readTasks(BACKLOG_DIR));

test("the enumeration is large enough to be evidence", () => {
  // Without this the two tests below pass just as well against an empty list.
  assert.ok(SHIPPED_CHROME.length >= 12,
    "the chrome enumeration has shrunk to " + SHIPPED_CHROME.length + " entr(ies)");
  assert.equal(new Set(SHIPPED_CHROME.map((e) => e.id)).size, SHIPPED_CHROME.length);
});

test("the data region is dropped, and dropping it removes the backlog", () => {
  const full = PAGE.length;
  const chrome = chromeOf(PAGE).length;
  assert.ok(chrome > 0, "the page has no chrome left after the split");
  assert.ok(full - chrome > 100_000,
    "the split removed only " + (full - chrome) + " character(s) — the data lines have moved, "
    + "and this file would be auditing the backlog instead of the product");
});

test("every enumerated string is in the built page, verbatim", () => {
  assert.deepEqual(missingChrome(PAGE), [],
    "the viewer's chrome no longer says what was reviewed");
});

test("POSITIVE CONTROL: the banner translated back into Polish IS caught", () => {
  // `Tryb snapshot` is QUOTED here as the defect this task closed, not written
  // as prose: it is what the banner shipped until TL-201, and a control that
  // used an invented word would prove the mechanism against a case that never
  // happened. Any replacement fails the same way — the assertion is on the
  // reviewed wording being present, not on the substitute being foreign.
  assert.deepEqual(missingChrome(PAGE.replaceAll("Snapshot mode", "Tryb snapshot")), ["bar-snapshot"]);
  assert.deepEqual(missingChrome(PAGE.replaceAll("Connect to the backlog folder", "Verbinde den Ordner")), ["bar-connect"]);
  assert.deepEqual(missingChrome(""), SHIPPED_CHROME.map((e) => e.id),
    "a page that says nothing at all must fail every entry");
});

test("POSITIVE CONTROL: a string hidden in the DATA does not count as chrome", () => {
  // This task's own file carries the Polish banner in its title, so the backlog
  // contains the string the page must not say. The split is what keeps one from
  // covering for the other.
  const forged = PAGE.replaceAll("Snapshot mode", "Tryb snapshot")
    + '\nlet ALL_TASKS = [{"title":"Snapshot mode"}];\n';
  assert.deepEqual(missingChrome(forged), ["bar-snapshot"],
    "a task title must not satisfy an assertion about the page's chrome");
});
