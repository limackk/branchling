/**
 * A contract names a command a person can actually run (TL-233).
 *
 * THE DEFECT, MEASURED. A `verification:` entry is the one place in a task that
 * is an INSTRUCTION rather than a description: `bash:` is executed by the tool,
 * `manual:` is executed by a person. Eleven `manual:` entries in this backlog
 * named a binary this product has not been called since 2026-09-03, four of
 * them in tasks still open — including TL-122, waiting for a vouch, whose
 * contract asked a person to run a command that answers `command not found`.
 * The only way through was to guess the translation.
 *
 * WHY THIS IS NOT THE PROSE RULE. CLAUDE.md keeps the backlog deliberately
 * outside `check --product-name`: a task's narrative saying what the tool was
 * called at the time is history, and rewriting history is a falsification. An
 * instruction is a different kind of sentence — its correctness is a question
 * about TODAY, and it is the same question a `bash:` line answers.
 *
 * WHY ONLY OPEN TASKS. A closed task's contract records what was actually run,
 * against the tool as it was then named. Rewriting it would put a command in
 * the record that nobody executed — the same reasoning `renumber: allow` rests
 * on, and the reason the audit below stops at the archived statuses.
 *
 * HOW THE NAME IS DERIVED. From `product.mjs`, which reads `package.json`, and
 * the subcommands from the CLI's own table. A guard holding a literal of either
 * would be the defect it checks for.
 *
 * THE SIGNAL IS `<word> <subcommand>` IN COMMAND POSITION, not the word alone.
 * A `manual:` entry is prose with commands embedded in it, so "the tool is
 * asked to build" must not read as an invocation; only the first token of a
 * backticked span, or of a shell segment, counts — and only when the token
 * after it is one of this tool's own subcommands. That leaves a bare mention
 * with no subcommand (`run <name> — everything rebuilds`) uncaught, which is
 * accepted: a name with no verb after it cannot be told from prose without
 * knowing every word the product has ever been called.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COMMANDS } from "../cli.mjs";
import { loadConfig } from "../config.mjs";
import { parseVerification } from "../criteria.mjs";
import { PRODUCT_NAME } from "../product.mjs";
import { readTaskRecords } from "../task-select.mjs";
import { BACKLOG_DIR, TASKS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("contract-product-name");

/** This tool's own verbs, from the command table — never a list of literals. */
export const subcommands = () => new Set(Object.keys(COMMANDS));

/**
 * Programs that own a subcommand vocabulary overlapping this one.
 *
 * WHY A LIST AT ALL. `git init`, `npm run build` and `gh run` put one of this
 * tool's verbs after a name that is not this tool — and they are correct. The
 * alternative was to ask the machine whether the word resolves on `PATH`, which
 * makes the verdict depend on what happens to be installed: a machine without
 * `git` would then fail the suite for a task file nobody touched.
 *
 * It is short because it only has to cover the overlap, not every program a
 * contract may call. A name added here is a claim that the word is somebody
 * else's binary, which is a sentence, not a hole in the pattern.
 */
export const FOREIGN_PROGRAMS = new Set([
  "git", "npm", "npx", "pnpm", "yarn", "cargo", "docker", "gh", "go", "pip", "brew", "make",
]);

/** A word that could be a command name on a `PATH`: no slash, no extension. */
const BARE_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** A subcommand as it is written — unquoted, so `echo 'query …'` is a string. */
const BARE_WORD = /^[a-z][a-z0-9-]*$/;

