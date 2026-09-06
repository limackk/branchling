/**
 * One attribution names one reconciled event (TL-302).
 *
 * The fixture reproduces the incident: an old unowned creation and a newer
 * reconciled field change share one task log. A file path narrows the task, not
 * the event, so an unqualified claim must stop before appending anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FIELD_ATTRIBUTED, FIELD_CREATED, historyPath, readHistory, unattributedChanges,
} from "../history.mjs";
import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

const CLI = join(SCRIPTS_DIR, "cli.mjs");

isolateHome("history-attribution-target");

function run(args, env) {
  return spawnSync(process.execPath, [CLI].concat(args), {
    encoding: "utf8", timeout: 30_000, env,
  });
}

function fixture({ unknownCreation }) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-history-target-"));
  const backlog = join(dir, "backlog");
  const env = {
    ...process.env,
    BACKLOG_STATE_DIR: join(dir, "state"),
    BACKLOG_ACTOR: unknownCreation ? "unknown" : "local:creator",
    NO_COLOR: "1",
  };
  assert.equal(run(["init", "--dir", backlog, "--no-example"], env).status, 0);
  const created = run(["new", "--dir", backlog, "--title", "Attribution target"], env);
  assert.equal(created.status, 0, created.stderr);
  const id = (created.stdout.match(/([A-Z]+-\d+)/) || [])[1];
  const file = join(backlog, "tasks",
    readdirSync(join(backlog, "tasks")).find((name) => name.startsWith(id + "-")));

  // Establish the reference point, then let the external reconciler observe a
  // later field change without an author.
  assert.equal(run(["history", "--dir", backlog, "--file", file,
    "--actor", "unknown", "--quiet"], env).status, 0);
  const text = readFileSync(file, "utf8");
  writeFileSync(file, text.replace(/^status: .*$/m, "status: in_progress"), "utf8");
  assert.equal(run(["history", "--dir", backlog, "--file", file,
    "--actor", "unknown", "--source", "external", "--quiet"], env).status, 0);
  return { dir, backlog, env, file, id };
}

test("one named event is attributed without claiming an older creation", () => {
  const { dir, backlog, env, file, id } = fixture({ unknownCreation: true });
  try {
    const candidates = unattributedChanges(backlog, { only: [id] });
    assert.equal(candidates.length, 2, "the positive control needs two candidates");
    const creation = candidates.find(({ entry }) => entry.field === FIELD_CREATED).entry;
    const status = candidates.find(({ entry }) => entry.field === "status").entry;

    const listed = run(["history", "--dir", backlog, "--file", file,
      "--actor", "local:author"], env);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, new RegExp(creation.id));
    assert.match(listed.stdout, new RegExp(status.id));

    const before = readFileSync(historyPath(backlog, id), "utf8");
    const ambiguous = run(["history", "--dir", backlog, "--file", file,
      "--attribute", "--actor", "local:author", "--reason", "I changed the status"], env);
    assert.equal(ambiguous.status, 1);
    assert.match(ambiguous.stderr, /--event <id>/);
    assert.equal(readFileSync(historyPath(backlog, id), "utf8"), before,
      "an ambiguous claim appended a history line");

    const targeted = run(["history", "--dir", backlog, "--file", file,
      "--attribute", "--event", status.id, "--actor", "local:author",
      "--reason", "I changed the status"], env);
    assert.equal(targeted.status, 0, targeted.stderr);
    assert.match(targeted.stdout, /claimed 1 recorded change/);

    const claims = readHistory(backlog, id).filter((entry) => entry.field === FIELD_ATTRIBUTED);
    assert.deepEqual(claims.map((entry) => entry.attributes), [status.id]);
    assert.deepEqual(unattributedChanges(backlog, { only: [id] })
      .map(({ entry }) => entry.id), [creation.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("one candidate keeps the short file-scoped attribution workflow", () => {
  const { dir, backlog, env, file, id } = fixture({ unknownCreation: false });
  try {
    assert.equal(unattributedChanges(backlog, { only: [id] }).length, 1);
    const claimed = run(["history", "--dir", backlog, "--file", file,
      "--attribute", "--actor", "local:author", "--reason", "I changed the status"], env);
    assert.equal(claimed.status, 0, claimed.stderr);
    assert.match(claimed.stdout, /claimed 1 recorded change/);
    assert.equal(unattributedChanges(backlog, { only: [id] }).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
