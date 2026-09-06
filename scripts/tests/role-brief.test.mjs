/**
 * Reviewed role briefs (TL-264).
 *
 * A role is a project vocabulary value, while its prompt is reviewed prose that
 * travels with the backlog. The test exercises the command boundary because a
 * launcher needs its stdout to be usable without parsing terminal decoration.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("role-brief");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
let counter = 0;

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    cwd, encoding: "utf8", timeout: 60_000, env: { ...process.env, NO_COLOR: "1" },
  });
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "branchling-role-brief-" + counter++ + "-"));
  execFileSync("git", ["init", "-q", "-b", "main", "."], { cwd: repo, stdio: "ignore" });
  const dir = join(repo, "backlog");
  const init = run(["init", "--dir", dir, "--no-example", "--no-nudge"], repo);
  assert.equal(init.status, 0, init.stderr);
  const config = join(dir, "config.yaml");
  writeFileSync(config, readFileSync(config, "utf8") + "\nroles: [writer, reviewer]\n", "utf8");
  return { repo, dir };
}

test("a declared role's brief is raw launcher input in text and JSON", () => {
  const fx = fixture();
  const brief = "# Writer\n\nWrite only the requested contract.\n";
  const roles = join(fx.dir, "roles");
  mkdirSync(roles, { recursive: true });
  writeFileSync(join(roles, "writer.md"), brief, "utf8");

  const text = run(["instructions", "role", "writer", "--dir", fx.dir], fx.repo);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(text.stdout, brief, "a launcher would have to strip terminal output");
  assert.equal(text.stderr, "");

  const json = run(["instructions", "role", "writer", "--json", "--dir", fx.dir], fx.repo);
  assert.equal(json.status, 0, json.stderr);
  const body = JSON.parse(json.stdout);
  assert.equal(body.kind, "instructions");
  assert.equal(body.topic, "role");
  assert.equal(body.role, "writer");
  assert.equal(body.text, brief);
});

test("roles without briefs keep their existing behaviour; a requested brief names the remedy", () => {
  const fx = fixture();
  assert.equal(run(["build", "--dir", fx.dir], fx.repo).status, 0,
    "a roles-only backlog stopped working");

  const missing = run(["instructions", "role", "writer", "--dir", fx.dir], fx.repo);
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(missing.stderr, /role `writer` has no brief/);
  assert.match(missing.stderr, /roles\/writer\.md/);
});

test("an undeclared role and a missing role argument are usage errors", () => {
  const fx = fixture();
  const unknown = run(["instructions", "role", "publisher", "--dir", fx.dir], fx.repo);
  assert.equal(unknown.status, 2, unknown.stderr);
  assert.match(unknown.stderr, /unknown role `publisher`/);
  assert.match(unknown.stderr, /writer, reviewer/);

  const missing = run(["instructions", "role", "--dir", fx.dir], fx.repo);
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /role requires a declared role name/);
});
