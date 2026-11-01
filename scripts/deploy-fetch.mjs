/**
 * Does a declared deploy ref reach this clone on `git fetch`? (TL-508)
 *
 * THE GAP. The default fetch refspec is `+refs/heads/*:refs/remotes/<remote>/*`
 * plus tags, so a ref under `refs/deploys/` that CI pushes, or that a recorded
 * stage writes, exists on the remote and in the clone that wrote it — and in no
 * other clone. There a stage reads as unknown, or worse, as an old copy of
 * itself that looks exactly like the current one (`docs/release-tracking.md`
 * §3, "The answer is only as fresh as the refs it read").
 *
 * WHAT IS DELIBERATELY NOT DONE. Fetching inside a reading command was
 * rejected: a read that contacts the network is slow, fails offline and changes
 * the repository behind the user's back. Adding the refspec automatically was
 * rejected too: it is the owner's repository configuration, for the same reason
 * the tool never pushes. This module detects and names the fix; `doctor`
 * prints it; a person applies it.
 *
 * WHAT COUNTS AS COVERED. A refspec that FETCHES the ref is not enough — it has
 * to fetch it to the SAME NAME, because the stage is read by that name.
 * `+refs/deploys/*:refs/remotes/origin/deploys/*` carries the objects and still
 * leaves `refs/deploys/web/production` where it was. So a refspec covers a ref
 * when its source matches the ref and its destination maps it back onto
 * itself, and no negative refspec (`^…`) excludes it.
 *
 * Tests: `node --test scripts/tests/release-fetch-refspec.test.mjs`
 */

import { spawnSync } from "node:child_process";

import { isGlob } from "./deploy-targets.mjs";
import { gitDiscoveryEnv } from "./git-env.mjs";

/**
 * The namespaces git's own refspecs already describe: local branches, the
 * remote-tracking copies the default refspec writes, and tags. A declared ref
 * in one of them is outside this question — `origin/main` moves on every
 * default fetch.
 */
export const GIT_NAMESPACES = Object.freeze(["refs/heads/", "refs/remotes/", "refs/tags/"]);

