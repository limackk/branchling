/**
 * A command line written in a document is one the tool would accept (TL-342).
 *
 * WHAT WAS BROKEN. The terminal surface moved under the documents several
 * times in one week — the whole command table got one refusal anatomy, the
 * telemetry commands were deleted, flags were declared, corrected and added —
 * and nothing compared what `docs/` and `README.md` tell a reader to type
 * against what the tool does. The three defects this file was opened on were
 * all of that shape and all invisible to `check`: `docs/manual.md` listed
 * `time`, `sessions` and `session` in the `--json` contract table for commands
 * that no longer exist, `docs/backlog-field-editing-history.md` told the reader
 * that `branchling session <id>` joins two logs, and `README.md` printed
 * `seed --from spec.md` while `seed` answered an unknown flag with an
 * `available:` list that did not contain `--from`.
 *
 * A copied list would be a fourth place to be wrong, so NOTHING HERE IS
 * HAND-WRITTEN. The true surface is derived from the code in three ways:
 *
 *   - which commands exist: `COMMANDS` in `cli.mjs`, the dispatch table itself;
 *   - what a command accepts: its OWN refusal. Since TL-220 every command
 *     answers an unknown flag in one anatomy — `refusal()` in `ui.mjs` prints
 *     `available: …` — so the process can simply be asked, subcommand by
 *     subcommand. `help-covers-flags.test.mjs` asks the same question of the
 *     `--help` text; this file asks it of the documents;
 *   - which `--json` kinds can be emitted: `KINDS` in `json-envelope.mjs`.
 *
 * THE DIRECTION THIS ADDS. `json-envelope.test.mjs` already walks `KINDS` and
 * requires the manual to document each one. That loop cannot see a row for a
 * kind nothing emits, which is exactly what three deleted commands left behind,
 * so the opposite direction is checked here.
 *
 * A DOCUMENTATION GUARD MUST NOT PASS ON A ZERO SAMPLE (`AGENTS.md`). Two ways
 * this file could go green while proving nothing: the scanner stops matching —
 * so the reach control below fails unless the real documents yield a
 * substantial number of invocations across several files — and a command drops
 * out of the comparison by not naming its accepted set, which is a failure
 * here rather than a skip. Every rule also has a positive control that feeds it
 * a document stating something the code does not do.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "../cli.mjs";
import { KINDS } from "../json-envelope.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166), as everywhere a test spawns
// the CLI: without it the child reads the developer's own preferences.
isolateHome("docs-terminal-surface");

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "cli.mjs");
const REPO_ROOT = join(HERE, "..", "..");
const NAMES = new Set(Object.keys(COMMANDS));

/** The documents that teach the terminal: the front page and the reference. */
function documents() {
  const docs = readdirSync(join(REPO_ROOT, "docs"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join("docs", f));
  return ["README.md", ...docs];
}

/**
 * Documented once in the main help as working on every command, so a command
 * whose own `available:` list omits them is not contradicting a document that
 * writes them. `help-covers-flags.test.mjs` holds that sentence in the main
 * help, which is what makes the exemption legitimate rather than assumed.
 */
const GLOBAL_FLAGS = new Set(["--dir", "--help", "-h"]);

// ── Reading the documents ─────────────────────────────────────────────────

/**
 * The code spans of a Markdown document: fenced blocks and inline `…` spans,
 * each with its line number. PURE.
 *
 * ONLY CODE, because the product name is also an ordinary noun — "branchling
 * does not copy adapters" would otherwise be read as a command called `does`.
 * A command line a reader is meant to type is always in code; prose about the
 * tool is not an invocation and is not this guard's business.
 */
export function codeSpans(text) {
  const spans = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) { spans.push({ line: i + 1, code: line }); return; }
    for (const m of line.matchAll(/`([^`]+)`/g)) spans.push({ line: i + 1, code: m[1] });
  });
  return spans;
}

const INVOCATION = new RegExp(
  "(?:" + PRODUCT_NAME + "|scripts/cli\\.mjs)\\s+([a-z][a-z0-9-]*)" +
  "((?:\\s+(?:--[a-z0-9-]+|[a-z][a-z0-9-]*|\"[^\"]*\"|'[^']*'|<[^>]*>|[^\\s|#]+))*)",
  "g"
);

/**
 * Every invocation written in a document: the command, the word that follows it
 * and the flags. PURE, so the positive controls below run it over a string
 * rather than over the tree.
 *
 * `<path>`, `<ID>` and the like are value placeholders; the lookbehind keeps
 * the flag scan out of them, the same way `help-covers-flags.test.mjs` keeps
 * out of `<boards.yaml>`.
 */
export function invocations(text) {
  const found = [];
  for (const { line, code } of codeSpans(text)) {
    for (const m of code.matchAll(INVOCATION)) {
      const rest = m[2] || "";
      const flags = [...rest.matchAll(/(?<![\w<-])--[a-z0-9][a-z0-9-]*/g)].map((f) => f[0]);
      found.push({
        line, code: code.trim(), command: m[1],
        word: (rest.trim().split(/\s+/)[0] || "").replace(/^["']/, ""),
        flags,
      });
    }
  }
  return found;
}

// ── Asking the tool what it accepts ───────────────────────────────────────

const asked = new Map();

/**
 * What a command — or a command and one subcommand — accepts, taken from its
 * own refusal, and the subcommands it names. `null` when it answers with no
 * `available:` list at all, which the reach control turns into a failure.
 */
function surface(argv) {
  const key = argv.join(" ");
  if (asked.has(key)) return asked.get(key);
  const r = spawnSync(process.execPath, [CLI, ...argv, "--zzz-not-a-flag"], {
    encoding: "utf8", timeout: 20_000, input: "", env: { ...process.env, NO_COLOR: "1" },
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = [...out.matchAll(/available:([^\n]*)/g)];
  // A refusal naming the event but no alternatives is an EMPTY accepted set,
  // not an unreachable command: `skills install` takes no flags at all, so
  // there is nothing for `available:` to introduce. The event word is what
  // proves the invocation was parsed and refused rather than misunderstood —
  // the three TL-220 named, and nothing else counts.
  const refused = /(unknown flag|unknown subcommand|unexpected argument):/.test(out);
  let value = lines.length || refused ? { flags: new Set(), subcommands: new Set() } : null;
  for (const m of lines) {
    for (const f of m[1].matchAll(/(?<![\w<-])--[a-z0-9][a-z0-9-]*/g)) value.flags.add(f[0]);
    for (const s of m[1].matchAll(/(?<![\w<>-])[a-z][a-z0-9-]*(?=,|\s|$)/g)) value.subcommands.add(s[0]);
  }
  asked.set(key, value);
  return value;
}

/**
 * What a document gets wrong about the terminal, as a list of sentences. PURE
 * with respect to the text: it is handed the document's contents, so the
 * positive controls run it over a fixture and the rule runs it over the tree.
 */
function offences(name, text) {
  const problems = [];
  for (const use of invocations(text)) {
    const where = name + ":" + use.line;
    if (!NAMES.has(use.command)) {
      problems.push(where + ": no such command `" + use.command + "` — " + use.code);
      continue;
    }
    // A `--help` line asks the command to describe ITSELF; `--help --json` is
    // that description for a program (TL-83). Neither is a claim about the
    // command's own flags, so only the command name is judged.
    if (use.flags.some((f) => f === "--help" || f === "-h")) continue;

    let reach = surface([use.command]);
    let spelling = use.command;
    if (reach && use.word && reach.subcommands.has(use.word)) {
      reach = surface([use.command, use.word]);
      spelling = use.command + " " + use.word;
    }
    if (!reach) {
      problems.push(where + ": `" + spelling + "` names no accepted set, so nothing here can be checked");
      continue;
    }
    for (const flag of use.flags) {
      if (GLOBAL_FLAGS.has(flag)) continue;
      if (!reach.flags.has(flag)) {
        problems.push(where + ": `" + spelling + "` does not accept " + flag + " — " + use.code);
      }
    }
  }
  return problems;
}

// ── Positive controls, first ──────────────────────────────────────────────

test("positive control: a document naming a command that does not exist IS caught", () => {
  const found = offences("fixture.md", "Run `" + PRODUCT_NAME + " frobnicate --dir backlog` first.\n");
  assert.equal(found.length, 1, "a nonexistent command passed: " + JSON.stringify(found));
  assert.match(found[0], /no such command `frobnicate`/);
});

test("positive control: a document naming a flag the command refuses IS caught", () => {
  const found = offences("fixture.md", "```bash\n" + PRODUCT_NAME + " query --zzz-not-a-flag\n```\n");
  assert.equal(found.length, 1, "a refused flag passed: " + JSON.stringify(found));
  assert.match(found[0], /`query` does not accept --zzz-not-a-flag/);
});

test("positive control: a subcommand is asked, and one taking NO flags is not skipped", () => {
  // Two things at once, because they fail in opposite directions. `profile
  // create --adapter` must pass: the flags live one level down, and a guard
  // asking only the top level would report every documented `profile create`
  // line as wrong and be switched off within a day. `skills install` must
  // still catch a flag: it accepts none, so its refusal names no alternatives,
  // and reading that as "nothing to compare" would let any flag through on
  // exactly the commands with the smallest surface.
  assert.deepEqual(offences("fixture.md", "`" + PRODUCT_NAME + ' profile create dev --adapter "./a.mjs"`\n'), []);
  assert.deepEqual(offences("fixture.md", "`" + PRODUCT_NAME + " skills install`\n"), []);
  const found = offences("fixture.md", "`" + PRODUCT_NAME + " skills install --force`\n");
  assert.equal(found.length, 1, "a flag on a command that accepts none passed: " + JSON.stringify(found));
  assert.match(found[0], /`skills install` does not accept --force/);
});

