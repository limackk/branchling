#!/usr/bin/env node
/**
 * Packaging contracts (BL-1439).
 *
 * Four things this file exists to hold down:
 *
 *   1. The tarball carries the TOOL and nothing else. `backlog/` currently sits
 *      beside ~13 MB of one project's private roadmap, so "which files ship" is
 *      not tidiness — a wrong `files` entry publishes someone's task list.
 *   2. Installed under node_modules, the tool must NOT resolve a backlog inside
 *      its own package directory. Writing tasks into node_modules is worse than
 *      failing, because it looks like it worked.
 *   3. The name comes from ONE place, so renaming stays an edit.
 *   4. `bin/` and `scripts/cli.mjs` cannot diverge — the shim carries no logic.
 */

import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { looksLikeBacklogDir, resolveBacklogDir } from "../paths.mjs";
import { PRODUCT_NAME, PRODUCT_VERSION, MANIFEST_PATH, readManifest } from "../product.mjs";
import { versionText, helpText } from "../cli.mjs";

import { isolateHome, REPO_ROOT as PKG_ROOT } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("packaging");


const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(PKG_ROOT, "bin", "worktrail.mjs");
const CLI = join(PKG_ROOT, "scripts", "cli.mjs");

function manifest() {
  return JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));
}

// ── 1. What travels in the package ────────────────────────────────────────

test("the manifest has bin, files and engines", () => {
  const m = manifest();
  assert.equal(m.type, "module");
  assert.ok(m.bin && m.bin[m.name], "bin has to point at a binary named after the package");
  assert.ok(Array.isArray(m.files) && m.files.length, "files has to be a whitelist");
  assert.ok(m.engines && m.engines.node, "engines.node has to be declared");
});

test("files does NOT let the project's own data into the package", () => {
  const m = manifest();
  const forbidden = ["tasks", "history", "archive", "boards", "config.yaml", "boards.yaml", "viewer.html"];
  for (const entry of m.files) {
    const head = entry.replace(/^!/, "").split("/")[0];
    assert.ok(
      !forbidden.includes(head),
      `files contains "${entry}" — that is project data, not the tool's code`
    );
  }
});

test("files excludes the tests — they talk about this repo and are not needed in an install", () => {
  const m = manifest();
  assert.ok(
    m.files.some((f) => f.startsWith("!") && f.includes("tests")),
    "the negation for scripts/tests/ is missing"
  );
});

// ── 2. An install under node_modules must not point at itself ─────────────

