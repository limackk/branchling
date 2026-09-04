#!/usr/bin/env node
/**
 * The next free task number — computed from ALL trees and branches, not from the
 * current directory.
 *
 * Why a separate script rather than `ls backlog/tasks | tail -1`:
 *
 * 1. **Parallelism.** Agent sessions work in separate worktrees. Each tree sees
 *    its own `tasks/`, so "highest + 1" in two sessions hands the same number to
 *    two different pieces of work. The collision exists in neither tree on its
 *    own — it comes into being in the union, at merge time. Four of them lived in
 *    `main` for months before a guard was added.
 * 2. **Gaps below the maximum are a trap, not a saving.** A number free in this
 *    tree is sometimes taken on a branch this tree does not have. That is why we
 *    always return `max + 1` over the union of all sources, never the first free
 *    gap.
 * 3. **A probe reading filtered output lies.** A real precedent: a block of
 *    numbers was once taken from a tool's numbered listing — somebody read the
 *    LINE numbers instead of the task numbers. This script reads filenames and
 *    `git ls-tree`, never a tool's formatted output.
 *
 * The sources of the union:
 *   - `tasks/` in THIS tree (including files not yet committed),
 *   - `tasks/` in every other worktree (`git worktree list`) — this catches tasks
 *     that exist only as an uncommitted file in somebody else's session,
 *   - `tasks/` on EVERY local branch (`git for-each-ref`).
 *
 * THE SCAN ITSELF IS NOT HERE. It lives in `branch-scan.mjs` (TL-73), because
 * reading task STATE needs the same question answered the same way — and two
 * copies would disagree about which branches exist, which is how one task gets
 * handed to two sessions.
 *
 * Usage:
 *   next-id            # -> 1134
 *   next-id --explain  # + where the maximum came from
 *   next-id --json     # the number and its provenance, in the shared envelope
 */

import { readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { backlogRelFor, localRefs, repoRootFor, taskEntriesInRef, worktreeRoots } from './branch-scan.mjs';
import { resolveBacklogDirOrExit, takeDirFlag } from './paths.mjs';
import { loadConfigOrExit } from './config.mjs';
import { insideGitRepo } from './git-rules.mjs';
import { taskIdPatterns } from './task-id.mjs';
import { printJson } from './json-envelope.mjs';
import { PRODUCT_NAME as N } from './product.mjs';

// The prefix comes from THIS backlog's configuration (BL-1452). The scan then
// goes across other branches and worktrees, but the pattern is one — otherwise
// `next-id` would be counting numbers from somebody else's namespace.
const OWN_ROOT = resolveBacklogDirOrExit({
  dir: takeDirFlag(process.argv.slice(2)).dir,
  moduleDir: dirname(fileURLToPath(import.meta.url)),
}, N + " next-id").root;
// STRICT (TL-60): this is OUR OWN configuration, not another branch's — the
// branch scan reads filenames, not their configurations.
const PAT = taskIdPatterns(loadConfigOrExit(OWN_ROOT).taskIdPrefix);
const ID_RE = new RegExp(PAT.fileNumber.source + "-");

/** Numbers from a given working tree's `tasks/` directory (untracked included). */
function fromWorkingTree(root) {
  const dir = join(root, BACKLOG_REL, 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => name.match(ID_RE))
    .filter(Boolean)
    .map((m) => Number(m[1]));
}

/** The numbers from `tasks/` in the tree named by a ref. */
function fromRef(root, ref) {
  return taskEntriesInRef(root, ref, BACKLOG_REL)
    .map((e) => e.name.match(ID_RE))
    .filter(Boolean)
    .map((m) => Number(m[1]));
}

// An unknown flag FAILS (BL-1417), BEFORE the branch scan — otherwise a typo
// would still return some number, just for the wrong reason.
{
  const KNOWN = new Set(['--explain', '--json', '--dir']);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      if (i > 0 && argv[i - 1] === '--dir') continue; // the value of --dir
      console.error(`${N} next-id: unexpected argument: ` + a);
      console.error('  available: --explain --json --dir <path>');
      process.exit(2);
    }
    if (!KNOWN.has(a)) {
      console.error(`${N} next-id: unknown flag: ` + a);
      console.error('  available: --explain --json --dir <path>');
      process.exit(2);
    }
  }
}

