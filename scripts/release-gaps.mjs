/**
 * The gaps in release traceability that the gate refuses (TL-503).
 *
 * WHAT "NO GAPS" MEANS. The set of changes a stage holds and the set of tasks
 * the backlog calls finished agree in both directions. Seven ways they can
 * disagree, each detectable from git plus the task files, and one way the plan
 * disagrees with a promotion; each is reported with the commit or task that
 * proves it (`docs/release-tracking.md` §7):
 *
 *   untracked-commit    a deployed commit names no task id
 *   open-task-deployed  a deployed commit names a task that is still open
 *   partial-task        some of a task's commits are in a ref and later ones are
 *                       not — or, in a stage of parallel refs, one ref holds it
 *                       and another does not
 *   stage-only-commit   a commit a stage holds that the trunk or an earlier
 *                       stage of the same target does not: the next ordinary
 *                       promotion silently reverts it
 *   done-not-on-trunk   a task closed as done whose commits exist only off the
 *                       trunk: finished on a branch nobody merged
 *   unknown-task-id     a deployed commit names an id no task file carries
 *   untargeted-commit   a deployed commit touches no declared target's paths
 *   planned-blocker-open
 *                       a task of the HIGHEST priority, planned for the CURRENT
 *                       release (`release:`, TL-505, TL-515), is still open: the
 *                       last stage of each of its targets is not ready to
 *                       receive the release
 *
 * WHICH COMMITS ARE "DEPLOYED". For each stage ref, the trunk commits it holds
 * (by reachability or patch identity — the same judgement `environments.mjs`
 * makes) plus the commits it holds that the trunk does not. Merge commits are
 * skipped, as everywhere in release tracking: they introduce no change of their
 * own.
 *
 * THE ADOPTION BOUNDARY. Trunk commits OLDER than the oldest one naming any
 * task id are not judged. A repository adopts task ids at some point in its
 * life, and every commit before that point would otherwise be an
 * `untracked-commit` — thousands of findings that no future commit can repair,
 * which is how a gate teaches its reader to skip its output. The boundary is
 * computed, not configured, and the report names how many commits it excluded.
 * Commits a stage holds OFF the trunk are judged regardless: they are bounded by
 * their merge base already, and they are exactly what the gate exists to see.
 *
 * WHY `done-not-on-trunk` LOOKS FOR COMMITS ELSEWHERE. A closed task with no
 * commit on the trunk is not by itself a gap: its work may live in another
 * repository (`docs/release-tracking.md` §6), or it may have changed nothing.
 * The gap is the case with evidence — commits naming it on a branch or remote
 * the trunk never received, and none on the trunk. A squash merge leaves the
 * branch commits off the trunk but puts a commit naming the task on it, so it
 * is not reported.
 *
 * WHY `planned-blocker-open` JUDGES INTENT, NOT GIT. Every other gap compares
 * what a ref holds with what the backlog says. This one is the owner's decision
 * of 2026-11-01: an open task at the top of `priorities:` that a person planned
 * for a release blocks the promotion to the LAST stage of its targets — the
 * stage where the release reaches users — and no other. The priority is read as
 * the first entry of `priorities:`, never as a literal, because the scale is
 * the project's. Its targets are the ones its trunk commits touched; a task with
 * no commit on the trunk yet has touched nothing that could narrow it, so it
 * holds back the last stage of EVERY target rather than none — "not started"
 * is the strongest form of "not ready". Only the CURRENT release counts — the
 * first entry of `releases:` not yet fully shipped, the list being read as
 * chronological (`currentRelease()` in release-status.mjs, decided by the owner
 * on 2026-11-02, TL-515). A project shipping one release while planning the
 * next is not held back by the next one's work, and does not have to accept
 * the gap wholesale to get past it, which would silence the blockers that
 * matter as well. When every release has shipped there is no current release,
 * and nothing planned blocks. The result names the current release in
 * `currentRelease`, so a reader can see which plan was judged, and says in
 * `currentReleaseJudged` whether one was judged at all.
 *
 * A TARGET IN ANOTHER REPOSITORY (`repository:`, TL-507) is never judged: its
 * commits and refs are not in this git, so every detector here would read the
 * absence of evidence as evidence. Its tasks — the ones naming it in `target:`
 * — are exempt from the two detectors that judge a task by what this
 * repository LACKS: `done-not-on-trunk` (commits naming such a task may be the
 * other repository's, fetched here as a remote) and the every-target fallback
 * of `planned-blocker-open` (a task with no commit here is not "not started"
 * there). Commits this repository does hold are judged as everywhere else, so
 * a task split across both repositories is still judged on this one's half.
 * The result counts the tasks per such target in `unobservable`, so the report
 * says what it did not look at instead of reading as a clean answer.
 *
 * MODE AND ACCEPTED GAPS come from config.yaml: `release_gate` (`report`, the
 * default, or `require`) and `release_gate_accept` (gap names this project
 * knowingly accepts). This module computes; the caller decides the exit code
 * with `gateVerdict()`.
 *
 * Tests: `node --test scripts/tests/release-gaps.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { deploymentState, parseCherry, parseTrunkLog } from "./environments.mjs";
import { externalTargetsOf, isExternalTarget, observedTargets, pathInTarget } from "./deploy-targets.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { backlogPaths } from "./paths.mjs";
import { releaseEntriesOf } from "./release-entries.mjs";
import { readShipments } from "./release-shipped.mjs";
import { currentRelease } from "./release-status.mjs";
import { taskIdScanner } from "./task-id.mjs";
import { readTaskRecords } from "./task-select.mjs";

/** The gap names, in the order a report lists them. `release_gate_accept`
 *  takes values from this list and nothing else. */
