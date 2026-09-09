/**
 * Attribution requires a deliberately named scope (TL-258).
 *
 * Attribution is append-only. The unsafe failure is therefore not merely a
 * broad edit: it is a false author-and-reason record that cannot be removed.
 * The refusal test uses exactly one candidate, because the former ambiguity
 * guard already stopped several candidates and would otherwise hide the defect.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FIELD_ATTRIBUTED, readHistory, unattributedChanges } from "../history.mjs";
import { BACKLOG_DIR, SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

isolateHome("history-attribute-scope");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env,
  });
}

function fixture(count) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-history-attribute-scope-"));
  const backlog = join(dir, "backlog");
  const env = {
    ...process.env,
    BACKLOG_ACTOR: "local:creator",
    BACKLOG_STATE_DIR: join(dir, "state"),
    NO_COLOR: "1",
  };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const ids = [];
  for (let i = 0; i < count; i++) {
    const created = run(["new", "--dir", backlog, "--title", "Unowned change " + (i + 1)], env);
    assert.equal(created.status, 0, created.stderr);
    ids.push((created.stdout.match(/([A-Z]+-\d+)/) || [])[1]);
  }
  const files = ids.map((id) => join(backlog, "tasks",
    readdirSync(join(backlog, "tasks")).find((name) => name.startsWith(id + "-"))));
  for (const file of files) {
    assert.equal(run(["history", "--dir", backlog, "--file", file,
      "--actor", "unknown", "--quiet"], env).status, 0);
    writeFileSync(file, readFileSync(file, "utf8").replace(/^status: .*$/m, "status: in_progress"), "utf8");
    assert.equal(run(["history", "--dir", backlog, "--file", file,
      "--actor", "unknown", "--source", "external", "--quiet"], env).status, 0);
  }
  return { dir, backlog, env, ids, files };
}

function historyBytes(backlog, ids) {
  return ids.map((id) => readFileSync(join(backlog, "history", id + ".jsonl"), "utf8"));
}

test("unscoped --attribute refuses before it can append a false claim", () => {
  const { dir, backlog, env, ids } = fixture(1);
  try {
    assert.equal(unattributedChanges(backlog).length, 1,
      "the positive control needs one candidate the old unscoped command would claim");
    const before = historyBytes(backlog, ids);
    const refused = run(["history", "--dir", backlog, "--attribute", "--actor", "local:author",
      "--reason", "I made this change"], env);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /requires `--file <task\.md>` or the explicit `--all`/);
    assert.deepEqual(historyBytes(backlog, ids), before,
      "the refusal wrote an append-only attribution record");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file-scoped attribution keeps the one-task workflow", () => {
  const { dir, backlog, env, ids, files } = fixture(1);
  try {
    const claimed = run(["history", "--dir", backlog, "--file", files[0], "--attribute",
      "--actor", "local:author", "--reason", "I made this change"], env);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.match(claimed.stdout, /claimed 1 recorded change/);
    assert.equal(unattributedChanges(backlog, { only: ids }).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--all names its breadth before deliberately claiming every candidate", () => {
  const { dir, backlog, env, ids } = fixture(2);
  try {
    assert.equal(unattributedChanges(backlog).length, 2,
      "the positive control needs a genuinely broad operation");
    const claimed = run(["history", "--dir", backlog, "--attribute", "--all",
      "--actor", "local:author", "--reason", "I reconciled the imported records"], env);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.match(claimed.stdout, /--all will claim 2 recorded change/);
    assert.match(claimed.stdout, /claimed 2 recorded change/);
    for (const id of ids) {
      assert.equal(readHistory(backlog, id).filter((entry) => entry.field === FIELD_ATTRIBUTED).length, 1);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the task records the selected scope rule as a decision event", () => {
  const decision = readHistory(BACKLOG_DIR, "TL-258").find((entry) =>
    entry.field === "__decision__" && entry.chose === 2);
  assert.ok(decision, "TL-258 has no selected scope decision in its append-only history");
  assert.match(decision.to, /--file or an explicit --all/);
});
