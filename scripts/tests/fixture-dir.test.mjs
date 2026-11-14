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
 *
 * A PROCESS THAT DOES NOT END NORMALLY (TL-745). Node emits no `exit` for a
 * signal, nor for the EPIPE that ends a test file whose runner was killed, so
 * those paths are proved separately: a child file is stopped while its
 * fixtures exist. Every such child also makes one directory with
 * `mkdtempSync` directly, which nothing removes — the same run then proves
 * that the listing would see a leftover, and that the child wrote into the
 * TMPDIR it was given.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { fixtureDir } from "./_fixture-dir.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";
import { STATE_DIR_ENV } from "../lock.mjs";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(what, predicate, ms = 30_000) {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timed out waiting for " + what);
    await sleep(50);
  }
}

/** Where a child test file finds the directory its own probes are written to. */
const PROBE_ENV = "FIXTURE_DIR_TEST_HOME";

// A test that fails before it stops its child would otherwise keep this file
// alive for the rest of that child's wait.
const started = [];
after(() => {
  for (const c of started) {
    if (alive(c.pid)) process.kill(c.pid, "SIGKILL");
    c.runner.kill("SIGKILL");
  }
});

/**
 * A child test file that makes fixtures through the helper — one at module
 * scope, one inside a test, one inside the `branchling-leak-*` directory it
 * makes directly — then writes `{ pid, added }` to a ready file and waits
 * `waitMs` inside its first test and `thenMs` inside a second. `added` is how
 * many SIGTERM listeners the fixtures installed. `extra` is source run after
 * the module-scope fixture.
 */
async function startStoppable({ waitMs = 60_000, thenMs = 0, extra = "" } = {}) {
  const tmp = fixtureDir(join(tmpdir(), "branchling-fixture-dir-tmp-"));
  const home = fixtureDir(join(tmpdir(), "branchling-fixture-dir-src-"));
  const file = join(home, "child.test.mjs");
  const ready = join(home, "ready");
  writeFileSync(file, `import { test } from "node:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"; // ${ALLOW}
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureDir } from ${HELPER_URL};
const before = process.listenerCount("SIGTERM");
const top = fixtureDir(join(tmpdir(), "branchling-top-"));
writeFileSync(join(top, "file"), "x");
const leak = mkdtempSync(join(tmpdir(), "branchling-leak-")); // ${ALLOW}
writeFileSync(join(fixtureDir(join(leak, "branchling-nested-")), "file"), "x");
${extra}
test("waits with its fixtures in place", async () => {
  writeFileSync(join(fixtureDir(join(tmpdir(), "branchling-inner-")), "file"), "x");
  writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid, added: process.listenerCount("SIGTERM") - before }));
  await new Promise((r) => setTimeout(r, ${waitMs}));
});
test("then waits again", async () => { await new Promise((r) => setTimeout(r, ${thenMs})); });
`, "utf8");
  const env = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, NO_COLOR: "1" };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  delete env.NODE_OPTIONS;
  // Unset, so the child makes its own lock-state fixture as well.
  delete env[STATE_DIR_ENV];
  env[PROBE_ENV] = home;
  const runner = spawn(process.execPath, ["--test", file], { env, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((r) => runner.once("close", r));
  runner.stdout.resume();
  runner.stderr.resume();
  try {
    await until("the child to make its fixtures", () => existsSync(ready) && readFileSync(ready, "utf8") !== "");
  } catch (e) {
    runner.kill("SIGKILL");
    throw e;
  }
  const { pid, added } = JSON.parse(readFileSync(ready, "utf8"));
  started.push({ runner, pid });
  return { runner, closed, tmp, home, filePid: pid, added };
}

/**
 * Wait for the child `c` to end after it was stopped, at most `ms`. A child
 * that ignores the stop would otherwise end on its own once its wait is over,
 * clean, and make the test pass for the wrong reason; past `ms` it is killed
 * and the test fails.
 */
async function stopped(c, what, ms = 15_000) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(what + " did not end within " + ms + " ms")), ms); });
  try {
    await Promise.race([c.closed.then(() => until(what, () => !alive(c.filePid), ms)), late]);
  } finally {
    clearTimeout(timer);
    if (alive(c.filePid)) process.kill(c.filePid, "SIGKILL");
    c.runner.kill("SIGKILL");
  }
}

