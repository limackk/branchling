/**
 * ONE SHAPE for refusing an argument (TL-220).
 *
 * WHAT WAS BROKEN. `AGENTS.md` opens with "an unknown command and an unknown
 * flag FAIL — a silent no-op looks like it worked". Forty commands obeyed the
 * exit code and disagreed about everything else: `available:` in eleven,
 * `known flags:` in sixteen, `known:` in three, a bare `usage:` line in five —
 * and `regen-hook`, the one command a person never types because an editor
 * fires it after every save, accepted anything and exited 0.
 *
 * WHY THE WORDING IS A CONTRACT AND NOT A PREFERENCE. The refusal is the only
 * place a command states the set it accepts; `help-covers-flags.test.mjs` reads
 * that set back out of it to compare with what `--help` declares. Four wordings
 * meant three quarters of the table could not be asked the question at all, so
 * a flag added there was documented or not with nothing able to tell.
 *
 * WHAT IS ASSERTED — the anatomy from the output-style reference, no more:
 *
 *   ✗ <product> <command>: unknown flag: --zzz
 *     available: --a --b --dir <path>
 *     → <product> <command> --help
 *
 * The SENTENCE still names which mistake was made — `unknown flag:` for
 * something starting with `-`, `unknown subcommand:` where a subcommand was
 * expected, `unexpected argument:` where nothing was. Those are three different
 * events and collapsing them would cost the reader the word that says which one
 * they made. Everything around the sentence is fixed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../cli.mjs";
import { PRODUCT_NAME } from "../product.mjs";

import { isolateHome, plainOutput } from "./_repo.mjs";

isolateHome("refusal-shape");
// Assert against plain text, not against the observer's terminal (TL-238).
plainOutput();

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");
const NAMES = Object.keys(COMMANDS);
const NONSENSE = "--zzz-not-a-flag";

/**
 * What is wrong with one refusal, or `null` when it has the shape.
 *
 * PURE and exported to the positive control below: a checker only ever run
 * against output that already passes proves nothing about what it would catch.
 */
export function shapeProblem(command, text) {
  const lines = String(text || "").trimEnd().split("\n");
  const head = new RegExp(
    "^✗ " + PRODUCT_NAME + " " + command.replace(/[-]/g, "\\-") +
    ": (unknown flag|unknown subcommand|unexpected argument): "
  );
  if (!head.test(lines[0] || "")) {
    return "the first line is not `✗ " + PRODUCT_NAME + " " + command +
      ": <which mistake>: <the argument>`: " + JSON.stringify(lines[0] || "");
  }
  const available = lines.find((l) => l.startsWith("  available: "));
  if (!available) return "no `  available:` line naming what it does accept";
  if (!available.slice("  available: ".length).trim()) return "`available:` names nothing";
  const last = lines[lines.length - 1];
  if (last !== "  → " + PRODUCT_NAME + " " + command + " --help") {
    return "the last line is not the `--help` to paste: " + JSON.stringify(last);
  }
  return null;
}

function refusalOf(name) {
  const r = spawnSync(process.execPath, [CLI, name, NONSENSE], {
    encoding: "utf8", timeout: 20_000, input: "",
  });
  return { status: r.status, text: (r.stdout || "") + (r.stderr || "") };
}

// ── Positive controls, first ──────────────────────────────────────────────

test("positive control: the checker CATCHES each way of losing the shape", () => {
  const good = [
    "✗ " + PRODUCT_NAME + " query: unknown flag: --zzz",
    "  available: --status --board",
    "  → " + PRODUCT_NAME + " query --help",
  ].join("\n");
  assert.equal(shapeProblem("query", good), null, "the shape itself was rejected");

  assert.ok(shapeProblem("query", good.replace("✗ ", "")), "a missing failure mark passed");
  assert.ok(shapeProblem("query", good.replace("available:", "known flags:")),
    "`known flags:` passed — the wording is what a machine reads the set out of");
  assert.ok(shapeProblem("query", good.replace("  available: --status --board\n", "")),
    "a refusal naming no alternatives passed");
  assert.ok(shapeProblem("query", good.split("\n").slice(0, 2).join("\n")),
    "a refusal with nothing to paste next passed");
  assert.ok(shapeProblem("query", good.replace(PRODUCT_NAME + " query:", "query:")),
    "a refusal that does not name the command as typed passed");
});

test("positive control: there are commands to judge, and the table is whole", () => {
  // Every case below iterates the table. If COMMANDS were empty, or the spawn
  // broke, the file would pass having asserted nothing.
  assert.ok(NAMES.length >= 20, "expecting a table of commands, got " + NAMES.length);
  for (const name of ["query", "take", "new", "mcp", "regen-hook"]) {
    assert.ok(NAMES.includes(name), "the table no longer has `" + name + "`");
  }
});

// ── The rule ──────────────────────────────────────────────────────────────

test("every command refuses an unknown argument with exit 2", () => {
  const offenders = [];
  for (const name of NAMES) {
    const { status } = refusalOf(name);
    if (status !== 2) offenders.push(name + ": exit " + status);
  }
  assert.deepEqual(offenders, [], "an argument nobody declared was not a usage error:\n  " +
    offenders.join("\n  "));
});

test("every command refuses in ONE shape", () => {
  const offenders = [];
  for (const name of NAMES) {
    const problem = shapeProblem(name, refusalOf(name).text);
    if (problem) offenders.push(name + ": " + problem);
  }
  assert.deepEqual(offenders, [], "refusals that do not have the one shape:\n  " +
    offenders.join("\n  "));
});

test("`regen-hook` refuses BEFORE it waits for the payload, and writes nothing", () => {
  // The command an editor fires after every save. It used to exit 0 on anything,
  // so a typo in an installed hook's arguments looked exactly like a hook that
  // ran — and it read stdin first, so the refusal could not even be prompt.
  const started = Date.now();
  const r = spawnSync(process.execPath, [CLI, "regen-hook", NONSENSE], {
    encoding: "utf8", timeout: 20_000, // stdin is left OPEN on purpose: inherited
    stdio: ["pipe", "pipe", "pipe"],   // from a parent that never closes it.
  });
  assert.equal(r.status, 2, "regen-hook accepted an argument it does not have");
  assert.equal(r.stdout, "", "it wrote to stdout while refusing");
  assert.equal(shapeProblem("regen-hook", r.stderr), null, r.stderr);
  assert.ok(Date.now() - started < 10_000, "it waited for stdin before refusing");
});
