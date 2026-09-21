#!/usr/bin/env node
/**
 * Where the backlog DATA lives (BL-1399).
 *
 * Until now every script computed the data directory from its own location
 * (`join(__dirname, "..")`). That works for exactly as long as the code and the
 * data are the same directory — that is, until the first attempt to install the
 * module next to somebody else's repository, or to point it at another backlog
 * (a second tree, a fixture in a test, `--dir`). This file is the only place
 * that answers the question "which directory", and the only one that knows the
 * names of the files inside it.
 *
 * The order of the sources — from the most explicit to the most implicit:
 *   1. `--dir <path>` / a call argument                → source: "explicit"
 *   2. `BACKLOG_DIR` in the environment                → source: "env"
 *   3. discovery UPWARDS from cwd (`.` or `./backlog`) → source: "discovery"
 *   4. co-location: the directory above this file      → source: "colocated"
 *
 * Point 4 is what keeps today's layout alive: the `backlog` alias starts the
 * server from ANY directory, including one outside the workspace, and is still
 * meant to land on this backlog.
 *
 * Discovery requires a MARKER (`boards.yaml`, `config.yaml` or `_template.md`
 * next to `tasks/`), not `tasks/` on its own. Somebody else's repository with a
 * directory of that name is more common than it seems, and quietly pointing at
 * the wrong tree ends in writing to the wrong place — which is worse than an
 * error.
 *
 * Tests: `node --test scripts/tests/paths.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { ANY_TASK_FILE } from "./task-id.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { failure } from "./ui.mjs";

export const CONFIG_FILENAME = "config.yaml";
export const BOARDS_FILENAME = "boards.yaml";
export const TEMPLATE_FILENAME = "_template.md";
/** The execution order (TL-107) — DATA, versioned, and optional. */
export const PLAN_FILENAME = "plan.yaml";
export const TASKS_DIRNAME = "tasks";
/** Reviewed prompts for roles declared in config.yaml (TL-264). */
export const ROLES_DIRNAME = "roles";

/** Every path inside the backlog directory — one place that knows these names. */
export function backlogPaths(root) {
  return {
    root,
    tasksDir: join(root, TASKS_DIRNAME),
    historyDir: join(root, "history"),
    archiveDir: join(root, "archive"),
    boardsDir: join(root, "boards"),
    rolesDir: join(root, ROLES_DIRNAME),
    configPath: join(root, CONFIG_FILENAME),
    boardsPath: join(root, BOARDS_FILENAME),
    templatePath: join(root, TEMPLATE_FILENAME),
    planPath: join(root, PLAN_FILENAME),
    indexPath: join(root, "INDEX.yaml"),
    nowPath: join(root, "NOW.yaml"),
    donePath: join(root, "archive", "done.yaml"),
    viewerPath: join(root, "viewer.html"),
  };
}

/**
 * Is this a backlog directory? `tasks/` PLUS at least one marker.
 * `exists` is injected so this can be checked without touching the disk.
 */
export function looksLikeBacklogDir(dir, exists = existsSync) {
  if (!dir || !exists(dir) || !exists(join(dir, TASKS_DIRNAME))) return false;
  return (
    exists(join(dir, BOARDS_FILENAME)) ||
    exists(join(dir, CONFIG_FILENAME)) ||
    exists(join(dir, TEMPLATE_FILENAME))
  );
}

/**
 * @param {{dir?: string, env?: string, cwd?: string, moduleDir?: string,
 *          exists?: (p: string) => boolean}} opts
 *        `moduleDir` is the directory of the calling script (`dirname(
 *        fileURLToPath(import.meta.url))`) — co-location is computed from it.
 * @returns {{root: string, source: "explicit"|"env"|"discovery"|"colocated"}}
 */
