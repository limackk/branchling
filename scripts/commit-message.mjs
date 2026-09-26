#!/usr/bin/env node
/**
 * Reject a commit message that spells a paragraph break instead of containing
 * one (TL-445).
 *
 * A shell does not turn `\\n` inside a quoted `git commit -m` argument into a
 * newline. The result is a history body that looks formatted in the command
 * that made it, but stores two literal escape sequences. `commit-msg` is the
 * first Git hook that receives the finished message file, so it can judge the
 * bytes Git is about to record without guessing how an agent constructed them.
 *
 * This is deliberately a narrow guard. A body may discuss an escaped newline
 * in prose or code; the defect is the pair that was meant to separate
 * paragraphs. Real blank lines remain ordinary commit-message syntax.
 *
 * Usage:
 *   commit-message <message-file>
 *
 * Exit: 0 accepted · 1 rejected or unreadable · 2 usage error.
 */

import { readFileSync } from "node:fs";

import { PRODUCT_NAME as N } from "./product.mjs";
import { failure, refusal } from "./ui.mjs";

const LITERAL_PARAGRAPH_BREAK = "\\n\\n";

/** The positions of literal escape pairs in a message. PURE for hook tests. */
export function literalParagraphBreaks(message) {
  const positions = [];
  let from = 0;
  while (from < String(message).length) {
    const index = String(message).indexOf(LITERAL_PARAGRAPH_BREAK, from);
    if (index < 0) break;
    positions.push(index);
    from = index + LITERAL_PARAGRAPH_BREAK.length;
  }
  return positions;
}

export function main(argv) {
  const args = argv || [];
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`${N} commit-message <message-file>\n\n  Reject literal \\n\\n paragraph separators before Git records the message.`);
    return 0;
  }
  if (args.length !== 1 || args[0].startsWith("-")) {
    const offender = args[0] || "no message file";
    console.error(refusal(N + " commit-message",
      offender.startsWith("-") ? "unknown flag: " + offender : "expected one message file",
      "<message-file>"));
    return 2;
  }

  const path = args[0];
  let message;
  try {
    message = readFileSync(path, "utf8");
  } catch (error) {
    console.error(failure(N + " commit-message", "could not read the commit message", [path, String(error.message || error)]));
    return 1;
  }

  const positions = literalParagraphBreaks(message);
  if (positions.length) {
    console.error(failure(N + " commit-message",
      "the commit body contains literal \\n\\n paragraph separators", [
        path,
        positions.length + " literal separator" + (positions.length === 1 ? "" : "s") + " found",
        "Use real blank lines in the message body; do not pass escaped paragraph breaks to the shell.",
      ], ["git commit -m \"title\" -m \"first paragraph\" -m \"second paragraph\""]));
    return 1;
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("commit-message.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
