/**
 * Does a link lead anywhere? (TL-45)
 *
 * WHY THE FOUR SKIP RULES CARRY AS MANY TESTS AS THE FINDING DOES. A link guard
 * fails in two directions and only one of them is visible. A missed dead link
 * costs a reader some context they never learn they are missing; a FALSE
 * finding costs the guard its credibility, and a guard people have learned to
 * ignore is worse than none — this repository measured 44 false findings in the
 * first draft, all of them from one rule being applied to two kinds of path.
 *
 * SO EVERY SKIP IS ASSERTED BY ITS REASON, NOT BY ITS OUTCOME. `classifyTarget`
 * returns WHICH rule fired, so a test can say "the cross-repository reference
 * was skipped on purpose" rather than "it did not produce a finding", which is
 * also what a guard that silently failed to resolve it would produce.
 *
 * THE POSITIVE CONTROL IS AN ACCEPTANCE CRITERION HERE, and it is a real
 * repository: one dead link fails, the same tree passes once the file exists.
 * Without it every assertion below is satisfied by a guard that never reports
 * anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  anchorsIn, auditLinks, classifyTarget, documentsToCheck, headingSlug, linksIn, relatedDocsIn,
} from "../check-docs-links.mjs";
import { repositoryRoot } from "../paths.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("docs-links");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const REPO = join(HERE, "..", "..");

let counter = 0;
function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), "branchling-" + prefix + "-" + (counter++) + "-"));
}

function run(args, cwd, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, input: "", cwd,
    env: env || { ...process.env, NO_COLOR: "1" },
  });
}

/** A repository with a backlog, one task, and a `docs/` directory. */
function fixture() {
  const dir = tmp("docs");
  const backlog = join(dir, "backlog");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(dir, "state") };
  assert.equal(spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir }).status, 0);
  assert.equal(run(["init", "--dir", backlog, "--no-example"], dir, env).status, 0);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs", "real.md"), "# Real\n", "utf8");
  const created = run(["new", "--dir", backlog, "--title", "A task with links"], dir, env);
  assert.equal(created.status, 0, created.stderr);
  return { dir, backlog, env, id: (created.stdout.match(/([A-Z]+-\d+)/) || [])[1] };
}

const check = (fx) => run(["check", "--docs", "--dir", fx.backlog], fx.dir, fx.env);

// ── the four things that are not dead links ───────────────────────────────

test("an external URL is skipped — this guard asks no network questions", () => {
  for (const url of ["https://example.com/x", "http://example.com", "mailto:a@b.c", "//cdn/x.js"]) {
    assert.deepEqual(classifyTarget(url), { skip: "external" }, url);
  }
});

test("a `<repo>#<path>` reference is skipped by a RULE, and named as such", () => {
  // The convention this backlog already uses. Asserting the reason rather than
  // the absence of a finding is the point: a guard that merely failed to
  // resolve it would look identical from the outside.
  assert.deepEqual(classifyTarget("other-repo#qa/backlog.yaml"), { skip: "other-repository" });
  assert.deepEqual(classifyTarget("some-repo#docs/architecture/x.md"), { skip: "other-repository" });
});

test("…and a local path with an anchor is NOT mistaken for one", () => {
  // The positive control for the rule above. The half before the `#` is a real
  // path here, and a rule that could not tell the two apart would silently stop
  // checking every anchored link in the tree.
  assert.deepEqual(classifyTarget("docs/manual.md#the-contract"), { path: "docs/manual.md" });
  assert.deepEqual(classifyTarget("README.md#commands"), { path: "README.md" });
  assert.deepEqual(classifyTarget("../docs/a.md#x"), { path: "../docs/a.md" });
});

test("a bare `#section` is a link inside the page, not a path", () => {
  assert.deepEqual(classifyTarget("#where-the-data-lives"), { skip: "anchor-in-page" });
  assert.deepEqual(classifyTarget(""), { skip: "empty" });
});

test("an anchor resolves against the target document after path validation", () => {
  const docs = [{ file: "/r/docs/a.md", text: "[x](b.md#heading) and [y](b.md)" }];
  const audit = auditLinks(docs, (p) => p === "/r/docs/b.md", "/r", () => "# Heading\n");
  assert.deepEqual(audit.dead, [], "the anchor was carried into the path and broke it");
  assert.equal(audit.checked, 2, "the path and anchor are both local targets");
  assert.equal(audit.anchorsChecked, 1, "only the anchored link reads a heading");
});

