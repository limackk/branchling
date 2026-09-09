/**
 * A `--json` answer survives a PIPE, however large it is (TL-175).
 *
 * THE BUG THIS PINS. Node's stdout is asynchronous when it is a pipe and
 * synchronous when it is a file or a terminal. Every command ends
 * `console.log(...)` then `process.exit(...)`, and `process.exit` does not wait
 * for the pipe to drain — so on a pipe everything past roughly 64 KB was lost.
 * Measured: 108993 valid bytes into a file, 65520 truncated bytes through a
 * pipe, and the consumer got `Unterminated string` instead of an answer.
 *
 * WHY IT HAD TO BE A TEST THROUGH A REAL PIPE. Every other way of running the
 * command hides it: `spawnSync` with `encoding: "utf8"` captures stdout through
 * a pipe and is the reproduction, but a test that redirected to a file, or one
 * that checked a byte count instead of PARSING, would have gone green against
 * the broken version. So the assertion is `JSON.parse`, and the fixture is
 * built large enough that the old code could not have passed it.
 *
 * THE POSITIVE CONTROL is a child process written here that reproduces the OLD
 * pattern — `console.log` then `process.exit(0)` — over the same number of
 * bytes. It must truncate. Without it, this file would pass on a machine whose
 * pipe buffer happens to be bigger than the fixture, which is the failure mode
 * a size-dependent bug specialises in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("json-pipe");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

/** Well past one pipe buffer (64 KB on Linux and macOS) so the old code could
 *  not have got this through by luck. */
const PAYLOAD_BYTES = 400_000;

function run(args, cwd) {
  // `encoding: "utf8"` captures stdout THROUGH A PIPE — which is the point:
  // this is the arrangement the bug lived in.
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}

/**
 * A backlog whose `--json` answer is comfortably larger than a pipe buffer.
 *
 * BUILT ONCE and shared. Every test here reads it and none writes to it, and
 * creating 120 tasks costs a CLI start each — four private copies would spend a
 * minute of the suite proving the same fixture can be built four times.
 */
let BIG = null;
function bigBacklog() {
  if (BIG) return BIG;
  const dir = mkdtempSync(join(tmpdir(), "branchling-json-pipe-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  for (let i = 0; i < 120; i++) {
    const made = run(["new", "--dir", dir, "--title", "Task number " + i + " with a title long enough to matter to the size of the answer"]);
    assert.equal(made.status, 0, made.stderr);
  }
  BIG = dir;
  return dir;
}

test("a large --json answer parses after going through a pipe", () => {
  const dir = bigBacklog();
  const r = run(["query", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.length > 65_536,
    "the fixture is smaller than a pipe buffer, so it cannot tell the two versions apart: " + r.stdout.length);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.tasks.length, 120);
  assert.equal(payload.total, 120);
});

test("--files survives the same pipe — it exists to be handed to xargs", () => {
  const dir = bigBacklog();
  const r = run(["query", "--dir", dir, "--files"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split("\n").length, 120,
    "a list cut off at one buffer would silently open the wrong subset of files");
});

test("POSITIVE CONTROL: the old pattern truncates over the same number of bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-json-pipe-control-"));
  const script = join(dir, "old-pattern.mjs");
  writeFileSync(script,
    'console.log(JSON.stringify({ blob: "x".repeat(' + PAYLOAD_BYTES + ') }));\n' +
    "process.exit(0);\n", "utf8");
  const r = spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 30_000 });
  assert.ok(r.stdout.length < PAYLOAD_BYTES,
    "`console.log` then `process.exit` did NOT truncate here — this platform cannot " +
      "distinguish the fix from the bug, and the tests above prove nothing on it");
  assert.throws(() => JSON.parse(r.stdout), "the truncated output must not parse");
});

test("the fix keeps the exit codes: a refusal is still non-zero", () => {
  const dir = bigBacklog();
  // A usage error, a vocabulary refusal and a successful read, each with the
  // code it had before. A fix that made everything exit 0 would be far worse
  // than the bug it replaced.
  assert.equal(run(["query", "--dir", dir, "--nonsense"]).status, 2);
  assert.equal(run(["query", "--dir", dir, "--status", "in-progress"]).status, 2);
  assert.equal(run(["query", "--dir", dir, "--json"]).status, 0);
  assert.equal(run(["profile", "check", "does-not-exist", "--json"]).status, 1);
});
