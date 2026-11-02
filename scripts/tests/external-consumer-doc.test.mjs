/**
 * The document for external consumers lists exactly the declared kinds (TL-525).
 *
 * WHY. `docs/external-consumers.md` is what a person building an interface on
 * top of this tool reads INSTEAD of `scripts/`. A kind declared in
 * `scripts/json-envelope.mjs` and missing from that document is a capability
 * nobody outside will find; a kind in the document that the code no longer
 * declares is a promise nothing keeps. Both directions are checked, and the
 * command each row names must be a command the dispatch table has, so a row
 * cannot point a consumer at a command that was renamed away.
 *
 * The manual's own `--json` table is guarded separately
 * (`json-envelope.test.mjs`, `docs-terminal-surface.test.mjs`); this file
 * guards the second document, which would otherwise drift alone.
 *
 * Every rule below has a positive control fed a deliberately broken document,
 * because a parser that stopped matching would report an empty difference and
 * pass on a zero sample.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KINDS } from "../json-envelope.mjs";
import { COMMANDS } from "../cli.mjs";
import { REPO_ROOT, isolateHome } from "./_repo.mjs";

// Importing the dispatch table loads modules that read the user layer.
isolateHome("external-consumer-doc");

const HEADING = "## The declared kinds";
const DOC = join(REPO_ROOT, "docs", "external-consumers.md");

/**
 * The rows of the declared-kinds table: `{ kind, emittedBy }`. PURE.
 * The section ends at the next `## ` heading; the header and separator rows
 * are skipped by position, so the header cell `` `kind` `` is never read as one.
 */
export function documentedRows(doc) {
  const at = doc.indexOf(HEADING);
  assert.notEqual(at, -1, "the document has no `" + HEADING + "` section");
  const rest = doc.slice(at + HEADING.length);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = [];
  let row = 0;
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    row += 1;
    if (row <= 2) continue;
    const cells = line.split("|").map((c) => c.trim());
    const m = cells[1] && cells[1].match(/^`([a-z][a-z0-9-]*)`$/);
    if (m) rows.push({ kind: m[1], emittedBy: cells[2] || "" });
  }
  return rows;
}

/** Kinds declared and not documented, and documented and not declared. PURE. */
export function kindGaps(rows, kinds = KINDS) {
  const listed = new Set(rows.map((r) => r.kind));
  return {
    undocumented: Object.keys(kinds).filter((k) => !listed.has(k)),
    undeclared: [...listed].filter((k) => !(k in kinds)),
  };
}

/** Rows whose commands (each backticked invocation's first word) do not exist. PURE. */
export function unknownCommands(rows, commands = COMMANDS) {
  const bad = [];
  for (const { kind, emittedBy } of rows) {
    const calls = [...emittedBy.matchAll(/`([^`]+)`/g)].map((m) => m[1].split(/\s+/)[0]);
    if (!calls.length) bad.push(kind + ": names no command");
    for (const name of calls) {
      if (name === "<command>") continue;
      if (!(name in commands)) bad.push(kind + ": `" + name + "` is not a command");
    }
  }
  return bad;
}

const fixture = (rows) => [
  "# Doc", "", HEADING, "",
  "| `kind` | Emitted by | Role |", "|---|---|---|",
  ...rows,
  "", "## Next section", "", "| `stray` | `query` | read |", "",
].join("\n");

test("positive control: the parser reads a known kind and nothing outside its section", () => {
  const rows = documentedRows(fixture(["| `task-list` | `query --json` | read |"]));
  assert.deepEqual(rows.map((r) => r.kind), ["task-list"]);
});

test("positive control: removing a kind from either side is caught", () => {
  const all = Object.keys(KINDS).map((k) => "| `" + k + "` | `query --json` | read |");
  const complete = documentedRows(fixture(all));
  assert.deepEqual(kindGaps(complete), { undocumented: [], undeclared: [] });

  const missingOne = documentedRows(fixture(all.filter((l) => !l.includes("`task-list`"))));
  assert.deepEqual(kindGaps(missingOne).undocumented, ["task-list"]);

  const { ["task-list"]: _dropped, ...fewer } = KINDS;
  assert.deepEqual(kindGaps(complete, fewer).undeclared, ["task-list"]);
});

test("positive control: a row naming a command that does not exist is caught", () => {
  const rows = documentedRows(fixture(["| `task-list` | `sessions --json` | read |"]));
  assert.deepEqual(unknownCommands(rows), ["task-list: `sessions` is not a command"]);
});

test("docs/external-consumers.md lists exactly the declared kinds", () => {
  const rows = documentedRows(readFileSync(DOC, "utf8"));
  assert.ok(rows.length >= 10, "the declared-kinds table yielded only " + rows.length + " rows");
  assert.deepEqual(kindGaps(rows), { undocumented: [], undeclared: [] },
    "docs/external-consumers.md and scripts/json-envelope.mjs disagree");
  const seen = rows.map((r) => r.kind);
  assert.deepEqual(seen.filter((k, i) => seen.indexOf(k) !== i), [], "a kind is listed twice");
});

test("every command the declared-kinds table names exists", () => {
  const rows = documentedRows(readFileSync(DOC, "utf8"));
  assert.deepEqual(unknownCommands(rows), []);
});