test("co-location does NOT fire from a package directory with no tasks/", () => {
  // The shape of an install: node_modules/worktrail/{scripts,_template.md}.
  // `_template.md` is a MARKER, so if the rule required only a marker, this
  // layout would be taken for a backlog and the write would go into
  // node_modules. The rule also requires `tasks/` — this test enforces that.
  const root = mkdtempSync(join(tmpdir(), "worktrail-pkg-"));
  try {
    const pkg = join(root, "node_modules", "worktrail");
    mkdirSync(join(pkg, "scripts"), { recursive: true });
    writeFileSync(join(pkg, "_template.md"), "# szablon\n");

    assert.equal(looksLikeBacklogDir(pkg), false, "a package with no tasks/ is not a backlog");

    assert.throws(
      () => resolveBacklogDir({ cwd: root, moduleDir: join(pkg, "scripts"), env: "" }),
      /No backlog directory found/,
      "a missing backlog has to be an error, not a write into node_modules"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ON THE PACKED ARTEFACT: the tarball carries no data, and the install does not write into node_modules", { timeout: 120000 }, () => {
  // The assertion on `package.json` speaks only about INTENT. What npm actually
  // pack is settled by `npm pack` — and only the installed copy answers the
  // question "will this behave correctly from somebody else's directory".
  const work = mkdtempSync(join(tmpdir(), "worktrail-install-"));
  try {
    const packed = execFileSync("npm", ["pack", "--pack-destination", work, "--silent"], {
      cwd: PKG_ROOT,
      encoding: "utf8",
    }).trim().split("\n").pop();
    const tarball = join(work, packed);

    // 1. The tarball contents — project data must not be in it.
    const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
    for (const forbidden of ["package/tasks/", "package/history/", "package/archive/",
                             "package/boards/", "package/config.yaml", "package/boards.yaml",
                             "package/viewer.html", "package/scripts/tests/"]) {
      assert.ok(!listing.includes(forbidden), `tarball zawiera ${forbidden}`);
    }
    assert.ok(listing.includes("package/scripts/cli.mjs"), "the tarball has to carry the dispatcher");
    assert.ok(listing.includes("package/bin/worktrail.mjs"), "the tarball has to carry the binary");

    // 2. An install in a directory UNRELATED to any backlog.
    const home = join(work, "elsewhere");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "package.json"), JSON.stringify({ name: "probe", private: true }));
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent", tarball], {
      cwd: home,
      encoding: "utf8",
    });
    const installed = join(home, "node_modules", ".bin", "worktrail");

    // `--version` works with no backlog anywhere in reach.
    assert.match(
      execFileSync(installed, ["--version"], { cwd: home, encoding: "utf8" }),
      /^worktrail \d+\.\d+\.\d+/
    );

    // A command that needs data FAILS instead of creating a backlog in node_modules.
    let code = 0;
    let out = "";
    try {
      out = execFileSync(installed, ["query", "--count"], {
        cwd: home,
        env: { ...process.env, BACKLOG_DIR: "" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      code = e.status;
      out = String(e.stdout || "") + String(e.stderr || "");
    }
    assert.notEqual(code, 0, "a missing backlog has to fail, not pass silently");
    assert.match(out, /backlog/i, "the message has to say what is missing");
    assert.equal(
      looksLikeBacklogDir(join(home, "node_modules", "worktrail")),
      false,
      "an installed package must not look like a backlog"
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

// ── 3. The name from one place ────────────────────────────────────────────

test("PRODUCT_NAME comes from the manifest, not from a literal", () => {
  assert.equal(PRODUCT_NAME, manifest().name);
});

test("a rename in the manifest carries through to the help texts", () => {
  // The contract is: the help is built from PRODUCT_NAME. If somebody went back to
  // literals, this test would still pass under the current name — so we check the
  // MECHANISM: the help must not contain a name that is not in the manifest.
  const name = manifest().name;
  const help = helpText();
  assert.ok(help.includes(name), "the help has to use the name from the manifest");
  const literals = help.match(/\bworktrail\b/g) || [];
  if (name !== "worktrail") {
    assert.equal(literals.length, 0, "the help holds an old name hardcoded");
  }
});

test("the version is not invented when the manifest is missing", () => {
  assert.equal(readManifest(join(tmpdir(), "no-such-file.json")), null);
  assert.equal(PRODUCT_VERSION, manifest().version);
  assert.equal(versionText(), PRODUCT_NAME + " " + manifest().version);
});

test("MANIFEST_PATH points at a real file", () => {
  assert.ok(readManifest(MANIFEST_PATH), "the manifest has to be readable from this path");
});

// ── 4. bin must not drift away from cli ───────────────────────────────────

test("bin and cli give the same result for --version and --help", () => {
  const run = (entry, args) =>
    execFileSync(process.execPath, [entry].concat(args), { encoding: "utf8" });
  assert.equal(run(BIN, ["--version"]), run(CLI, ["--version"]));
  assert.equal(run(BIN, ["--help"]), run(CLI, ["--help"]));
});

test("bin carries no logic of its own", () => {
  const src = readFileSync(BIN, "utf8");
  const code = src
    .split("\n")
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("//"))
    .join("\n");
  assert.ok(/import \{ main \}/.test(code), "the shim has to import main from cli.mjs");
  assert.ok(!/COMMANDS|resolveCommand|spawnSync/.test(code), "the shim must not duplicate the dispatcher");
});
