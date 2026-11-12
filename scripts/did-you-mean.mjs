/**
 * The nearest known command or flag to one the user mistyped (TL-701).
 *
 * WHY. A refusal that lists forty alternatives is correct and still sends the
 * reader to `--help`: on 2026-11-10 loop agents typed `query --grep` (meant
 * `--text`) and `verify <ID>` (meant `done --dry-run`), and each read the help
 * afterwards. One line naming the likely intent costs nothing when it is right
 * and is absent when nothing is near.
 *
 * A SUGGESTION IS PRINTED, NEVER EXECUTED. Running the guess would turn a
 * refusal into a command the user did not type — the silent no-op this CLI
 * refuses on principle, with a side effect added. The exit code of the refusal
 * does not change.
 *
 * TWO SOURCES, IN THIS ORDER:
 *   aliases        an intent whose word is unrelated to the name that does it
 *                  (`verify` → `done --dry-run`). Edit distance cannot find
 *                  these, so they are listed. An alias is offered only when its
 *                  target is among the alternatives the refusal itself lists,
 *                  so a command that has no `--text` is never told to use one.
 *   edit distance  a misspelling (`--stauts`, `qeury`), bounded by the length
 *                  of the word, plus the one candidate a word is a prefix of.
 *
 * Tests: `node --test scripts/tests/cli-did-you-mean.test.mjs`
 */

/** Commands whose intent goes by another name. The value is pasted after the
 *  product name; its first word is the command that must exist. */
export const COMMAND_ALIASES = Object.freeze({
  verify: "done --dry-run",
  grep: "query --text",
  search: "query --text",
});

/** Flags whose intent goes by another name, for whichever command accepts the
 *  target. */
export const FLAG_ALIASES = Object.freeze({
  "--grep": "--text",
  "--search": "--text",
});

/**
 * Optimal string alignment distance: insertions, deletions, substitutions and
 * adjacent transpositions each cost one. A transposition is the commonest
 * typing error (`qeury`), and plain Levenshtein would charge it two.
 */
export function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = [];
  for (let i = 0; i < rows; i++) {
    d.push(new Array(cols).fill(0));
    d[i][0] = i;
  }
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** The leading dashes are spelling, not the name: `--x` and `-x` differ by one
 *  character that says nothing about which flag was meant. */
const bare = (word) => word.replace(/^-+/, "");

/**
 * How far a word may be from a candidate and still be the same word mistyped.
 * A third of its length, at least one: `--stauts` (6) may be two edits from
 * `--status`, while `zzz` (3) is one edit from nothing it resembles. A word
 * under three characters gets no suggestion — every short flag is one edit
 * from every other.
 */
export function maxDistance(word) {
  const n = bare(word).length;
  if (n < 3) return -1;
  return Math.max(1, Math.floor(n / 3));
}

/**
 * The suggestion for `word` among `candidates`, or null when nothing is near.
 *
 * @param {string} word what the user typed (`--grep`, `verify`)
 * @param {string[]} candidates what the refusal lists as available
 * @param {object} [aliases] word → suggestion; the suggestion's first token
 *        must be one of the candidates
 * @returns {string|null} the text to paste, ties joined with " or "
 */
export function nearest(word, candidates, aliases = {}) {
  if (!word || !Array.isArray(candidates) || candidates.length === 0) return null;
  const known = new Set(candidates);
  if (Object.prototype.hasOwnProperty.call(aliases, word)) {
    const target = aliases[word];
    if (known.has(target.split(" ")[0])) return target;
  }
  const limit = maxDistance(word);
  if (limit < 0) return null;
  const typed = bare(word);
  let best = limit + 1;
  let hits = [];
  for (const c of candidates) {
    if (c === word) continue;
    const dist = editDistance(typed, bare(c));
    if (dist > limit) continue;
    if (dist < best) {
      best = dist;
      hits = [c];
    } else if (dist === best && !hits.includes(c)) {
      hits.push(c);
    }
  }
  if (hits.length) return hits.slice(0, 3).join(" or ");
  // A truncated word (`--prio`) is far from its candidate by edit count and
  // unambiguous by prefix; offered only when exactly one candidate starts so.
  const prefixed = candidates.filter((c) => c !== word && bare(c).startsWith(typed));
  return prefixed.length === 1 ? prefixed[0] : null;
}

const UNKNOWN = /^unknown (flag|command): (\S+)/;

/**
 * The "did you mean" line for a refusal, read off its own two parts: the
 * sentence naming the event (`unknown flag: --grep`) and the `available:` line
 * listing the alternatives. Reading them, rather than taking a third argument,
 * gives every command that refuses in the shared anatomy the suggestion at
 * once — including those that throw the sentence and print it elsewhere.
 *
 * A command is suggested as the whole line to paste, after the product name
 * the refusal is headed with; a flag is suggested alone, since the rest of
 * that command line is the user's own and is not repeated back.
 *
 * @param {string} problem e.g. "unknown flag: --grep"
 * @param {string[]} details the refusal's detail lines
 * @param {string} [command] the refusal's heading, e.g. the product name
 * @returns {string|null} e.g. "did you mean --text?"
 */
export function suggestionFor(problem, details, command = "") {
  const m = UNKNOWN.exec(String(problem || ""));
  if (!m) return null;
  const kind = m[1];
  // `--grep=x` is the flag `--grep` with a value attached.
  const word = kind === "flag" ? m[2].split("=")[0] : m[2];
  const line = (details || []).find((d) => String(d).startsWith("available: "));
  if (!line) return null;
  const tokens = line.slice("available: ".length).split(/\s+/)
    .filter((t) => /^-{0,2}[A-Za-z0-9][\w-]*$/.test(t));
  const candidates = kind === "flag"
    ? tokens.filter((t) => t.startsWith("-"))
    : tokens.filter((t) => !t.startsWith("-"));
  const hit = nearest(word, candidates, kind === "flag" ? FLAG_ALIASES : COMMAND_ALIASES);
  if (!hit) return null;
  const paste = kind === "command" && command ? command + " " + hit : hit;
  return "did you mean " + paste + "?";
}
