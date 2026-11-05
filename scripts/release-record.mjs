#!/usr/bin/env node
/**
 * `deploy record` — a deployment stage git cannot observe, recorded as a ref
 * (TL-506).
 *
 * WHAT IT IS FOR. Some stages have no git event: a store approves a build, an
 * update channel is promoted, a staged rollout reaches 100%, a customer
 * installs a version, somebody signs off a change on the test environment.
 * Querying each store, flag system or CI provider would make the tool depend
 * on every one of them; Law 4 asks for a callable input instead. A CI step or a
 * person calls this command, and the tool never polls. The design is
 * `docs/release-tracking.md` §4.
 *
 * WHAT IT WRITES. An annotated tag OBJECT — no `refs/tags/` entry — pointing at
 * the commit, whose tagger is the actor (`scripts/actor.mjs`), whose date is
 * the moment of the record, and whose message carries the reason and where the
 * ref stood before. The stage's ref is then moved onto that tag object with a
 * compare-and-swap (`git update-ref <ref> <new> <old>`), so two records racing
 * for one ref cannot both win. The stage is therefore still a git ref: every
 * reader that resolves `<ref>^{commit}` sees the commit, `git push` shares it,
 * and the chain of `Previous:` lines is its inspectable history.
 *
 * WHAT IT REFUSES, each for a reason that is not taste:
 *   - a stage not declared `recorded: true` — moving a ref git observes by hand
 *     would make the tool assert a deployment nobody made;
 *   - no `--reason` — the same rule as `reason_required_statuses`;
 *   - a stage of parallel refs without `--ref` — moving all of them on one word
 *     would claim every region or customer at once;
 *   - a commit missing from the PREVIOUS stage, or a previous stage that does
 *     not resolve — stages are ordered, and "cannot tell" is not "yes". The
 *     first stage has no previous stage; what reached it without passing the
 *     trunk is a gap `check --release` reports, not a write this command blocks.
 * A move BACKWARDS is accepted — it is how a halted rollout is recorded — and
 * the output names the direction so nobody mistakes one for the other.
 *
 * IT NEVER PUSHES. It prints the push command, for the same reason `doctor`
 * prints a refspec rather than adding it: publishing is the owner's decision.
 *
 * Tests: `node --test scripts/tests/release-record.test.mjs`
 */

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveActorReport } from "./actor.mjs";
import { loadConfigOrExit } from "./config.mjs";
import { chooseRemote, refspecsCover, fixCommand, refNamespace } from "./deploy-fetch.mjs";
import { resolveRef } from "./environments.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";
import { ACTOR_NAMESPACES, isValidActor } from "./history.mjs";
import { printJson } from "./json-envelope.mjs";
import { repoRoot } from "./modified-files.mjs";
import { BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND, isBacklogDirRefusal, resolveBacklogDir, takeDirFlag } from "./paths.mjs";
import { PRODUCT_NAME as N } from "./product.mjs";
import { normalizeReason, reasonRefusal } from "./task-fields.mjs";
import { MARK, color, failure, refusal } from "./ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const RECORD_FLAGS = ["--target", "--stage", "--ref", "--reason", "--actor", "--json"];
const VALUE_FLAGS = ["--target", "--stage", "--ref", "--reason", "--actor"];

/** The directions a record can move a ref, named in the output. */
export const DIRECTIONS = Object.freeze(["first", "unchanged", "forward", "backward", "diverged"]);

/** The trailer keys of the tag message. A frozen format: `deploy status` and
 *  anybody's `git cat-file tag` read them back. */
const TRAILER = Object.freeze({
  reason: "Reason", actor: "Actor", target: "Target", stage: "Stage",
  ref: "Ref", commit: "Commit", source: "Source", previous: "Previous",
});

function git(run, root, args, input) {
  return run("git", args, {
    cwd: root, encoding: "utf8", timeout: 60_000, env: gitDiscoveryEnv(), input,
  });
}

function out(r) {
  return r && r.status === 0 ? String(r.stdout || "").trim() : "";
}

/** PURE — the flags and the one positional argument. Throws with the available
 *  set on the second line, the shape `refusal()` prints. */
