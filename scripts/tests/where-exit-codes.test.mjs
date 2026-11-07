/**
 * `where` exits with one code for a directory named explicitly that is not a
 * backlog, whichever of `--dir` and `BACKLOG_DIR` named it (TL-547).
 *
 * Before this, `main()` returned `report.backlog || !cli.dir ? 0 : 1`: the same
 * directory exited 1 through `--dir` and 0 through `BACKLOG_DIR`, and `--json`
 * exited 0 for both, while the header promised `1 no backlog found` for a state
 * that exited 0. `resolveBacklogDir()` is strict about both sources, and every
 * other command exits 1 for this state (TL-546), so `where` does too.
 *
 * Finding NO backlog stays 0: standing outside every repository is the
 * question `where` exists to answer, so the report there is an answer.
 *
 * Each refusing case is paired with the same source naming a real backlog, so
 * a `where` that exited 1 for everything could not pass, and the none-found
 * case asserts the report actually reached that state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fixtureDir } from "./_fixture-dir.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKLOG_DIR_REFUSAL_EXIT } from "../paths.mjs";
import { isolateHome, SCRIPTS_DIR } from "./_repo.mjs";

isolateHome("where-exit-codes");

const CLI = join(SCRIPTS_DIR, "cli.mjs");
const REFUSAL = /does not look like a backlog/;

const base = fixtureDir(join(tmpdir(), "branchling-where-exit-"));
const cwd = join(base, "cwd");
mkdirSync(cwd);

const plainDir = join(base, "plain");
mkdirSync(plainDir);

/** Not `<base>/backlog`: discovery walks upwards from `cwd` and would find it
 *  there, and the none-found case would no longer be one. */
const backlog = join(base, "named", "bl");
mkdirSync(join(backlog, "tasks"), { recursive: true });
writeFileSync(join(backlog, "config.yaml"), "");

function run(args, extraEnv = {}) {
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(base, ".state"), ...extraEnv };
  if (!("BACKLOG_DIR" in extraEnv)) delete env.BACKLOG_DIR;
  return spawnSync(process.execPath, [CLI, "where", ...args], {
    cwd, encoding: "utf8", timeout: 30_000, input: "", env,
  });
}

const SHAPES = [
  ["text", []],
  ["--json", ["--json"]],
];

for (const [shape, flags] of SHAPES) {
  test("where (" + shape + ") with no backlog anywhere answers with exit 0", () => {
    const r = run(flags);
    const all = r.stdout + r.stderr;
    assert.equal(r.status, 0, all);
    assert.doesNotMatch(all, REFUSAL, "the none-found case reached the not-a-backlog state:\n" + all);
    assert.match(all, /no backlog here/, "the none-found state was not reached:\n" + all);
  });

  test("where (" + shape + ") --dir <not a backlog> exits " + BACKLOG_DIR_REFUSAL_EXIT, () => {
    const r = run([...flags, "--dir", plainDir]);
    const all = r.stdout + r.stderr;
    assert.match(all, REFUSAL, all);
    assert.equal(r.status, BACKLOG_DIR_REFUSAL_EXIT, all);
  });

  test("where (" + shape + ") BACKLOG_DIR=<not a backlog> exits " + BACKLOG_DIR_REFUSAL_EXIT, () => {
    const r = run(flags, { BACKLOG_DIR: plainDir });
    const all = r.stdout + r.stderr;
    assert.match(all, REFUSAL, all);
    assert.equal(r.status, BACKLOG_DIR_REFUSAL_EXIT, all);
  });

  test("where (" + shape + ") exits 0 when --dir or BACKLOG_DIR names a backlog", () => {
    for (const r of [run([...flags, "--dir", backlog]), run(flags, { BACKLOG_DIR: backlog })]) {
      const all = r.stdout + r.stderr;
      assert.equal(r.status, 0, all);
      // Under --json the path is a JSON string, which writes each Windows `\` as `\\`.
      const spelled = [backlog, JSON.stringify(backlog).slice(1, -1)];
      assert.ok(spelled.some((p) => all.includes(p)), "the named backlog is not in the report:\n" + all);
    }
  });
}

test("--json carries the same report for a directory that is not a backlog", () => {
  const report = JSON.parse(run(["--json", "--dir", plainDir]).stdout);
  assert.equal(report.backlog, null);
  assert.match(report.error, REFUSAL);
});
