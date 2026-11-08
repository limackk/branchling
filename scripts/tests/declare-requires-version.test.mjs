/**
 * `declare` raises the floor a key implies, in the same diff (TL-586).
 *
 * WHAT HAS TO BE PROVED:
 *   1. Declaring into a key introduced in a release raises `requires_version`
 *      to that release when the file states a lower floor, and keeps the
 *      floor's line and comment, and the command says so on a line of its own
 *      and in `--json` as `requiresVersion`. Since TL-593 no floor the parser
 *      accepts is below a key `declare` writes today, so the command is run
 *      with a release table of its own (TL-612).
 *   2. A floor at or above the key's release is left byte for byte alone.
 *   3. With no floor, one is written only when the key is newer than
 *      `requires_version` itself — otherwise writing it would make the file
 *      unreadable to releases that read it today.
 *   4. A build older than the file's floor refuses before writing anything.
 *
 * The keys `declare` writes today all predate `requires_version`, so case 3's
 * "written" half is proved through the pure writer with a release table of
 * its own, the seam `appendEntryText` takes for exactly this — and both
 * halves through the command's own `run`, which takes the same table.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { KEY_SINCE, READABLE_VERSION, parseConfigYaml } from "../config.mjs";
import { REQUIRES_VERSION_KEY, compareVersions, parseVersion, raisedRequirement, setRequirementText } from "../config-version.mjs";
import { WRITABLE_KEYS, appendEntryText } from "../declare-vocabulary.mjs";
import { stripComment } from "../task-fields.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("declare-requires-version");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function cli(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", dir], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

function fixture(extra) {
  const dir = join(fixtureDir(join(tmpdir(), "declare-floor-")), "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir, "--no-example"], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  if (extra) appendFileSync(join(dir, "config.yaml"), extra);
  return dir;
}

const read = (dir) => readFileSync(join(dir, "config.yaml"), "utf8");
const floorOf = (text) => parseConfigYaml(text).values[REQUIRES_VERSION_KEY];
const RELEASES_SINCE = KEY_SINCE.releases;

// ── 1. a lower floor is raised ────────────────────────────────────────────
//
// With the shipped release table this case cannot be built (TL-593): a floor
// below `KEY_SINCE.requires_version` is a parse problem, and every key
// `declare` writes predates `requires_version`, so no floor the parser accepts
// is lower than a writable key's release. The command is therefore run in a
// child process through its own `run`, with a release table of its own — the
// same seam `appendEntryText` takes (TL-612). The guard below fails the day a
// writable key is newer than the floor key, when the plain CLI reaches it too.

test("every key `declare` writes predates `requires_version`, so the CLI has no floor to raise", () => {
  // Positive control: the loop runs over the real list.
  assert.ok(WRITABLE_KEYS.length >= 2, "no writable keys");
  for (const key of WRITABLE_KEYS) {
    assert.ok(compareVersions(KEY_SINCE[key], KEY_SINCE[REQUIRES_VERSION_KEY]) <= 0,
      "`" + key + "` is newer than `" + REQUIRES_VERSION_KEY + "`: restore a CLI test of the raise and its text line");
  }
});

const DECLARE = pathToFileURL(join(SCRIPTS_DIR, "declare-vocabulary.mjs")).href;

/** `declare` as the CLI runs it — its own process, stdout, stderr and exit
 *  code — with only the release table replaced. */
