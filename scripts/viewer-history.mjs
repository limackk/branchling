/**
 * History-date presentation for the generated viewer (TL-429).
 *
 * Task dates and history timestamps travel as UTC.  Relative wording has to
 * read that stamp in the same calendar: using a browser's local midnight on
 * one side and a UTC YYYY-MM-DD on the other turns a recent entry into
 * "yesterday" for readers east of UTC just after their midnight.
 *
 * This module has no imports so build-viewer.mjs can paste it into the
 * self-contained file:// page.  It is nevertheless a module rather than an
 * inline template function: node tests execute this exact source before the
 * builder carries it into the browser.
 */

/** Return the UTC day part of a history timestamp. */
export function histDay(ts) {
  return String(ts || "").slice(0, 10);
}

/**
 * Describe a UTC history day relative to the UTC day containing `now`.
 * `now` is injectable so callers can prove boundary behaviour without
 * depending on their wall clock; the page deliberately uses its current time.
 */
export function histAgo(ts, now = Date.now()) {
  const day = histDay(ts);
  if (!day) return "";
  const today = new Date(now);
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const parts = day.split("-");
  const t1 = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const days = Math.round((t0 - t1) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return day;
}