test("positive control: prose about the product is not read as an invocation", () => {
  // The product name is an ordinary noun in half the sentences of README.md.
  // If this stopped holding, the rule below would drown in `does`, `owns` and
  // `supplies`, and the only way out would be to delete it.
  assert.deepEqual(invocations(PRODUCT_NAME + " does not copy provider adapters.\n"), []);
});

test("reach control: the real documents yield invocations to check", () => {
  // Every other case here passes vacuously if the scanner stops matching — a
  // changed fence, a renamed directory, a regex that lost the product name.
  const counted = documents().map((d) => ({
    doc: d, n: invocations(readFileSync(join(REPO_ROOT, d), "utf8")).length,
  }));
  const total = counted.reduce((a, c) => a + c.n, 0);
  const speaking = counted.filter((c) => c.n > 0);
  assert.ok(total >= 50, "only " + total + " invocation(s) found in the documents — the scanner is not reading them");
  assert.ok(speaking.length >= 3, "only " + speaking.length + " document(s) contain any invocation at all");
  assert.ok(counted.some((c) => c.doc === "README.md" && c.n > 0), "README.md yielded nothing");
});

// ── The rule ──────────────────────────────────────────────────────────────

test("every command line in the documents is one the tool would accept", () => {
  const problems = [];
  for (const doc of documents()) problems.push(...offences(doc, readFileSync(join(REPO_ROOT, doc), "utf8")));
  assert.deepEqual(problems, [],
    "documented invocations the tool refuses:\n  " + problems.join("\n  "));
});