export function parseRecordArgs(argv) {
  const avail = RECORD_FLAGS.join(" ") + " --dir <path>";
  const opts = { target: null, stage: null, ref: null, reason: null, actor: null, json: false, commit: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") { opts.json = true; continue; }
    if (VALUE_FLAGS.indexOf(a) >= 0) {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error("`" + a + "` with no value\n" + avail);
      opts[a.slice(2)] = v;
      continue;
    }
    if (a.startsWith("-")) throw new Error("unknown flag: " + a + "\n" + avail);
    if (opts.commit !== null) throw new Error("two commits: " + opts.commit + ", " + a + " — a record moves one ref to one commit\n" + avail);
    opts.commit = a;
  }
  if (opts.target === null) throw new Error("`--target` is required\n" + avail);
  if (opts.stage === null) throw new Error("`--stage` is required\n" + avail);
  if (opts.commit === null) throw new Error("no commit or tag to record\n" + avail);
  return opts;
}

/**
 * PURE — the ref a record moves, and the stage before it.
 *
 * `--ref` names one of the stage's refs by its full name or by its last path
 * component (`production-eu` for `refs/deploys/web/production-eu`) when that
 * is unambiguous. A stage of parallel refs REQUIRES it.
 *
 * @returns {{ok: true, target: object, stage: object, ref: string, previous: object|null}
 *   | {ok: false, message: string, details: string[], code: number, kind: string}}
 */
export function selectRecordedRef({ targets, target, stage, ref }) {
  const no = (message, details = [], code = 2, kind = "usage") => ({ ok: false, message, details, code, kind });
  const declared = (targets || []).map((t) => t.name);
  const t = (targets || []).find((x) => x.name === target);
  if (!t) {
    return no(declared.length
      ? "`" + target + "` is not a declared deploy target (declared: " + declared.join(", ") + ")"
      : "this project declares no `deploy_targets` in config.yaml, so it has no target `" + target + "`");
  }
  // A target in another repository (TL-507) has no stage here: a ref moved in
  // THIS repository would record a deployment of code it does not hold.
  if (t.repository) {
    return no("target `" + t.name + "` is deployed from the repository `" + t.repository + "` and has no stage to record here");
  }
  const i = t.stages.findIndex((s) => s.name === stage);
  if (i < 0) return no("target `" + t.name + "` declares no stage `" + stage + "` (declared: " + t.stages.map((s) => s.name).join(", ") + ")");
  const s = t.stages[i];
  if (!s.recorded) {
    const recorded = t.stages.filter((x) => x.recorded).map((x) => x.name);
    return no("`" + t.name + "/" + s.name + "` is not a recorded stage — git moves its ref, and moving it by hand would assert a deployment nobody made", [
      recorded.length ? "Recorded stages of `" + t.name + "`: " + recorded.join(", ") : "`" + t.name + "` declares no stage with `recorded: true`",
    ], 1, "not-recorded");
  }
  let chosen;
  if (ref === null) {
    if (s.parallel) {
      return no("`" + t.name + "/" + s.name + "` has parallel refs — `--ref` names the one that moves", [
        "One of: " + s.refs.join(", "),
      ]);
    }
    chosen = s.refs[0];
  } else {
    const exact = s.refs.filter((r) => r === ref);
    const byLeaf = s.refs.filter((r) => r.split("/").pop() === ref);
    const hits = exact.length ? exact : byLeaf;
    if (hits.length !== 1) {
      return no("`--ref " + ref + "` " + (hits.length ? "names more than one ref" : "is not a ref") + " of `" + t.name + "/" + s.name + "`", [
        "One of: " + s.refs.join(", "),
      ]);
    }
    chosen = hits[0];
  }
  return { ok: true, target: t, stage: s, ref: chosen, previous: i > 0 ? t.stages[i - 1] : null };
}

/** PURE — the tag object `git mktag` reads. */
export function recordTagObject({ commit, target, stage, ref, actor, reason, source, previous, epochSeconds }) {
  return [
    "object " + commit,
    "type commit",
    "tag " + target + "/" + stage,
    "tagger " + actor + " <> " + epochSeconds + " +0000",
    "",
    "Record " + target + "/" + stage,
    "",
    TRAILER.reason + ": " + reason,
    TRAILER.actor + ": " + actor,
    TRAILER.target + ": " + target,
    TRAILER.stage + ": " + stage,
    TRAILER.ref + ": " + ref,
    TRAILER.commit + ": " + commit,
    TRAILER.source + ": " + source,
    TRAILER.previous + ": " + (previous || "none"),
    "",
  ].join("\n");
}

/**
 * PURE — reads a tag object written by `recordTagObject` back from
 * `git cat-file tag <ref>`. Null for anything else: a ref CI moved, or a tag
 * somebody wrote by hand, is not a record and must not read like one.
 *
 * @returns {{commit: string, actor: string, at: string, reason: string,
 *   ref: string|null, source: string|null, previous: string|null} | null}
 */
