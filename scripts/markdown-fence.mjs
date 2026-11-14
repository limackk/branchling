/**
 * Which lines of a markdown text are code inside a fenced block (TL-669).
 *
 * One rule, three readers: `demoteHeadings()` in `import-body.mjs` must not
 * shift a heading-shaped line that is code, and `parseCriteria()` in
 * `criteria.mjs` must not take one for the criteria section or for the
 * heading that ends it, nor take a fenced `- [ ]` for a criterion (TL-709).
 * Written once so the readers cannot disagree about where a block ends — a
 * body the importer left alone as code would otherwise be read by the parser
 * as a contract. `auditText()` in
 * `check-no-foreign-context.mjs` reads by it too (TL-708): a measurement inside
 * a block is the command that reproduces it, so the guard has to end a block
 * where the others do.
 *
 * The rule is CommonMark's: an opening line is up to three spaces, then three
 * or more backticks or tildes; the block closes on a line of the SAME
 * character, at no shorter length, with nothing but whitespace after it. A
 * block left open runs to the end of the text, as CommonMark reads it.
 *
 * Those three spaces are counted from the CONTENT COLUMN of the innermost
 * open list item, not from column 0 (TL-728): in `  - step` the content
 * starts at column 4, so a fence indented four to seven spaces below it is a
 * fence, while the same line with no list item around it is an indented
 * paragraph or code block, not a fence. A non-blank line indented less than
 * the item's content column ends the item, and with it any block opened
 * inside it. Lazy continuation lines and block quotes are not tracked: a
 * lazy line ends the item here, which can only make a later fence read as
 * prose, the behaviour before this rule existed.
 */

/** A fence run: three or more backticks or tildes, at the start of a string. */
const FENCE_RUN = /^(`{3,}|~{3,})/;

/**
 * A list item's opening line: its indentation, its marker, the spaces after
 * the marker and its first content. Content is optional — an item may start
 * empty.
 */
const LIST_ITEM = /^( *)([-+*]|\d{1,9}[.)])( +|$)(.*)/;

/** The number of leading spaces of a line. */
export function indentOf(line) {
  return line.length - line.replace(/^ +/, "").length;
}

/**
 * The column a list item's content starts at. CommonMark: one to four spaces
 * after the marker belong to it; five or more, or none before an empty line,
 * mean the content column is the marker plus one space.
 *
 * Exported for `parseCriteria()` (TL-733), which needs the same column to
 * decide where a criterion's continuation text starts.
 */
export function contentColumn(indent, marker, spaces, rest) {
  const width = indent + marker.length;
  if (!rest || spaces.length > 4) return width + 1;
  return width + spaces.length;
}

/**
 * One flag per line: true for a fence line and for every line between an
 * opening fence and its closing one.
 *
 * @param {string[]} lines the text already split into lines, so the indices
 *        match whatever the caller writes back by line number
 * @returns {boolean[]}
 */
export function fencedLines(lines) {
  const code = [];
  // Content columns of the open list items, innermost last.
  const items = [];
  // The open block: its fence run and the content column it was opened in.
  let fence = null;
  for (const raw of lines) {
    const line = String(raw);
    const blank = !line.trim();
    const indent = indentOf(line);
    if (!blank) while (items.length && indent < items[items.length - 1]) items.pop();
    const base = items.length ? items[items.length - 1] : 0;
    if (fence && !blank && base < fence.base) fence = null;
    if (fence) {
      const f = indent - base <= 3 ? line.slice(indent).match(FENCE_RUN) : null;
      if (f && f[1][0] === fence.run[0] && f[1].length >= fence.run.length && !line.slice(indent + f[0].length).trim()) fence = null;
      code.push(true);
      continue;
    }
    if (blank || indent - base > 3) { code.push(false); continue; }
    // A fence may open on a list item's own line, as in `- ```js`, so the
    // fence is looked for where the item's content starts.
    const item = line.match(LIST_ITEM);
    const start = item ? contentColumn(indent, item[2], item[3], item[4]) : indent;
    if (item) items.push(start);
    const f = line.slice(start).match(FENCE_RUN);
    if (f) { fence = { run: f[1], base: item ? start : base }; code.push(true); continue; }
    code.push(false);
  }
  return code;
}
