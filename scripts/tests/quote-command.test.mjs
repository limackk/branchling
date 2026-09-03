/**
 * `quote` end to end, over a real backlog on disk (TL-88).
 *
 * WHAT THIS ADDS TO `quote.test.mjs`, which tests the forecast itself: the three
 * answers the COMMAND gives, and the exit code each carries. Those are the
 * contract a script wraps, and none of them is visible from the pure function —
 * a forecast object with `insufficient: true` says nothing about whether the
 * process exited 0.
 *
 * THE EXIT CODES ARE THE POINT.
 *   0  answered — and "not enough data" IS an answer. A non-zero exit there
 *      would make an honest refusal look to a pipeline like a broken command,
 *      which is the same mistake `stats --correlation-only` avoids.
 *   1  no such task — an envelope with `quote: null` under `--json`, so a
 *      consumer does not have to parse stderr to learn the id was wrong.
 *   2  the task exists and has no estimate — an INPUT error. "Not enough data"
 *      there would blame the backlog for a field somebody has not filled in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isolateHome } from "./_repo.mjs";

isolateHome("quote-command");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
}

/** A backlog with one task, and no measured time anywhere — the state every
 *  fresh clone is in, and the one the command has to answer honestly. */
function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-quote-"));
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  const made = run(dir, ["new", "--dir", ".", "--title", "A task to quote"]);
  assert.equal(made.status, 0, made.stderr);
  return { dir, id: (made.stdout.match(/([A-Z]+-\d+)/) || [])[1] };
}

function taskFile(dir, id) {
  return join(dir, "tasks", readdirSync(join(dir, "tasks")).find((f) => f.startsWith(id + "-")));
}

test("a bucket with nothing in it answers `not enough data` and exits 0", () => {
  const { dir, id } = backlog();
  const r = run(dir, ["quote", id, "--dir", "."]);
  assert.equal(r.status, 0, "a refusal for want of data is an ANSWER, not a broken command");
  assert.match(r.stdout, /not enough data/);
  assert.match(r.stdout, /threshold n>=/);
});

test("--json carries the keys the text output shows, and the same verdict", () => {
  const { dir, id } = backlog();
  const r = run(dir, ["quote", id, "--json", "--dir", "."]);
  assert.equal(r.status, 0);
  const q = JSON.parse(r.stdout).quote;
  for (const key of ["task", "estimate", "bucket", "degraded", "n", "minN", "insufficient", "time", "tokens", "unknownRatio"]) {
    assert.ok(key in q, "`" + key + "` is missing from the envelope");
  }
  assert.equal(q.insufficient, true);
  assert.equal(q.tokens, null, "no adapter means no column — null, not an empty list");
});

test("a task with no estimate is a usage error, not an empty answer", () => {
  const { dir, id } = backlog();
  const file = taskFile(dir, id);
  writeFileSync(file, readFileSync(file, "utf8").replace(/^estimate: .*$/m, 'estimate: ""'), "utf8");
  const r = run(dir, ["quote", id, "--dir", "."]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /needs an estimate/);
});

test("an id that does not exist exits 1, and under --json it is still an envelope", () => {
  const { dir } = backlog();
  const plain = run(dir, ["quote", "TL-9999", "--dir", "."]);
  assert.equal(plain.status, 1);
  const asJson = run(dir, ["quote", "TL-9999", "--json", "--dir", "."]);
  assert.equal(asJson.status, 1);
  const payload = JSON.parse(asJson.stdout);
  assert.equal(payload.kind, "quote");
  assert.equal(payload.quote, null);
});

test("an unknown flag and a missing id are both usage errors", () => {
  const { dir, id } = backlog();
  assert.equal(run(dir, ["quote", id, "--nonsense", "--dir", "."]).status, 2);
  assert.equal(run(dir, ["quote", "--dir", "."]).status, 2);
});
