#!/usr/bin/env node
/**
 * `vocabulary` — the words this backlog declares, as data (TL-532).
 *
 * WHY A COMMAND FOR THIS. A consumer that may reach a backlog only through the
 * command line had no way to learn the vocabulary as a whole: `stats --json`
 * gives the statuses that HAPPEN to be in use, in no order and with no archived
 * set; `<command> --help --json` gives one flag's values at a time; `doctor`
 * reports that the vocabulary is valid, not what it is. A backlog with renamed
 * statuses was therefore drawn wrongly by every interface that kept to the
 * contract, or read `config.yaml` itself and broke the contract to be right.
 *
 * EVERY KEY IS NAMED AFTER ITS `config.yaml` KEY (`deploy_targets`, not
 * `deployTargets`), and that is a rule rather than a style: `set --fields
 * --json` names the config key each field draws its values from, and a consumer
 * then reads this envelope at that key without a translation table.
 *
 * A STATUS CARRIES A ROLE, because a consumer must colour and group by meaning
 * without knowing the word. The role comes from `status_roles:` where the
 * project declared one and is otherwise DERIVED from the keys that already say
 * it; `roleSource` names which, so a guess is never presented as a declaration.
 *
 * Exit: 0 answered · 1 the configuration cannot be read · 2 usage error.
 *
 * Tests: `node --test scripts/tests/vocabulary.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfigOrExit } from "./config.mjs";
import { printJson } from "./json-envelope.mjs";
import { resolveBacklogDirOrExit, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { printLine } from "./stdout.mjs";
import { color, heading, refusal, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMAND = N + " vocabulary";
const KNOWN_FLAGS = ["--json", "--dir"];

/**
 * The role of every status, in declared order. PURE.
 *
 * The derivation, for a status `status_roles:` does not name:
 *   - the FIRST archived status is `closed` — it is the one `done` writes;
 *   - any other archived status is `cancelled` — an ending that is not done;
 *   - `in_progress_status` is `active`;
 *   - `awaiting_vouch_status` and an active status that requires a reason to
 *     enter (`blocked`, by this repository's words) are `waiting`;
 *   - every other active status is `open`.
 *
 * @returns {{name: string, archived: boolean, reasonRequired: boolean,
 *            role: string, roleSource: "status_roles"|"derived"}[]}
 */
export function statusEntries(config) {
  const archived = config.archivedStatuses || [];
  const reasonRequired = new Set(config.reasonRequiredStatuses || []);
  const declared = config.statusRoles || {};
  return config.statuses.map((name) => {
    const isArchived = archived.indexOf(name) >= 0;
    let role;
    if (isArchived) role = name === archived[0] ? "closed" : "cancelled";
    else if (name === config.inProgressStatus) role = "active";
    else if (name === config.awaitingVouchStatus || reasonRequired.has(name)) role = "waiting";
    else role = "open";
    const own = Object.prototype.hasOwnProperty.call(declared, name);
    return {
      name,
      archived: isArchived,
      reasonRequired: reasonRequired.has(name),
      role: own ? declared[name] : role,
      roleSource: own ? "status_roles" : "derived",
    };
  });
}

/** The whole answer, as the payload of the `vocabulary` kind. PURE. */
export function vocabularyReport(config) {
  return {
    root: config.root,
    statuses: statusEntries(config),
    priorities: config.priorities.slice(),
    types: config.types.slice(),
    confidence: config.confidence.slice(),
    estimates: config.estimates.slice(),
    labels: config.labels.slice(),
    labels_closed: config.labelsClosed,
    boards: config.boards.map((b) => ({ slug: b.slug, name: b.name, isDefault: b.slug === config.defaultBoard })),
    roles: config.roles.slice(),
    releases: config.releaseEntries.map((e) => ({ name: e.name, ref: e.ref || null })),
    deploy_targets: config.deployTargets.map((t) => ({
      name: t.name,
      repository: t.repository,
      paths: t.paths,
      stages: t.stages.map((s) => ({ name: s.name, refs: s.refs.slice(), parallel: s.parallel, recorded: s.recorded })),
    })),
  };
}

const list = (xs) => (xs.length ? xs.join(", ") : "(none declared)");

/** The text answer. PURE. */
export function renderVocabulary(report, paint = color) {
  const out = [heading("vocabulary", { color: paint }), ""];
  out.push("  statuses, in declared order:");
  out.push(table(report.statuses.map((s) => [
    "    " + s.name,
    s.role + (s.roleSource === "derived" ? " (derived)" : "") +
      (s.archived ? " · archived" : "") + (s.reasonRequired ? " · reason required" : ""),
  ])));
  out.push("");
  out.push(table([
    ["  priorities", list(report.priorities)],
    ["  types", list(report.types)],
    ["  confidence", list(report.confidence)],
    ["  estimates", list(report.estimates)],
    ["  labels", list(report.labels) + (report.labels_closed ? " (closed)" : "")],
    ["  boards", list(report.boards.map((b) => b.slug + (b.isDefault ? " (default)" : "")))],
    ["  roles", list(report.roles)],
    ["  releases", list(report.releases.map((r) => r.name + (r.ref ? " @ " + r.ref : "")))],
    ["  deploy_targets", list(report.deploy_targets.map((t) => t.name))],
  ]));
  out.push("");
  return out.join("\n");
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  const unknown = cli.argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(refusal(COMMAND,
      (unknown[0].startsWith("-") ? "unknown flag: " : "unexpected argument: ") + unknown.join(" "),
      "--json --dir <path>"));
    return 2;
  }
  const root = resolveBacklogDirOrExit({ dir: cli.dir || undefined, moduleDir: __dirname, jsonKind: cli.argv.includes("--json") ? "vocabulary" : null }, COMMAND).root;
  const report = vocabularyReport(loadConfigOrExit(root));
  if (cli.argv.includes("--json")) printJson("vocabulary", report);
  else printLine(renderVocabulary(report));
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("vocabulary.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