export const GAP_NAMES = Object.freeze([
  "untracked-commit",
  "open-task-deployed",
  "partial-task",
  "stage-only-commit",
  "done-not-on-trunk",
  "unknown-task-id",
  "untargeted-commit",
  "planned-blocker-open",
]);

/** The values of `release_gate`, mirroring `contract_capability`. */
export const RELEASE_GATE_MODES = Object.freeze(["report", "require"]);

/**
 * The task records `releaseGaps()` judges, read from the backlog directory.
 *
 * ONE READER FOR BOTH CALLERS (TL-552). `check --release` and the viewer's gap
 * panel take their records from here. The panel used to project the page's own
 * task objects, which a different parser produced, through a shim that
 * restated this reader's defaults field by field; a field that shim forgot was
 * a gap the gate reported and the panel could not show (TL-519), with no
 * failure anywhere to say so. `computeStatus()` in release-status.mjs reads
 * here too (TL-573), so `deploy status` and the Release view's lanes judge the
 * same records the panel beside them does.
 *
 * IN FILENAME ORDER. The lanes, the scope's lists and the gate's findings
 * follow the order of these records. `readTaskRecords()` sorts them itself
 * (TL-643), so this reader adds no sort of its own; the ordering test in
 * scripts/tests/release-view-one-reader.test.mjs still holds the pipeline to
 * it.
 *
 * @param {string} backlogRoot the backlog directory, not the repository root
 * @param {object} config the loaded configuration
 */
export function releaseTaskRecords(backlogRoot, config) {
  return readTaskRecords(backlogPaths(backlogRoot).tasksDir, config.taskId.file);
}

const RS = String.fromCharCode(30);
const US = String.fromCharCode(31);

function git(run, root, args) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 256 * 1024 * 1024, env: gitDiscoveryEnv(),
  });
}

/** `target/stage`, plus the ref when the stage has several. */
function place(target, stage, spec, parallel) {
  return target + "/" + stage + (parallel ? " (" + spec + ")" : "");
}

/**
 * Every gap, computed in one pass.
 *
 * @param {object} opts
 * @param {string|null} opts.root the repository root
 * @param {object} opts.config the loaded configuration
 * @param {{id: string, status: string, priority?: string, release?: string, target?: string[]}[]} opts.tasks every task file
 * @param {{target: string|null, stage: string}|null} [opts.selector] `--env`
 * @param {{spec: string, source: string}} opts.trunk from `defaultTrunk()` or `--trunk`
 * @param {object} [opts.state] a `deploymentState()` the caller already computed
 *   for the SAME root, prefix, targets and trunk — the viewer's Release view
 *   (TL-504) reads it for its columns too, and two passes over the same refs
 *   would only double the cost of one build
 * @returns {{
 *   scanned: boolean, reason: string, trunk: {spec: string, sha: string|null, source: string},
 *   refs: object[], unknownRefs: object[], excludedBeforeAdoption: number,
 *   currentRelease: string|null, currentReleaseJudged: boolean,
 *   unobservable: {target: string, repository: string, count: number}[],
 *   gaps: {gap: string, accepted: boolean, subject: string, where: string[], commits: string[], detail: string}[],
 * }}
 */
