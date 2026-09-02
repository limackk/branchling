#!/usr/bin/env node
/**
 * `where` — which directories is this run actually using, and why (TL-34).
 *
 * WHY A COMMAND FOR THIS. The data directory is resolved from four sources, the
 * home directory from another four, and both are silent about which one fired.
 * That is right — a tool that announced its own path resolution on every
 * invocation would be unusable — but it leaves one question with no answer at
 * all: *"it is reading the wrong backlog, why?"* Everything the answer needs is
 * known inside one process and nowhere else, so it is printed on request.
 *
 * IT NAMES THE SOURCE, NOT ONLY THE PATH. A path on its own turns "why this
 * one" into a guessing game across `--dir`, `BACKLOG_DIR`, a walk upwards from
 * the working directory, and co-location with the code. The source is the half
 * of the answer that cannot be worked out afterwards.
 *
 * IT NEVER CREATES ANYTHING. Asking where a directory would be must not bring it
 * into existence — otherwise the first `where` on a machine leaves a trail of
 * empty folders and the second one reports a different, now-true answer.
 *
 * Exit: 0 reported · 1 no backlog found · 2 the invocation was wrong.
 *
 * Tests: `node --test scripts/tests/home.test.mjs`
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { activityDir } from "./activity.mjs";
import { homePaths, loadUserConfig, registryPath, userConfigPath } from "./home.mjs";
import { projectFor, readRegistry } from "./registry.mjs";
import { resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { MARK, color, failure, heading, table } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const KNOWN_FLAGS = ["--json", "--dir"];

/**
 * Everything a reader could want, as data. Reads the disk but writes nothing.
 *
 * The BACKLOG half may be absent — `where` run outside any repository is a
 * legitimate question with a legitimate answer, and it is the one moment the
 * home directory matters most.
 */
export function whereReport(opts = {}) {
  const env = opts.env || process.env;
  const home = homePaths(env);
  const user = loadUserConfig(env);
  const registry = readRegistry(env);

  let backlog = null;
  let error = null;
  try {
    const resolved = resolveBacklogDir({
      dir: opts.dir || undefined, cwd: opts.cwd, moduleDir: opts.moduleDir || __dirname,
    });
    backlog = {
      root: resolved.root,
      source: resolved.source,
      registeredAs: (projectFor(resolved.root, env) || {}).name || null,
      // Where this backlog's RAW heartbeats go — outside the repository since
      // TL-35. Printed here because §9 requires a person to have ONE place to
      // check what the tool holds about them, and a path they cannot find is a
      // guarantee they cannot verify.
      activity: activityDir(resolved.root, env),
    };
  } catch (e) {
    error = e.message;
  }

  return {
    home: home.home,
    homeSource: home.source,
    config: home.config,
    data: home.data,
    preferences: { path: userConfigPath(env), exists: user.exists },
    registry: {
      path: registryPath(env),
      exists: registry.exists,
      projects: registry.projects.length,
      missing: registry.missing.map((p) => p.name + " → " + p.path),
    },
    backlog,
    error,
  };
}

const yesNo = (b) => (b ? "yes" : "no");

/** The text answer. PURE, so a test reads it without a terminal. */
export function renderWhere(report, opts = {}) {
  const paint = opts.color || color;
  const out = [];
  out.push(heading("where", { color: paint }));
  out.push("");
  out.push("  the backlog this run would use:");
  if (report.backlog) {
    out.push(table([
      ["    directory", report.backlog.root],
      ["    found by", report.backlog.source],
      ["    registered as", report.backlog.registeredAs || "—"],
      ["    raw activity log", report.backlog.activity],
    ]));
  } else {
    out.push("  " + paint.warn(MARK.warn) + " none found — " + report.error);
  }
  out.push("");
  out.push("  this machine (facts about YOU, never about a project):");
  out.push(table([
    ["    home", report.home],
    ["    decided by", report.homeSource],
    ["    config", report.config],
    ["    data", report.data],
    ["    preferences", report.preferences.path + "  (exists: " + yesNo(report.preferences.exists) + ")"],
    ["    registry", report.registry.path + "  (exists: " + yesNo(report.registry.exists) + ")"],
    ["    projects known", String(report.registry.projects)],
  ]));
  if (report.registry.missing.length) {
    out.push("");
    out.push("  " + paint.warn(MARK.warn) + " registered but not on disk any more:");
    out.push(table(report.registry.missing.map((m) => ["    " + m, ""])));
    out.push("  " + paint.dim("Reported rather than skipped: a silent skip would turn `you moved it`"));
    out.push("  " + paint.dim("into `that project has no tasks`."));
  }
  out.push("");
  out.push("  " + paint.dim("The registry is an INDEX. Deleting it costs the cross-project view and"));
  out.push("  " + paint.dim("nothing else — every command in a repository finds its backlog by itself."));
  return out.join("\n");
}

export function main(argv) {
  const cli = takeDirFlag(argv);
  const asJson = cli.argv.includes("--json");
  const unknown = cli.argv.filter((a) => !KNOWN_FLAGS.includes(a));
  if (unknown.length) {
    console.error(failure(N + " where", "unexpected argument: " + unknown.join(" "), [],
      [N + " where --help"]));
    return 2;
  }

  const report = whereReport({ dir: cli.dir });
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  console.log(renderWhere(report));
  // A missing backlog is an ANSWER here, not a failure: "where" outside a
  // repository is exactly the question this command exists for. The non-zero
  // exit is reserved for a `--dir` that names something that is not a backlog,
  // which `resolveBacklogDir` throws on and which is a usage error.
  return report.backlog || !cli.dir ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("where-command.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
