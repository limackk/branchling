#!/usr/bin/env node
/**
 * Whether git REALLY treats the backlog files the way it has to (TL-59, TL-62).
 *
 * WHY A MODULE OF ITS OWN. Two callers need the same answers for opposite
 * reasons: `init` asks in order to FIX the situation, `doctor` asks in order to
 * REPORT it and must not touch anything. Keeping the read-only questions here,
 * apart from the writing, is what makes that separation checkable rather than a
 * matter of discipline — `doctor` imports this file and nothing else can be
 * appended by accident.
 *
 * WHY WE ASK GIT AND NOT THE DISK. "Was a `.gitignore` created" and "is the rule
 * IN FORCE" are two different questions, and they come apart at exactly the
 * point where the TL-59 defect sat. Only git knows about `.git/info/exclude`,
 * about parent files, about negating entries, and about a file already being
 * tracked.
 */

import { spawnSync } from "node:child_process";

import { BLOCK_MARKER_NAME } from "./product.mjs";

/** The ignore rules for the views. DATA, not text — `init` writes the file from
 *  them and `doctor` checks against them, and one copy cannot drift from the
 *  other. */
export const IGNORE_RULES = [
  "INDEX.yaml",
  "NOW.yaml",
  "archive/done.yaml",
  "boards/*/INDEX.yaml",
  "boards/*/NOW.yaml",
  "viewer.html",
  "history/.snapshot.json",
  // The raw evidence of activity (TL-27). It is somebody's working calendar, and
  // one `git add -A` in a repository this tool was dropped into would put it in a
  // public history irreversibly. The per-task AGGREGATE under `activity/rollup/`
  // is deliberately NOT matched by this pattern and stays versioned.
  "activity/*.jsonl",
];

export const ATTRIBUTE_RULES = ["history/*.jsonl merge=union"];

/** Markers around the appended block — by them a second `init` recognises its
 *  own work. Built from the FROZEN marker name and not from `PRODUCT_NAME`,
 *  because they identify data already written into somebody else's repository;
 *  the reasoning is at `BLOCK_MARKER_NAME` in `product.mjs`. */
export const BLOCK_OPEN = `# >>> ${BLOCK_MARKER_NAME}`;
export const BLOCK_CLOSE = `# <<< ${BLOCK_MARKER_NAME}`;

/** Concrete paths for `git check-ignore`, which judges NAMES, not patterns.
 *  They do not have to exist on disk. */
export const VIEW_PATHS = [
  "INDEX.yaml",
  "NOW.yaml",
  "archive/done.yaml",
  "boards/main/INDEX.yaml",
  "viewer.html",
  "history/.snapshot.json",
  "activity/TASK-1.jsonl",
];

function git(root, args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000 });
}

export function insideGitRepo(root) {
  const r = git(root, ["rev-parse", "--is-inside-work-tree"]);
  return r.status === 0 && String(r.stdout).trim() === "true";
}

/** `check-ignore` exits zero when the path IS ignored. */
export function unignoredViews(root) {
  return VIEW_PATHS.filter((rel) => git(root, ["check-ignore", "-q", "--", rel]).status !== 0);
}

/** A tracked view is a state that ignore rules can no longer fix — passing over
 *  it in silence would turn a green "ignored" into a false "you are safe". */
export function trackedViews(root) {
  const r = git(root, ["ls-files", "--", ...VIEW_PATHS]);
  if (r.status !== 0) return [];
  return String(r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean);
}

export function hasUnionMerge(root) {
  const r = git(root, ["check-attr", "merge", "--", "history/probe.jsonl"]);
  return r.status === 0 && /merge:\s*union/.test(String(r.stdout || ""));
}