// ── The manual's `--json` table, in the direction nothing else checks ─────

/**
 * A kind the manual documents that the code cannot yet emit, with the task that
 * will settle it. The alternative was to fix `import` here, and a command that
 * throws a stack trace instead of answering is a defect with its own
 * verification, not a documentation drift — inflating this task would have left
 * both unverifiable. The case at the bottom fails on an entry that outlives its
 * defect, so the exemption cannot quietly become permanent.
 */
const UNSETTLED_KINDS = {
  // `import --from github --dry-run --json` throws `unknown JSON kind: import`.
  import: "TL-425",
};

/**
 * The `kind` column of the manual's `--json` contract table. PURE.
 *
 * The header row's own cell reads `` `kind` ``, which is a column name and not
 * a kind; skipping the two rows a Markdown table opens with keeps it out.
 */
export function documentedKinds(manual) {
  const at = manual.indexOf("## The `--json` contract");
  assert.notEqual(at, -1, "the manual has no `--json` contract section");
  const kinds = new Set();
  let row = 0;
  for (const line of manual.slice(at).split("\n")) {
    if (!line.startsWith("|")) continue;
    row += 1;
    if (row <= 2) continue;
    const cells = line.split("|").map((c) => c.trim());
    const m = cells[2] && cells[2].match(/^`([a-z][a-z0-9-]*)`$/);
    if (m) kinds.add(m[1]);
  }
  return kinds;
}

test("positive control: a row for a kind nothing emits IS caught", () => {
  const fixture = [
    "## The `--json` contract", "",
    "| Command | `kind` | Payload |", "|---|---|---|",
    "| `query` | `task-list` | `tasks` |",
    "| `sessions` | `sessions` | `correlation` |", "",
  ].join("\n");
  const listed = documentedKinds(fixture);
  assert.ok(listed.has("task-list"), "the parser did not read a real row");
  assert.equal(listed.has("kind"), false, "the table's header row was read as a kind");
  assert.deepEqual([...listed].filter((k) => !(k in KINDS)), ["sessions"]);
});

test("the manual documents no `--json` kind the code cannot emit", () => {
  // `json-envelope.test.mjs` walks KINDS and demands a row for each. That loop
  // is blind to a row with no kind behind it, which is what the deleted
  // telemetry commands left in the table for two weeks.
  const manual = readFileSync(join(REPO_ROOT, "docs", "manual.md"), "utf8");
  const ghosts = [...documentedKinds(manual)]
    .filter((k) => !(k in KINDS) && !(k in UNSETTLED_KINDS));
  assert.deepEqual(ghosts, [],
    "the manual promises kinds nothing emits: " + ghosts.join(" "));
});

test("an exemption does not outlive the defect it records", () => {
  // An entry left behind after the kind is declared would hide the next
  // regression on that same kind, and would misstate the tool's condition to
  // anybody reading this file for what is still broken.
  const settled = Object.keys(UNSETTLED_KINDS).filter((k) => k in KINDS);
  assert.deepEqual(settled, [],
    "declared now — remove from UNSETTLED_KINDS: " + settled.join(" "));

  // Positive control on the same rule, because the map is expected to empty
  // out: over an empty map the assertion above proves nothing.
  const lying = Object.keys({ "task-list": "TL-0" }).filter((k) => k in KINDS);
  assert.deepEqual(lying, ["task-list"], "an exemption for a declared kind was not caught");

  // And the defect it names is real, so the entry can be trusted as a report.
  for (const kind of Object.keys(UNSETTLED_KINDS)) {
    assert.ok(documentedKinds(readFileSync(join(REPO_ROOT, "docs", "manual.md"), "utf8")).has(kind),
      "exempting `" + kind + "`, which the manual does not document at all");
  }
});
