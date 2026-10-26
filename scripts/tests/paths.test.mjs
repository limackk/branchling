/**
 * The contract for resolving the backlog directory (BL-1399).
 *
 * Why this test exists in this shape: every script used to compute the data
 * directory from ITS OWN location (`__dirname/..`), so the code and the data were
 * the same directory — which makes it impossible either to install the module
 * next to another repository or to point it at a different backlog. The most
 * dangerous defect of the new version is not a loud one: it is SILENTLY pointing
 * at the WRONG directory (for example the `tasks/` of whatever repository you
 * happen to be standing in). That is why what is tested is the ORDER of the
 * sources, and the fact that discovery requires a marker rather than the mere
 * existence of `tasks/`.
 *
 * The resolver takes `exists` as a parameter, so the order can be checked without
 * building ten directory trees on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { BacklogNotFoundError, backlogPaths, looksLikeBacklogDir, repositoryRoot, resolveBacklogDir } from "../paths.mjs";
import { gitDiscoveryEnv } from "../git-env.mjs";

import { SCRIPTS_DIR, isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("paths");

const CLI = join(SCRIPTS_DIR, "cli.mjs");

/**
 * A fixture path as the platform spells it. The resolver works in native
 * paths, so `/repo/backlog` is `D:\repo\backlog` on Windows (TL-463) — the
 * fixtures are written once, POSIX-shaped, and resolved here.
 */
const at = (p) => resolve(p);

/** A fake filesystem: the set of paths that exist. */
const fsWith = (paths) => (p) => paths.includes(p);

const TREE = [
  at("/repo/backlog"),
  at("/repo/backlog/tasks"),
  at("/repo/backlog/boards.yaml"),
  at("/repo/tools/backlog/scripts"),
];

test("an explicit path wins over everything", () => {
  const r = resolveBacklogDir({
    dir: at("/repo/backlog"),
    env: at("/somewhere/else"),
    cwd: at("/repo/src"),
    moduleDir: at("/tools/backlog/scripts"),
    exists: fsWith(TREE.concat([at("/somewhere/else"), at("/somewhere/else/tasks"), at("/somewhere/else/boards.yaml")])),
  });
  assert.equal(r.root, at("/repo/backlog"));
  assert.equal(r.source, "explicit");
});

test("the environment variable beats discovery and co-location", () => {
  const r = resolveBacklogDir({
    env: at("/env/backlog"),
    cwd: at("/repo/src"),
    moduleDir: at("/tools/backlog/scripts"),
    exists: fsWith([at("/env/backlog"), at("/env/backlog/tasks"), at("/env/backlog/boards.yaml")].concat(TREE)),
  });
  assert.equal(r.root, at("/env/backlog"));
  assert.equal(r.source, "env");
});

test("discovery goes UPWARDS from cwd and finds the backlog/ subdirectory", () => {
  const r = resolveBacklogDir({
    cwd: at("/repo/src/deep/deeper"),
    moduleDir: at("/tools/backlog/scripts"),
    exists: fsWith(TREE),
  });
  assert.equal(r.root, at("/repo/backlog"));
  assert.equal(r.source, "discovery");
});

test("a cwd that IS the backlog directory is discovered without going higher", () => {
  const r = resolveBacklogDir({
    cwd: at("/repo/backlog"),
    moduleDir: at("/tools/backlog/scripts"),
    exists: fsWith(TREE),
  });
  assert.equal(r.root, at("/repo/backlog"));
});

test("a `tasks/` directory alone is NOT enough — a backlog marker is required", () => {
  // The class of defect: you are standing in another repository that has a
  // `tasks/` with an entirely different meaning. Silently writing into the wrong
  // tree is worse than an error.
  const exists = fsWith([at("/other-repo"), at("/other-repo/tasks")]);
  assert.equal(looksLikeBacklogDir(at("/other-repo"), exists), false);
  assert.equal(looksLikeBacklogDir(at("/repo/backlog"), fsWith(TREE)), true);
});

test("when nothing was found — co-location (today's layout, the alias from any cwd)", () => {
  const r = resolveBacklogDir({
    cwd: at("/somewhere/else"),
    moduleDir: at("/repo/backlog/scripts"),
    exists: fsWith(TREE.concat([at("/repo/backlog/scripts")])),
  });
  assert.equal(r.root, at("/repo/backlog"));
  assert.equal(r.source, "colocated");
});

test("no backlog at all throws a NAMED error saying WHAT to do — creating included", () => {
  // TL-47: the type is what a caller matches on, so a foreseen absence can be
  // turned into a message while a genuine programmer error keeps its stack.
  let thrown = null;
  try {
    resolveBacklogDir({ cwd: at("/empty"), moduleDir: at("/somewhere/scripts"), exists: fsWith([]) });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown instanceof BacklogNotFoundError, "a bare Error cannot be told from a crash");
  const said = thrown.message + "\n" + thrown.details.join("\n");
  assert.match(said, /BACKLOG_DIR|--dir/, "how to point at a backlog that exists");
  assert.match(said, /init/,
    "and how to CREATE one — the person most likely to see this has none yet");
});

test("in a directory that looks like a project, CREATING is offered first", () => {
  const inProject = (files) => {
    try {
      resolveBacklogDir({ cwd: at("/repo"), moduleDir: at("/somewhere/scripts"), exists: fsWith(files) });
    } catch (e) { return e.details[0]; }
    throw new Error("it found a backlog where the fixture has none");
  };
  assert.match(inProject([at("/repo/.git")]), /init/,
    "somebody standing in a repository with no backlog wants to create one");
  assert.match(inProject([]), /--dir/,
    "somebody in a home directory wants to point at one they already have");
});

