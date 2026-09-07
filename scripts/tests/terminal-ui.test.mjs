import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { interactiveAllowed, keyFromChunk, moveSelection, numberedPrompt, renderChoices, renderPrompt, selectChoice } from "../terminal-ui.mjs";
import { plain } from "../ui.mjs";

test("keyboard parsing and selection wrap without terminal state", () => {
  assert.equal(keyFromChunk("\u001b[A"), "up");
  assert.equal(keyFromChunk("\u001b[B"), "down");
  assert.equal(keyFromChunk("\r"), "enter");
  assert.equal(keyFromChunk("\u001b"), "cancel");
  assert.equal(moveSelection(0, 3, "up"), 2);
  assert.equal(moveSelection(2, 3, "down"), 0);
  assert.deepEqual(renderChoices([{ label: "Generalist" }, { label: "Fleet" }], 1), ["  Generalist  1)", "› Fleet  2)"]);
  assert.deepEqual(renderPrompt("Mode", [{ label: "Generalist" }, { label: "Fleet" }], 0, plain), ["Mode", "", "› Generalist  1)", "  Fleet  2)", "", "↑/↓ move  ·  Enter select  ·  Esc cancel"]);
  assert.equal(numberedPrompt("Mode", [{ label: "Generalist" }, { label: "Fleet" }]), "Mode [1-2]: ");
});

test("text fallback preserves numbered input and never enables raw mode", async () => {
  let asked = "";
  const result = await selectChoice("Mode", [{ label: "Generalist", value: "one" }, { label: "Fleet", value: "two" }], {
    input: { isTTY: false }, output: { isTTY: false }, env: {}, ask: async (prompt) => { asked = prompt; return "2"; },
  });
  assert.deepEqual(result, { ok: true, value: "two", index: 1, mode: "text" });
  assert.equal(asked, "Mode [1-2]: ");
  assert.equal(interactiveAllowed({ isTTY: true }, { isTTY: true }, { NO_COLOR: "1" }), false);
  assert.equal(interactiveAllowed({ isTTY: true }, { isTTY: true }, { TERM: "dumb" }), false);
});

test("cancel and invalid text remain explicit results for accessible callers", async () => {
  const options = [{ label: "Create profile", value: "1" }, { label: "Cancel", value: "3" }];
  const cancelled = await selectChoice("Create", options, {
    input: { isTTY: false }, output: { isTTY: false }, env: {}, ask: async () => "cancel",
  });
  assert.deepEqual(cancelled, { ok: false, value: "cancel", mode: "text" });
  const input = { isTTY: true, calls: [], setRawMode(value) { this.calls.push(value); } };
  const noColor = await selectChoice("Create", options, {
    input, output: { isTTY: true }, env: { NO_COLOR: "1" }, ask: async () => "1",
  });
  assert.equal(noColor.mode, "text");
  assert.deepEqual(input.calls, []);
});

test("raw mode is restored after selection and cancellation", async () => {
  class Input extends EventEmitter {
    constructor() { super(); this.isTTY = true; this.raw = []; this.paused = false; }
    setRawMode(value) { this.raw.push(value); }
    resume() {}
    pause() { this.paused = true; }
  }
  const input = new Input();
  const writes = [];
  const output = { isTTY: true, write: (text) => writes.push(text) };
  const selected = selectChoice("Mode", [{ label: "Generalist", value: "one" }, { label: "Fleet", value: "two" }], { input, output, env: {} });
  input.emit("data", "\u001b[B"); input.emit("data", "\r");
  assert.deepEqual(await selected, { ok: true, value: "two", index: 1, mode: "keys" });
  assert.deepEqual(input.raw, [true, false]);
  assert.equal(input.paused, true);
  assert.ok(writes.length >= 2);
});
