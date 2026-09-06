/** The terminal monitor is one quiet frame, not a shell loop (TL-305). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWatchArgs, render, run } from "../watch.mjs";

test("the watch arguments make looping explicit and automation one-shot", () => {
  assert.deepEqual(parseWatchArgs([]), { dir: null, interval: 2, once: false, json: false });
  assert.deepEqual(parseWatchArgs(["--interval", "0.5", "--once"]), { dir: null, interval: 0.5, once: true, json: false });
  assert.equal(parseWatchArgs(["--json"]).once, true);
  assert.throws(() => parseWatchArgs(["--interval", "0"]), /positive/);
});

test("one frame carries the active wave, every wave task, current work and modification time", () => {
  const value = { wave: { index: 17, name: "Execution", open: 2, tasks: [
    { id: "TASK-1", status: "in_progress", owner: "agent:one", modified: "2026-09-06T10:00:00Z" },
    { id: "TASK-2", status: "pending", owner: "", modified: "2026-09-06T09:00:00Z" },
  ] }, tasks: [] };
  const text = render(value);
  assert.match(text, /WAVE 17  Execution/);
  assert.match(text, /▶ TASK-1  in_progress/);
  assert.match(text, /TASK-2  pending/);
  assert.match(text, /2026-09-06T10:00:00Z/);
});

test("a non-TTY invocation prints one frame and never schedules a loop", () => {
  const out = [];
  assert.equal(run([], { frame: () => ({ wave: null, tasks: [] }), write: (s) => out.push(s) }), 0);
  assert.match(out.join(""), /no active plan wave/);
});