test("backlogPaths keeps every path in one place", () => {
  const p = backlogPaths(at("/repo/backlog"));
  assert.equal(p.root, at("/repo/backlog"));
  assert.equal(p.tasksDir, at("/repo/backlog/tasks"));
  assert.equal(p.historyDir, at("/repo/backlog/history"));
  assert.equal(p.archiveDir, at("/repo/backlog/archive"));
  assert.equal(p.boardsDir, at("/repo/backlog/boards"));
  assert.equal(p.configPath, at("/repo/backlog/config.yaml"));
  assert.equal(p.boardsPath, at("/repo/backlog/boards.yaml"));
  assert.equal(p.templatePath, at("/repo/backlog/_template.md"));
});

test("on a REAL tree: discovery from a subdirectory lands on the backlog directory", () => {
  const tmp = mkdtempSync(join(tmpdir(), "backlog-paths-"));
  mkdirSync(join(tmp, "backlog", "tasks"), { recursive: true });
  writeFileSync(join(tmp, "backlog", "boards.yaml"), "default: main\n", "utf8");
  mkdirSync(join(tmp, "src", "nested"), { recursive: true });

  const r = resolveBacklogDir({ cwd: join(tmp, "src", "nested"), moduleDir: join(tmp, "nothing") });
  assert.equal(r.root, join(tmp, "backlog"));
  assert.equal(r.source, "discovery");
  rmSync(tmp, { recursive: true, force: true });
});

// ── The repository root under a hook's environment (TL-483) ─────────────────

/**
 * A repository with a backlog whose one task points at `docs/spec.md`, and a
 * linked worktree of it — the layout the pre-commit hook runs in. Built through
 * the CLI, so the backlog is the shape `init` and `new` produce rather than one
 * this file assumes.
 */
function worktreeFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "backlog-gitdir-")));
  const main = join(base, "main");
  const wt = join(base, "wt");
  const env = { ...process.env, NO_COLOR: "1", BACKLOG_STATE_DIR: join(base, "state") };
  delete env.GIT_DIR;
  const git = (cwd, args) => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  const cli = (cwd, args, extra = {}, input) =>
    spawnSync(process.execPath, [CLI].concat(args), { cwd, env: { ...env, ...extra }, encoding: "utf8", input });
  mkdirSync(join(main, "docs"), { recursive: true });
  git(main, ["init", "-q"]);
  writeFileSync(join(main, "docs", "spec.md"), "# Spec\n", "utf8");
  assert.equal(cli(main, ["init", "--dir", "backlog", "--no-example"]).status, 0);
  const made = cli(main, ["new", "--title", "A task", "--dir", "backlog"], {},
    JSON.stringify({ goal: "g", verification: [{ id: "v", bash: "true", proves: "p" }] }));
  assert.equal(made.status, 0, made.stderr);
  const tasks = join(main, "backlog", "tasks");
  const file = join(tasks, readdirSync(tasks).find((f) => f.endsWith("-a-task.md")));
  writeFileSync(file, readFileSync(file, "utf8").replace(/^related_docs: \[\]/m, "related_docs: [docs/spec.md]"), "utf8");
  git(main, ["add", "-A"]);
  git(main, ["commit", "-q", "-m", "fixture"]);
  git(main, ["worktree", "add", "-q", wt, "-b", "wt"]);
  const gitDir = git(wt, ["rev-parse", "--absolute-git-dir"]).trim();
  return { base, wt, gitDir, cli };
}

test("with GIT_DIR set in a linked worktree the root is still the worktree's top (TL-483)", () => {
  const f = worktreeFixture();
  const saved = process.env.GIT_DIR;
  try {
    // POSITIVE CONTROL: the environment really is the trap. Without it this test
    // would pass against a git that ignored `GIT_DIR`, and prove nothing.
    const raw = spawnSync("git", ["-C", join(f.wt, "backlog"), "rev-parse", "--show-toplevel"],
      { encoding: "utf8", env: { ...process.env, GIT_DIR: f.gitDir } });
    assert.equal(realpathSync(raw.stdout.trim()), join(f.wt, "backlog"),
      "git no longer takes cwd as the work tree under GIT_DIR — the fixture no longer reproduces the hook");

    process.env.GIT_DIR = f.gitDir;
    assert.equal(repositoryRoot(join(f.wt, "backlog")), f.wt);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
    rmSync(f.base, { recursive: true, force: true });
  }
});

test("`check --docs` answers the same with and without the hook's GIT_DIR (TL-483)", () => {
  const f = worktreeFixture();
  try {
    const plain = f.cli(f.wt, ["check", "--docs"]);
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    assert.match(plain.stdout, /1 link\(s\) and related_docs/, "the gate judged nothing, so its green is no evidence");
    const hooked = f.cli(f.wt, ["check", "--docs"], { GIT_DIR: f.gitDir });
    assert.equal(hooked.status, 0, hooked.stdout + hooked.stderr);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test("GIT_DIR is kept when GIT_WORK_TREE names the work tree, and dropped when it does not", () => {
  const env = { GIT_DIR: "/r/.git", GIT_INDEX_FILE: "/r/.git/index", PATH: "/bin" };
  assert.deepEqual(gitDiscoveryEnv(env), { GIT_INDEX_FILE: "/r/.git/index", PATH: "/bin" });
  const pinned = { ...env, GIT_WORK_TREE: "/r" };
  assert.equal(gitDiscoveryEnv(pinned), pinned);
  const none = { PATH: "/bin" };
  assert.equal(gitDiscoveryEnv(none), none);
});