export function parseRecordTag(text) {
  const t = String(text || "");
  const split = t.indexOf("\n\n");
  if (split < 0) return null;
  const header = t.slice(0, split);
  const object = header.match(/^object ([0-9a-f]+)$/m);
  const tagger = header.match(/^tagger (.*) <[^>]*> (\d+) [+-]\d{4}$/m);
  if (!object || !tagger) return null;
  const fields = {};
  for (const line of t.slice(split + 2).split("\n")) {
    const m = line.match(/^([A-Za-z-]+): (.*)$/);
    if (m && !(m[1] in fields)) fields[m[1]] = m[2];
  }
  if (!fields[TRAILER.reason] || !fields[TRAILER.actor] || fields[TRAILER.commit] !== object[1]) return null;
  return {
    commit: object[1],
    actor: fields[TRAILER.actor],
    at: new Date(Number(tagger[2]) * 1000).toISOString(),
    reason: fields[TRAILER.reason],
    ref: fields[TRAILER.ref] || null,
    source: fields[TRAILER.source] || null,
    previous: !fields[TRAILER.previous] || fields[TRAILER.previous] === "none" ? null : fields[TRAILER.previous],
  };
}

/** The record a ref currently carries, or null. */
export function readRecord({ root, ref, run = spawnSync }) {
  const r = git(run, root, ["cat-file", "tag", ref]);
  return r.status === 0 ? parseRecordTag(r.stdout) : null;
}

function isAncestor(run, root, a, b) {
  return git(run, root, ["merge-base", "--is-ancestor", a, b]).status === 0;
}

/**
 * Writes the record. Every refusal is decided before the first object is
 * written, so a refused record leaves the repository as it was.
 *
 * @returns {{ok: true, ...} | {ok: false, message: string, details: string[], code: number, kind: string}}
 */
export function recordStage({ root, selection, commitArg, actor, reason, now = Date.now(), run = spawnSync }) {
  const no = (message, details = [], code = 1, kind = "refused") => ({ ok: false, message, details, code, kind });
  const { target, stage, ref, previous } = selection;
  const commit = out(git(run, root, ["rev-parse", "--verify", "--quiet", commitArg + "^{commit}"]));
  if (!commit) return no("`" + commitArg + "` does not name a commit in this repository", [], 2, "usage");

  if (previous) {
    for (const spec of previous.refs) {
      const r = resolveRef({ root, spec, run });
      if (!r.sha) {
        return no("the previous stage `" + target.name + "/" + previous.name + "` cannot be read — `" + spec + "`: " + r.why, [
          "Stages are ordered, and a commit can be recorded in `" + stage.name + "` only once it is in `" + previous.name + "`;",
          "a stage nobody can read cannot confirm that. Fetch the ref, or record the previous stage first.",
        ], 1, "previous-unknown");
      }
      if (!isAncestor(run, root, commit, r.sha)) {
        return no("`" + commitArg + "` (" + commit.slice(0, 12) + ") is not in the previous stage `" + target.name + "/" + previous.name + "`", [
          "`" + spec + "` stands at " + r.sha.slice(0, 12) + " and does not contain it. Stages are ordered:",
          "record `" + previous.name + "` first, or name a commit it already holds.",
        ], 1, "not-in-previous-stage");
      }
    }
  }

  const oldObject = out(git(run, root, ["rev-parse", "--verify", "--quiet", ref]));
  const oldCommit = oldObject ? out(git(run, root, ["rev-parse", "--verify", "--quiet", ref + "^{commit}"])) : "";
  let direction;
  if (!oldCommit) direction = "first";
  else if (oldCommit === commit) direction = "unchanged";
  else if (isAncestor(run, root, oldCommit, commit)) direction = "forward";
  else if (isAncestor(run, root, commit, oldCommit)) direction = "backward";
  else direction = "diverged";

  const epochSeconds = Math.floor(now / 1000);
  const tagText = recordTagObject({
    commit, target: target.name, stage: stage.name, ref, actor, reason,
    source: commitArg, previous: oldCommit || null, epochSeconds,
  });
  const made = git(run, root, ["mktag"], tagText);
  const tag = out(made);
  if (!tag) return no("git could not write the tag object", [String(made.stderr || "").trim()].filter(Boolean));
  // Compare-and-swap: the ref must still be what it was when the direction was
  // judged. An empty old value means "must not exist yet".
  const moved = git(run, root, ["update-ref", "-m", N + " deploy record: " + reason, ref, tag, oldObject || ""]);
  if (moved.status !== 0) {
    return no("`" + ref + "` moved while this record was being written — nothing was changed", [String(moved.stderr || "").trim()].filter(Boolean));
  }

  const remote = chooseRemote({ root, run });
  let push = null;
  let fetchFix = null;
  if (remote.remote) {
    push = "git push " + remote.remote + " '+" + ref + ":" + ref + "'";
    const refspecs = out(git(run, root, ["config", "--get-all", "remote." + remote.remote + ".fetch"])).split("\n").filter(Boolean);
    if (!refspecsCover(refspecs, ref)) fetchFix = fixCommand(remote.remote, refNamespace(ref));
  } else if (remote.why === "ambiguous") {
    push = "git push <remote> '+" + ref + ":" + ref + "'";
  }

  return {
    ok: true,
    target: target.name, stage: stage.name, ref, commit, tag,
    previous: oldCommit || null, direction,
    actor, reason, recordedAt: new Date(epochSeconds * 1000).toISOString(),
    remote: remote.remote, push, fetchFix,
  };
}

