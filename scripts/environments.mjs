/**
 * Which environment a task has reached — COMPUTED from git, never typed (TL-501).
 *
 * WHAT IT ANSWERS. For every task and every deploy target its commits touched,
 * which of the target's stages hold ALL of those commits (`full`), which hold
 * some (`partial`), which hold none (`absent`), and which cannot be judged
 * because a ref did not resolve (`unknown`). The targets and stages come from
 * `deploy_targets:` in config.yaml (`scripts/deploy-targets.mjs`); the design
 * is `docs/release-tracking.md`.
 *
 * WHY COMPUTED. A hand-maintained `environment:` field would be Law 2's failure
 * mode exactly: a rollback never updates it, and the stale value reads like a
 * fact. A ref moved back removes tasks from a stage here without anybody
 * editing anything.
 *
 * HOW A COMMIT BELONGS TO A TASK. The task id in its message — anywhere in it —
 * read with the scanner from `scripts/task-id.mjs`, the same link
 * `scripts/modified-files.mjs` (TL-75) reads.
 *
 * ONLY COMMITS REACHABLE FROM THE TRUNK COUNT. The trunk is `HEAD` unless the
 * caller names another ref: in the main checkout that is the trunk itself,
 * and in a feature branch it is the honest answer for that branch — commits
 * that exist only there are deployed nowhere. Branch commits that a squash
 * merge never brought to the trunk are not reachable from it and are ignored,
 * so a squash merge, a merge commit and a rebase give the same answer. Merge
 * commits themselves are skipped: they introduce no change of their own.
 *
 * HOW A COMMIT IS JUDGED IN A STAGE. One `git cherry <ref> <trunk>` per
 * resolved ref lists the trunk commits the ref does not contain, marking with
 * `-` those whose PATCH it contains anyway. So a commit is in a ref when it is
 * reachable from it, or when an equivalent patch is — a hotfix cherry-picked
 * onto a production branch is seen there, whatever its SHA.
 *
 * A REF THAT DOES NOT RESOLVE IS UNKNOWN, NEVER EMPTY. An unresolvable
 * production ref must not read as "nothing is deployed".
 *
 * THE ANSWER IS ONLY AS FRESH AS THE REFS IT READ, so every resolved ref is
 * reported with its SHA (`refs`), and a report built on this module names them.
 *
 * A TARGET IN ANOTHER REPOSITORY (`repository:`, TL-507) is not read at all:
 * its commits are not in this git and its refs would resolve in the wrong
 * repository. Only the targets `observedTargets()` keeps are scanned, and a
 * project whose every target lives elsewhere gets the reason
 * `only-external-targets`, never `no-targets` — it declared targets, and saying
 * otherwise would be false.
 *
 * THE API, for the tasks built on it (TL-502 to TL-508):
 *   deploymentState(opts)          the whole computation, one pass
 *   taskDeployment(state, id)      one task's answer, empty when it has no commits
 *   stageMatches(task, selector, away)  `full` / `not-full` / `unknown` / `none` /
 *                                  `unobservable` for `--env`
 *   parseStageSelector(text, targets)  `stage` or `target/stage`, validated
 *   explain(reason)                why an empty answer is empty
 *   defaultTrunk(root)             the remote's default branch, else `HEAD`
 *
 * Tests: `node --test scripts/tests/environments.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { isGlob, observedTargets, pathInTarget } from "./deploy-targets.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { taskIdScanner } from "./task-id.mjs";

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

/** The per-stage and per-ref states. */
export const STATES = Object.freeze(["full", "partial", "absent", "unknown"]);

function git(run, root, args) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, env: gitDiscoveryEnv(),
  });
}

/** The `git log` invocation for the trunk's commits. Separate so a test can
 *  assert the arguments. */
export function trunkLogArgs(trunk) {
  return ["log", "--no-merges", "--name-only", "--format=" + RS + "%H" + US + "%B" + US, trunk, "--"];
}

