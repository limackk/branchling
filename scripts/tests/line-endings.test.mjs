/**
 * Every text file of this repository checks out with LF, whatever the cloning
 * machine prefers (TL-463).
 *
 * The first public Windows run failed 166 tests. Reproduced on macOS with
 * `git clone -c core.autocrlf=true`, 58 of them were line endings alone:
 * patterns written against `\n` meeting files that ended in `\r\n`. The rule
 * lives in `.gitattributes`; this asks git what it will actually do, because a
 * rule in that file can be present and still not apply to a path.
 *
 * THE POSITIVE CONTROL asks the same question in a repository without the
 * rule. If git reports `lf` there too, the question cannot tell the two apart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("line-endings");

function eolOf(cwd, path) {
  const out = execFileSync("git", ["check-attr", "eol", "--", path], { cwd, encoding: "utf8" });
  return out.trim().split(": ").pop();
}

test("a checkout writes LF into code, prose and task files alike", () => {
  for (const path of ["README.md", "scripts/cli.mjs", "backlog/config.yaml", ".github/workflows/test.yml"]) {
    assert.equal(eolOf(REPO_ROOT, path), "lf",
      path + " has no LF rule, so a Windows checkout writes it with CRLF");
  }
});

test("POSITIVE CONTROL: without the rule the same question answers otherwise", () => {
  const dir = mkdtempSync(join(tmpdir(), "branchling-eol-control-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    assert.notEqual(eolOf(dir, "README.md"), "lf");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
