/**
 * A `done` refused on a `manual:` entry leaves a trace (TL-170).
 *
 * WHAT THIS HAS TO PROVE, and why the shape matters. Before TL-170 every
 * refusal path returned without a single write, so "every automatic entry
 * passed and one human vouch is missing" lived only in the terminal that
 * printed it. The failure that produced the task was not a crash: it was a
 * task sitting `in_progress` for a day while three separate views showed it as
 * ordinary work in flight, because the tool had thrown its own answer away.
 *
 * So a green "nothing broke" is worth nothing here. Each case below has to
 * find the RECORD, and each silent case has to say what must NOT be written —
 * a suite that only asserted the refusal still happens would have passed
 * against the defect.
 *
 * The fixture uses a vocabulary of its own for the same reason `audit`'s does:
 * a status word copied out of this repository's config would assert the
 * project's data rather than the tool's contract.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { awaitingVouch } from "../audit.mjs";
import { FIELD_UNVERIFIED, FIELD_VERIFIED, outstandingVouches, VOUCH_REFUSALS } from "../history.mjs";
import { alignTemplate, isolateHome } from "./_repo.mjs";

isolateHome("manual-refusal-residue");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

let counter = 0;

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "branchling-vouch-" + counter++ + "-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  alignTemplate(dir);
  return dir;
}

const MANUAL = "Somebody looked at the rendered page and the columns were there";

/** A task whose contract is one passing command and one `manual:` entry. */
function taskWithManual(dir, title = "A contract only a person can finish") {
  const r = run(["new", "--dir", dir, "--title", title]);
  assert.equal(r.status, 0, r.stderr);
  const id = r.stdout.match(/[A-Z]+-\d+/)[0];
  const file = r.stdout.match(/(\S+\.md)/)[1];
  const text = readFileSync(file, "utf8")
    .replace(
      /^verification:[\s\S]*?(?=^---$)/m,
      'verification:\n  - id: automatic\n    bash: "true"\n  - id: looked-at\n    manual: "' + MANUAL + '"\n'
    )
    // The template's criterion points at the entry id the template ships with.
    // Leaving it would make `done` refuse for a DIFFERENT reason — the criteria
    // and the contract disagreeing — and the suite would then be measuring the
    // wrong gate while still looking green.
    .replace("[proof: the-name]", "[proof: automatic]");
  writeFileSync(file, text, "utf8");
  assert.equal(run(["take", id, "--dir", dir, "--actor", "agent:test"]).status, 0);
  return { id, file };
}

function history(dir, id) {
  const p = join(dir, "history", id + ".jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const unverified = (dir, id) => history(dir, id).filter((e) => e.field === FIELD_UNVERIFIED);

// ── The record itself ─────────────────────────────────────────────────────

test("FINDS: a refusal with no terminal writes the entry, its text and who was asked", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  const r = run(["done", t.id, "--dir", dir, "--actor", "agent:test"]);
  assert.equal(r.status, 1, "the refusal itself must not change");

  const found = unverified(dir, t.id);
  assert.equal(found.length, 1, "the refusal left no trace at all — this is the defect TL-170 names");
  assert.equal(found[0].to, MANUAL, "the entry's own text is what a later reader has to recognise");
  assert.equal(found[0].refusal, "no-terminal");
  assert.equal(found[0].actor, "agent:test");
  assert.match(found[0].reason, /1 automatic entry passed/,
    "the point of the record is that everything a machine COULD check was green");
});

test("the task file is still not touched — the promise the refusal makes is kept", () => {
  const dir = backlog();
  const t = taskWithManual(dir);
  const before = readFileSync(t.file, "utf8");

  run(["done", t.id, "--dir", dir, "--actor", "agent:test"]);

  assert.equal(readFileSync(t.file, "utf8"), before,
    "TL-170 buys visibility with a write to the LOG, never with a status change");
  assert.equal(unverified(dir, t.id).length, 1);
});

test("FINDS: `--json` refuses and records too — the caller least able to keep a terminal", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  const r = run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--json"]);
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).refusalKind, "manual-needs-person");

  const found = unverified(dir, t.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].refusal, "json");
});

test("SILENT: `--dry-run` records nothing — a rehearsal that left marks is not a rehearsal", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  assert.equal(run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--dry-run"]).status, 1);

  assert.deepEqual(unverified(dir, t.id), [],
    "`--dry-run` promises the contract runs and NOTHING changes; a history entry is a change");
});

test("SILENT: `--confirm-manual` closes and vouches exactly as before", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  const r = run(["done", t.id, "--dir", dir, "--actor", "agent:test", "--confirm-manual"]);
  assert.equal(r.status, 0, r.stderr);

  const log = history(dir, t.id);
  assert.equal(log.filter((e) => e.field === FIELD_VERIFIED).length, 1, "the vouch is still recorded");
  assert.deepEqual(log.filter((e) => e.field === FIELD_UNVERIFIED), [],
    "nothing was refused, so nothing may claim it was");
});

