#!/usr/bin/env node
/**
 * Guard: every acceptance criterion names the `verification:` entry that proves
 * it (TL-86).
 *
 * WHY THIS IS A GUARD AND NOT A CONVENTION. Backlog.md asks for the same thing
 * in prose — "check only the criteria the evidence proves" — which is a request
 * for honesty. A request is what you fall back on when the format cannot express
 * the relation. Once a criterion can NAME its proof, the tool can answer the
 * question instead of asking the reader to.
 *
 * WHY CLOSED TASKS ARE NOT JUDGED. `done` and `cancelled` are read-only history
 * here: this backlog alone holds 44 of them with 60 unticked criteria, and a
 * guard that is permanently red on facts nobody may change teaches people to
 * skip it. The archived statuses come from the configuration, so a project that
 * calls them something else keeps the same behaviour.
 *
 * THE SEVERITY SPLIT is the migration path. A BROKEN link is always an error —
 * only someone already using the mechanism can produce one, so it cannot make an
 * old task unclosable. A MISSING link is an error only under
 * `criteria_links: require`; the default `warn` reports without failing, so
 * tasks written before the mechanism existed stay closable while they are being
 * linked up.
 *
 * Usage:
 *   node scripts/check-backlog-criteria.mjs [--dir <backlog>]
 *
 * Exit 0 = clean (and it prints how many links it verified — a ✓ over zero
 * links means "nothing to check", not "checked and fine").
 * Exit 1 = at least one error.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { backlogPaths, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { auditTask } from "./criteria.mjs";
import { listTaskFileNames } from "./task-io.mjs";
import { extractMeta, splitFrontmatter } from "./task-fields.mjs";
import { MARK, color, errColor } from "./ui.mjs";
// The product name comes from the manifest, never from a literal (AGENTS.md) —
// it is still provisional, so renaming it has to stay a single edit.
import { PRODUCT_NAME } from "./product.mjs";

const OKM = color.ok(MARK.ok);
const ERRM = errColor.err(MARK.err);
const WARNM = errColor.warn(MARK.warn);
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * @returns {{checked: number, judged: number, links: number, failures: Array<{file: string, messages: string[]}>,
 *            advisories: Array<{file: string, messages: string[]}>}}
 */
export function auditCriteria(tasksDir, config, read = readFileSync) {
  const files = listTaskFileNames(tasksDir, config);
  const archived = new Set(config.archivedStatuses || []);
  const failures = [];
  const advisories = [];
  let judged = 0;
  let links = 0;

  for (const file of files) {
    const raw = read(join(tasksDir, file), "utf8");
    const { frontmatter, body } = splitFrontmatter(raw);
    const meta = extractMeta(frontmatter);
    if (archived.has(meta.status)) continue;
    judged++;

    const result = auditTask({ frontmatter, body, policy: config.criteriaLinks });
    for (const item of result.items) links += item.proofs.length;
    if (result.errors.length) failures.push({ file, messages: result.errors });
    if (result.warnings.length) advisories.push({ file, messages: result.warnings });
  }

  return { checked: files.length, judged, links, failures, advisories };
}

function main(argv) {
  const { dir, argv: rest } = takeDirFlag(argv);
  if (rest.length) {
    console.error(`${PRODUCT_NAME} check: unknown argument: ` + rest.join(" "));
    console.error("  usage: check-backlog-criteria.mjs [--dir <backlog>]");
    return 2;
  }

  const root = resolveBacklogDir({ dir: dir || undefined, moduleDir: __dirname }).root;
  const config = loadConfigOrExit(root);
  const { judged, links, failures, advisories } = auditCriteria(backlogPaths(root).tasksDir, config);

  for (const a of advisories) {
    console.error(`${WARNM} ${a.file}`);
    for (const m of a.messages) console.error("    " + m);
  }

  if (!failures.length) {
    const tail = advisories.length
      ? ` — ${advisories.length} task(s) not linked yet (criteria_links: ${config.criteriaLinks})`
      : "";
    console.log(
      `${OKM} backlog: ${links} criterion→verification link(s) across ${judged} open tasks all resolve${tail}`
    );
    return 0;
  }

  console.error(ERRM + " backlog: acceptance criteria and verification do not agree");
  for (const f of failures) {
    console.error(`  - ${f.file}:`);
    for (const m of f.messages) console.error("      " + m);
  }
  console.error("");
  console.error("A criterion names the entry that proves it, and the entry carries that id:");
  console.error("  verification:");
  console.error("    - id: help-exit-0");
  console.error('      bash: "node --test scripts/tests/cli-help.test.mjs"');
  console.error(`  - [ ] \`${PRODUCT_NAME} <cmd> --help\` exits 0 for every command. [proof: help-exit-0]`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith("check-backlog-criteria.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