export function resolveBacklogDir(opts = {}) {
  const exists = opts.exists || existsSync;
  const cwd = opts.cwd || process.cwd();

  const asRoot = (value, source, strict) => {
    if (!value) return null;
    const abs = isAbsolute(value) ? value : resolve(cwd, value);
    if (looksLikeBacklogDir(abs, exists)) return { root: abs, source };
    // A directory named EXPLICITLY that does not look like a backlog is a usage
    // error — not a silent fall-through to the next source.
    if (strict) {
      throw new Error(
        "That directory does not look like a backlog: " + abs +
          " (expecting a tasks/ subdirectory and one of: " +
          [BOARDS_FILENAME, CONFIG_FILENAME, TEMPLATE_FILENAME].join(", ") + ")"
      );
    }
    return null;
  };

  const explicit = asRoot(opts.dir, "explicit", true);
  if (explicit) return explicit;

  const fromEnv = asRoot(opts.env !== undefined ? opts.env : process.env.BACKLOG_DIR, "env", true);
  if (fromEnv) return fromEnv;

  let dir = resolve(cwd);
  for (;;) {
    if (looksLikeBacklogDir(dir, exists)) return { root: dir, source: "discovery" };
    const nested = join(dir, "backlog");
    if (looksLikeBacklogDir(nested, exists)) return { root: nested, source: "discovery" };
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const colocated = opts.moduleDir ? join(opts.moduleDir, "..") : null;
  if (colocated && looksLikeBacklogDir(colocated, exists)) {
    return { root: colocated, source: "colocated" };
  }

  // The SAME `exists` the resolution used: a test that injects a filesystem
  // must get an answer about that filesystem, not about the real one.
  throw new BacklogNotFoundError(cwd, exists);
}

/**
 * "There is no backlog here" — a FORESEEN state with a name (TL-47).
 *
 * WHY A TYPE AND NOT A STRING. The documentation describes this state as by
 * design, and the presentation contradicted the design: a bare `Error` reaching
 * the top of a script prints a stack trace, which says "the tool crashed" to
 * somebody who has just installed it and run it from their home directory. That
 * is the first contact with the tool. A named type lets a caller tell this
 * apart from a genuine programmer error — which must still show its stack,
 * because silencing everything would be a worse cure than the disease.
 */
export class BacklogNotFoundError extends Error {
  constructor(cwd, exists = existsSync) {
    // WHICH HINT COMES FIRST IS DECIDED FROM CONTEXT. Somebody standing in a
    // repository with no backlog almost certainly wants to CREATE one; somebody
    // in a home directory almost certainly wants to point at one they already
    // have. The old message listed three ways to point and not one way to
    // create — and the person most likely to see it was in the second case.
    const looksLikeProject = exists(join(cwd, ".git")) || exists(join(cwd, "package.json"));
    const create = "`" + N + " init --dir <path>` creates one here";
    const point = "`--dir <path>`, `BACKLOG_DIR=<path>`, or run from a directory that has `backlog/tasks/`";
    super("no backlog here: " + resolve(cwd));
    this.name = "BacklogNotFoundError";
    this.cwd = resolve(cwd);
    this.details = looksLikeProject
      ? ["This looks like a project. " + create + ".",
         "To use one that already exists: " + point + "."]
      : ["To point at one you already have: " + point + ".",
         "To start a new one: " + create + "."];
  }
}

/**
 * The same resolution, but a foreseen absence EXITS instead of throwing.
 *
 * THE SAME SHAPE AS `loadConfigOrExit`, deliberately: a command that cannot
 * find its data has nothing left to do, and this is the established way that is
 * said here. The alternative considered was one `uncaughtException` handler
 * installed centrally — rejected because `cli.mjs` SPAWNS each command as a
 * child process with inherited stdio, so the exception is printed by the child
 * and a handler in the parent never sees it. A handler installed as an import
 * side effect would reach the child, and hiding a process-wide behaviour change
 * inside an import is worse than 10 call sites a test enforces.
 *
 * A GENUINE PROGRAMMER ERROR IS RE-THROWN, stack and all. Only the named type
 * is turned into a message.
 */
export function resolveBacklogDirOrExit(opts = {}, command = N) {
  try {
    return resolveBacklogDir(opts);
  } catch (e) {
    if (!(e instanceof BacklogNotFoundError)) throw e;
    console.error(failure(command, e.message, e.details));
    process.exit(1);
  }
}

/** A shortcut for scripts: returns the full set of paths at once. */
export function resolveBacklogPaths(opts = {}) {
  const resolved = resolveBacklogDir(opts);
  return { ...backlogPaths(resolved.root), source: resolved.source };
}

/**
 * Take `--dir <x>` out of argv (and return the rest). Kept here so that every
 * script accepts the flag identically and no variant with `--backlog`, `--path`
 * or anything else appears.
 *
 * THE SCAN STOPS AT `--`, and the separator plus everything after it is handed
 * on untouched (TL-247). `--` is this tool's one answer to "my value begins with
 * a dash" — TL-58 taught `new` to read it, TL-248 taught `plan add | move`, and
 * `foldAppendFlags()` and `wantsHelp()` in the dispatcher already honoured it.
 * This function did not, and it runs ABOVE every command: a word the command was
 * about to accept as a value was taken off the line before the command could see
 * it, the write went to whatever directory followed, and nothing was printed.
 * One command line read by two different grammars depending on which layer is
 * looking is the defect — the layer nearest the user does not get its own.
 *
 * `--dir A -- --dir B` IS DIRECTORY A. The first occurrence is the flag, the
 * second is text. There is no reading in which a word past the separator moves a
 * write, because that is the whole promise the separator makes.
 */
export function takeDirFlag(argv) {
  const rest = [];
  let dir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") {
      // The separator STAYS: the command below reads it too, and a value that
      // is a flag name is only distinguishable from a flag by its presence.
      rest.push(...argv.slice(i));
      break;
    }
    if (argv[i] === "--dir") {
      dir = argv[++i] || null;
      continue;
    }
    if (argv[i].startsWith("--dir=")) {
      dir = argv[i].slice(6);
      continue;
    }
    rest.push(argv[i]);
  }
  return { dir, argv: rest };
}