/** PURE — the literal text of a glob before its first glob character. */
function literalPrefix(spec) {
  const i = String(spec).search(/[*?[]/);
  return i < 0 ? String(spec) : String(spec).slice(0, i);
}

/** PURE — the literal text of a glob after its last glob character. A `]`
 *  counts as one: reading a literal `]` as the end of a class only shortens
 *  the suffix, which makes the coverage test below stricter, never looser. */
function literalSuffix(spec) {
  const s = String(spec);
  let i = s.length;
  while (i > 0 && !"*?[]".includes(s[i - 1])) i--;
  return s.slice(i);
}

/**
 * PURE — the source pattern of the refspec that fixes a declared ref, computed
 * from the RAW spec, never from a sample of it:
 *
 *   refs/deploys/web/production  → refs/deploys/*   (the first component)
 *   refs/deploys/desktop-v*      → refs/deploys/*
 *   refs/released                → refs/released    (its own namespace)
 *   refs/release-v*              → refs/release-v*  (a one-star glob IS a refspec pattern)
 *   refs/release-v?              → refs/release-v*  (`?` and `[…]` cannot be
 *                                                     written in a refspec, so the
 *                                                     literal prefix plus `*` covers it)
 *
 * Returns null when the first component under `refs/` starts with a glob
 * character: the only covering pattern is then `refs/*`, which mirrors every
 * ref of the remote — branches included, forced — and is not a fix to print.
 */
export function refNamespace(spec) {
  const s = String(spec);
  const parts = s.split("/");
  const first = parts[1] || "";
  if (!isGlob(first)) return parts.length <= 2 ? s : parts[0] + "/" + first + "/*";
  const prefix = literalPrefix(first);
  if (!prefix) return null;
  const oneStar = (s.match(/\*/g) || []).length === 1 && !/[?[]/.test(s);
  return oneStar ? s : parts[0] + "/" + prefix + "*";
}

/**
 * PURE — the declared ref specs a fetch refspec has to carry: every ref of every
 * stage that is a full `refs/…` name outside git's own namespaces.
 *
 * A SHORT NAME IS NOT JUDGED, and that is a limitation, not a proof. git's
 * rev-parse, which resolves a stage, tries `refs/<name>` before tags, heads and
 * remotes, so a stage declared as `deploys/web/production` resolves to
 * `refs/deploys/web/production` wherever that ref exists — and in a clone where
 * it does not, nothing tells `origin/main` (a remote-tracking branch) apart from
 * `deploys/web/production` (a ref no default refspec fetches). This check
 * assumes a short name lives in git's own namespaces and shows no row for it.
 * Declare a deploy ref by its full `refs/…` name to have it checked.
 *
 * @returns {{target: string, stage: string, spec: string, namespace: string|null}[]}
 */
export function declaredForeignRefs(targets) {
  const out = [];
  for (const t of targets || []) {
    for (const s of t.stages || []) {
      for (const spec of s.refs || []) {
        if (!spec.startsWith("refs/")) continue;
        if (GIT_NAMESPACES.some((ns) => spec.startsWith(ns))) continue;
        out.push({ target: t.name, stage: s.name, spec, namespace: refNamespace(spec) });
      }
    }
  }
  return out;
}

/** PURE — git's refspec pattern: at most one `*`, matching any run of
 *  characters including `/`. Returns what `*` matched, or null. */
function matchPattern(pattern, name) {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern === name ? "" : null;
  const head = pattern.slice(0, star);
  const tail = pattern.slice(star + 1);
  if (name.length < head.length + tail.length) return null;
  if (!name.startsWith(head) || !name.endsWith(tail)) return null;
  return name.slice(head.length, name.length - tail.length);
}

/** PURE — one `remote.<name>.fetch` value split into its parts. */
export function parseRefspec(text) {
  let t = String(text).trim();
  if (t.startsWith("^")) return { negative: true, src: t.slice(1), dst: null };
  if (t.startsWith("+")) t = t.slice(1);
  const colon = t.indexOf(":");
  if (colon < 0) return { negative: false, src: t, dst: null };
  return { negative: false, src: t.slice(0, colon), dst: t.slice(colon + 1) };
}

/** PURE — a refspec pattern split at its `*`: `{head, tail}`, or the whole
 *  name as `head` when it has none. */
function splitPattern(pattern) {
  const star = pattern.indexOf("*");
  return star < 0 ? { head: pattern, tail: "", star: false }
    : { head: pattern.slice(0, star), tail: pattern.slice(star + 1), star: true };
}

/**
 * PURE — could a refspec pattern match some ref the glob matches? Judged on the
 * glob's literal prefix and suffix only, so it answers yes whenever it cannot
 * rule an overlap out: a negative refspec that MIGHT exclude part of the glob
 * defeats coverage, which errs towards red.
 */
function mayOverlap(pattern, glob) {
  const { head, tail } = splitPattern(pattern);
  const p = literalPrefix(glob);
  const x = literalSuffix(glob);
  return (head.startsWith(p) || p.startsWith(head)) && (tail.endsWith(x) || x.endsWith(tail));
}

/**
 * PURE — does every ref the glob matches pass through this refspec onto its own
 * name? Only when the refspec maps onto itself (`src === dst`, one `*`) and its
 * head is a prefix of the glob's literal prefix and its tail a suffix of the
 * glob's literal suffix. Then any match is head + … + tail. A sample of the
 * glob is NOT enough: `refs/release-vx:refs/release-vx` passes the sample
 * `refs/release-vx` and fetches no `refs/release-v2`.
 */
function coversGlob(r, glob) {
  if (!r.dst || r.src !== r.dst) return false;
  const { head, tail, star } = splitPattern(r.src);
  if (!star) return false;
  return literalPrefix(glob).startsWith(head) && literalSuffix(glob).endsWith(tail);
}

/**
 * PURE — does this list of fetch refspecs bring `spec` into the clone under the
 * same name? `spec` is a ref name or a glob; a glob is covered only when EVERY
 * ref it can match is.
 */
export function refspecsCover(refspecs, spec) {
  const specs = (refspecs || []).map(parseRefspec);
  if (isGlob(spec)) {
    if (specs.some((r) => r.negative && mayOverlap(r.src, spec))) return false;
    return specs.some((r) => !r.negative && coversGlob(r, spec));
  }
  const ref = spec;
  if (specs.some((r) => r.negative && matchPattern(r.src, ref) !== null)) return false;
  return specs.some((r) => {
    if (r.negative || !r.dst) return false;
    const matched = matchPattern(r.src, ref);
    if (matched === null) return false;
    const mapped = r.dst.includes("*") ? r.dst.replace("*", matched) : r.dst;
    return mapped === ref;
  });
}

/** PURE — the refspec that brings a namespace in under its own name. A forced
 *  update (`+`), because a rollback moves a deploy ref backwards. */
export function fixRefspec(namespace) {
  return "+" + namespace + ":" + namespace;
}

/** PURE — the exact command a person runs to add it. Single quotes keep the
 *  shell from expanding the `*`. */
export function fixCommand(remote, namespace) {
  if (!namespace) return null;
  return "git config --add remote." + remote + ".fetch '" + fixRefspec(namespace) + "'";
}

function git(run, root, args) {
  return run("git", args, { cwd: root, encoding: "utf8", timeout: 30_000, env: gitDiscoveryEnv() });
}

function lines(r) {
  return r.status === 0 ? String(r.stdout || "").split("\n").map((l) => l.trim()).filter(Boolean) : [];
}

/**
 * The remote the deploy refs are fetched from, and how it was chosen.
 *
 * The current branch's upstream remote first: that is what a bare `git fetch`
 * contacts, so it is the remote whose refspec decides what an ordinary fetch
 * brings in. Without one, a clone with a single remote has no other candidate,
 * and `origin` is the remote git itself names on clone. Several remotes and
 * neither rule answering is reported as such — guessing one would make a
 * green row mean "a remote you may never fetch from is configured correctly".
 *
 * @returns {{remote: string|null, why: string, remotes: string[]}}
 */
export function chooseRemote({ root, run = spawnSync }) {
  const remotes = lines(git(run, root, ["remote"]));
  if (!remotes.length) return { remote: null, why: "no-remote", remotes };
  const branch = lines(git(run, root, ["symbolic-ref", "-q", "--short", "HEAD"]))[0];
  if (branch) {
    const upstream = lines(git(run, root, ["config", "--get", "branch." + branch + ".remote"]))[0];
    if (upstream && remotes.includes(upstream)) return { remote: upstream, why: "upstream", remotes };
  }
  if (remotes.length === 1) return { remote: remotes[0], why: "only", remotes };
  if (remotes.includes("origin")) return { remote: "origin", why: "origin", remotes };
  return { remote: null, why: "ambiguous", remotes };
}

/**
 * The whole question for one repository.
 *
 * @returns {{declared: ReturnType<typeof declaredForeignRefs>,
 *   remote: string|null, why: string, remotes: string[], refspecs: string[],
 *   missing: {namespace: string, specs: string[], fix: string}[]}}
 */
export function deployFetchState({ root, targets, run = spawnSync }) {
  const declared = declaredForeignRefs(targets);
  if (!declared.length) return { declared, remote: null, why: "nothing-declared", remotes: [], refspecs: [], missing: [] };
  const chosen = chooseRemote({ root, run });
  if (!chosen.remote) return { declared, ...chosen, refspecs: [], missing: [] };
  const refspecs = lines(git(run, root, ["config", "--get-all", "remote." + chosen.remote + ".fetch"]));
  const byNamespace = new Map();
  for (const d of declared) {
    if (refspecsCover(refspecs, d.spec)) continue;
    if (!byNamespace.has(d.namespace)) byNamespace.set(d.namespace, []);
    const specs = byNamespace.get(d.namespace);
    if (!specs.includes(d.spec)) specs.push(d.spec);
  }
  const missing = [...byNamespace].map(([namespace, specs]) =>
    ({ namespace, specs, fix: fixCommand(chosen.remote, namespace) }));
  return { declared, ...chosen, refspecs, missing };
}
