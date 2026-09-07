#!/usr/bin/env node
/**
 * Keyboard-first terminal choices, with a deliberately ordinary text fallback.
 *
 * This module does not decide a command's meaning. Callers supply labels and
 * values; it only turns a TTY enhancement into that existing choice. The raw
 * mode guard is intentionally stricter than colour: a user who asked for
 * NO_COLOR or has TERM=dumb gets no control sequences or raw input either.
 */
import { color, plain, terminal } from "./ui.mjs";

export function interactiveAllowed(input, output, env = process.env) {
  return !!(input && input.isTTY && output && output.isTTY
    && env.NO_COLOR === undefined && env.TERM !== "dumb");
}

export function keyFromChunk(chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
  if (text === terminal.keys.up) return "up";
  if (text === terminal.keys.down) return "down";
  if (text === terminal.keys.enter || text === terminal.keys.newline) return "enter";
  if (text === terminal.keys.interrupt || text === terminal.keys.escape) return "cancel";
  return null;
}

export function moveSelection(index, length, key) {
  if (!length) return 0;
  if (key === "up") return (index + length - 1) % length;
  if (key === "down") return (index + 1) % length;
  return index;
}

function choices(options) {
  if (!Array.isArray(options) || !options.length) throw new Error("a terminal choice needs at least one option");
  return options.map((option, index) => {
    if (!option || typeof option.label !== "string") throw new Error("choice " + (index + 1) + " needs a label");
    return { label: option.label, value: Object.prototype.hasOwnProperty.call(option, "value") ? option.value : String(index + 1) };
  });
}

export function renderChoices(options, selected = 0, paint = plain) {
  const list = choices(options);
  return list.map((option, index) => {
    const number = paint.id((index + 1) + ")");
    return index === selected ? "› " + paint.bold(option.label) + "  " + number : "  " + option.label + "  " + paint.dim(number);
  });
}

export function renderPrompt(question, options, selected = 0, paint = plain) {
  return [paint.bold(String(question)), ""]
    .concat(renderChoices(options, selected, paint), "", paint.dim("↑/↓ move  ·  Enter select  ·  Esc cancel"));
}

export function numberedPrompt(question, options) {
  return String(question || "Choice") + " [1-" + choices(options).length + "]: ";
}

function fallbackIndex(value, length) {
  const number = Number(String(value || "").trim());
  return Number.isInteger(number) && number >= 1 && number <= length ? number - 1 : -1;
}

/**
 * Resolve to a selected value. `ask` is intentionally injected: pipes and
 * automation retain their existing line-input contract without this module
 * ever opening raw mode.
 */
export async function selectChoice(question, options, settings = {}) {
  const list = choices(options);
  const input = settings.input || process.stdin;
  const output = settings.output || process.stdout;
  const env = settings.env || process.env;
  const initial = Math.max(0, Math.min(list.length - 1, Number(settings.initial) || 0));
  if (!interactiveAllowed(input, output, env)) {
    if (typeof settings.ask !== "function") throw new Error("line-input fallback needs an ask function");
    const answer = await settings.ask(numberedPrompt(question, list));
    const index = fallbackIndex(answer, list.length);
    return index < 0 ? { ok: false, value: answer, mode: "text" } : { ok: true, value: list[index].value, index, mode: "text" };
  }

  return new Promise((resolve) => {
    let selected = initial;
    let rows = 0;
    const draw = () => {
      const lines = renderPrompt(question, list, selected, color);
      output.write(terminal.replaceLines(lines, rows));
      rows = lines.length;
    };
    const restore = () => {
      input.off("data", onData);
      if (typeof input.setRawMode === "function") input.setRawMode(false);
      input.pause();
    };
    const finish = (result) => { restore(); resolve(result); };
    const onData = (chunk) => {
      const key = keyFromChunk(chunk);
      if (key === "enter") return finish({ ok: true, value: list[selected].value, index: selected, mode: "keys" });
      if (key === "cancel") return finish({ ok: false, value: null, index: selected, mode: "keys" });
      if (key === "up" || key === "down") { selected = moveSelection(selected, list.length, key); draw(); }
    };
    try {
      input.setRawMode(true);
      input.resume();
      input.on("data", onData);
      draw();
    } catch (error) {
      restore();
      resolve({ ok: false, value: null, mode: "unavailable", error });
    }
  });
}
