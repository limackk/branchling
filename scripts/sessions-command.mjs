#!/usr/bin/env node
/**
 * The `sessions` entry point (TL-92). The report lives in `session-report.mjs`,
 * which `session` shares — one module, two commands, and a file per command so
 * the dispatcher names a script rather than passing a mode flag nobody types.
 */
import { mainList } from "./session-report.mjs";

process.exit(mainList(process.argv.slice(2)));