/** The pieces of one entry that are shell, not prose. PURE. */
function commandSegments(entry) {
  const spans = [];
  if (entry.bash) spans.push(String(entry.bash));
  // In prose only a backticked span is a command; everything else is a sentence.
  if (entry.manual) {
    const re = /`([^`]+)`/g;
    let m;
    while ((m = re.exec(String(entry.manual)))) spans.push(m[1]);
  }
  const out = [];
  for (const span of spans) out.push(...span.split(/\n|;|&&|\|\||\|/));
  return out;
}

/**
 * Every `<name> <subcommand>` invocation in one entry. PURE.
 *
 * @returns {Array<{name: string, sub: string}>}
 */
export function invocations(entry, verbs = subcommands()) {
  const found = [];
  for (const segment of commandSegments(entry)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    // A leading `!`, a `(` and `FOO=bar` prefixes are shell, not the command.
    while (tokens.length && /^(!|\(|[A-Za-z_][A-Za-z0-9_]*=)/.test(tokens[0])) tokens.shift();
    if (tokens.length < 2) continue;
    const name = tokens[0].split("/").pop();
    const sub = tokens[1];
    if (!BARE_NAME.test(name) || !BARE_WORD.test(sub)) continue;
    if (!verbs.has(sub)) continue;
    found.push({ name, sub });
  }
  return found;
}

/**
 * The invocations of this tool under a name that is not this tool's. PURE.
 */
export function foreignInvocations(entry, product = PRODUCT_NAME, verbs = subcommands()) {
  return invocations(entry, verbs).filter(
    (i) => i.name !== product && !FOREIGN_PROGRAMS.has(i.name)
  );
}

/** Every open task's contract, audited. Returns findings AND what it read — a
 *  count of zero entries would be a pass with no evidentiary force. */
export function auditOpenContracts(backlogDir = BACKLOG_DIR, tasksDir = TASKS_DIR) {
  const config = loadConfig(backlogDir);
  const archived = new Set(config.archivedStatuses || []);
  const verbs = subcommands();
  const findings = [];
  let entriesChecked = 0;
  let tasksChecked = 0;
  for (const record of readTaskRecords(tasksDir, config.taskId.file)) {
    if (archived.has(record.status)) continue;
    tasksChecked++;
    const file = join(tasksDir, String(record.file).replace(/^tasks\//, ""));
    const raw = readFileSync(file, "utf8");
    const frontmatter = (raw.match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
    for (const entry of parseVerification(frontmatter).entries) {
      entriesChecked++;
      for (const bad of foreignInvocations(entry, PRODUCT_NAME, verbs)) {
        findings.push({ task: record.id, kind: entry.bash ? "bash" : "manual", ...bad });
      }
    }
  }
  return { findings, entriesChecked, tasksChecked };
}

// ── the rule, on fixtures ─────────────────────────────────────────────────

test("POSITIVE CONTROL: a contract naming another binary is a finding", () => {
  // Without this the audit below would be satisfied by a pattern that matches
  // nothing at all, which reads exactly like a clean tree.
  const stale = { manual: "With a page open from `oldname serve`: running `oldname take <ID>`" };
  const found = foreignInvocations(stale);
  assert.deepEqual(found.map((f) => f.name), ["oldname", "oldname"]);
  assert.deepEqual(found.map((f) => f.sub), ["serve", "take"]);

  const bash = { bash: `oldname query --status blocked` };
  assert.equal(foreignInvocations(bash).length, 1);
});

test("the product's own name, however it is invoked, is not a finding", () => {
  const entries = [
    { manual: `In a fresh shell: \`${PRODUCT_NAME} query --status <TAB>\` suggests statuses` },
    { bash: `${PRODUCT_NAME} build && ${PRODUCT_NAME} check` },
    { bash: `! ${PRODUCT_NAME} done TL-1` },
    { bash: `BACKLOG_DIR=/tmp/x ${PRODUCT_NAME} stats` },
    { bash: "node scripts/cli.mjs done TL-1" },
  ];
  for (const e of entries) assert.deepEqual(foreignInvocations(e), [], JSON.stringify(e));
});

test("prose is not an invocation, and neither is another program's verb", () => {
  // The words `build`, `run` and `init` are this tool's subcommands AND ordinary
  // English AND other programs' subcommands. A guard that could not tell them
  // apart would be unusable in exactly the entries it exists for.
  const prose = { manual: "The views are rebuilt, and the loop is asked to run before the next take" };
  assert.deepEqual(foreignInvocations(prose), []);
  assert.deepEqual(foreignInvocations({ bash: "git init && npm run build" }), []);
  assert.deepEqual(foreignInvocations({ bash: "echo 'query returned nothing'" }), []);
});

// ── the effect, on this repository ────────────────────────────────────────

test("no OPEN task asks anybody to run a command that is not this tool", () => {
  const { findings, entriesChecked, tasksChecked } = auditOpenContracts();
  assert.deepEqual(
    findings,
    [],
    "a contract still names a binary that does not exist:\n" +
      findings.map((f) => `  ${f.task} (${f.kind}): ${f.name} ${f.sub}`).join("\n")
  );
  // The counts are the positive control for the WALK: zero entries read would
  // be a green run over an empty sample.
  assert.ok(tasksChecked > 0, "no open task was read at all");
  assert.ok(entriesChecked > 0, "no open task carries a verification entry — the walk read nothing");
});

test("a CLOSED task's contract is left alone, and this is deliberate", () => {
  // Not a wish: the audit above must be scoped, and the way to show it is that
  // the same pattern still finds something in the archive. If this ever comes
  // back empty, either the archive was rewritten — which is the falsification
  // this scope exists to prevent — or the scope stopped mattering.
  const config = loadConfig(BACKLOG_DIR);
  const archived = new Set(config.archivedStatuses || []);
  const verbs = subcommands();
  let inArchive = 0;
  for (const record of readTaskRecords(TASKS_DIR, config.taskId.file)) {
    if (!archived.has(record.status)) continue;
    const file = join(TASKS_DIR, String(record.file).replace(/^tasks\//, ""));
    const frontmatter = (readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/) || [])[1] || "";
    for (const entry of parseVerification(frontmatter).entries) {
      inArchive += foreignInvocations(entry, PRODUCT_NAME, verbs).length;
    }
  }
  assert.ok(inArchive > 0, "the archive holds no such contract — the scope of the audit is untested");
});
