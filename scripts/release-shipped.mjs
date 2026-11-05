/**
 * What a shipped release carried — read from the ref that marks it (TL-516).
 *
 * WHY. TL-505 bounded the "unplanned" list of `deploy status --release` to the
 * work still in the pipeline: what reached the last stage is the project's
 * whole history, and listing it would bury the answer. The price was that once
 * a release went out, the unplanned work that went with it disappeared from
 * the report. "What did 1.0 carry that nobody planned" needs to know where 1.0
 * ends, and that is a point a person names: `ref:` on its entry in `releases:`
 * (`scripts/release-entries.mjs`), typically its tag.
 *
 * THE RANGE. A release begins where the previous one ended: the ref of the
 * nearest EARLIER entry in `releases:` that names one (the list is
 * chronological, TL-515). An earlier entry without a ref is skipped rather than
 * read as "began at the root", which would hand that release's work to this
 * one; the first release with a ref begins at the root. The commits a release
 * carried are those reachable from its ref and not from where it began —
 * `git log --cherry-pick --right-only <begin>...<end>`, so a fix picked onto the
 * previous release's branch and later merged normally is not carried twice
 * (patch identity, as in `docs/release-tracking.md` §5).
 *
 * WHETHER A PLANNED TASK SHIPPED is judged against the end alone: every trunk
 * commit naming it is held by the ref — reachable from it, or an equivalent
 * patch is (`git cherry <end> <trunk>`) — or, for a task with no trunk commit,
 * the release itself carried a commit naming it (a fix made on a release
 * branch). Where the range begins does not matter for this: a planned task that
 * an earlier release already carried has shipped by this one too.
 *
 * UNKNOWN IS NEVER EMPTY. An end that does not resolve leaves the whole
 * shipment unknown; a beginning that does not resolve leaves the range unknown
 * while the planned half is still judged, since it reads only the end.
 *
 * COST. Only entries with a ref are read: one resolution per ref, one
 * `git cherry` and one `git log` per release with a ref, and the trunk log only
 * when the caller has not read it already. A project without a ref pays
 * nothing.
 *
 * Tests: `node --test scripts/tests/release-shipped-scope.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { parseCherry, parseTrunkLog, resolveRef, trunkLogArgs } from "./environments.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { taskIdScanner } from "./task-id.mjs";

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

function git(run, root, args) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, env: gitDiscoveryEnv(),
  });
}

/** The `git log` of the commits a release carried. `begin` null is the root. */
export function rangeLogArgs(begin, end) {
  const format = "--format=" + RS + "%H" + US + "%B" + US;
  if (begin === null) return ["log", "--no-merges", "--name-only", format, end, "--"];
  return ["log", "--no-merges", "--cherry-pick", "--right-only", "--name-only", format, begin + "..." + end, "--"];
}

/**
 * The shipment of every entry of `releases:` that names a ref.
 *
 * @param {object} opts
 * @param {string|null} opts.root  the repository root
 * @param {string} opts.prefix  the task id prefix from config.yaml
 * @param {readonly {name: string, ref: string|null}[]} opts.entries  `releaseEntriesOf(config)`
 * @param {string|null} opts.trunkSha  the resolved trunk, or null
 * @param {{sha: string, ids: string[], files: string[]}[]|null} [opts.trunkCommits]
 *   the trunk log when the caller already read it (`state.commits`)
 * @returns {Map<string, {
 *   release: string, ref: string, sha: string|null, status: "resolved"|"unknown", why: string|null,
 *   since: {release: string, ref: string, sha: string|null, status: string, why: string|null}|null,
 *   rangeKnown: boolean,
 *   range: {sha: string, ids: string[], files: string[]}[],
 *   trunkByTask: Map<string, {sha: string, files: string[]}[]>,
 *   missing: Set<string>,
 * }>}
 */
export function readShipments({ root, prefix, entries, trunkSha, trunkCommits = null, run = spawnSync }) {
  const out = new Map();
  const marked = (entries || []).filter((e) => e.ref);
  if (!marked.length) return out;
  const scanner = taskIdScanner(prefix);
  const resolved = new Map();
  const resolve = (spec) => {
    if (!resolved.has(spec)) {
      resolved.set(spec, root ? resolveRef({ root, spec, run })
        : { spec, ref: null, sha: null, status: "unknown", why: "not inside a git repository" });
    }
    return resolved.get(spec);
  };

  // Trunk commits per task, read once for every release.
  let trunk = trunkCommits;
  if (!trunk) {
    trunk = [];
    if (root && trunkSha) {
      const log = git(run, root, trunkLogArgs(trunkSha));
      if (log.status === 0) trunk = parseTrunkLog(log.stdout, scanner);
    }
  }
  const trunkByTask = new Map();
  for (const c of trunk) {
    for (const id of c.ids) {
      if (!trunkByTask.has(id)) trunkByTask.set(id, []);
      trunkByTask.get(id).push({ sha: c.sha, files: c.files });
    }
  }

  let previous = null;
  for (const e of entries) {
    if (!e.ref) continue;
    const end = resolve(e.ref);
    const begin = previous ? resolve(previous.ref) : null;
    const shipment = {
      release: e.name, ref: e.ref, sha: end.sha, status: end.status, why: end.why,
      since: previous ? { release: previous.name, ref: previous.ref, sha: begin.sha, status: begin.status, why: begin.why } : null,
      rangeKnown: false, range: [], trunkByTask, missing: new Set(),
    };
    previous = e;
    out.set(e.name, shipment);
    if (!end.sha) continue;
    if (trunkSha) {
      const ch = git(run, root, ["cherry", end.sha, trunkSha]);
      if (ch.status !== 0) { shipment.status = "unknown"; shipment.why = "git failed while comparing it with the trunk"; continue; }
      shipment.missing = parseCherry(ch.stdout);
    }
    if (begin && !begin.sha) continue;
    const log = git(run, root, rangeLogArgs(begin ? begin.sha : null, end.sha));
    if (log.status !== 0) continue;
    shipment.range = parseTrunkLog(log.stdout, scanner);
    shipment.rangeKnown = true;
  }
  return out;
}
