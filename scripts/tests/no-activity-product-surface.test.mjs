/** The reduced product does not expose activity telemetry (TL-378). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import { COMMANDS, resolveCommand } from "../cli.mjs";
import { SCRIPTS_DIR, plainOutput } from "./_repo.mjs";

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
