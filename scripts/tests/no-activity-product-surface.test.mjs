/** The reduced product does not expose activity telemetry (TL-378). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { COMMANDS, resolveCommand } from "../cli.mjs";
import { BACKLOG_DIR, SCRIPTS_DIR, isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("no-activity-product-surface");
plainOutput();

const REMOVED = ["activity", "focus", "time", "sessions", "session", "actors", "quote", "backfill-completions"];

test("telemetry commands are absent from the terminal and MCP command surface", () => {
  for (const name of REMOVED) {
    assert.ok(!Object.hasOwn(COMMANDS, name), name + " is not an exported command");
    assert.throws(() => resolveCommand([name]), /unknown command/, name + " is refused by the dispatcher");

    const result = spawnSync(process.execPath, [SCRIPTS_DIR + "/cli.mjs", name], { encoding: "utf8" });
    assert.notEqual(result.status, 0, name + " did not run");
    assert.match(result.stderr, /unknown command/, name + " explains the refusal");
  }
});

test("the evidence-gated queue and task-history audit remain public", () => {
  for (const name of ["next", "take", "done", "audit", "history"]) {
    assert.ok(Object.hasOwn(COMMANDS, name), name + " remains in the core loop");
  }
});

/**
 * The repository carries no activity data either (TL-394).
 *
 * TL-378 removed the writer and TL-391 the last two references to it, but 206
 * per-task aggregates stayed in `backlog/activity/rollup/` — minutes worked,
 * session counts, first and last timestamp, for a repository with one author.
 * Nothing wrote them, nothing read them, and the `prune` and `forget` that had
 * justified committing them in the first place were gone, so nobody could
 * correct or withdraw them either.
 *
 * `docs/backlog-time-tracking.md` says upgrading never deletes anyone's data:
 * that is a promise about OTHER people's trees, and this is the owner of this
 * one deciding about their own. The files leave the working tree; the objects
 * stay in the history, which is immutable here and does not reopen for this.
 */
test("the backlog holds no activity data directory", () => {
  const dir = join(BACKLOG_DIR, "activity");
  assert.equal(existsSync(dir), false,
    dir + " is back — nothing writes it, nothing reads it and nothing can withdraw it");
  // The other half: a wrong path would make the assertion above true and
  // worthless.
  assert.ok(existsSync(join(BACKLOG_DIR, "history")),
    "the durable ledger is missing, so this test is looking at the wrong directory");
});