/**
 * PURE — parses one `trunkLogArgs()` run.
 *
 * @returns {{sha: string, ids: string[], files: string[]}[]} newest first
 */
export function parseTrunkLog(text, scanner) {
  const commits = [];
  for (const record of String(text || "").split(RS)) {
    if (!record.trim()) continue;
    const a = record.indexOf(US);
    const b = a < 0 ? -1 : record.indexOf(US, a + 1);
    if (b < 0) continue;
    const sha = record.slice(0, a).trim();
    const message = record.slice(a + 1, b);
    const files = record.slice(b + 1).split("\n").map((l) => l.trim()).filter(Boolean);
    const ids = new Set();
    scanner.lastIndex = 0;
    for (const m of message.matchAll(scanner)) ids.add(m[1]);
    commits.push({ sha, ids: [...ids], files });
  }
  return commits;
}

/**
 * PURE — parses `git cherry` output into the commits the ref does NOT hold.
 * `+` is a commit with no equivalent in the ref; `-` is one whose patch the ref
 * already carries, so it is held by patch identity and is not listed.
 */
export function parseCherry(text) {
  const missing = new Set();
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\+\s+([0-9a-f]{7,})/);
    if (m) missing.add(m[1]);
  }
  return missing;
}

/**
 * Resolves one ref spec: a ref name, or a `refs/…` glob resolved to the newest
 * match by version sort.
 *
 * @returns {{spec: string, ref: string|null, sha: string|null, status: "resolved"|"unknown", why: string|null}}
 */
export function resolveRef({ root, spec, run = spawnSync }) {
  let name = spec;
  if (isGlob(spec)) {
    const r = git(run, root, ["for-each-ref", "--sort=-version:refname", "--format=%(refname)", spec]);
    const first = r.status === 0 ? String(r.stdout || "").split("\n").map((l) => l.trim()).find(Boolean) : null;
    if (!first) return { spec, ref: null, sha: null, status: "unknown", why: "no ref matches the pattern" };
    name = first;
  }
  const r = git(run, root, ["rev-parse", "--verify", "--quiet", name + "^{commit}"]);
  const sha = r.status === 0 ? String(r.stdout || "").trim() : "";
  if (!sha) return { spec, ref: name === spec ? null : name, sha: null, status: "unknown", why: "the ref does not resolve to a commit" };
  return { spec, ref: name, sha, status: "resolved", why: null };
}

/**
 * The trunk a repository-wide question should be asked against: the remote's
 * default branch when the clone knows it, otherwise `HEAD`.
 *
 * WHY NOT `HEAD` ALONE. `deploymentState()` defaults to `HEAD`, which is right
 * for "what has THIS branch reached" and wrong for "was this finished work ever
 * merged": run on a feature branch, `HEAD` holds that branch's own commits, so
 * a task closed there and never merged would read as being on the trunk. The
 * remote default is what a clone records as the line everybody merges into.
 * `source` says which one was used, because a report built on a fallback has
 * to be able to say so.
 *
 * @returns {{spec: string, source: "remote-default"|"head"}}
 */