/**
 * Does this path name a task file, and if so which backlog does it belong to?
 * PURE — no filesystem access, so it is testable without a tree.
 *
 * WHY THIS EXISTS (TL-44). A guard handed explicit file paths used to judge
 * them with the prefix of whatever backlog it discovered from CWD. Same repo,
 * same answer — so nothing showed. Point it at another tree and it matched zero
 * files and printed "0 tasks, all fine": green with no evidentiary power at all.
 * A file names its own backlog; ask the file, not the working directory.
 *
 * @returns {{root: string} | null}
 */
export function backlogForTaskPath(filePath) {
  if (!filePath) return null;
  // The shape carries no prefix on purpose: we are recognising the DIRECTORY, so
  // we do not know its configuration yet. What counts as a task is decided by
  // the generator.
  if (!ANY_TASK_FILE.test(basename(filePath))) return null;
  const tasksDir = dirname(filePath);
  if (basename(tasksDir) !== "tasks") return null;
  return { root: dirname(tasksDir) };
}

/**
 * The repository a backlog belongs to — the tree its relative paths resolve
 * against, and where a repository-level file (`.claude/`, `README.md`) belongs.
 *
 * WHY IT IS NOT SIMPLY THE PARENT. A backlog may sit at any depth, and the
 * things anchored to it — a task's `related_docs`, a skill directory an editor
 * reads — are anchored to the REPOSITORY, not to the directory above the
 * backlog. Asking git is the only way to know which one that is.
 *
 * WITHOUT GIT IT FALLS BACK TO THE PARENT, deliberately, rather than refusing:
 * `init` runs before `git init` often enough that a refusal would make the
 * common first minute fail, and the parent is the right answer in the layout
 * `init` creates. The runner is injectable so both branches are testable.
 */
export function repositoryRoot(backlogRoot, opts = {}) {
  const run = opts.run || spawnSync;
  const r = run("git", ["-C", backlogRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const top = r && r.status === 0 ? String(r.stdout || "").trim() : "";
  return top || resolve(backlogRoot, "..");
}
