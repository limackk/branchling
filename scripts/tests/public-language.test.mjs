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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
