/**
 * The language guard actually fails (TL-32).
 *
 * WHY THIS FILE EXISTS. A guard that cannot say "no" is a warning, and this one
 * is easy to get wrong in exactly that direction: widen the allow marker a
 * little, or read the wrong tree, and it goes green over everything for ever.
 * So the first assertions here are NEGATIVE CONTROLS — text that MUST be
 * flagged — and only then comes the assertion that the real tree is clean.
 *
 * The second half of the contract matters as much: the guard must not flag
 * ordinary English. A detector that cries on every second line gets switched
 * off, and then it protects nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOW_MARKER, PUBLIC_PATHS, auditText, auditTree } from "../check-public-language.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// ── Negative controls: it has to say "no" ─────────────────────────────────

test("a line with accented letters is flagged", () => {
  const found = auditText('console.log("zapisano zmianę");');   // language-guard: allow
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "diacritics");
});

test("a line with no accents but Polish words is flagged", () => {
  // This is the half a diacritics grep misses, and the reason the guard has two
  // signals rather than one.
  const found = auditText("// plik nie jest widokiem");   // language-guard: allow
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "words");
});

test("ONE unmistakable word is enough — that is how short UI labels get caught", () => {
  // The signal added after the first translation left one-word labels behind in
  // the viewer: no accent, one word, nothing for the other two signals to see.
  const found = auditText('{ label: "otwarte", color: "var(--accent)" },');   // language-guard: allow
  assert.equal(found.length, 1);
  assert.equal(found[0].reason, "word");
});

test("a strong word does not need a whole Polish sentence around it", () => {
  assert.equal(auditText('<button>Zapisz</button>').length, 1);   // language-guard: allow
});

test("one stop word alone is NOT enough — the threshold keeps the guard usable", () => {
  // `jak` on its own turns up inside identifiers and URLs. A guard that fires on
  // one hit gets switched off, and then it protects nothing.
  assert.deepEqual(auditText("const jak = 1;"), []);
});

// ── It must not flag ordinary English ─────────────────────────────────────

test("ordinary English prose passes", () => {
  const english = [
    "// The views are generated from tasks/*.md and are not versioned.",
    'console.error("unknown flag: " + a);',
    " * An unknown key fails the build, because a typo in a vocabulary is",
    " * indistinguishable from a deliberate value.",
  ].join("\n");
  assert.deepEqual(auditText(english), []);
});

// ── The allow marker ──────────────────────────────────────────────────────

test("the marker on the same line clears that line", () => {
  assert.deepEqual(auditText('const D = { ą: "a" };   // ' + ALLOW_MARKER), []);   // language-guard: allow
});

test("the marker on the line above clears the line below it", () => {
  // For lines that cannot carry a trailing comment — inside a template literal,
  // or in markdown.
  assert.deepEqual(auditText("// " + ALLOW_MARKER + "\nZażółć gęślą jaźń"), []);   // language-guard: allow
});

test("the marker does NOT clear the whole file", () => {
  // The exception is per line on purpose. A file-wide marker would be a hole
  // somebody opens once and nobody closes.
  const text = ["// " + ALLOW_MARKER, "a", "b", "// plik nie jest widokiem"].join("\n");   // language-guard: allow
  assert.equal(auditText(text).length, 1);
});

// ── The real tree ─────────────────────────────────────────────────────────

test("the public surface of this repository is English", () => {
  const { findings, filesChecked, linesChecked } = auditTree(ROOT);
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} ${f.text.slice(0, 80)}`),
    [],
    "the public surface carries text that does not read as English"
  );
  // A positive control on the measurement itself: a ✓ over zero files would mean
  // the walk read the wrong tree, not that the surface is clean.
  assert.ok(filesChecked > 20, "the walk found only " + filesChecked + " public files — wrong tree?");
  assert.ok(linesChecked > 1000, "the walk read only " + linesChecked + " lines — wrong tree?");
});

test("the guard covers the files that actually ship", () => {
  // The point is not the list itself but that the two things it has to cover —
  // the code a user runs and the two markdown files in the tarball — are on it.
  for (const entry of ["scripts", "bin", "README.md", "_template.md"]) {
    assert.ok(PUBLIC_PATHS.includes(entry), entry + " dropped out of the guard's scope");
  }
});

test("the command exits 0 on a clean tree and prints what it read", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-public-language.mjs")], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\d+ lines across \d+ public files/, "a clean run says nothing about its sample size");
});
