/**
 * `import --from github` — a one-off migration from somebody else's tracker
 * (TL-67).
 *
 * WHAT HAS TO BE PROVED, and why each claim needs its own control:
 *
 *   1. **No network.** This cannot be shown by watching a run — a run that
 *      happens not to call out looks identical to one that cannot. The real
 *      claim is about the module's DEPENDENCIES, so the test walks the import
 *      graph, the way the `seed` suite does for the same reason.
 *   2. **`--dry-run` writes nothing.** An empty directory is empty whatever the
 *      command does, including nothing at all, so the assertion is paired with a
 *      real import into the SAME directory afterwards: without that positive
 *      control it is green with no evidential force (AGENTS.md).
 *   3. **A re-import duplicates nothing.** Proved by counting files after two
 *      runs, and controlled by a third run over a FOURTH issue that does appear
 *      — otherwise "creates nothing" would also pass for a command that has
 *      stopped working.
 *   4. **A value outside a CLOSED vocabulary fails before anything is written.**
 *      Same directory, same input, one line of config different.
 *
 * Every fixture lives in a temporary directory. A suite that imported into this
 * repository's own backlog would write real tasks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../config.mjs";
import {
  SOURCE_MARKER, importedSources, parseImportArgs, parseIssues, planImport, renderBody,
} from "../import-github.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("import-github");

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS = join(HERE, "..");
const CLI = join(SCRIPTS, "cli.mjs");
const FIXTURE = join(HERE, "fixtures", "gh-issues.json");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-import-" + prefix + "-" + counter++ + "-"));
}

function run(args, input) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 60_000, input: input === undefined ? "" : input,
    env: { ...process.env, NO_COLOR: "1" },
  });
}

/** A backlog with no example task — the tasks counted below are the imported ones. */
function backlog(prefix) {
  const dir = tmp(prefix);
  const r = run(["init", "--dir", dir, "--no-example"]);
  assert.equal(r.status, 0, "init failed: " + r.stderr);
  return dir;
}

function taskFiles(dir) {
  const tasks = join(dir, "tasks");
  return existsSync(tasks) ? readdirSync(tasks).filter((f) => f.endsWith(".md")) : [];
}

function taskText(dir, file) {
  return readFileSync(join(dir, "tasks", file), "utf8");
}

