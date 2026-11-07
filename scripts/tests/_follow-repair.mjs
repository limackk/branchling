/**
 * Do literally what a printed repair for an unclosed hook block says (TL-609).
 *
 * ONE COPY FOR BOTH COMMANDS. `hooks install` and `doctor` print the span from
 * the same function, and the tests that follow it must read it the same way;
 * two copies of this reader could drift into accepting a span one command no
 * longer prints.
 *
 * The span is `lines A–B` or `line A`, 1-based and inclusive, followed by the
 * quoted marker; it is replaced by `block`, every other line kept byte for byte.
 */
import assert from "node:assert/strict";

export function followRepair(text, advice, block) {
  const m = /\blines? (\d+)(?:–(\d+))? \(`/.exec(advice);
  assert.ok(m, "the repair names a line span: " + advice);
  const first = Number(m[1]);
  const last = Number(m[2] || m[1]);
  const lines = text.split("\n");
  lines.splice(first - 1, last - first + 1, ...block.split("\n"));
  return lines.join("\n");
}