export function defaultTrunk(root, run = spawnSync) {
  if (root) {
    const r = git(run, root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    const spec = r && r.status === 0 ? String(r.stdout || "").trim() : "";
    if (spec) return { spec, source: "remote-default" };
  }
  return { spec: "HEAD", source: "head" };
}

/**
 * How a reader names where its trunk came from, keyed by `defaultTrunk().source`.
 * One wording, so two commands reporting the same trunk cannot describe it
 * differently.
 */
export const TRUNK_SOURCE_TEXT = Object.freeze({
  "remote-default": "the remote's default branch",
  head: "HEAD — this clone has no `origin/HEAD`",
});

function combine(states) {
  if (states.some((s) => s === "unknown")) return "unknown";
  if (states.every((s) => s === "full")) return "full";
  if (states.every((s) => s === "absent")) return "absent";
  return "partial";
}

/**
 * The whole computation, in one pass: one `git log` over the trunk, one
 * resolution per ref, one `git cherry` per resolved ref.
 *
 * @param {object} opts
 * @param {string|null} opts.root the repository root (`repoRoot()` from modified-files.mjs)
 * @param {string} opts.prefix the task id prefix from config.yaml
 * @param {readonly object[]} opts.targets `config.deployTargets`
 * @param {string} [opts.trunk] the ref whose commits count; `HEAD` by default
 * @returns {{
 *   scanned: boolean,
 *   reason: "ok"|"no-targets"|"only-external-targets"|"no-git"|"no-trunk"|"git-failed"|"no-task-ids-in-commits",
 *   trunk: {spec: string, sha: string|null},
 *   refs: {target: string, stage: string, spec: string, ref: string|null, sha: string|null,
 *          status: "resolved"|"unknown", why: string|null}[],
 *   unknownRefs: object[],
 *   commits: {sha: string, ids: string[], files: string[], targets: string[]}[],
 *   missing: Map<string, Set<string>>,
 *   byTask: Map<string, object>,
 * }}
 *   `missing` maps a resolved ref's SHA to the trunk commits it does not hold,
 *   so a reader can judge commits that name no task without another pass.
 */
export function deploymentState({ root, prefix, targets: declared, trunk = "HEAD", run = spawnSync }) {
  const empty = (reason, extra = {}) => ({
    scanned: false, reason, trunk: { spec: trunk, sha: null }, refs: [], unknownRefs: [],
    commits: [], missing: new Map(), byTask: new Map(), ...extra,
  });
  if (!declared || !declared.length) return empty("no-targets");
  const targets = observedTargets(declared);
  if (!targets.length) return empty("only-external-targets");
  if (!root) return empty("no-git");

  const head = git(run, root, ["rev-parse", "--verify", "--quiet", trunk + "^{commit}"]);
  const trunkSha = head.status === 0 ? String(head.stdout || "").trim() : "";
  // A repository with no commits yet has no trunk, and nothing in it can be
  // deployed; that is a state to name, not a failure.
  if (!trunkSha) return empty("no-trunk");

  const log = git(run, root, trunkLogArgs(trunkSha));
  if (log.status !== 0) return empty("git-failed", { trunk: { spec: trunk, sha: trunkSha } });
  const commits = parseTrunkLog(log.stdout, taskIdScanner(prefix));
  for (const c of commits) {
    c.targets = targets.filter((t) => c.files.some((f) => pathInTarget(t, f))).map((t) => t.name);
  }

  // Each distinct spec is resolved once, and each distinct SHA cherried once:
  // two stages naming the same branch must not double the cost.
  const resolved = new Map();
  const missing = new Map();
  const refs = [];
  for (const t of targets) {
    for (const s of t.stages) {
      for (const spec of s.refs) {
        if (!resolved.has(spec)) resolved.set(spec, resolveRef({ root, spec, run }));
        const r = resolved.get(spec);
        refs.push({ target: t.name, stage: s.name, ...r });
        if (r.sha && !missing.has(r.sha)) {
          const ch = git(run, root, ["cherry", r.sha, trunkSha]);
          if (ch.status !== 0) return empty("git-failed", { trunk: { spec: trunk, sha: trunkSha } });
          missing.set(r.sha, parseCherry(ch.stdout));
        }
      }
    }
  }

  const byTask = new Map();
  const tasked = commits.filter((c) => c.ids.length);
  const allIds = new Set(tasked.flatMap((c) => c.ids));
  for (const id of allIds) {
    const own = tasked.filter((c) => c.ids.indexOf(id) >= 0);
    const entry = { id, commits: own.map((c) => c.sha), targets: [], untargeted: [] };
    for (const c of own) if (!c.targets.length && c.files.length) entry.untargeted.push(c.sha);
    for (const t of targets) {
      const tc = own.filter((c) => c.targets.indexOf(t.name) >= 0);
      if (!tc.length) continue;
      const stages = t.stages.map((s) => {
        const refStates = s.refs.map((spec) => {
          const r = resolved.get(spec);
          if (!r.sha) return { spec, ref: r.ref, sha: null, state: "unknown", held: null, of: tc.length };
          const gone = missing.get(r.sha);
          const held = tc.filter((c) => !gone.has(c.sha)).length;
          const state = held === tc.length ? "full" : held === 0 ? "absent" : "partial";
          return { spec, ref: r.ref, sha: r.sha, state, held, of: tc.length };
        });
        return {
          stage: s.name,
          state: combine(refStates.map((r) => r.state)),
          // Which parallel refs hold the task in full — "production" while one
          // region still runs the old code is the gap this exists to show.
          holding: refStates.filter((r) => r.state === "full").map((r) => r.spec),
          refs: refStates,
        };
      });
      const full = stages.filter((s) => s.state === "full");
      entry.targets.push({
        target: t.name,
        commits: tc.map((c) => c.sha),
        stages,
        reached: full.length ? full[full.length - 1].stage : null,
      });
    }
    byTask.set(id, entry);
  }

  const unknownRefs = refs.filter((r) => r.status === "unknown");
  return {
    scanned: true,
    reason: allIds.size ? "ok" : "no-task-ids-in-commits",
    trunk: { spec: trunk, sha: trunkSha },
    refs,
    unknownRefs,
    commits,
    missing,
    byTask,
  };
}

/** One task's answer. A task with no commits on the trunk gets an empty entry,
 *  never a missing one — "no commits" and "not deployed" are different facts. */
export function taskDeployment(state, id) {
  return state.byTask.get(id) || { id, commits: [], targets: [], untargeted: [] };
}

/**
 * `stage` or `target/stage`, as typed after `--env`. An unknown name FAILS:
 * zero matches caused by a typo read exactly like an answer.
 *
 * @returns {{ok: true, target: string|null, stage: string} |
 *   {ok: false, message: string, unknown: {flag: string, value: string, declared: string[]}}}
 */
export function parseStageSelector(text, targets) {
  const raw = String(text || "").trim();
  const cut = raw.indexOf("/");
  const target = cut >= 0 ? raw.slice(0, cut) : null;
  const stage = cut >= 0 ? raw.slice(cut + 1) : raw;
  const known = [];
  for (const t of targets || []) for (const s of t.stages) known.push(t.name + "/" + s.name);
  const stageNames = [...new Set((targets || []).flatMap((t) => t.stages.map((s) => s.name)))];
  // `unknown` travels beside the sentence (TL-533): a caller answering in JSON
  // names the rejected value and what it could have been without parsing it.
  const unknown = { flag: "--env", value: raw, declared: stageNames.concat(known) };
  if (!targets || !targets.length) {
    return { ok: false, message: "this project declares no `deploy_targets` in config.yaml, so it has no stage `" + raw + "`", unknown };
  }
  if (target !== null) {
    if (known.indexOf(raw) < 0) return { ok: false, message: "`" + raw + "` is not a declared stage (declared: " + known.join(", ") + ")", unknown };
    return { ok: true, target, stage };
  }
  if (stageNames.indexOf(stage) < 0) {
    return { ok: false, message: "`" + raw + "` is not a declared stage (declared: " + stageNames.join(", ") + ", or target/stage: " + known.join(", ") + ")", unknown };
  }
  return { ok: true, target: null, stage };
}

/**
 * How one task stands against a selector.
 *
 * - `none`      the task touched no target that declares the stage — it has
 *               nothing to deploy there, so it is neither in nor out
 * - `unknown`   a ref the answer depends on did not resolve
 * - `full`      every selected target of the task holds it in that stage in full
 * - `not-full`  at least one holds it partially or not at all
 * - `unobservable`  the task belongs to a target in another repository
 *               (`away`, from `externalTargetsOf()`, TL-507), the selector
 *               names no target, and what this repository holds of the task
 *               is either nothing or the stage in full (TL-512)
 *
 * WHY `full` TURNS INTO `unobservable` and `not-full` does not. A stage typed
 * without a target asks about every target the task belongs to, and the half
 * in the other repository cannot be read: "in production" would be a claim
 * about code nobody looked at — `deploy status` refuses to call such a task
 * shipped for the same reason. A half here that is NOT in the stage settles
 * the answer whatever the other half holds, so it stays `not-full`. A selector
 * naming a target of this repository asks about that target alone, and the
 * other repository has nothing to say about it.
 */
export function stageMatches(task, selector, away = []) {
  const relevant = task.targets
    .filter((t) => selector.target === null || t.target === selector.target)
    .map((t) => t.stages.find((s) => s.stage === selector.stage))
    .filter(Boolean);
  const unobservable = selector.target === null && away.length > 0;
  if (!relevant.length) return unobservable ? "unobservable" : "none";
  if (relevant.some((s) => s.state === "unknown")) return "unknown";
  if (relevant.every((s) => s.state === "full")) return unobservable ? "unobservable" : "full";
  return "not-full";
}

/**
 * The answer as data: plain JSON, for `query --json` and every report.
 *
 * `unobservable` names the targets in another repository the task belongs to
 * (`away`, from `externalTargetsOf()`), always present and `[]` for a task of
 * none: without it, a task implemented elsewhere reads `commits: 0, targets:
 * []`, which is exactly what "never started, deployed nowhere" looks like.
 */
export function taskDeploymentJson(task, away = []) {
  return {
    commits: task.commits.length,
    untargeted: task.untargeted.length,
    unobservable: away.map((t) => ({ target: t.name, repository: t.repository })),
    targets: task.targets.map((t) => ({
      target: t.target,
      commits: t.commits.length,
      reached: t.reached,
      stages: t.stages.map((s) => ({
        stage: s.stage,
        state: s.state,
        holding: s.holding,
        refs: s.refs.map((r) => ({ spec: r.spec, ref: r.ref, sha: r.sha, state: r.state, held: r.held, of: r.of })),
      })),
    })),
  };
}

/** The scan itself as data: whether it ran, and every ref it read. */
export function deploymentScanJson(state) {
  return {
    scanned: state.scanned,
    reason: state.reason,
    trunk: state.trunk,
    refs: state.refs.map((r) => ({
      target: r.target, stage: r.stage, spec: r.spec, ref: r.ref, sha: r.sha, status: r.status, why: r.why,
    })),
  };
}

/** One line per task and target, for the text output. */
export function describeTaskDeployment(task) {
  if (!task.commits.length) return ["no commit on the trunk names this task"];
  if (!task.targets.length) return ["its commits touch no deploy target's paths"];
  return task.targets.map((t) =>
    t.target + ": " + t.stages.map((s) => {
      const parallel = s.refs.length > 1 && s.state !== "full" && s.state !== "unknown" && s.holding.length
        ? " (" + s.holding.join(", ") + ")"
        : "";
      return s.stage + " " + s.state + parallel;
    }).join(", "));
}

/** Why an empty answer is empty. */
export function explain(reason) {
  if (reason === "no-targets") return "this project declares no `deploy_targets` in config.yaml";
  if (reason === "only-external-targets") {
    return "every deploy target declares `repository:` — its code lives in another repository, so this one has no commit or ref to read, and its tasks are unobservable here";
  }
  if (reason === "no-git") return "not a git repository — deployment state is computed from git, so there is nothing to read";
  if (reason === "no-trunk") return "the trunk has no commits yet, so nothing can have been deployed";
  if (reason === "git-failed") return "a git command failed — deployment state could not be computed";
  if (reason === "no-task-ids-in-commits") return "no commit on the trunk names a task id, so no task can be placed in a stage";
  return null;
}

/** One line per ref that did not resolve: unknown, never empty. */
export function describeUnknownRefs(state) {
  return state.unknownRefs.map((r) =>
    r.target + "/" + r.stage + ": `" + r.spec + "` is unknown — " + r.why);
}
