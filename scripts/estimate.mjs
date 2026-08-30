/**
 * Estimate → hours (BL-1412).
 *
 * This arithmetic used to live in `build-viewer.mjs`, INSIDE the viewer's
 * template literal (`DASH_UNIT_HOURS`, `dashHours`, `dashSumHours`,
 * `dashHoursLabel`). The `stats` command needs exactly the same thing, and a second
 * copy would mean the dashboard and the terminal could one day give two
 * different numbers for the same question. The module is pasted into the viewer
 * BY SOURCE — the same pattern as `task-fields.mjs` and `viewer-url.mjs`.
 *
 * The constraint to hold on to: NO imports and no disk access — otherwise
 * pasting it into the HTML stops compiling.
 *
 * Tests: `node --test scripts/tests/init-stats.test.mjs`
 */

/** How many hours a unit is worth. `d` is a working day, not 24 hours. */
export const ESTIMATE_UNIT_HOURS = { m: 1 / 60, h: 1, d: 8, w: 40, mo: 160 };

/**
 * Estimates are free text in the frontmatter ("30m", "2h", "0.5d", "1w", "1mo").
 *
 * Returns `null` — NEVER zero — for anything unparseable. Zero would shrink the
 * queue silently, so a typo would look like work that is not there; `null` can
 * be counted separately and shown as "N with no estimate".
 */
export function estimateHours(est) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mo|m|h|d|w)\s*$/i.exec(est || "");
  if (!m) return null;
  return parseFloat(m[1].replace(",", ".")) * ESTIMATE_UNIT_HOURS[m[2].toLowerCase()];
}

/**
 * The sum of hours, plus HOW MANY tasks could not be counted. The second number
 * is not decoration: without it the sum pretends to be complete.
 */
export function sumHours(tasks) {
  let sum = 0;
  let unknown = 0;
  for (const t of tasks || []) {
    const h = estimateHours(t && t.estimate);
    if (h == null) unknown++;
    else sum += h;
  }
  return { hours: Math.round(sum), unknown };
}

/** Hours in a human-readable form; working days only once it passes one day. */
export function hoursLabel(h) {
  if (h < 8) return h + " h";
  return h + " h (" + (h / 8).toFixed(h >= 80 ? 0 : 1) + " working days)";
}
