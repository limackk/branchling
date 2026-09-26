#!/usr/bin/env node
/**
 * `hooks print|install|uninstall` — the moment somebody actually runs the gates
 * (TL-46).
 *
 * WHAT WAS MISSING. The guards already ship with every installation: they live
 * in `scripts/`, `package.json` lists them under `files`, and `check` exposes
 * them. What has no answer is WHEN they run — today, whenever somebody
 * remembers. A hook in a consumer's repository is their own file, and a hook
 * committed here would not travel in the package, so neither of those solves
 * the user's problem. What was missing is a command.
 *
 * WHY THIS IS A DECISION AND NOT A GIVEN. A tool that writes into a stranger's
 * `.git/` does something unexpected, and three traps have already caught
 * somebody:
 *
 *   1. OVERWRITING SOMEONE ELSE'S HOOK. Repositories have their own
 *      `pre-commit` — husky, lefthook, pre-commit.com. Forcing our way in
 *      erases a gate somebody was relying on.
 *   2. `core.hooksPath` ALREADY SET. Then `.git/hooks/` is dead, and a silent
 *      write there does not work AND does not say so — the worst outcome of the
 *      three, because the user believes they have a gate.
 *   3. NO WAY BACK. An install with no `uninstall` is one somebody removes by
 *      hand, learning distrust on the way.
 *
 * THE ANSWER TO ALL THREE IS THE SAME SHAPE: `print` is the default and the
 * command never writes unless asked; `install` refuses rather than merges when
 * a hook already exists; and what it writes is fenced by the same markers
 * `init` uses in a `.gitignore`, so `uninstall` removes EXACTLY what was
 * installed and nothing that was there before.
 *
 * IT IS ITS OWN COMMAND, NOT A FLAG ON `init`. `init` creates a backlog in an
 * empty directory; a hook concerns a repository that already exists. Those are
 * two different moments in somebody's life, and a flag would tie the second to
 * the first.
 *
 * Exit: 0 done (including `print`) · 1 refused, with the reason · 2 the
 * invocation was wrong.
 *
 * Tests: `node --test scripts/tests/hooks-install.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BLOCK_CLOSE, BLOCK_OPEN } from "./git-rules.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { takeDirFlag } from "./paths.mjs";
import { MARK, color, failure, heading, refusal } from "./ui.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUBCOMMANDS = ["print", "install", "uninstall"];
const FLAGS = ["--json", "--dir"];

/** The task-set gate keeps the old export for callers that name it directly. */
export const HOOK_NAME = "pre-commit";
/** Git gives this hook the final message file, before the commit exists. */
export const COMMIT_MESSAGE_HOOK_NAME = "commit-msg";
export const HOOK_NAMES = [HOOK_NAME, COMMIT_MESSAGE_HOOK_NAME];

/**
 * The lines written into the hook. PURE, so the test asserts on the same text
 * the command writes rather than on a description of it.
 *
 * `|| exit 1` and not a captured status: a gate that swallows a failure is
 * worse than no gate, and the whole point of the block is that a commit stops.
 */
export function hookBlock(name = HOOK_NAME, command = N) {
  const gate = name === COMMIT_MESSAGE_HOOK_NAME
    ? command + ' commit-message "$1" || exit 1'
    : command + " check || exit 1";
  return [
    BLOCK_OPEN,
    "# Installed by `" + command + " hooks install`. Remove with `" + command + " hooks uninstall`,",
    "# or delete these lines — nothing outside the markers belongs to it.",
    gate,
    BLOCK_CLOSE,
  ].join("\n");
}

/** A fresh hook file, when there was none. */
export function hookFile(name = HOOK_NAME, command = N) {
  return "#!/bin/sh\n" + hookBlock(name, command) + "\n";
}

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
}

/**
 * Where git would actually look for hooks — and whether it is a place we may
 * write.
 *
 * `core.hooksPath` IS THE TRAP THIS FUNCTION EXISTS FOR. When it is set,
 * `.git/hooks/` is dead: a file written there is never run, and nothing says
 * so. The user then believes they have a gate. So the path is ASKED OF GIT
 * rather than assumed, and when it points somewhere managed by another tool the
 * command refuses instead of writing into a directory whose owner has its own
 * ideas.
 */
