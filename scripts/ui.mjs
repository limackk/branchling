#!/usr/bin/env node
/**
 * CLI output style — the ONLY place that writes control sequences (TL-52).
 *
 * WHY ONE MODULE. The moment a second file starts printing its own escape,
 * `NO_COLOR` stops being a property of the PROGRAM and becomes a promise that
 * every file makes separately — and a promise like that cannot be checked any
 * other way than by reading every file. Here one test checks it.
 *
 * COLOUR IS EMPHASIS, NEVER INFORMATION. Whatever the colour says, a word or a
 * symbol has to say as well. This output is read through a pipe, in a CI log
 * and by people who do not tell shades apart — in each of those three cases the
 * colour is gone and the content has to stay complete.
 *
 * WHY THE 16 BASIC ANSI COLOURS AND NOT HEX VALUES. The sixteen are mapped by
 * the user's TERMINAL THEME, so they keep its contrast and its light or dark
 * background. A hand-picked shade looks good against the background it was
 * picked against, and is sometimes unreadable against somebody else's.
 *
 * Tests: `node --test scripts/tests/ui.test.mjs`
 */

// ──────────────────────────────────────────────────────────────────────────
// Whether colour is allowed
// ──────────────────────────────────────────────────────────────────────────

/**
 * The decision is made ONCE, at import time, and separately for each stream —
 * one of them is sometimes redirected while the other is not (`check >
 * file` leaves stderr on the terminal).
 *
 * The order of the conditions is the order of other people's expectations:
 *   NO_COLOR     the no-color.org convention; ANY value, including an empty
 *                one, means "do not colour". Whoever set it, set it for every
 *                program, and will not be making an exception for this one.
 *   TERM=dumb    a terminal that will not render the sequences.
 *   FORCE_COLOR  overrides a MISSING TTY upwards: a CI log that does render ANSI.
 *   isTTY        a pipe and a redirect to a file get plain text without having
 *                to ask; that is what everyone who writes `| grep` expects.
 */
export function colorAllowed(stream, env = process.env) {
  if (env.NO_COLOR !== undefined) return false;
  if (env.TERM === "dumb") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return !!(stream && stream.isTTY);
}

const ESC = "\u001b[";
const SGR = {
  reset: ESC + "0m",
  bold: ESC + "1m",
  dim: ESC + "2m",
  red: ESC + "31m",
  green: ESC + "32m",
  yellow: ESC + "33m",
  cyan: ESC + "36m",
};

/**
 * Six roles, no more. A seventh would mean the output carries more distinctions
 * than a reader is able to hold in their head.
 */
const ROLES = {
  ok: SGR.green,      // a guard passed, a file was written, a task was closed
  warn: SGR.yellow,   // it worked, but there is something you need to know
  err: SGR.red,       // it did not work
  id: SGR.cyan,       // task numbers, paths, commands — things to be copied
  dim: SGR.dim,       // units, hints, zeroes, annotations
  bold: SGR.bold,     // the heading, and the one number the row is about
};

function painter(enabled) {
  const paint = {};
  for (const role of Object.keys(ROLES)) {
    const code = ROLES[role];
    paint[role] = enabled ? (s) => code + s + SGR.reset : (s) => String(s);
  }
  paint.enabled = enabled;
  return paint;
}

/**
 * A painter that asks at the moment it PAINTS, not at the moment this module is
 * imported (TL-238).
 *
 * WHY IT MATTERS AND WHERE IT BIT. The decision used to be frozen at import,
 * which is invisible in a program — the environment does not move between the
 * first import and the first line printed. It is very visible in a suite: a test
 * imports the renderer, then declares that it wants plain text, and the
 * declaration arrives after the decision. Twelve tests were therefore asserting
 * the OBSERVER's terminal, passing through a pipe and failing at a keyboard.
 *
 * The cost is one environment lookup per painted fragment, against a function
 * whose output is going to a terminal a human reads.
 */
function livePainter(stream) {
  const on = painter(true);
  const off = painter(false);
  const now = () => (colorAllowed(stream) ? on : off);
  const live = {};
  for (const role of Object.keys(ROLES)) live[role] = (s) => now()[role](s);
  Object.defineProperty(live, "enabled", { get: () => now().enabled });
  return live;
}

/** The painter for stdout — answers. */
export const color = livePainter(process.stdout);
/** The painter for stderr — diagnostics. Decided SEPARATELY, see `colorAllowed`. */
export const errColor = livePainter(process.stderr);
/** For tests and for `--json`: a painter that never paints anything. */
export const plain = painter(false);