function declareWith(since, dir, ...args) {
  const src = "import { run } from " + JSON.stringify(DECLARE) + ";\n" +
    "process.exitCode = run(JSON.parse(process.argv[1]), { since: JSON.parse(process.argv[2]) });";
  return spawnSync(process.execPath, ["--input-type=module", "-e", src, JSON.stringify([...args, "--dir", dir]), JSON.stringify(since)],
    { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

const RAISING = { ...KEY_SINCE, releases: "7.1.0", [REQUIRES_VERSION_KEY]: "7.0.0" };
// The written floor is above this build, so it is read back as the table's build would.
const raisedFloorOf = (dir) => parseConfigYaml(read(dir), { readable: "7.1.0" }).values[REQUIRES_VERSION_KEY];

test("the command raises a lower floor, prints the raise and answers it in --json", () => {
  // Positive control: the same runner with the shipped table raises nothing,
  // so what follows is the table's doing, not the runner's.
  const plain = fixture("\n" + REQUIRES_VERSION_KEY + ": " + KEY_SINCE[REQUIRES_VERSION_KEY] + "\n");
  const control = declareWith(KEY_SINCE, plain, "releases", "1.0", "--reason", "a cut", "--json");
  assert.equal(control.status, 0, control.stderr);
  assert.equal(JSON.parse(control.stdout).requiresVersion, null);

  const json = fixture("\n" + REQUIRES_VERSION_KEY + ": 7.0.0  # why\n");
  const j = declareWith(RAISING, json, "releases", "1.0", "--reason", "a cut", "--json");
  assert.equal(j.status, 0, j.stdout + j.stderr);
  const out = JSON.parse(j.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.requiresVersion, { from: "7.0.0", to: "7.1.0" });
  assert.match(read(json), /^requires_version: 7\.1\.0  # why$/m);

  const text = fixture("\n" + REQUIRES_VERSION_KEY + ": 7.0.0\n");
  const t = declareWith(RAISING, text, "releases", "1.0", "--reason", "a cut");
  assert.equal(t.status, 0, t.stdout + t.stderr);
  assert.ok(t.stdout.split("\n").includes("  " + REQUIRES_VERSION_KEY +
    ": 7.0.0 → 7.1.0 — `releases` arrived in 7.1.0, so an older release cannot read this file"), t.stdout);
  assert.equal(raisedFloorOf(text), "7.1.0");
});

test("the command writes a floor where there was none, and prints it as raised from none", () => {
  const json = fixture("");
  const j = declareWith(RAISING, json, "releases", "1.0", "--reason", "the first cut", "--json");
  assert.equal(j.status, 0, j.stdout + j.stderr);
  assert.deepEqual(JSON.parse(j.stdout).requiresVersion, { from: null, to: "7.1.0" });

  const text = fixture("");
  const t = declareWith(RAISING, text, "releases", "1.0", "--reason", "the first cut");
  assert.equal(t.status, 0, t.stdout + t.stderr);
  assert.ok(t.stdout.split("\n").includes("  " + REQUIRES_VERSION_KEY +
    ": none → 7.1.0 — `releases` arrived in 7.1.0, so an older release cannot read this file"), t.stdout);
  assert.equal(raisedFloorOf(text), "7.1.0");
});

// ── 2. a floor at or above the key's release stays ────────────────────────

// A floor EQUAL to `releases` cannot reach the CLI: since TL-593 it is below
// the floor key's own release, so it is a parse problem. That case is proved
// through the pure writer — "PURE: a lower floor is raised in place, an equal
// one stays" below.

test("through the CLI, the floor key's own release and the newest floor this build reads are left alone", () => {
  // The floor this build reads is the highest it can leave in place; a test
  // above THAT would be the refusal case below, not this one.
  assert.ok(compareVersions(READABLE_VERSION, RELEASES_SINCE) > 0, "no floor above `releases` is readable here");
  // The lowest floor the parser accepts is the floor key's own release (TL-593),
  // and the highest is READABLE_VERSION. While the two are equal they are one
  // floor, so the list is deduplicated rather than run twice (TL-621).
  const floorKeySince = KEY_SINCE[REQUIRES_VERSION_KEY];
  const floors = [...new Set([floorKeySince, READABLE_VERSION])];
  const apart = compareVersions(READABLE_VERSION, floorKeySince) > 0;
  assert.equal(floors.length, apart ? 2 : 1,
    "distinct floors through the CLI: " + floors.join(", ") + (apart ? "" : " — READABLE_VERSION " +
      READABLE_VERSION + " equals the floor key's release, so one floor is exercised; " +
      "a second returns when READABLE_VERSION moves past it"));
  for (const floor of floors) {
    assert.ok(compareVersions(floor, RELEASES_SINCE) > 0, floor + " is not above `releases`");
    const dir = fixture("\n" + REQUIRES_VERSION_KEY + ": " + floor + "\n");
    const r = cli(dir, "declare", "releases", "2.0", "--reason", "a later cut", "--json");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).requiresVersion, null, floor);
    assert.equal(floorOf(read(dir)), floor, floor);
    assert.ok(!r.stdout.includes("→"));
  }
  const plain = fixture("\n" + REQUIRES_VERSION_KEY + ": " + READABLE_VERSION + "\n");
  const t = cli(plain, "declare", "releases", "2.0", "--reason", "a later cut");
  assert.equal(t.status, 0, t.stderr);
  assert.doesNotMatch(t.stdout, new RegExp(REQUIRES_VERSION_KEY), "an untouched floor was reported as raised");
});

// ── 3. no floor ───────────────────────────────────────────────────────────

test("with no floor, a key older than `requires_version` writes none", () => {
  assert.ok(compareVersions(RELEASES_SINCE, KEY_SINCE[REQUIRES_VERSION_KEY]) < 0,
    "the premise: `releases` predates the floor key");
  const dir = fixture("");
  const r = cli(dir, "declare", "releases", "1.0", "--reason", "the first public cut", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).requiresVersion, null);
  assert.doesNotMatch(read(dir), new RegExp("^" + REQUIRES_VERSION_KEY + ":", "m"),
    "a floor key a 0.3.0 reader rejects was written into a file 0.3.0 reads");
});

const BASE = ["# A project's vocabulary.", "", "statuses: [todo, done]", "archived_statuses: [done]", ""].join("\n");
const TABLE = { ...KEY_SINCE, releases: "7.1.0", [REQUIRES_VERSION_KEY]: "7.0.0" };

test("PURE: with no floor, a key newer than `requires_version` writes one above the first key", () => {
  const r = appendEntryText(BASE, "releases", { name: "1.0", ref: null }, "the first cut", TABLE);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.requiresVersion, { from: null, to: "7.1.0" });
  const lines = r.text.split("\n");
  assert.equal(lines[0], "# A project's vocabulary.");
  assert.match(lines[2], /^# The oldest \S+ release that can read this file; the commands that write a key raise it\.$/);
  assert.equal(lines[3], REQUIRES_VERSION_KEY + ": 7.1.0");
  assert.equal(lines[4], "statuses: [todo, done]");
  const values = parseConfigYaml(r.text, { readable: "7.1.0" }).values;
  assert.deepEqual(values.statuses, ["todo", "done"]);
  assert.deepEqual(values.releases, [{ name: "1.0", ref: null }]);
});

test("PURE: a lower floor is raised in place, an equal one stays, and both keep their comment", () => {
  const lower = appendEntryText(BASE + REQUIRES_VERSION_KEY + ": 7.0.0  # why\n", "releases", { name: "1.0", ref: null }, "a cut", TABLE);
  assert.ok(lower.ok, JSON.stringify(lower));
  assert.deepEqual(lower.requiresVersion, { from: "7.0.0", to: "7.1.0" });
  assert.match(lower.text, /^requires_version: 7\.1\.0  # why$/m);
  assert.doesNotMatch(lower.text, /# The oldest/, "an existing floor gained a second comment");

  const equal = appendEntryText(BASE + REQUIRES_VERSION_KEY + ": 7.1.0  # why\n", "releases", { name: "1.0", ref: null }, "a cut", TABLE);
  assert.ok(equal.ok, JSON.stringify(equal));
  assert.equal(equal.requiresVersion, null);
  assert.match(equal.text, /^requires_version: 7\.1\.0  # why$/m);
});

test("PURE: the default table leaves a file with no floor without one", () => {
  const r = appendEntryText(BASE, "releases", { name: "1.0", ref: null }, "a cut");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.requiresVersion, null);
  assert.ok(!r.text.includes(REQUIRES_VERSION_KEY));
});

test("PURE: a malformed floor is refused as unreadable, with no upgrade offered", () => {
  const r = appendEntryText(BASE + REQUIRES_VERSION_KEY + ": soon\n", "releases", { name: "1.0", ref: null }, "a cut");
  assert.equal(r.ok, false);
  assert.equal(r.kind, "unreadable");
  assert.deepEqual(r.details, ["line 5: requires_version: expecting a release as major.minor.patch, got `soon`"]);
});

// ── 4. a build older than the file refuses ────────────────────────────────

test("a build older than the file's floor writes nothing", () => {
  const [major, minor] = parseVersion(READABLE_VERSION);
  const ahead = major + "." + (minor + 1) + ".0";
  const dir = fixture("\n" + REQUIRES_VERSION_KEY + ": " + ahead + "\n");
  const before = read(dir);
  const r = cli(dir, "declare", "releases", "1.0", "--reason", "a cut", "--json");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.refusalKind, "unreadable");
  assert.equal(out.refusal, "config.yaml cannot be read, so it cannot be edited safely");
  assert.ok(out.details.some((d) => d.includes(ahead)), JSON.stringify(out.details));
  assert.ok(out.details.some((d) => d.startsWith("→ upgrade: npm install -g ")), JSON.stringify(out.details));
  assert.equal(read(dir), before, "the file changed under a refusal");
});

// ── the pure rules ────────────────────────────────────────────────────────

test("raisedRequirement: raise when lower, write fresh only above the floor key, never lower", () => {
  const t = { old: "1.0.0", floorKey: "2.0.0", fresh: "3.0.0", [REQUIRES_VERSION_KEY]: "2.0.0" };
  assert.equal(raisedRequirement("1.5.0", "floorKey", t), "2.0.0", "a lower floor is raised");
  assert.equal(raisedRequirement("2.0.0", "floorKey", t), null, "an equal floor stays");
  assert.equal(raisedRequirement("2.5.0", "floorKey", t), null, "a higher floor stays");
  assert.equal(raisedRequirement("2.5.0", "fresh", t), "3.0.0");
  assert.equal(raisedRequirement("", "fresh", t), "3.0.0", "absent, and the key is newer than the floor key");
  assert.equal(raisedRequirement(null, "fresh", t), "3.0.0");
  assert.equal(raisedRequirement(undefined, "floorKey", t), null, "absent, and the key is as old as the floor key");
  assert.equal(raisedRequirement("", "old", t), null, "absent, and the key is older than the floor key");
  assert.equal(raisedRequirement("0.1.0", "old", t), "1.0.0");
  assert.equal(raisedRequirement("", "unknown_key", t), null);
  assert.equal(raisedRequirement("garbage", "fresh", t), "3.0.0", "a malformed floor reads as absent");
});

test("setRequirementText keeps the line ending, and a file with no key gains the floor at its end", () => {
  const crlf = setRequirementText("# head\r\nlabels: []\r\n", "1.2.3", "tool", stripComment);
  assert.equal(crlf, "# head\r\n# The oldest tool release that can read this file; the commands that write a key raise it.\r\n" +
    "requires_version: 1.2.3\r\nlabels: []\r\n");
  assert.equal(setRequirementText("# only a comment", "1.2.3", "tool", stripComment),
    "# only a comment\n# The oldest tool release that can read this file; the commands that write a key raise it.\nrequires_version: 1.2.3");
  assert.equal(setRequirementText("requires_version: 1.0.0\nlabels: []", "1.2.3", "tool", stripComment),
    "requires_version: 1.2.3\nlabels: []");
  const head = "# The oldest tool release that can read this file; the commands that write a key raise it.\n";
  assert.equal(setRequirementText("epic_aliases:\n  requires_version: x\n", "1.2.3", "tool", stripComment),
    head + "requires_version: 1.2.3\nepic_aliases:\n  requires_version: x\n", "an indented line is not the floor");
  assert.equal(setRequirementText("requires_version_x: 1\nlabels: []", "1.2.3", "tool", stripComment),
    head + "requires_version: 1.2.3\nrequires_version_x: 1\nlabels: []", "a longer key is not the floor");
  assert.equal(setRequirementText("  stray\nlabels: []", "1.2.3", "tool", stripComment),
    "  stray\n" + head + "requires_version: 1.2.3\nlabels: []", "the first KEY is a top-level line");
});
