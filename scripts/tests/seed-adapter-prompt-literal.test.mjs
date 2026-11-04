/**
 * The seed adapter prompt carries the spec and the rejection reasons literally
 * (TL-531).
 *
 * `renderPrompt()` used to fill its template with replacement STRINGS, so
 * every JavaScript replacement token in caller text was expanded instead of
 * copied: `$&` became the placeholder, `` $` `` and `$'` spliced template text
 * into the spec, `$$` lost a dollar sign. A spec that quotes a shell command
 * carries exactly these, and nothing reported the damage.
 *
 * The template here is a fixture, not the shipped `templates/seed-plan.md`:
 * the assertion is about substitution, and the shipped wording is free to
 * change.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isolateHome } from "./_repo.mjs";
import { renderPrompt } from "../seed-adapter.mjs";

isolateHome("seed-adapter-prompt-literal");

const TEMPLATE = [
  "Documentation for the editor, dropped.",
  "---",
  "BEFORE",
  "{{spec}}",
  "MIDDLE",
  "{{errors}}",
  "AFTER",
].join("\n");

// Every special pattern String.prototype.replace recognises in a replacement
// string, plus a named-group form and a dollar sign at the very end.
const TOKENS = ["$&", "$'", "$`", "$$", "$1", "$01", "$<name>", "trailing $"];

test("positive control: the fixture template substitutes plain text", () => {
  // Without this, a renderPrompt that ignored its placeholders entirely would
  // fail the literal checks below only by accident of the assertion shape.
  const out = renderPrompt(TEMPLATE, { spec: "plain spec", errors: ["plain error"] });
  assert.match(out, /BEFORE\nplain spec\nMIDDLE\n/);
  assert.match(out, /\n- plain error\nAFTER\n$/);
  assert.doesNotMatch(out, /\{\{(spec|errors)\}\}/);
  assert.doesNotMatch(out, /Documentation for the editor/);
});

for (const token of TOKENS) {
  test(`the spec carries ${JSON.stringify(token)} literally`, () => {
    const spec = `run: echo "a${token}b" && cost=${token}5`;
    const out = renderPrompt(TEMPLATE, { spec, errors: [] });
    assert.ok(
      out.includes(`BEFORE\n${spec}\nMIDDLE`),
      `the spec was altered on its way into the prompt:\n${out}`,
    );
  });

  test(`a rejection reason carries ${JSON.stringify(token)} literally`, () => {
    const reason = `field "x${token}y" is not allowed`;
    const out = renderPrompt(TEMPLATE, { spec: "s", errors: [reason] });
    assert.ok(
      out.includes(`\n- ${reason}\nAFTER`),
      `the rejection reason was altered on its way into the prompt:\n${out}`,
    );
  });
}

test("a placeholder written inside the spec is not substituted a second time", () => {
  const spec = "the template uses {{errors}} and {{spec}} as placeholders";
  const out = renderPrompt(TEMPLATE, { spec, errors: ["rejected"] });
  assert.ok(out.includes(`BEFORE\n${spec}\nMIDDLE`), out);
});