function field(text, key) {
  const m = text.match(new RegExp("^" + key + ": (.*)$", "m"));
  return m ? m[1].replace(/\s+#.*$/, "").trim() : null;
}

const issues = () => readFileSync(FIXTURE, "utf8");

function importInto(dir, extra = [], input) {
  return run(["import", "--from", "github", "--dir", dir].concat(extra), input === undefined ? issues() : input);
}

// ── The invocation ────────────────────────────────────────────────────────

test("--from is required, and an unknown source is refused by name", () => {
  assert.throws(() => parseImportArgs([]), /--from` is required/);
  assert.throws(() => parseImportArgs(["--from", "jira"]), /not a source this command knows/);
  assert.deepEqual(parseImportArgs(["--from", "github"]).from, "github");
});

test("an unknown flag fails rather than being ignored", () => {
  assert.throws(() => parseImportArgs(["--from", "github", "--repo", "acme/app"]), /unknown flag: --repo/);
});

test("--label takes from=to, and an empty target drops the label", () => {
  const { labelMap } = parseImportArgs(["--from", "github", "--label", "bug=defect", "--label", "wontfix="]);
  assert.equal(labelMap.get("bug"), "defect");
  assert.equal(labelMap.get("wontfix"), "");
  assert.throws(() => parseImportArgs(["--from", "github", "--label", "bug"]), /is not a mapping/);
});

test("--label-map reads a JSON object of pairs, and refuses anything else", () => {
  const dir = tmp("map");
  const good = join(dir, "map.json");
  writeFileSync(good, JSON.stringify({ bug: "defect" }));
  assert.equal(parseImportArgs(["--from", "github", "--label-map", good]).labelMap.get("bug"), "defect");

  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify(["bug"]));
  assert.throws(() => parseImportArgs(["--from", "github", "--label-map", bad]), /must be a JSON object/);
});

test("the reserved reasons cannot be typed by hand", () => {
  assert.throws(() => parseImportArgs(["--from", "github", "--reason", "proven"]), /reserved/);
});

// ── Reading the input ─────────────────────────────────────────────────────

test("the input must be the array gh prints, and a bad shape names what is wrong", () => {
  assert.match(parseIssues("not json").errors[0], /not valid JSON/);
  assert.match(parseIssues('{"number":1}').errors[0], /not a JSON array/);

  const { errors } = parseIssues(JSON.stringify([
    { number: 1, title: "", state: "OPEN", url: "u" },
    { number: 2, title: "t", state: "DRAFT", url: "u" },
    { number: 3, title: "t", state: "OPEN" },
  ]));
  assert.equal(errors.length, 3);
  assert.match(errors[0], /no `title`/);
  assert.match(errors[1], /neither `OPEN` nor `CLOSED`/);
  assert.match(errors[2], /no `url`/);
});

test("labels arrive as objects from gh and as strings from a hand-written file", () => {
  const { issues: parsed } = parseIssues(JSON.stringify([
    { number: 1, title: "t", state: "OPEN", url: "u1", labels: [{ name: "bug" }] },
    { number: 2, title: "t", state: "closed", url: "u2", labels: ["perf"] },
  ]));
  assert.deepEqual(parsed[0].labels, ["bug"]);
  assert.deepEqual(parsed[1].labels, ["perf"]);
  assert.equal(parsed[1].state, "closed", "the state is read case-insensitively");
});

// ── The plan, against a project's vocabulary ──────────────────────────────

const CONFIG = (over = {}) => ({
  statuses: ["pending", "in_progress", "done"],
  archivedStatuses: ["done"],
  labels: [],
  labelsClosed: false,
  ...over,
});

test("open and closed map onto THIS project's statuses, never onto literals", () => {
  const { issues: parsed } = parseIssues(issues());
  const config = CONFIG({ statuses: ["icebox", "doing", "shipped"], archivedStatuses: ["shipped"] });
  const plan = planImport({ issues: parsed, config, labelMap: new Map(), alreadyImported: new Set() });
  assert.deepEqual(plan.items.map((i) => i.status), ["icebox", "shipped", "icebox"]);
});

test("a label outside a CLOSED vocabulary is an error, and the error names it", () => {
  const { issues: parsed } = parseIssues(issues());
  const plan = planImport({
    issues: parsed, config: CONFIG({ labels: ["defect"], labelsClosed: true }),
    labelMap: new Map([["bug", "defect"]]), alreadyImported: new Set(),
  });
  assert.equal(plan.items.length, 0, "nothing is planned once the vocabulary is violated");
  assert.match(plan.errors.join("\n"), /performance/);
  assert.doesNotMatch(plan.errors.join("\n"), /`bug`/, "the mapped label is in the vocabulary and must not be reported");
});

test("with an OPEN vocabulary the same label is dropped and counted, not fatal", () => {
  const { issues: parsed } = parseIssues(issues());
  const plan = planImport({
    issues: parsed, config: CONFIG({ labels: ["defect"], labelsClosed: false }),
    labelMap: new Map([["bug", "defect"]]), alreadyImported: new Set(),
  });
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(plan.items[0].labels, ["defect"]);
  assert.deepEqual(plan.dropped.map((d) => d.label), ["performance", "needs-triage"]);
});

test("an issue already here is skipped rather than planned again", () => {
  const { issues: parsed } = parseIssues(issues());
  const plan = planImport({
    issues: parsed, config: CONFIG(), labelMap: new Map(),
    alreadyImported: new Set(["https://github.com/acme/app/issues/31"]),
  });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.skipped.length, 1);
});

test("the body carries the issue, the source link, and what did not come over", () => {
  const body = renderBody({ number: 12, title: "t", body: "the description", url: "https://example.test/i/12", labels: [], state: "open" });
  assert.match(body, /the description/);
  assert.ok(body.includes(SOURCE_MARKER + "https://example.test/i/12"));
  assert.match(body, /Comments, attachments and status history were NOT brought over/);
});

// ── The command, end to end ───────────────────────────────────────────────

test("--dry-run writes nothing and says so — and the same input then does write", () => {
  const dir = backlog("dry");
  const dry = importInto(dir, ["--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /nothing was written/);
  assert.equal(taskFiles(dir).length, 0);

  // The positive control. Without it, "no files" would also pass for a command
  // that cannot write at all.
  const real = importInto(dir);
  assert.equal(real.status, 0, real.stderr);
  assert.equal(taskFiles(dir).length, 3);
});

test("what is written: local ids, the project's statuses, an EMPTY contract", () => {
  const dir = backlog("write");
  const r = importInto(dir);
  assert.equal(r.status, 0, r.stderr);

  const config = loadConfig(dir);
  const files = taskFiles(dir).sort();
  assert.equal(files.length, 3);

  for (const f of files) {
    const text = taskText(dir, f);
    // Numbers are ours. #12, #31 and #44 must appear nowhere in an id.
    assert.match(field(text, "id"), new RegExp("^" + config.taskIdPrefix + "-\\d+$"));
    assert.ok(!/^id: \S*-(12|31|44)$/m.test(text), "a GitHub number was reused as a task id");
    assert.equal(field(text, "verification"), "[]", "the contract must be empty, not the template's placeholder");
    assert.ok(text.includes(SOURCE_MARKER), "no source link — a re-import could not recognise this task");
  }

  const closed = files.map((f) => taskText(dir, f)).find((t) => /Document the retry policy/.test(t));
  assert.equal(field(closed, "status"), config.archivedStatuses[0]);
  const open = files.map((f) => taskText(dir, f)).find((t) => /Crash on startup/.test(t));
  assert.equal(field(open, "status"), config.statuses[0]);
});

test("the report states how many tasks it left unfinishable", () => {
  const dir = backlog("report");
  const r = importInto(dir);
  assert.match(r.stderr, /3 of them have no `verification:`/);
});

test("a second import of the same input creates nothing — and a new issue still lands", () => {
  const dir = backlog("again");
  assert.equal(importInto(dir).status, 0);
  assert.equal(taskFiles(dir).length, 3);

  const second = importInto(dir);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(taskFiles(dir).length, 3, "the second import duplicated tasks");
  assert.match(second.stdout, /1 task\(s\) from github|0 task\(s\) from github/);

  // The control: the deduplication must be about the URL, not about refusing to
  // write at all.
  const grown = JSON.parse(issues()).concat([{
    number: 99, title: "A fourth issue nobody has imported yet", body: "b",
    state: "OPEN", labels: [], url: "https://github.com/acme/app/issues/99",
  }]);
  const third = importInto(dir, [], JSON.stringify(grown));
  assert.equal(third.status, 0, third.stderr);
  assert.equal(taskFiles(dir).length, 4);
});

test("importedSources reads the links back out of the tree it wrote them into", () => {
  const dir = backlog("scan");
  assert.equal(importedSources(join(dir, "tasks")).size, 0);
  importInto(dir);
  const seen = importedSources(join(dir, "tasks"));
  assert.equal(seen.size, 3);
  assert.ok(seen.has("https://github.com/acme/app/issues/44"));
});

test("a closed vocabulary stops the command BEFORE a single file is written", () => {
  const dir = backlog("closed");
  const config = join(dir, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8").replace(/^labels_closed: .*$/m, "labels_closed: true"));

  const r = importInto(dir);
  assert.equal(r.status, 1);
  assert.equal(taskFiles(dir).length, 0);
  assert.match(r.stderr, /CLOSED label vocabulary/);

  // The positive control: the same tree, the same input, the labels mapped away.
  const ok = importInto(dir, ["--label", "bug=", "--label", "performance=", "--label", "needs-triage="]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(taskFiles(dir).length, 3);
});

test("check passes on the tree the import produced", () => {
  const dir = backlog("check");
  assert.equal(importInto(dir).status, 0);
  const r = run(["check", "--dir", dir]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the importer cannot reach the network — proved on its dependencies, not on a run", () => {
  const seen = new Set();
  const forbidden = ["node:http", "node:https", "node:net", "node:tls", "node:dgram", "http", "https", "net", "tls"];
  const stack = [join(SCRIPTS, "import-github.mjs")];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^import[^"']*["']([^"']+)["']/gm)) {
      const spec = m[1];
      assert.ok(forbidden.indexOf(spec) < 0, file + " imports " + spec + " — the importer must make no network request");
      if (spec.startsWith(".")) stack.push(join(dirname(file), spec));
    }
  }
  assert.ok(seen.size > 1, "the walk found no local imports — it proved nothing");
});