test("heading anchors use the reader-facing slug, including duplicate headings", () => {
  assert.equal(headingSlug("The `--json` contract"), "the---json-contract");
  assert.deepEqual([...anchorsIn("# One\n## One\n### Two!\n")], ["one", "one-1", "two"]);
});

// ── the two resolution rules ──────────────────────────────────────────────

test("a markdown link resolves against its FILE, a related_docs entry against the ROOT", () => {
  // The defect the first draft of this guard had, and the reason it reported 44
  // links as dead that were not: `_template.md` says on the line beside the
  // field that `related_docs` paths are relative to the repository root, while
  // a markdown link between two tasks in one directory is a bare filename.
  const docs = [{
    file: "/r/backlog/tasks/T-1.md",
    text: "---\nrelated_docs:\n  - docs/manual.md\n---\n\nSee [the other](T-2.md).\n",
  }];
  const exists = (p) => p === "/r/docs/manual.md" || p === "/r/backlog/tasks/T-2.md";
  assert.deepEqual(auditLinks(docs, exists, "/r").dead, []);

  // …and swapping the two rules must break both, or the assertion above proves
  // nothing about which rule was applied.
  const swapped = (p) => p === "/r/backlog/tasks/docs/manual.md" || p === "/r/T-2.md";
  assert.equal(auditLinks(docs, swapped, "/r").dead.length, 2);
});

test("a leading slash resolves against the repository root", () => {
  const docs = [{ file: "/r/docs/deep/a.md", text: "[x](/README.md)" }];
  assert.deepEqual(auditLinks(docs, (p) => p === "/r/README.md", "/r").dead, []);
});

// ── the parsers ───────────────────────────────────────────────────────────

test("both link forms are read — inline and reference-style", () => {
  const found = linksIn("[a](one.md) text\n[ref]: two.md\n[t](<three.md> \"title\")\n");
  assert.deepEqual(found.map((l) => l.target).sort(), ["one.md", "three.md", "two.md"]);
  assert.deepEqual(found.map((l) => l.line).sort(), [1, 2, 3]);
});

test("related_docs is read in both shapes, and a trailing comment is not an entry", () => {
  assert.deepEqual(relatedDocsIn("related_docs:\n  - a.md\n  - b.md\nid: X\n").map((e) => e.target),
    ["a.md", "b.md"]);
  assert.deepEqual(relatedDocsIn("related_docs: [a.md, b.md]\n").map((e) => e.target), ["a.md", "b.md"]);
  // `_template.md` writes `related_docs: []   # paths relative to the repository
  // root`; a parser that kept the comment reported `]` as a dead link, and the
  // template as the most broken file in the repository.
  assert.deepEqual(relatedDocsIn("related_docs: []      # paths relative to the repository root\n"), []);
});

test("a code fence is not treated as prose the guard must skip", () => {
  // Deliberately NOT skipped: a link inside a fenced block is still a link a
  // reader will follow, and the measured breakage included examples in fences.
  const found = linksIn("```\n[a](one.md)\n```\n");
  assert.deepEqual(found.map((l) => l.target), ["one.md"]);
});

// ── end to end, with a positive control ───────────────────────────────────

test("a dead link FAILS, naming the file, the line and the target", () => {
  const fx = fixture();
  writeFileSync(join(fx.dir, "docs", "broken.md"), "See [the plan](missing.md).\n", "utf8");
  const r = check(fx);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /lead nowhere/);
  assert.match(r.stdout, /docs\/broken\.md:1/);
  assert.match(r.stdout, /missing\.md/);
});

test("…and the SAME repository passes once the file exists", () => {
  // The positive control the acceptance criteria ask for by name.
  const fx = fixture();
  writeFileSync(join(fx.dir, "docs", "broken.md"), "See [the plan](missing.md).\n", "utf8");
  assert.equal(check(fx).status, 1, "the control: it was red first");

  writeFileSync(join(fx.dir, "docs", "missing.md"), "# Now it is here\n", "utf8");
  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /each one resolving locally/);
});

