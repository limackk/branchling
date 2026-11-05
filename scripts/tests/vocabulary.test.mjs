/**
 * `vocabulary --json` answers the backlog's own words (TL-532).
 *
 * WHAT HAS TO BE PROVED. The answer comes from THIS backlog's `config.yaml`, not
 * from the defaults and not from this repository's words — so the fixture
 * renames a status and adds one the default vocabulary has never had, and the
 * test asserts the order, the archived set, the roles and where each role came
 * from. A fixture keeping the default words would pass against a command that
 * printed the defaults.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.mjs";
import { statusEntries } from "../vocabulary.mjs";
import { SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("vocabulary");
plainOutput();

const CLI = join(SCRIPTS_DIR, "cli.mjs");

function run(args) {
  return spawnSync(process.execPath, [CLI].concat(args), { encoding: "utf8", timeout: 60_000 });
}

/** A backlog whose `config.yaml` lines named in `lines` replace the template's. */
function backlog(lines) {
  const dir = mkdtempSync(join(tmpdir(), "branchling-vocabulary-"));
  assert.equal(run(["init", "--dir", dir, "--no-example"]).status, 0);
  const path = join(dir, "config.yaml");
  const keys = Object.keys(lines);
  const kept = readFileSync(path, "utf8").split("\n")
    .filter((l) => !keys.some((k) => l.startsWith(k + ":")));
  writeFileSync(path, kept.concat(keys.map((k) => k + ": " + lines[k])).join("\n") + "\n", "utf8");
  return dir;
}

const RENAMED = {
  statuses: "[backlog, doing, on_hold, review, shipped, dropped]",
  archived_statuses: "[shipped, dropped]",
  dashboard_open_statuses: "[backlog, doing, on_hold]",
  reason_required_statuses: "[on_hold, dropped]",
  in_progress_status: "doing",
  releases: "[\"2026.11\", \"2026.12\"]",
};

test("a renamed and an extra status answer in declared order, with roles and the archived set", () => {
  const dir = backlog({ ...RENAMED, status_roles: "\n  review: waiting" });
  const r = run(["vocabulary", "--dir", dir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.kind, "vocabulary");
  assert.deepEqual(answer.statuses, [
    { name: "backlog", archived: false, reasonRequired: false, role: "open", roleSource: "derived" },
    { name: "doing", archived: false, reasonRequired: false, role: "active", roleSource: "derived" },
    { name: "on_hold", archived: false, reasonRequired: true, role: "waiting", roleSource: "derived" },
    { name: "review", archived: false, reasonRequired: false, role: "waiting", roleSource: "status_roles" },
    { name: "shipped", archived: true, reasonRequired: false, role: "closed", roleSource: "derived" },
    { name: "dropped", archived: true, reasonRequired: true, role: "cancelled", roleSource: "derived" },
  ]);
  assert.deepEqual(answer.releases, [{ name: "2026.11", ref: null }, { name: "2026.12", ref: null }]);
  assert.deepEqual(answer.priorities, ["P0", "P1", "P2", "P3"]);
  assert.deepEqual(answer.boards.map((b) => b.isDefault), [true]);
  assert.deepEqual(answer.deploy_targets, []);
  assert.equal(answer.labels_closed, false);
});

test("POSITIVE CONTROL: without status_roles the extra status is derived, and says so", () => {
  const dir = backlog(RENAMED);
  const review = statusEntries(loadConfig(dir)).find((s) => s.name === "review");
  assert.deepEqual(review, { name: "review", archived: false, reasonRequired: false, role: "open", roleSource: "derived" });
});

test("a role that contradicts archived_statuses, or is not a role, is refused by the configuration", () => {
  for (const [roles, words] of [
    ["\n  shipped: active", /`shipped` is archived/],
    ["\n  doing: closed", /`doing` is active/],
    ["\n  doing: busy", /expecting one of open, active, waiting, closed, cancelled/],
    ["\n  nope: open", /`nope`, which is not in `statuses`/],
  ]) {
    const dir = backlog({ ...RENAMED, status_roles: roles });
    const r = run(["vocabulary", "--dir", dir, "--json"]);
    assert.equal(r.status, 1, roles + " was accepted");
    assert.match(r.stderr, words);
  }
});

test("an unknown flag is a usage error", () => {
  const dir = backlog(RENAMED);
  const r = run(["vocabulary", "--dir", dir, "--statuses"]);
  assert.equal(r.status, 2);
});