export function hooksTarget(root, name = HOOK_NAME) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || String(inside.stdout).trim() !== "true") {
    return { ok: false, kind: "not-a-repository",
      message: "this is not a git repository: " + resolve(root),
      details: ["A hook needs a repository. `git init` first, or point `--dir` at one."] };
  }
  // ASKED OF GIT, NEVER ASSEMBLED HERE. `git rev-parse --git-path hooks` is the
  // one answer that is right in every layout: it honours `core.hooksPath`, and
  // in a WORKTREE it returns the common directory rather than the worktree's own
  // `.git/worktrees/<name>/hooks`, which git never reads. Building the path from
  // `--absolute-git-dir` looks correct and installs a hook into a directory
  // nothing runs — trap 2, arrived at from a different direction.
  const path = git(root, ["rev-parse", "--git-path", "hooks"]);
  if (path.status !== 0) {
    return { ok: false, kind: "no-git-dir", message: "git could not name its hooks directory",
      details: [String(path.stderr || "").trim()] };
  }
  const configured = git(root, ["config", "--get", "core.hooksPath"]);
  const custom = configured.status === 0 ? String(configured.stdout).trim() : "";
  const dir = resolve(root, String(path.stdout).trim());
  return { ok: true, name, dir, path: join(dir, name), custom: custom || null };
}

/** What is already there, in the terms this command has to decide by. */
export function inspect(target) {
  if (!existsSync(target.path)) return { state: "absent", text: null };
  const text = readFileSync(target.path, "utf8");
  if (text.includes(BLOCK_OPEN)) return { state: "ours", text };
  return { state: "foreign", text };
}

/** Remove the block and the shebang line it brought, leaving everything else
 *  byte for byte. PURE. */
export function withoutBlock(text) {
  const lines = String(text).split("\n");
  const open = lines.findIndex((l) => l.trim() === BLOCK_OPEN);
  if (open < 0) return { text, removed: false };
  let close = open;
  while (close < lines.length && lines[close].trim() !== BLOCK_CLOSE) close++;
  if (close >= lines.length) return { text, removed: false };
  lines.splice(open, close - open + 1);
  return { text: lines.join("\n"), removed: true };
}

function renderTarget(target) {
  const out = [];
  out.push("  " + MARK.bullet + " git reads hooks from: " + target.dir);
  if (target.custom) {
    // NOT A REFUSAL, A STATEMENT. The path is somebody's deliberate choice —
    // often another hook manager's — and writing into it is legitimate as long
    // as the person is told whose directory it is. What would NOT be legitimate
    // is writing to `.git/hooks/` while this is set, which is why the path came
    // from git rather than from us.
    out.push("  " + MARK.warn + " `core.hooksPath` is set to `" + target.custom +
      "` — that is where this goes, and `.git/hooks/` is dead here.");
  }
  return out;
}

function runPrint(root, plan) {
  const targets = HOOK_NAMES.map((name) => hooksTarget(root, name));
  if (plan.json) {
    console.log(JSON.stringify({ hooks: targets.map((target) => ({
      hook: target.name, block: hookBlock(target.name), target: target.ok ? target : null,
      error: target.ok ? null : target.message,
    })) }, null, 2));
    return 0;
  }
  console.log(heading("the Git gates"));
  for (const target of targets) {
    console.log("");
    console.log("  " + target.name);
    console.log(hookBlock(target.name).split("\n").map((l) => "    " + l).join("\n"));
    if (target.ok) for (const line of renderTarget(target)) console.log(line);
    else console.log("  " + MARK.bullet + " " + target.message);
  }
  console.log("");
  // PRINTING IS THE DEFAULT ON PURPOSE. It solves most of the problem for none
  // of the risk, and it leaves the decision to write in somebody's `.git/` with
  // the person who owns it.
  console.log("  " + color.dim("Paste it yourself, or run `" + N + " hooks install`. Nothing was written."));
  return 0;
}

