/**
 * The body of an imported task, shared by every `import` source (TL-581).
 * A source supplies its own marker line and any notes about what it read and
 * did not map; the rest — what was left behind, and why the contract is empty
 * — is the same promise whichever tracker the task came from.
 */

/** The level a task's own sections are written at. Every reader of a section
 *  (`parseCriteria`, `resume`, the `## Log` guard) looks at this level and no
 *  other, so imported text must never reach it. */
const SECTION_LEVEL = 2;

/** An ATX heading as CommonMark reads it: up to three spaces, one to six `#`,
 *  then whitespace or the end of the line. Seven `#` is a paragraph. */
const ATX_HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;

/** A fenced code block's opening or closing line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Every heading of an imported description, moved below the task's own
 * sections (TL-640).
 *
 * Without this a ticket's `## Acceptance criteria` became the task's criteria
 * section, and its `## Notes` a second Notes beside the importer's. The text is
 * shifted rather than fenced so it stays readable markdown, and shifted as a
 * WHOLE — by however much its shallowest heading needs — so the source's own
 * hierarchy survives: an issue form's `###` headings are already deep enough
 * and do not move. Below level six nothing exists, so a heading pushed past it
 * stays at six.
 *
 * A line inside a fenced code block is code, not a heading, and is left as it
 * was written.
 */
export function demoteHeadings(text) {
  const lines = String(text || "").split("\n");
  const headings = [];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      return;
    }
    if (f) { fence = f[1]; return; }
    const h = line.match(ATX_HEADING);
    if (h) headings.push({ i, indent: h[1], level: h[2].length });
  });
  if (!headings.length) return lines.join("\n");
  const shift = Math.max(0, SECTION_LEVEL + 1 - Math.min(...headings.map((h) => h.level)));
  for (const { i, indent, level } of headings) {
    lines[i] = indent + "#".repeat(Math.min(6, level + shift)) + lines[i].slice(indent.length + level);
  }
  return lines.join("\n");
}

/**
 * The body every source writes. The issue's own text goes in whole; what did
 * NOT come over is named out loud, because a reader who cannot see the omission
 * assumes there was nothing to omit. `notes` are a source's own lines about
 * what it read and did not map.
 */
export function renderImportedBody({ marker, text, url, notes = [] }) {
  const description = demoteHeadings((text || "").trim());
  return [
    "## Goal",
    "",
    description || "The source issue had no description.",
    "",
    "## Notes",
    "",
    marker + url,
    "",
    "Comments, attachments and status history were NOT brought over — they are the",
    "conversation around the task, not the task. They stay at the link above.",
    "",
    ...notes.flatMap((n) => [n, ""]),
    "This task has no `verification:` yet, so it cannot be closed. No tracker has",
    "that field; it is written by whoever picks the task up.",
    "",
  ].join("\n");
}
