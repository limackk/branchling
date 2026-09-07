import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { interactiveAllowed, keyFromChunk, moveSelection, numberedPrompt, renderChoices, selectChoice } from "../terminal-ui.mjs";

test("keyboard parsing and selection wrap without terminal state", () => {
  assert.equal(keyFromChunk("\u001b[A"), "up");
  assert.equal(keyFromChunk("\u001b[B"), "down");
  assert.equal(keyFromChunk("\r"), "enter");
  assert.equal(keyFromChunk("\u001b"), "cancel");
  assert.equal(moveSelection(0, 3, "up"), 2);
  assert.equal(moveSelection(2, 3, "down"), 0);
  assert.deepEqual(renderChoices([{ label: "Generalist" }, { label: "Fleet" }], 1), ["  1) Generalist", "› 2) Fleet"]);
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
