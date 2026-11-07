/**
 * An older release reading a newer backlog is told to upgrade (TL-586).
 *
 * WHAT WAS BROKEN. A backlog given `releases:` by v0.3.0 made v0.2.0 fail
 * every command that loads config.yaml with "unknown key `releases`" and the
 * advice that an unknown key is a typo. The file was right; the tool was old.
 *
 * WHAT HAS TO BE PROVED:
 *   1. Every key of DEFAULTS names the release that introduced it, and each
 *      release named is published or the next one — so a writer can compute
 *      the floor a key implies, and a new key without an entry fails here.
 *   2. A file whose `requires_version` is above what the build reads fails
 *      with both versions and the upgrade command, and with NO unknown-key
 *      list, even when it also carries keys and values this build rejects.
 *      Proved through the parser, through `loadConfig` and through the CLI.
 *   3. A floor this build satisfies reads normally, and a malformed one is an
 *      ordinary problem of its line, not an upgrade refusal.
 *   4. Without a floor, an unknown key with no near match says a newer
 *      release may have written it and which build is reading; a near match
 *      still says "did you mean", and a satisfied floor removes the excuse.
 *      An empty `requires_version` line states no floor (TL-592).
 *
 * An OLDER RELEASE is played by the parser's `readable`/`running` options: the
 * release under test is this one, and the scenario is a file one release
 * ahead of it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ConfigError, DEFAULTS, KEY_SINCE, READABLE_VERSION, formatConfigError, loadConfig, parseConfigYaml,
} from "../config.mjs";
import {
  REQUIRES_VERSION_KEY, compareVersions, findRequirement, parseVersion, readableVersion, requirementRefusal,
  shownVersion, upgradeCommand,
} from "../config-version.mjs";
import { PRODUCT_NAME as N, PRODUCT_VERSION } from "../product.mjs";
import { REPO_ROOT, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("config-requires-version");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const UPGRADE = "npm install -g " + N + "@latest";

/** A backlog directory holding only `config.yaml` with `text`. */
function backlogWith(text) {
  const dir = fixtureDir(join(tmpdir(), "requires-version-"));
  writeFileSync(join(dir, "config.yaml"), text, "utf8");
  return dir;
}

