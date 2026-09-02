#!/usr/bin/env node
/**
 * How a task's answered questions reach the session that picks it up (TL-148).
 *
 * A MODULE OF ITS OWN, and the reason is mechanical: `decide` writes decisions
 * and `take` prints them, and `decide` already imports `take` for the actor
 * chain. Putting this in either of them would close a cycle between the two.
 * It imports nothing but the field names.
 */
import { FIELD_COMMENT, FIELD_DECISION, openQuestions } from "./task-fields.mjs";

/**
 * The decisions and open questions, rendered INTO the printed task file, right
 * under the frontmatter. PURE (TL-148).
 *
 * WHY IN THE FILE AND NOT ONLY IN THE HISTORY. The session that picks the task
 * up reads the file with none of the conversation that produced it, and an
 * answer it has to go and look for is an answer it will not have. So it is
 * placed where the reader starts, above the body.
 *
 * WHY AT PRINT TIME AND NOT ON DISK. The file is the truth about the TASK; the
 * answers are the truth about its history, and copying them in would be a second
 * home for something the log already holds (law 2). Nothing here writes.
 *
 * @param {string} text the task file
 * @param {object[]} entries its history
 */
export function withDecisions(text, entries) {
  const answered = new Map();
  for (const e of entries || []) {
    if (e && e.field === FIELD_DECISION && typeof e.resolves === "string" && e.resolves) answered.set(e.resolves, e);
  }
  const open = openQuestions(entries);
  const pairs = (entries || []).filter((e) => e && e.field === FIELD_COMMENT && answered.has(e.id));
  if (!pairs.length && !open.length) return text;

  const block = ["", "## Decisions and open questions", ""];
  for (const q of pairs) {
    const a = answered.get(q.id);
    block.push("- **Q** (" + q.actor + "): " + q.to);
    block.push("  **A** (" + a.actor + "): " + a.to);
  }
  for (const q of open) {
    block.push("- **Q** (" + q.actor + ", unanswered — `" + q.id + "`): " + q.to);
  }
  block.push("");
  block.push("_Written from the history at print time; it is not in the file on disk._");

  // After the CLOSING `---` of the frontmatter, which is the second one. A task
  // with no frontmatter gets the block at the top, which is still above the body.
  const m = String(text).match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!m) return block.join("\n") + "\n" + text;
  return text.slice(0, m[0].length) + block.join("\n") + "\n" + text.slice(m[0].length);
}