export function releaseGaps({ root, config, tasks, selector = null, trunk, state: given = null, run = spawnSync }) {
  const declared = config.deployTargets || [];
  const targets = observedTargets(declared);
  const state = given || deploymentState({ root, prefix: config.taskIdPrefix, targets: declared, trunk: trunk.spec, run });
  const external = (task) => externalTargetsOf(declared, task).length > 0;
  const base = {
    scanned: state.scanned, reason: state.reason,
    trunk: { spec: trunk.spec, sha: state.trunk.sha, source: trunk.source },
    refs: [], unknownRefs: [], excludedBeforeAdoption: 0, gaps: [],
    // Judged only once git was read: before that, every planned task would be
    // "not shipped" for want of evidence, and the first release with any plan
    // would be named current on no measurement at all. `currentRelease: null`
    // means "every release has shipped" ONLY with `currentReleaseJudged: true`;
    // unjudged, it means nothing was read, and the flag says which.
    currentRelease: null,
    currentReleaseJudged: false,
    unobservable: declared.filter(isExternalTarget).map((t) => ({
      target: t.name, repository: t.repository,
      count: tasks.filter((task) => externalTargetsOf([t], task).length).length,
    })),
  };
  // `no-trunk` from `deploymentState()` means only that the trunk spec named no
  // commit. That is an empty repository ONLY if no ref holds a commit and the
  // spec was not chosen by hand; a mistyped `--trunk`, or a CI clone that never
  // fetched the remote default branch, is a trunk that could not be read — and
  // reporting it as "nothing can have been deployed" would make a gate that
  // could not look read as one that looked and found nothing.
  if (state.reason === "no-trunk") {
    const any = trunk.source === "flag" ? null : git(run, root, ["rev-list", "-n", "1", "--all"]);
    if (!any || any.status !== 0 || String(any.stdout || "").trim()) base.reason = "trunk-unresolved";
  }
  // `deploymentState()` returns `no-targets` before it reads the trunk, so its
  // SHA is null there for a trunk that may well resolve. The report names the
  // trunk on every run, and a null would print as a trunk that does not exist.
  if ((state.reason === "no-targets" || state.reason === "only-external-targets") && root) {
    const r = git(run, root, ["rev-parse", "--verify", "--quiet", trunk.spec + "^{commit}"]);
    if (r.status === 0) base.trunk.sha = String(r.stdout || "").trim() || null;
  }
  if (!state.scanned) return base;

  const accept = new Set(config.releaseGateAccept || []);
  const statusOf = new Map(tasks.map((t) => [t.id, t.status]));
  const archived = new Set(config.archivedStatuses || []);
  // The status `done` writes by default — `closingStatus()` in done-task.mjs
  // reads the same position of the same list.
  const doneStatus = (config.archivedStatuses || [])[0] || null;
  const trunkSha = state.trunk.sha;
  const scanner = taskIdScanner(config.taskIdPrefix);

  // The adoption boundary: the trunk log is newest first.
  let last = -1;
  state.commits.forEach((c, i) => { if (c.ids.length) last = i; });
  const judged = state.commits.slice(0, last + 1);
  base.excludedBeforeAdoption = state.commits.length - judged.length;

  const selected = (t, s) => !selector ||
    (selector.stage === s.name && (selector.target === null || selector.target === t.name));
  const refOf = (t, s, spec) => state.refs.find((r) => r.target === t.name && r.stage === s.name && r.spec === spec);

  // Commits a ref holds that the trunk does not, by patch identity: one log and
  // one cherry per distinct SHA.
  const offTrunkCache = new Map();
  function offTrunk(sha) {
    if (offTrunkCache.has(sha)) return offTrunkCache.get(sha);
    const log = git(run, root, ["log", "--no-merges", "--name-only", "--format=" + RS + "%H" + US + "%B" + US, sha, "--not", trunkSha, "--"]);
    const cherry = git(run, root, ["cherry", trunkSha, sha]);
    if (log.status !== 0 || cherry.status !== 0) throw new Error("git failed while reading `" + sha + "`");
    const unique = parseCherry(cherry.stdout);
    const commits = parseTrunkLog(log.stdout, scanner).filter((c) => unique.has(c.sha));
    for (const c of commits) {
      c.targets = targets.filter((t) => c.files.some((f) => pathInTarget(t, f))).map((t) => t.name);
    }
    offTrunkCache.set(sha, commits);
    return commits;
  }

  // Findings keyed by gap and subject, so one commit deployed to four stages is
  // ONE finding naming four places, not four findings.
  const found = new Map();
  function note(gap, subject, where, commits, detail) {
    const key = gap + "\u0000" + subject;
    let f = found.get(key);
    if (!f) {
      f = { gap, accepted: accept.has(gap), subject, where: [], commits: [], detail };
      found.set(key, f);
    }
    for (const w of where) if (f.where.indexOf(w) < 0) f.where.push(w);
    for (const c of commits) if (f.commits.indexOf(c) < 0) f.commits.push(c);
  }

  try {
    for (const t of targets) {
      t.stages.forEach((s, si) => {
        if (!selected(t, s)) return;
        const parallel = s.refs.length > 1;
        for (const spec of s.refs) {
          const r = refOf(t, s, spec);
          base.refs.push({ target: t.name, stage: s.name, spec, ref: r.ref, sha: r.sha, status: r.status, why: r.why });
          if (!r.sha) { base.unknownRefs.push({ target: t.name, stage: s.name, spec, why: r.why }); continue; }
          const at = place(t.name, s.name, spec, parallel);
          const gone = state.missing.get(r.sha);
          const held = judged.filter((c) => !gone.has(c.sha));
          const extra = offTrunk(r.sha);

          for (const c of held.concat(extra)) {
            if (!c.targets.length) {
              if (c.files.length) note("untargeted-commit", c.sha, [at], [c.sha], "touches no declared target's paths");
              continue;
            }
            if (c.targets.indexOf(t.name) < 0) continue;
            if (!c.ids.length) note("untracked-commit", c.sha, [at], [c.sha], "names no task id");
            for (const id of c.ids) {
              if (!statusOf.has(id)) note("unknown-task-id", id, [at], [c.sha], "no task file carries this id");
              else if (!archived.has(statusOf.get(id))) {
                note("open-task-deployed", id, [at], [c.sha], "the task is still `" + statusOf.get(id) + "`");
              }
            }
          }

          for (const c of extra) {
            if (c.targets.indexOf(t.name) < 0 && c.targets.length) continue;
            note("stage-only-commit", c.sha, [at], [c.sha], "missing from the trunk `" + trunk.spec + "`");
          }
          // A trunk commit this stage holds that an EARLIER stage of the same
          // target lacks: promoting that earlier stage reverts it.
          for (const earlier of t.stages.slice(0, si)) {
            for (const espec of earlier.refs) {
              const e = refOf(t, earlier, espec);
              if (!e.sha) continue;
              const eGone = state.missing.get(e.sha);
              for (const c of held) {
                if (c.targets.indexOf(t.name) < 0 || !eGone.has(c.sha)) continue;
                note("stage-only-commit", c.sha, [at], [c.sha],
                  "missing from the earlier stage " + place(t.name, earlier.name, espec, earlier.refs.length > 1));
              }
            }
          }
        }
      });
    }

    // Partial tasks, from the per-task answer `environments.mjs` already computed.
    for (const entry of state.byTask.values()) {
      for (const te of entry.targets) {
        const target = targets.find((t) => t.name === te.target);
        for (const st of te.stages) {
          const stage = target.stages.find((s) => s.name === st.stage);
          if (!selected(target, stage)) continue;
          const parallel = st.refs.length > 1;
          for (const r of st.refs) {
            if (r.state === "partial") {
              const gone = state.missing.get(r.sha);
              note("partial-task", entry.id, [place(te.target, st.stage, r.spec, parallel)],
                te.commits.filter((sha) => gone.has(sha)),
                r.held + " of " + r.of + " commit(s) held; the listed ones are not");
            }
          }
          const states = st.refs.map((r) => r.state);
          if (parallel && states.indexOf("full") >= 0 && states.indexOf("absent") >= 0) {
            note("partial-task", entry.id,
              st.refs.filter((r) => r.state === "absent").map((r) => place(te.target, st.stage, r.spec, true)),
              te.commits, "held by " + st.refs.filter((r) => r.state === "full").map((r) => r.spec).join(", ") +
                " and missing from the parallel refs listed");
          }
        }
      }
    }

    // Done tasks whose commits never reached the trunk. Independent of `--env`:
    // it is a question about the trunk, not about a stage.
    if (doneStatus) {
      const done = tasks.filter((t) => t.status === doneStatus && !state.byTask.has(t.id) && !external(t));
      if (done.length) {
        const log = git(run, root, ["log", "--no-merges", "--format=" + RS + "%H" + US + "%B" + US, "--branches", "--remotes", "--not", trunkSha, "--"]);
        if (log.status !== 0) throw new Error("git failed while reading the branches off the trunk");
        const elsewhere = new Map();
        for (const c of parseTrunkLog(log.stdout, scanner)) {
          for (const id of c.ids) {
            if (!elsewhere.has(id)) elsewhere.set(id, []);
            elsewhere.get(id).push(c.sha);
          }
        }
        for (const t of done) {
          if (!elsewhere.has(t.id)) continue;
          note("done-not-on-trunk", t.id, ["trunk " + trunk.spec], elsewhere.get(t.id),
            "closed as `" + doneStatus + "`, and no commit on the trunk names it; the listed commits are on a branch or remote only");
        }
      }
    }

    // Open top-priority tasks planned for a release, against the last stage of
    // their targets (see the header). Read from the task files, not from git.
    const top = (config.priorities || [])[0];
    // A release naming a ref is judged against that ref (TL-516).
    const shipments = readShipments({
      root, prefix: config.taskIdPrefix, entries: releaseEntriesOf(config), trunkSha, trunkCommits: state.commits, run,
    });
    base.currentRelease = currentRelease({
      state, targets: declared, tasks, releases: config.releases, archived: config.archivedStatuses, shipments,
    });
    base.currentReleaseJudged = true;
    const current = base.currentRelease;
    if (top && current !== null) {
      for (const task of tasks) {
        if (task.release !== current || task.priority !== top || archived.has(task.status)) continue;
        const entry = state.byTask.get(task.id);
        // A task of a target in another repository with no target here has
        // nothing this repository could hold back.
        if (!(entry && entry.targets.length) && external(task)) continue;
        const own = entry && entry.targets.length ? entry.targets.map((x) => x.target) : targets.map((t) => t.name);
        const where = [];
        for (const t of targets) {
          if (own.indexOf(t.name) < 0) continue;
          const last = t.stages[t.stages.length - 1];
          if (selected(t, last)) where.push(t.name + "/" + last.name);
        }
        if (!where.length) continue;
        note("planned-blocker-open", task.id, where, entry ? entry.commits : [],
          "a `" + top + "` task planned for the current release `" + current + "` is still `" + task.status + "`");
      }
    }
  } catch (e) {
    return { ...base, scanned: false, reason: "git-failed", gaps: [], currentRelease: null, currentReleaseJudged: false };
  }

  base.gaps = [...found.values()].sort((a, b) =>
    GAP_NAMES.indexOf(a.gap) - GAP_NAMES.indexOf(b.gap) || a.subject.localeCompare(b.subject));
  return base;
}

