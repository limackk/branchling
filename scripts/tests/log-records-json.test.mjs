/**
 * Every ledger record of a task, readable as JSON (TL-562).
 *
 * WHAT HAS TO BE PROVED. `log <ID> --json` answers in EXCHANGES — a fold, built
 * for a reader paying for every repeated paragraph. A program building an audit
 * or an evidence pack needs the opposite: the records themselves, each with the
 * keys only a raw entry carries — `reason: proven` on the closing transition,
 * the `contractCapability` verdict attached to it, the `vouch` of a
 * `__verified__` entry, the `refusal` code of an `__unverified__` one. Before
 * `--records` none of those was reachable through a reading command, and the
 * only way to them was to parse `history/<ID>.jsonl` by hand.
 *
 * So the assertions are not "something was printed". They are:
 *
 *   1. COMPLETE AND IN ORDER. The answer holds exactly the records the ledger
 *      holds, in the order it holds them — compared id by id against the file,
 *      so a mode that dropped one kind of record or sorted by field fails.
 *   2. NOTHING STRIPPED. Every key of every record comes back with its value,
 *      including the ones no fold renders. A positive control names the three
 *      that motivated the task, so a fixture that never produced them cannot
 *      pass this vacuously.
 *   3. A SLICE SAYS IT IS ONE. `--limit` keeps the newest records and reports
 *      how many it left out, the contract `log` already keeps for exchanges.
 *   4. IT COMPOSES WITH NOTHING THAT WOULD CHANGE ITS MEANING. `--decisions`,
 *      `--modified-file` and `--open-questions` select different questions, and
 *      a combination is a usage error, not a silently narrowed answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_UNVERIFIED, FIELD_VERIFIED } from "../history.mjs";
import { SCRIPTS_DIR, alignTemplate, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("log-records-json");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const ACTOR = "agent:ledger-test";
const MANUAL = "A person read the generated report and it matched the run";

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

/**
 * A task taken, refused once by `done` on a `manual:` entry nobody could vouch
 * for, then closed as proven with the vouch given — the three writes whose
 * records no fold exposes.
 */
