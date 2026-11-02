#!/usr/bin/env node
/**
 * `deploy` — where shipped work stands, and the stages git cannot observe
 * (TL-513).
 *
 * WHY A COMMAND OF ITS OWN. TL-502 and TL-506 routed these two subcommands
 * through `release`, beside `release <ID>`, so one word named two unrelated
 * acts: giving a claimed task back to the queue and shipping software. The
 * configuration already calls the second one `deploy_targets`, and so does this
 * command. The modules keep their names (`release-status.mjs`,
 * `release-record.mjs`) and so do the `--json` kinds (`release-status`,
 * `release-record`): the first are internal, the second are a contract a
 * caller may already read.
 */
import { PRODUCT_NAME as N } from "./product.mjs";
import { refusal } from "./ui.mjs";
import { run as runStatus } from "./release-status.mjs";
import { run as runRecord } from "./release-record.mjs";

/** The words `deploy` takes. Also the words `release` refuses with a pointer
 *  here, since a task id always carries its prefix and a number. */
export const DEPLOY_SUBCOMMANDS = Object.freeze(["status", "record"]);

export function run(argv) {
  const sub = argv[0];
  if (sub === "status") return runStatus(argv.slice(1));
  if (sub === "record") return runRecord(argv.slice(1));
  // There is no default subcommand: `deploy` alone could mean reading or
  // writing, and a guess between those two is exactly what must not happen.
  console.error(refusal(N + " deploy", sub ? "unknown subcommand: " + sub : "no subcommand", DEPLOY_SUBCOMMANDS.join(", ")));
  return 2;
}
if (process.argv[1] && process.argv[1].endsWith("deploy-command.mjs")) process.exitCode = run(process.argv.slice(2));
