/**
 * The viewer reads a UTC history stamp against a UTC day (TL-429).
 *
 * UTC+14 and UTC-11 are 25 hours apart, so they cannot share a local day at
 * the fixed instant below.  Each child imports viewer-history.mjs, whose
 * source build-viewer.mjs pastes into the browser page; this executes the page
 * function rather than matching a plausible-looking template string.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { buildHtml, computeStats } from "../build-viewer.mjs";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("viewer-history");

const AHEAD = "Pacific/Kiritimati";
const BEHIND = "Pacific/Midway";
const INSTANT = Date.parse("2026-03-01T11:30:00.000Z");
const STAMP = "2026-03-01T11:29:00.000Z";

function inZone(tz) {
  const script = [
    "import { histAgo } from './scripts/viewer-history.mjs';",
    "const now = " + INSTANT + ";",
    "const d = new Date(now);",
    "const p = (n) => String(n).padStart(2, '0');",
    "const parts = " + JSON.stringify(STAMP.slice(0, 10)) + ".split('-');",
    "const localToday = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());",
    "const stampDay = Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));",
    "process.stdout.write(JSON.stringify({",
    "  relative: histAgo(" + JSON.stringify(STAMP) + ", now),",
    "  mixedDays: Math.round((localToday - stampDay) / 86400000),",
    "  local: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()),",
    "}));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, { TZ: tz }),
  });
  assert.equal(result.status, 0, tz + ": " + result.stderr);
  return JSON.parse(result.stdout);
}

test("viewer: a UTC history stamp is today in timezones 25 hours apart", () => {
  const ahead = inZone(AHEAD);
  const behind = inZone(BEHIND);

  // Without a working TZ database the two processes could both be UTC, and
  // equal relative labels would not demonstrate the boundary this test needs.
  assert.notEqual(
    ahead.local,
    behind.local,
    "the two timezones agree on the local day, so TZ was not applied and this test proves nothing"
  );

  assert.equal(ahead.relative, "today");
  assert.equal(behind.relative, "today");
});

test("positive control: mixing the local day with the UTC stamp differs by timezone", () => {
  const ahead = inZone(AHEAD);
  const behind = inZone(BEHIND);
  assert.equal(ahead.mixedDays, 1, "the ahead reader no longer reaches its local next day");
  assert.equal(behind.mixedDays, 0, "the behind reader no longer shares the UTC day");
});

test("viewer: the tested history function is pasted into the generated page", () => {
  const html = buildHtml([], computeStats([]));
  assert.match(html, /function histAgo\(ts, now = Date\.now\(\)\)/);
  assert.match(html, /getUTCFullYear\(\), today\.getUTCMonth\(\), today\.getUTCDate\(\)/);
});
