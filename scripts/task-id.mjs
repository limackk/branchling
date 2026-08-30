/**
 * The task id prefix, in ONE place (BL-1452).
 *
 * BL-1400 moved this project's vocabulary — statuses, labels, boards — out of
 * the code and into config.yaml, under "code knows the SHAPE, config knows the
 * VALUES". The id prefix was the last value left behind: the shape is
 * "prefix + number", and `BL` is a value belonging to one particular project.
 * It was hardcoded in 13 files, which is also why nobody could change it.
 *
 * WHY PATTERNS ARE BUILT HERE AND NOT AT EACH CALL SITE. Every one of those 13
 * files spelled the pattern slightly differently — `^BL-\d+.*\.md$`,
 * `^(BL-\d+)-`, `^BL-(\d+)-`, `^BL-\d+$`. Handing each of them a prefix string
 * to interpolate would keep 13 chances to disagree about what an id looks like,
 * and a guard that disagrees with the generator is worse than no guard.
 *
 * THE PREFIX IS ESCAPED. A prefix is user input from config.yaml. `A.B` must
 * not match `AxB`; without escaping, a dot in someone's prefix silently widens
 * every pattern in the tool.
 */

import { PRODUCT_NAME } from "./product.mjs";

/**
 * Deliberately NOT `BL`. A generic default is the point of this change — a
 * fresh `init` must not stamp one project's vocabulary onto someone else's
 * backlog. Existing backlogs pin their own prefix in config.yaml, so nothing
 * that already works changes.
 */
export const DEFAULT_TASK_ID_PREFIX = "TASK";

/** Shape of a prefix itself: letters, digits, dot, underscore, dash. */
export const PREFIX_SHAPE = /^[A-Za-z][A-Za-z0-9._-]*$/;

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every pattern the tool needs, derived from one prefix.
 *
 * @param {string} prefix e.g. "BL"
 * @returns {{prefix: string, id: RegExp, file: RegExp, fileId: RegExp,
 *            fileNumber: RegExp, historyFile: RegExp}}
 */
export function taskIdPatterns(prefix) {
  const p = escapeRe(prefix);
  return {
    prefix,
    /** A bare id: `BL-123`. */
    id: new RegExp("^" + p + "-\\d+$"),
    /** A task filename: `BL-123-slug.md`. */
    file: new RegExp("^" + p + "-\\d+.*\\.md$"),
    /** Capture the id out of a filename. */
    fileId: new RegExp("^(" + p + "-\\d+)"),
    /** Capture just the number out of a filename. */
    fileNumber: new RegExp("^" + p + "-(\\d+)"),
    /** A history log filename: `BL-123.jsonl`. */
    historyFile: new RegExp("^(" + p + "-\\d+)\\.jsonl$"),
  };
}

/**
 * A GLOBAL scanner for ids embedded in running text: `PROJ-1303` inside a
 * sentence, inside a path like `tasks/PROJ-1303-slug.md`, inside a
 * fenced code block.
 *
 * WHY THE LEFT BOUNDARY IS SPELLED OUT rather than left to `\b`. A word
 * boundary sits happily before the `PROJ-1303` inside `XPROJ-1303`, so a rewrite
 * would repoint a foreign identifier that merely ends in ours. The look-behind
 * refuses any preceding id character, which is what "a whole id" means here.
 * The right side needs no such help — the digits are greedy, so `PROJ-13031` can
 * only match in full, and it is then reported as an id this migration does not
 * know rather than quietly read as `PROJ-1303`.
 *
 * The number is captured so a caller can decide per-id whether it knows this
 * one — a scanner that silently skipped unknown ids would hide exactly the
 * cases a migration must report.
 */
export function taskIdScanner(prefix) {
  return new RegExp("(?<![A-Za-z0-9._-])(" + escapeRe(prefix) + "-(\\d+))(?![0-9])", "g");
}

/**
 * Does this directory's content agree with the configured prefix?
 *
 * WHY THIS EXISTS AND WHY IT IS LOUD. A backlog whose files are `BL-*.md` under
 * a config saying `TASK` does not fail — it reads ZERO tasks. `build` would
 * then write empty INDEX/NOW/archive over real data and print a tick. That is
 * data loss wearing a success message, and it is the single most likely way
 * this feature hurts someone, so it is checked before anything is written.
 *
 * An EMPTY backlog is not a mismatch. A fresh `init` has no tasks, and treating
 * that as an error would make the tool unusable at the one moment it should be
 * easiest.
 *
 * @returns {{ok: true} | {ok: false, found: string[], expected: string}}
 */
