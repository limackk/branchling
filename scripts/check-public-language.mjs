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
 * WHY THERE IS ALSO A DICTIONARY (TL-201). The three signals above are all
 * BLOCKLISTS: they enumerate what a foreign word looks like, and a language is
 * not closed by enumeration, so every hole in them is simply another word.
 * `Tryb snapshot` shipped in the viewer's connection bar past all three — no
 * diacritic, no digraph, no inflected ending, on neither word list — and was
 * read as English for as long as the guard existed (TL-198). The fourth signal
 * inverts the question: a word this project has never written is UNKNOWN, and
 * an unknown word fails. That is closed by construction rather than by however
 * many patterns somebody thought of, and it catches a misspelling of an English
 * word too, which no list of foreign words can ever do.
 *
 * The vocabulary is `language-dictionary.txt` beside this file — one file, so a
 * reader can see the whole of what this project accepts at once, and no
 * dependency, so `npm test` works from a clean checkout with no network. It is
 * a SNAPSHOT, generated from the tree by `--update-dictionary` and then
 * committed; it is deliberately not rebuilt on every run, because a dictionary
 * that regenerates itself accepts whatever was written last and answers ✓ for
 * ever.
 *
 * WHY THE THREE BLOCKLISTS STAY. They are strictly narrower than the dictionary
 * and would be redundant on their own — but they run FIRST, so a line that is
 * recognisably foreign is still reported as `diacritics`, `word`, `words`,
 * `shape` or `label` rather than as an anonymous unknown word. The reason code
 * is what tells an author whether they wrote the wrong language or misspelled
 * the right one, and that is worth four cheap regular expressions.
 *
 * WHY THERE IS ALSO AN ALLOW LIST. Some non-English text is not a path and
 * cannot be stripped by shape alone — a transliteration table (its keys ARE
 * the accented letters the feature exists for), a test whose input is
 * deliberately accented, and (since TL-137) a handful of task files that
 * quote real, historical Polish CLI output or Polish words as evidence of a
 * bug, where translating the quote would falsify what was actually observed.
 * Each is marked in the source with `language-guard: allow` on the line or on
 * the line above, so an exception is a decision written down rather than a
 * hole in the pattern. Since TL-201 the marker has a SECOND job: a marked line
 * is skipped when the dictionary is built as well as when it is read, so a
 * deliberately foreign sample never becomes part of the vocabulary that lets
 * the next one through.
 *
 * Usage:
 *   node scripts/check-public-language.mjs
 *   node scripts/check-public-language.mjs --update-dictionary
 *
 * Exit 0 = the public surface is English (and it says how many lines it read —
 * a ✓ over zero lines means "there was nothing to check", not "I checked").
 * Exit 1 = at least one line looks like it is not English.
 *
 * Tests: `node --test scripts/tests/public-language.test.mjs`
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

/**
 * THE THIRD SIGNAL: the SHAPE of a word, rather than the word itself (TL-129).
 *
 * WHY IT EXISTS. The two signals above are both closed lists, and a closed list
 * only catches what somebody thought to write down. Measured: this guard read
 * `scripts/serve-backlog.mjs` for weeks and reported it as English while it
 * carried a Polish sentence — because neither of its words was on either list
 * and neither carried an accent. That is worse than no guard: a green line
 * saying "N files read as English" gets cited as proof, and the citation was
 * false the whole time.
 *
 * WHAT IT LOOKS AT. Two properties of Polish orthography that do not depend on
 * anybody having listed the word:
 *
 *   the digraphs `cz sz rz dz`, which are how Polish spells four consonants and
 *     which essentially do not occur inside English words;
 *   the inflectional endings below, each chosen so that no English word of five
 *     letters or more ends that way.
 *
 * TWO HITS ON ONE LINE, the same threshold `STOP_WORDS` uses and for the same
 * reason: a single hit is reachable by accident — a surname, a fragment of a
 * URL, a transliteration — and demanding two costs almost nothing on a real
 * sentence, which carries several.
 *
 * WHAT IT STILL DOES NOT CATCH, said here because a guard that overstates its
 * reach is the defect this whole file is about: a SHORT phrase whose words carry
 * no accent, no digraph and no inflected ending passes — `prywatne okno` did,
 * and it was closed by adding the words above, which is the last resort rather
 * than the mechanism. The ✓ line therefore says what was actually checked and
 * does not claim the text is English.
 */
