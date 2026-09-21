/**
 * An OPEN task names the tool that ships; an archived one names the tool of its
 * own day (TL-395).
 *
 * WHAT WAS FOUND. The product name comes from `scripts/product.mjs` and
 * `check --product-name` keeps it there — over `scripts/` and `bin/` only.
 * `backlog/` was never inside that boundary, so 138 task files still called the
 * tool `worktrail`, a name TL-20 retired on 2026-09-03, and a handful still
 * called it `tasklog`, retired two days before that. An open task saying
 * `worktrail done` is an instruction that fails.
 *
 * WHY ONLY THE OPEN ONES. An archived task is a closed record. The decision and
 * the reason for it are in `LINEAGE.md` and in `backlog/history/TL-395.jsonl`;
 * the short version is that translating a sentence preserves its claim and
 * renaming the tool inside it does not.
 *
 * WHY THE NAMES ARE LITERALS HERE. They cannot come from `product.mjs`, which
 * knows only the name that ships. `scripts/tests/` is deliberately outside
 * `check --product-name` (see its SKIP_DIRS comment) precisely so a guard about
 * naming may spell names out. The test asserts `LINEAGE.md` explains each one,
 * so the list and the paragraph a reader needs cannot drift apart.
 *
 * THE POSITIVE CONTROL IS THE POINT. Every assertion here is of the form
 * "nothing is wrong", which is what passes on an empty sample, so the scan is a
 * pure function fed text that IS wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { BACKLOG_DIR, REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("former-name");

/** Names this tool has had and no longer answers to. */
export const FORMER_NAMES = ["worktrail", "tasklog"];

/** A deliberate occurrence, declared beside the reason for it. */
export const ALLOW_MARKER = "former-name: allow";

/**
 * PURE — the 1-indexed lines of `text` that name a retired tool without saying so.
 *
 * THE MARKER SITS ON THE LINE. That is the house rule, the same one `renumber:
 * allow` and `product-name: allow` follow: the exception is the author's
 * declaration about one sentence, not a licence over a file.
 *
 * ONE SHAPE CANNOT CARRY IT — an indented transcript, where an HTML comment
 * would print as part of the output it claims to quote. There the marker stands
 * on its own line above the block and covers it, the block being the indented
 * and blank lines that follow. Nothing else extends a marker past its own line.
 */
export function unmarkedFormerNames(text, names = FORMER_NAMES) {
  const lines = text.split("\n");
  const found = [];
  let blockAllowed = false;
  for (const [i, line] of lines.entries()) {
    const markerOnly = line.trim().startsWith("<!--") && line.includes(ALLOW_MARKER);
    if (markerOnly && !names.some((n) => line.replace(/<!--.*?-->/g, "").includes(n))) {
      blockAllowed = true;
      continue;
    }
    if (blockAllowed && !(line.trim() === "" || line.startsWith("    "))) blockAllowed = false;
    if (line.includes(ALLOW_MARKER) || blockAllowed) continue;
    if (names.some((n) => line.includes(n))) found.push({ line: i + 1, text: line.trim() });
  }
  return found;
}

/** The statuses that mean somebody may still be handed this task. */
const OPEN_STATUSES = ["pending", "in_progress", "blocked", "awaiting_vouch"];

/**
 * PURE — the frontmatter status, read from the FIRST `---` block and nowhere
 * else. TL-69 quotes `status: pending` inside a transcript of a real run, and a
 * multiline `^status:` match reads that line as the file's own: a closed task
 * would then be held to the open-task rule and its transcript rewritten.
 */
export function frontmatterStatus(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---/);
  return block ? (block[1].match(/^status:\s*(\S+)/m)?.[1] ?? null) : null;
}

/** The task files whose status is one a reader may still be handed. */
function openTaskFiles() {
  const dir = join(BACKLOG_DIR, "tasks");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "_template.md")
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }))
    .filter((t) => OPEN_STATUSES.includes(frontmatterStatus(t.text)));
}

test("no open task tells anybody to run a command that no longer exists", () => {
  const files = openTaskFiles();
  assert.ok(files.length > 10, "only " + files.length + " open tasks found — the scan is looking in the wrong place");
  const offences = [];
  for (const { name, text } of files) {
    for (const hit of unmarkedFormerNames(text)) offences.push(name + ":" + hit.line + "  " + hit.text);
  }
  assert.deepEqual(offences, [],
    "these open tasks name a retired tool — rewrite the line, or declare it with `" + ALLOW_MARKER + "`");
});

test("POSITIVE CONTROL: the scan catches what it is looking for", () => {
  // Without this, "nothing is wrong" would be just as true of a scan that can
  // never fire.
  const text = [
    "Run `worktrail done` to close it.",
    "TL-169 established what `github.com/worktrail` is.  <!-- former-name: allow -->",
    "",
    "    <!-- former-name: allow -->",
    "",
    "    $ ps | grep tasklog",
    "      9175  still running",
    "",
    "and then `tasklog new` writes the file.",
  ].join("\n");
  assert.deepEqual(unmarkedFormerNames(text).map((h) => h.line), [1, 9]);
});

test("POSITIVE CONTROL: a transcript does not decide the file's status", () => {
  // TL-69 is closed and quotes `status: pending` inside a measured transcript.
  // Reading the frontmatter loosely put it in the open set and asked for its
  // record to be rewritten.
  const text = "---\nid: TL-69\nstatus: done\n---\n\n```\nstatus: pending\n```\n";
  assert.equal(frontmatterStatus(text), "done");
  assert.equal(frontmatterStatus("no frontmatter here"), null);
});

test("LINEAGE.md explains every name this guard knows about", () => {
  // The list above is only useful to a reader who is told what those names were.
  const lineage = readFileSync(join(REPO_ROOT, "LINEAGE.md"), "utf8");
  for (const name of FORMER_NAMES) {
    assert.ok(lineage.includes(name), "LINEAGE.md never mentions `" + name + "`, so nothing tells a reader what it was");
  }
});