test("a dead related_docs entry FAILS and is labelled as one", () => {
  const fx = fixture();
  const file = spawnSync("sh", ["-c", "ls backlog/tasks/" + fx.id + "-*.md"],
    { cwd: fx.dir, encoding: "utf8" }).stdout.trim();
  const path = join(fx.dir, file);
  writeFileSync(path,
    readFileSync(path, "utf8").replace(/^related_docs: .*$/m, "related_docs:\n  - docs/nowhere.md"),
    "utf8");

  const r = check(fx);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /related_docs/);
  assert.match(r.stdout, /nowhere\.md/);
});

test("a cross-repository reference does not fail the run", () => {
  const fx = fixture();
  writeFileSync(join(fx.dir, "docs", "cross.md"),
    "See [the plan](other-repo#qa/plan.yaml) and [a site](https://example.com).\n", "utf8");
  const r = check(fx);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /another repository were skipped on purpose/);
});

test("the green line says how much was looked at", () => {
  // "0 dead" over 0 links is a guard that found nothing to judge, and it must
  // not read like one that passed.
  const fx = fixture();
  writeFileSync(join(fx.dir, "docs", "ok.md"), "[a](real.md)\n", "utf8");
  const r = check(fx);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\d+ link\(s\) and related_docs entr\(ies\), including \d+ anchor\(s\), across \d+ document\(s\)/);
});

test("a missing local anchor FAILS, then the same document passes once the heading exists", () => {
  const fx = fixture();
  const path = join(fx.dir, "docs", "anchors.md");
  writeFileSync(path, "# Present\n\n[missing](#absent)\n", "utf8");
  const red = check(fx);
  assert.equal(red.status, 1, red.stdout + red.stderr);
  assert.match(red.stdout, /anchors\.md:3/);
  assert.match(red.stdout, /missing anchor/);

  writeFileSync(path, "# Present\n\n[present](#present)\n", "utf8");
  const green = check(fx);
  assert.equal(green.status, 0, green.stdout + green.stderr);
  assert.match(green.stdout, /including 1 anchor/);
});

// ── what it looks at ──────────────────────────────────────────────────────

test("it reads top-level markdown, docs/ and the task files — and not node_modules", () => {
  const fx = fixture();
  writeFileSync(join(fx.dir, "TOP.md"), "# Top\n", "utf8");
  mkdirSync(join(fx.dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(fx.dir, "node_modules", "x", "README.md"), "[a](nowhere.md)\n", "utf8");

  const files = documentsToCheck(fx.dir, join(fx.backlog, "tasks"));
  assert.ok(files.some((f) => f.endsWith("TOP.md")));
  assert.ok(files.some((f) => f.includes("/docs/")));
  assert.ok(files.some((f) => f.includes("/tasks/")));
  assert.equal(files.some((f) => f.includes("node_modules")), false,
    "somebody else's documentation is not this repository's defect");
  assert.equal(check(fx).status, 0, "a link in node_modules failed the run");
});

test("the document root is the repository, and the backlog's parent without git", () => {
  assert.equal(repositoryRoot("/r/backlog", { run: () => ({ status: 0, stdout: "/r\n" }) }), "/r");
  assert.equal(repositoryRoot("/r/backlog", { run: () => ({ status: 128, stdout: "" }) }), "/r");
});

// ── the whole repository ──────────────────────────────────────────────────

test("this repository passes its own guard", () => {
  // The only case with evidentiary weight about THIS tree: 344 targets across
  // 171 documents, where the defect was originally measured at 60%.
  const r = spawnSync(process.execPath, [CLI, "check", "--docs"], {
    cwd: REPO, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a bare `check` runs it", () => {
  const fx = fixture();
  writeFileSync(join(fx.dir, "docs", "broken.md"), "[x](missing.md)\n", "utf8");
  const bare = run(["check", "--dir", fx.backlog], fx.dir, fx.env);
  assert.notEqual(bare.status, 0, "the bare `check` did not run the docs guard");
  assert.match(bare.stdout, /lead nowhere/);
});

test("`--docs` selects it ALONE", () => {
  const fx = fixture();
  const only = check(fx);
  assert.equal(/id collisions|vocabulary|product name/.test(only.stdout), false,
    "the selector ran more than the guard it names:\n" + only.stdout);
});

test("an unknown argument to the guard is a usage error", () => {
  const r = spawnSync(process.execPath, [join(HERE, "..", "check-docs-links.mjs"), "--frobnicate"],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(r.status, 2);
});
