/**
 * A command that exits abruptly may not leave output in Node's asynchronous
 * stream queue (TL-440).
 *
 * On macOS a pipe is asynchronous. `process.stdout.write`,
 * `process.stderr.write` and `console.log` can therefore return before their
 * bytes reach the reader, while `process.exit()` discards that queue. The
 * failure first appeared as a severed MCP JSON line and only on macOS CI.
 *
 * THE RULE IS FILE-LEVEL ON PURPOSE. Proving that a write and an exit cannot
 * meet on one path would require a JavaScript control-flow analyser. Keeping
 * either primitive out of the file is smaller and self-enforcing: commands
 * normally set `process.exitCode`, while a command that truly must stop uses
 * the synchronous writer from `stdout.mjs`.
 *
 * A deliberate asynchronous write may carry `stdout: allow` on its own line.
 * When the write belongs to a block whose first line cannot carry a comment,
 * a marker immediately above that indented block covers the block and nothing
 * after its dedent.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { REPO_ROOT, isolateHome } from "./_repo.mjs";

isolateHome("exit-safe-output");

export const ALLOW_MARKER = "stdout: allow";
const EXIT = /\bprocess\.exit\s*\(/;
const ASYNC_WRITE = /\b(?:process\.(?:stdout|stderr)\.write|console\.log)\s*\(/;

function indentation(line) {
  return line.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length;
}

function isCommentOnly(line) {
  const text = line.trim();
  return !text || text.startsWith("//") || text.startsWith("/*") ||
    text.startsWith("*") || text.startsWith("#!/");
}

/** PURE — unsafe write calls in one already-read source file. */
export function unsafeWrites(text) {
  const lines = String(text || "").split(/\r?\n/);
  const exits = lines.some((line) => !isCommentOnly(line) && EXIT.test(line));
  if (!exits) return [];

  const findings = [];
  let allowedIndent = null;
  let markerAwaitingBlock = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = indentation(line);

    if (markerAwaitingBlock !== null && trimmed) {
      allowedIndent = indent > markerAwaitingBlock ? markerAwaitingBlock : null;
      markerAwaitingBlock = null;
    }
    if (allowedIndent !== null && trimmed && indent <= allowedIndent) allowedIndent = null;

    const markerOnly = isCommentOnly(line) && line.includes(ALLOW_MARKER);
    if (markerOnly) {
      markerAwaitingBlock = indent;
      continue;
    }
    if (isCommentOnly(line) || line.includes(ALLOW_MARKER) || allowedIndent !== null) continue;
    if (ASYNC_WRITE.test(line)) findings.push({ line: i + 1, text: trimmed });
  }
  return findings;
}

/** Scan the executable source surface, not tests or generated artifacts. */
export function auditTree(root = REPO_ROOT) {
  const findings = [];
  let filesChecked = 0;
  for (const dir of ["scripts", "bin"]) {
    const abs = join(root, dir);
    for (const name of readdirSync(abs).filter((entry) => entry.endsWith(".mjs")).sort()) {
      const file = join(abs, name);
      filesChecked++;
      for (const hit of unsafeWrites(readFileSync(file, "utf8"))) {
        findings.push({ file: relative(root, file).split("\\").join("/"), ...hit });
      }
    }
  }
  return { findings, filesChecked };
}

test("a command cannot combine an asynchronous write with process.exit", () => {
  const result = auditTree();
  assert.ok(result.filesChecked > 20,
    "only " + result.filesChecked + " executable source files found — the scan is looking in the wrong place");
  assert.deepEqual(result.findings, [], result.findings.map((f) =>
    f.file + ":" + f.line + "  " + f.text
  ).join("\n"));
});

test("POSITIVE CONTROL: a pipe-sized write followed by exit fails the guard", () => {
  const root = mkdtempSync(join(tmpdir(), "branchling-exit-safe-output-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "scripts", "unsafe.mjs"), [
      "const payload = \"x\".repeat(64 * 1024);",
      "process.stdout.write(payload);",
      "process.exit(0);",
      "",
    ].join("\n"));
    const result = auditTree(root);
    assert.deepEqual(result.findings.map((f) => [f.file, f.line]), [["scripts/unsafe.mjs", 2]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the exception is confined to its line or one indented block", () => {
  const source = [
    "process.exit(0);",
    "console.log(\"caught\");",
    "console.log(\"line exception\"); // stdout: allow",
    "// stdout: allow",
    "  if (enabled) {",
    "    process.stderr.write(\"block exception\");",
    "  }",
    "console.log(\"caught after dedent\");",
  ].join("\n");
  assert.deepEqual(unsafeWrites(source).map((hit) => hit.line), [2, 8]);
});