test("every refusal code the writer can produce is one the reader knows", () => {
  const dir = backlog();
  const seen = new Set();
  for (const flags of [[], ["--json"]]) {
    const t = taskWithManual(dir);
    run(["done", t.id, "--dir", dir, "--actor", "agent:test"].concat(flags));
    for (const e of unverified(dir, t.id)) seen.add(e.refusal);
  }
  assert.ok(seen.size > 0, "a zero sample would pass this vacuously");
  for (const code of seen) {
    assert.ok(VOUCH_REFUSALS.includes(code), "the writer produced a code the constant does not list: " + code);
  }
});

// ── Reading it back ───────────────────────────────────────────────────────

const ev = (field, to, ts) => ({ field, to, ts, actor: "agent:x", refusal: "no-terminal" });

test("a vouch that arrives AFTER a refusal closes it; one that came before does not", () => {
  assert.deepEqual(
    outstandingVouches([ev(FIELD_UNVERIFIED, MANUAL, "2026-01-01T00:00:00.000Z"),
                        ev(FIELD_VERIFIED, MANUAL, "2026-01-02T00:00:00.000Z")]),
    [], "the question was asked and then answered");

  const open = outstandingVouches([ev(FIELD_VERIFIED, MANUAL, "2026-01-01T00:00:00.000Z"),
                                   ev(FIELD_UNVERIFIED, MANUAL, "2026-01-02T00:00:00.000Z")]);
  assert.equal(open.length, 1, "an older vouch cannot answer a question asked after it");
});

test("two manual entries are two questions, and answering one leaves the other open", () => {
  const open = outstandingVouches([
    ev(FIELD_UNVERIFIED, "the first", "2026-01-01T00:00:00.000Z"),
    ev(FIELD_UNVERIFIED, "the second", "2026-01-01T00:00:01.000Z"),
    ev(FIELD_VERIFIED, "the first", "2026-01-02T00:00:00.000Z"),
  ]);
  assert.deepEqual(open.map((e) => e.to), ["the second"]);
});

// ── The reader who did not run the command ────────────────────────────────

const task = (id, over = {}) => ({ id, title: "T " + id, status: "surveying", owner: "", ...over });

test("FINDS: audit names an open task waiting on a vouch, with the code and the text", () => {
  const r = awaitingVouch(
    [task("T-1")],
    { "T-1": [ev(FIELD_UNVERIFIED, MANUAL, "2026-01-01T00:00:00.000Z")] },
    { archived: ["charted"] }
  );
  assert.deepEqual(r.found.map((f) => f.task), ["T-1"]);
  assert.equal(r.found[0].refusal, "no-terminal");
  assert.equal(r.found[0].manual, MANUAL);
  assert.equal(r.found[0].since, "2026-01-01");
});

test("SILENT: once vouched for, and SILENT on a task that never asked", () => {
  const answered = awaitingVouch(
    [task("T-1")],
    { "T-1": [ev(FIELD_UNVERIFIED, MANUAL, "2026-01-01T00:00:00.000Z"),
              ev(FIELD_VERIFIED, MANUAL, "2026-01-02T00:00:00.000Z")] },
    { archived: ["charted"] }
  );
  assert.deepEqual(answered.found, []);
  assert.deepEqual(awaitingVouch([task("T-2")], {}, { archived: ["charted"] }).found, []);
});

test("SILENT: a CLOSED task is not asked about a vouch it no longer needs", () => {
  const r = awaitingVouch(
    [task("T-1", { status: "charted" })],
    { "T-1": [ev(FIELD_UNVERIFIED, MANUAL, "2026-01-01T00:00:00.000Z")] },
    { archived: ["charted"] }
  );
  assert.deepEqual(r.found, []);
});

test("THE WHOLE POINT: a reader who never ran the gate is told what it is waiting for", () => {
  const dir = backlog();
  const t = taskWithManual(dir);

  const clean = run(["audit", "--dir", dir, "--json"]);
  assert.deepEqual(JSON.parse(clean.stdout).awaitingVouch, [],
    "a positive control: before the refusal there is nothing to find");

  run(["done", t.id, "--dir", dir, "--actor", "agent:test"]);

  // A DIFFERENT command, in a different process, that never touched the
  // contract. This is the criterion TL-170 was written for.
  const after = run(["audit", "--dir", dir, "--json"]);
  const found = JSON.parse(after.stdout).awaitingVouch;
  assert.equal(found.length, 1);
  assert.equal(found[0].task, t.id);
  assert.equal(found[0].manual, MANUAL);
  assert.equal(after.status, 1, "a finding has to reach the exit code as well");

  assert.match(run(["audit", "--dir", dir]).stdout, /awaiting a vouch/,
    "and a person reading the terminal sees it too");
});
