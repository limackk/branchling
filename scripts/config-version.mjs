/**
 * Which release can read a configuration file (TL-586).
 *
 * WHAT WAS BROKEN. A new optional TASK field does not break an older release;
 * a new config KEY does, because the parser refuses every key it does not know.
 * Measured on 2026-11-06: a backlog that v0.3.0 had given `releases:` made
 * v0.1.0 and v0.2.0 fail every command that loads config.yaml with "unknown key
 * `releases`" and the advice that an unknown key is a typo. The file was
 * correct and the tool was old; and since the installed pre-commit hook runs
 * `check`, a teammate still on the older release could not commit at all.
 *
 * THE DECISION: THE FILE STATES ITS OWN FLOOR. `requires_version:` names the
 * oldest release that can read the file, and the parser reads it BEFORE it
 * judges any other key, so a release older than the floor refuses once, with
 * both versions and the command that upgrades, instead of listing keys it was
 * never going to know. The value is written by the commands that write a key
 * (`declare`), from `KEY_SINCE` in config.mjs, so nobody has to remember which
 * release a key arrived in.
 *
 * WHY THE FLOOR IS NOT ALWAYS WRITTEN. `requires_version` is itself a key, and
 * a release older than the one that introduced it refuses it as unknown. So
 * writing the floor into a file that uses only older keys would make that file
 * unreadable to releases that read it today. The floor is therefore written
 * only when the key being written is newer than `requires_version` itself;
 * a floor already present is raised, never lowered.
 *
 * WHY A BUILD READS UP TO ITS NEWEST KEY. Between releases `package.json`
 * carries the LAST published version, while the code already knows the keys
 * the next one will ship (`KEY_SINCE` names that next version). Compared with
 * the manifest alone, a build from the main branch would refuse a floor it
 * wrote itself. What a build can read is the newest release any key it knows
 * belongs to, or its manifest version if that is newer; for a published
 * release the two are the same number.
 *
 * Tests: `node --test scripts/tests/config-requires-version.test.mjs`,
 *        `node --test scripts/tests/declare-requires-version.test.mjs`
 */

/** The key that states the floor. One spelling, read by the parser and the writer. */
export const REQUIRES_VERSION_KEY = "requires_version";

/** `major.minor.patch`, digits only. A pre-release suffix is not accepted: a
 *  floor names a published release, and published releases here carry none. */
export const VERSION_SHAPE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** @returns {number[]|null} */
export function parseVersion(v) {
  const m = typeof v === "string" ? v.match(VERSION_SHAPE) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive, as `a` is older, equal or newer than `b`.
 *  Both must have the shape; a caller compares only what it validated. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) throw new Error("not a version: " + JSON.stringify(x ? b : a));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The newer of two versions; a missing one loses. */
function newer(a, b) {
  if (!parseVersion(a)) return parseVersion(b) ? b : null;
  if (!parseVersion(b)) return a;
  return compareVersions(a, b) >= 0 ? a : b;
}

/**
 * The newest floor this build can read: its manifest version, or the newest
 * release in `since`, whichever is newer. See the header for why both.
 *
 * @param {string|null} running the manifest version, null on a broken install
 * @param {Record<string, string>} since key → the release that introduced it
 */
export function readableVersion(running, since) {
  return Object.values(since).reduce(newer, parseVersion(running) ? running : null);
}

/**
 * The top-level `requires_version:` line of a config text, before anything
 * else is parsed.
 *
 * @param {string[]} lines the file's lines with comments already stripped
 * @returns {{line: number, value: string} | null} `line` is 1-based
 */
export function findRequirement(lines) {
  const re = new RegExp("^" + REQUIRES_VERSION_KEY + ":\\s*(.*)$");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m) return { line: i + 1, value: m[1].trim().replace(/^(["'])(.*)\1$/, "$2") };
  }
  return null;
}

/** The command a person runs to get a release that reads the file. */
export function upgradeCommand(product) {
  return "npm install -g " + product + "@latest";
}

/** How a version is printed when the install cannot say which it is. */
export function shownVersion(v) {
  return parseVersion(v) ? v : "of an unknown version";
}

/**
 * The refusal for a floor above what this build reads: a headline, ONE
 * problem line, and the way out. Nothing about any other key, because a
 * release older than the file cannot tell its typos from its newer keys.
 */
export function requirementRefusal(required, running, product) {
  return {
    headline: "this backlog needs " + product + " " + required + " or later",
    problems: [
      REQUIRES_VERSION_KEY + ": " + required + " — this is " + product + " " + shownVersion(running),
    ],
    remedy: [
      "  → upgrade: " + upgradeCommand(product),
      "    the file is not wrong; it uses what a newer release added. A team that",
      "    shares one backlog reads it with " + required + " or later, so it upgrades together.",
    ],
  };
}

/**
 * The floor a write of `key` leaves behind, or null when the file keeps the
 * one it has. Raised to the key's release when that is newer; written fresh
 * only when the key is newer than `requires_version` itself (see the header).
 *
 * @param {string|null|undefined} current the file's floor, absent as "" or null
 * @param {string} key the config key being written
 * @param {Record<string, string>} since key → the release that introduced it
 */
export function raisedRequirement(current, key, since) {
  const need = since[key];
  if (!parseVersion(need)) return null;
  const floor = parseVersion(current) ? current : since[REQUIRES_VERSION_KEY];
  return compareVersions(need, floor) > 0 ? need : null;
}

/**
 * PURE — config text with its floor set to `version`. A floor line that exists
 * keeps its place and its trailing comment; an absent one is inserted above
 * the first key, with one comment line saying what it is.
 */
export function setRequirementText(text, version, product, stripComment) {
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const lines = String(text).split(/\r?\n/);
  const re = new RegExp("^" + REQUIRES_VERSION_KEY + ":");
  const at = lines.findIndex((l) => re.test(stripComment(l)));
  if (at >= 0) {
    const comment = lines[at].slice(stripComment(lines[at]).length);
    lines[at] = REQUIRES_VERSION_KEY + ": " + version + comment;
    return lines.join(eol);
  }
  let first = lines.findIndex((l) => /^[a-z_]/.test(stripComment(l)));
  if (first < 0) first = lines.length;
  lines.splice(first, 0,
    "# The oldest " + product + " release that can read this file; the commands that write a key raise it.",
    REQUIRES_VERSION_KEY + ": " + version);
  return lines.join(eol);
}
