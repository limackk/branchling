/**
 * A real mutation run counts kills made through a spawned process (TL-576).
 *
 * WHY THIS FILE IS OUTSIDE `scripts/tests/*.test.mjs`. It runs StrykerJS, a
 * devDependency, and the default suite is run by CI WITHOUT `npm install` on
 * purpose (`.github/workflows/test.yml`). It is run by name, as the closing
 * contract of TL-576 and before trusting a change to `mutation-run.mjs`:
 *
 *   node --test scripts/tests/mutation/subprocess-kill.test.mjs
 *
 * It does NOT skip when Stryker is missing. A skipped positive control is a
 * green run with no evidentiary force; a missing install is a failure that
 * says `npm install`.
 *
 * THE FIXTURE. `lib.mjs` is reached by the test ONLY through `greet.mjs`
 * running in a child process — the test file never imports it. That is the
 * shape of most of this repository's suite, and the shape on which Stryker's
 * TAP runner reports `NoCoverage` and skips the mutant. `greet` is asserted
 * exactly, so every mutant in it must be Killed. `shout` is executed but its
 * result is never asserted, so its mutants must SURVIVE: without that negative
 * half, "everything killed" could equally mean the run killed everything
 * regardless of the tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fixtureDir } from "../_fixture-dir.mjs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "../_repo.mjs";

isolateHome("mutation-kill");
const ENTRY = join(SCRIPTS_DIR, "mutation-run.mjs");

const LIB = `export function greet(name) {
  return "hello " + name;
}

export function shout(text) {
  return text.toUpperCase() + "!";
}
`;
const GREET_LINES = [1, 2, 3];
const SHOUT_LINES = [5, 6, 7];

const GREET = `import { greet, shout } from "./lib.mjs";
process.stderr.write(shout("unchecked"));
process.stdout.write(greet(process.argv[2]));
`;

const TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../greet.mjs", import.meta.url));

test("greet answers through a child process", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "world"], { encoding: "utf8" });
  assert.equal(r.stdout, "hello world");
});
`;

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, cmd + " " + args.join(" ") + ": " + r.stderr);
}

function write(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

test("Stryker is installed, so this control cannot pass by not running", () => {
  assert.doesNotThrow(
    () => createRequire(import.meta.url).resolve("@stryker-mutator/core/package.json"),
    "@stryker-mutator/core is missing — run `npm install`",
  );
});

test("a mutant killed only through a spawned process is Killed, and an unasserted one Survives", { timeout: 300_000 }, () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-kill-"));
  try {
    write(root, "scripts/greet.mjs", GREET);
    write(root, "scripts/tests/greet.test.mjs", TEST);
    write(root, "scripts/lib.mjs", "export function greet() {}\nexport function shout() {}\n");
    sh(root, "git", ["init", "-q"]);
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["commit", "-q", "-m", "base"]);
    sh(root, "git", ["switch", "-q", "-c", "feature"]);
    write(root, "scripts/lib.mjs", LIB);

    const r = spawnSync(process.execPath, [ENTRY, "--base", "main", "--json", "--concurrency", "2"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const out = JSON.parse(r.stdout);

    assert.deepEqual(out.modules, ["scripts/lib.mjs"]);
    assert.deepEqual(out.tests.map((t) => t.file), ["scripts/tests/greet.test.mjs"],
      "the test was not selected through the script that imports lib.mjs");
    assert.equal(out.noCoverage, 0);

    const counts = out.files["scripts/lib.mjs"];
    assert.ok(counts, "no result for lib.mjs: " + JSON.stringify(out.files));
    assert.ok(counts.Killed > 0, "a positive control with nothing killed proves nothing: " + r.stdout + r.stderr.slice(-2000));

    const survivedLines = new Set(out.survivors.map((s) => s.line));
    for (const line of GREET_LINES) {
      assert.ok(!survivedLines.has(line), "a mutant in greet() survived on line " + line + ": "
        + JSON.stringify(out.survivors.filter((s) => s.line === line)));
    }
    assert.ok(out.survivors.length > 0, "nothing survived, so the run did not tell asserted code from unasserted");
    for (const s of out.survivors) {
      assert.ok(SHOUT_LINES.includes(s.line), "a survivor outside shout(): " + JSON.stringify(s));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// TL-583. This repository links `.claude/skills/*` to `../../.agents/skills/*`,
// and `instructions.test.mjs` reads a skill through such a link. Stryker cannot
// copy a link to a directory into its sandbox; ignoring the directory holding
// the links removed the file, and the initial run went red before any mutant.
// The fixture reproduces the shape: a test reads through a directory link, a
// sibling regular file sits beside the link and must arrive too, and the link
// is relative, as git stores it.
test("a test that reads through a directory symlink passes in the sandbox", { timeout: 300_000 }, () => {
  const root = fixtureDir(join(tmpdir(), "branchling-test-mutation-link-"));
  try {
    write(root, "shared/skill/SKILL.md", "linked\n");
    write(root, "tools/settings.json", "{}\n");
    mkdirSync(join(root, "tools", "skills"), { recursive: true });
    symlinkSync("../../shared/skill", join(root, "tools", "skills", "skill"));
    write(root, "scripts/greet.mjs", GREET);
    write(root, "scripts/tests/greet.test.mjs", TEST + `
import { existsSync, readFileSync } from "node:fs";
test("the linked file and its sibling are both there", () => {
  const at = (p) => fileURLToPath(new URL("../../" + p, import.meta.url));
  assert.equal(readFileSync(at("tools/skills/skill/SKILL.md"), "utf8"), "linked\\n");
  assert.ok(existsSync(at("tools/settings.json")));
});
`);
    write(root, "scripts/lib.mjs", "export function greet() {}\nexport function shout() {}\n");
    sh(root, "git", ["init", "-q"]);
    sh(root, "git", ["add", "-A"]);
    sh(root, "git", ["commit", "-q", "-m", "base"]);
    sh(root, "git", ["switch", "-q", "-c", "feature"]);
    write(root, "scripts/lib.mjs", LIB);

    const r = spawnSync(process.execPath, [ENTRY, "--base", "main", "--json", "--concurrency", "2"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, "the run did not complete — a red dry run looks like this: " + r.stdout + r.stderr.slice(-3000));
    const out = JSON.parse(r.stdout);
    assert.ok(out.files["scripts/lib.mjs"].Killed > 0, "nothing killed: " + r.stdout);
    assert.equal(out.noCoverage, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