// The lazy quantifier in both patterns below MATTERS, it is not cosmetic: a
// greedy one, on the file `BL-1417-close-flag-validation-in-5-commands.md`, read
// the prefix as `BL-1417-close-flag-validation-in`, because there is another
// `-5-` further along. The prefix is whatever comes before the FIRST number.
export function detectPrefixMismatch(fileNames, prefix) {
  const pat = taskIdPatterns(prefix);
  if (fileNames.some((f) => pat.file.test(f))) return { ok: true };

  // Nothing matched. Is there something that LOOKS like a task under another
  // prefix? Only then is this a mismatch rather than an empty backlog.
  const foreign = new Set();
  for (const f of fileNames) {
    const m = f.match(/^([A-Za-z][A-Za-z0-9._-]*?)-\d+(?:-|\.)/);
    if (m && m[1] !== prefix) foreign.add(m[1]);
  }
  if (!foreign.size) return { ok: true };
  return { ok: false, found: [...foreign].sort(), expected: prefix };
}

/** The message every caller should print, so they cannot word it differently. */
/**
 * The default consequence talks about the VIEWS, because that is where this gate
 * stood first. Since it also stands in front of writing a task (TL-61), the
 * caller supplies its own — the two events share a cause and share a way out,
 * but they differ in what they break, and a message describing somebody else's
 * failure sends the reader looking in the wrong place.
 */
const VIEWS_CONSEQUENCE = [
  "  Stopping BEFORE anything is written. Without this the views would be rebuilt",
  "  as EMPTY over real data, with a success message — that is data loss, not a typo.",
];

export function prefixMismatchMessage(mismatch, where, opts = {}) {
  const consequence = opts.consequence || VIEWS_CONSEQUENCE;
  return [
    `✗ backlog: the configuration says \`task_id_prefix: ${mismatch.expected}\`, but ${where}`,
    `  holds NOT ONE task with that prefix — what is there instead: ${mismatch.found.join(", ")}`,
    "",
    ...consequence,
    "",
    "  Either correct `task_id_prefix` in config.yaml to what the tree actually uses,",
    `  or renumber the tree: \`${PRODUCT_NAME} migrate-prefix --to ${mismatch.expected}\``,
    "  (with `--dry-run` first).",
  ].join("\n");
}

/**
 * Prefix-AGNOSTIC shapes, for code that only needs to split an id into its
 * parts and has no business judging vocabulary.
 *
 * WHY THESE EXIST RATHER THAN THREADING THE PREFIX EVERYWHERE. The history log
 * is keyed by whatever id a task has; it neither decides nor validates which
 * prefix a project uses. Handing it the configured prefix would give it an
 * opinion it must not have — and would make an id become unreadable the moment
 * a project migrates, which is exactly when its history matters most.
 *
 * Deciding what counts as a task stays with the generator and the guards, which
 * do load the configuration.
 */
/**
 * Which prefix does an EXISTING tree already use?
 *
 * WHY INFERENCE EXISTS AT ALL. Making the prefix configurable with a generic
 * default breaks every backlog created before the setting existed: their
 * config.yaml has no `task_id_prefix`, so they would suddenly be read under
 * `TASK` and match nothing. Demanding that everyone edit a file first would
 * make the tool's own upgrade the most dangerous thing it ever does.
 *
 * SO THE RULE IS: an explicit setting always wins; only when the key is ABSENT
 * does the tree get to answer. That keeps configuration authoritative — this is
 * a migration affordance, not a second source of truth — while letting an
 * untouched backlog keep working with no action at all.
 *
 * AMBIGUITY IS NOT RESOLVED BY GUESSING. Two prefixes in one directory means
 * the answer is unknowable, so inference declines and the caller falls back to
 * the default, where the mismatch guard produces a loud, explainable failure.
 *
 * @returns {string|null} the single prefix in use, or null when unknown
 */
export function inferPrefix(fileNames) {
  const seen = new Set();
  for (const f of fileNames) {
    const m = f.match(/^([A-Za-z][A-Za-z0-9._-]*?)-\d+(?:-|\.)/);
    if (m) seen.add(m[1]);
  }
  return seen.size === 1 ? [...seen][0] : null;
}

export const ANY_TASK_ID = /^[A-Za-z][A-Za-z0-9._-]*-\d+$/;
export const ANY_TASK_FILE = /^[A-Za-z][A-Za-z0-9._-]*-\d+.*\.md$/;
// Lazy for the same reason as above: a greedy one pulled the id
// `BL-1417-close-flag-validation-in-5` out of
// `BL-1417-close-flag-validation-in-5-commands.md` and created a history file
// under that name. That file REALLY was created, before a test pinned it down.
export const ANY_TASK_FILE_ID = /^([A-Za-z][A-Za-z0-9._-]*?-\d+)-/;
export const ANY_HISTORY_FILE = /^([A-Za-z][A-Za-z0-9._-]*-\d+)\.jsonl$/;