const POLISH_DIGRAPH = /\b[a-z]*(?:cz|sz|rz|dz)[a-z]*\b/gi;   // language-guard: allow — the pattern itself
const POLISH_ENDING = /\b[a-z]{2,}(?:ego|emu|ych|ymi|ach|ami|ości|ość|enia|ania|eniu|aniu|amy|emy|imy|ów)\b/gi;   // language-guard: allow — the pattern itself

/** How many DISTINCT words on this line are Polish-shaped. PURE. */
export function polishShapeHits(searched) {
  const hits = new Set();
  for (const re of [POLISH_DIGRAPH, POLISH_ENDING]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(searched)) !== null) hits.add(m[0].toLowerCase());
  }
  return hits.size;
}

/**
 * A QUOTED LABEL needs only ONE Polish-shaped word (TL-131).
 *
 * WHY THE LINE THRESHOLD IS WRONG HERE. Two hits per line is the right rule for
 * a sentence, which carries several. A user-facing LABEL is one or two words
 * inside quotes and can never reach two — which is why `HISTORY_FIELD_LABELS` in
 * the generated viewer shipped `"task utworzony"` and `"Utworzony"` past a guard
 * that had just reported thirty thousand lines as English. It is the same
 * blindness `STRONG_WORDS` was added for: the text a stranger reads FIRST is the
 * text with the least around it for a guard to hold on to.
 *
 * WHY ONLY THE DIGRAPHS COUNT HERE, and not the inflectional endings. `-ach` is
 * the ending of `reach`, `each`, `search`, `coach`; one hit on it inside a short
 * English label would fire constantly. The digraphs `cz sz rz dz` have no such
 * English neighbours, so a single one inside a quoted phrase is evidence on its
 * own. The endings keep their two-hit rule at line level, where they are safe.
 *
 * WHAT COUNTS AS A LABEL: a quoted run of at most four words made only of
 * letters, spaces and light punctuation. A quoted path, a regular expression or
 * a command line is not prose and is not judged.
 */
const QUOTED = /"([^"\n]{1,400})"|'([^'\n]{1,400})'/g;   // language-guard: allow — the pattern itself
const LABEL_SHAPE = /^[\p{L} .,:;!?—–-]+$/u;

/**
 * The English words that carry a Polish digraph, and there are very few.
 *
 * Kept as a list rather than pretended away: `Czech` and `czar` are English, the
 * pattern cannot tell, and an exception the code states is better than one every
 * reader has to silence by hand. At line level the two-hit threshold already
 * absorbs them; only the single-hit label rule needs this.
 */
// language-guard: allow — the exception list itself
const ENGLISH_WITH_DIGRAPH = new Set(["czech", "czechs", "czar", "czars", "adze", "adzes", "kudzu"]);

