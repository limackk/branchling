/**
 * A floor below the release that introduced `requires_version` is reported
 * (TL-593).
 *
 * WHAT WAS BROKEN. The parser accepted any `major.minor.patch` as a floor, so
 * `requires_version: 0.2.0` read cleanly. But a release older than
 * `KEY_SINCE.requires_version` does not know the key at all and refuses it as
 * unknown, so such a floor can never take effect: it claims that 0.2.0 reads
 * the file, and 0.2.0 does not. `declare` then raised it to 0.3.0, which is
 * just as false.
 *
 * THE DECISION: REPORT, DO NOT RAISE. The floor is a problem of its own line,
 * like a malformed one. Raising it in `declare` would correct only the files
 * `declare` writes, and leave a hand-written floor misleading forever. No
 * published release accepts the key, so no file that reads today was written
 * by a release that allowed this.
 *
 * WHAT HAS TO BE PROVED:
 *   1. A floor below the key's release is one problem of its line, naming
 *      both versions, through the parser and through `loadConfig`.
 *   2. A floor AT the key's release, and one above it, read with no problem —
 *      the control that this is not a parser that rejects every floor. While
 *      this build reads no floor above the key's release, the one above is
 *      read through the parser's `readable` seam, standing in for a newer
 *      reader (TL-621).
 *   3. `declare` refuses such a file before writing, instead of raising the
 *      floor to another release that cannot read it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigError, KEY_SINCE, READABLE_VERSION, loadConfig, parseConfigYaml } from "../config.mjs";
import { REQUIRES_VERSION_KEY, compareVersions, parseVersion } from "../config-version.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("config-floor-below-key");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const SINCE = KEY_SINCE[REQUIRES_VERSION_KEY];

/** Every release below `since` worth naming: the patch, minor and major below it. */
function below(since) {
  const [major, minor, patch] = parseVersion(since);
  const out = [];
  if (patch > 0) out.push(major + "." + minor + "." + (patch - 1));
  if (minor > 0) out.push(major + "." + (minor - 1) + ".0", major + "." + (minor - 1) + ".99");
  if (major > 0) out.push((major - 1) + ".99.99");
  out.push("0.0.0");
  return [...new Set(out)].filter((v) => compareVersions(v, since) < 0);
}

const message = (floor, line) =>
  "line " + line + ": " + REQUIRES_VERSION_KEY + ": " + floor + " is below " + SINCE +
  ", the release that introduced `" + REQUIRES_VERSION_KEY + "`, so no release can enforce it — state " +
  SINCE + " or later";

// ── 1. a floor below the key's release ────────────────────────────────────

test("a floor below the release that introduced requires_version is a problem of its line", () => {
  const lower = below(SINCE);
  // Positive control: the loop below runs, and over releases that really are lower.
  assert.ok(lower.length >= 2, "no release below " + SINCE + " to test with");
  for (const floor of lower) {
    for (const spelled of [floor, '"' + floor + '"', "'" + floor + "'"]) {
      const r = parseConfigYaml("labels: []\n" + REQUIRES_VERSION_KEY + ": " + spelled + "   # by hand\n");
      assert.equal(r.requirement, null, spelled);
      assert.deepEqual(r.problems, [message(floor, 2)], spelled);
    }
  }
});

test("LOAD: such a floor fails loadConfig, and the error names it", () => {
  const [floor] = below(SINCE);
  const dir = fixtureDir(join(tmpdir(), "floor-below-key-"));
  writeFileSync(join(dir, "config.yaml"), REQUIRES_VERSION_KEY + ": " + floor + "\n", "utf8");
  let err;
  try { loadConfig(dir); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError, String(err));
  assert.ok(err.problems.includes(message(floor, 1)), JSON.stringify(err.problems));
});

// ── 2. the control: a floor at or above it ────────────────────────────────

test("a floor at that release, or above it for a reader that reads it, is left alone", () => {
  assert.ok(compareVersions(READABLE_VERSION, SINCE) >= 0, "this build cannot read its own floor key");
  // The floors THIS build reads at or above the key's release. They are one
  // floor while READABLE_VERSION equals it, and a loop over both literals would
  // run the same case twice while reading as if it proved two (TL-621).
  const floors = [...new Set([SINCE, READABLE_VERSION])];
  const above = compareVersions(READABLE_VERSION, SINCE) > 0;
  assert.equal(floors.length, above ? 2 : 1,
    "distinct floors this build reads: " + floors.join(", ") + (above ? "" : " — READABLE_VERSION " +
      READABLE_VERSION + " equals " + SINCE + ", so no floor above the key's release is readable here; " +
      "this loop covers one again when READABLE_VERSION moves past it"));
  for (const floor of floors) {
    const r = parseConfigYaml("labels: []\n" + REQUIRES_VERSION_KEY + ": " + floor + "\n");
    assert.deepEqual(r.problems, [], floor);
    assert.equal(r.values[REQUIRES_VERSION_KEY], floor, floor);
  }
  // A floor strictly above the key's release, read by a reader as new as it:
  // the case the loop above cannot reach while it collapses.
  const [major, minor] = parseVersion(SINCE);
  const higher = major + "." + (minor + 1) + ".0";
  assert.ok(compareVersions(higher, SINCE) > 0, higher + " is not above " + SINCE);
  const r = parseConfigYaml("labels: []\n" + REQUIRES_VERSION_KEY + ": " + higher + "\n", { readable: higher });
  assert.deepEqual(r.problems, [], higher);
  assert.equal(r.values[REQUIRES_VERSION_KEY], higher, higher);
  // An empty floor states none (TL-592), so it is not below anything.
  assert.deepEqual(parseConfigYaml(REQUIRES_VERSION_KEY + ': ""\n').problems, []);
});

// ── 3. declare refuses rather than raising ────────────────────────────────

test("declare refuses a file whose floor is below the key's release, and writes nothing", () => {
  const [floor] = below(SINCE);
  const dir = join(fixtureDir(join(tmpdir(), "floor-below-key-cli-")), "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  appendFileSync(join(dir, "config.yaml"), "\n" + REQUIRES_VERSION_KEY + ": " + floor + "\n");
  const before = readFileSync(join(dir, "config.yaml"), "utf8");
  const r = spawnSync(process.execPath,
    [CLI, "declare", "releases", "1.0", "--reason", "the first cut", "--json", "--dir", dir],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.refusalKind, "unreadable");
  assert.ok(out.details.some((d) => d.endsWith(message(floor, 1).slice(message(floor, 1).indexOf(":") + 2))),
    JSON.stringify(out.details));
  assert.equal(readFileSync(join(dir, "config.yaml"), "utf8"), before, "the file changed under a refusal");
});
