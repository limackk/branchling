/**
 * Reading standard input WITHOUT the risk of waiting for something that is
 * never coming (TL-237).
 *
 * WHY THIS IS A MODULE AND NOT A LINE IN EACH COMMAND. `regen-hook` learned
 * the lesson first (TL-224): reading stdin to EOF is correct for the one caller
 * it was written against — a writer that sends its payload and closes — and a
 * trap for every other one. A terminal never sends EOF, and neither does a
 * parent that leaves stdin inherited, so the command waited with no output and
 * no prompt, which is indistinguishable from slow work. `new` now reads stdin
 * too, and a second private copy of that reasoning is a second place for it to
 * be forgotten.
 *
 * WHATEVER HAS ARRIVED WHEN THE CLOCK RUNS OUT IS RETURNED, not thrown away: a
 * writer that sends its document and then keeps the pipe open has told us
 * everything we needed, and punishing it for not closing would be the same
 * mistake in the other direction.
 *
 * Tests: `node --test scripts/tests/cli.test.mjs scripts/tests/new-body-input.test.mjs`
 */

/**
 * How long a payload has to arrive before the reader concludes that none is
 * coming.
 *
 * Generous by two orders of magnitude for a real caller — a program that pipes
 * a document has it in hand before it spawns anything — and short enough that a
 * person who ran the command to see what it does gets their prompt back. There
 * is no knob: this is not a preference anybody holds, it is the difference
 * between waiting and hanging.
 */
export const STDIN_WAIT_MS = 2000;

/**
 * The text on standard input, or `null` when there is nobody to read from.
 *
 * `null` is a TERMINAL — a person, with no document to send. An empty string is
 * a writer that closed without sending one, which is a different answer and the
 * callers treat it differently.
 *
 * @returns {Promise<string|null>}
 */
export function readStdinText({ waitMs = STDIN_WAIT_MS } = {}) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve(null);
      return;
    }

    let data = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(data), waitMs);
    // `unref` so a caller that already has its answer does not hold the process
    // open for the rest of the window.
    if (typeof timer.unref === "function") timer.unref();

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => finish(data));
    process.stdin.on("error", () => finish(null));
  });
}
