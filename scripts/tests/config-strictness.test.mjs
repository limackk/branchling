/**
 * An error in `config.yaml` fails — and looks like a message, not a crash (TL-60).
 *
 * WHAT WAS BROKEN. `loadConfig` takes `strict` (`true` by default), but it was
 * being set per call and the distribution came out the opposite way round:
 * `build`, all three `check-*` guards, `query`, `viewer` and `next-id`
 * called `{ strict: false }`. The command whose WHOLE job is to fail was the most
 * lenient — while `stats`, `new` and `serve` failed with an unhandled exception
 * and a stack trace.
 *
 * Measured before the fix: adding `statusess: [a, b]` to a fresh `config.yaml`
 * passed through `build` and `check` with exit code 0.
 *
 * WHY THIS IS A TEST ABOUT ONBOARDING. Editing `config.yaml` is the main act of
 * adapting the tool to a project. A silent typo in that file is not an
 * inconvenience — it is a vocabulary that means something other than its author thinks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ConfigError, loadConfig } from "../config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const SCRIPTS = join(HERE, "..");

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI].concat(args), { cwd, encoding: "utf8", timeout: 30_000 });
}

function backlog() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-strict-"));
  // `--no-example` (TL-64): the "it wrote nothing" assertion counts files in tasks/.
  assert.equal(run(dir, ["init", "--dir", ".", "--no-example"]).status, 0);
  return dir;
}

/** The reading commands that can be run without interaction and without a server. */
const READING = [["build"], ["check"], ["stats"], ["query", "--count"], ["viewer"], ["next-id"]];

test("positive control: on a healthy configuration these commands pass", () => {
  // Without this the whole file would be green even if they failed ALWAYS.
  const dir = backlog();
  for (const args of READING) {
    assert.equal(run(dir, args).status, 0, args[0] + " fails on a healthy configuration");
  }
});

test("an unknown key fails EVERY one of them — `build` and `check` included", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a, b]\n", "utf8");
  for (const args of READING) {
    const r = run(dir, args);
    assert.notEqual(r.status, 0, args[0] + " let a typo in the vocabulary through");
  }
});

test("none of them ends in a stack trace", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a, b]\n", "utf8");
  for (const args of READING) {
    const out = run(dir, args).stderr + run(dir, args).stdout;
    assert.doesNotMatch(out, /^\s+at .+:\d+:\d+\)?$/m, args[0] + " pokazuje stos:\n" + out);
    assert.doesNotMatch(out, /Node\.js v/, args[0] + " shows the node exception footer");
  }
});

test("the message gives the file, the line and the nearest key as a hint", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a, b]\n", "utf8");
  const err = run(dir, ["build"]).stderr;
  assert.match(err, /config\.yaml/, "it does not give the file");
  assert.match(err, /line \d+/, "it does not give the line");
  assert.match(err, /did you mean `statuses`\?/, "it does not suggest the nearest key");
});

test("`check` says it once, despite three guards in three processes", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a, b]\n", "utf8");
  const err = run(dir, ["check"]).stderr;
  const times = err.split("cannot read the backlog configuration").length - 1;
  assert.equal(times, 1, "the same error printed " + times + " times — it reads like three problems");
});

test("an inconsistent vocabulary fails too, and names every value", () => {
  const dir = backlog();
  const p = join(dir, "config.yaml");
  writeFileSync(p, readFileSync(p, "utf8").replace(/^statuses: .*$/m, "statuses: [todo, doing, shipped]"), "utf8");
  const r = run(dir, ["build"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /archived_statuses.*done/, "it does not say WHICH value fell outside the vocabulary");
});

test("writing is stopped too — `new` does not create a task under a broken configuration", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a]\n", "utf8");
  assert.notEqual(run(dir, ["new", "--title", "Cokolwiek"]).status, 0);
  assert.equal(readdirSync(join(dir, "tasks")).length, 0, "it wrote a task despite an unreadable configuration");
});

// ── The distinction: a predicted state versus a defect in the program ──────

test("a configuration problem is a ConfigError, not just any exception", () => {
  const dir = backlog();
  appendFileSync(join(dir, "config.yaml"), "statusess: [a]\n", "utf8");
  assert.throws(() => loadConfig(dir), (e) => e instanceof ConfigError);
});

test("a defect in the program is NOT a ConfigError — otherwise we would silence real errors", () => {
  assert.throws(() => loadConfig(null), (e) => !(e instanceof ConfigError));
});

// ── A rule, not a one-off fix ─────────────────────────────────────────────

test("no production file goes back to `strict: false`", () => {
  const files = readdirSync(SCRIPTS).filter((f) => f.endsWith(".mjs") && f !== "config.mjs");
  const offenders = files.filter((f) => readFileSync(join(SCRIPTS, f), "utf8").includes("strict: false"));
  assert.deepEqual(offenders, [],
    "these files load the configuration leniently again: " + offenders.join(", "));

  // A positive control for the scan itself: if it read empty files or the wrong
  // path, the assertion above would be green and would mean nothing.
  const users = files.filter((f) => readFileSync(join(SCRIPTS, f), "utf8").includes("loadConfigOrExit"));
  assert.ok(users.length >= 8, "the scan sees no calls — it is measuring the wrong tree (found " + users.length + ")");
});
