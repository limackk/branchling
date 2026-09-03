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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BacklogNotFoundError, backlogPaths, looksLikeBacklogDir, resolveBacklogDir } from "../paths.mjs";

import { isolateHome } from "./_repo.mjs";

// THE HOME IS ISOLATED FOR THE WHOLE FILE (TL-166). `node --test` runs each
// file in its own process, so one call covers every case in it. Without this a
// test reads the DEVELOPER's `<config>/config.yaml` — their actor, their model
// endpoint — and the suite answers differently on different machines.
isolateHome("paths");

/** A fake filesystem: the set of paths that exist. */
const fsWith = (paths) => (p) => paths.includes(p);

const TREE = [
  "/repo/backlog",
  "/repo/backlog/tasks",
  "/repo/backlog/boards.yaml",
  "/repo/tools/backlog/scripts",
];

test("an explicit path wins over everything", () => {
  const r = resolveBacklogDir({
    dir: "/repo/backlog",
    env: "/somewhere/else",
    cwd: "/repo/src",
    moduleDir: "/tools/backlog/scripts",
    exists: fsWith(TREE.concat(["/somewhere/else", "/somewhere/else/tasks", "/somewhere/else/boards.yaml"])),
  });
  assert.equal(r.root, "/repo/backlog");
  assert.equal(r.source, "explicit");
});

test("the environment variable beats discovery and co-location", () => {
  const r = resolveBacklogDir({
    env: "/env/backlog",
    cwd: "/repo/src",
    moduleDir: "/tools/backlog/scripts",
    exists: fsWith(["/env/backlog", "/env/backlog/tasks", "/env/backlog/boards.yaml"].concat(TREE)),
  });
  assert.equal(r.root, "/env/backlog");
  assert.equal(r.source, "env");
});

test("discovery goes UPWARDS from cwd and finds the backlog/ subdirectory", () => {
  const r = resolveBacklogDir({
    cwd: "/repo/src/deep/deeper",
    moduleDir: "/tools/backlog/scripts",
    exists: fsWith(TREE),
  });
  assert.equal(r.root, "/repo/backlog");
  assert.equal(r.source, "discovery");
});

test("a cwd that IS the backlog directory is discovered without going higher", () => {
  const r = resolveBacklogDir({
    cwd: "/repo/backlog",
    moduleDir: "/tools/backlog/scripts",
    exists: fsWith(TREE),
  });
  assert.equal(r.root, "/repo/backlog");
});

test("a `tasks/` directory alone is NOT enough — a backlog marker is required", () => {
  // The class of defect: you are standing in another repository that has a
  // `tasks/` with an entirely different meaning. Silently writing into the wrong
  // tree is worse than an error.
  const exists = fsWith(["/other-repo", "/other-repo/tasks"]);
  assert.equal(looksLikeBacklogDir("/other-repo", exists), false);
  assert.equal(looksLikeBacklogDir("/repo/backlog", fsWith(TREE)), true);
});

test("when nothing was found — co-location (today's layout, the alias from any cwd)", () => {
  const r = resolveBacklogDir({
    cwd: "/somewhere/else",
    moduleDir: "/repo/backlog/scripts",
    exists: fsWith(TREE.concat(["/repo/backlog/scripts"])),
  });
  assert.equal(r.root, "/repo/backlog");
  assert.equal(r.source, "colocated");
});

test("no backlog at all throws a NAMED error saying WHAT to do — creating included", () => {
  // TL-47: the type is what a caller matches on, so a foreseen absence can be
  // turned into a message while a genuine programmer error keeps its stack.
  let thrown = null;
  try {
    resolveBacklogDir({ cwd: "/empty", moduleDir: "/somewhere/scripts", exists: fsWith([]) });
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
      resolveBacklogDir({ cwd: "/repo", moduleDir: "/somewhere/scripts", exists: fsWith(files) });
    } catch (e) { return e.details[0]; }
    throw new Error("it found a backlog where the fixture has none");
  };
  assert.match(inProject(["/repo/.git"]), /init/,
    "somebody standing in a repository with no backlog wants to create one");
  assert.match(inProject([]), /--dir/,
    "somebody in a home directory wants to point at one they already have");
});

test("backlogPaths keeps every path in one place", () => {
  const p = backlogPaths("/repo/backlog");
  assert.equal(p.root, "/repo/backlog");
  assert.equal(p.tasksDir, "/repo/backlog/tasks");
  assert.equal(p.historyDir, "/repo/backlog/history");
  assert.equal(p.archiveDir, "/repo/backlog/archive");
  assert.equal(p.boardsDir, "/repo/backlog/boards");
  assert.equal(p.configPath, "/repo/backlog/config.yaml");
  assert.equal(p.boardsPath, "/repo/backlog/boards.yaml");
  assert.equal(p.templatePath, "/repo/backlog/_template.md");
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
