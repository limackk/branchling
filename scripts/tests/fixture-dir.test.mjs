/**
 * A test fixture's temporary directory is removed when its test file ends,
 * on a pass and on a failure (TL-575).
 *
 * TWO HALVES. The behaviour of `fixtureDir` is proved on child processes with
 * a private `TMPDIR`, because a file cannot observe what its own exit leaves
 * behind. The RULE that keeps the suite on it — no test file calls
 * `mkdtempSync` or `mkdtemp` itself — is a scan of `scripts/tests/`. A call a
 * test makes on purpose (a child that is meant to leak, as a positive control)
 * is marked `fixture-dir: allow` beside that ONE line.
 *
 * Both halves carry a positive control: a scan that finds nothing and a
 * private directory that stays empty are also what a blind detector reports.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("fixture-dir");

const TESTS_DIR = join(SCRIPTS_DIR, "tests");
const HELPER = join(TESTS_DIR, "_fixture-dir.mjs");
const ALLOW = "fixture-dir: allow";

/** Lines of `text` that create a temporary directory without the helper. */
export function directCalls(text) {
  return text.split("\n")
    .map((line, i) => ({ line: i + 1, text: line }))
    .filter((l) => /\bmkdtemp(Sync)?\b/.test(l.text) && !l.text.includes(ALLOW));
}

function testSources(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "fixtures" ? [] : testSources(path);
    return path.endsWith(".mjs") ? [path] : [];
  });
}

/** Run `source` as a test file with `TMPDIR` pointed at a fresh directory. */
function runChild(source) {
  const tmp = fixtureDir(join(tmpdir(), "branchling-fixture-dir-tmp-"));
  const home = fixtureDir(join(tmpdir(), "branchling-fixture-dir-src-"));
  const file = join(home, "child.test.mjs");
  writeFileSync(file, source, "utf8");
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, NO_COLOR: "1" };
  // An inherited marker would make the child report upwards instead of running.
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ["--test", file], { encoding: "utf8", env, timeout: 60_000 });
  return { status: r.status, output: (r.stdout || "") + (r.stderr || ""), left: readdirSync(tmp) };
}

const HELPER_URL = JSON.stringify(pathToFileURL(HELPER).href);

test("a fixture made by a FAILING test is gone once its file has run", () => {
  const r = runChild(
    `import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir } from ${HELPER_URL};
const top = fixtureDir(join(tmpdir(), "branchling-top-"));
writeFileSync(join(top, "file"), "x");
test("fails after making a fixture", () => {
  const inner = fixtureDir(join(tmpdir(), "branchling-inner-"));
  writeFileSync(join(inner, "file"), "x");
  throw new Error("deliberate failure");
});
`);
  assert.notEqual(r.status, 0, "the child was meant to fail:\n" + r.output);
  assert.match(r.output, /deliberate failure/, r.output);
  assert.deepEqual(r.left, [], "left behind by a failing test file");
});

test("positive control: a directory made with mkdtempSync directly is counted", () => {
  const r = runChild(
    `import { test } from "node:test";
import { mkdtempSync } from "node:fs"; // ${ALLOW}
import { tmpdir } from "node:os";
import { join } from "node:path";
test("leaks", () => { mkdtempSync(join(tmpdir(), "branchling-leak-")); }); // ${ALLOW}
`);
  assert.equal(r.status, 0, r.output);
  // Without this, the empty directory above is also what a child that ignored
  // TMPDIR and wrote into the real temporary directory would leave here.
  assert.equal(r.left.filter((n) => n.startsWith("branchling-leak-")).length, 1,
    "the child did not create its directory in the TMPDIR it was given");
});

test("no test file creates a temporary directory except through fixtureDir", () => {
  // The helper is the one sanctioned caller; this file spells the names out
  // in fixtures and in its own positive controls.
  const self = join(TESTS_DIR, "fixture-dir.test.mjs");
  const files = testSources(TESTS_DIR).filter((f) => f !== HELPER && f !== self);
  const users = files.filter((f) => readFileSync(f, "utf8").includes("fixtureDir("));
  // A scan over a sample that never used the helper would pass for nothing.
  assert.ok(users.length >= 100, "only " + users.length + " test files use fixtureDir — the scan reads the wrong tree");
  const offenders = files.flatMap((f) =>
    directCalls(readFileSync(f, "utf8")).map((l) => relative(SCRIPTS_DIR, f) + ":" + l.line + ": " + l.text.trim()));
  assert.deepEqual(offenders, [],
    "create the directory with fixtureDir from ./_fixture-dir.mjs, which removes it when the file ends, " +
    "or mark a deliberate call `" + ALLOW + "` on its line");
});

test("positive control: the scan flags a direct call and honours the marker", () => {
  assert.equal(directCalls(readFileSync(HELPER, "utf8")).length > 0, true, "the helper's own call was not seen");
  assert.equal(directCalls('const d = mkdtempSync(join(tmpdir(), "x-"));').length, 1);
  assert.equal(directCalls('const d = await mkdtemp(join(tmpdir(), "x-"));').length, 1);
  assert.equal(directCalls('mkdtempSync(p); // ' + ALLOW).length, 0);
});