/**
 * PURE — which release's plan was judged (TL-515), as a sentence, or null for a
 * project that declares no releases: naming a concept nobody declared would be
 * noise. One wording for `check --release` and the viewer's gap panel (TL-519),
 * so the two readers of one result cannot describe it differently.
 *
 * @param {{currentRelease: string|null, currentReleaseJudged: boolean}} result
 * @param {readonly string[]} releases  `config.releases`
 * @returns {string|null}
 */
export function currentReleaseText(result, releases) {
  if (!(releases || []).length) return null;
  if (!result.currentReleaseJudged) {
    return "which release is current was not judged — deployment was not read";
  }
  if (result.currentRelease === null) {
    return "no current release — every release in `releases:` has shipped, so no planned task blocks";
  }
  return "current release: " + result.currentRelease +
    " — the first in `releases:` not fully shipped; only its planned tasks can block";
}

/**
 * The exit decision, separate from the computation so the two modes can be
 * tested on one result.
 *
 * - `report`: exit 0 whatever was found — the owner's decision of 2026-11-01,
 *   because a blocking default would fail every repository whose version-bump
 *   commits carry no id.
 * - `require`: exit 1 on any gap not accepted in configuration, and on any
 *   selected ref that did not resolve — a gate that could not look must not
 *   read as a gate that looked and found nothing.
 *
 * A scan that could not run at all (`git-failed`) exits 1 in both modes; one
 * with nothing to judge (no targets, no commits yet) exits 0. Outside git, or
 * with a trunk that does not resolve in a repository that has commits
 * (`trunk-unresolved`), it exits 1 under `require` — the same rule as an
 * unresolved stage ref, applied to the ref every judgement starts from.
 */
export function gateVerdict(result, mode) {
  const blocking = result.gaps.filter((g) => !g.accepted);
  if (result.reason === "git-failed") return { exit: 1, blocking };
  if (mode !== "require") return { exit: 0, blocking };
  if (result.reason === "no-git" || result.reason === "trunk-unresolved") return { exit: 1, blocking };
  return { exit: blocking.length || result.unknownRefs.length ? 1 : 0, blocking };
}
