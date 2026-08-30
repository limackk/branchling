#!/usr/bin/env node
/**
 * Executable entry point (BL-1439).
 *
 * WHY A SHIM. The dispatcher lives in `scripts/cli.mjs` and is imported by
 * tests; `bin/` exists so npm has something to link into PATH. Keeping the two
 * apart means installing the package cannot change how the dispatcher behaves,
 * and the dispatcher stays testable without spawning a binary.
 *
 * This file must carry NO logic of its own. Every decision — command
 * resolution, exit codes, help — belongs to `cli.mjs`, so that the installed
 * binary and
 * `node scripts/cli.mjs x` can never diverge.
 *
 * Tests: `node --test backlog/scripts/tests/packaging.test.mjs`
 */

import { main } from "../scripts/cli.mjs";

process.exit(main(process.argv.slice(2)));
