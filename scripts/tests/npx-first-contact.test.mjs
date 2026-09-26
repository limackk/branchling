/**
 * The first command a stranger copies from the publication gate is:
 *
 *   npx --yes <path-to-package> -- --help
 *
 * `npx` forwards its separator to the package executable. That separator is
 * syntax for npm, not a request for the package's default command, so the
 * installed entry point must remove exactly that leading marker before the
 * dispatcher resolves help.
 */
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("npx-first-contact");
plainOutput();

const BIN = join(REPO_ROOT, "bin", "branchling.mjs");

function run(args, cwd) {
  try {
    return {
      status: 0,
      stdout: execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" }),
      stderr: "",
    };
  } catch (error) {
    return {
      status: error.status,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
    };
  }
}

test("the npx forwarding separator reaches top-level help", () => {
  const outside = mkdtempSync(join(tmpdir(), "branchling-npx-first-contact-"));
  try {
    // This is the exact argv shape npx passes after
    // `npx --yes <path-to-package> -- --help`. Running the package entry
    // directly makes the regression deterministic while still exercising the
    // installed boundary where npx's marker arrives.
    const throughNpx = run(["--", "--help"], outside);
    assert.equal(throughNpx.status, 0, throughNpx.stderr);
    assert.match(throughNpx.stdout, /^branchling — /, "the top-level heading is missing");
    assert.match(throughNpx.stdout, /^commands:$/m, "the command table is missing");
    assert.doesNotMatch(throughNpx.stdout, /^serve — /m,
      "npx's separator was treated as a request for the default command's help");

    // POSITIVE CONTROL: this is really package-entry help, not an assertion
    // that any output is accepted after a successful child process.
    const direct = run(["--help"], outside);
    assert.equal(direct.status, 0, direct.stderr);
    assert.equal(throughNpx.stdout, direct.stdout,
      "npx first contact does not answer with the same top-level help as the binary");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("only the package entry normalizes npx's leading separator", () => {
  const outside = mkdtempSync(join(tmpdir(), "branchling-npx-separator-"));
  try {
    const cli = join(REPO_ROOT, "scripts", "cli.mjs");
    const result = execFileSync(process.execPath, [cli, "--", "--help"], {
      cwd: outside,
      encoding: "utf8",
    });
    assert.match(result, /^serve — /m,
      "the dispatcher itself changed its existing separator behavior");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
