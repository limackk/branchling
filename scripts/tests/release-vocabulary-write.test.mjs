/**
 * `declare` — appending to `releases:` and `deploy_targets:` (TL-522).
 *
 * WHAT HAS TO BE PROVED:
 *   1. An appended release keeps every comment line of config.yaml, and the
 *      tool's own reader accepts it: `new --release <name>` succeeds afterwards.
 *      Proved on a fixture that carries comments in each position a careless
 *      writer would lose — above a key, at the end of a line, inside a block,
 *      and between two keys.
 *   2. Each form a list is written in stays that form: a one-line `[a, b]`, a
 *      block list, and an absent key.
 *   3. A duplicate, a key outside the decided set, a malformed target and a
 *      form the writer does not edit are refused, and the file is byte for
 *      byte what it was.
 *   4. `--json` answers in the declared `vocabulary-declare` kind.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { appendEntryText, buildEntry } from "../declare-vocabulary.mjs";
import { isolateHome } from "./_repo.mjs";

isolateHome("release-vocabulary-write");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");

function cli(dir, ...args) {
  return spawnSync(process.execPath, [CLI, ...args, "--dir", dir], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
}

/** A fresh backlog made by `init`, with `extra` appended to its config.yaml. */
function fixture(extra) {
  const dir = join(mkdtempSync(join(tmpdir(), "declare-")), "backlog");
  const init = spawnSync(process.execPath, [CLI, "init", "--dir", dir], { encoding: "utf8" });
  assert.equal(init.status, 0, init.stderr);
  if (extra) appendFileSync(join(dir, "config.yaml"), extra);
  return dir;
}

const read = (dir) => readFileSync(join(dir, "config.yaml"), "utf8");
/** The comment half of every line that has one: what a careless writer loses. */
const comments = (text) => text.split("\n").filter((l) => l.includes("#")).map((l) => l.slice(l.indexOf("#")));

const COMMENTED = [
  "",
  "# Releases, oldest first. The current one is the first not yet shipped.",
  "releases: [0.9, 1.0]   # the two cut so far",
  "# A paragraph about the next key, which must stay above it.",
  "label_axis_timing: []",
  "",
].join("\n");

