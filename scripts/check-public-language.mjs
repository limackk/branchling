#!/usr/bin/env node
/**
 * Guard: the public surface is written in English (TL-32).
 *
 * WHAT COUNTS AS THE PUBLIC SURFACE. Originally everything a user of the tool
 * READS: `scripts/` (CLI messages, `--help`, the viewer chrome the generator
 * emits), `bin/`, `README.md` and `_template.md`. `backlog/` and `docs/` were
 * excluded — this project's own documents and data, free to stay in whatever
 * language their authors used.
 *
 * TL-137 moved that boundary. It was drawn around what ships in the npm
 * tarball; it is now drawn around what a STRANGER reads when they open the
 * repository, and `backlog/tasks/` clears that bar more strongly than the
 * code does — `LINEAGE.md` names it this tool's real development history.
 * `backlog` and `docs` were added to `PUBLIC_PATHS` once every file under
 * them was translated (TL-137), which is also why `backlog/config.yaml`,
 * `backlog/plan.yaml` and `backlog/boards.yaml` are covered now too, as a
 * side effect of adding the directory rather than only `backlog/tasks/` —
 * they were translated by hand earlier and had never been brought under a
 * guard that would keep them that way. `backlog/history/*.jsonl` stays
 * invisible to this guard independent of that: `walk()` below only collects
 * `.mjs`, `.js` and `.md` files, so the append-only log — whose `reason`
 * fields are a person's own sentences, never corrected after the fact — is
 * excluded by file extension, not by a special case in the path list.
 *
 * WHY A GUARD AND NOT A ONE-OFF CLEAN-UP. The translation in TL-32 was one
 * pass over 2,600 lines. Without something that fails, the next message written
 * in a hurry comes back in the author's first language, and nobody notices until
 * a stranger reads it. A detector nothing can fail is a warning, not a rule.
 *
 * WHY IT IS NOT ONLY A DIACRITICS GREP. A grep for accented letters was the
 * obvious implementation and it is not enough: a great many words carry no
 * diacritic at all and would pass straight through it. Both signals are
 * cheap, so both run — the diacritics catch one half and a small stop-word list
 * catches the other.
 *
 * WHY INLINE CODE SPANS AND LINK TARGETS ARE STRIPPED BEFORE THE CHECK.
 * TL-137 deliberately did NOT rename any file — a task's filename stays in
 * whatever language it was created in, only its CONTENT changes (see that
 * task's Decisions). That means every cross-reference between tasks — a
 * markdown link, or a bare path in an inline code span — legitimately
 * contains a Polish word as part of a filename, forever, for every task
 * written from here on that links to one written before this migration. A
 * guard that flagged those would either have to be silenced with an
 * `language-guard: allow` marker on every single cross-reference (hundreds of
 * them, and one more on every future task that links an old one) or be
 * switched off — both are worse than the gap. `stripDataSpans()` removes an
 * inline code span's content and a markdown link's `(...)` target from the
 * text that gets SEARCHED, before either signal runs; the line reported in a
 * finding is still the original, so a real mistake is still visible.
 *
 * WHY THERE IS ALSO AN ALLOW LIST. Some non-English text is not a path and
 * cannot be stripped by shape alone — a transliteration table (its keys ARE
 * the accented letters the feature exists for), a test whose input is
 * deliberately accented, and (since TL-137) a handful of task files that
 * quote real, historical Polish CLI output or Polish words as evidence of a
 * bug, where translating the quote would falsify what was actually observed.
 * Each is marked in the source with `language-guard: allow` on the line or on
 * the line above, so an exception is a decision written down rather than a
 * hole in the pattern.
 *
 * Usage:
 *   node scripts/check-public-language.mjs
 *
 * Exit 0 = the public surface is English (and it says how many lines it read —
 * a ✓ over zero lines means "there was nothing to check", not "I checked").
 * Exit 1 = at least one line looks like it is not English.
 *
 * Tests: `node --test scripts/tests/public-language.test.mjs`
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { MARK, color, errColor } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/** The marker that turns one line into a deliberate exception. */
export const ALLOW_MARKER = "language-guard: allow";

const DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;   // language-guard: allow — its own alphabet

/**
 * Words that ALONE settle the question: no English sentence and no identifier in
 * this tree contains them, so one hit on a line is enough.
 *
 * WHY THIS SIGNAL WAS ADDED. The first version of the guard had only the two
 * below — accented letters and a threshold of two ordinary words — and the
 * translation still left three untranslated one-word labels in the shipped
 * viewer: a filter legend, a button on the editor and a column header.
 * Every one of them is a SHORT line: one word of text and no accent in sight, which is
 * exactly the shape both other signals are blind to. A user-facing label is the
 * text a stranger reads FIRST, and it was the text the guard checked least.
 *
 * The price of one hit being enough is that a word may not be ambiguous. Anything
 * that could plausibly be an identifier, an English word or a fragment of a URL
 * belongs in the list below this one, not in this one.
 */