function runInstall(root, plan) {
  const targets = HOOK_NAMES.map((name) => hooksTarget(root, name));
  const unusable = targets.find((target) => !target.ok);
  if (unusable) {
    console.error(failure(N + " hooks install", unusable.message, unusable.details || []));
    return 1;
  }
  const found = targets.map((target) => ({ target, found: inspect(target) }));
  const foreign = found.find((entry) => entry.found.state === "foreign");

  if (foreign) {
    // REFUSED, NOT MERGED. Appending to somebody else's hook means guessing
    // where in their gate ours belongs and what their `exit` does to it. The
    // block is printed instead, so the choice stays with the person who wrote
    // the file.
    console.error(failure(N + " hooks install",
      "there is already a " + foreign.target.name + " hook here", [
        foreign.target.path,
        "",
        "It was not touched. Add this yourself where it belongs in your gate:",
        ...hookBlock(foreign.target.name).split("\n"),
      ], [N + " hooks print"]));
    return 1;
  }

  for (const entry of found) {
    if (entry.found.state === "ours") continue;
    if (!existsSync(entry.target.dir)) mkdirSync(entry.target.dir, { recursive: true });
    writeFileSync(entry.target.path, hookFile(entry.target.name), "utf8");
    chmodSync(entry.target.path, 0o755);
  }
  if (plan.json) {
    console.log(JSON.stringify({ installed: true, hooks: found.map((entry) => ({
      hook: entry.target.name, path: entry.target.path, installed: entry.found.state !== "ours",
    })), custom: targets[0].custom }, null, 2));
    return 0;
  }
  for (const entry of found) {
    const line = entry.found.state === "ours"
      ? color.dim(MARK.bullet + " already installed — " + entry.target.path)
      : color.ok(MARK.ok) + " " + entry.target.name + " installed — " + entry.target.path;
    console.log(line);
  }
  for (const line of renderTarget(targets[0])) console.log(line);
  console.log("  " + color.dim("`" + N + " hooks uninstall` removes exactly these lines."));
  return 0;
}

function runUninstall(root, plan) {
  const targets = HOOK_NAMES.map((name) => hooksTarget(root, name));
  const unusable = targets.find((target) => !target.ok);
  if (unusable) {
    console.error(failure(N + " hooks uninstall", unusable.message, unusable.details || []));
    return 1;
  }
  const found = targets.map((target) => ({ target, found: inspect(target) }));
  const foreign = found.find((entry) => entry.found.state === "foreign");
  if (foreign) {
    console.error(failure(N + " hooks uninstall",
      "the " + foreign.target.name + " hook here is not ours", [
        foreign.target.path,
        "It carries no `" + BLOCK_OPEN + "` marker, so removing it would be deleting",
        "somebody else's gate. Nothing was changed.",
      ]));
    return 1;
  }
  const ours = found.filter((entry) => entry.found.state === "ours");
  if (!ours.length) {
    console.log(color.dim(MARK.bullet + " nothing installed here — " + targets.map((target) => target.path).join(", ")));
    return 0;
  }
  const removed = [];
  for (const entry of ours) {
    const stripped = withoutBlock(entry.found.text);
    const remains = stripped.text.replace(/^#!.*\n?/, "").trim();
    if (!remains) rmSync(entry.target.path, { force: true });
    else writeFileSync(entry.target.path, stripped.text, "utf8");
    removed.push({ target: entry.target, remains });
  }

  if (plan.json) {
    console.log(JSON.stringify({ removed: true, hooks: removed.map((entry) => ({
      hook: entry.target.name, path: entry.target.path, fileDeleted: !entry.remains,
    })) }, null, 2));
    return 0;
  }
  for (const entry of removed) {
    console.log(color.ok(MARK.ok) + " " + entry.target.name + " removed — " +
      (entry.remains ? "the rest of " + entry.target.path + " is untouched" : entry.target.path + " is gone; it held nothing else"));
  }
  return 0;
}

export function main(argv) {
  const sub = argv[0];
  if (SUBCOMMANDS.indexOf(sub) < 0) {
    console.error(refusal(N + " hooks", sub ? "unknown subcommand: " + sub : "no subcommand",
      SUBCOMMANDS.join(", ")));
    return 2;
  }
  const cli = takeDirFlag(argv.slice(1));
  const plan = { json: false };
  for (const a of cli.argv) {
    if (a === "--json") { plan.json = true; continue; }
    console.error(refusal(N + " hooks " + sub, "unknown flag: " + a, FLAGS.join(" ")));
    return 2;
  }
  const root = cli.dir ? resolve(cli.dir) : process.cwd();
  if (sub === "print") return runPrint(root, plan);
  if (sub === "install") return runInstall(root, plan);
  return runUninstall(root, plan);
}

if (process.argv[1] && process.argv[1].endsWith("hooks-command.mjs")) {
  process.exitCode = main(process.argv.slice(2));
}