const root = repoRootFor(process.cwd()) || process.cwd();

// The backlog subdirectory INSIDE the repository — computed, not hardcoded
// (BL-1399). The script looks through other worktrees and branches, so it needs a
// path relative to their roots; `backlog` is only this repository's default.
//
// An empty string means "the backlog IS the repository root" — a valid relative
// path, not a missing one (BL-1418). Only `null`, which is a backlog OUTSIDE the
// repository, falls back to the default name.
const BACKLOG_REL = backlogRelFor(root, OWN_ROOT) ?? 'backlog';
const sources = new Map(); // number -> where from (the first source found)

const record = (numbers, label) => {
  for (const n of numbers) if (!sources.has(n)) sources.set(n, label);
};

for (const wt of worktreeRoots(root)) record(fromWorkingTree(wt), `worktree ${wt}`);
record(fromWorkingTree(root), 'this tree');
for (const ref of localRefs(root)) record(fromRef(root, ref), ref);

// The branch and worktree scan only works inside a git repository. A backlog
// named by `--dir` need not lie in one — and `next-id` promises "the next free
// number", not "the next free number, if you use git" (BL-1452). In that case its
// own directory is what is left: a narrower answer, but a true one.
if (sources.size === 0) {
  const own = join(OWN_ROOT, 'tasks');
  if (existsSync(own)) {
    record(
      readdirSync(own).map((n) => n.match(ID_RE)).filter(Boolean).map((m) => Number(m[1])),
      'this directory (outside git)'
    );
  }
  // The narrower source MUST say so — including when the directory is EMPTY and
  // the answer is 1. A number from a single directory may already be taken on
  // somebody else's branch, and staying silent would make it look exactly as
  // trustworthy as a number from a scan of every branch and worktree.
  //
  // BUT THE PREMISE IS THE ABSENCE OF A REPOSITORY, NOT AN EMPTY RESULT
  // (TL-66). An empty set of sources arises in two ways this condition used to
  // confuse: a directory outside git (an answer that really is narrower) and a
  // repository with a freshly created backlog (the scan swept every branch and
  // found nothing — a complete answer). The second case is the FIRST task of
  // every new user, and a warning that lies the first time teaches people to
  // ignore all the ones after it.
  if (!insideGitRepo(OWN_ROOT)) {
    console.error(`${N} next-id: a number from the LOCAL directory — the backlog is not in a git repository`);
    console.error('  I cannot see other branches or worktrees, so this number may be taken somewhere.');
  }
}

const numbers = [...sources.keys()];
const asJson = process.argv.includes('--json');

// An empty backlog is a valid state — the first task gets number 1. Until
// BL-1452 this path ended in an error, so `next-id` failed on a fresh `init`.
// In JSON it is the case that proves the emptiness rule: `max` and `source` are
// null, they are not missing.
const max = numbers.length ? Math.max(...numbers) : null;
const next = max === null ? 1 : max + 1;

if (asJson) {
  // A program gets the provenance WITHOUT having to ask a second time with
  // `--explain` and parse prose (TL-72).
  printJson('next-id', {
    nextId: next,
    id: `${PAT.prefix}-${next}`,
    prefix: PAT.prefix,
    max,
    source: max === null ? null : sources.get(max),
    trees: worktreeRoots(root).length,
    branches: localRefs(root).length,
    known: numbers.length,
  });
  process.exit(0);
}

if (process.argv.includes('--explain') && max !== null) {
  console.log(`maximum: ${PAT.prefix}-${max} (${sources.get(max)})`);
  console.log(`trees examined: ${worktreeRoots(root).length}, branches: ${localRefs(root).length}`);
  console.log(`unique numbers in the union: ${numbers.length}`);
}
// A STRING, NOT A NUMBER (TL-238). `console.log` hands a non-string to
// `util.inspect`, which paints numbers yellow whenever the runtime thinks colour
// is available — so the one value this command exists to print came out as
// `\x1b[33m8\x1b[39m` under `FORCE_COLOR`, and the caller substituting it into
// `$(…)` got escapes instead of a number. The formatting of an answer is this
// command's decision, not the runtime's.
console.log(String(next));
