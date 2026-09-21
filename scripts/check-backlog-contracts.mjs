#!/usr/bin/env node
/**
 * Guard: an OPEN task's contract names a command a person can actually run
 * (TL-233, wired into `check` by TL-234).
 *
 * THE DEFECT, MEASURED. A `verification:` entry is the one place in a task that
 * is an INSTRUCTION rather than a description: `bash:` is executed by the tool,
 * `manual:` is executed by a person. Eleven `manual:` entries in this backlog
 * named a binary this product has not been called since 2026-09-03, four of
 * them in tasks still open — including TL-122, waiting for a vouch, whose
 * contract asked a person to run a command that answers `command not found`.
 * The only way through was to guess the translation.
 *
 * WHY IT IS A GUARD AND NOT AN ASSERTION (TL-234). The audit was written inside
 * `scripts/tests/contract-product-name.test.mjs`, so it answered only when
 * somebody ran the suite — that is, only for this repository and only for a
 * developer. `check` is where a person asks whether THIS backlog is sound, and a
 * contract that cannot be followed is the same family of finding as the broken
 * criteria link `check` already reports. The pure functions live here now and
 * the test is one of two callers.
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
 *
 * IT FAILS RATHER THAN REPORTING, and this was the open decision (TL-234).
 * Against it: a backlog imported from elsewhere could go red on a contract
 * legitimately naming somebody else's binary, since `plan`, `new` and `init`
 * are other programs' verbs too. For it: the finding is not about the past. It
 * is an instruction, in a task nobody has closed, that answers `command not
 * found` for the next person who follows it — and `check` exists to refuse a
 * backlog in that state, the same way a dangling `related_docs` path fails
 * without anybody arguing that the file may come back. `reasons` and
 * `log-status` report instead because their findings are in the archive, which
 * is precisely what this guard refuses to read. The escape hatch for a false
 * positive is `FOREIGN_PROGRAMS` below, and making that list the consumer's own
 * rather than ours is TL-413.
 *
 * Usage:
 *   node scripts/check-backlog-contracts.mjs [--dir <backlog>]
 *
 * Exit 0 = every command named is this tool or a known foreign program, and it
 * says how many entries it read. Over zero entries it says THAT instead, with a
 * bullet rather than a tick: "nothing was examined" and "examined and clean" are
 * not the same answer.
 * Exit 1 = at least one open contract names a command nobody can run.
 * Exit 2 = the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/contract-product-name.test.mjs`
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMANDS } from "./cli.mjs";
import { loadConfig, loadConfigOrExit } from "./config.mjs";
import { parseVerification } from "./criteria.mjs";
import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME } from "./product.mjs";
import { readTaskRecords } from "./task-select.mjs";
import { MARK, color, errColor } from "./ui.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * Every open task's contract, audited.
 *
 * Returns the findings AND what it read: a count of zero entries would be a
 * pass with no evidentiary force, so the caller has to be able to say so.
 */
export function auditOpenContracts(backlogDir, tasksDir = backlogPaths(backlogDir).tasksDir, config = loadConfig(backlogDir)) {
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
        findings.push({ task: record.id, file: record.file, kind: entry.bash ? "bash" : "manual", ...bad });
      }
    }
  }
  return { findings, entriesChecked, tasksChecked };
}

export function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${PRODUCT_NAME} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-contracts.mjs [--dir <backlog>]");
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const { findings, entriesChecked, tasksChecked } = auditOpenContracts(root, backlogPaths(root).tasksDir, config);

  if (!findings.length) {
    // THE SAMPLE IS PART OF THE VERDICT (CLAUDE.md). A guard that can pass over
    // zero entries has to say when it did, because a green line over nothing
    // reads exactly like a green line over four hundred contracts.
    if (!entriesChecked) {
      // A BULLET AND NOT A `!`. The mark that opens a line is a claim about what
      // the reader has to do with it: `!` means a finding the default run must
      // not carry (TL-383), and "this backlog has no open contract" is not a
      // finding — there is nothing to repair. What it must not be either is a
      // plain tick, which would read as ninety entries examined and clean.
      console.log(
        `${MARK.bullet} contracts: ${tasksChecked} open task(s) and no verification entry among them ` +
          "— nothing was examined"
      );
      return 0;
    }
    console.log(
      `${OKM} contracts: ${entriesChecked} verification entr(ies) across ${tasksChecked} open task(s) ` +
        `name \`${PRODUCT_NAME}\` or a known foreign program`
    );
    return 0;
  }

  console.error(
    `${ERRM} contracts: ${findings.length} open contract(s) name a command that is not \`${PRODUCT_NAME}\`` +
      ` (out of ${entriesChecked} entr(ies) in ${tasksChecked} open task(s))`
  );
  for (const f of findings) {
    console.error(`  - ${f.task} (${f.kind}): \`${f.name} ${f.sub}\``);
    console.error(`    ${f.file}`);
  }
  console.error("");
  console.error("A `verification:` entry is an INSTRUCTION, and an open task's instruction has to");
  console.error(`work today. Write the invocation as \`${PRODUCT_NAME} ${findings[0].sub}\`, or as the`);
  console.error("path the command is really reached by. A CLOSED task is left alone on purpose: its");
  console.error("contract records what was run, under the name the tool had then.");
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-contracts.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