/**
 * The symbols carry the meaning WHEN THE COLOUR IS NOT THERE — that is their
 * whole role. Single-width and free of emoji: terminals measure emoji width
 * differently, and a table knocked out of alignment is worse than a table with
 * no ornament at all.
 */
export const MARK = { ok: "✓", err: "✗", warn: "!", bullet: "·", arrow: "→" };

// ──────────────────────────────────────────────────────────────────────────
// Layout
// ──────────────────────────────────────────────────────────────────────────

/** Terminal width, with a sensible default for a pipe. */
export function width(stream = process.stdout) {
  return (stream && stream.columns) || 80;
}

/**
 * A "label … number  annotation" row. The numbers are RIGHT-ALIGNED in a fixed
 * column, so that orders of magnitude can be compared at a single glance.
 */
export function line(label, value, note, opts = {}) {
  const paint = opts.color || color;
  const labelWidth = opts.labelWidth || 22;
  const valueWidth = opts.valueWidth || 6;
  const text = "  " + String(label).padEnd(labelWidth) + String(value).padStart(valueWidth);
  return note ? text + "  " + paint.dim(String(note)) : text;
}

export function heading(text, opts = {}) {
  return (opts.color || color).bold(String(text));
}

/**
 * Columns are aligned to the WIDEST VALUE, not to a fixed width — a
 * configuration may have longer status names than anybody anticipated, and a
 * table that falls apart because of it is worse than a table with no alignment.
 */
export function table(rows) {
  if (!rows.length) return "";
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] || 0, String(cell == null ? "" : cell).length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? String(cell) : String(cell).padEnd(widths[i])))
        .join("  ")
        .replace(/\s+$/, "")
    )
    .join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Messages
// ──────────────────────────────────────────────────────────────────────────

export function ok(message) {
  return color.ok(MARK.ok) + " " + message;
}

export function warn(message) {
  return errColor.warn(MARK.warn) + " " + message;
}

/**
 * The anatomy of an error: WHAT happened → WHAT was expected → WHAT to do next.
 *
 * The prefix is the name of the command THE USER TYPED, not the name of a file.
 * Before TL-52 the messages introduced themselves as `[build-backlog]` or
 * `next-backlog-id:` — names that appear in no help text and in no document, so
 * they sent the reader looking for something that does not exist.
 *
 * @param {string} command e.g. "<product> build"
 * @param {string} problem what happened
 * @param {string[]} details what was expected — specifically, not "invalid"
 * @param {string[]} next commands to paste
 */
export function failure(command, problem, details, next, opts) {
  // THE PAINTER IS AN ARGUMENT, as it already is for `line` (TL-238). `errColor`
  // is decided once, when this module is imported, from the stream and the
  // environment of THAT moment — which is right for a program and wrong for a
  // caller that wants to assert the SHAPE of an error. Without this a test of
  // the anatomy passes through a pipe and fails in a terminal, having asserted
  // the observer rather than the function.
  const paint = (opts && opts.color) || errColor;
  const out = [paint.err(MARK.err) + " " + paint.bold(command) + ": " + problem];
  for (const d of details || []) out.push("  " + d);
  for (const n of next || []) out.push("  " + paint.id(MARK.arrow + " " + n));
  return out.join("\n");
}

/** Print the error on stderr and return an exit code — for `return fail(...)`. */
export function fail(command, problem, details, next, code = 2) {
  console.error(failure(command, problem, details, next));
  return code;
}

// ──────────────────────────────────────────────────────────────────────────
// Colour of vocabulary values
// ──────────────────────────────────────────────────────────────────────────

/**
 * The colour of a status and of a priority comes from its ROLE AND POSITION in
 * the configuration, never from a name written into the code. A project may
 * have statuses this code has never heard of — and the viewer has derived its
 * palette from those same lists for a long time, so a terminal doing it
 * differently would speak about the same backlog in two languages.
 *
 * Closed ones (`archived_statuses`) are dimmed: that is work which no longer
 * counts towards the queue.
 */
export function statusPaint(config, paint = color) {
  const archived = new Set((config && config.archivedStatuses) || []);
  return (status) => {
    if (!status) return "";
    return archived.has(status) ? paint.dim(status) : paint.ok(status);
  };
}

/** The first priority in the list is red — the one axis read "from a distance". */
export function priorityPaint(config, paint = color) {
  const list = (config && config.priorities) || [];
  return (priority) => {
    if (!priority) return "";
    const i = list.indexOf(priority);
    if (i === 0) return paint.err(priority);
    if (i === 1) return paint.warn(priority);
    return paint.dim(priority);
  };
}