export function run(argv) {
  const cmd = N + " deploy record";
  const dirFlag = takeDirFlag(argv);
  const wantsJson = dirFlag.argv.includes("--json");
  // Null until the actor is resolved, so a refusal before it never names a
  // rung nobody consulted (TL-550).
  let actorSource = null;
  const refuse = (message, details, code, kind) => {
    if (wantsJson) printJson("release-record", { ok: false, actorSource, refusalKind: kind, refusal: message, details });
    else console.error(failure(cmd, message, details, [cmd + " --help"]));
    return code;
  };
  let opts;
  try { opts = parseRecordArgs(dirFlag.argv); }
  catch (e) {
    const [head, avail] = e.message.split("\n");
    if (wantsJson) return refuse(head, ["available: " + avail], 2, "usage");
    console.error(refusal(cmd, head, avail));
    return 2;
  }
  // The reason is judged by the rule every other write uses, before anything
  // else: a record with no sentence beside it is a deployment nobody can explain.
  const why = reasonRefusal(opts.reason === null ? "" : opts.reason, "--reason");
  if (why) {
    const [head, ...rest] = why.split("\n");
    return refuse(head, rest, 2, "usage");
  }
  const resolved = resolveActorReport(opts.actor);
  const { actor } = resolved;
  actorSource = resolved.actorSource;
  if (!isValidActor(actor)) {
    return refuse("the actor `" + actor + "` has no valid namespace", ["Use one of: " + ACTOR_NAMESPACES.map((n) => n + ":<name>").join(" | ")], 2, "usage");
  }
  let root;
  try { root = resolveBacklogDir({ dir: dirFlag.dir || undefined, moduleDir: HERE }).root; }
  catch (e) {
    if (!isBacklogDirRefusal(e)) throw e;
    return refuse(e.message, e.details || [], BACKLOG_DIR_REFUSAL_EXIT, BACKLOG_DIR_REFUSAL_KIND);
  }
  const config = loadConfigOrExit(root);
  const selection = selectRecordedRef({ targets: config.deployTargets, target: opts.target, stage: opts.stage, ref: opts.ref });
  if (!selection.ok) return refuse(selection.message, selection.details, selection.code, selection.kind);
  const repo = repoRoot(root);
  if (!repo) return refuse("the backlog is not inside a git repository, so there is no ref to record", [], 1, "no-repository");

  const result = recordStage({ root: repo, selection, commitArg: opts.commit, actor, reason: normalizeReason(opts.reason) });
  if (!result.ok) return refuse(result.message, result.details, result.code, result.kind);

  if (wantsJson) {
    printJson("release-record", { ...result, actorSource });
    return 0;
  }
  const short = (s) => (s ? s.slice(0, 12) : "nothing");
  console.log(color.ok(MARK.ok) + " " + result.target + "/" + result.stage + " recorded at " + short(result.commit) +
    " (" + result.direction + (result.previous && result.direction !== "unchanged" ? " from " + short(result.previous) : "") + ")");
  console.log("  " + result.ref + " → tag " + short(result.tag) + " by " + result.actor + " at " + result.recordedAt);
  console.log("  reason: " + result.reason);
  if (result.push) console.log("  " + color.id(MARK.arrow + " share it: " + result.push));
  else console.log("  " + color.dim("no remote — the record stays in this clone"));
  if (result.fetchFix) {
    console.log("  " + color.dim("other clones fetch it only once their refspec carries it: " + result.fetchFix));
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("release-record.mjs")) {
  process.exitCode = run(process.argv.slice(2));
}
