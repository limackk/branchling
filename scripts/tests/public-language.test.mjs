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
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOW_MARKER, PUBLIC_PATHS, auditText, auditTree, labelHits, polishShapeHits, stripDataSpans } from "../check-public-language.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("public-language");

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

test("the guard covers the files that actually ship, plus the backlog and docs (TL-137)", () => {
  // The point is not the list itself but that the code a user runs, the two
  // markdown files in the tarball, and (since TL-137) this project's own
  // backlog and architecture docs are all on it.
  for (const entry of ["scripts", "bin", "README.md", "_template.md", "backlog", "docs"]) {
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

// ── Data spans: a task's own filename is not prose (TL-137) ──────────────

test("a Polish filename inside a markdown link's target is not flagged", () => {
  // TL-137 deliberately did not rename any file, so every cross-reference
  // between tasks carries a Polish slug in its link target forever. The link
  // TEXT is still checked — only the `(...)` target is exempt.
  const line =
    "See [TL-97](../backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md) for the field.";
  assert.deepEqual(auditText(line), []);
});

test("a Polish filename inside an inline code span is not flagged", () => {
  const line = "Referenced as `backlog/tasks/TL-97-pole-role-taska-wymog-roli-ze-slownika-konfiguracji.md`.";
  assert.deepEqual(auditText(line), []);
});

test("the link TEXT is still checked even though the target is exempt", () => {
  // Stripping the `(...)` target must not accidentally swallow prose that
  // sits outside it on the same line.
  const found = auditText("Zobacz [ten task](TL-97-pole-role-taska.md) dla szczegółów.");   // language-guard: allow
  assert.ok(found.length >= 1, "Polish prose next to an exempt link target should still be caught");
});

test("Polish prose is still caught even on a line that also has a code span", () => {
  const found = auditText("// plik nie jest widokiem, patrz `config.yaml`");   // language-guard: allow
  assert.equal(found.length, 1);
});

// ── Positive control: a planted Polish task file MUST be reported ────────

test("a Polish task file under backlog/tasks/ in the real PUBLIC_PATHS shape is caught", () => {
  // A guard that passes on an empty sample is green with no evidentiary
  // force (CLAUDE.md). This plants a fixture in a throwaway root that has
  // the same shape auditTree() walks — a `backlog/tasks/*.md` file — and
  // asserts the walk actually finds and flags it.
  const dir = mkdtempSync(join(tmpdir(), "worktrail-lang-guard-"));
  try {
    mkdirSync(join(dir, "backlog", "tasks"), { recursive: true });
    writeFileSync(
      join(dir, "backlog", "tasks", "TL-9999-fixture.md"),
      // language-guard: allow — deliberately Polish, the fixture this positive control plants
      "---\nid: TL-9999\ntitle: \"Fixture\"\n---\n\n## Context\n\nTen plik nie jest przetłumaczony na angielski.\n"
    );
    const { findings } = auditTree(dir);
    assert.ok(
      findings.some((f) => f.file.includes("TL-9999-fixture.md")),
      "a planted Polish task file under backlog/tasks/ was not caught — the guard is not actually watching that directory"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a Polish doc file under docs/ in the real PUBLIC_PATHS shape is caught", () => {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-lang-guard-"));
  try {
    mkdirSync(join(dir, "docs"), { recursive: true });
    // language-guard: allow — deliberately Polish, the fixture this positive control plants
    writeFileSync(join(dir, "docs", "fixture.md"), "# Fikstura\n\nTen plik nie jest przetłumaczony.\n");
    const { findings } = auditTree(dir);
    assert.ok(
      findings.some((f) => f.file.includes("fixture.md")),
      "a planted Polish doc file under docs/ was not caught — the guard is not actually watching that directory"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backlog/history/*.jsonl stays invisible to the guard even once backlog/ is covered", () => {
  // The append-only log is protected by file EXTENSION (walk() only collects
  // .mjs/.js/.md), not by a special case carved out of PUBLIC_PATHS — this
  // proves that holds even with a Polish `reason` field in a real .jsonl.
  const dir = mkdtempSync(join(tmpdir(), "worktrail-lang-guard-"));
  try {
    mkdirSync(join(dir, "backlog", "history"), { recursive: true });
    writeFileSync(
      join(dir, "backlog", "history", "TL-1.jsonl"),
      '{"id":"1","task":"TL-1","field":"status","from":"pending","to":"blocked","reason":"czeka na inny task"}\n'
    );
    const { findings } = auditTree(dir);
    assert.deepEqual(findings, [], "a .jsonl history entry should never be walked by this guard");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── The third signal: the SHAPE of a word (TL-129) ────────────────────────
//
// THE MEASURED FAILURE THIS CLOSES. `scripts/serve-backlog.mjs` carried a
// Polish sentence for weeks while this guard read the file and reported it as
// English — neither of its words was on either closed list, and neither carried
// an accent. A guard that says "N files read as English" gets cited as proof,
// and that citation was false the whole time. Two closed lists can only ever
// catch what somebody thought to write down; the shape of a word does not
// depend on that.

test("FINDS: the exact sentence the guard used to let through", () => {
  // language-guard: allow — the sample IS the input; translating it would test nothing
  const found = auditText("// (`history-record.mjs --actor claude`) — dlatego czekamy RECONCILE_DELAY_MS,");
  assert.equal(found.length, 1, "this is the sample TL-129 was opened for");
  assert.equal(found[0].reason, "shape");
});

test("FINDS: a Polish comment whose words are on no list and carry no accent", () => {
  // language-guard: allow — the sample IS the input
  assert.equal(auditText("// Pojedyncze sprawdzenia")[0].reason, "shape");
});

test("SILENT: English prose does not trip the shape signal", () => {
  // The lines below are real ones from this repository, chosen because they are
  // the shape most likely to collide: technical prose, identifiers, and paths.
  for (const line of [
    "// The individual checks",
    " * Tests: `node --test scripts/tests/public-language.test.mjs`",
    "const DIACRITICS = /[a-z]/;",
    "  // A negative window would make every claim abandoned the moment it is made:",
    "export function polishShapeHits(searched) {",
    "  size: 12, resize: true, downsized: false,",
  ]) {
    assert.deepEqual(auditText(line), [], "false positive on: " + line);
  }
});

test("ONE Polish-shaped word is not enough — the threshold is two, like the stop words", () => {
  // A surname, a transliteration or a fragment of a URL reaches one hit by
  // accident; a real sentence carries several. Without this the guard would
  // start crying wolf, and a guard people mute is worth nothing.
  assert.equal(polishShapeHits("the Czech translation"), 1);
  assert.deepEqual(auditText("// see the Czech translation"), []);
  // language-guard: allow — the sample IS the input
  assert.ok(polishShapeHits("dlatego czekamy") >= 2);
});

test("the ✓ line does NOT claim the text is English", () => {
  // The narrower claim is the point of TL-129: three heuristics can say that
  // nothing matched, and they cannot say a file is English. The old wording said
  // the second thing, and it was false while the defect above stood.
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "check-public-language.mjs")], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!/read as English/.test(r.stdout),
    "the guard still claims more than three heuristics can support");
  assert.match(r.stdout, /none matching/, "and it has to say what it DID check instead");
});

// ── A quoted label needs only ONE Polish-shaped word (TL-131) ─────────────
//
// THE MEASURED FAILURE. `HISTORY_FIELD_LABELS` in the generated viewer shipped
// `"task utworzony"` and `"Utworzony"` into other people's repositories while
// this guard reported thirty thousand lines as English. Two hits per line is the
// right threshold for a SENTENCE; a label is one or two words and can never
// reach it. It is the same blindness the strong-word list was added for: the
// text a stranger reads FIRST has the least around it for a guard to hold on to.

test("FINDS: a one-word Polish label inside quotes", () => {
  // language-guard: allow — the shipped label IS the sample
  assert.equal(auditText('  created: "Utworzony",')[0].reason, "label");
  // language-guard: allow — the shipped label IS the sample
  assert.equal(auditText('  __created__: "task utworzony",')[0].reason, "label");
});

test("FINDS: a label between HTML tags, which is how the viewer writes them", () => {
  // A quoted string here is as often a fragment of HTML as a bare label, and the
  // label a stranger reads is the text between the tags.
  // language-guard: allow — the shipped label IS the sample
  const line = `'<div class="meta-row"><div class="meta-label">Utworzony</div>' +`;
  assert.equal(auditText(line)[0].reason, "label");
});

test("SILENT: English labels, including the few English words with a Polish digraph", () => {
  for (const line of [
    '  created: "Created",',
    '  __created__: "task created",',
    '<div class="meta-label">Created</div>',
    '  title: "the Czech translation",',
    '  name: "czar of the build",',
    '  path: "backlog/tasks/TL-99-przekazanie-taska.md",',
  ]) {
    assert.deepEqual(auditText(line), [], "false positive on: " + line);
  }
});

test("a quoted blob that is NOT prose is not judged as a label", () => {
  // A JSON payload, a regular expression, a command line: not something a
  // stranger reads as text, and not something this rule may guess about.
  // language-guard: allow — the pattern in the sample is the sample
  assert.equal(labelHits('const re = "^[a-z]+(cz|sz)$";'), 0);
  assert.equal(labelHits('run("git rev-parse --show-toplevel")'), 0);
});

test("POSITIVE CONTROL: putting a Polish label back FAILS the guard", () => {
  // The assertion TL-131 asks for by name. Without it, fixing the two labels
  // would leave a guard that is green because nobody has written another one
  // yet, rather than because it would catch one.
  const dir = mkdtempSync(join(tmpdir(), "worktrail-lang-label-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "build-viewer.mjs"),
    // language-guard: allow — the regression this control exists to catch
    'const LABELS = { __created__: "task utworzony" };\n', "utf8");
  const { findings } = auditTree(dir);
  assert.equal(findings.length, 1, "a Polish label written back in has to be caught");
  assert.equal(findings[0].reason, "label");
  rmSync(dir, { recursive: true, force: true });
});

test("the labels that actually ship are English", () => {
  // Read from the source the viewer is generated from, so this cannot pass
  // against a stale build.
  const source = readFileSync(join(ROOT, "scripts", "build-viewer.mjs"), "utf8");
  const map = source.match(/const HISTORY_FIELD_LABELS = \{[^}]*\}/);
  assert.ok(map, "the label map is not where this test looks — the check would be vacuous");
  assert.deepEqual(auditText(map[0]), [], map[0]);
});

// ── a bare file path is the third carrier of a filename (TL-160) ──────────
//
// The two carriers TL-137 stripped were a markdown link's target and an inline
// code span. A path written plainly inside a YAML scalar — a `verification:`
// command that greps the very task file it belongs to — is a third, and until
// TL-160 the only ways past the guard were an allow marker on a line that is
// not an exception, or a glob that silently narrows what the command asserts.

test("SILENT: a path with a Polish filename inside a YAML scalar", () => {
  // The reported case, verbatim: TL-68's own closing contract.
  // language-guard: allow — the path IS the sample
  const line = '    bash: "grep -q \'step 5 settled\' backlog/tasks/TL-68-log-mowi-done-frontmatter-mowi-pending-nikt-tego-nie-lapie.md"';
  assert.deepEqual(auditText(line), [], "a filename is data, not prose");
});

test("FINDS: a Polish SENTENCE in the same scalar, beside a path", () => {
  // Without this the change would be indistinguishable from switching the
  // guard off for `verification:` — which is the whole risk of stripping.
  // language-guard: allow — the sentence is the sample
  const line = '    bash: "grep -q \'nie ma tego w drzewie\' scripts/serve-backlog.mjs"';
  const found = auditText(line);
  assert.equal(found.length, 1, "the prose beside the path still has to be caught");
  assert.equal(found[0].reason, "words");
});

test("a path is a token with a slash and a known extension, and nothing wider", () => {
  // The narrowness IS the safety. A rule admitting anything after a dot would
  // let a two-word Polish phrase through as a `.tak` file, and a rule not
  // requiring a slash would admit a bare word.
  assert.equal(stripDataSpans("scripts/take-task.mjs").includes("take-task"), false);
  // language-guard: allow — every string below is a sample of what must NOT pass
  const unknownExtension = "wiadomo/nie.tak";
  // language-guard: allow — the sample
  const noDirectory = "nie-lapie.md";
  // language-guard: allow — the sample
  const sentence = "nie ma/tego.md";
  assert.equal(stripDataSpans(unknownExtension), unknownExtension,
    "an unknown extension is not a path");
  assert.equal(stripDataSpans(noDirectory), noDirectory,
    "a bare filename with no directory is not a path by this definition");
  assert.equal(stripDataSpans(sentence), "nie /",
    "whitespace ends a token: only the token itself goes, never the word before it");
});

test("POSITIVE CONTROL: a Polish path-shaped line that is prose still FAILS in a tree", () => {
  // The tree-level counterpart: stripping happens inside auditText, so the
  // control has to run through the whole walk to prove the walk still catches.
  const dir = mkdtempSync(join(tmpdir(), "worktrail-lang-path-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "x.mjs"),
    // language-guard: allow — the regression this control exists to catch
    '// nie ma tego w drzewie, backlog/tasks/TL-68-nie-lapie.md\n', "utf8");
  const { findings } = auditTree(dir);
  assert.equal(findings.length, 1, "prose sitting next to a path is still prose");
  rmSync(dir, { recursive: true, force: true });
});