/** A backlog made by `init`, its config.yaml extended with `extra`. */
function initWith(extra) {
  const dir = join(fixtureDir(join(tmpdir(), "requires-version-cli-")), "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  appendFileSync(join(dir, "config.yaml"), extra, "utf8");
  return dir;
}

function cli(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", dir], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

/** One release past anything this build reads. */
function beyond(v) {
  const [major, minor] = parseVersion(v);
  return major + "." + (minor + 1) + ".0";
}

// ── 1. the release of every key ───────────────────────────────────────────

test("every key of DEFAULTS names a release, and no entry names a key DEFAULTS lacks", () => {
  // Positive control: the comparison below is over the real table, not an empty one.
  assert.ok(Object.keys(DEFAULTS).length > 40, "DEFAULTS looks empty");
  assert.deepEqual(Object.keys(KEY_SINCE).sort(), Object.keys(DEFAULTS).sort());
});

test("each release named is published or the next minor one, never further ahead", () => {
  const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const [major, minor] = parseVersion(version);
  const next = major + "." + (minor + 1) + ".0";
  for (const [key, since] of Object.entries(KEY_SINCE)) {
    assert.ok(parseVersion(since), key + " names `" + since + "`, which is not a release");
    assert.ok(compareVersions(since, version) <= 0 || since === next,
      key + " names " + since + ", neither published (≤ " + version + ") nor the next release (" + next + ")");
  }
});

test("the keys whose arrival broke older releases name the release that brought them", () => {
  // Measured from the DEFAULTS of each release tag on 2026-11-06.
  assert.equal(KEY_SINCE.task_id_prefix, "0.1.0");
  assert.equal(KEY_SINCE.conflict_group_from, "0.2.0");
  assert.equal(KEY_SINCE.closing_contract, "0.2.0");
  for (const k of ["releases", "deploy_targets", "release_gate", "release_gate_accept"]) {
    assert.equal(KEY_SINCE[k], "0.3.0", k);
  }
  // The floor key itself is newer than every published release, which is why
  // it is not written into a file that uses only older keys.
  assert.ok(compareVersions(KEY_SINCE[REQUIRES_VERSION_KEY], "0.3.0") > 0);
});

test("this build reads up to its newest key, and never below its own manifest", () => {
  for (const since of Object.values(KEY_SINCE)) assert.ok(compareVersions(READABLE_VERSION, since) >= 0, since);
  if (PRODUCT_VERSION) assert.ok(compareVersions(READABLE_VERSION, PRODUCT_VERSION) >= 0);
  assert.equal(readableVersion("2.0.0", { a: "1.0.0", b: "1.5.0" }), "2.0.0");
  assert.equal(readableVersion("1.0.0", { a: "1.0.0", b: "1.5.0" }), "1.5.0");
  assert.equal(readableVersion(null, { a: "1.5.0", b: "1.0.0" }), "1.5.0", "a broken install still reads its own keys");
  assert.equal(readableVersion("1.0.0", { a: "not-a-release" }), "1.0.0", "a malformed entry raises nothing");
});

// ── 2. a floor above the build refuses once, with both versions ───────────

const AHEAD = [
  "# A file written by a newer release.",
  "statuses: [todo, done]",
  "archived_statuses: [done]",
  REQUIRES_VERSION_KEY + ": 0.4.0   # the oldest release that reads it",
  "a_key_from_the_future: [x]",
  "title_max_length: not-a-number",
  "",
].join("\n");

test("PARSER: a floor one release ahead refuses with both versions and lists no key", () => {
  const r = parseConfigYaml(AHEAD, { readable: "0.3.0", running: "0.3.0" });
  assert.equal(r.problems.length, 1, r.problems.join("\n"));
  assert.match(r.problems[0], /^line 4: requires_version: 0\.4\.0 — this is \S+ 0\.3\.0$/);
  assert.doesNotMatch(r.problems.join("\n"), /unknown key|a_key_from_the_future|not a number/);
  assert.deepEqual(r.values, {}, "values read from a file this build cannot read are not values");
  assert.equal(r.requirement.required, "0.4.0");
  assert.equal(r.requirement.running, "0.3.0");
  assert.equal(r.requirement.headline, "this backlog needs " + N + " 0.4.0 or later");
  assert.ok(r.requirement.remedy.join("\n").includes(UPGRADE), r.requirement.remedy.join("\n"));
  assert.deepEqual(r.newerKeys, []);
});

test("PARSER: the same file read by a build that knows the floor gives the ordinary problems", () => {
  // The control for the test above: the keys it did not list really are wrong
  // for this build, so their absence there was the refusal's doing.
  const r = parseConfigYaml(AHEAD, { readable: "0.4.0", running: "0.4.0" });
  assert.equal(r.requirement, null);
  assert.ok(r.problems.some((p) => /unknown key `a_key_from_the_future` \(allowed:/.test(p)), r.problems.join("\n"));
  assert.ok(r.problems.some((p) => /title_max_length: `not-a-number` is not a number/.test(p)), r.problems.join("\n"));
});

test("PARSER: versions compare as numbers, so 0.10.0 is ahead of 0.9.0", () => {
  const text = REQUIRES_VERSION_KEY + ": 0.10.0\n";
  assert.ok(parseConfigYaml(text, { readable: "0.9.0", running: "0.9.0" }).requirement, "0.10.0 read as older than 0.9.0");
  assert.equal(parseConfigYaml(text, { readable: "0.10.0", running: "0.10.0" }).requirement, null);
  assert.equal(parseConfigYaml(text, { readable: "1.0.0", running: "1.0.0" }).requirement, null);
  assert.ok(parseConfigYaml("requires_version: 1.2.4\n", { readable: "1.2.3" }).requirement, "a patch ahead is ahead");
  assert.ok(parseConfigYaml("requires_version: 2.0.0\n", { readable: "1.9.9" }).requirement, "a major ahead is ahead");
});

test("LOAD: the error carries the upgrade headline and remedy, not the typo advice", () => {
  const ahead = beyond(READABLE_VERSION);
  const dir = backlogWith("statusez: [a]\n" + REQUIRES_VERSION_KEY + ": " + ahead + "\n");
  let err;
  try { loadConfig(dir); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError, "a floor above this build did not fail the load");
  const text = formatConfigError(err, N);
  assert.match(text, new RegExp("this backlog needs " + N + " " + ahead.replace(/\./g, "\\.") + " or later"));
  assert.ok(text.includes("this is " + N + " " + shownVersion(PRODUCT_VERSION)), text);
  assert.ok(text.includes(UPGRADE), text);
  assert.ok(text.includes("upgrades together"), text);
  assert.doesNotMatch(text, /unknown key|statusez|typo/, text);
});

test("CLI: `build` and `check` refuse a newer backlog once, naming both versions and the upgrade", () => {
  const ahead = beyond(READABLE_VERSION);
  const dir = initWith("\n" + REQUIRES_VERSION_KEY + ": \"" + ahead + "\"\nreleases_v2: [a]\n");
  // Positive control: the same backlog without the floor and the new key builds.
  const healthy = initWith("\n");
  assert.equal(cli(healthy, "build").status, 0, "the fixture fails without the floor");
  for (const cmd of ["build", "check"]) {
    const r = cli(dir, cmd);
    assert.equal(r.status, 1, cmd + ": " + r.stdout + r.stderr);
    assert.ok(r.stderr.includes(ahead) && r.stderr.includes(shownVersion(PRODUCT_VERSION)), cmd + ": " + r.stderr);
    assert.ok(r.stderr.includes(UPGRADE), cmd + ": " + r.stderr);
    assert.equal(r.stderr.split("this backlog needs").length - 1, 1, cmd + " said it more than once:\n" + r.stderr);
    assert.doesNotMatch(r.stderr, /unknown key|releases_v2/, cmd + ": " + r.stderr);
  }
});

// ── 3. a satisfied or malformed floor ─────────────────────────────────────

test("a floor this build reads is read as a value, and the rest of the file with it", () => {
  const dir = initWith("\n" + REQUIRES_VERSION_KEY + ": " + READABLE_VERSION + "  # the floor\n");
  const config = loadConfig(dir);
  assert.equal(config.requiresVersion, READABLE_VERSION);
  assert.equal(parseConfigYaml(readFileSync(join(dir, "config.yaml"), "utf8")).values[REQUIRES_VERSION_KEY], READABLE_VERSION);
  const b = cli(dir, "build");
  assert.equal(b.status, 0, "a satisfied floor stops `build`: " + b.stderr);
  assert.equal(loadConfig(backlogWith("project_name: None\n")).requiresVersion, null, "absent is null");
});

test("a malformed floor is a problem of its own line, not an upgrade refusal", () => {
  for (const bad of ["0.4", "v0.4.0", "0.4.0-rc.1", "01.4.0", "latest"]) {
    const r = parseConfigYaml("labels: []\n" + REQUIRES_VERSION_KEY + ": " + bad + "\n");
    assert.equal(r.requirement, null, bad);
    assert.deepEqual(r.problems, ["line 2: requires_version: expecting a release as major.minor.patch, got `" + bad + "`"], bad);
    assert.equal(r.values[REQUIRES_VERSION_KEY], undefined, bad);
  }
});

test("only a top-level line is the floor; an indented one belongs to the key above", () => {
  const lines = ["epic_aliases:", "  requires_version: 9.0.0", "requires_version: '1.2.3'"];
  assert.deepEqual(findRequirement(lines), { line: 3, value: "1.2.3" });
  assert.equal(findRequirement(["epic_aliases:", "  requires_version: 9.0.0"]), null);
  // Only a value quoted at BOTH ends loses its quotes.
  assert.equal(findRequirement(['requires_version: "1.2.3"x']).value, '"1.2.3"x');
  assert.equal(findRequirement(['requires_version: x"1.2.3"']).value, 'x"1.2.3"');
  assert.equal(parseConfigYaml("epic_aliases:\n  requires_version: 99.0.0\n").requirement, null);
});

// ── 4. an unknown key with no floor ───────────────────────────────────────

test("without a floor, an unknown key with no near match may come from a newer release", () => {
  const r = parseConfigYaml("labels: []\nsprint_calendar: weekly\n", { running: "0.3.0" });
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], new RegExp("^line 2: unknown key `sprint_calendar` — not a key of " + N +
    " 0\\.3\\.0, so a newer release may have written it \\(allowed: "));
  assert.deepEqual(r.newerKeys, ["sprint_calendar"]);
  assert.ok(r.problems[0].endsWith("(allowed: " + Object.keys(DEFAULTS).join(", ") + ")"), r.problems[0]);
  assert.match(parseConfigYaml("x_y_z: 1\n", { running: null }).problems[0], /not a key of \S+ of an unknown version/);
});

test("an empty floor line states no floor, so the newer-release hint stays (TL-592)", () => {
  // Every spelling of an empty value: the default written out states nothing.
  for (const empty of ['""', "''", ""]) {
    const r = parseConfigYaml(REQUIRES_VERSION_KEY + ": " + empty + "\nsprint_calendar: weekly\n", { running: "0.3.0" });
    assert.equal(r.requirement, null);
    assert.equal(r.problems.length, 1, empty + ": " + r.problems.join("\n"));
    assert.match(r.problems[0], new RegExp("^line 2: unknown key `sprint_calendar` — not a key of " + N +
      " 0\\.3\\.0, so a newer release may have written it \\(allowed: "), empty);
    assert.deepEqual(r.newerKeys, ["sprint_calendar"], empty);
  }
  // Control: the same file with a value on that line states a floor this
  // build satisfies, and the excuse is gone — so the case above is not a
  // parser that never suppresses the hint.
  // The lowest floor the parser accepts is the floor key's own release (TL-593).
  const stated = parseConfigYaml(REQUIRES_VERSION_KEY + ': "' + KEY_SINCE[REQUIRES_VERSION_KEY] +
    '"\nsprint_calendar: weekly\n', { running: "0.3.0" });
  assert.equal(stated.problems.length, 1, stated.problems.join("\n"));
  assert.equal(stated.requirement, null);
  assert.doesNotMatch(stated.problems[0], /newer release/);
  assert.deepEqual(stated.newerKeys, []);
});

test("LOAD: that error offers the upgrade beside the typo, and keeps the line", () => {
  let err;
  try { loadConfig(backlogWith("sprint_calendar: weekly\n")); } catch (e) { err = e; }
  assert.ok(err instanceof ConfigError);
  const text = formatConfigError(err, N);
  assert.ok(text.includes(UPGRADE), text);
  assert.ok(text.endsWith([
    "  → fix the file if the key is a typo. If a newer release wrote it, upgrade:",
    "    " + UPGRADE + " — a team that shares one backlog upgrades together.",
  ].join("\n")), text);
  assert.match(text, /line 1: unknown key `sprint_calendar`/);
});

test("a near match is still a typo, and a satisfied floor removes the newer-release excuse", () => {
  const near = parseConfigYaml("statusess: [a]\n");
  assert.equal(near.problems[0], "line 1: unknown key `statusess` — did you mean `statuses`?");
  assert.deepEqual(near.newerKeys, []);

  const floored = parseConfigYaml(REQUIRES_VERSION_KEY + ": " + KEY_SINCE[REQUIRES_VERSION_KEY] + "\nsprint_calendar: weekly\n");
  assert.equal(floored.problems.length, 1, floored.problems.join("\n"));
  assert.equal(floored.requirement, null);
  assert.equal(floored.problems[0], "line 2: unknown key `sprint_calendar` (allowed: " + Object.keys(DEFAULTS).join(", ") + ")");
  assert.doesNotMatch(floored.problems[0], /newer release/);
  assert.deepEqual(floored.newerKeys, []);

  let err;
  try { loadConfig(backlogWith("statusess: [a]\n")); } catch (e) { err = e; }
  const text = formatConfigError(err, N);
  assert.match(text, /an unknown\s+key is a typo, not a new capability/);
  assert.ok(!text.includes(UPGRADE), "a near typo is offered an upgrade:\n" + text);
});

// ── the pure helpers ──────────────────────────────────────────────────────

test("a version is major.minor.patch in digits, compared field by field", () => {
  assert.deepEqual(parseVersion("1.20.3"), [1, 20, 3]);
  assert.deepEqual(parseVersion("10.0.0"), [10, 0, 0]);
  assert.deepEqual(parseVersion("0.0.10"), [0, 0, 10]);
  for (const bad of ["1.2", "1.2.3.4", "01.2.3", "1.2.3-rc", " 1.2.3", "", null, 1]) assert.equal(parseVersion(bad), null, String(bad));
  assert.equal(parseVersion("0.0.0").length, 3);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.ok(compareVersions("0.3.1", "0.3.0") > 0);
  assert.ok(compareVersions("0.3.0", "0.3.1") < 0);
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
  assert.throws(() => compareVersions("0.3", "0.3.0"), /not a version: "0\.3"/);
  assert.throws(() => compareVersions("0.3.0", "x"), /not a version: "x"/);
});

test("the refusal and the upgrade command are built from the product name", () => {
  assert.equal(upgradeCommand("tool"), "npm install -g tool@latest");
  assert.equal(shownVersion("1.2.3"), "1.2.3");
  assert.equal(shownVersion(null), "of an unknown version");
  const r = requirementRefusal("2.0.0", "1.0.0", "tool");
  assert.equal(r.headline, "this backlog needs tool 2.0.0 or later");
  assert.deepEqual(r.problems, ["requires_version: 2.0.0 — this is tool 1.0.0"]);
  assert.deepEqual(r.remedy, [
    "  → upgrade: npm install -g tool@latest",
    "    the file is not wrong; it uses what a newer release added. A team that",
    "    shares one backlog reads it with 2.0.0 or later, so it upgrades together.",
  ]);
});