/** Polish-shaped words inside quoted labels on this line. PURE. */
export function labelHits(searched) {
  const hits = new Set();
  QUOTED.lastIndex = 0;
  let m;
  while ((m = QUOTED.exec(searched)) !== null) {
    const inner = (m[1] === undefined ? m[2] : m[1]).trim();
    if (!inner) continue;
    // A quoted string in this codebase is as often a FRAGMENT OF HTML as a bare
    // label — the viewer is built by concatenating them — and the label a
    // stranger reads is the text between the tags. The defect TL-131 found had
    // exactly that shape:
    // language-guard: allow — the shipped label IS the sample; translating it would falsify the evidence
    //     <div class="meta-label">Utworzony</div>
    // and a rule that only looked at whole quoted strings walked past it.
    for (const run of inner.replace(/<[^>]*>/g, "\u0000").split("\u0000")) {
      const text = run.trim();
      if (!text || !LABEL_SHAPE.test(text)) continue;
      if (text.split(/\s+/).length > 4) continue;
      POLISH_DIGRAPH.lastIndex = 0;
      let w;
      while ((w = POLISH_DIGRAPH.exec(text)) !== null) {
        const word = w[0].toLowerCase();
        if (!ENGLISH_WITH_DIGRAPH.has(word)) hits.add(word);
      }
    }
  }
  return hits.size;
}

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
 * THE FOURTH SIGNAL: a word this project has never written (TL-201).
 *
 * WHAT A WORD IS HERE. A run of letters, after `stripDataSpans()` has removed
 * the spans that are data rather than prose. `camelCase` and `snake_case` are
 * split into their parts, so `mkdtempSync` is `mkdtemp` + `sync` and a new
 * identifier assembled from words the project already writes needs no dictionary
 * entry of its own. A token carrying a DIGIT — `utf8`, `sha256`, a ULID — is
 * skipped whole: it is an identifier or a serial, and letting its letter runs
 * into the vocabulary would fill the dictionary with noise that then accepts
 * anything.
 *
 * WHY FOUR LETTERS. Below that the tokens are overwhelmingly abbreviations and
 * single-letter variables — `tl`, `px`, `fx`, `id` — and the three-letter band
 * is where a foreign word and an identifier are least distinguishable. The
 * stop-word list above already covers the short foreign words that matter
 * (`nie`, `jak`, `bez`), and it covers them with a two-hit threshold that a
 * variable name cannot trip.
 *
 * ONE UNKNOWN WORD IS ENOUGH, unlike the two-hit thresholds above. Those are
 * blocklists, where a single hit is reachable by accident; this is the inverse,
 * and a word the project has never written is already the finding.
 */
export const MIN_DICTIONARY_WORD = 4;

/** A token that could carry a word: letters first, then anything identifier-ish. */
const WORD_TOKEN = /[A-Za-z][A-Za-z0-9_]*/g;

