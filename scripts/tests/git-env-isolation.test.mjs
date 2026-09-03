/**
 * The suite's verdict must not depend on whose machine it runs on (TL-174).
 *
 * `isolateHome()` closed this for the configuration the TOOL reads (TL-166).
 * Git's own configuration was one layer below it and was never isolated, so the
 * hole was still open: measured on 2026-09-02, a global `commit.gpgsign=true`
 * with an ssh agent that declined to sign turned twelve tests in
 * `activity.test.mjs` red at the line that BUILDS the fixture, reported as
 * `128 !== 0` — a message naming none of the reasons that were true.
 *
 * THREE THINGS ARE ASSERTED, and the middle one is the only one that proves
 * anything on its own:
 *   1. the isolation is in force in this process at all;
 *   2. a HOSTILE global configuration cannot reach a fixture — with its own
 *      positive control, a child run WITHOUT the isolation, which must fail.
 *      Without that half, this file would pass just as well against an
 *      isolation that does nothing on a machine that happens to be configured
 *      harmlessly, which is every CI machine;
 *   3. a test file that spawns git calls `isolateHome()`, because the isolation
 *      is by ENVIRONMENT and a file that never sets it up gets the developer's
 *      configuration back.
 *
 * WHY BY ENVIRONMENT AND NOT A SHARED `git()` HELPER. Eight of the twenty test
 * files that shell out to git passed `-c commit.gpgsign=false` and the rest did
 * not — an unenforced convention — and even complete it would have covered
 * signing alone. `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` neutralise the whole
 * file: aliases, `core.hooksPath`, `init.defaultBranch`, `commit.template`, and
 * whatever the next machine turns out to carry. It also reaches the git
 * processes the TOOL spawns, which no flag written in a test ever could.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const HOME = isolateHome("git-env-isolation");

const TESTS_DIR = join(SCRIPTS_DIR, "tests");

/** A global git configuration of the kind that broke the suite: it signs every
 *  commit with a key that cannot possibly work. Deterministic — it does not
 *  depend on an ssh agent being present or refusing. */
function hostileConfig() {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-hostile-git-"));
  const file = join(dir, "gitconfig");
  writeFileSync(file, [
    "[user]", "\tname = Somebody", "\temail = somebody@example.invalid",
    "\tsigningkey = " + join(dir, "no-such-key"),
    "[commit]", "\tgpgsign = true",
    "[gpg]", "\tformat = ssh",
    "", ].join("\n"), "utf8");
  return file;
}

/** A one-commit repository, built with the environment the caller gives. */
function commitUnder(env) {
  const dir = mkdtempSync(join(tmpdir(), "worktrail-git-env-"));
  const git = (...args) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
  git("init", "-q", ".");
  writeFileSync(join(dir, "a.txt"), "x\n", "utf8");
  git("add", "-A");
  return git("commit", "-qm", "a commit");
}

// ── 1. the isolation is in force ──────────────────────────────────────────

test("isolateHome points git at an empty configuration inside the throwaway home", () => {
  assert.ok(process.env.GIT_CONFIG_GLOBAL, "GIT_CONFIG_GLOBAL is not set — the isolation never ran");
  assert.ok(process.env.GIT_CONFIG_GLOBAL.startsWith(HOME),
    "the isolated configuration must live inside the throwaway home, not anywhere the user owns");
  assert.ok(existsSync(process.env.GIT_CONFIG_GLOBAL));
  assert.equal(readFileSync(process.env.GIT_CONFIG_GLOBAL, "utf8"), "",
    "an isolated configuration with content in it is somebody's configuration again");
  assert.equal(process.env.GIT_CONFIG_SYSTEM, process.env.GIT_CONFIG_GLOBAL);
  assert.ok(process.env.GIT_AUTHOR_EMAIL, "with the global file empty there is no identity, and every commit fails for a second reason");
});

test("git in this process reports the isolated values, not the machine's", () => {
  const read = (key) => spawnSync("git", ["config", "--get", key], { encoding: "utf8" }).stdout.trim();
  assert.equal(read("commit.gpgsign"), "false");
  assert.equal(read("init.defaultBranch"), "main");
});

// ── 2. a hostile configuration cannot reach a fixture ─────────────────────

test("a fixture commits cleanly under the isolation, whatever the machine says", () => {
  const r = commitUnder({ ...process.env, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL });
  assert.equal(r.status, 0, "a fixture repository has no reason to be signed:\n" + r.stderr);
});

test("POSITIVE CONTROL: the same commit WITHOUT the isolation fails", () => {
  // Without this, the test above would pass just as well against an isolation
  // that does nothing — which is indistinguishable on a machine configured
  // harmlessly, i.e. on every CI runner.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: hostileConfig() };
  delete env.GIT_CONFIG_COUNT;
  delete env.GIT_CONFIG_KEY_0;
  delete env.GIT_CONFIG_VALUE_0;
  delete env.GIT_CONFIG_KEY_1;
  delete env.GIT_CONFIG_VALUE_1;
  const r = commitUnder(env);
  assert.notEqual(r.status, 0,
    "a global configuration demanding a signature it cannot produce must break this commit — " +
      "if it does not, the isolation above proves nothing");
});

test("the user's own configuration is never written to", () => {
  // The isolation writes exactly one file, and it is inside the throwaway home.
  // Nothing here may reach a path the person running the suite owns.
  const written = process.env.GIT_CONFIG_GLOBAL;
  assert.ok(written.startsWith(tmpdir()), "the isolated configuration is outside a temporary directory: " + written);
});

// ── 3. every file that spawns git sets it up ──────────────────────────────

/** PURE — given file names and a reader, which ones spawn git without first
 *  isolating the environment it will read? */
export function gitWithoutIsolation(names, read) {
  return names
    .filter((f) => f.endsWith(".test.mjs"))
    .filter((f) => {
      const text = read(f);
      if (!/["']git["']/.test(text)) return false;
      return !/\bisolateHome\s*\(/.test(text) && !/\bisolateGit\s*\(/.test(text);
    });
}

test("every test file that spawns git isolates the environment first", () => {
  const names = readdirSync(TESTS_DIR).sort();
  assert.deepEqual(gitWithoutIsolation(names, (f) => readFileSync(join(TESTS_DIR, f), "utf8")), [],
    "these files run git against whatever configuration the machine happens to carry — " +
      "call `isolateHome(\"<name>\")` once at the top");
});

test("POSITIVE CONTROL: a file that spawns git and isolates nothing is CAUGHT", () => {
  const files = {
    "good.test.mjs": 'import { isolateHome } from "./_repo.mjs";\nisolateHome("g");\nspawnSync("git", ["init"]);\n',
    "bad.test.mjs": 'spawnSync("git", ["init"]);\n',
    "irrelevant.test.mjs": 'test("no git here", () => {});\n',
  };
  assert.deepEqual(gitWithoutIsolation(Object.keys(files).sort(), (f) => files[f]), ["bad.test.mjs"]);
});
