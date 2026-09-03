/**
 * Write to standard output SYNCHRONOUSLY, so `process.exit()` cannot cut it off
 * (TL-175).
 *
 * THE DEFECT THIS CLOSES. Node's stdout is asynchronous when it is a PIPE and
 * synchronous when it is a file or a TTY. Every command here ends
 * `console.log(...)` then `process.exit(0)`, and `process.exit` does not wait
 * for the pipe buffer to drain — so on a pipe everything past roughly one buffer
 * is lost. Measured on 2026-09-03: `query --all-projects --json` produced 108993
 * valid bytes into a file and 65520 truncated ones through a pipe, where the
 * consumer saw `Unterminated string` instead of an answer.
 *
 * WHY THAT IS WORSE THAN AN ORDINARY BUG. `--json` on every reading command is
 * law 4, the surface everything else is meant to be built on. The failure
 * appears only above a size threshold, only in a pipeline — which is the one
 * place a script actually uses it — and never in the terminal where a person
 * tries it out. A tool that is correct when watched and wrong when used is worse
 * than one that fails outright.
 *
 * WHY SYNCHRONOUSLY, AND NOT `process.exitCode` PLUS AN ORDERLY EXIT. That is
 * the other correct fix, and it would mean auditing every `process.exit()` in
 * every command and keeping them audited — a convention nothing enforces, of the
 * kind TL-174 had just finished removing. Writing the bytes before returning
 * makes the callers' existing `process.exit()` correct instead of forbidden: by
 * the time it runs, the data is in the operating system's pipe.
 *
 * EAGAIN IS THE NORMAL CASE, NOT AN ERROR. A full pipe means the reader has not
 * caught up; the write is retried after a short sleep. The sleep is
 * `Atomics.wait`, because a bare spin would burn a core against a slow reader.
 * EPIPE is the opposite and is SILENT: the reader closed early (`| head`), and
 * shouting about it would turn an ordinary shell idiom into an error.
 *
 * Tests: `node --test scripts/tests/json-pipe.test.mjs`
 */

import { writeSync } from "node:fs";

const SLEEP = new Int32Array(new SharedArrayBuffer(4));

/**
 * Everything, or nothing that was not the reader's own doing.
 *
 * @param {string} text  written verbatim; the caller adds any trailing newline
 * @param {number} fd    1 by default; 2 is stderr, which has the same problem
 * @returns {boolean}    false when the reader went away
 */
export function writeOut(text, fd = 1) {
  const buf = Buffer.from(String(text), "utf8");
  let written = 0;
  while (written < buf.length) {
    try {
      written += writeSync(fd, buf, written, buf.length - written);
    } catch (e) {
      if (e.code === "EAGAIN") {
        // One millisecond, then try again. `Atomics.wait` is the only sleep
        // available on the main thread without turning this function async —
        // and async is exactly what cannot be used here, because the caller
        // exits on the next line.
        Atomics.wait(SLEEP, 0, 0, 1);
        continue;
      }
      if (e.code === "EPIPE") return false;
      throw e;
    }
  }
  return true;
}

/** A line, with the newline `console.log` would have added. */
export function printLine(text = "", fd = 1) {
  return writeOut(text + "\n", fd);
}