const STRONG_WORDS =
  /\b(otwarte|otwartych|otwarty|zamkniete|wszystkie|wszystko|zapisz|zapisano|anuluj|usun|dodaj|zmien|edytuj|pokaz|ukryj|szukaj|szukanie|sortuj|sortowanie|zadanie|zadania|zadan|zmiana|zmiany|historia|historii|wiersz|wiersze|zakres|zakresu|razem|prefiks|prefiksu|nazwa|nazwy|drzewo|kolejka|slownik|pusty|puste|pierwszy|pierwsze|ostatni|ostatnia|ostatniego|wczoraj|dzisiaj|jutro|nowy|nowa|nowe|brak|blad|bledy|bledem|uszkodzony|zrobione|domyslnie|wlasny|wlasne|estymata|aktor|kolumna|tabela|wykres|opis|guardy|guardow|komenda|komendy|pomoc|reszta|widoku|viewera|autor|dni|dnia|dzien|godzin|godziny|tydzien|miesiac)\b/i;   // language-guard: allow — the word list itself

/**
 * Words that are common in Polish prose and are not English words, but which a
 * line can carry by accident. Kept short on purpose: a longer list buys little
 * and starts colliding with identifiers. Two hits on one line is the threshold —
 * one is too easy to reach by accident (a variable named `nie`, a URL fragment),
 * and three would miss short comments.
 */
const STOP_WORDS =
  /\b(nie|jest|się|sie|przez|który|ktory|która|które|żeby|zeby|czyli|więc|wiec|jeśli|jesli|może|moze|musi|trzeba|zamiast|katalog|katalogu|widok|widoki|widoków|plik|pliku|plików|taska|tasku|tego|jak|bez|oraz|albo|wtedy|nigdy|zawsze|gdy|kiedy|liczy|daje|robi|zapis|odczyt|słownik|slownik|prefiks|numer|drzewo|drzewa|kolejka|kolejki|zakres|zakresu|pole|pola|polu|dzień|dni|godzin)\b/gi;   // language-guard: allow — the word list itself

/** The files whose text reaches a user of the tool, or a stranger reading it. */
// `skills` joined the list in TL-54, when the agent instructions started
// travelling in the tarball: a file installed into somebody else's editor is as
// public a surface as `--help`, and it had never been under a guard that would
// keep it English.
export const PUBLIC_PATHS = ["scripts", "bin", "README.md", "_template.md", "backlog", "docs", "skills"];

const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(abs, out) {
  if (statSync(abs).isDirectory()) {
    for (const name of readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(join(abs, name), out);
    }
    return out;
  }
  if (/\.(mjs|js|md)$/.test(abs)) out.push(abs);
  return out;
}

/**
 * Remove spans that are DATA, not prose, from a line before it is SEARCHED —
 * see "WHY INLINE CODE SPANS AND LINK TARGETS ARE STRIPPED" above. Only the
 * search text changes; a finding still reports the original line untouched.
 */
function stripDataSpans(line) {
  return line
    .replace(/`[^`]*`/g, "``")
    .replace(/\]\([^)]*\)/g, "]()");
}

/**
 * PURE — audits already-read text, so a test can exercise it without a tree.
 *
 * @param {string} text
 * @returns {Array<{line: number, text: string, reason: "diacritics"|"word"|"words"}>}
 */
export function auditText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // An exception is declared on the line itself or on the one above it — a
    // long line has no room for the marker, and a comment above is where a
    // reader would look for the reason anyway.
    const allowed = line.includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER));
    if (allowed) continue;
    const searched = stripDataSpans(line);
    if (DIACRITICS.test(searched)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "diacritics" });
      continue;
    }
    if (STRONG_WORDS.test(searched)) {
      problems.push({ line: i + 1, text: line.trim(), reason: "word" });
      continue;
    }
    const hits = searched.match(STOP_WORDS);
    if (hits && hits.length >= 2) {
      problems.push({ line: i + 1, text: line.trim(), reason: "words" });
    }
  }
  return problems;
}

export function auditTree(root = ROOT) {
  const files = [];
  for (const entry of PUBLIC_PATHS) {
    try {
      walk(join(root, entry), files);
    } catch {
      // A path that is not there is not a violation: this same guard runs
      // against fixtures that carry only some of these files.
    }
  }
  const findings = [];
  let linesChecked = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    linesChecked += text.split(/\r?\n/).length;
    for (const p of auditText(text)) findings.push({ file: relative(root, file), ...p });
  }
  return { findings, filesChecked: files.length, linesChecked };
}

function main() {
  const { findings, filesChecked, linesChecked } = auditTree();

  if (!findings.length) {
    // The counts are the positive control: a ✓ over zero files would mean the
    // walk read the wrong tree, not that the surface is clean.
    console.log(
      `${OKM} language: ${linesChecked} lines across ${filesChecked} public files read as English`
    );
    return 0;
  }

  console.error(ERRM + " language: the public surface is not English\n");
  for (const f of findings.slice(0, 20)) {
    console.error(`  - ${f.file}:${f.line} (${f.reason}): ${f.text.slice(0, 100)}`);
  }
  if (findings.length > 20) console.error(`  … and ${findings.length - 20} more`);
  console.error("");
  console.error("  Everything in this repository is English (CLAUDE.md): CLI messages,");
  console.error("  --help, comments, the viewer chrome, README.md, _template.md, the backlog");
  console.error("  and docs/. A markdown link's target and an inline `code span` are not");
  console.error("  searched — a task's filename is not part of this rule (TL-137).");
  console.error(`  A deliberate exception: put \`${ALLOW_MARKER}\` on the line or above it.`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-public-language.mjs")) {
  process.exit(main());
}
