/**
 * Freeze what a release's `init` writes, as the fixture the suite reads (TL-587).
 *
 *   node scripts/tests/fixtures/released/capture.mjs <version> [<source checkout>]
 *
 * WHY A FROZEN FIXTURE AND NOT A TAG. Every other fixture in the suite is made
 * by the current code, so a release that can no longer read a backlog its
 * predecessor wrote would pass. Rebuilding the old tree from `v<version>` at
 * test time would close that, except where tags are absent — a shallow CI
 * checkout has none — and there the test would have nothing to read and look
 * green. The tree is therefore captured once, committed, and never edited.
 *
 * WHAT IS CAPTURED. Exactly the files a team commits after that `init`: the
 * ones git in a fresh repository does not ignore. The computed views are
 * ignored by the `.gitignore` the same `init` writes, so law 2 decides what is
 * left out rather than a list kept here. Beside the tree, `config-keys.json`
 * lists every `config.yaml` key that release knew — the keys of its `DEFAULTS`,
 * read from its own `scripts/config.mjs`, so the list is a fact about the
 * release and not somebody's memory of it.
 *
 * WHY DOTFILES ARE RENAMED. A fixture's `.gitignore` and `.gitattributes` would
 * apply to THIS repository's files beneath them, so every leading `.` of a path
 * segment is stored as `dot-` and `restoreReleasedBacklog` in
 * `scripts/tests/_released.mjs` turns it back.
 *
 * The source checkout defaults to the one this script sits in, which is what
 * the commit that bumps the version runs. For a release already tagged,
 * extract it first: `git archive v<version> | tar -x -C <dir>`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OWN_CHECKOUT = resolve(HERE, "..", "..", "..", "..");

/** `.gitignore` → `dot-gitignore`, segment by segment. */
export function storedPath(path) {
  return path.split("/").map((s) => (s.startsWith(".") ? "dot-" + s.slice(1) : s)).join("/");
}

function fail(message) {
  process.stderr.write("capture: " + message + "\n");
  process.exit(1);
}

function run(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) fail(cmd + " " + args.join(" ") + " exited " + r.status + "\n" + r.stdout + r.stderr);
  return r.stdout;
}

async function main([version, source = OWN_CHECKOUT, ...rest]) {
  if (!version || rest.length) fail("usage: capture.mjs <version> [<source checkout>]");
  const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
  if (manifest.version !== version) {
    fail(source + " is version " + manifest.version + ", not " + version + " — a fixture under the wrong name tests nothing");
  }
  const dest = join(HERE, version);
  if (existsSync(dest)) fail(dest + " exists — a released fixture is frozen; delete it only to correct a capture");

  const work = mkdtempSync(join(tmpdir(), "released-capture-"));
  // The release runs with nothing of this machine: its own home, state and an
  // empty git configuration, so the captured tree is what any stranger gets.
  const gitConfig = join(work, "gitconfig");
  writeFileSync(gitConfig, "");
  const env = {
    PATH: process.env.PATH, HOME: join(work, "home"), XDG_CONFIG_HOME: join(work, "xdg-config"),
    XDG_DATA_HOME: join(work, "xdg-data"), XDG_STATE_HOME: join(work, "xdg-state"),
    BRANCHLING_HOME: join(work, "home"), BACKLOG_STATE_DIR: join(work, "state"),
    GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_SYSTEM: gitConfig, NO_COLOR: "1",
  };
  const repo = join(work, "repo");
  mkdirSync(repo);
  run("git", ["init", "-q"], repo, env);
  run(process.execPath, [join(source, "scripts", "cli.mjs"), "init", "--dir", "backlog", "--no-nudge"], repo, env);
  const kept = run("git", ["ls-files", "--others", "--exclude-standard", "--", "backlog"], repo, env)
    .split("\n").filter(Boolean).map((p) => p.slice("backlog/".length));
  if (!kept.includes("config.yaml")) fail("init wrote no config.yaml that git would keep: " + kept.join(", "));

  for (const path of kept) {
    const to = join(dest, "backlog", storedPath(path));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(repo, "backlog", path), to);
  }
  const { DEFAULTS } = await import(pathToFileURL(join(source, "scripts", "config.mjs")).href);
  writeFileSync(join(dest, "config-keys.json"), JSON.stringify(Object.keys(DEFAULTS).sort(), null, 2) + "\n");
  rmSync(work, { recursive: true, force: true });
  process.stdout.write("captured " + version + ": " + kept.length + " file(s) and " +
    Object.keys(DEFAULTS).length + " config key(s) → " + dest + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