/** What `c` left in its TMPDIR, the directly made leak checked and set aside. */
function leftBy(c) {
  const left = readdirSync(c.tmp);
  const leaks = left.filter((n) => n.startsWith("branchling-leak-"));
  // The positive control: the listing sees a directory nothing removes, and
  // the child wrote where it was told to.
  assert.equal(leaks.length, 1, "the child's direct mkdtempSync was not seen: " + left);
  // A fixture asked for inside another directory is made, and removed, there.
  const nested = readdirSync(join(c.tmp, leaks[0]));
  return { rest: left.filter((n) => n !== leaks[0]), nested };
}

// Spelled out, not imported from the helper: a list read from the code under
// test would shrink together with it.
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  test("a test file stopped by " + signal + " leaves no fixture behind", async () => {
    const c = await startStoppable();
    assert.equal(c.added, 1, "the helper installed its SIGTERM listener " + c.added + " times");
    process.kill(c.filePid, signal);
    await stopped(c, "a test file stopped by " + signal);
    const { rest, nested } = leftBy(c);
    assert.deepEqual({ rest, nested }, { rest: [], nested: [] }, "left behind by a test file stopped by " + signal);
  });
}

test("a signal another listener handles is not raised a second time", async () => {
  const c = await startStoppable({
    extra: `process.on("SIGTERM", () => {
  writeFileSync(join(process.env.${PROBE_ENV}, "seen"), "x", { flag: "a" });
  setTimeout(() => process.exit(0), 500);
});`,
  });
  process.kill(c.filePid, "SIGTERM");
  await stopped(c, "a test file whose own listener exits");
  // Raised again, the signal would reach that listener twice.
  assert.equal(readFileSync(join(c.home, "seen"), "utf8"), "x");
  const { rest, nested } = leftBy(c);
  assert.deepEqual({ rest, nested }, { rest: [], nested: [] });
});

test("a test file killed by SIGKILL leaves ONE directory, and it names its pid", async () => {
  const c = await startStoppable();
  process.kill(c.filePid, "SIGKILL");
  await stopped(c, "a test file killed by SIGKILL");
  const { rest, nested } = leftBy(c);
  assert.equal(rest.length, 1, "a killed process left more than one entry: " + rest);
  assert.ok(rest[0].startsWith("branchling-test-pid" + c.filePid + "-"), rest[0] + " does not name pid " + c.filePid);
  // Every fixture asked for at the top of the TMPDIR is inside it, and only those.
  assert.deepEqual(readdirSync(join(c.tmp, rest[0])).map((n) => n.replace(/-[^-]+$/, "")).sort(),
    ["branchling-inner", "branchling-test-fixture-state", "branchling-top"]);
  assert.deepEqual(nested.map((n) => n.replace(/-[^-]+$/, "")), ["branchling-nested"]);
});

test("a test file orphaned by a killed runner ends and leaves no fixture behind", async () => {
  // The second test would keep a file that survived its EPIPE alive well past
  // the wait below.
  const c = await startStoppable({ waitMs: 1_000, thenMs: 120_000 });
  c.runner.kill("SIGKILL");
  // Its next report to the runner that is gone fails with EPIPE and ends it.
  await stopped(c, "a test file orphaned by its runner");
  const { rest, nested } = leftBy(c);
  assert.deepEqual({ rest, nested }, { rest: [], nested: [] }, "left behind by a test file whose runner was killed");
});

test("an EPIPE somebody else handles leaves the fixtures in place", async () => {
  // Registered after the helper's own listener, so it runs only if the helper
  // let the error go on, and it reports whether the fixture was still there.
  const c = await startStoppable({
    waitMs: 1_000,
    thenMs: 120_000,
    extra: `process.stdout.on("error", () => writeFileSync(join(process.env.${PROBE_ENV}, "probe"), String(existsSync(top))));`,
  });
  const probe = join(c.home, "probe");
  try {
    c.runner.kill("SIGKILL");
    await c.closed;
    await until("the orphaned test file to handle its EPIPE", () => existsSync(probe) || !alive(c.filePid));
    assert.ok(existsSync(probe), "the helper ended the process instead of leaving the error to its other listener");
    assert.equal(readFileSync(probe, "utf8"), "true", "the fixtures were removed under a process that goes on");
  } finally {
    // The orphan would otherwise wait out its second test.
    if (alive(c.filePid)) process.kill(c.filePid, "SIGKILL");
  }
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