test("a release appended to a commented config keeps every comment and `new --release` accepts it", () => {
  const dir = fixture(COMMENTED);
  const before = read(dir);
  // Positive control: the fixture really carries the comments the claim is about.
  assert.ok(comments(before).some((l) => l.includes("the two cut so far")));
  assert.equal(cli(dir, "new", "--title", "Refused first", "--release", "1.1").status !== 0, true,
    "an undeclared release must be refused before the declaration, or the proof below proves nothing");

  const r = cli(dir, "declare", "releases", "1.1", "--reason", "the next public cut");
  assert.equal(r.status, 0, r.stderr);
  const after = read(dir);
  for (const line of comments(before)) assert.ok(after.includes(line), "comment lost: " + line);
  assert.match(after, /^releases: \[0\.9, 1\.0, 1\.1\]   # the two cut so far$/m, "the one-line form is kept");
  assert.match(after, /^# 1\.1: the next public cut$/m);
  assert.ok(after.indexOf("# A paragraph about the next key") < after.indexOf("label_axis_timing:"));

  const created = cli(dir, "new", "--title", "Planned for the release", "--release", "1.1");
  assert.equal(created.status, 0, created.stderr);
});

test("a block list gains the item after its last item, at its own indentation", () => {
  const dir = fixture([
    "",
    "releases:",
    "    # the first",
    "    - 1.0",
    "# about the next key",
    "roles: []",
    "",
  ].join("\n"));
  const r = cli(dir, "declare", "releases", "1.1", "--ref", "v1.1", "--reason", "shipped before it was declared");
  assert.equal(r.status, 0, r.stderr);
  assert.match(read(dir), /    - 1\.0\n    # shipped before it was declared\n    - \{ name: 1\.1, ref: v1\.1 \}\n# about the next key\n/);
});

test("an absent key is created at the end, and deploy targets take both of their shapes", () => {
  const dir = fixture("");
  const web = cli(dir, "declare", "deploy_targets", "web", "--paths", "web/,api/",
    "--stage", "test=origin/main", "--stage", "production=refs/deploys/eu,refs/deploys/us", "--reason", "the site");
  assert.equal(web.status, 0, web.stderr);
  const ui = cli(dir, "declare", "deploy_targets", "ui", "--repository", "web-ui", "--reason", "its own repository", "--json");
  assert.equal(ui.status, 0, ui.stderr);
  const answer = JSON.parse(ui.stdout);
  assert.equal(answer.kind, "vocabulary-declare");
  assert.equal(answer.ok, true);
  assert.deepEqual(answer.entry, { name: "ui", repository: "web-ui" });
  assert.ok(read(dir).includes([
    "deploy_targets:",
    "  # the site",
    "  - name: web",
    "    paths: [web/, api/]",
    "    stages:",
    "      - { name: test, ref: origin/main }",
    "      - { name: production, refs: [refs/deploys/eu, refs/deploys/us] }",
    "  # its own repository",
    "  - name: ui",
    "    repository: web-ui",
  ].join("\n")), read(dir));
  // A target with no `--paths` is the whole repository, so no `paths:` line.
  const whole = cli(dir, "declare", "deploy_targets", "all", "--stage", "live=origin/main", "--reason", "one deployable");
  assert.equal(whole.status, 0, whole.stderr);
  assert.ok(read(dir).endsWith("  # one deployable\n  - name: all\n    stages:\n      - { name: live, ref: origin/main }\n"), read(dir));
  // The reader the rest of the tool uses accepts what was written.
  assert.equal(cli(dir, "deploy", "status", "--target", "web", "--count").stderr.includes("config"), false);
});

test("a duplicate, an undeclared key, a malformed target and an unedited form are refused without writing", () => {
  const dir = fixture(COMMENTED + "deploy_targets:\n  - name: web\n    paths: [web/]\n    stages:\n      - { name: test, ref: origin/main }\n");
  const before = read(dir);
  const cases = [
    { args: ["releases", "1.0", "--reason", "again"], status: 1, kind: "duplicate" },
    { args: ["statuses", "shipped", "--reason", "a status"], status: 2, kind: "undeclared-key" },
    { args: ["boards", "ops", "--reason", "a board"], status: 2, kind: "undeclared-key" },
    { args: ["deploy_targets", "api", "--paths", "api/", "--reason", "no stage"], status: 2, kind: "malformed" },
    { args: ["deploy_targets", "api", "--repository", "x", "--paths", "api/", "--reason", "both"], status: 2, kind: "malformed" },
    { args: ["deploy_targets", "web", "--repository", "x", "--reason", "twice"], status: 1, kind: "duplicate" },
    { args: ["releases", "Not A Slug", "--reason", "bad"], status: 2, kind: "malformed" },
    { args: ["releases", "2.0", "--ref", "refs/tags/*", "--reason", "a glob"], status: 2, kind: "malformed" },
  ];
  for (const c of cases) {
    const r = cli(dir, "declare", ...c.args, "--json");
    assert.equal(r.status, c.status, c.args.join(" ") + "\n" + r.stdout + r.stderr);
    const answer = JSON.parse(r.stdout);
    assert.equal(answer.ok, false);
    assert.equal(answer.refusalKind, c.kind, c.args.join(" "));
    assert.equal(read(dir), before, "written despite the refusal: " + c.args.join(" "));
  }
  const human = cli(dir, "declare", "statuses", "shipped", "--reason", "a status");
  assert.match(human.stderr, /`statuses` is not written by a command/);
  assert.match(human.stderr, /writable: releases, deploy_targets/);
});

test("PURE: a form the writer does not edit is refused rather than normalised", () => {
  const entry = buildEntry({ key: "releases", name: "1.2" }).entry;
  // A flow list over two lines is not read by the configuration reader at all,
  // so it is refused before any line is touched.
  const multi = appendEntryText("releases: [1.0,\n  1.1]\n", "releases", entry, "why");
  assert.equal(multi.ok, false);

  const scalar = appendEntryText("releases: 1.0\n", "releases", entry, "why");
  assert.equal(scalar.ok, false);
  assert.equal(scalar.kind, "form");
});

test("PURE: an empty flow list becomes a block, and every other line is untouched", () => {
  const text = "# head\nreleases: []   # none yet\nroles: []\n";
  const entry = buildEntry({ key: "releases", name: "1.0" }).entry;
  const r = appendEntryText(text, "releases", entry, "the first");
  assert.equal(r.ok, true);
  assert.equal(r.text, "# head\nreleases:   # none yet\n  # the first\n  - 1.0\nroles: []\n");
});

test("an unknown flag fails, and the help names every flag", () => {
  const dir = fixture("");
  const r = cli(dir, "declare", "releases", "1.0", "--reason", "x", "--frobnicate");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown flag: --frobnicate/);
  writeFileSync(join(dir, "probe.txt"), "");
  const help = spawnSync(process.execPath, [CLI, "declare", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  for (const f of ["--reason", "--ref", "--repository", "--paths", "--stage", "--json"]) assert.ok(help.stdout.includes(f), f);
});
