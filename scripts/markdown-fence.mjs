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
 */

/** A fenced code block's opening or closing line. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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
  let fence = null;
  for (const line of lines) {
    const f = String(line).match(FENCE);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null;
      code.push(true);
      continue;
    }
    if (f) { fence = f[1]; code.push(true); continue; }
    code.push(false);
  }
  return code;
}