/** `camelCase` and `PascalCase` boundaries. */
const CAMEL_BOUNDARY = /(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/;

/** The words a line is made of, lowercased. PURE. */
export function wordsIn(searched) {
  const out = [];
  for (const m of String(searched).matchAll(WORD_TOKEN)) {
    if (/[0-9]/.test(m[0])) continue;
    for (const part of m[0].split(/_+/)) {
      for (const word of part.split(CAMEL_BOUNDARY)) {
        if (word.length >= MIN_DICTIONARY_WORD) out.push(word.toLowerCase());
      }
    }
  }
  return out;
}

/** The one file that holds this project's vocabulary. */
export const DICTIONARY_FILE = join(HERE, "language-dictionary.txt");

/**
 * What a reader of the word list itself needs to know. Written by the generator,
 * ignored by the reader — a `#` line is not a word.
 */
const DICTIONARY_HEADER = [
  "# The vocabulary this project accepts, one word per line, lowercase.",
  "#",
  "# HOW IT WAS MADE. Generated from the public surface of this repository by",
  "#   node scripts/check-public-language.mjs --update-dictionary",
  "# and then committed. It is a SNAPSHOT: the check reads it, never rewrites it.",
  "# A dictionary that rebuilt itself on every run would accept whatever was",
  "# written last and answer with a tick for ever.",
  "#",
  "# HOW TO ADD A WORD. By hand, on its own line, when the guard reports it and",
  "# it is English this project had simply not written before. Regenerating is",
  "# the same decision taken in bulk, and it accepts the mistakes too.",
  "#",
  "# WHAT IT INHERITED. The snapshot was taken from a tree that still carried",
  "# Polish inside scripts/tests, so this file holds those words as well. They",
  "# are the debt TL-229 and TL-128 are open for, and closing either means",
  "# deleting the words it translated from here in the same commit.",
  "",
].join("\n");

let DICTIONARY = null;

/** The vocabulary, read once. A `#` comment and a blank line are not words. */
export function dictionary() {
  if (DICTIONARY) return DICTIONARY;
  const text = readFileSync(DICTIONARY_FILE, "utf8");
  DICTIONARY = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const word = raw.replace(/#.*$/, "").trim().toLowerCase();
    if (word) DICTIONARY.add(word);
  }
  return DICTIONARY;
}

/** The words on this line that the project has never written. PURE-ish. */
export function unknownWords(searched) {
  const known = dictionary();
  const unknown = [];
  for (const word of new Set(wordsIn(searched))) if (!known.has(word)) unknown.push(word);
  return unknown;
}

/**
 * The extensions a bare path may end in. A CLOSED list on purpose: the test for
 * "is this token a path" has to be narrow enough that a Polish word cannot walk
 * through it, and an open rule — anything after a dot — would let
 * `wiadomo/nie.tak` past. Every extension here is one this repository actually
 * writes into a task file or a command.
 */
const PATH_EXTENSIONS = "md|mjs|cjs|js|json|jsonl|ya?ml|html|css|txt|sh|svg|png|patch";

/**
 * A bare file path — the THIRD carrier of a filename, after the markdown link
 * target and the inline code span (TL-160).
 *
 * WHY IT NEEDED ADDING. TL-137 stripped the two carriers that existed when it
 * was written, and a path written plainly inside a YAML scalar — a
 * `verification:` command that greps the very task it belongs to — is a third
 * one nobody had produced yet. CLAUDE.md already settles the principle: a
 * task's filename is data, not prose, and 145 files in this repository will
 * carry a Polish word in their names forever because TL-137 deliberately did
 * not rename them. Without this the only ways past the guard were an allow
 * marker on a line that is not an exception, or a glob that silently narrows
 * what the command asserts.
 *
 * WHAT COUNTS, narrowly: no whitespace, no quote of any kind, at least one `/`,
 * and one of the extensions above at the end. The slash is what makes this
 * safe — Polish prose has spaces in it, so a sentence can never be one token,
 * and a token that is one word cannot reach the two hits every word rule here
 * requires. A bare filename with no directory is deliberately NOT a path by
 * this definition: nothing in the tree writes one, and admitting it would widen
 * the hole for no gain.
 */
const BARE_PATH = new RegExp(
  "[^\\s\"'`]*\\/[^\\s\"'`]*\\.(?:" + PATH_EXTENSIONS + ")(?![A-Za-z0-9])",
  "g"
);

/**
 * Remove spans that are DATA, not prose, from a line before it is SEARCHED —
 * see "WHY INLINE CODE SPANS AND LINK TARGETS ARE STRIPPED" above. Only the
 * search text changes; a finding still reports the original line untouched.
 */
export function stripDataSpans(line) {
  return line
    .replace(/`[^`]*`/g, "``")
    .replace(/\]\([^)]*\)/g, "]()")
    .replace(BARE_PATH, "/");
}

/**
 * PURE — audits already-read text, so a test can exercise it without a tree.
 *
 * @param {string} text
 * @returns {Array<{line: number, text: string, reason: "diacritics"|"word"|"words"|"shape"|"label"|"unknown", word?: string}>}
 */
export function auditText(text) {
  const problems = [];
  for (const { line, number, searched } of judgedLines(text)) {
    if (DIACRITICS.test(searched)) {
      problems.push({ line: number, text: line.trim(), reason: "diacritics" });
      continue;
    }
    if (STRONG_WORDS.test(searched)) {
      problems.push({ line: number, text: line.trim(), reason: "word" });
      continue;
    }
    const hits = searched.match(STOP_WORDS);
    if (hits && hits.length >= 2) {
      problems.push({ line: number, text: line.trim(), reason: "words" });
      continue;
    }
    if (polishShapeHits(searched) >= 2) {
      problems.push({ line: number, text: line.trim(), reason: "shape" });
      continue;
    }
    if (labelHits(searched) >= 1) {
      problems.push({ line: number, text: line.trim(), reason: "label" });
      continue;
    }
    // LAST, so that a recognisably foreign line keeps the reason code that says
    // WHY it is foreign; only what the blocklists cannot name arrives here.
    const unknown = unknownWords(searched);
    if (unknown.length) {
      problems.push({ line: number, text: line.trim(), reason: "unknown", word: unknown[0] });
    }
  }
  return problems;
}

/**
 * The lines of `text` that are actually judged, with the search text for each.
 *
 * SHARED WITH THE GENERATOR ON PURPOSE. A word only enters the dictionary from a
 * line the guard would have read, stripped exactly the way the guard strips it.
 * Two implementations of "which lines count" would drift, and the drift would
 * show up as a dictionary that either misses a word the tree uses (a false
 * alarm) or holds one from a line nobody checks (a hole).
 */
function* judgedLines(text) {
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // An exception is declared on the line itself or on the one above it — a
    // long line has no room for the marker, and a comment above is where a
    // reader would look for the reason anyway.
    if (lines[i].includes(ALLOW_MARKER) || (i > 0 && lines[i - 1].includes(ALLOW_MARKER))) continue;
    yield { line: lines[i], number: i + 1, searched: stripDataSpans(lines[i]) };
  }
}

/** Every file the guard reads under `root`. */
function publicFiles(root) {
  const files = [];
  for (const entry of PUBLIC_PATHS) {
    try {
      walk(join(root, entry), files);
    } catch {
      // A path that is not there is not a violation: this same guard runs
      // against fixtures that carry only some of these files.
    }
  }
  return files;
}

export function auditTree(root = ROOT) {
  const files = publicFiles(root);
  const findings = [];
  let linesChecked = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    linesChecked += text.split(/\r?\n/).length;
    for (const p of auditText(text)) findings.push({ file: relative(root, file), ...p });
  }
  return { findings, filesChecked: files.length, linesChecked };
}

/**
 * Rebuild the vocabulary from the tree — the answer to "how was this file made".
 *
 * IT IS A SNAPSHOT, NOT A RULE. Running this accepts every word the tree
 * currently holds, including any that should not be there, which is why it is a
 * deliberate flag and not something the check does for itself. Regenerating it
 * is the same decision as adding a word by hand, taken in bulk.
 */
function updateDictionary() {
  const words = new Set();
  for (const file of publicFiles(ROOT)) {
    for (const { searched } of judgedLines(readFileSync(file, "utf8"))) {
      for (const word of wordsIn(searched)) words.add(word);
    }
  }
  const sorted = [...words].sort();
  writeFileSync(DICTIONARY_FILE, DICTIONARY_HEADER + sorted.join("\n") + "\n", "utf8");
  console.log(`${OKM} language: ${sorted.length} words written to ${relative(ROOT, DICTIONARY_FILE)}`);
  return 0;
}

function main() {
  if (process.argv.includes("--update-dictionary")) return updateDictionary();
  const { findings, filesChecked, linesChecked } = auditTree();

  if (!findings.length) {
    // The counts are the positive control: a ✓ over zero files would mean the
    // walk read the wrong tree, not that the surface is clean.
    //
    // AND IT SAYS WHAT IT ACTUALLY CHECKED (TL-129). The old wording — "read as
    // English" — is a claim three heuristics cannot support, and it was FALSE
    // for weeks while a Polish sentence sat in `serve-backlog.mjs` that none of
    // the signals happened to match. A green line gets quoted as proof, so it
    // has to state its own reach: nothing here matched, which is not the same
    // as "this is English".
    console.log(
      `${OKM} language: ${linesChecked} lines across ${filesChecked} public files, ` +
        "none matching the accents, word lists or Polish word shapes this guard looks for, " +
        `and no word outside ${relative(ROOT, DICTIONARY_FILE)}`
    );
    return 0;
  }

  console.error(ERRM + " language: the public surface is not English\n");
  for (const f of findings.slice(0, 20)) {
    const why = f.reason === "unknown" ? `unknown word: ${f.word}` : f.reason;
    console.error(`  - ${f.file}:${f.line} (${why}): ${f.text.slice(0, 100)}`);
  }
  if (findings.length > 20) console.error(`  … and ${findings.length - 20} more`);
  console.error("");
  console.error("  Everything in this repository is English (CLAUDE.md): CLI messages,");
  console.error("  --help, comments, the viewer chrome, README.md, _template.md, the backlog");
  console.error("  and docs/. A markdown link's target and an inline `code span` are not");
  console.error("  searched — a task's filename is not part of this rule (TL-137).");
  console.error(`  An unknown word is either a misspelling, or English this project has not`);
  console.error(`  written before — in which case add it to ${relative(ROOT, DICTIONARY_FILE)}.`);
  console.error(`  A deliberate exception: put \`${ALLOW_MARKER}\` on the line or above it.`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-public-language.mjs")) {
  process.exit(main());
}
