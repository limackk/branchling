/**
 * A task joins a target in another repository through its own `target:` field
 * (TL-514), not through its labels.
 *
 * WHAT HAS TO BE PROVED:
 *
 *   1. The field's vocabulary is the names of the targets carrying
 *      `repository:`, derived from `deploy_targets` and closed even when
 *      empty. A local target and an undeclared name are outside it — in
 *      `normalizeValue`, `new --target` and `check --vocabulary` — each beside
 *      a value that passes.
 *   2. `new --target` writes an inline list, inserting the line when an older
 *      template has none, and the help JSON lists only the names `new` accepts
 *      while `deploy` still lists every target.
 *   3. `labels:` on a target fails the configuration with a hint naming
 *      `target:`; the same target without it loads.
 *   4. The readers use the field: a task LABELLED with the target's name and no
 *      `target:` is not unobservable, while one naming it in `target:` is —
 *      in `deploy status`, the gate, `query --json` and `show --json`.
 *
 * Every fixture is created by `init`; vocabulary values the tests depend on
 * (archived statuses) are read back from the fixture's own config.yaml.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { externalTargetNames, externalTargetsOf, readDeployTargets } from "../deploy-targets.mjs";
import { auditVocabulary, buildFieldSpecs, extractMeta, normalizeValue } from "../task-fields.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("external-target-field");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function git(dir, args) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

function run(dir, args) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, cwd: dir, env: { ...process.env, NO_COLOR: "1" },
  });
}

function configList(dir, key) {
  const text = readFileSync(join(dir, "backlog", "config.yaml"), "utf8");
  return text.match(new RegExp("^" + key + ":\\s*\\[([^\\]]*)\\]", "m"))[1].split(",").map((s) => s.trim());
}

function taskFile(dir, id) {
  const tasks = join(dir, "backlog", "tasks");
  return join(tasks, readdirSync(tasks).find((f) => f.startsWith(id + "-")));
}

function setField(dir, id, key, value) {
  const file = taskFile(dir, id);
  const text = readFileSync(file, "utf8");
  const re = new RegExp("^" + key + ":.*$", "m");
  assert.match(text, re, key + " is not a line of " + id);
  writeFileSync(file, text.replace(re, key + ": " + value), "utf8");
}

function newTask(dir, title, ...flags) {
  const r = run(dir, ["new", "--dir", "backlog", "--title", title, ...flags]);
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.match(/[A-Z]+-\d+/)[0];
}

const TARGETS = `
deploy_targets:
  - name: api
    paths: [src/]
    stages:
      - { name: production, ref: prod }
  - name: frontend
    repository: acme-frontend
  - name: desktop
    repository: acme-desktop
`;

const LOCAL_ONLY = `
deploy_targets:
  - name: api
    paths: [src/]
    stages:
      - { name: production, ref: prod }
`;

/** A backlog in a git repository, with `extra` appended to its config.yaml. */
function backlog(extra) {
  const dir = fixtureDir(join(tmpdir(), "branchling-target-field-" + counter++ + "-"));
  git(dir, ["init", "-q", "-b", "main", "."]);
  assert.equal(run(dir, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  appendFileSync(join(dir, "backlog", "config.yaml"), extra);
  return dir;
}

/** The `deploy_targets` value of a config fragment, read as config.yaml reads it. */
function shape(yaml) {
  return readDeployTargets("", yaml.split("\n").filter((l) => l.trim() && !/^deploy_targets:/.test(l)));
}

// ─── 1. the vocabulary ──────────────────────────────────────────────────────

test("the vocabulary is the targets in another repository, and the field is closed even when it is empty", () => {
  const { targets, problems } = shape(TARGETS);
  assert.deepEqual(problems, []);
  assert.deepEqual(externalTargetNames(targets), ["frontend", "desktop"]);

  const config = { deployTargets: targets, externalTargets: externalTargetNames(targets) };
  const spec = buildFieldSpecs(config).find((f) => f.key === "target");
  assert.equal(spec.kind, "list");
  assert.equal(spec.closed, true);
  assert.deepEqual(spec.options, ["frontend", "desktop"]);
  const fields = buildFieldSpecs(config);

  // Positive control: the two declared names pass, deduplicated.
  assert.deepEqual(normalizeValue("target", ["frontend", "desktop", "frontend"], { fields }),
    { ok: true, value: ["frontend", "desktop"] });
  const local = normalizeValue("target", ["api"], { fields });
  assert.equal(local.ok, false);
  assert.match(local.error, /Unknown value "api" — allowed: frontend, desktop \(only a target that declares `repository:`/);
  assert.equal(normalizeValue("target", ["nope"], { fields }).ok, false);

  // No target in another repository: nothing is allowed, and the message says
  // where the vocabulary would come from instead of printing an empty list.
  const none = buildFieldSpecs({ deployTargets: shape(LOCAL_ONLY).targets, externalTargets: [] });
  const refused = normalizeValue("target", ["api"], { fields: none });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /`deploy_targets:` in config\.yaml declares nothing this field may name/);
  assert.deepEqual(normalizeValue("target", [], { fields: none }), { ok: true, value: [] });
});

test("the vocabulary audit judges `target:` against the external targets only", () => {
  const { targets } = shape(TARGETS);
  const config = { deployTargets: targets, externalTargets: externalTargetNames(targets) };
  const meta = (line) => extractMeta("id: X-1\n" + line);
  const found = (line) => auditVocabulary([meta(line)], config).filter((d) => d.field === "target");
  // Positive control: a declared external target and an absent field are fine.
  assert.deepEqual(found("target: [frontend, desktop]"), []);
  assert.deepEqual(found("labels: [frontend]"), []);
  const local = found("target: [api]");
  assert.equal(local.length, 1);
  assert.deepEqual(local[0].found, [{ value: "api", count: 1 }]);
  assert.equal(local[0].dictionary, "deploy_targets");
  assert.deepEqual(found("target: [nope]")[0].found, [{ value: "nope", count: 1 }]);
});

test("check --vocabulary fails on a local or undeclared target and passes on an external one", () => {
  const dir = backlog(TARGETS);
  const id = newTask(dir, "A frontend task");
  setField(dir, id, "target", "[api]");
  const local = run(dir, ["check", "--vocabulary", "--dir", "backlog"]);
  assert.notEqual(local.status, 0);
  assert.match(local.stderr + local.stdout, /`target` — allowed by `deploy_targets:` \[frontend, desktop\]/);
  assert.match(local.stderr + local.stdout, /only a target that declares `repository:`/);
  setField(dir, id, "target", "[frotnend]");
  assert.notEqual(run(dir, ["check", "--vocabulary", "--dir", "backlog"]).status, 0);
  setField(dir, id, "target", "[frontend]");
  const good = run(dir, ["check", "--vocabulary", "--dir", "backlog"]);
  assert.equal(good.status, 0, good.stderr + good.stdout);
});

// ─── 2. new --target and the help ───────────────────────────────────────────

test("new --target writes the list; a local, an undeclared and an absent target fail before anything is written", () => {
  const dir = backlog(TARGETS);
  const id = newTask(dir, "Spans two repositories", "--target", "frontend, desktop");
  assert.match(readFileSync(taskFile(dir, id), "utf8"), /^target: \[frontend, desktop\]/m);
  const plain = newTask(dir, "No target");
  assert.match(readFileSync(taskFile(dir, plain), "utf8"), /^target: \[\]/m);

  const before = readdirSync(join(dir, "backlog", "tasks")).length;
  const local = run(dir, ["new", "--dir", "backlog", "--title", "Local", "--target", "api"]);
  assert.equal(local.status, 2);
  assert.match(local.stderr, /`api` is a target of this repository, and a task cannot name it in `target:`/);
  assert.match(local.stderr, /computed from the paths their commits touch/);
  const typo = run(dir, ["new", "--dir", "backlog", "--title", "Typo", "--target", "frotnend"]);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /`frotnend` is not a declared target in another repository/);
  assert.match(typo.stderr, /allowed: frontend \| desktop/);
  assert.equal(readdirSync(join(dir, "backlog", "tasks")).length, before, "a refused --target writes nothing");

  const bare = backlog(LOCAL_ONLY);
  const none = run(bare, ["new", "--dir", "backlog", "--title", "Nothing to name", "--target", "frontend"]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /no target in `deploy_targets` declares `repository:`/);
});

test("new --target inserts the line into a template written before the field", () => {
  const dir = backlog(TARGETS);
  const template = join(dir, "backlog", "_template.md");
  const text = readFileSync(template, "utf8");
  assert.match(text, /^target: /m, "the current template carries the field");
  writeFileSync(template, text.replace(/^target:.*\n/m, ""), "utf8");
  const id = newTask(dir, "Old template", "--target", "frontend");
  const written = readFileSync(taskFile(dir, id), "utf8");
  assert.match(written, /^release:.*\ntarget: \[frontend\]$/m);
});

test("the help JSON lists what each command accepts for --target", () => {
  const dir = backlog(TARGETS);
  const flag = (command) => {
    const r = run(dir, [command, "--help", "--json", "--dir", "backlog"]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout).flags.find((f) => f.flag === "--target");
  };
  const onNew = flag("new");
  assert.equal(onNew.dictionary, "deploy_targets");
  assert.deepEqual(onNew.values, ["frontend", "desktop"]);
  assert.equal(onNew.closed, true);
  // `deploy` selects any declared target, the local one included.
  assert.deepEqual(flag("deploy").values, ["api", "frontend", "desktop"]);
});

// ─── 3. `labels:` on a target ───────────────────────────────────────────────

test("`labels:` on a target fails the configuration with a hint naming `target:`", () => {
  const dir = backlog("\ndeploy_targets:\n  - name: frontend\n    repository: acme-frontend\n    labels: [frontend]\n");
  const bad = run(dir, ["deploy", "status", "--dir", "backlog"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr + bad.stdout, /`labels` no longer selects a target's tasks — a task names the target in another repository in its own `target:` field/);
  // Positive control: the same target without the key loads.
  const good = backlog("\ndeploy_targets:\n  - name: frontend\n    repository: acme-frontend\n");
  const ok = run(good, ["deploy", "status", "--dir", "backlog"]);
  assert.equal(ok.status, 0, ok.stderr);
});

// ─── 4. every reader uses the field ─────────────────────────────────────────

test("a task joins a target in another repository through `target:`, never through a label", () => {
  const dir = backlog(TARGETS);
  const [done] = configList(dir, "archived_statuses");
  const named = newTask(dir, "Named in target", "--target", "frontend");
  const labelled = newTask(dir, "Only labelled frontend");
  setField(dir, labelled, "labels", "[frontend]");
  for (const id of [named, labelled]) setField(dir, id, "status", done);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "the tasks"]);
  git(dir, ["branch", "prod"]);

  const status = run(dir, ["deploy", "status", "--dir", "backlog", "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const lane = JSON.parse(status.stdout).targets.find((t) => t.target === "frontend");
  assert.deepEqual(lane.buckets[0].tasks.map((t) => t.id), [named]);
  assert.deepEqual(JSON.parse(status.stdout).targets.find((t) => t.target === "desktop").buckets[0].tasks, []);

  const gate = run(dir, ["check", "--release", "--dir", "backlog", "--json"]);
  const report = JSON.parse(gate.stdout).guards.find((g) => g.name === "release").report;
  assert.equal(report.unobservable.find((u) => u.target === "frontend").count, 1);

  const query = run(dir, ["query", "--dir", "backlog", "--json", "--status", done]);
  assert.equal(query.status, 0, query.stderr);
  const rows = new Map(JSON.parse(query.stdout).tasks.map((t) => [t.id, t]));
  assert.deepEqual(rows.get(named).target, ["frontend"]);
  assert.deepEqual(rows.get(named).deploy.unobservable, [{ target: "frontend", repository: "acme-frontend" }]);
  assert.deepEqual(rows.get(labelled).deploy.unobservable, [], "a label is a category, not a target");

  const show = (id) => {
    const r = run(dir, ["show", id, "--dir", "backlog", "--json"]);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(show(named).deploy.unobservable, [{ target: "frontend", repository: "acme-frontend" }]);
  assert.deepEqual(show(labelled).deploy.unobservable, []);

  // The helper itself, on the records the readers hand it.
  const { targets } = shape(TARGETS);
  assert.deepEqual(externalTargetsOf(targets, rows.get(named)).map((t) => t.name), ["frontend"]);
  assert.deepEqual(externalTargetsOf(targets, rows.get(labelled)), []);
});
