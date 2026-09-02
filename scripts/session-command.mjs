#!/usr/bin/env node
/**
 * The `session <id>` entry point (TL-92). See `sessions-command.mjs` for why
 * this is a file of its own.
 */
import { mainOne } from "./session-report.mjs";

process.exit(mainOne(process.argv.slice(2)));
