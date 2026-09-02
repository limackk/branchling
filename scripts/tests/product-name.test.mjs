/**
 * The product-name guard actually fails, and the name really does come from the
 * manifest (TL-117).
 *
 * WHY THIS FILE EXISTS. Two claims are easy to make and were both false before
 * this task: "the guard catches a literal" and "renaming the product is one edit
 * to package.json". The first is checked by NEGATIVE CONTROLS — text and a real
 * file on disk that MUST be flagged. The second is checked END TO END: the
 * manifest is rewritten in a temporary copy of the tool and the CLI is asked
 * what it calls itself, because a guard proves only that nobody wrote the name
 * down, not that the plumbing carries a new one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALLOW_MARKER,
  CHECKED_PATHS,
  SOURCE_FILE,
  auditText,
  auditTree,
  names,
} from "../check-product-name.mjs";
import { BLOCK_MARKER_NAME, PRODUCT_NAME } from "../product.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("product-name");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const GUARD = join(ROOT, "scripts", "check-product-name.mjs");

// ── Negative controls: it has to say "no" ─────────────────────────────────

test("a help string holding the name is flagged", () => {
  const found = auditText(`console.log("${PRODUCT_NAME} build: done");`);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, PRODUCT_NAME);
});

test("a COMMENT holding the name is flagged too", () => {
  // The rename measured in this task was mostly comments and docstrings; a guard
  // reading only string literals would have missed the bulk of the cost.
  const found = auditText(` * \`${PRODUCT_NAME} doctor\` says whether it is set up`);
  assert.equal(found.length, 1);
});

test("the case does not matter", () => {
  const found = auditText(`// ${PRODUCT_NAME.toUpperCase()} is the tool`);
  assert.equal(found.length, 1);
});

test("the frozen block marker counts as a spelling of the name", () => {
  // `BLOCK_MARKER_NAME` may one day differ from `PRODUCT_NAME`; the guard has to
  // look for both, or the marker's word becomes a literal nobody checks.
  assert.ok(names().includes(BLOCK_MARKER_NAME));
});

test("the marker on the line turns one hit into a deliberate exception", () => {
  const found = auditText(`// docs/${PRODUCT_NAME}-notes.md — ${ALLOW_MARKER}`);
  assert.equal(found.length, 0);
});

test("the marker does NOT reach the line below it", () => {
  // Unlike the language guard: there the marker covers the next line, because a
  // long line has no room for it. Here a hit is one word in an ordinary line, and
  // a marker reaching downwards would silence more than the author intends.
  const found = auditText(`// ${ALLOW_MARKER}\n// run ${PRODUCT_NAME} build`);
  assert.equal(found.length, 1);
  assert.equal(found[0].line, 2);
});

// ── Positive control: the guard is aimed at a tree that exists ────────────

test("the guard reads a real, non-empty tree", () => {
  // A ✓ over zero files is green with no evidential force — the failure mode of
  // every guard that is quietly pointed at the wrong directory.
  const { filesChecked, linesChecked } = auditTree();
  assert.ok(filesChecked > 20, `only ${filesChecked} files read`);
  assert.ok(linesChecked > 1000, `only ${linesChecked} lines read`);
});

test("this repository passes", () => {
  const r = spawnSync(process.execPath, [GUARD], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a BARE `check` runs it — a guard wired to nothing passes every test of its own", () => {
  // The failure this asserts against is not hypothetical: a guard can be correct
  // in isolation and never called, and then `check` is green while the rule is
  // unenforced. So this runs `check` with NO selector — if the guard drops out of
  // the default set, this line fails, which `check --product-name` would not.
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "cli.mjs"), "check"], {
    encoding: "utf8",
  });
  assert.match(r.stdout, /product name:/, "the default `check` run does not include the guard");
});

test("`--product-name` selects it ALONE", () => {
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "cli.mjs"), "check", "--product-name"], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /product name:/);
  assert.ok(!/id collision|board|reference/i.test(r.stdout), "the selector ran other guards too");
});

// ── The end-to-end claim: the name comes from the manifest ────────────────

test("a literal planted in a real file makes the guard fail", () => {
  const dir = mkdtempSync(join(tmpdir(), "product-name-guard-"));
  try {
    for (const p of [...CHECKED_PATHS, "package.json"]) {
      cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    }
    const victim = join(dir, "scripts", "ui.mjs");
    writeFileSync(victim, `// run ${PRODUCT_NAME} build\n` + readFileSync(victim, "utf8"), "utf8");

    const { findings } = auditTree(dir);
    assert.ok(
      findings.some((f) => f.file === "scripts/ui.mjs" && f.line === 1),
      "the planted literal was not found: " + JSON.stringify(findings.slice(0, 3))
    );
    assert.ok(
      !findings.some((f) => f.file === SOURCE_FILE),
      "the one file allowed to spell the name was flagged"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renaming the product is ONE edit to package.json", () => {
  // The claim this whole task exists to make true. Nothing in `scripts/` is
  // touched: only `name` in the manifest changes, and the CLI must introduce
  // itself by the new name in help, in usage and in an error message.
  const dir = mkdtempSync(join(tmpdir(), "product-rename-"));
  try {
    for (const p of ["scripts", "bin", "package.json"]) {
      cpSync(join(ROOT, p), join(dir, p), { recursive: true });
    }
    const manifestPath = join(dir, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const renamed = "zzrenamed";
    manifest.name = renamed;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const cli = join(dir, "scripts", "cli.mjs");
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, new RegExp(renamed), "the help still uses the old name");
    assert.ok(
      !help.stdout.includes(PRODUCT_NAME),
      "the old name survived in the help text"
    );

    const bad = spawnSync(process.execPath, [cli, "check", "--nonsense"], { encoding: "utf8" });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, new RegExp(renamed), "an error message still uses the old name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