function closedTask() {
  const repo = fixtureDir(join(tmpdir(), "branchling-ledger-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0, "init failed");
  alignTemplate(dir);
  const made = run(["new", "--dir", dir, "--title", "A task closed as proven"]);
  assert.equal(made.status, 0, made.stderr);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  const file = made.stdout.match(/(\S+\.md)/)[1];
  const text = readFileSync(file, "utf8")
    .replace(
      /^verification:[\s\S]*?(?=^---$)/m,
      'verification:\n  - id: automatic\n    bash: "true"\n  - id: looked-at\n    manual: "' + MANUAL + '"\n'
    )
    .replace("[proof: the-name]", "[proof: automatic]");
  writeFileSync(file, text, "utf8");

  const took = run(["take", id, "--dir", dir, "--actor", ACTOR]);
  assert.equal(took.status, 0, took.stderr);
  const refused = run(["done", id, "--dir", dir, "--actor", ACTOR]);
  assert.equal(refused.status, 1, "the fixture needs the refusal to happen: " + refused.stderr);
  const closed = run(["done", id, "--dir", dir, "--actor", ACTOR, "--confirm-manual"]);
  assert.equal(closed.status, 0, closed.stderr + closed.stdout);
  return { repo, dir, id };
}

/** The ledger exactly as the file holds it — the oracle the answer is held to. */
function ledger(dir, id) {
  const p = join(dir, "history", id + ".jsonl");
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function records(fx, extra = []) {
  const r = run(["log", fx.id, "--dir", fx.dir, "--records", "--json", ...extra]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("every ledger record comes back, in recorded order, with every key it carries", () => {
  const fx = closedTask();
  const raw = ledger(fx.dir, fx.id);
  const answer = records(fx);

  assert.equal(answer.kind, "task-ledger");
  assert.equal(answer.ok, true);
  assert.equal(answer.id, fx.id);
  assert.equal(answer.total, raw.length);
  assert.equal(answer.omitted, 0);
  assert.equal(answer.limit, null);
  assert.deepEqual(answer.records.map((r) => r.id), raw.map((r) => r.id),
    "the answer is not the ledger in its own order");

  raw.forEach((stored, i) => {
    const got = answer.records[i];
    for (const [key, value] of Object.entries(stored)) {
      assert.deepEqual(got[key], value, "record " + stored.id + " lost or changed `" + key + "`");
    }
    for (const key of ["id", "ts", "field", "from", "to", "actor", "source", "reason"]) {
      assert.ok(key in got, "record " + stored.id + " has no `" + key + "` key");
    }
  });
});

test("POSITIVE CONTROL: the proven transition, its capability, the vouch and the refusal are all there", () => {
  const fx = closedTask();
  const answer = records(fx);

  const closing = answer.records.filter((r) => r.field === "status" && r.reason === "proven");
  assert.equal(closing.length, 1, "no status transition closed as proven");
  assert.equal(closing[0].actor, ACTOR);
  assert.equal(closing[0].source, "done");
  assert.ok(closing[0].contractCapability && typeof closing[0].contractCapability === "object",
    "the closing transition carries no contractCapability verdict");

  const refusal = answer.records.filter((r) => r.field === FIELD_UNVERIFIED);
  assert.equal(refusal.length, 1, "the refused run left no record in the answer");
  assert.equal(refusal[0].refusal, "no-terminal");
  assert.equal(refusal[0].to, MANUAL);

  const vouch = answer.records.filter((r) => r.field === FIELD_VERIFIED);
  assert.equal(vouch.length, 1, "the vouch left no record in the answer");
  assert.equal(vouch[0].vouch, "flag");

  const order = answer.records.map((r) => r.id);
  assert.ok(order.indexOf(refusal[0].id) < order.indexOf(closing[0].id),
    "the refusal has to come before the closing it preceded");
});

test("--limit keeps the newest records and says how many it left out", () => {
  const fx = closedTask();
  const raw = ledger(fx.dir, fx.id);
  assert.ok(raw.length > 2, "the fixture is too small to slice");
  const answer = records(fx, ["--limit", "2"]);

  assert.equal(answer.total, raw.length);
  assert.equal(answer.limit, 2);
  assert.equal(answer.omitted, raw.length - 2);
  assert.deepEqual(answer.records.map((r) => r.id), raw.slice(-2).map((r) => r.id));

  const text = run(["log", fx.id, "--dir", fx.dir, "--records", "--limit", "2"]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, new RegExp("earlier records: " + (raw.length - 2)));
});

test("the text form names every record once", () => {
  const fx = closedTask();
  const raw = ledger(fx.dir, fx.id);
  const text = run(["log", fx.id, "--dir", fx.dir, "--records"]);
  assert.equal(text.status, 0, text.stderr);
  for (const r of raw) {
    assert.equal(text.stdout.split(r.id).length - 1, 1, "record " + r.id + " is not named exactly once");
  }
});

test("a task with no ledger is an answer, and no task at all is a refusal", () => {
  const repo = fixtureDir(join(tmpdir(), "branchling-ledger-empty-"));
  const dir = join(repo, "backlog");
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const made = run(["new", "--dir", dir, "--title", "Never touched"]);
  const id = made.stdout.match(/[A-Z]+-\d+/)[0];
  const logFile = join(dir, "history", id + ".jsonl");
  if (existsSync(logFile)) writeFileSync(logFile, "", "utf8");

  const empty = run(["log", id, "--dir", dir, "--records", "--json"]);
  assert.equal(empty.status, 0, empty.stderr);
  const answer = JSON.parse(empty.stdout);
  assert.equal(answer.total, 0);
  assert.deepEqual(answer.records, []);

  const absent = run(["log", id.replace(/\d+$/, "9999"), "--dir", dir, "--records", "--json"]);
  assert.equal(absent.status, 1);
  const refusal = JSON.parse(absent.stdout);
  assert.equal(refusal.kind, "task-ledger");
  assert.equal(refusal.ok, false);
  assert.equal(refusal.refusalKind, "no-such-task");
});

test("--records refuses the flags that would change what it answers", () => {
  for (const extra of [["--decisions"], ["--open-questions"], ["--modified-file", "scripts/"]]) {
    const args = extra[0] === "--open-questions" ? ["log", "--records", ...extra] : ["log", "PROJ-1", "--records", ...extra];
    const r = run(args);
    assert.equal(r.status, 2, extra.join(" ") + " was accepted beside --records: " + r.stdout);
  }
  const noId = run(["log", "--records", "--json"]);
  assert.equal(noId.status, 2, "--records without a task id must be a usage error");
});
